const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireTechOrAdmin } = require('../middleware/roles');
const { agentAuth } = require('../middleware/agentAuth');
const discoveryService = require('../services/discoveryService');

const prisma = require('../lib/prisma');

// ── POST /api/agents/checkin ─────────────────────────────────────────────────
// Auth: X-Agent-Token (enrollment ou machine token)
router.post('/checkin', agentAuth, async (req, res, next) => {
  try {
    const { hostname, serialNumber, type, cpu, ramGb, os, osVersion, user, ips, macs, peripherals } = req.body;

    // Validation hostname
    if (hostname && !/^[a-zA-Z0-9._-]{1,255}$/.test(hostname)) {
      return res.status(400).json({ error: 'Hostname invalide' });
    }

    // Sanitisation agentInfo — limites de taille pour éviter le stockage abusif
    const cap = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v);
    const capArr = (v, max) => (Array.isArray(v) ? v.slice(0, max).map(s => typeof s === 'string' ? s.slice(0, 256) : s) : v);
    const sanitized = {
      cpu: cap(cpu, 256),
      ramGb: typeof ramGb === 'number' ? ramGb : undefined,
      os: cap(os, 256),
      osVersion: cap(osVersion, 256),
      user: cap(user, 256),
      ips: capArr(ips, 50),
      macs: capArr(macs, 20),
      peripherals: capArr(peripherals, 50)
    };
    const agentInfoStr = JSON.stringify(sanitized);
    if (agentInfoStr.length > 10240) {
      return res.status(400).json({ error: 'agentInfo trop volumineux (max 10 Ko)' });
    }
    const agentInfo = agentInfoStr;

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
        // Bloquer le re-enrollment si la machine a été révoquée par un admin
        if (equipment.agentRevoked) {
          return res.status(403).json({
            error: 'Cet équipement a été révoqué. Un administrateur doit le réactiver avant tout re-enrollment.',
            code: 'EQUIPMENT_REVOKED'
          });
        }

        // Équipement existant → mettre à jour (conserver le lien enrollmentTokenId s'il existait déjà)
        const machineToken = equipment.agentToken || uuidv4();
        const updateData = {
          agentInfo,
          agentHostname: hostname || null,
          agentToken: machineToken,
          lastSeenAt: new Date(),
          discoverySource: 'AGENT'
        };
        // Associer le token de déploiement seulement si la machine n'en avait pas encore
        if (!equipment.enrollmentTokenId) {
          updateData.enrollmentTokenId = enrollToken.id;
        }
        equipment = await prisma.equipment.update({
          where: { id: equipment.id },
          data: updateData
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
          lastSeenAt: new Date(),
          enrollmentTokenId: enrollToken.id
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

// ── POST /api/agents/sessions ─────────────────────────────────────────────────
// Auth: X-Agent-Token machine uniquement (pas enrollment)
// Body: { events: [{ winUser, event, occurredAt }] }
router.post('/sessions', agentAuth, async (req, res, next) => {
  try {
    if (!req.equipmentRecord) {
      return res.status(403).json({ error: 'Token machine requis' });
    }

    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events requis (tableau)' });
    }

    // Valider et normaliser les événements
    const validEvents = [];
    for (const e of events) {
      if (!e.winUser || !['LOGIN', 'LOGOUT'].includes(e.event)) continue;
      const occurredAt = e.occurredAt ? new Date(e.occurredAt) : new Date();
      if (isNaN(occurredAt.getTime())) continue;
      validEvents.push({
        id: require('crypto').randomUUID(),
        equipmentId: req.equipmentRecord.id,
        winUser: String(e.winUser).slice(0, 100),
        event: e.event,
        occurredAt
      });
    }

    if (validEvents.length === 0) {
      return res.status(400).json({ error: 'Aucun événement valide' });
    }

    await prisma.machineSessionLog.createMany({ data: validEvents });
    res.json({ inserted: validEvents.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/agents/tokens ────────────────────────────────────────────────────
router.get('/tokens', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const tokens = await prisma.agentToken.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { name: true, email: true } },
        _count: { select: { enrolledMachines: true } }
      }
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

// ── GET /api/agents/unassigned ────────────────────────────────────────────────
// Machines agent sans salle, avec suggestions de correspondance par hostname
router.get('/unassigned', requireAuth, async (req, res, next) => {
  try {
    const [machines, rooms] = await Promise.all([
      prisma.equipment.findMany({
        where: { agentToken: { not: null }, roomId: null },
        orderBy: { lastSeenAt: 'desc' }
      }),
      prisma.room.findMany({
        select: { id: true, name: true, number: true, building: true },
        orderBy: [{ building: 'asc' }, { number: 'asc' }]
      })
    ]);

    const result = machines.map(m => ({
      id: m.id,
      name: m.name,
      agentHostname: m.agentHostname,
      agentRevoked: m.agentRevoked,
      lastSeenAt: m.lastSeenAt,
      agentInfo: m.agentInfo ? (() => { try { return JSON.parse(m.agentInfo); } catch { return null; } })() : null,
      suggestions: discoveryService.findTopRooms(m.agentHostname || m.name, rooms, 5)
    }));

    res.json(result);
  } catch (err) { next(err); }
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
