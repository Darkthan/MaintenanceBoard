const rateLimit = require('express-rate-limit');
const { readSettings } = require('../utils/settings');

function getRequestsPerHour() {
  const value = readSettings().publicTickets?.requestsPerHour;
  return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : 10;
}

function createTicketRateLimiter() {
  const requests = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: getRequestsPerHour,
    message: { error: 'Limite de demandes par heure atteinte pour votre adresse IP. Réessayez plus tard.' }
  });
  const messages = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Trop de messages envoyés, réessayez dans une heure.' }
  });
  return (req, res, next) => {
    if (req.method === 'POST' && req.path === '/') return requests(req, res, next);
    if (req.method === 'POST' && /^\/[^/]+\/messages$/.test(req.path)) return messages(req, res, next);
    next();
  };
}

module.exports = { getRequestsPerHour, createTicketRateLimiter };
