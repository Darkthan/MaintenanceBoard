const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const config = require('../config');
const {
  ALL_MCP_SCOPES,
  DIRECT_MCP_CLIENT_ID,
  DYNAMIC_MCP_CLIENT_PREFIX,
  hashMcpToken,
  isDirectMcpClientId,
  isMcpTokenUsable,
  parseScopes,
  filterScopesForUser,
  getUserMcpScopes
} = require('../utils/mcpTokens');
const { generateCode, storeCode, consumeCode } = require('../lib/oauthCodes');

const router = express.Router();

const MCP_ACCESS_TOKEN_EXPIRES_IN = 86400; // 24 heures
const MCP_REFRESH_TOKEN_EXPIRES_DAYS = 365;
const OFFLINE_ACCESS_SCOPE = 'offline_access';
const OAUTH_CSRF_COOKIE = 'oauthCsrf';
const OAUTH_CSRF_EXPIRES_IN = 600; // 10 minutes
const DIRECT_MCP_CLIENT_LABEL = 'MaintenanceBoard MCP';
const dynamicOAuthClients = new Map();

const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded', error_description: 'Trop de tentatives, réessayez dans 15 minutes.' }
});

const authorizeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'rate_limit_exceeded', error_description: 'Trop de tentatives.' }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseRedirectUris(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(u => typeof u === 'string' && u.length > 0) : [];
  } catch { return []; }
}

/** Vérifie que la redirect_uri est dans la liste enregistrée du client (exact match). */
function isRegisteredUri(registered, uri) {
  return Array.isArray(registered) && registered.includes(uri);
}

/** Valide le format d'une redirect_uri candidate (utilisé à l'enregistrement). */
function isValidRedirectUriFormat(uri) {
  if (!uri) return false;
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1';
  } catch { return false; }
}

function signMcpUserAccessToken({ userId, mcpTokenId, clientId, scopes }) {
  return jwt.sign(
    { sub: userId, type: 'mcp_user_access', scopes, mcpTokenId, clientId },
    config.jwt.secret,
    { expiresIn: MCP_ACCESS_TOKEN_EXPIRES_IN }
  );
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

async function storeRefreshToken({ userId, mcpTokenId, clientId, scopes }) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + MCP_REFRESH_TOKEN_EXPIRES_DAYS * 86400 * 1000);
  await prisma.mcpRefreshToken.create({
    data: {
      tokenHash: hashRefreshToken(token),
      userId,
      mcpTokenId: mcpTokenId || null,
      clientId,
      scopes: JSON.stringify(scopes),
      expiresAt
    }
  });
  return token;
}

function accessTokenResponse({ accessToken, scopes, refreshToken }) {
  const body = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: MCP_ACCESS_TOKEN_EXPIRES_IN,
    scope: scopes.join(' ')
  };
  if (refreshToken) body.refresh_token = refreshToken;
  return body;
}

function signOAuthCsrfToken({ clientId, redirectUri, codeChallenge }) {
  return jwt.sign(
    {
      type: 'oauth_authorize_csrf',
      clientId,
      redirectUri,
      codeChallenge
    },
    config.jwt.secret,
    { expiresIn: OAUTH_CSRF_EXPIRES_IN }
  );
}

function setOAuthCsrfCookie(res, token) {
  res.cookie(OAUTH_CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: OAUTH_CSRF_EXPIRES_IN * 1000,
    path: '/oauth/authorize'
  });
}

function clearOAuthCsrfCookie(res) {
  res.clearCookie(OAUTH_CSRF_COOKIE, { path: '/oauth/authorize' });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sendAuthorizePage(res, csrfToken) {
  const filePath = path.join(__dirname, '../../public/oauth-authorize.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Erreur interne.');
    const meta = `  <meta name="oauth-csrf" content="${escapeHtml(csrfToken)}" />\n`;
    res.type('html').send(html.replace('</head>', `${meta}</head>`));
  });
}

async function userFromAccessCookie(req) {
  const token = req.cookies?.accessToken;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (!payload?.userId) return null;
    return prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, isActive: true }
    });
  } catch {
    return null;
  }
}

