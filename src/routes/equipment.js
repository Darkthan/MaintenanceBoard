const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireTechOrAdmin } = require('../middleware/roles');
const { uploadImport } = require('../middleware/upload');
const importService = require('../services/importService');
const qrService = require('../services/qrService');

// Multer pour les pièces jointes équipement
const equipAttachStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'equipment');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const uploadEquipAttach = multer({ storage: equipAttachStorage, limits: { fileSize: 20 * 1024 * 1024 } });

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'REPAIR', 'DECOMMISSIONED'];
const tableMissing = err => err?.code === 'P2021';

// GET /api/equipment - Liste avec filtres
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { search, status, type, roomId, discoverySource, discoveryStatus } = req.query;

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (type) where.type = { contains: type, mode: 'insensitive' };
    if (roomId) where.roomId = roomId === 'null' ? null : roomId;
    if (discoverySource && ['MANUAL', 'AGENT'].includes(discoverySource)) where.discoverySource = discoverySource;
    if (discoveryStatus && ['PENDING', 'CONFIRMED'].includes(discoveryStatus)) where.discoveryStatus = discoveryStatus;

    const [equipment, total] = await Promise.all([
      prisma.equipment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          room: { select: { id: true, name: true, number: true, building: true } },
          supplierRef: { select: { id: true, name: true } },
          _count: { select: { interventions: true } }
        }
      }),
      prisma.equipment.count({ where })
    ]);

    res.json({
      data: equipment,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) { next(err); }
});

// GET /api/equipment/types - Types distincts
router.get('/types', requireAuth, async (req, res, next) => {
  try {
    const types = await prisma.equipment.findMany({
      select: { type: true },
      distinct: ['type'],
      orderBy: { type: 'asc' }
    });
    res.json(types.map(t => t.type));
  } catch (err) { next(err); }
});

// GET /api/equipment/by-token/:token - Résolution token QR
router.get('/by-token/:token', async (req, res, next) => {
  try {
    const equip = await prisma.equipment.findUnique({
      where: { qrToken: req.params.token },
      include: {
        room: { select: { id: true, name: true, number: true, building: true } }
      }
    });
    if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });
    res.json(equip);
  } catch (err) { next(err); }
});

// GET /api/equipment/:id - Détail avec interventions
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const equip = await prisma.equipment.findUnique({
      where: { id: req.params.id },
      include: {
        room: { select: { id: true, name: true, number: true, building: true } },
        supplierRef: { select: { id: true, name: true } },
        interventions: {
          orderBy: { createdAt: 'desc' },
          include: { tech: { select: { id: true, name: true } } }
        },
        _count: { select: { interventions: true } }
      }
    });
    if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });
    res.json(equip);
  } catch (err) { next(err); }
});

// GET /api/equipment/:id/sessions - Logs de sessions Windows
router.get('/:id/sessions', requireAuth, async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = prisma.machineSessionLog?.findMany
      ? await prisma.machineSessionLog.findMany({
        where: { equipmentId: req.params.id, occurredAt: { gte: since } },
        orderBy: { occurredAt: 'desc' },
        select: { id: true, winUser: true, event: true, occurredAt: true }
      }).catch(err => tableMissing(err) ? [] : Promise.reject(err))
      : [];

    // Histogramme par heure (0-23)
    const byHour = Array(24).fill(0);
    logs.forEach(l => byHour[new Date(l.occurredAt).getHours()]++);

    // Utilisateurs distincts
    const users = [...new Set(logs.map(l => l.winUser))];

    res.json({ logs, byHour, total: logs.length, days, users });
  } catch (err) { next(err); }
});

