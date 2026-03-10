const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireTechOrAdmin } = require('../middleware/roles');
const { agentAuth } = require('../middleware/agentAuth');
const discoveryService = require('../services/discoveryService');

const prisma = new PrismaClient();

// ── POST /api/agents/checkin ─────────────────────────────────────────────────
// Auth: X-Agent-Token (enrollment ou machine token)
router.post('/checkin', agentAuth, async (req, res, next) => {
  try {
    const { hostname, serialNumber, type, cpu, ramGb, os, osVersion, user, ips, macs, peripherals } = req.body;

    const agentInfo = JSON.stringify({ cpu, ramGb, os, osVersion, user, ips, macs, peripherals });

    // ── Cas 1 : token d'enrollment (premier check-in ou réenrollment) ─────────
    if (req.enrollmentToken) {
      const enrollToken = req.enrollmentToken;

      // Mettre à jour lastUsedAt du token d'enrollment
      await prisma.agentToken.update({
        where: { id: enrollToken.id },
        data: { lastUsedAt: new Date() }
      });

      // Chercher équipement existant par numéro de série
      let equipment = null;
      if (serialNumber) {
        equipment = await prisma.equipment.findUnique({ where: { serialNumber } });
      }

      if (equipment) {
        // Équipement existant → mettre à jour
        const machineToken = equipment.agentToken || uuidv4();
        equipment = await prisma.equipment.update({
          where: { id: equipment.id },
          data: {
            agentInfo,
            agentHostname: hostname || null,
            agentToken: machineToken,
            agentRevoked: false,
            lastSeenAt: new Date(),
            discoverySource: 'AGENT'
          }
        });
        return res.json({ agentToken: machineToken, equipmentId: equipment.id, existing: true });
      }

      // Nouvel équipement → découverte de salle
      const rooms = await prisma.room.findMany({
        select: { id: true, name: true, number: true, building: true }
      });
      const discovery = discoveryService.findBestRoom(hostname, rooms);

      const machineToken = uuidv4();
      const newEquipment = await prisma.equipment.create({
        data: {
          name: hostname || `PC-${Date.now()}`,
          type: type || 'PC',
          serialNumber: serialNumber || null,
          status: 'ACTIVE',
          discoverySource: 'AGENT',
          discoveryStatus: discovery ? 'PENDING' : 'CONFIRMED',
          suggestedRoomId: discovery ? discovery.roomId : null,
          agentInfo,
          agentHostname: hostname || null,
          agentToken: machineToken,
          lastSeenAt: new Date()
        }
      });

      return res.status(201).json({
        agentToken: machineToken,
        equipmentId: newEquipment.id,
        suggestedRoomId: discovery?.roomId || null,
        confidence: discovery?.confidence || null
      });
    }

    // ── Cas 2 : token machine (check-in périodique) ────────────────────────
    if (req.equipmentRecord) {
      await prisma.equipment.update({
        where: { id: req.equipmentRecord.id },
        data: {
          agentInfo,
          agentHostname: hostname || null,
          lastSeenAt: new Date()
        }
      });
      return res.json({ ok: true, equipmentId: req.equipmentRecord.id });
    }

    res.status(401).json({ error: 'Auth invalide' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/agents/tokens ────────────────────────────────────────────────────
router.get('/tokens', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const tokens = await prisma.agentToken.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true, email: true } } }
    });
    res.json(tokens);
  } catch (err) { next(err); }
});

// ── POST /api/agents/tokens ───────────────────────────────────────────────────
router.post('/tokens', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { label } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Le libellé est requis' });
    }
    const token = await prisma.agentToken.create({
      data: { label: label.trim(), createdById: req.user.id }
    });
    res.status(201).json(token);
  } catch (err) { next(err); }
});

// ── PATCH /api/agents/tokens/:id ─────────────────────────────────────────────
router.patch('/tokens/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { label, ipWhitelist, ipBlacklist } = req.body;
    const data = {};
    if (label !== undefined) {
      if (!label || !label.trim()) return res.status(400).json({ error: 'Le libellé ne peut pas être vide' });
      data.label = label.trim();
    }
    if (ipWhitelist !== undefined) {
      data.ipWhitelist = Array.isArray(ipWhitelist) ? JSON.stringify(ipWhitelist) : null;
    }
    if (ipBlacklist !== undefined) {
      data.ipBlacklist = Array.isArray(ipBlacklist) ? JSON.stringify(ipBlacklist) : null;
    }
    const updated = await prisma.agentToken.update({
      where: { id: req.params.id },
      data,
      include: { createdBy: { select: { name: true, email: true } } }
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Token introuvable' });
    next(err);
  }
});

// ── DELETE /api/agents/tokens/:id ────────────────────────────────────────────
router.delete('/tokens/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.agentToken.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ message: 'Token désactivé' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Token introuvable' });
    next(err);
  }
});

// ── GET /api/agents/machines ──────────────────────────────────────────────────
router.get('/machines', requireAuth, async (req, res, next) => {
  try {
    const machines = await prisma.equipment.findMany({
      where: { agentToken: { not: null } },
      orderBy: { lastSeenAt: 'desc' },
      include: { room: { select: { id: true, name: true, number: true } } }
    });
    const result = machines.map(e => ({
      id: e.id,
      name: e.name,
      agentHostname: e.agentHostname,
      agentRevoked: e.agentRevoked,
      lastSeenAt: e.lastSeenAt,
      discoveryStatus: e.discoveryStatus,
      room: e.room,
      agentInfo: e.agentInfo ? (() => { try { return JSON.parse(e.agentInfo); } catch { return null; } })() : null
    }));
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/agents/machines/:equipId/revoke ─────────────────────────────────
router.post('/machines/:equipId/revoke', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const updated = await prisma.equipment.update({
      where: { id: req.params.equipId },
      data: { agentRevoked: true }
    });
    res.json({ message: 'Token machine révoqué', equipmentId: updated.id });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Équipement introuvable' });
    next(err);
  }
});

// ── GET /api/agents/pending ───────────────────────────────────────────────────
router.get('/pending', requireAuth, async (req, res, next) => {
  try {
    const equipment = await prisma.equipment.findMany({
      where: { discoveryStatus: 'PENDING' },
      orderBy: { lastSeenAt: 'desc' },
      include: { room: { select: { id: true, name: true, number: true } } }
    });
    res.json(equipment);
  } catch (err) { next(err); }
});

// ── PATCH /api/agents/:equipId/confirm ───────────────────────────────────────
router.patch('/:equipId/confirm', requireAuth, requireTechOrAdmin, async (req, res, next) => {
  try {
    const { roomId } = req.body;
    const equip = await prisma.equipment.findUnique({ where: { id: req.params.equipId } });
    if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });

    const targetRoomId = roomId !== undefined ? (roomId || null) : (equip.suggestedRoomId || null);

    const updated = await prisma.equipment.update({
      where: { id: req.params.equipId },
      data: {
        discoveryStatus: 'CONFIRMED',
        roomId: targetRoomId,
        suggestedRoomId: null
      },
      include: { room: { select: { id: true, name: true, number: true } } }
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Équipement introuvable' });
    next(err);
  }
});

// ── PATCH /api/agents/:equipId/dismiss ───────────────────────────────────────
router.patch('/:equipId/dismiss', requireAuth, requireTechOrAdmin, async (req, res, next) => {
  try {
    const updated = await prisma.equipment.update({
      where: { id: req.params.equipId },
      data: { discoveryStatus: 'CONFIRMED', suggestedRoomId: null }
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Équipement introuvable' });
    next(err);
  }
});

module.exports = router;
