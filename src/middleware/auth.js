const jwt = require('jsonwebtoken');
const config = require('../config');

const prisma = require('../lib/prisma');

function canAccessPrintingOnly(req) {
  const path = (req.originalUrl || '').split('?')[0];
  return /^\/api\/printer-logs(?:\/|$)/.test(path) ||
    /^\/api\/auth\/(?:me|logout|change-password|webauthn\/register\/(?:begin|finish)|passkeys\/[^/]+)$/.test(path);
}

/**
 * Middleware de vérification du JWT
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const tokenFromCookie = req.cookies?.accessToken;

    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : tokenFromCookie;

    if (!token) {
      return res.status(401).json({ error: 'Token d\'authentification manquant' });
    }

    const payload = jwt.verify(token, config.jwt.secret);

    // Vérifier que l'utilisateur existe et est actif
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, contactEmail: true, name: true, role: true, isActive: true }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Utilisateur introuvable ou désactivé' });
    }

    req.user = user;
    if (user.role === 'PRINT_MANAGER' && !canAccessPrintingOnly(req)) {
      return res.status(403).json({ error: 'Ce compte donne accès uniquement à la gestion des impressions' });
    }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token invalide' });
    }
    next(err);
  }
}

/**
 * Middleware optionnel - n'échoue pas si pas de token
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const tokenFromCookie = req.cookies?.accessToken;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : tokenFromCookie;

    if (!token) return next();

    const payload = jwt.verify(token, config.jwt.secret);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, contactEmail: true, name: true, role: true, isActive: true }
    });

    if (user && user.isActive && user.role !== 'PRINT_MANAGER') req.user = user;
  } catch {
    // Ignorer les erreurs
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
