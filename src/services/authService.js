const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const config = require('../config');
const { readSettings } = require('../utils/settings');

const prisma = require('../lib/prisma');

function normalizeRpId(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function parseOrigin(value) {
  try {
    return new URL(String(value || '').trim());
  } catch {
    return null;
  }
}

function isLocalHostname(hostname) {
  const value = normalizeRpId(hostname);
  return value === 'localhost'
    || value === '127.0.0.1'
    || value === '::1'
    || value.endsWith('.localhost');
}

function getConfiguredWebAuthnConfig() {
  const s = readSettings().webauthn || {};
  const rpName = String(s.rpName || config.webauthn?.rpName || 'MaintenanceBoard').trim() || 'MaintenanceBoard';
  const configuredOrigin = String(s.origin || config.webauthn?.origin || '').trim();
  const parsedOrigin = parseOrigin(configuredOrigin);
  const rpId = normalizeRpId(s.rpId || config.webauthn?.rpId || parsedOrigin?.hostname || '');
  const origin = parsedOrigin?.origin || configuredOrigin;
  return {
    rpName,
    rpId,
    origin
  };
}

function getRequestWebAuthnConfig(req, rpName) {
  if (!req) return null;

  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get?.('host') || '';

  if (!host) return null;

  const parsedOrigin = parseOrigin(`${protocol}://${host}`);
  if (!parsedOrigin) return null;

  return {
    rpName,
    rpId: normalizeRpId(parsedOrigin.hostname),
    origin: parsedOrigin.origin
  };
}

function shouldPreferRequestWebAuthnConfig(configured, requestBased) {
  if (!requestBased) return false;
  if (!configured.origin || !configured.rpId) return true;

  const configuredOrigin = parseOrigin(configured.origin);
  const requestOrigin = parseOrigin(requestBased.origin);
  if (!configuredOrigin || !requestOrigin) return true;

  if (isLocalHostname(configured.rpId) && !isLocalHostname(requestBased.rpId)) {
    return true;
  }

  return configuredOrigin.hostname === requestOrigin.hostname
    && configuredOrigin.protocol === 'http:'
    && requestOrigin.protocol === 'https:';
}

function getWebAuthnConfig(req = null) {
  const configured = getConfiguredWebAuthnConfig();
  const requestBased = getRequestWebAuthnConfig(req, configured.rpName);

  if (shouldPreferRequestWebAuthnConfig(configured, requestBased)) {
    return requestBased;
  }

  return configured;
}

function assertWebAuthnConfig(req = null) {
  const webauthn = getWebAuthnConfig(req);
  if (!webauthn.rpId || !webauthn.origin) {
    throw Object.assign(new Error('Configuration WebAuthn incomplète: rpId et origin sont requis'), { status: 400 });
  }
  return webauthn;
}

function toBase64Url(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  return Buffer.from(value).toString('base64url');
}

function encodeUtf8ToBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

// SQLite stocke les tableaux en JSON string — helper de désérialisation
function parseJsonField(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function isSqliteDatabase() {
  return String(config.database?.url || '').startsWith('file:');
}

function normalizeTransportsForStorage(value) {
  const transports = Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim())
    : [];

  return isSqliteDatabase() ? JSON.stringify(transports) : transports;
}

// ── Helpers JWT ──────────────────────────────────────────────────────────────

function generateAccessToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpires }
  );
}

async function generateRefreshToken(userId) {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7j

  await prisma.refreshToken.create({
    data: { userId, token, expiresAt }
  });

  return token;
}

function setAuthCookies(res, accessToken, refreshToken) {
  const isProd = config.env === 'production';

  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000 // 15 min
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7j
    path: '/api/auth/refresh'
  });
}

function clearAuthCookies(res) {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
}

// ── Authentification par mot de passe ────────────────────────────────────────

