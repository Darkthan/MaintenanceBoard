const express = require('express');
const { body, query, validationResult } = require('express-validator');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireTechOrAdmin } = require('../middleware/roles');
const { uploadImport } = require('../middleware/upload');
const importService = require('../services/importService');
const qrService = require('../services/qrService');
const { readSettings, writeSettings } = require('../utils/settings');

const prisma = require('../lib/prisma');

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

const BUILDING_SETTINGS_KEY = 'roomBuildings';

function normalizeBuildingName(name) {
  return String(name || '').trim();
}

function readBuildingSettings() {
  const settings = readSettings()?.[BUILDING_SETTINGS_KEY];
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}

function writeBuildingSettings(settings) {
  writeSettings({ [BUILDING_SETTINGS_KEY]: settings });
}

// GET /api/rooms - Liste avec filtres et pagination
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { search, building } = req.query;

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { number: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (building) where.building = { contains: building, mode: 'insensitive' };

    const [rooms, total] = await Promise.all([
      prisma.room.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ building: 'asc' }, { number: 'asc' }],
        include: {
          _count: { select: { equipment: true, interventions: true } }
        }
      }),
      prisma.room.count({ where })
    ]);

    res.json({
      data: rooms,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) { next(err); }
});

// GET /api/rooms/by-token/:token - Résolution token QR
router.get('/by-token/:token', async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: { qrToken: req.params.token },
      include: {
        equipment: { where: { status: { not: 'DECOMMISSIONED' } } },
        _count: { select: { interventions: true } }
      }
    });
    if (!room) return res.status(404).json({ error: 'Salle introuvable' });
    res.json(room);
  } catch (err) { next(err); }
});

// GET /api/rooms/buildings - Liste des bâtiments avec métadonnées
router.get('/buildings', requireAuth, async (_req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { building: { not: null } },
      select: { building: true }
    });

    const settings = readBuildingSettings();
    const roomCounts = new Map();

    rooms.forEach(room => {
      const name = normalizeBuildingName(room.building);
      if (!name) return;
      roomCounts.set(name, (roomCounts.get(name) || 0) + 1);
    });

    const buildingNames = [...new Set([
      ...roomCounts.keys(),
      ...Object.keys(settings).map(normalizeBuildingName)
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

    res.json(buildingNames.map(name => ({
      name,
      roomCount: roomCounts.get(name) || 0,
      floorsCount: Number.isInteger(settings[name]?.floorsCount) ? settings[name].floorsCount : null
    })));
  } catch (err) { next(err); }
});

// PATCH /api/rooms/buildings - Mettre à jour les métadonnées d'un bâtiment
router.patch('/buildings',
  requireAuth, requireAdmin,
  [
    body('name').trim().isLength({ min: 1, max: 100 }),
    body('floorsCount').optional({ nullable: true }).custom(value => (
      value === null ||
      value === '' ||
      (Number.isInteger(value) && value >= 0 && value <= 200) ||
      (/^\d+$/.test(String(value)) && Number(value) >= 0 && Number(value) <= 200)
    ))
  ],
  (req, res) => {
    if (!validate(req, res)) return;

    const name = normalizeBuildingName(req.body.name);
    const floorsCount = req.body.floorsCount === null || req.body.floorsCount === ''
      ? null
      : parseInt(req.body.floorsCount, 10);

    const settings = readBuildingSettings();
    if (floorsCount === null) {
      delete settings[name];
    } else {
      settings[name] = {
        ...(settings[name] || {}),
        floorsCount
      };
    }

    writeBuildingSettings(settings);
    res.json({ name, floorsCount });
  }
);

// GET /api/rooms/:id - Détail d'une salle
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      include: {
        equipment: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true, type: true, brand: true, model: true, status: true, serialNumber: true }
        },
        _count: { select: { interventions: true } }
      }
    });
    if (!room) return res.status(404).json({ error: 'Salle introuvable' });
    res.json(room);
  } catch (err) { next(err); }
});

