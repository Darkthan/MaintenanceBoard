const express = require('express');
const router = express.Router();
const { optionalAuth, requireAuth } = require('../middleware/auth');
const qrService = require('../services/qrService');

const prisma = require('../lib/prisma');

function normalizeScannedValue(value) {
  return String(value || '').trim();
}

function getQueryParamFromUrl(value, paramName) {
  try {
    const parsed = new URL(value);
    return parsed.searchParams.get(paramName);
  } catch {
    return null;
  }
}

function extractSerialFromStructuredPayload(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;

    for (const key of ['serialNumber', 'serial', 'sn', 'serviceTag', 'assetSerial']) {
      if (parsed[key]) return normalizeScannedValue(parsed[key]);
    }
  } catch {}

  return null;
}

function extractSerialFromKeyValuePayload(value) {
  const match = value.match(/(?:^|[;\n\r,\s])(?:serialNumber|serial|s\/?n|sn|serviceTag|assetSerial)\s*[:=]\s*([^;\n\r,]+)/i);
  return match ? normalizeScannedValue(match[1]) : null;
}

function extractScanLookup(value) {
  const raw = normalizeScannedValue(value);
  if (!raw) return { raw: '', token: null, serialNumber: null };

  const token = getQueryParamFromUrl(raw, 'token');
  if (token) return { raw, token: normalizeScannedValue(token), serialNumber: null };

  const pathTokenMatch = raw.match(/\/scan\/?([^/?#\s]+)$/i);
  if (pathTokenMatch) return { raw, token: normalizeScannedValue(pathTokenMatch[1]), serialNumber: null };

  const serialFromUrl = ['serialNumber', 'serial', 'sn', 'serviceTag'].map(param => getQueryParamFromUrl(raw, param)).find(Boolean);
  if (serialFromUrl) return { raw, token: null, serialNumber: normalizeScannedValue(serialFromUrl) };

  const serialNumber = extractSerialFromStructuredPayload(raw) || extractSerialFromKeyValuePayload(raw) || raw;
  return { raw, token: null, serialNumber: normalizeScannedValue(serialNumber) };
}

async function resolveEquipmentByQrToken(token) {
  if (!token) return null;
  return prisma.equipment.findUnique({
    where: { qrToken: token },
    include: {
      room: { select: { id: true, name: true, number: true, building: true } }
    }
  });
}

async function resolveRoomByQrToken(token) {
  if (!token) return null;
  return prisma.room.findUnique({
    where: { qrToken: token },
    select: { id: true, name: true, number: true, building: true, qrToken: true }
  });
}

async function resolveEquipmentBySerialNumber(serialNumber) {
  if (!serialNumber) return null;
  return prisma.equipment.findFirst({
    where: { serialNumber: { equals: serialNumber } },
    include: {
      room: { select: { id: true, name: true, number: true, building: true } }
    }
  });
}

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
          where: { status: { notIn: ['DECOMMISSIONED', 'DEEE'] } },
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

// POST /api/qrcode/scan/resolve - Résoudre une lecture brute de scanner mobile
// Accepte un QR MaintenanceBoard, une URL contenant ?token=..., un JSON simple,
// un couple cle=valeur ou directement un numéro de série.
router.post('/scan/resolve', requireAuth, async (req, res, next) => {
  try {
    const lookup = extractScanLookup(req.body?.code || req.body?.value || req.body?.text);
    if (!lookup.raw) return res.status(400).json({ error: 'Code scanné manquant' });

    if (lookup.token) {
      const [equipment, room] = await Promise.all([
        resolveEquipmentByQrToken(lookup.token),
        resolveRoomByQrToken(lookup.token)
      ]);

      if (equipment) {
        return res.json({
          type: 'equipment',
          match: 'qrToken',
          data: equipment,
          href: `/equipment.html?focus=${encodeURIComponent(equipment.id)}`,
          scanUrl: qrService.getScanUrl(lookup.token)
        });
      }

      if (room) {
        return res.json({
          type: 'room',
          match: 'qrToken',
          data: room,
          href: `/scan.html?token=${encodeURIComponent(lookup.token)}`,
          scanUrl: qrService.getScanUrl(lookup.token)
        });
      }
    }

    const equipment = await resolveEquipmentBySerialNumber(lookup.serialNumber);
    if (equipment) {
      return res.json({
        type: 'equipment',
        match: 'serialNumber',
        serialNumber: lookup.serialNumber,
        data: equipment,
        href: `/equipment.html?focus=${encodeURIComponent(equipment.id)}`
      });
    }

    res.status(404).json({
      error: 'Aucun équipement trouvé pour ce code',
      serialNumber: lookup.serialNumber || null
    });
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
