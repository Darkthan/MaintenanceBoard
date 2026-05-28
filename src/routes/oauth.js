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

// ── Validation redirect_uri ─────────────────────────────────────────────────
function isValidRedirectUri(uri) {
  if (!uri) return false;
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// ── GET /oauth/client-info?client_id=xxx ────────────────────────────────────
// Endpoint public : label + scopes d'un McpToken (sans secret).
// Utilisé par la page de consentement pour afficher le nom de l'application.
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
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// ── GET /oauth/authorize ────────────────────────────────────────────────────
// Valide les paramètres OAuth2 et sert la page de consentement.
router.get('/authorize', (req, res) => {
  const { response_type, client_id, redirect_uri, code_challenge_method } = req.query;

  if (response_type !== 'code') {
    return res.status(400).send('response_type doit être "code".');
  }
  if (!client_id) {
    return res.status(400).send('client_id manquant.');
  }
  if (!isValidRedirectUri(redirect_uri)) {
    return res.status(400).send('redirect_uri invalide ou manquant (doit être https:// ou localhost).');
  }
  if (code_challenge_method && code_challenge_method !== 'S256') {
    return res.status(400).send('Seul S256 est supporté pour code_challenge_method.');
  }

  res.sendFile(path.join(__dirname, '../../public/oauth-authorize.html'));
});

// ── POST /oauth/authorize ───────────────────────────────────────────────────
// Traite la soumission du formulaire de consentement.
router.post('/authorize', authorizeLimiter, async (req, res) => {
  const {
    client_id, redirect_uri, scope, state,
    code_challenge, code_challenge_method,
    email, password, action
  } = req.body;

  function redirectError(error, description) {
    if (!isValidRedirectUri(redirect_uri)) {
      return res.status(400).send('redirect_uri invalide : ' + error);
    }
    const url = new URL(redirect_uri);
    url.searchParams.set('error', error);
    if (description) url.searchParams.set('error_description', description);
    if (state) url.searchParams.set('state', state);
    return res.redirect(url.toString());
  }

  if (!client_id || !isValidRedirectUri(redirect_uri)) {
    return res.status(400).send('Paramètres OAuth2 invalides.');
  }
  if (action !== 'approve') {
    return redirectError('access_denied', "Accès refusé par l'utilisateur");
  }
  if (!email || !password) {
    return redirectError('invalid_request', 'Identifiants manquants');
  }

  try {
    // Vérifier le client (McpToken)
    const mcpToken = await prisma.mcpToken.findUnique({ where: { id: String(client_id) } });
    if (!mcpToken || !isMcpTokenUsable(mcpToken)) {
      return redirectError('invalid_client', 'Client invalide ou révoqué');
    }

    // Vérifier les identifiants MaintenanceBoard
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user || !user.isActive || !user.password) {
      return redirectError('access_denied', 'Identifiants invalides');
    }
    const passwordOk = await bcrypt.compare(String(password), user.password);
    if (!passwordOk) {
      return redirectError('access_denied', 'Identifiants invalides');
    }

    // Scopes accordés = intersection(demandés, autorisés par le token)
    const allowedScopes = parseScopes(mcpToken.scopes);
    const requestedScopes = scope ? scope.split(' ').filter(Boolean) : allowedScopes;
    const grantedScopes = requestedScopes.filter(s => allowedScopes.includes(s));
    if (!grantedScopes.length) {
      return redirectError('invalid_scope', 'Aucun scope valide accordé');
    }

    // Générer et stocker le code d'autorisation
    const code = generateCode();
    storeCode(code, {
      userId: user.id,
      mcpTokenId: mcpToken.id,
      scopes: grantedScopes,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || null
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

// ── POST /oauth/token ───────────────────────────────────────────────────────
router.post('/token', tokenLimiter, async (req, res) => {
  try {
    // Extraire les identifiants client (Basic Auth ou body)
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

    // ── Authorization Code ─────────────────────────────────────────────────
    if (grantType === 'authorization_code') {
      const { code, redirect_uri, code_verifier } = req.body;
      if (!code) return oauthError(res, 'invalid_request', 'code manquant');

      const codeData = consumeCode(code);
      if (!codeData) return oauthError(res, 'invalid_grant', 'Code invalide ou expiré');

      if (redirect_uri && redirect_uri !== codeData.redirectUri) {
        return oauthError(res, 'invalid_grant', 'redirect_uri ne correspond pas');
      }

      // Vérification PKCE (obligatoire si code_challenge était présent)
      if (codeData.codeChallenge) {
        if (!code_verifier) return oauthError(res, 'invalid_request', 'code_verifier manquant');
        const expected = crypto.createHash('sha256').update(code_verifier).digest('base64url');
        if (expected !== codeData.codeChallenge) {
          return oauthError(res, 'invalid_grant', 'code_verifier invalide (PKCE)');
        }
      }

      // Vérifier que McpToken et utilisateur sont toujours actifs
      const [mcpToken, user] = await Promise.all([
        prisma.mcpToken.findUnique({ where: { id: codeData.mcpTokenId } }),
        prisma.user.findUnique({ where: { id: codeData.userId }, select: { id: true, isActive: true } })
      ]);
      if (!mcpToken || !isMcpTokenUsable(mcpToken)) return oauthError(res, 'invalid_client', 'Client révoqué');
      if (!user || !user.isActive) return oauthError(res, 'access_denied', 'Compte utilisateur désactivé');

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

    // ── Client Credentials ─────────────────────────────────────────────────
    if (grantType === 'client_credentials') {
      if (!clientId || !clientSecret) {
        return oauthError(res, 'invalid_client', 'client_id et client_secret sont obligatoires');
      }

      const record = await prisma.mcpToken.findUnique({
        where: { id: String(clientId) },
        include: { createdBy: { select: { id: true, isActive: true } } }
      });

      // Comparaison en temps constant (protection timing attack)
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

module.exports = router;
