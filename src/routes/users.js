const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

const prisma = new PrismaClient();

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
        id: true, email: true, name: true, role: true,
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
    body('role').optional().isIn(['ADMIN', 'TECH']),
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
        select: { id: true, email: true, name: true, role: true, isActive: true }
      });
      res.json(user);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Utilisateur introuvable' });
      next(err);
    }
  }
);

// DELETE /api/users/:id - Désactiver (admin) - on ne supprime pas vraiment
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous désactiver vous-même' });
    }
    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ message: 'Utilisateur désactivé' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Utilisateur introuvable' });
    next(err);
  }
});

module.exports = router;
