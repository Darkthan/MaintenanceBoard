const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { uploadPhoto } = require('../middleware/upload');

const prisma = require('../lib/prisma');
const { containsFilter } = require('../lib/db-utils');

// SQLite stocke photos en JSON string — normaliser en tableau JS
function parsePhotos(intervention) {
  if (!intervention) return intervention;
  const p = intervention.photos;
  intervention.photos = Array.isArray(p) ? p : (typeof p === 'string' ? JSON.parse(p || '[]') : []);
  return intervention;
}

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const VALID_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];

const interventionInclude = {
  room: { select: { id: true, name: true, number: true, building: true } },
  equipment: { select: { id: true, name: true, type: true, brand: true, model: true } },
  tech: { select: { id: true, name: true, email: true } },
  orders: {
    select: {
      id: true,
      title: true,
      status: true,
      supplier: true,
      createdAt: true
    },
    orderBy: { createdAt: 'desc' }
  }
};

// GET /api/interventions - Liste avec filtres
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { status, priority, roomId, equipmentId, techId, dateFrom, dateTo, search, source } = req.query;

    const where = {};
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (priority && VALID_PRIORITIES.includes(priority)) where.priority = priority;
    if (roomId) where.roomId = roomId;
    if (equipmentId) where.equipmentId = equipmentId;
    // TECH ne voit que ses propres interventions (sauf admin)
    if (techId) where.techId = techId;
    else if (req.user.role === 'TECH') where.techId = req.user.id;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { title: containsFilter(search) },
        { description: containsFilter(search) }
      ];
    }
    if (source && ['INTERNAL', 'PUBLIC'].includes(source)) where.source = source;

    const [interventions, total] = await Promise.all([
      prisma.intervention.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: interventionInclude
      }),
      prisma.intervention.count({ where })
    ]);

    res.json({
      data: interventions.map(parsePhotos),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) { next(err); }
});

// GET /api/interventions/room/:roomId - Historique d'une salle
router.get('/room/:roomId', requireAuth, async (req, res, next) => {
  try {
    const interventions = await prisma.intervention.findMany({
      where: { roomId: req.params.roomId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: interventionInclude
    });
    res.json(interventions.map(parsePhotos));
  } catch (err) { next(err); }
});

// GET /api/interventions/equipment/:equipId - Historique d'un équipement
router.get('/equipment/:equipId', requireAuth, async (req, res, next) => {
  try {
    const interventions = await prisma.intervention.findMany({
      where: { equipmentId: req.params.equipId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: interventionInclude
    });
    res.json(interventions.map(parsePhotos));
  } catch (err) { next(err); }
});

// GET /api/interventions/:id - Détail
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      include: interventionInclude
    });
    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    // TECH ne peut voir que ses propres interventions
    if (req.user.role === 'TECH' && intervention.techId !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    res.json(parsePhotos(intervention));
  } catch (err) { next(err); }
});

// POST /api/interventions - Créer
router.post('/',
  requireAuth,
  [
    body('title').trim().isLength({ min: 3, max: 300 }),
    body('status').optional().isIn(VALID_STATUSES),
    body('priority').optional().isIn(VALID_PRIORITIES),
    body('roomId').optional().isUUID(),
    body('equipmentId').optional().isUUID()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { title, description, status, priority, roomId, equipmentId, techId } = req.body;

      // TECH peut seulement créer pour lui-même
      const assignedTechId = req.user.role === 'ADMIN' && techId ? techId : req.user.id;

      const intervention = await prisma.intervention.create({
        data: {
          title,
          description: description || null,
          status: status || 'OPEN',
          priority: priority || 'NORMAL',
          roomId: roomId || null,
          equipmentId: equipmentId || null,
          techId: assignedTechId
        },
        include: interventionInclude
      });

      // Mettre l'équipement en REPAIR si intervention ouverte
      if (equipmentId && (!status || status === 'OPEN' || status === 'IN_PROGRESS')) {
        await prisma.equipment.updateMany({
          where: { id: equipmentId, status: 'ACTIVE' },
          data: { status: 'REPAIR' }
        });
      }

      res.status(201).json(parsePhotos(intervention));
    } catch (err) { next(err); }
  }
);

// PATCH /api/interventions/:id - Modifier statut/description
router.patch('/:id',
  requireAuth,
  [
    body('status').optional().isIn(VALID_STATUSES),
    body('priority').optional().isIn(VALID_PRIORITIES)
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.intervention.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Intervention introuvable' });
      if (req.user.role === 'TECH' && existing.techId !== req.user.id) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      const { title, description, status, priority, resolution } = req.body;
      const data = {};
      if (title !== undefined) data.title = title;
      if (description !== undefined) data.description = description;
      if (status !== undefined) {
        data.status = status;
        if (status === 'CLOSED' || status === 'RESOLVED') {
          data.closedAt = new Date();
        }
      }
      if (priority !== undefined) data.priority = priority;
      if (resolution !== undefined) data.resolution = resolution;

      const intervention = await prisma.intervention.update({
        where: { id: req.params.id },
        data,
        include: interventionInclude
      });

      // Remettre l'équipement en ACTIVE si intervention résolue/fermée
      if ((status === 'RESOLVED' || status === 'CLOSED') && existing.equipmentId) {
        await prisma.equipment.updateMany({
          where: { id: existing.equipmentId, status: 'REPAIR' },
          data: { status: 'ACTIVE' }
        });
      }

      res.json(parsePhotos(intervention));
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Intervention introuvable' });
      next(err);
    }
  }
);

// POST /api/interventions/:id/photos - Ajouter des photos
router.post('/:id/photos',
  requireAuth,
  uploadPhoto.array('photos', 10),
  async (req, res, next) => {
    try {
      const existing = await prisma.intervention.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Intervention introuvable' });
      if (req.user.role === 'TECH' && existing.techId !== req.user.id) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Aucun fichier fourni' });
      }

      const photoPaths = req.files.map(f => `/uploads/photos/${f.filename}`);
      const current = Array.isArray(existing.photos) ? existing.photos : JSON.parse(existing.photos || '[]');
      const merged = [...current, ...photoPaths];
      const intervention = await prisma.intervention.update({
        where: { id: req.params.id },
        data: { photos: JSON.stringify(merged) },
        include: interventionInclude
      });

      res.json({ message: `${req.files.length} photo(s) ajoutée(s)`, intervention: parsePhotos(intervention) });
    } catch (err) { next(err); }
  }
);

// DELETE /api/interventions/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.intervention.delete({ where: { id: req.params.id } });
    res.json({ message: 'Intervention supprimée' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Intervention introuvable' });
    next(err);
  }
});

module.exports = router;
