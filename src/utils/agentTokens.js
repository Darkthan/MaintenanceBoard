const config = require('../config');

function hasEnrollmentTokenExpired(record, now = new Date()) {
  const maxAge = Number(config.agent.enrollmentTokenMaxAge || 0);
  if (!record || !Number.isFinite(maxAge) || maxAge <= 0) return false;

  const createdAt = record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt);
  if (Number.isNaN(createdAt.getTime())) return true;

  return now.getTime() - createdAt.getTime() > maxAge;
}

function isEnrollmentTokenUsable(record, now = new Date()) {
  return !!(record && record.isActive && !hasEnrollmentTokenExpired(record, now));
}

module.exports = {
  hasEnrollmentTokenExpired,
  isEnrollmentTokenUsable
};
