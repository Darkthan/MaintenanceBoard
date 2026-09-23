const { readSettings, writeSettings } = require('./settings');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function allowedEmails() {
  return [...new Set((readSettings().publicMcpEmails || []).map(normalizeEmail).filter(Boolean))];
}

function isAllowed(email) {
  return allowedEmails().includes(normalizeEmail(email));
}

function setAllowed(email, allowed) {
  const normalized = normalizeEmail(email);
  const emails = new Set(allowedEmails());
  if (allowed) emails.add(normalized);
  else emails.delete(normalized);
  const revokedAt = { ...(readSettings().publicMcpRevokedAt || {}) };
  if (!allowed) revokedAt[normalized] = Date.now();
  writeSettings({ publicMcpEmails: [...emails].sort(), publicMcpRevokedAt: revokedAt });
}

function tokenIsCurrent(email, issuedAt) {
  return isAllowed(email) && Number(issuedAt) > Number((readSettings().publicMcpRevokedAt || {})[normalizeEmail(email)] || 0);
}

function verifiedEmails() {
  return [...new Set((readSettings().publicMcpVerifiedEmails || []).map(normalizeEmail).filter(Boolean))];
}

function markVerified(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || verifiedEmails().includes(normalized)) return;
  writeSettings({ publicMcpVerifiedEmails: [...verifiedEmails(), normalized].sort() });
}

module.exports = { normalizeEmail, allowedEmails, isAllowed, setAllowed, tokenIsCurrent, verifiedEmails, markVerified };
