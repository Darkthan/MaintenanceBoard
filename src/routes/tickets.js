const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const prisma = require('../lib/prisma');

// POST /api/tickets — Soumission publique de ticket
router.post('/', async (req, res, next) => {
  try {
    const {
      roomToken,
      equipmentToken,
      title,
      description,
      reporterName,
      reporterEmail,
      _honeypot
    } = req.body;

    // Anti-spam : honeypot
    if (_honeypot && _honeypot !== '') {
      return res.status(200).json({ success: true, message: 'Ticket soumis avec succès.' });
    }

    // Validation titre
    if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
      return res.status(400).json({ error: 'Le titre est requis (3 à 200 caractères).' });
    }

    // Validation email
    if (reporterEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(reporterEmail)) {
        return res.status(400).json({ error: 'Format d\'email invalide.' });
      }

      // Cooldown 10 min par email (skippé en mode test)
      if (process.env.NODE_ENV !== 'test') {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const recentTicket = await prisma.intervention.findFirst({
          where: {
            reporterEmail,
            source: 'PUBLIC',
            createdAt: { gte: tenMinutesAgo }
          }
        });
        if (recentTicket) {
          return res.status(429).json({ error: 'Veuillez patienter avant de soumettre un nouveau ticket.' });
        }
      }
    }

    // Résoudre roomToken ou equipmentToken
    let roomId = null;
    let equipmentId = null;

    if (roomToken) {
      const room = await prisma.room.findUnique({ where: { qrToken: roomToken } });
      if (!room) return res.status(404).json({ error: 'QR code de salle introuvable.' });
      roomId = room.id;
    } else if (equipmentToken) {
      const equipment = await prisma.equipment.findUnique({ where: { qrToken: equipmentToken } });
      if (!equipment) return res.status(404).json({ error: 'QR code d\'équipement introuvable.' });
      equipmentId = equipment.id;
      if (equipment.roomId) roomId = equipment.roomId;
    } else if (req.body.roomId) {
      const room = await prisma.room.findUnique({ where: { id: req.body.roomId } });
      if (!room) return res.status(404).json({ error: 'Salle introuvable.' });
      roomId = room.id;
    } else {
      return res.status(400).json({ error: 'Une salle doit être renseignée.' });
    }

    const reporterToken = uuidv4();

    await prisma.intervention.create({
      data: {
        title: title.trim(),
        description: description ? description.trim().slice(0, 2000) : null,
        status: 'OPEN',
        priority: 'NORMAL',
        source: 'PUBLIC',
        techId: null,
        roomId,
        equipmentId,
        reporterName: reporterName ? reporterName.trim() : null,
        reporterEmail: reporterEmail ? reporterEmail.trim() : null,
        reporterToken
      }
    });

    return res.status(201).json({
      success: true,
      token: reporterToken,
      message: 'Ticket soumis avec succès. Conservez ce token pour suivre votre demande.'
    });
  } catch (err) { next(err); }
});

// GET /api/tickets/rooms — Liste publique des salles (pour formulaire générique)
router.get('/rooms', async (req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({
      orderBy: [{ building: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, building: true, number: true, floor: true }
    });
    res.json(rooms);
  } catch (err) { next(err); }
});

// GET /api/tickets/rooms/:id/equipment — Équipements d'une salle (pour autocomplétion)
router.get('/rooms/:id/equipment', async (req, res, next) => {
  try {
    const equipment = await prisma.equipment.findMany({
      where: { roomId: req.params.id, status: { not: 'DECOMMISSIONED' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true, brand: true, model: true }
    });
    res.json(equipment);
  } catch (err) { next(err); }
});

// GET /api/tickets/:token — Suivi public du statut
router.get('/:token', async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { reporterToken: req.params.token },
      include: {
        room: { select: { name: true } },
        equipment: { select: { name: true } }
      }
    });

    if (!intervention) {
      return res.status(404).json({ error: 'Ticket introuvable.' });
    }

    // Retourner uniquement les infos non sensibles
    return res.json({
      status: intervention.status,
      priority: intervention.priority,
      title: intervention.title,
      createdAt: intervention.createdAt,
      room: intervention.room ? { name: intervention.room.name } : null,
      equipment: intervention.equipment ? { name: intervention.equipment.name } : null
    });
  } catch (err) { next(err); }
});

module.exports = router;
