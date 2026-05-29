const { readSettings } = require('./settings');

const FALLBACK_REQUESTER_EMAIL = 'support@beaupeyrat.fr';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function getLoanEmailSettings() {
  const saved = readSettings().loans || {};
  return {
    reservationEmailSource: ['profile', 'default'].includes(saved.reservationEmailSource)
      ? saved.reservationEmailSource
      : 'profile',
    defaultRequesterEmail: normalizeEmail(saved.defaultRequesterEmail || FALLBACK_REQUESTER_EMAIL)
  };
}

function resolveLoanRequesterEmail(inputEmail, user) {
  const explicit = normalizeEmail(inputEmail);
  if (explicit) return explicit;

  const settings = getLoanEmailSettings();
  if (settings.reservationEmailSource === 'default' && settings.defaultRequesterEmail) {
    return settings.defaultRequesterEmail;
  }

  return normalizeEmail(user?.contactEmail || user?.email || settings.defaultRequesterEmail);
}

module.exports = {
  FALLBACK_REQUESTER_EMAIL,
  normalizeEmail,
  isValidEmail,
  getLoanEmailSettings,
  resolveLoanRequesterEmail
};
