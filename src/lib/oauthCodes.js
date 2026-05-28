const crypto = require('crypto');

// Stockage mémoire des codes d'autorisation (TTL 60s, usage unique).
// Non persisté entre redémarrages — acceptable car les codes n'ont que 60s de vie.
const store = new Map();

function generateCode() {
  return crypto.randomBytes(32).toString('base64url');
}

function storeCode(code, data) {
  store.set(code, { ...data, issuedAt: Date.now() });
  setTimeout(() => store.delete(code), 90_000); // nettoyage auto après 90s
}

function consumeCode(code) {
  const data = store.get(code);
  if (!data) return null;
  store.delete(code); // usage unique : supprimé immédiatement
  if (Date.now() - data.issuedAt > 60_000) return null; // expiré
  return data;
}

module.exports = { generateCode, storeCode, consumeCode };
