const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const config = require('../config');
const { hashMcpToken, isMcpTokenUsable, parseScopes } = require('../utils/mcpTokens');
const { generateCode, storeCode, consumeCode } = require('../lib/oauthCodes');

const router = express.Router();

const MCP_ACCESS_TOKEN_EXPIRES_IN = 900; // 15 minutes

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

// ── GET /oauth/client-info?client_id=xxx ────────────────────────────────────
// Endpoint public : label + scopes d'un McpToken (sans secret, sans redirectUris).
router.get('/client-info', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id manquant' });
  try {
    const record = await prisma.mcpToken.findUnique({
      where: { id: String(client_id) },
      select: { label: true, scopes: true, isActive: true, expiresAt: true }
    });
    if (!record || !isMcpTokenUsable(record)) {
      return res.status(404).json({ error: 'Client non trouvé ou inactif' });
    }
    res.json({ label: record.label, scopes: parseScopes(record.scopes) });
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

  if (response_type !== 'code') {
    return res.status(400).send('response_type doit être "code".');
  }
  if (!client_id) {
    return res.status(400).send('client_id manquant.');
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
  let mcpToken;
  try {
    mcpToken = await prisma.mcpToken.findUnique({
      where: { id: String(client_id) },
      select: { label: true, redirectUris: true, isActive: true, expiresAt: true }
    });
  } catch {
    return res.status(500).send('Erreur interne.');
  }

  if (!mcpToken || !isMcpTokenUsable(mcpToken)) {
    return res.status(400).send('Client OAuth invalide ou inactif.');
  }

  const registered = parseRedirectUris(mcpToken.redirectUris);
  if (!redirect_uri || !isRegisteredUri(registered, redirect_uri)) {
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
      <p class="banner-desc">Le client <strong>${esc(mcpToken.label)}</strong> n'est pas autorisé à utiliser cette URI de redirection.</p>
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
      <li>Cliquez sur <strong>URIs</strong> à côté du token <em>${esc(mcpToken.label)}</em></li>
      <li>Collez l'URI ci-dessus et enregistrez</li>
      <li>Relancez la connexion depuis votre LLM</li>
    </ol>
    <a href="/settings.html?tab=mcp&amp;openUris=${esc(String(client_id))}&amp;addUri=${encodeURIComponent(redirect_uri)}" class="btn-link">Ajouter cette URI et continuer →</a>
  </div>
</div>
</body></html>`);
  }

  res.sendFile(path.join(__dirname, '../../public/oauth-authorize.html'));
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

  // ── 1. Valider client et redirect_uri EN PREMIER (avant tout redirect) ──────
  let mcpToken;
  try {
    mcpToken = client_id
      ? await prisma.mcpToken.findUnique({ where: { id: String(client_id) } })
      : null;
  } catch {
    return res.status(500).send('Erreur interne.');
  }

  const registered = parseRedirectUris(mcpToken?.redirectUris);
  if (!mcpToken || !isMcpTokenUsable(mcpToken) || !redirect_uri || !isRegisteredUri(registered, redirect_uri)) {
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
      // Anti-CSRF : un POST légitime depuis notre page de consentement porte toujours
      // un header Origin égal à notre domaine. Un POST cross-site aura un Origin
      // différent — et le cookie SameSite=Lax n'est de toute façon pas envoyé
      // par les navigateurs modernes sur les requêtes cross-site POST.
      const requestOrigin = req.get('Origin') || req.get('Referer') || '';
      const expectedOrigin = config.appUrl.replace(/\/$/, '');
      if (!requestOrigin.startsWith(expectedOrigin)) {
        return redirectError('access_denied', 'Requête cross-site refusée');
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

    // Scopes accordés = intersection(demandés, autorisés par le token)
    const allowedScopes = parseScopes(mcpToken.scopes);
    const requestedScopes = scope ? scope.split(' ').filter(Boolean) : allowedScopes;
    const grantedScopes = requestedScopes.filter(s => allowedScopes.includes(s));
    if (!grantedScopes.length) {
      return redirectError('invalid_scope', 'Aucun scope valide accordé');
    }

    const code = generateCode();
    storeCode(code, {
      userId: user.id,
      mcpTokenId: mcpToken.id,
      scopes: grantedScopes,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,        // toujours présent (PKCE obligatoire)
      codeChallengeMethod: code_challenge_method
    });

    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
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

      const [mcpToken, user] = await Promise.all([
        prisma.mcpToken.findUnique({ where: { id: codeData.mcpTokenId } }),
        prisma.user.findUnique({ where: { id: codeData.userId }, select: { id: true, isActive: true } })
      ]);
      if (!mcpToken || !isMcpTokenUsable(mcpToken)) return oauthError(res, 'invalid_client', 'Client révoqué');
      if (!user || !user.isActive) return oauthError(res, 'access_denied', 'Compte désactivé');

      const accessToken = jwt.sign(
        { sub: codeData.userId, type: 'mcp_user_access', scopes: codeData.scopes, mcpTokenId: codeData.mcpTokenId },
        config.jwt.secret,
        { expiresIn: MCP_ACCESS_TOKEN_EXPIRES_IN }
      );

      prisma.mcpToken.update({ where: { id: codeData.mcpTokenId }, data: { lastUsedAt: new Date() } }).catch(() => {});

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: MCP_ACCESS_TOKEN_EXPIRES_IN,
        scope: codeData.scopes.join(' ')
      });
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

    return oauthError(res, 'unsupported_grant_type', 'Seuls authorization_code et client_credentials sont supportés');
  } catch (err) {
    console.error('OAuth /token error:', err);
    return oauthError(res, 'server_error', 'Erreur interne');
  }
});

function oauthError(res, error, description) {
  return res.status(400).json({ error, error_description: description });
}

module.exports = { router, isValidRedirectUriFormat, parseRedirectUris };