async function loginWithPassword(email, password) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive || !user.passwordHash) {
    throw Object.assign(new Error('Email ou mot de passe incorrect'), { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Email ou mot de passe incorrect'), { status: 401 });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshToken(user.id);

  return { user: sanitizeUser(user), accessToken, refreshToken };
}

async function refreshAccessToken(refreshTokenValue) {
  const record = await prisma.refreshToken.findUnique({
    where: { token: refreshTokenValue },
    include: { user: true }
  });

  if (!record || record.expiresAt < new Date() || !record.user.isActive) {
    throw Object.assign(new Error('Refresh token invalide ou expiré'), { status: 401 });
  }

  // Rotation du refresh token
  await prisma.refreshToken.deleteMany({ where: { id: record.id } });
  const newRefreshToken = await generateRefreshToken(record.userId);
  const accessToken = generateAccessToken(record.user);

  return { accessToken, refreshToken: newRefreshToken };
}

// ── WebAuthn / Passkeys ───────────────────────────────────────────────────────

async function beginPasskeyRegistration(user, req = null) {
  const webauthn = assertWebAuthnConfig(req);
  const existingPasskeys = await prisma.passkey.findMany({
    where: { userId: user.id }
  });

  const options = await generateRegistrationOptions({
    rpName: webauthn.rpName,
    rpID: webauthn.rpId,
    userID: encodeUtf8ToBase64Url(user.id),
    userName: String(user.email || '').trim() || `user-${user.id}`,
    userDisplayName: String(user.name || user.email || '').trim() || 'Utilisateur',
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(pk => ({
      id: toBase64Url(pk.credentialId),
      type: 'public-key',
      transports: parseJsonField(pk.transports)
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform'
    }
  });

  return options;
}

async function finishPasskeyRegistration(user, response, challenge, passkeyName, req = null) {
  const webauthn = assertWebAuthnConfig(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: webauthn.origin,
      expectedRPID: webauthn.rpId,
      requireUserVerification: false
    });
  } catch (err) {
    throw Object.assign(new Error(`Vérification WebAuthn échouée: ${err.message}`), { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('Enregistrement WebAuthn non vérifié'), { status: 400 });
  }

  const {
    credentialID,
    credentialPublicKey,
    counter,
    credentialDeviceType,
    credentialBackedUp,
  } = verification.registrationInfo;

  const passkey = await prisma.passkey.create({
    data: {
      userId: user.id,
      credentialId: toBase64Url(credentialID),
      publicKey: Buffer.from(credentialPublicKey),
      counter: BigInt(counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: normalizeTransportsForStorage(response.response?.transports),
      name: passkeyName || `Clé ${new Date().toLocaleDateString('fr-FR')}`
    }
  });

  return passkey;
}

async function beginPasskeyLogin(email, req = null) {
  const webauthn = assertWebAuthnConfig(req);
  let user = null;
  let allowCredentials = [];

  if (email) {
    user = await prisma.user.findUnique({
      where: { email },
      include: { passkeys: true }
    });

    if (user) {
      allowCredentials = user.passkeys.map(pk => ({
        id: pk.credentialId,
        type: 'public-key',
        transports: parseJsonField(pk.transports)
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: webauthn.rpId,
    userVerification: 'preferred',
    allowCredentials
  });

  return { options, userId: user?.id };
}

async function finishPasskeyLogin(response, challenge, userId, req = null) {
  const webauthn = assertWebAuthnConfig(req);
  // Trouver la passkey par credentialId
  const credentialId = toBase64Url(response.id);
  const passkey = await prisma.passkey.findUnique({
    where: { credentialId },
    include: { user: true }
  });

  if (!passkey) {
    throw Object.assign(new Error('Passkey introuvable'), { status: 401 });
  }

  if (!passkey.user.isActive) {
    throw Object.assign(new Error('Compte désactivé'), { status: 401 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: webauthn.origin,
      expectedRPID: webauthn.rpId,
      authenticator: {
        credentialID: passkey.credentialId,
        credentialPublicKey: passkey.publicKey,
        counter: Number(passkey.counter),
        transports: parseJsonField(passkey.transports)
      },
      requireUserVerification: false
    });
  } catch (err) {
    throw Object.assign(new Error(`Authentification WebAuthn échouée: ${err.message}`), { status: 401 });
  }

  if (!verification.verified) {
    throw Object.assign(new Error('Authentification WebAuthn non vérifiée'), { status: 401 });
  }

  // Mettre à jour le counter
  await prisma.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date()
    }
  });

  const { user } = passkey;
  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshToken(user.id);

  return { user: sanitizeUser(user), accessToken, refreshToken };
}

// ── Utils ────────────────────────────────────────────────────────────────────

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (user.passwordHash) {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw Object.assign(new Error('Mot de passe actuel incorrect'), { status: 400 });
    }
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hash }
  });
}

module.exports = {
  loginWithPassword,
  refreshAccessToken,
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  beginPasskeyLogin,
  finishPasskeyLogin,
  generateAccessToken,
  generateRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  sanitizeUser,
  changePassword
};
