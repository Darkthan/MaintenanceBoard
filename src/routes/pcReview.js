'use strict';

const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireTechOrAdmin } = require('../middleware/roles');
const discovery = require('../services/discoveryService');

const DAY_MS = 86400000;
// Explicit selection: never expose machine or enrollment tokens on this page.
const select = {
  id: true, name: true, agentHostname: true, serialNumber: true,
  roomId: true, room: { select: { id: true, name: true, number: true, building: true } },
  lastSeenAt: true, hostnameChangeId: true, hostnameChangeOld: true,
  hostnameChangeNew: true, hostnameChangedAt: true
};
// Agent-managed machines are PCs even if their manually entered type differs.
const insensitive = !(process.env.DATABASE_URL || 'file:').startsWith('file:') ? { mode: 'insensitive' } : {};
const pcWhere = { OR: [
  ...['PC', 'ordinateur', 'laptop', 'desktop'].map(type => ({ type: { contains: type, ...insensitive } })),
  { agentToken: { not: null } }, { discoverySource: 'AGENT' }
] };

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const raw = req.query.days === undefined ? '60' : req.query.days;
    if (typeof raw !== 'string' || !/^[1-9]\d{0,4}$/.test(raw) || Number(raw) > 36500) {
      return res.status(400).json({ error: 'La durée doit être un entier entre 1 et 36500 jours.' });
    }
    const days = Number(raw);
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const [renamed, inactive, neverConnected, rooms] = await Promise.all([
      prisma.equipment.findMany({ where: { ...pcWhere, hostnameChangeId: { not: null } }, select, orderBy: { hostnameChangedAt: 'desc' } }),
      prisma.equipment.findMany({ where: { ...pcWhere, lastSeenAt: { lt: cutoff } }, select, orderBy: { lastSeenAt: 'asc' } }),
      prisma.equipment.findMany({ where: { ...pcWhere, lastSeenAt: null }, select, orderBy: { name: 'asc' } }),
      prisma.room.findMany({ select: { id: true, name: true, number: true, building: true }, orderBy: { name: 'asc' } })
    ]);
    res.json({ days, asOf: now, cutoff, rooms,
      renamed: renamed.map(e => ({ ...e, suggestion: discovery.findBestRoom(e.hostnameChangeNew, rooms) })),
      inactive: inactive.map(e => ({ ...e, inactivityDays: Math.floor((now - e.lastSeenAt) / DAY_MS) })),
      neverConnected
    });
  } catch (err) { next(err); }
});

router.patch('/:id', requireTechOrAdmin, async (req, res, next) => {
  try {
    const { changeId, action, name, roomId } = req.body;
    if (typeof changeId !== 'string' || !changeId || !['validate', 'ignore'].includes(action)) {
      return res.status(400).json({ error: 'Version du changement et action requises.' });
    }
    const data = {
      hostnameChangeId: null, hostnameChangeOld: null,
      hostnameChangeNew: null, hostnameChangedAt: null
    };
    if (action === 'validate') {
      // Same permissions as equipment PATCH (name) and equipment assign (room).
      if (name !== undefined) {
        if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Seul un administrateur peut modifier le nom de la fiche.' });
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 255) {
          return res.status(400).json({ error: 'Nom requis, limité à 255 caractères.' });
        }
        data.name = name.trim();
      }
      if (roomId !== undefined) {
        if (roomId !== null && (typeof roomId !== 'string' || !roomId)) return res.status(400).json({ error: 'Salle invalide.' });
        if (roomId && !await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } })) {
          return res.status(400).json({ error: 'Salle introuvable.' });
        }
        data.roomId = roomId;
      }
    }
    // One atomic write: a newer check-in must never be acknowledged by this request.
    const result = await prisma.equipment.updateMany({ where: { id: req.params.id, hostnameChangeId: changeId }, data });
    if (!result.count) return res.status(409).json({ error: 'Ce changement a évolué ou a déjà été traité. Actualisez la liste avant de recommencer.', code: 'HOSTNAME_REVIEW_CONFLICT' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2003') return res.status(400).json({ error: 'La salle a été supprimée. Actualisez la liste.' });
    next(err);
  }
});

module.exports = router;
