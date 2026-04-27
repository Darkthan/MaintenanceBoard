const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const CARD_INCLUDE = {
  assignee: { select: { id: true, name: true } }
};

const PROJECT_FULL_INCLUDE = {
  creator: { select: { id: true, name: true } },
  columns: {
    orderBy: { position: 'asc' },
    include: {
      cards: {
        orderBy: { position: 'asc' },
        include: CARD_INCLUDE
      }
    }
  }
};

// GET /api/projects
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, name: true } },
        columns: { select: { id: true, _count: { select: { cards: true } } } }
      }
    });
    res.json(projects);
  } catch (err) { next(err); }
});

// POST /api/projects
router.post('/',
  requireAuth,
  body('title').trim().notEmpty().withMessage('Le titre est requis').isLength({ max: 200 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 1000 }),
  body('color').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const project = await prisma.project.create({
        data: {
          title: req.body.title.trim(),
          description: req.body.description?.trim() || null,
          color: req.body.color || '#3b82f6',
          createdBy: req.user.id
        },
        include: PROJECT_FULL_INCLUDE
      });
      res.status(201).json(project);
    } catch (err) { next(err); }
  }
);

// GET /api/projects/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: PROJECT_FULL_INCLUDE
    });
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    res.json(project);
  } catch (err) { next(err); }
});

// PATCH /api/projects/:id
router.patch('/:id',
  requireAuth,
  body('title').optional().trim().notEmpty().isLength({ max: 200 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 1000 }),
  body('color').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) return res.status(404).json({ error: 'Projet introuvable' });

      const data = {};
      if (req.body.title) data.title = req.body.title.trim();
      if (req.body.description !== undefined) data.description = req.body.description?.trim() || null;
      if (req.body.color) data.color = req.body.color;

      const updated = await prisma.project.update({
        where: { id: req.params.id },
        data,
        include: PROJECT_FULL_INCLUDE
      });
      res.json(updated);
    } catch (err) { next(err); }
  }
);

// DELETE /api/projects/:id (admin only)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé' });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ message: 'Projet supprimé' });
  } catch (err) { next(err); }
});

// ── Colonnes ──────────────────────────────────────────────────────────────────

// POST /api/projects/:id/columns
router.post('/:id/columns',
  requireAuth,
  body('title').trim().notEmpty().withMessage('Le titre est requis').isLength({ max: 100 }),
  body('color').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) return res.status(404).json({ error: 'Projet introuvable' });

      const last = await prisma.kanbanColumn.findFirst({
        where: { projectId: req.params.id },
        orderBy: { position: 'desc' }
      });

      const column = await prisma.kanbanColumn.create({
        data: {
          projectId: req.params.id,
          title: req.body.title.trim(),
          color: req.body.color || '#6b7280',
          position: (last?.position ?? -1) + 1
        },
        include: { cards: { include: CARD_INCLUDE } }
      });
      res.status(201).json(column);
    } catch (err) { next(err); }
  }
);

// PATCH /api/projects/:id/columns/:colId
router.patch('/:id/columns/:colId',
  requireAuth,
  body('title').optional().trim().notEmpty().isLength({ max: 100 }),
  body('color').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const col = await prisma.kanbanColumn.findFirst({
        where: { id: req.params.colId, projectId: req.params.id }
      });
      if (!col) return res.status(404).json({ error: 'Colonne introuvable' });

      const data = {};
      if (req.body.title) data.title = req.body.title.trim();
      if (req.body.color !== undefined) data.color = req.body.color;

      const updated = await prisma.kanbanColumn.update({
        where: { id: req.params.colId },
        data,
        include: { cards: { orderBy: { position: 'asc' }, include: CARD_INCLUDE } }
      });
      res.json(updated);
    } catch (err) { next(err); }
  }
);

// DELETE /api/projects/:id/columns/:colId
router.delete('/:id/columns/:colId', requireAuth, async (req, res, next) => {
  try {
    const col = await prisma.kanbanColumn.findFirst({
      where: { id: req.params.colId, projectId: req.params.id }
    });
    if (!col) return res.status(404).json({ error: 'Colonne introuvable' });
    await prisma.kanbanColumn.delete({ where: { id: req.params.colId } });
    res.json({ message: 'Colonne supprimée' });
  } catch (err) { next(err); }
});

