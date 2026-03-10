/**
 * Middleware RBAC - vérifie le(s) rôle(s) requis
 * Usage : requireRole('ADMIN') ou requireRole(['ADMIN', 'TECH'])
 */
function requireRole(...roles) {
  const allowedRoles = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Accès refusé',
        required: allowedRoles,
        current: req.user.role
      });
    }
    next();
  };
}

const requireAdmin = requireRole('ADMIN');
const requireTechOrAdmin = requireRole('ADMIN', 'TECH');

module.exports = { requireRole, requireAdmin, requireTechOrAdmin };