function verifyOAuthCsrf(req, { clientId, redirectUri, codeChallenge }) {
  const bodyToken = req.body.oauth_csrf;
  const cookieToken = req.cookies?.[OAUTH_CSRF_COOKIE];
  if (!bodyToken) {
    return false;
  }
  if (cookieToken && bodyToken !== cookieToken) {
    return false;
  }
  try {
    const payload = jwt.verify(bodyToken, config.jwt.secret);
    return payload.type === 'oauth_authorize_csrf' &&
      payload.clientId === clientId &&
      payload.redirectUri === redirectUri &&
      payload.codeChallenge === codeChallenge;
  } catch {
    return false;
  }
}

function normalizeClientId(clientId) {
  return String(clientId || DIRECT_MCP_CLIENT_ID);
}

function publicClientRecord(clientId, record) {
  return {
    type: 'direct',
    id: clientId,
    label: record?.clientName || DIRECT_MCP_CLIENT_LABEL,
    scopes: ALL_MCP_SCOPES,
    redirectUris: record?.redirectUris || null
  };
}

async function resolveOAuthClient(clientId) {
  const id = normalizeClientId(clientId);
  if (isDirectMcpClientId(id)) {
    return publicClientRecord(id, dynamicOAuthClients.get(id));
  }

  const mcpToken = await prisma.mcpToken.findUnique({ where: { id } });
  if (!mcpToken || !isMcpTokenUsable(mcpToken)) return null;

  return {
    type: 'mcpToken',
    id: mcpToken.id,
    label: mcpToken.label,
    scopes: parseScopes(mcpToken.scopes),
    redirectUris: parseRedirectUris(mcpToken.redirectUris),
    token: mcpToken
  };
}

function isRedirectAllowedForClient(client, redirectUri) {
  if (!redirectUri || !isValidRedirectUriFormat(redirectUri)) return false;
  if (client.type === 'direct' && !client.redirectUris) return true;
  return isRegisteredUri(client.redirectUris, redirectUri);
}

function dynamicClientResponse(client, req) {
  const now = Math.floor(Date.now() / 1000);
  return {
    client_id: client.id,
    client_name: client.label,
    redirect_uris: client.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: ALL_MCP_SCOPES.join(' '),
    client_id_issued_at: now,
    registration_client_uri: `${config.appUrl.replace(/\/$/, '')}/oauth/register/${encodeURIComponent(client.id)}`
  };
}

// OAuth 2.0 Dynamic Client Registration minimal pour les clients MCP publics.
router.post('/register', (req, res) => {
  const redirectUris = Array.isArray(req.body.redirect_uris)
    ? [...new Set(req.body.redirect_uris.map(uri => String(uri || '').trim()).filter(isValidRedirectUriFormat))]
    : [];

  if (!redirectUris.length) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris doit contenir au moins une URL https:// ou localhost valide.' });
  }

  const client = {
    id: `${DYNAMIC_MCP_CLIENT_PREFIX}${crypto.randomBytes(16).toString('base64url')}`,
    label: String(req.body.client_name || DIRECT_MCP_CLIENT_LABEL).trim().slice(0, 200) || DIRECT_MCP_CLIENT_LABEL,
    redirectUris
  };
  dynamicOAuthClients.set(client.id, client);
  res.status(201).json(dynamicClientResponse(client, req));
});

router.get('/register/:clientId', (req, res) => {
  const client = dynamicOAuthClients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'invalid_client', error_description: 'Client dynamique inconnu ou expiré.' });
  res.json(dynamicClientResponse(client, req));
});

