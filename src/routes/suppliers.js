const express = require('express');
const { body, validationResult } = require('express-validator');
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

// GET /api/suppliers - Liste tous les fournisseurs
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { q } = req.query;

    const where = {};
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { contact: { contains: q } },
        { email: { contains: q } }
      ];
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { orders: true } } }
    });

    res.json(suppliers);
  } catch (err) { next(err); }
});

// GET /api/suppliers/:id - Détail
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { orders: true } } }
    });
    if (!supplier) return res.status(404).json({ error: 'Fournisseur introuvable' });
    res.json(supplier);
  } catch (err) { next(err); }
});

// POST /api/suppliers - Créer
router.post('/',
  requireAuth,
  requireAdmin,
  [
    body('name').trim().isLength({ min: 1, max: 300 }).withMessage('Le nom est requis'),
    body('contact').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Email invalide'),
    body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
    body('website').optional({ values: 'falsy' }).trim().isURL({ require_protocol: true }).withMessage('URL invalide'),
    body('address').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 1000 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { name, contact, email, phone, website, address, notes } = req.body;

      const supplier = await prisma.supplier.create({
        data: {
          name,
          contact: contact || null,
          email: email || null,
          phone: phone || null,
          website: website || null,
          address: address || null,
          notes: notes || null
        },
        include: { _count: { select: { orders: true } } }
      });

      res.status(201).json(supplier);
    } catch (err) { next(err); }
  }
);

// PATCH /api/suppliers/:id - Modifier
router.patch('/:id',
  requireAuth,
  requireAdmin,
  [
    body('name').optional().trim().isLength({ min: 1, max: 300 }).withMessage('Le nom est requis'),
    body('contact').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Email invalide'),
    body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
    body('website').optional({ values: 'falsy' }).trim().isURL({ require_protocol: true }).withMessage('URL invalide'),
    body('address').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 1000 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Fournisseur introuvable' });

      const { name, contact, email, phone, website, address, notes } = req.body;
      const data = {};
      if (name !== undefined) data.name = name;
      if (contact !== undefined) data.contact = contact || null;
      if (email !== undefined) data.email = email || null;
      if (phone !== undefined) data.phone = phone || null;
      if (website !== undefined) data.website = website || null;
      if (address !== undefined) data.address = address || null;
      if (notes !== undefined) data.notes = notes || null;

      const supplier = await prisma.supplier.update({
        where: { id: req.params.id },
        data,
        include: { _count: { select: { orders: true } } }
      });

      res.json(supplier);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Fournisseur introuvable' });
      next(err);
    }
  }
);

// DELETE /api/suppliers/:id - Supprimer
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { orders: true } } }
    });
    if (!supplier) return res.status(404).json({ error: 'Fournisseur introuvable' });

    if (supplier._count.orders > 0) {
      return res.status(409).json({
        error: `Impossible de supprimer ce fournisseur : ${supplier._count.orders} commande(s) lui sont associées.`
      });
    }

    await prisma.supplier.delete({ where: { id: req.params.id } });
    res.json({ message: 'Fournisseur supprimé' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Fournisseur introuvable' });
    next(err);
  }
});

module.exports = router;
