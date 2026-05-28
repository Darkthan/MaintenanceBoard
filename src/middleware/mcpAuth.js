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
 * Authentifie une requête MCP via le header Authorization: Bearer <token>.
 * Résout le token par hash, vérifie qu'il est actif et non expiré, attache
 * req.mcpToken = { id, label, scopes, createdBy } et met à jour lastUsedAt.
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

    const record = await prisma.mcpToken.findUnique({
      where: { tokenHash: hashMcpToken(token) },
      include: { createdBy: { select: { id: true, name: true, email: true, role: true, isActive: true } } }
    });

    if (!record || !isMcpTokenUsable(record)) {
      return unauthorized(res, 'Token MCP invalide, révoqué ou expiré');
    }

    // Le token hérite de l'utilisateur créateur : s'il est désactivé, le token l'est aussi.
    if (!record.createdBy || !record.createdBy.isActive) {
      return unauthorized(res, 'Compte propriétaire du token désactivé');
    }

    req.mcpToken = {
      id: record.id,
      label: record.label,
      scopes: parseScopes(record.scopes),
      createdBy: record.createdBy
    };

    // Suivi best-effort de la dernière utilisation (ne bloque pas la requête).
    prisma.mcpToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}

/** Garde de scope réutilisable côté outils MCP. */
function requireScope(scopes, required) {
  return hasScope(scopes, required);
}

module.exports = { mcpAuth, requireScope };