// GET /api/rooms/:id/qrcode - Générer QR code PNG
router.get('/:id/qrcode', requireAuth, async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, qrToken: true }
    });
    if (!room) return res.status(404).json({ error: 'Salle introuvable' });

    const png = await qrService.generateQrCode(room.qrToken, 'room');
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="qr-room-${room.name.replace(/[^a-z0-9]/gi, '-')}.png"`,
      'Cache-Control': 'public, max-age=3600'
    });
    res.send(png);
  } catch (err) { next(err); }
});

// POST /api/rooms - Créer une salle
router.post('/',
  requireAuth, requireAdmin,
  [
    body('name').trim().isLength({ min: 1, max: 200 }),
    body('floor').optional().isInt(),
    body('building').optional().trim().isLength({ max: 100 }),
    body('number').optional().trim().isLength({ max: 50 }),
    body('description').optional().trim()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { name, building, floor, number, description } = req.body;
      const room = await prisma.room.create({
        data: {
          name,
          building: building || null,
          floor: floor !== undefined ? parseInt(floor) : null,
          number: number || null,
          description: description || null
        }
      });
      res.status(201).json(room);
    } catch (err) { next(err); }
  }
);

// PATCH /api/rooms/:id - Modifier une salle
router.patch('/:id',
  requireAuth, requireAdmin,
  [
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('floor').optional().isInt(),
    body('building').optional().trim(),
    body('number').optional().trim(),
    body('description').optional().trim()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { name, building, floor, number, description } = req.body;
      const data = {};
      if (name !== undefined) data.name = name;
      if (building !== undefined) data.building = building || null;
      if (floor !== undefined) data.floor = floor !== null ? parseInt(floor) : null;
      if (number !== undefined) data.number = number || null;
      if (description !== undefined) data.description = description || null;

      const room = await prisma.room.update({
        where: { id: req.params.id },
        data
      });
      res.json(room);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Salle introuvable' });
      next(err);
    }
  }
);

// DELETE /api/rooms/:id - Supprimer une salle
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.room.delete({ where: { id: req.params.id } });
    res.json({ message: 'Salle supprimée' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Salle introuvable' });
    next(err);
  }
});

// POST /api/rooms/import - Import CSV/Excel
router.post('/import',
  requireAuth, requireAdmin,
  uploadImport.single('file'),
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    try {
      const skipErrors = req.body.skipErrors === 'true';
      const previewOnly = req.body.preview === 'true';

      const rows = await importService.parseFile(req.file.path);

      if (rows.length === 0) {
        importService.cleanupFile(req.file.path);
        return res.status(400).json({ error: 'Le fichier est vide' });
      }

      // Validation
      const results = rows.map((row, i) => importService.validateRoomRow(row, i));
      const errors = results.filter(r => !r.valid).flatMap(r => r.errors);
      const valid = results.filter(r => r.valid);

      if (!skipErrors && errors.length > 0) {
        importService.cleanupFile(req.file.path);
        return res.status(400).json({
          error: `${errors.length} erreur(s) trouvée(s)`,
          errors,
          validCount: valid.length,
          totalCount: rows.length
        });
      }

      if (previewOnly) {
        importService.cleanupFile(req.file.path);
        return res.json({
          preview: valid.slice(0, 10).map(r => r.data),
          validCount: valid.length,
          errorCount: errors.length,
          errors: errors.slice(0, 20)
        });
      }

      // Import en transaction
      const created = await prisma.$transaction(async (tx) => {
        const rooms = [];
        for (const result of valid) {
          const room = await tx.room.create({ data: result.data });
          rooms.push(room);
        }
        return rooms;
      });

      importService.cleanupFile(req.file.path);
      res.json({
        message: `${created.length} salle(s) importée(s) avec succès`,
        imported: created.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (err) {
      importService.cleanupFile(req.file?.path);
      next(err);
    }
  }
);

module.exports = router;
