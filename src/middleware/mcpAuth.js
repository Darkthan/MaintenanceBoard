const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../lib/prisma');
const { hashMcpToken, isMcpTokenUsable, parseScopes, hasScope } = require('../utils/mcpTokens');

// Émet un 401 conforme MCP/OAuth bearer (en-tête WWW-Authenticate).
function unauthorized(res, description) {
  res.set('WWW-Authenticate', `Bearer realm="MaintenanceBoard MCP", error="invalid_token"${description ? `, error_description="${description}"` : ''}`);
  return res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: description || 'Authentification MCP requise' },
    id: null
  });
}

/**
 * Authentifie une requête MCP. Deux modes supportés :
 *
 *   Mode 1 — Token natif (commence par "mcp_") :
 *     Lookup par SHA-256 en DB. Comportement historique, toujours supporté.
 *
 *   Mode 2 — JWT OAuth2 (émis par POST /oauth/token) :
 *     Vérification de signature JWT, puis lookup en DB pour contrôle de révocation.
 *
 * Attache req.mcpToken = { id, label, scopes, createdBy, authMethod } et met
 * à jour lastUsedAt en best-effort (non bloquant).
 */
async function mcpAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'Token Bearer manquant');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return unauthorized(res, 'Token Bearer vide');
    }

    if (token.startsWith('mcp_')) {
      return handleNativeToken(req, res, next, token);
    }
    return handleOAuthJwt(req, res, next, token);
  } catch (err) {
    next(err);
  }
}

// ── Mode 1 : token MCP natif ────────────────────────────────────────────────
async function handleNativeToken(req, res, next, token) {
  const record = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    include: { createdBy: { select: { id: true, name: true, email: true, role: true, isActive: true } } }
  });

  if (!record || !isMcpTokenUsable(record)) {
    return unauthorized(res, 'Token MCP invalide, révoqué ou expiré');
  }
  if (!record.createdBy || !record.createdBy.isActive) {
    return unauthorized(res, 'Compte propriétaire du token désactivé');
  }

  req.mcpToken = {
    id: record.id,
    label: record.label,
    scopes: parseScopes(record.scopes),
    createdBy: record.createdBy,
    authMethod: 'token'
  };

  prisma.mcpToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() }
  }).catch(() => {});

  next();
}

// ── Mode 2 : JWT OAuth2 ─────────────────────────────────────────────────────
async function handleOAuthJwt(req, res, next, token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    return unauthorized(res, 'JWT invalide ou expiré');
  }

  if (payload.type !== 'mcp_access' || !payload.sub) {
    return unauthorized(res, 'JWT non reconnu comme access token MCP');
  }

  // Contrôle de révocation : le JWT seul ne suffit pas car le token peut avoir
  // été révoqué après l'émission du JWT (window max = 15 min).
  const record = await prisma.mcpToken.findUnique({
    where: { id: payload.sub },
    include: { createdBy: { select: { id: true, name: true, email: true, role: true, isActive: true } } }
  });

  if (!record || !isMcpTokenUsable(record)) {
    return unauthorized(res, 'Token MCP révoqué ou expiré');
  }
  if (!record.createdBy || !record.createdBy.isActive) {
    return unauthorized(res, 'Compte propriétaire du token désactivé');
  }

  req.mcpToken = {
    id: record.id,
    label: record.label,
    scopes: parseScopes(record.scopes),
    createdBy: record.createdBy,
    authMethod: 'oauth2'
  };

  prisma.mcpToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() }
  }).catch(() => {});

  next();
}

/** Garde de scope réutilisable côté outils MCP. */
function requireScope(scopes, required) {
  return hasScope(scopes, required);
}

module.exports = { mcpAuth, requireScope };
