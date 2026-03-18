const express = require('express');
const { body, query, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

// GET /api/stock/categories — liste des catégories uniques
router.get('/categories', requireAuth, async (req, res, next) => {
  try {
    const items = await prisma.stockItem.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' }
    });
    res.json(items.map(i => i.category).filter(Boolean));
  } catch (err) { next(err); }
});

// GET /api/stock/alerts — articles avec quantity <= minQuantity
router.get('/alerts', requireAuth, async (req, res, next) => {
  try {
    // SQLite doesn't support column comparisons in where clause directly via Prisma
    // We use a raw approach: fetch all and filter
    const all = await prisma.stockItem.findMany({
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' }
    });
    const items = all.filter(i => i.quantity <= i.minQuantity);
    res.json({ count: items.length, items });
  } catch (err) { next(err); }
});

// GET /api/stock — liste
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { q, category, lowStock } = req.query;

    const where = {};
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { reference: { contains: q } },
        { category: { contains: q } }
      ];
    }
    if (category) {
      where.category = category;
    }

    const items = await prisma.stockItem.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        supplier: { select: { id: true, name: true } },
        _count: { select: { movements: true } }
      }
    });

    const result = lowStock === 'true'
      ? items.filter(i => i.quantity <= i.minQuantity)
      : items;

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/stock/:id — détail
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const item = await prisma.stockItem.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: { select: { id: true, name: true } },
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { user: { select: { id: true, name: true } } }
        }
      }
    });
    if (!item) return res.status(404).json({ error: 'Article introuvable' });
    res.json(item);
  } catch (err) { next(err); }
});

// POST /api/stock — créer
router.post('/',
  requireAuth,
  requireAdmin,
  [
    body('name').trim().isLength({ min: 1, max: 300 }).withMessage('Le nom est requis'),
    body('reference').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('category').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
    body('quantity').optional().isInt({ min: 0 }).withMessage('La quantité doit être un entier positif'),
    body('minQuantity').optional().isInt({ min: 0 }).withMessage('Le seuil doit être un entier positif'),
    body('unitCost').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Le coût unitaire doit être positif'),
    body('location').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('supplierId').optional({ values: 'falsy' }).isString()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { name, reference, category, description, quantity, minQuantity, unitCost, location, supplierId } = req.body;

      const item = await prisma.stockItem.create({
        data: {
          name,
          reference: reference || null,
          category: category || null,
          description: description || null,
          quantity: quantity !== undefined ? parseInt(quantity) : 0,
          minQuantity: minQuantity !== undefined ? parseInt(minQuantity) : 0,
          unitCost: unitCost !== undefined && unitCost !== null && unitCost !== '' ? parseFloat(unitCost) : null,
          location: location || null,
          supplierId: supplierId || null
        },
        include: {
          supplier: { select: { id: true, name: true } },
          _count: { select: { movements: true } }
        }
      });

      res.status(201).json(item);
    } catch (err) { next(err); }
  }
);

// PATCH /api/stock/:id — modifier
router.patch('/:id',
  requireAuth,
  requireAdmin,
  [
    body('name').optional().trim().isLength({ min: 1, max: 300 }).withMessage('Le nom est requis'),
    body('reference').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('category').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
    body('quantity').optional().isInt({ min: 0 }).withMessage('La quantité doit être un entier positif'),
    body('minQuantity').optional().isInt({ min: 0 }).withMessage('Le seuil doit être un entier positif'),
    body('unitCost').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Le coût unitaire doit être positif'),
    body('location').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('supplierId').optional({ values: 'falsy' }).isString()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.stockItem.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Article introuvable' });

      const { name, reference, category, description, quantity, minQuantity, unitCost, location, supplierId } = req.body;
      const data = {};
      if (name !== undefined) data.name = name;
      if (reference !== undefined) data.reference = reference || null;
      if (category !== undefined) data.category = category || null;
      if (description !== undefined) data.description = description || null;
      if (quantity !== undefined) data.quantity = parseInt(quantity);
      if (minQuantity !== undefined) data.minQuantity = parseInt(minQuantity);
      if (unitCost !== undefined) data.unitCost = unitCost !== null && unitCost !== '' ? parseFloat(unitCost) : null;
      if (location !== undefined) data.location = location || null;
      if (supplierId !== undefined) data.supplierId = supplierId || null;

      const item = await prisma.stockItem.update({
        where: { id: req.params.id },
        data,
        include: {
          supplier: { select: { id: true, name: true } },
          _count: { select: { movements: true } }
        }
      });

      res.json(item);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Article introuvable' });
      next(err);
    }
  }
);

// DELETE /api/stock/:id — supprimer
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Article introuvable' });

    await prisma.stockItem.delete({ where: { id: req.params.id } });
    res.json({ message: 'Article supprimé' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Article introuvable' });
    next(err);
  }
});

// POST /api/stock/:id/movements — ajouter un mouvement
router.post('/:id/movements',
  requireAuth,
  [
    body('type').isIn(['IN', 'OUT', 'ADJUSTMENT']).withMessage('Type invalide (IN, OUT ou ADJUSTMENT)'),
    body('quantity').isInt({ min: 1 }).withMessage('La quantité doit être un entier > 0'),
    body('reason').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('interventionId').optional({ values: 'falsy' }).isString()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const item = await prisma.stockItem.findUnique({ where: { id: req.params.id } });
      if (!item) return res.status(404).json({ error: 'Article introuvable' });

      const { type, quantity, reason, interventionId } = req.body;
      const qty = parseInt(quantity);

      let newQuantity;
      if (type === 'IN') {
        newQuantity = item.quantity + qty;
      } else if (type === 'OUT') {
        if (item.quantity < qty) {
          return res.status(409).json({
            error: `Stock insuffisant : ${item.quantity} disponible(s), ${qty} demandé(s)`
          });
        }
        newQuantity = item.quantity - qty;
      } else {
        // ADJUSTMENT : quantity = nouvelle valeur absolue
        newQuantity = qty;
      }

      // Mise à jour atomique
      const [movement] = await prisma.$transaction([
        prisma.stockMovement.create({
          data: {
            stockItemId: req.params.id,
            type,
            quantity: qty,
            reason: reason || null,
            interventionId: interventionId || null,
            userId: req.user.id
          },
          include: { user: { select: { id: true, name: true } } }
        }),
        prisma.stockItem.update({
          where: { id: req.params.id },
          data: { quantity: newQuantity }
        })
      ]);

      res.status(201).json(movement);
    } catch (err) { next(err); }
  }
);

// GET /api/stock/:id/movements — historique des mouvements
router.get('/:id/movements', requireAuth, async (req, res, next) => {
  try {
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Article introuvable' });

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const movements = await prisma.stockMovement.findMany({
      where: { stockItemId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { user: { select: { id: true, name: true } } }
    });

    res.json(movements);
  } catch (err) { next(err); }
});

module.exports = router;
