const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

const prisma = new PrismaClient();

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

const VALID_STATUSES = ['PENDING', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED'];
const VALID_PRICE_TYPES = ['TTC', 'HT'];

const orderInclude = {
  requester: { select: { id: true, name: true, email: true } },
  items: true
};

// GET /api/orders - Liste
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { status, search } = req.query;

    const where = {};
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { supplier: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          requester: { select: { id: true, name: true } },
          _count: { select: { items: true } }
        }
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      data: orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) { next(err); }
});

// GET /api/orders/:id - Détail
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude
    });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    res.json(order);
  } catch (err) { next(err); }
});

// POST /api/orders - Créer
router.post('/',
  requireAuth,
  [
    body('title').trim().isLength({ min: 3, max: 300 }),
    body('items').isArray({ min: 1 }),
    body('items.*.name').trim().isLength({ min: 1 }),
    body('items.*.quantity').isInt({ min: 1 }),
    body('items.*.priceType').optional().isIn(VALID_PRICE_TYPES),
    body('items.*.productUrl').optional({ values: 'falsy' }).isURL({ require_protocol: true })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { title, description, supplier, items } = req.body;

      const order = await prisma.order.create({
        data: {
          title,
          description: description || null,
          supplier: supplier || null,
          requestedBy: req.user.id,
          items: {
            create: items.map(item => ({
              name: item.name,
              quantity: parseInt(item.quantity),
              unitPrice: item.unitPrice ? parseFloat(item.unitPrice) : null,
              priceType: VALID_PRICE_TYPES.includes(item.priceType) ? item.priceType : 'TTC',
              reference: item.reference || null,
              productUrl: item.productUrl || null,
              notes: item.notes || null
            }))
          }
        },
        include: orderInclude
      });

      res.status(201).json(order);
    } catch (err) { next(err); }
  }
);

// PATCH /api/orders/:id - Modifier statut
router.patch('/:id',
  requireAuth,
  [
    body('status').optional().isIn(VALID_STATUSES),
    body('items').optional().isArray({ min: 1 }),
    body('items.*.name').optional().trim().isLength({ min: 1 }),
    body('items.*.quantity').optional().isInt({ min: 1 }),
    body('items.*.priceType').optional().isIn(VALID_PRICE_TYPES),
    body('items.*.productUrl').optional({ values: 'falsy' }).isURL({ require_protocol: true })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { title, description, supplier, status, items } = req.body;
      const data = {};
      if (title !== undefined) data.title = title;
      if (description !== undefined) data.description = description;
      if (supplier !== undefined) data.supplier = supplier;
      if (status !== undefined) {
        data.status = status;
        if (status === 'ORDERED') data.orderedAt = new Date();
        if (status === 'RECEIVED') data.receivedAt = new Date();
      }
      if (items !== undefined) {
        data.items = {
          deleteMany: {},
          create: items.map(item => ({
            name: item.name,
            quantity: parseInt(item.quantity),
            unitPrice: item.unitPrice ? parseFloat(item.unitPrice) : null,
            priceType: VALID_PRICE_TYPES.includes(item.priceType) ? item.priceType : 'TTC',
            reference: item.reference || null,
            productUrl: item.productUrl || null,
            notes: item.notes || null
          }))
        };
      }

      const order = await prisma.order.update({
        where: { id: req.params.id },
        data,
        include: orderInclude
      });
      res.json(order);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Commande introuvable' });
      next(err);
    }
  }
);

// DELETE /api/orders/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.order.delete({ where: { id: req.params.id } });
    res.json({ message: 'Commande supprimée' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Commande introuvable' });
    next(err);
  }
});

// POST /api/orders/:id/items - Ajouter une ligne
router.post('/:id/items',
  requireAuth,
  [
    body('name').trim().isLength({ min: 1 }),
    body('quantity').isInt({ min: 1 }),
    body('priceType').optional().isIn(VALID_PRICE_TYPES),
    body('productUrl').optional({ values: 'falsy' }).isURL({ require_protocol: true })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { name, quantity, unitPrice, reference, notes } = req.body;

      const item = await prisma.orderItem.create({
        data: {
          orderId: req.params.id,
          name,
          quantity: parseInt(quantity),
          unitPrice: unitPrice ? parseFloat(unitPrice) : null,
          priceType: VALID_PRICE_TYPES.includes(req.body.priceType) ? req.body.priceType : 'TTC',
          reference: reference || null,
          productUrl: req.body.productUrl || null,
          notes: notes || null
        }
      });
      res.status(201).json(item);
    } catch (err) {
      if (err.code === 'P2003') return res.status(404).json({ error: 'Commande introuvable' });
      next(err);
    }
  }
);

// PATCH /api/orders/:orderId/items/:itemId - Modifier une ligne (réception partielle)
router.patch('/:orderId/items/:itemId', requireAuth, async (req, res, next) => {
  try {
    const { received, quantity, unitPrice, notes, priceType, productUrl, reference } = req.body;
    const data = {};
    if (received !== undefined) data.received = parseInt(received);
    if (quantity !== undefined) data.quantity = parseInt(quantity);
    if (unitPrice !== undefined) data.unitPrice = unitPrice ? parseFloat(unitPrice) : null;
    if (notes !== undefined) data.notes = notes;
    if (priceType !== undefined) data.priceType = VALID_PRICE_TYPES.includes(priceType) ? priceType : 'TTC';
    if (productUrl !== undefined) data.productUrl = productUrl || null;
    if (reference !== undefined) data.reference = reference || null;

    const item = await prisma.orderItem.update({
      where: { id: req.params.itemId },
      data
    });
    res.json(item);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ligne introuvable' });
    next(err);
  }
});

// DELETE /api/orders/:orderId/items/:itemId
router.delete('/:orderId/items/:itemId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.orderItem.delete({ where: { id: req.params.itemId } });
    res.json({ message: 'Ligne supprimée' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ligne introuvable' });
    next(err);
  }
});

module.exports = router;