// ── GET /oauth/client-info?client_id=xxx ────────────────────────────────────
// Endpoint public : label + scopes d'un McpToken (sans secret, sans redirectUris).
router.get('/client-info', async (req, res) => {
  const clientId = normalizeClientId(req.query.client_id);
  try {
    const client = await resolveOAuthClient(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client non trouvé ou inactif' });
    }
    res.json({ label: client.label, scopes: client.scopes });
  } catch {
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// ── GET /oauth/authorize ─────────────────────────────────────────────────────
// Valide les paramètres et sert la page de consentement.
// SÉCURITÉ : redirect_uri validée contre la liste enregistrée AVANT toute réponse.
//            PKCE (code_challenge S256) obligatoire.
router.get('/authorize', async (req, res) => {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method } = req.query;
  const clientId = normalizeClientId(client_id);

  if (response_type !== 'code') {
    return res.status(400).send('response_type doit être "code".');
  }

  // PKCE obligatoire — rejeté ici pour ne pas avoir à le gérer dans le POST
  if (!code_challenge) {
    return res.status(400).send('PKCE obligatoire : code_challenge manquant.');
  }
  if (code_challenge_method !== 'S256') {
    return res.status(400).send('Seul S256 est supporté pour code_challenge_method.');
  }

  // Résoudre le client et valider la redirect_uri AVANT de servir la page
  // (ne jamais rediriger vers une URI non enregistrée, même pour signaler une erreur)
  let client;
  try {
    client = await resolveOAuthClient(clientId);
  } catch {
    return res.status(500).send('Erreur interne.');
  }

  if (!client) {
    return res.status(400).send('Client OAuth invalide ou inactif.');
  }

  if (!isRedirectAllowedForClient(client, redirect_uri)) {
    // Ne pas rediriger — afficher une page d'erreur avec l'URI tentée (pour que l'admin sache quoi ajouter)
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return res.status(400).send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autorisation refusée – MaintenanceBoard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
  .card{width:100%;max-width:560px;background:#fff;border-radius:1rem;border:1px solid #e2e8f0;overflow:hidden}
  .banner{background:#fffbeb;border-bottom:1px solid #fde68a;padding:1.25rem 1.5rem;display:flex;gap:.75rem;align-items:flex-start}
  .banner svg{flex-shrink:0;margin-top:.125rem}
  .banner-title{font-weight:600;color:#78350f;margin-bottom:.25rem}
  .banner-desc{font-size:.875rem;color:#92400e}
  .body{padding:1.5rem;display:flex;flex-direction:column;gap:1.25rem}
  .label{font-size:.7rem;font-weight:700;letter-spacing:.075em;text-transform:uppercase;color:#64748b;margin-bottom:.5rem}
  .uri-row{display:flex;gap:.5rem;align-items:stretch}
  code{flex:1;font-family:monospace;font-size:.8125rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;padding:.625rem .75rem;color:#1e293b;word-break:break-all;display:block}
  button{flex-shrink:0;padding:.625rem .875rem;background:#1e293b;color:#fff;border:none;border-radius:.5rem;font-size:.8125rem;cursor:pointer}
  button:hover{background:#334155}
  ol{font-size:.875rem;color:#475569;padding-left:1.25rem;line-height:1.75}
  ol li strong,ol li em{color:#1e293b}
  .btn-link{display:inline-block;padding:.625rem 1rem;background:#4f46e5;color:#fff;border-radius:.5rem;font-size:.875rem;font-weight:500;text-decoration:none}
  .btn-link:hover{background:#4338ca}
</style></head>
<body>
<div class="card">
  <div class="banner">
    <svg width="20" height="20" fill="none" stroke="#d97706" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
    </svg>
    <div>
      <p class="banner-title">Redirect URI non enregistrée</p>
      <p class="banner-desc">Le client <strong>${esc(client.label)}</strong> n'est pas autorisé à utiliser cette URI de redirection.</p>
    </div>
  </div>
  <div class="body">
    <div>
      <p class="label">URI tentée — à ajouter dans Paramètres → Tokens MCP</p>
      <div class="uri-row">
        <code id="uri-val">${esc(redirect_uri)}</code>
        <button onclick="navigator.clipboard.writeText(document.getElementById('uri-val').textContent).then(()=>this.textContent='Copié ✓')">Copier</button>
      </div>
    </div>
    <ol>
      <li>Allez dans <strong>Paramètres → Tokens MCP</strong></li>
      <li>Cliquez sur <strong>URIs</strong> à côté du token <em>${esc(client.label)}</em></li>
      <li>Collez l'URI ci-dessus et enregistrez</li>
      <li>Relancez la connexion depuis votre LLM</li>
    </ol>
    <a href="/settings.html?tab=mcp&amp;openUris=${esc(String(clientId))}&amp;addUri=${encodeURIComponent(redirect_uri)}" class="btn-link">Ajouter cette URI et continuer →</a>
  </div>
</div>
</body></html>`);
  }

  const currentUser = await userFromAccessCookie(req);
  if (!currentUser?.isActive) {
    const next = req.originalUrl || `/oauth/authorize?${new URLSearchParams(req.query).toString()}`;
    return res.redirect(`/login.html?next=${encodeURIComponent(next)}`);
  }

  const csrfToken = signOAuthCsrfToken({
    clientId,
    redirectUri: String(redirect_uri),
    codeChallenge: String(code_challenge)
  });
  setOAuthCsrfCookie(res, csrfToken);
  sendAuthorizePage(res, csrfToken);
});

// ── POST /oauth/authorize ────────────────────────────────────────────────────
// Traite la soumission du formulaire de consentement.
// SÉCURITÉ : redirect_uri validée avant tout redirect, même en cas d'erreur.
router.post('/authorize', authorizeLimiter, async (req, res) => {
  const {
    client_id, redirect_uri, scope, state,
    code_challenge, code_challenge_method,
    email, password, action
  } = req.body;
  const clientId = normalizeClientId(client_id);

  // ── 1. Valider client et redirect_uri EN PREMIER (avant tout redirect) ──────
  let client;
  try {
    client = await resolveOAuthClient(clientId);
  } catch {
    return res.status(500).send('Erreur interne.');
  }

  if (!client || !isRedirectAllowedForClient(client, redirect_uri)) {
    // Erreur de configuration : afficher une page, ne pas rediriger
    return res.status(400).send('Paramètres OAuth2 invalides (client ou redirect_uri non enregistrée).');
  }

  // ── 2. À partir d'ici redirect_uri est de confiance — on peut rediriger ──────
  function redirectError(error, description) {
    const url = new URL(redirect_uri);
    url.searchParams.set('error', error);
    if (description) url.searchParams.set('error_description', description);
    if (state) url.searchParams.set('state', state);
    return res.redirect(url.toString());
  }

  // PKCE obligatoire
  if (!code_challenge || code_challenge_method !== 'S256') {
    return redirectError('invalid_request', 'PKCE S256 obligatoire');
  }

  if (action !== 'approve') {
    return redirectError('access_denied', "Accès refusé par l'utilisateur");
  }

  let user;
  try {
    if (req.body.use_session === 'true') {
      // Anti-CSRF compatible WebViews : Origin peut être absent ou "null" dans
      // l'application ChatGPT. On vérifie plutôt un double-submit token signé,
      // lié au client, à la redirect_uri déjà enregistrée et au challenge PKCE.
      if (!verifyOAuthCsrf(req, {
        clientId,
        redirectUri: String(redirect_uri),
        codeChallenge: String(code_challenge)
      })) {
        return redirectError('access_denied', 'Jeton de session OAuth invalide ou expiré');
      }

      // Mode session : authentification via le cookie JWT existant
      const sessionToken = req.cookies?.accessToken;
      if (!sessionToken) return redirectError('access_denied', 'Session expirée, reconnectez-vous');
      let payload;
      try { payload = jwt.verify(sessionToken, config.jwt.secret); }
      catch { return redirectError('access_denied', 'Session expirée'); }
      user = await prisma.user.findUnique({ where: { id: payload.userId } });
    } else {
      // Mode login : email + mot de passe
      if (!email || !password) return redirectError('invalid_request', 'Identifiants manquants');
      user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
      if (!user || !user.isActive || !user.password) return redirectError('access_denied', 'Identifiants invalides');
      const passwordOk = await bcrypt.compare(String(password), user.password);
      if (!passwordOk) return redirectError('access_denied', 'Identifiants invalides');
    }

    if (!user || !user.isActive) return redirectError('access_denied', 'Compte inactif');

    // Scopes accordés = intersection(demandés, autorisés client, autorisés rôle, sélectionnés par l'utilisateur)
    const clientAllowedScopes = client.scopes;
    const userAllowedScopes = filterScopesForUser(clientAllowedScopes, user);
    const requestedScopes = scope ? scope.split(' ').filter(Boolean) : userAllowedScopes;
    const issueRefreshToken = requestedScopes.includes(OFFLINE_ACCESS_SCOPE);

    // Scopes cochés par l'utilisateur sur la page de consentement
    const userChecked = req.body.granted_scopes
      ? (Array.isArray(req.body.granted_scopes) ? req.body.granted_scopes : [req.body.granted_scopes])
      : null;

    const grantedScopes = requestedScopes.filter(s =>
      userAllowedScopes.includes(s) &&
      (userChecked === null || userChecked.includes(s))
    );
    if (!grantedScopes.length) {
      return redirectError('invalid_scope', 'Aucun scope valide accordé');
    }

    const code = generateCode();
    storeCode(code, {
      userId: user.id,
      mcpTokenId: client.type === 'mcpToken' ? client.id : null,
      clientId: client.id,
      clientType: client.type,
      scopes: grantedScopes,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,        // toujours présent (PKCE obligatoire)
      codeChallengeMethod: code_challenge_method,
      issueRefreshToken
    });

    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    clearOAuthCsrfCookie(res);
    return res.redirect(url.toString());
  } catch (err) {
    console.error('OAuth /authorize POST error:', err);
    return redirectError('server_error', 'Erreur interne');
  }
});

// ── POST /oauth/token ────────────────────────────────────────────────────────
router.post('/token', tokenLimiter, async (req, res) => {
  try {
    let clientId, clientSecret;
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep < 0) return oauthError(res, 'invalid_client', 'En-tête Basic invalide');
      clientId = decoded.slice(0, sep);
      clientSecret = decoded.slice(sep + 1);
    } else {
      clientId = req.body.client_id;
      clientSecret = req.body.client_secret;
    }

    const grantType = req.body.grant_type;

    // ── Authorization Code ───────────────────────────────────────────────────
    if (grantType === 'authorization_code') {
      const { code, redirect_uri, code_verifier } = req.body;
      if (!code) return oauthError(res, 'invalid_request', 'code manquant');

      const codeData = consumeCode(code);
      if (!codeData) return oauthError(res, 'invalid_grant', 'Code invalide ou expiré');

      if (redirect_uri && redirect_uri !== codeData.redirectUri) {
        return oauthError(res, 'invalid_grant', 'redirect_uri ne correspond pas');
      }

      // PKCE obligatoire — le code a forcément un codeChallenge (enforced au GET /authorize)
      if (!code_verifier) {
        return oauthError(res, 'invalid_request', 'code_verifier manquant (PKCE obligatoire)');
      }
      if (!codeData.codeChallenge) {
        // Ne devrait pas arriver (PKCE enforced au GET), mais défense en profondeur
        return oauthError(res, 'invalid_grant', 'Code émis sans PKCE — rejeté');
      }
      const expected = crypto.createHash('sha256').update(code_verifier).digest('base64url');
      if (expected !== codeData.codeChallenge) {
        return oauthError(res, 'invalid_grant', 'code_verifier invalide (PKCE)');
      }

      const isTokenClient = codeData.clientType === 'mcpToken' || !!codeData.mcpTokenId;
      const userSelect = { id: true, role: true, isActive: true };
      const [mcpToken, user] = await Promise.all([
        isTokenClient
          ? prisma.mcpToken.findUnique({ where: { id: codeData.mcpTokenId } })
          : Promise.resolve(null),
        prisma.user.findUnique({ where: { id: codeData.userId }, select: userSelect })
      ]);
      if (isTokenClient && (!mcpToken || !isMcpTokenUsable(mcpToken))) {
        return oauthError(res, 'invalid_client', 'Client révoqué');
      }
      if (!user || !user.isActive) return oauthError(res, 'access_denied', 'Compte désactivé');

      const scopes = filterScopesForUser(codeData.scopes, user);
      if (!scopes.length) return oauthError(res, 'invalid_scope', 'Aucun scope valide accordé');

      const accessToken = signMcpUserAccessToken({
        userId: codeData.userId,
        mcpTokenId: codeData.mcpTokenId,
        clientId: codeData.clientId,
        scopes
      });
      const refreshToken = codeData.issueRefreshToken
        ? await storeRefreshToken({
            userId: codeData.userId,
            mcpTokenId: codeData.mcpTokenId,
            clientId: codeData.clientId,
            scopes
          })
        : null;

      if (codeData.mcpTokenId) {
        prisma.mcpToken.update({ where: { id: codeData.mcpTokenId }, data: { lastUsedAt: new Date() } }).catch(() => {});
      }

      return res.json(accessTokenResponse({ accessToken, scopes, refreshToken }));
    }

    // ── Refresh Token ───────────────────────────────────────────────────────
    if (grantType === 'refresh_token') {
      const refreshTokenValue = req.body.refresh_token;
      if (!refreshTokenValue) return oauthError(res, 'invalid_request', 'refresh_token manquant');

      const tokenRecord = await prisma.mcpRefreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(refreshTokenValue) },
        include: {
          user: { select: { id: true, role: true, isActive: true } },
          mcpToken: true
        }
      });

      if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
        return oauthError(res, 'invalid_grant', 'refresh_token invalide ou expiré');
      }

      const { user, mcpToken } = tokenRecord;
      const directClient = isDirectMcpClientId(tokenRecord.clientId);

      if (!directClient && (!mcpToken || !isMcpTokenUsable(mcpToken))) {
        return oauthError(res, 'invalid_client', 'Client révoqué ou expiré');
      }
      if (!user || !user.isActive) return oauthError(res, 'access_denied', 'Compte désactivé');

      const clientAllowedScopes = directClient ? ALL_MCP_SCOPES : parseScopes(mcpToken.scopes);
      const roleAllowedScopes = filterScopesForUser(clientAllowedScopes, user);
      const storedScopes = parseScopes(tokenRecord.scopes);
      const scopes = storedScopes.filter(s => roleAllowedScopes.includes(s));
      if (!scopes.length) return oauthError(res, 'invalid_scope', 'Aucun scope valide accordé');

      // Rotation : supprimer l'ancien token, créer le nouveau
      const newRefreshToken = crypto.randomBytes(48).toString('base64url');
      const newExpiresAt = new Date(Date.now() + MCP_REFRESH_TOKEN_EXPIRES_DAYS * 86400 * 1000);

      await prisma.$transaction([
        prisma.mcpRefreshToken.delete({ where: { id: tokenRecord.id } }),
        prisma.mcpRefreshToken.create({
          data: {
            tokenHash: hashRefreshToken(newRefreshToken),
            userId: tokenRecord.userId,
            mcpTokenId: tokenRecord.mcpTokenId,
            clientId: tokenRecord.clientId,
            scopes: JSON.stringify(scopes),
            expiresAt: newExpiresAt
          }
        })
      ]);

      const accessToken = signMcpUserAccessToken({
        userId: tokenRecord.userId,
        mcpTokenId: tokenRecord.mcpTokenId,
        clientId: tokenRecord.clientId,
        scopes
      });

      if (tokenRecord.mcpTokenId) {
        prisma.mcpToken.update({ where: { id: tokenRecord.mcpTokenId }, data: { lastUsedAt: new Date() } }).catch(() => {});
      }

      return res.json(accessTokenResponse({ accessToken, scopes, refreshToken: newRefreshToken }));
    }

    // ── Client Credentials ───────────────────────────────────────────────────
    if (grantType === 'client_credentials') {
      if (!clientId || !clientSecret) {
        return oauthError(res, 'invalid_client', 'client_id et client_secret sont obligatoires');
      }

      const record = await prisma.mcpToken.findUnique({
        where: { id: String(clientId) },
        include: { createdBy: { select: { id: true, isActive: true } } }
      });

      const actualHash = hashMcpToken(clientSecret);
      const hashMatch = record ? record.tokenHash === actualHash : false;

      if (!record || !hashMatch || !isMcpTokenUsable(record)) {
        return oauthError(res, 'invalid_client', 'Identifiants invalides, token révoqué ou expiré');
      }
      if (!record.createdBy?.isActive) {
        return oauthError(res, 'invalid_client', 'Compte propriétaire du token désactivé');
      }

      const scopes = parseScopes(record.scopes);
      const accessToken = jwt.sign(
        { sub: record.id, type: 'mcp_access', scopes, label: record.label },
        config.jwt.secret,
        { expiresIn: MCP_ACCESS_TOKEN_EXPIRES_IN }
      );

      prisma.mcpToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: MCP_ACCESS_TOKEN_EXPIRES_IN,
        scope: scopes.join(' ')
      });
    }

    return oauthError(res, 'unsupported_grant_type', 'Seuls authorization_code, refresh_token et client_credentials sont supportés');
  } catch (err) {
    console.error('OAuth /token error:', err);
    return oauthError(res, 'server_error', 'Erreur interne');
  }
});

function oauthError(res, error, description) {
  return res.status(400).json({ error, error_description: description });
}

module.exports = { router, isValidRedirectUriFormat, parseRedirectUris };
