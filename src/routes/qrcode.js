const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const qrService = require('../services/qrService');

const prisma = new PrismaClient();

// GET /api/qrcode/resolve/:token - Résoudre un token (salle ou équipement)
// Accessible sans auth pour permettre le scan mobile
router.get('/resolve/:token', optionalAuth, async (req, res, next) => {
  try {
    const { token } = req.params;

    // Chercher dans les salles
    const room = await prisma.room.findUnique({
      where: { qrToken: token },
      include: {
        equipment: {
          where: { status: { not: 'DECOMMISSIONED' } },
          select: { id: true, name: true, type: true, brand: true, model: true, status: true }
        },
        interventions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            tech: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (room) {
      return res.json({
        type: 'room',
        data: room,
        scanUrl: qrService.getScanUrl(token)
      });
    }

    // Chercher dans les équipements
    const equip = await prisma.equipment.findUnique({
      where: { qrToken: token },
      include: {
        room: { select: { id: true, name: true, number: true, building: true } },
        interventions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            tech: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (equip) {
      return res.json({
        type: 'equipment',
        data: equip,
        scanUrl: qrService.getScanUrl(token)
      });
    }

    res.status(404).json({ error: 'Token QR inconnu ou expiré' });
  } catch (err) { next(err); }
});

// GET /api/qrcode/room/:id/dataurl - QR code en base64 pour affichage inline
router.get('/room/:id/dataurl', async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      select: { qrToken: true, name: true }
    });
    if (!room) return res.status(404).json({ error: 'Salle introuvable' });

    const dataUrl = await qrService.generateQrDataUrl(room.qrToken);
    res.json({ dataUrl, name: room.name, token: room.qrToken });
  } catch (err) { next(err); }
});

// GET /api/qrcode/equipment/:id/dataurl - QR code en base64 pour équipement
router.get('/equipment/:id/dataurl', async (req, res, next) => {
  try {
    const equip = await prisma.equipment.findUnique({
      where: { id: req.params.id },
      select: { qrToken: true, name: true }
    });
    if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });

    const dataUrl = await qrService.generateQrDataUrl(equip.qrToken);
    res.json({ dataUrl, name: equip.name, token: equip.qrToken });
  } catch (err) { next(err); }
});

module.exports = router;
