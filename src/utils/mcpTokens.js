const crypto = require('crypto');

// Scopes disponibles pour les tokens MCP.
const MCP_SCOPES = {
  RESERVATIONS_READ: 'reservations:read',
  RESERVATIONS_WRITE: 'reservations:write',
  INTERVENTIONS_READ: 'interventions:read',
  INTERVENTIONS_WRITE: 'interventions:write',
  TODOS_READ: 'todos:read',
  TODOS_WRITE: 'todos:write',
  PROJECTS_READ: 'projects:read',
  PROJECTS_WRITE: 'projects:write'
};

const ALL_MCP_SCOPES = Object.values(MCP_SCOPES);

const TOKEN_PREFIX = 'mcp_';

/**
 * Génère un nouveau secret MCP cryptographiquement aléatoire.
 * Retourne le secret en clair (à montrer UNE seule fois au créateur),
 * le hash SHA-256 stocké en base, et un préfixe lisible pour l'UI.
 */
function generateMcpToken() {
  const random = crypto.randomBytes(32).toString('base64url');
  const token = `${TOKEN_PREFIX}${random}`;
  return {
    token,
    tokenHash: hashMcpToken(token),
    tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 8)
  };
}

/**
 * Hash SHA-256 (hex) d'un token. Comparaison par hash → lookup indexé en DB,
 * et le secret en clair n'est jamais persisté.
 */
function hashMcpToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function hasMcpTokenExpired(record, now = new Date()) {
  if (!record?.expiresAt) return false;
  const expires = record.expiresAt instanceof Date ? record.expiresAt : new Date(record.expiresAt);
  if (Number.isNaN(expires.getTime())) return true;
  return expires.getTime() <= now.getTime();
}

function isMcpTokenUsable(record, now = new Date()) {
  return !!(record && record.isActive && !hasMcpTokenExpired(record, now));
}

/** Parse le champ scopes (JSON string) en tableau de scopes valides. */
function parseScopes(raw) {
  if (Array.isArray(raw)) return raw.filter(s => ALL_MCP_SCOPES.includes(s));
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter(s => ALL_MCP_SCOPES.includes(s)) : [];
  } catch {
    return [];
  }
}

/** Normalise une liste de scopes demandée → JSON string dédupliqué et validé. */
function serializeScopes(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const valid = [...new Set(list.map(s => String(s || '').trim()).filter(s => ALL_MCP_SCOPES.includes(s)))];
  return JSON.stringify(valid);
}

function hasScope(scopes, required) {
  const list = Array.isArray(scopes) ? scopes : parseScopes(scopes);
  return list.includes(required);
}

module.exports = {
  MCP_SCOPES,
  ALL_MCP_SCOPES,
  TOKEN_PREFIX,
  generateMcpToken,
  hashMcpToken,
  hasMcpTokenExpired,
  isMcpTokenUsable,
  parseScopes,
  serializeScopes,
  hasScope
};
