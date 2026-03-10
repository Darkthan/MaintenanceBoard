const { PrismaClient } = require('@prisma/client');
const { isIpAllowed } = require('../utils/ipFilter');

const prisma = new PrismaClient();

/**
 * Extrait l'IP cliente depuis la requête Express.
 * Gère le cas derrière un proxy (x-forwarded-for).
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

/**
 * Middleware d'authentification agent.
 * Accepte le header X-Agent-Token qui peut être :
 * - Un token d'enrollment (AgentToken.token) → req.enrollmentToken
 *   → Filtrage IP appliqué (ipWhitelist / ipBlacklist)
 * - Un token machine (Equipment.agentToken)  → req.equipmentRecord
 *   → Vérifie que agentRevoked === false
 * Retourne 401 si absent ou inactif, 403 si IP non autorisée.
 */
async function agentAuth(req, res, next) {
  const token = req.headers['x-agent-token'];
  if (!token) {
    return res.status(401).json({ error: 'Header X-Agent-Token manquant' });
  }

  try {
    // 1. Chercher un token d'enrollment
    const enrollmentToken = await prisma.agentToken.findUnique({
      where: { token }
    });

    if (enrollmentToken) {
      if (!enrollmentToken.isActive) {
        return res.status(401).json({ error: 'Token d\'enrollment désactivé' });
      }

      // Filtrage IP
      const clientIp = getClientIp(req);
      let whitelist = null;
      let blacklist = null;
      try { whitelist = enrollmentToken.ipWhitelist ? JSON.parse(enrollmentToken.ipWhitelist) : null; } catch {}
      try { blacklist = enrollmentToken.ipBlacklist ? JSON.parse(enrollmentToken.ipBlacklist) : null; } catch {}

      if (!isIpAllowed(clientIp, whitelist, blacklist)) {
        return res.status(403).json({ error: 'IP non autorisée pour cet enrollment token', ip: clientIp });
      }

      req.enrollmentToken = enrollmentToken;
      return next();
    }

    // 2. Chercher un token machine (Equipment)
    const equipment = await prisma.equipment.findUnique({
      where: { agentToken: token }
    });

    if (equipment) {
      if (equipment.agentRevoked) {
        return res.status(401).json({ error: 'Token machine révoqué. Re-enrollment requis.', code: 'AGENT_REVOKED' });
      }
      req.equipmentRecord = equipment;
      return next();
    }

    return res.status(401).json({ error: 'Token agent invalide' });
  } catch (err) {
    next(err);
  }
}

module.exports = { agentAuth };
