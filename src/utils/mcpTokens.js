const crypto = require('crypto');

// Scopes disponibles pour les tokens MCP.
const MCP_SCOPES = {
  RESERVATIONS_READ: 'reservations:read',
  RESERVATIONS_WRITE: 'reservations:write',
  EQUIPMENT_BOOKINGS_READ: 'equipment_bookings:read',
  EQUIPMENT_BOOKINGS_WRITE: 'equipment_bookings:write',
  INTERVENTIONS_READ: 'interventions:read',
  INTERVENTIONS_WRITE: 'interventions:write',
  TODOS_READ: 'todos:read',
  TODOS_WRITE: 'todos:write',
  PROJECTS_READ: 'projects:read',
  PROJECTS_WRITE: 'projects:write',
  ORDERS_READ: 'orders:read',
  ORDERS_WRITE: 'orders:write',
  STOCK_READ: 'stock:read',
  STOCK_WRITE: 'stock:write'
};

const ALL_MCP_SCOPES = Object.values(MCP_SCOPES);

const MCP_SCOPE_ALIASES = {
  [MCP_SCOPES.RESERVATIONS_READ]: MCP_SCOPES.EQUIPMENT_BOOKINGS_READ,
  [MCP_SCOPES.EQUIPMENT_BOOKINGS_READ]: MCP_SCOPES.RESERVATIONS_READ,
  [MCP_SCOPES.RESERVATIONS_WRITE]: MCP_SCOPES.EQUIPMENT_BOOKINGS_WRITE,
  [MCP_SCOPES.EQUIPMENT_BOOKINGS_WRITE]: MCP_SCOPES.RESERVATIONS_WRITE
};

const TOKEN_PREFIX = 'mcp_';
const DIRECT_MCP_CLIENT_ID = 'maintenanceboard-direct-mcp';
const DYNAMIC_MCP_CLIENT_PREFIX = 'mcp_dynamic_';

const TECH_MCP_SCOPES = [
  MCP_SCOPES.RESERVATIONS_READ,
  MCP_SCOPES.RESERVATIONS_WRITE,
  MCP_SCOPES.EQUIPMENT_BOOKINGS_READ,
  MCP_SCOPES.EQUIPMENT_BOOKINGS_WRITE,
  MCP_SCOPES.INTERVENTIONS_READ,
  MCP_SCOPES.INTERVENTIONS_WRITE,
  MCP_SCOPES.TODOS_READ,
  MCP_SCOPES.TODOS_WRITE,
  MCP_SCOPES.PROJECTS_READ,
  MCP_SCOPES.PROJECTS_WRITE,
  MCP_SCOPES.ORDERS_READ,
  MCP_SCOPES.ORDERS_WRITE,
  MCP_SCOPES.STOCK_READ
];

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

function expandCompatibleScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : parseScopes(scopes);
  const expanded = [];
  for (const scope of list) {
    if (!ALL_MCP_SCOPES.includes(scope)) continue;
    expanded.push(scope);
    if (MCP_SCOPE_ALIASES[scope]) expanded.push(MCP_SCOPE_ALIASES[scope]);
  }
  return [...new Set(expanded)];
}

function isDirectMcpClientId(clientId) {
  const value = String(clientId || '');
  return value === DIRECT_MCP_CLIENT_ID || value.startsWith(DYNAMIC_MCP_CLIENT_PREFIX);
}

function getUserMcpScopes(user) {
  if (user?.role === 'ADMIN') return ALL_MCP_SCOPES;
  return TECH_MCP_SCOPES;
}

function filterScopesForUser(scopes, user) {
  const requested = Array.isArray(scopes) ? scopes : parseScopes(scopes);
  const allowed = getUserMcpScopes(user);
  return requested.filter(scope => allowed.includes(scope));
}

module.exports = {
  MCP_SCOPES,
  ALL_MCP_SCOPES,
  MCP_SCOPE_ALIASES,
  TOKEN_PREFIX,
  DIRECT_MCP_CLIENT_ID,
  DYNAMIC_MCP_CLIENT_PREFIX,
  generateMcpToken,
  hashMcpToken,
  hasMcpTokenExpired,
  isMcpTokenUsable,
  parseScopes,
  serializeScopes,
  hasScope,
  expandCompatibleScopes,
  isDirectMcpClientId,
  getUserMcpScopes,
  filterScopesForUser
};
