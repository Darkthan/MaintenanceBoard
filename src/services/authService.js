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

function getWebAuthnConfig() {
  const s = readSettings().webauthn || {};
  return {
    rpName: s.rpName || config.webauthn?.rpName || 'MaintenanceBoard',
    rpId:   s.rpId   || config.webauthn?.rpId   || '',
    origin: s.origin || config.webauthn?.origin  || ''
  };
}

// SQLite stocke les tableaux en JSON string — helper de désérialisation
function parseJsonField(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
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
  await prisma.refreshToken.delete({ where: { id: record.id } });
  const newRefreshToken = await generateRefreshToken(record.userId);
  const accessToken = generateAccessToken(record.user);

  return { accessToken, refreshToken: newRefreshToken };
}

// ── WebAuthn / Passkeys ───────────────────────────────────────────────────────

async function beginPasskeyRegistration(user) {
  const existingPasskeys = await prisma.passkey.findMany({
    where: { userId: user.id }
  });

  const options = await generateRegistrationOptions({
    rpName: getWebAuthnConfig().rpName,
    rpID: getWebAuthnConfig().rpId,
    userID: Buffer.from(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(pk => ({
      id: pk.credentialId,
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

async function finishPasskeyRegistration(user, response, challenge, passkeyName) {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: getWebAuthnConfig().origin,
      expectedRPID: getWebAuthnConfig().rpId,
      requireUserVerification: false
    });
  } catch (err) {
    throw Object.assign(new Error(`Vérification WebAuthn échouée: ${err.message}`), { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('Enregistrement WebAuthn non vérifié'), { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const passkey = await prisma.passkey.create({
    data: {
      userId: user.id,
      credentialId: Buffer.from(credential.id).toString('base64url'),
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: JSON.stringify(response.response?.transports || []),
      name: passkeyName || `Clé ${new Date().toLocaleDateString('fr-FR')}`
    }
  });

  return passkey;
}

async function beginPasskeyLogin(email) {
  let user = null;
  let allowCredentials = [];

  if (email) {
    user = await prisma.user.findUnique({
      where: { email },
      include: { passkeys: true }
    });

    if (user) {
      allowCredentials = user.passkeys.map(pk => ({
        id: Buffer.from(pk.credentialId, 'base64url'),
        type: 'public-key',
        transports: parseJsonField(pk.transports)
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: getWebAuthnConfig().rpId,
    userVerification: 'preferred',
    allowCredentials
  });

  return { options, userId: user?.id };
}

async function finishPasskeyLogin(response, challenge, userId) {
  // Trouver la passkey par credentialId
  const credentialId = response.id;
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
      expectedOrigin: getWebAuthnConfig().origin,
      expectedRPID: getWebAuthnConfig().rpId,
      credential: {
        id: Buffer.from(passkey.credentialId, 'base64url'),
        publicKey: passkey.publicKey,
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
