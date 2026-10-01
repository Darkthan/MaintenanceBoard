const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

const prisma = require('../lib/prisma');

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

// GET /api/users - Liste (admin seulement)
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, email: true, contactEmail: true, name: true, role: true,
        isActive: true, createdAt: true,
        _count: { select: { interventions: true, passkeys: true, loginLogs: true } },
        loginLogs: { take: 1, orderBy: { createdAt: 'desc' }, select: { createdAt: true, method: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(users);
  } catch (err) { next(err); }
});

// GET /api/users/:id/login-logs - Historique des connexions
router.get('/:id/login-logs', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await prisma.loginLog.findMany({
      where: { userId: req.params.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, method: true, ip: true, userAgent: true, createdAt: true }
    });

    // Agrégation par heure (0-23) pour l'histogramme
    const byHour = Array(24).fill(0);
    logs.forEach(l => byHour[new Date(l.createdAt).getHours()]++);

    res.json({ logs, byHour, total: logs.length, days });
  } catch (err) { next(err); }
});

// PATCH /api/users/:id - Modifier un utilisateur (admin)
router.patch('/:id',
  requireAuth, requireAdmin,
  [
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('role').optional().isIn(['ADMIN', 'TECH', 'PRINT_MANAGER']),
    body('isActive').optional().isBoolean()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { name, role, isActive, password } = req.body;
      const data = {};
      if (name !== undefined) data.name = name;
      if (role !== undefined) data.role = role;
      if (isActive !== undefined) data.isActive = isActive;
      if (password) data.passwordHash = await bcrypt.hash(password, 12);

      const user = await prisma.user.update({
        where: { id: req.params.id },
        data,
        select: { id: true, email: true, contactEmail: true, name: true, role: true, isActive: true }
      });
      res.json(user);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Utilisateur introuvable' });
      next(err);
    }
  }
);

// Sans permanent=true, conserver la désactivation pour les anciens clients.
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const permanent = req.query.permanent === 'true';
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: permanent ? 'Vous ne pouvez pas supprimer votre propre compte' : 'Vous ne pouvez pas vous désactiver vous-même' });
    }
    if (permanent) {
      await prisma.$transaction(async tx => {
        const user = await tx.user.findUnique({
          where: { id: req.params.id },
          select: { id: true, _count: { select: {
            interventions: true, orders: true, orderAttachments: true, signatureRequests: true,
            stockMovements: true, createdLoanLinks: true, sentInternalMessages: true, projects: true
          } } }
        });
        if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });
        if (Object.values(user._count).some(count => count > 0)) {
          throw Object.assign(new Error('Ce compte possède un historique lié (interventions, commandes, messages ou autres activités). Désactivez-le pour conserver cet historique.'), { status: 409 });
        }
        await tx.user.delete({ where: { id: user.id } });
      }, { isolationLevel: 'Serializable' });
      return res.json({ message: 'Compte supprimé définitivement' });
    }
    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ message: 'Utilisateur désactivé' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2003') return res.status(409).json({ error: 'Ce compte est encore lié à des données. Désactivez-le ou retirez ses associations avant de le supprimer.' });
    if (err.code === 'P2034') return res.status(409).json({ error: 'Le compte a été modifié pendant la suppression. Réessayez.' });
    next(err);
  }
});

module.exports = router;