// POST /api/projects/:id/columns/reorder — body: { columnIds: [...] }
router.post('/:id/columns/reorder', requireAuth, async (req, res, next) => {
  try {
    const { columnIds } = req.body;
    if (!Array.isArray(columnIds)) return res.status(400).json({ error: 'columnIds requis' });

    await prisma.$transaction(
      columnIds.map((colId, idx) =>
        prisma.kanbanColumn.updateMany({
          where: { id: colId, projectId: req.params.id },
          data: { position: idx }
        })
      )
    );
    res.json({ message: 'Colonnes réordonnées' });
  } catch (err) { next(err); }
});

// ── Cartes ────────────────────────────────────────────────────────────────────

// POST /api/projects/:id/cards
router.post('/:id/cards',
  requireAuth,
  body('columnId').notEmpty().withMessage('columnId requis'),
  body('title').trim().notEmpty().withMessage('Le titre est requis').isLength({ max: 300 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 2000 }),
  body('priority').optional().isIn(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']),
  body('dueDate').optional({ nullable: true }).isISO8601(),
  body('assigneeId').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const col = await prisma.kanbanColumn.findFirst({
        where: { id: req.body.columnId, projectId: req.params.id }
      });
      if (!col) return res.status(404).json({ error: 'Colonne introuvable' });

      const last = await prisma.kanbanCard.findFirst({
        where: { columnId: req.body.columnId },
        orderBy: { position: 'desc' }
      });

      const card = await prisma.kanbanCard.create({
        data: {
          columnId: req.body.columnId,
          projectId: req.params.id,
          title: req.body.title.trim(),
          description: req.body.description?.trim() || null,
          priority: req.body.priority || 'NORMAL',
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          assigneeId: req.body.assigneeId || null,
          position: (last?.position ?? -1) + 1
        },
        include: CARD_INCLUDE
      });
      res.status(201).json(card);
    } catch (err) { next(err); }
  }
);

// PATCH /api/projects/:id/cards/:cardId
router.patch('/:id/cards/:cardId', requireAuth, async (req, res, next) => {
  try {
    const card = await prisma.kanbanCard.findFirst({
      where: { id: req.params.cardId, projectId: req.params.id }
    });
    if (!card) return res.status(404).json({ error: 'Carte introuvable' });

    const data = {};
    if (typeof req.body.title === 'string') {
      const t = req.body.title.trim();
      if (!t) return res.status(400).json({ error: 'Le titre est requis' });
      data.title = t;
    }
    if (req.body.description !== undefined) data.description = req.body.description?.trim() || null;
    if (req.body.priority && ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(req.body.priority)) {
      data.priority = req.body.priority;
    }
    if (req.body.dueDate !== undefined) data.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    if (req.body.assigneeId !== undefined) data.assigneeId = req.body.assigneeId || null;

    const updated = await prisma.kanbanCard.update({
      where: { id: req.params.cardId },
      data,
      include: CARD_INCLUDE
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/projects/:id/cards/:cardId
router.delete('/:id/cards/:cardId', requireAuth, async (req, res, next) => {
  try {
    const card = await prisma.kanbanCard.findFirst({
      where: { id: req.params.cardId, projectId: req.params.id }
    });
    if (!card) return res.status(404).json({ error: 'Carte introuvable' });
    await prisma.kanbanCard.delete({ where: { id: req.params.cardId } });
    res.json({ message: 'Carte supprimée' });
  } catch (err) { next(err); }
});

// POST /api/projects/:id/cards/move — { cardId, toColumnId, cardIds: [...ordered] }
router.post('/:id/cards/move', requireAuth, async (req, res, next) => {
  try {
    const { cardId, toColumnId, cardIds } = req.body;
    if (!cardId || !toColumnId || !Array.isArray(cardIds)) {
      return res.status(400).json({ error: 'cardId, toColumnId et cardIds requis' });
    }

    const col = await prisma.kanbanColumn.findFirst({
      where: { id: toColumnId, projectId: req.params.id }
    });
    if (!col) return res.status(404).json({ error: 'Colonne cible introuvable' });

    await prisma.$transaction([
      prisma.kanbanCard.update({
        where: { id: cardId },
        data: { columnId: toColumnId }
      }),
      ...cardIds.map((id, idx) =>
        prisma.kanbanCard.updateMany({
          where: { id, projectId: req.params.id },
          data: { position: idx }
        })
      )
    ]);

    res.json({ message: 'Carte déplacée' });
  } catch (err) { next(err); }
});

module.exports = router;
