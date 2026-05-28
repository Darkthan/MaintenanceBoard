const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const config = require('../config');
const { hashMcpToken, isMcpTokenUsable, parseScopes } = require('../utils/mcpTokens');

const router = express.Router();

// Durée des access tokens émis (en secondes)
const MCP_ACCESS_TOKEN_EXPIRES_IN = 900; // 15 minutes

// Rate limit strict anti-brute-force sur les secrets
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limit_exceeded',
    error_description: 'Trop de tentatives, réessayez dans 15 minutes.'
  }
});

/**
 * POST /oauth/token — Client Credentials (RFC 6749 §4.4)
 *
 * Authentification supportée :
 *   1. Basic Auth : Authorization: Basic base64(client_id:client_secret)
 *   2. Corps x-www-form-urlencoded : client_id + client_secret
 *
 * Le client_id est l'UUID du McpToken ; le client_secret est le token mcp_xxx
 * montré UNE SEULE FOIS à la création.
 *
 * Retourne un JWT court-vécu (15 min) utilisable comme Bearer sur POST /mcp.
 */
router.post('/token', oauthLimiter, async (req, res) => {
  try {
    // ── 1. Extraire les identifiants ────────────────────────────────────────────
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

    if (grantType !== 'client_credentials') {
      return oauthError(res, 'unsupported_grant_type', 'Seul client_credentials est supporté');
    }
    if (!clientId || !clientSecret) {
      return oauthError(res, 'invalid_client', 'client_id et client_secret sont obligatoires');
    }

    // ── 2. Résoudre le McpToken par ID ──────────────────────────────────────────
    const record = await prisma.mcpToken.findUnique({
      where: { id: String(clientId) },
      include: { createdBy: { select: { id: true, isActive: true } } }
    });

    // Comparaison en temps constant (protection timing attack) :
    // on hache toujours le secret fourni, même si le record n'existe pas.
    const actualHash = hashMcpToken(clientSecret);
    const hashMatch = record ? record.tokenHash === actualHash : false;

    if (!record || !hashMatch || !isMcpTokenUsable(record)) {
      return oauthError(res, 'invalid_client', 'Identifiants invalides, token révoqué ou expiré');
    }
    if (!record.createdBy?.isActive) {
      return oauthError(res, 'invalid_client', 'Compte propriétaire du token désactivé');
    }

    // ── 3. Émettre le JWT access token ──────────────────────────────────────────
    const scopes = parseScopes(record.scopes);

    const accessToken = jwt.sign(
      { sub: record.id, type: 'mcp_access', scopes, label: record.label },
      config.jwt.secret,
      { expiresIn: MCP_ACCESS_TOKEN_EXPIRES_IN }
    );

    // Mise à jour best-effort de lastUsedAt
    prisma.mcpToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => {});

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: MCP_ACCESS_TOKEN_EXPIRES_IN,
      scope: scopes.join(' ')
    });
  } catch (err) {
    console.error('OAuth /token error:', err);
    return oauthError(res, 'server_error', 'Erreur interne');
  }
});

function oauthError(res, error, description) {
  return res.status(400).json({ error, error_description: description });
}

module.exports = router;