// GET /api/equipment/:id/qrcode - QR code PNG
router.get('/:id/qrcode', requireAuth, async (req, res, next) => {
  try {
    const equip = await prisma.equipment.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, qrToken: true }
    });
    if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });

    const png = await qrService.generateQrCode(equip.qrToken, 'equipment');
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="qr-equip-${equip.name.replace(/[^a-z0-9]/gi, '-')}.png"`,
      'Cache-Control': 'public, max-age=3600'
    });
    res.send(png);
  } catch (err) { next(err); }
});

// POST /api/equipment - Créer
router.post('/',
  requireAuth, requireAdmin,
  [
    body('name').trim().isLength({ min: 1, max: 200 }),
    body('type').trim().isLength({ min: 1, max: 100 }),
    body('status').optional().isIn(VALID_STATUSES),
    body('roomId').optional().isUUID()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { name, type, brand, model, serialNumber, status, description, roomId, purchaseDate, warrantyEnd, purchasePrice, supplierId } = req.body;

      const equip = await prisma.equipment.create({
        data: {
          name, type,
          brand: brand || null,
          model: model || null,
          serialNumber: serialNumber || null,
          status: status || 'ACTIVE',
          description: description || null,
          roomId: roomId || null,
          purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
          warrantyEnd: warrantyEnd ? new Date(warrantyEnd) : null,
          purchasePrice: purchasePrice !== undefined && purchasePrice !== null && purchasePrice !== '' ? parseFloat(purchasePrice) : null,
          supplierId: supplierId || null
        },
        include: { room: { select: { id: true, name: true, number: true } }, supplierRef: { select: { id: true, name: true } } }
      });
      res.status(201).json(equip);
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ error: 'Ce numéro de série est déjà utilisé' });
      next(err);
    }
  }
);

// PATCH /api/equipment/:id - Modifier
router.patch('/:id',
  requireAuth, requireAdmin,
  [
    body('status').optional().isIn(VALID_STATUSES),
    body('roomId').optional()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { name, type, brand, model, serialNumber, status, description, roomId, purchaseDate, warrantyEnd, purchasePrice, supplierId } = req.body;
      const data = {};
      if (name !== undefined) data.name = name;
      if (type !== undefined) data.type = type;
      if (brand !== undefined) data.brand = brand || null;
      if (model !== undefined) data.model = model || null;
      if (serialNumber !== undefined) data.serialNumber = serialNumber || null;
      if (status !== undefined) data.status = status;
      if (description !== undefined) data.description = description || null;
      if (roomId !== undefined) data.roomId = roomId || null;
      if (purchaseDate !== undefined) data.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
      if (warrantyEnd !== undefined) data.warrantyEnd = warrantyEnd ? new Date(warrantyEnd) : null;
      if (purchasePrice !== undefined) data.purchasePrice = purchasePrice !== null && purchasePrice !== '' ? parseFloat(purchasePrice) : null;
      if (supplierId !== undefined) data.supplierId = supplierId || null;

      const equip = await prisma.equipment.update({
        where: { id: req.params.id },
        data,
        include: { room: { select: { id: true, name: true, number: true } }, supplierRef: { select: { id: true, name: true } } }
      });
      res.json(equip);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Équipement introuvable' });
      if (err.code === 'P2002') return res.status(409).json({ error: 'Ce numéro de série est déjà utilisé' });
      next(err);
    }
  }
);

// PATCH /api/equipment/:id/assign - Assigner à une salle
router.patch('/:id/assign', requireAuth, requireTechOrAdmin, async (req, res, next) => {
  try {
    const { roomId } = req.body;
    const equip = await prisma.equipment.update({
      where: { id: req.params.id },
      data: { roomId: roomId || null },
      include: { room: { select: { id: true, name: true, number: true } } }
    });
    res.json(equip);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Équipement introuvable' });
    next(err);
  }
});

// DELETE /api/equipment/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.equipment.delete({ where: { id: req.params.id } });
    res.json({ message: 'Équipement supprimé' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Équipement introuvable' });
    next(err);
  }
});

// POST /api/equipment/import - Import CSV/Excel
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
      const results = rows.map((row, i) => importService.validateEquipmentRow(row, i));
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

      // Import en transaction - résoudre les roomNumbers
      const created = await prisma.$transaction(async (tx) => {
        const equipments = [];
        for (const result of valid) {
          const { roomNumber, ...data } = result.data;
          let roomId = null;

          if (roomNumber) {
            const room = await tx.room.findFirst({
              where: { number: { equals: roomNumber, mode: 'insensitive' } }
            });
            if (room) roomId = room.id;
          }

          try {
            const equip = await tx.equipment.create({
              data: { ...data, roomId }
            });
            equipments.push(equip);
          } catch (e) {
            if (e.code === 'P2002') {
              // Numéro de série dupliqué, on ignore si skipErrors
              if (!skipErrors) throw e;
            } else {
              throw e;
            }
          }
        }
        return equipments;
      });

      importService.cleanupFile(req.file.path);
      res.json({
        message: `${created.length} équipement(s) importé(s) avec succès`,
        imported: created.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (err) {
      importService.cleanupFile(req.file?.path);
      next(err);
    }
  }
);

// GET /api/equipment/:id/attachments - Lister les pièces jointes
router.get('/:id/attachments', requireAuth, async (req, res, next) => {
  try {
    const equip = await prisma.equipment.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });

    const attachments = await prisma.equipmentAttachment.findMany({
      where: { equipmentId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: { uploader: { select: { id: true, name: true } } }
    });
    res.json(attachments);
  } catch (err) { next(err); }
});

// POST /api/equipment/:id/attachments - Uploader une pièce jointe
router.post('/:id/attachments', requireAuth, uploadEquipAttach.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });

    const equip = await prisma.equipment.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });

    const VALID_CATEGORIES = ['MANUAL', 'INVOICE', 'CONTRACT', 'PHOTO', 'OTHER'];
    const category = VALID_CATEGORIES.includes(req.body?.category) ? req.body.category : 'OTHER';

    const attachment = await prisma.equipmentAttachment.create({
      data: {
        equipmentId: req.params.id,
        filename: req.file.originalname,
        storedAs: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
        category,
        uploadedBy: req.user.id,
        notes: req.body?.notes || null
      },
      include: { uploader: { select: { id: true, name: true } } }
    });
    res.status(201).json(attachment);
  } catch (err) { next(err); }
});

// DELETE /api/equipment/:id/attachments/:attachId - Supprimer une pièce jointe
router.delete('/:id/attachments/:attachId', requireAuth, async (req, res, next) => {
  try {
    const attachment = await prisma.equipmentAttachment.findUnique({
      where: { id: req.params.attachId }
    });
    if (!attachment) return res.status(404).json({ error: 'Pièce jointe introuvable' });
    if (attachment.equipmentId !== req.params.id) return res.status(404).json({ error: 'Pièce jointe introuvable' });

    // Admin ou uploader peuvent supprimer
    if (req.user.role !== 'ADMIN' && attachment.uploadedBy !== req.user.id) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    // Supprimer le fichier physique
    const filePath = path.join(process.cwd(), 'uploads', 'equipment', attachment.storedAs);
    fs.unlink(filePath, () => {}); // ignorer si déjà absent

    await prisma.equipmentAttachment.delete({ where: { id: req.params.attachId } });
    res.json({ message: 'Pièce jointe supprimée' });
  } catch (err) { next(err); }
});

// GET /api/equipment/:id/history - Historique (interventions + mouvements stock)
router.get('/:id/history', requireAuth, async (req, res, next) => {
  try {
    const equip = await prisma.equipment.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!equip) return res.status(404).json({ error: 'Équipement introuvable' });

    // Interventions liées à cet équipement
    const interventions = await prisma.intervention.findMany({
      where: { equipmentId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: {
        tech: { select: { id: true, name: true } },
        orders: {
          include: { items: true }
        }
      }
    });

    // Mouvements de stock liés aux interventions de cet équipement
    const interventionIds = interventions.map(i => i.id);
    const stockMovements = interventionIds.length > 0
      ? await prisma.stockMovement.findMany({
          where: { interventionId: { in: interventionIds } },
          orderBy: { createdAt: 'desc' },
          include: {
            stockItem: { select: { id: true, name: true, reference: true } },
            user: { select: { id: true, name: true } }
          }
        })
      : [];

    // Coût total = somme des OrderItems des commandes liées aux interventions
    let totalCost = 0;
    for (const intervention of interventions) {
      for (const order of (intervention.orders || [])) {
        for (const item of (order.items || [])) {
          if (item.unitPrice) {
            totalCost += item.unitPrice * item.quantity;
          }
        }
      }
    }

    res.json({ interventions, stockMovements, totalCost });
  } catch (err) { next(err); }
});

module.exports = router;
