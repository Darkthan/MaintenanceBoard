const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../lib/prisma');
const {
  hashMcpToken,
  isMcpTokenUsable,
  parseScopes,
  hasScope,
  isDirectMcpClientId,
  filterScopesForUser
} = require('../utils/mcpTokens');

const base = () => config.appUrl.replace(/\/$/, '');

// ── Réponses 401 conformes RFC 9728 / RFC 6750 ──────────────────────────────

// Aucun token fourni → on pointe vers le endpoint de découverte OAuth2.
// C'est ce header que ChatGPT et les clients MCP lisent pour trouver le serveur OAuth.
function noToken(res) {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${base()}/.well-known/oauth-protected-resource"`);
  return res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Authentification MCP requise' },
    id: null
  });
}

// Token fourni mais invalide/révoqué/expiré → erreur standard RFC 6750.
function invalidToken(res, description) {
  res.set('WWW-Authenticate', `Bearer error="invalid_token"${description ? `, error_description="${description}"` : ''}`);
  return res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: description || 'Token invalide' },
    id: null
  });
}

/**
 * Authentifie une requête MCP. Trois modes :
 *
 *   Mode 1 — Token natif mcp_xxx (Bearer direct, rétrocompatible)
 *   Mode 2 — JWT mcp_access (émis par /oauth/token grant=client_credentials)
 *   Mode 3 — JWT mcp_user_access (émis par /oauth/token grant=authorization_code)
 *
 * Attache req.mcpToken = { id, label, scopes, createdBy, authMethod }
 * et met à jour lastUsedAt en best-effort.
 */
async function mcpAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return noToken(res);

    const token = authHeader.slice(7).trim();
    if (!token) return noToken(res);

    if (token.startsWith('mcp_')) return handleNativeToken(req, res, next, token);
    return handleOAuthJwt(req, res, next, token);
  } catch (err) {
    next(err);
  }
}

// ── Mode 1 : token natif ────────────────────────────────────────────────────
async function handleNativeToken(req, res, next, token) {
  const record = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    include: { createdBy: { select: { id: true, name: true, email: true, role: true, isActive: true } } }
  });
  if (!record || !isMcpTokenUsable(record)) return invalidToken(res, 'Token MCP invalide, révoqué ou expiré');
  if (!record.createdBy?.isActive) return invalidToken(res, 'Compte propriétaire du token désactivé');

  req.mcpToken = { id: record.id, label: record.label, scopes: parseScopes(record.scopes), createdBy: record.createdBy, authMethod: 'token' };
  prisma.mcpToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  next();
}

// ── Modes 2 & 3 : JWT OAuth2 ────────────────────────────────────────────────
async function handleOAuthJwt(req, res, next, token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    return invalidToken(res, 'JWT invalide ou expiré');
  }

  if (payload.type === 'mcp_access') return handleMcpAccessJwt(req, res, next, payload);
  if (payload.type === 'mcp_user_access') return handleMcpUserAccessJwt(req, res, next, payload);
  return invalidToken(res, 'JWT non reconnu comme access token MCP');
}

// Mode 2 : JWT issu de client_credentials (sub = McpToken.id)
async function handleMcpAccessJwt(req, res, next, payload) {
  const record = await prisma.mcpToken.findUnique({
    where: { id: payload.sub },
    include: { createdBy: { select: { id: true, name: true, email: true, role: true, isActive: true } } }
  });
  if (!record || !isMcpTokenUsable(record)) return invalidToken(res, 'Token MCP révoqué ou expiré');
  if (!record.createdBy?.isActive) return invalidToken(res, 'Compte propriétaire du token désactivé');

  req.mcpToken = { id: record.id, label: record.label, scopes: parseScopes(record.scopes), createdBy: record.createdBy, authMethod: 'oauth2' };
  prisma.mcpToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  next();
}

// Mode 3 : JWT issu de authorization_code (sub = User.id, mcpTokenId = McpToken.id)
async function handleMcpUserAccessJwt(req, res, next, payload) {
  if (!payload.sub) return invalidToken(res, 'JWT incomplet');

  if (isDirectMcpClientId(payload.clientId)) {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, isActive: true }
    });
    if (!user || !user.isActive) return invalidToken(res, 'Compte utilisateur désactivé');

    const scopes = filterScopesForUser(payload.scopes || [], user);
    if (!scopes.length) return invalidToken(res, 'Aucun scope MCP autorisé pour cet utilisateur');

    req.mcpToken = {
      id: payload.clientId,
      label: 'Connexion OAuth MCP',
      scopes,
      createdBy: user,
      authMethod: 'oauth2_direct'
    };
    return next();
  }

  if (!payload.mcpTokenId) return invalidToken(res, 'JWT incomplet');

  const [mcpToken, user] = await Promise.all([
    prisma.mcpToken.findUnique({ where: { id: payload.mcpTokenId } }),
    prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, email: true, role: true, isActive: true } })
  ]);
  if (!mcpToken || !isMcpTokenUsable(mcpToken)) return invalidToken(res, 'Client MCP révoqué ou expiré');
  if (!user || !user.isActive) return invalidToken(res, 'Compte utilisateur désactivé');

  req.mcpToken = { id: mcpToken.id, label: mcpToken.label, scopes: payload.scopes || [], createdBy: user, authMethod: 'oauth2_code' };
  prisma.mcpToken.update({ where: { id: mcpToken.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  next();
}

/** Garde de scope réutilisable côté outils MCP. */
function requireScope(scopes, required) {
  return hasScope(scopes, required);
}

module.exports = { mcpAuth, requireScope };
