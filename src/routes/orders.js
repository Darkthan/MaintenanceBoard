const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { readSettings } = require('../utils/settings');
const { createSmtpTransporter } = require('../utils/mail');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const prisma = require('../lib/prisma');
const { containsFilter, isSQLite } = require('../lib/db-utils');
const { runOcr } = require('../utils/ocr');
const orderAttachmentModel = prisma.orderAttachment;

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

const linkedInterventionSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  createdAt: true,
  techId: true,
  room: { select: { id: true, name: true, number: true } },
  equipment: { select: { id: true, name: true, type: true } },
  tech: { select: { id: true, name: true } }
};

const orderInclude = {
  requester: { select: { id: true, name: true, email: true } },
  items: true,
  intervention: { select: linkedInterventionSelect },
  supplierRef: { select: { id: true, name: true } }
};

// Helper pour lire/écrire deploymentTags en JSON string (SQLite) ou Array (PostgreSQL)
function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function serializeTags(tags) {
  if (!Array.isArray(tags)) return isSQLite ? '[]' : [];
  const clean = tags.map(t => String(t).trim()).filter(Boolean);
  return isSQLite ? JSON.stringify(clean) : clean;
}

function withParsedTags(order) {
  if (!order) return order;
  return { ...order, deploymentTags: parseTags(order.deploymentTags) };
}

function toItemData(item) {
  return {
    name: item.name,
    quantity: parseInt(item.quantity),
    unitPrice: item.unitPrice ? parseFloat(item.unitPrice) : null,
    priceType: VALID_PRICE_TYPES.includes(item.priceType) ? item.priceType : 'TTC',
    reference: item.reference || null,
    productUrl: item.productUrl || null,
    assetTag: item.assetTag || null,
    notes: item.notes || null
  };
}

function sanitizeInterventionForUser(intervention, user) {
  if (!intervention) return null;
  if (user?.role === 'TECH' && intervention.techId !== user.id) return null;
  const { techId, ...safeIntervention } = intervention;
  return safeIntervention;
}

function withOrderRelations(order, user) {
  if (!order) return order;
  const parsed = withParsedTags(order);
  return {
    ...parsed,
    intervention: sanitizeInterventionForUser(parsed.intervention, user)
  };
}

async function resolveInterventionLink(interventionId, user) {
  if (interventionId === undefined) return undefined;
  if (!interventionId) return null;

  const intervention = await prisma.intervention.findUnique({
    where: { id: interventionId },
    select: { id: true, techId: true }
  });

  if (!intervention) {
    const err = new Error('Intervention introuvable');
    err.statusCode = 404;
    throw err;
  }

  if (user.role === 'TECH' && intervention.techId !== user.id) {
    const err = new Error('Acces refuse pour cette intervention');
    err.statusCode = 403;
    throw err;
  }

  return intervention.id;
}

// ── Catégories de pièces jointes ─────────────────────────────────────────────
const ATTACH_CATEGORIES = {
  INVOICE:       { label: 'Facture',          color: '#dc2626', bg: '#fee2e2' },
  SIGNED_PO:     { label: 'BC signé',         color: '#16a34a', bg: '#dcfce7' },
  QUOTE_TO_SIGN: { label: 'Devis à signer',   color: '#d97706', bg: '#fef3c7' },
  SIGNED_QUOTE:  { label: 'Devis signé',      color: '#2563eb', bg: '#dbeafe' },
  TO_ENTER:      { label: 'À saisir',         color: '#7c3aed', bg: '#ede9fe' },
  OTHER:         { label: 'Autre',            color: '#64748b', bg: '#f1f5f9' },
};
const VALID_CATEGORIES = Object.keys(ATTACH_CATEGORIES);

// ── Envoi email compta ────────────────────────────────────────────────────────
async function sendAccountingEmail(order, att, filePath) {
  const s = readSettings();
  const po = s.poTemplate || {};
  const toAddresses = (po.accountingEmail || '').split(',').map(e => e.trim()).filter(Boolean);
  const autoCategories = po.autoEmailCategories || [];

  if (!toAddresses.length) return { skipped: true };
  if (!autoCategories.includes(att.category)) return { skipped: true };

  const { transporter, from } = createSmtpTransporter();
  if (!transporter) return { skipped: true };

  const cat = ATTACH_CATEGORIES[att.category] || ATTACH_CATEGORIES.OTHER;
  await transporter.sendMail({
    from,
    to: toAddresses.join(', '),
    subject: `[${cat.label}] ${esc(order.title)} — ${esc(po.orgName || 'MaintenanceBoard')}`,
    html: `<p>Bonjour,</p>
<p>Un document de type <strong>${esc(cat.label)}</strong> a été déposé pour la commande :</p>
<ul>
  <li><strong>Commande :</strong> ${esc(order.title)}</li>
  <li><strong>Fournisseur :</strong> ${esc(order.supplier || '—')}</li>
  <li><strong>Demandeur :</strong> ${esc(order.requester?.name || '—')}</li>
  <li><strong>Fichier :</strong> ${esc(att.filename)}</li>
</ul>
<p style="color:#64748b;font-size:12px">MaintenanceBoard — envoi automatique</p>`,
    attachments: [{ filename: att.filename, path: filePath }]
  });

  return { sent: true, to: toAddresses };
}

// ── Upload pièces jointes ────────────────────────────────────────────────────
const ATTACH_DIR = path.join(process.cwd(), 'uploads', 'attachments');
if (!fs.existsSync(ATTACH_DIR)) fs.mkdirSync(ATTACH_DIR, { recursive: true });

const attachUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 }
});

async function compressFile(buffer, mimetype, originalname) {
  if (mimetype.startsWith('image/') && mimetype !== 'image/svg+xml') {
    const compressed = await sharp(buffer)
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, progressive: true })
      .toBuffer();
    return { buffer: compressed, ext: '.jpg', mimetype: 'image/jpeg' };
  }
  const ext = path.extname(originalname) || '.bin';
  return { buffer, ext, mimetype };
}

function attachmentsUnavailable(res) {
  return res.status(503).json({
    error: 'Les pieces jointes des commandes ne sont pas disponibles tant que Prisma n a pas ete regenere et migre.'
  });
}

function attachmentsTableMissing(err) {
  return err?.code === 'P2021';
}

// GET /api/orders/tags — tous les tags distincts (pré-saisie)
router.get('/tags', requireAuth, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({ select: { deploymentTags: true } });
    const all = new Set();
    for (const o of orders) {
      for (const t of parseTags(o.deploymentTags)) all.add(t);
    }
    res.json([...all].sort((a, b) => a.localeCompare(b)));
  } catch (err) { next(err); }
});

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
        { title: containsFilter(search) },
        { supplier: containsFilter(search) }
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
          intervention: { select: linkedInterventionSelect },
          _count: { select: { items: true } }
        }
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      data: orders.map(order => withOrderRelations(order, req.user)),
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
    res.json(withOrderRelations(order, req.user));
  } catch (err) { next(err); }
});

// POST /api/orders - Créer
router.post('/',
  requireAuth,
  [
    body('title').trim().isLength({ min: 3, max: 300 }),
    body('items').isArray({ min: 1 }),
    body('interventionId').optional({ values: 'falsy' }).isUUID(),
    body('orderedAt').optional({ values: 'falsy' }).isISO8601(),
    body('expectedDeliveryAt').optional({ values: 'falsy' }).isISO8601(),
    body('receivedAt').optional({ values: 'falsy' }).isISO8601(),
    body('items.*.name').trim().isLength({ min: 1 }),
    body('items.*.quantity').isInt({ min: 1 }),
    body('items.*.priceType').optional().isIn(VALID_PRICE_TYPES),
    body('items.*.productUrl').optional({ values: 'falsy' }).isURL({ require_protocol: true })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const {
        title, description, supplier, supplierId, deploymentTags, items, interventionId,
        orderedAt, expectedDeliveryAt, receivedAt, trackingNotes
      } = req.body;
      const linkedInterventionId = await resolveInterventionLink(interventionId, req.user);

      const order = await prisma.order.create({
        data: {
          title,
          description: description || null,
          supplier: supplier || null,
          supplierId: supplierId || null,
          deploymentTags: serializeTags(deploymentTags || []),
          requestedBy: req.user.id,
          interventionId: linkedInterventionId,
          orderedAt: orderedAt ? new Date(orderedAt) : null,
          expectedDeliveryAt: expectedDeliveryAt ? new Date(expectedDeliveryAt) : null,
          receivedAt: receivedAt ? new Date(receivedAt) : null,
          trackingNotes: trackingNotes || null,
          items: { create: items.map(toItemData) }
        },
        include: orderInclude
      });

      res.status(201).json(withOrderRelations(order, req.user));
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  }
);

// PATCH /api/orders/:id - Modifier statut
router.patch('/:id',
  requireAuth,
  [
    body('status').optional().isIn(VALID_STATUSES),
    body('interventionId').optional({ values: 'falsy' }).isUUID(),
    body('orderedAt').optional({ values: 'falsy' }).isISO8601(),
    body('expectedDeliveryAt').optional({ values: 'falsy' }).isISO8601(),
    body('receivedAt').optional({ values: 'falsy' }).isISO8601(),
    body('items').optional().isArray({ min: 1 }),
    body('items.*.name').optional().trim().isLength({ min: 1 }),
    body('items.*.quantity').optional().isInt({ min: 1 }),
    body('items.*.priceType').optional().isIn(VALID_PRICE_TYPES),
    body('items.*.productUrl').optional({ values: 'falsy' }).isURL({ require_protocol: true })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const {
        title, description, supplier, supplierId, deploymentTags, status, items, interventionId,
        orderedAt, expectedDeliveryAt, receivedAt, trackingNotes
      } = req.body;
      const data = {};
      if (title !== undefined) data.title = title;
      if (description !== undefined) data.description = description;
      if (supplier !== undefined) data.supplier = supplier;
      if (supplierId !== undefined) data.supplierId = supplierId || null;
      if (deploymentTags !== undefined) data.deploymentTags = serializeTags(deploymentTags);
      if (interventionId !== undefined) data.interventionId = await resolveInterventionLink(interventionId, req.user);
      if (orderedAt !== undefined) data.orderedAt = orderedAt ? new Date(orderedAt) : null;
      if (expectedDeliveryAt !== undefined) data.expectedDeliveryAt = expectedDeliveryAt ? new Date(expectedDeliveryAt) : null;
      if (receivedAt !== undefined) data.receivedAt = receivedAt ? new Date(receivedAt) : null;
      if (trackingNotes !== undefined) data.trackingNotes = trackingNotes || null;
      if (status !== undefined) {
        data.status = status;
        if (status === 'ORDERED' && orderedAt === undefined) data.orderedAt = new Date();
        if (status === 'RECEIVED' && receivedAt === undefined) data.receivedAt = new Date();
      }
      if (items !== undefined) {
        data.items = { deleteMany: {}, create: items.map(toItemData) };
      }

      const order = await prisma.order.update({
        where: { id: req.params.id },
        data,
        include: orderInclude
      });
      res.json(withOrderRelations(order, req.user));
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
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
      const { name, quantity, unitPrice, reference, notes, assetTag } = req.body;

      const item = await prisma.orderItem.create({
        data: {
          orderId: req.params.id,
          name,
          quantity: parseInt(quantity),
          unitPrice: unitPrice ? parseFloat(unitPrice) : null,
          priceType: VALID_PRICE_TYPES.includes(req.body.priceType) ? req.body.priceType : 'TTC',
          reference: reference || null,
          productUrl: req.body.productUrl || null,
          assetTag: assetTag || null,
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
    const { received, quantity, unitPrice, notes, priceType, productUrl, reference, assetTag } = req.body;
    const data = {};
    if (received !== undefined) data.received = parseInt(received);
    if (quantity !== undefined) data.quantity = parseInt(quantity);
    if (unitPrice !== undefined) data.unitPrice = unitPrice ? parseFloat(unitPrice) : null;
    if (notes !== undefined) data.notes = notes;
    if (priceType !== undefined) data.priceType = VALID_PRICE_TYPES.includes(priceType) ? priceType : 'TTC';
    if (productUrl !== undefined) data.productUrl = productUrl || null;
    if (reference !== undefined) data.reference = reference || null;
    if (assetTag !== undefined) data.assetTag = assetTag || null;

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

// ── Pièces jointes ───────────────────────────────────────────────────────────

// GET /api/orders/:id/attachments
router.get('/:id/attachments', requireAuth, async (req, res, next) => {
  if (!orderAttachmentModel) return res.json([]);
  try {
    const attachments = await orderAttachmentModel.findMany({
      where: { orderId: req.params.id },
      include: { uploader: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(attachments);
  } catch (err) {
    if (attachmentsTableMissing(err)) return res.json([]);
    next(err);
  }
});

// POST /api/orders/:id/attachments
router.post('/:id/attachments', requireAuth, attachUpload.array('files', 5), async (req, res, next) => {
  if (!orderAttachmentModel) return attachmentsUnavailable(res);
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        title: true,
        supplier: true,
        requester: { select: { name: true } }
      }
    });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (!req.files?.length) return res.status(400).json({ error: 'Aucun fichier reçu' });

    const orderDir = path.join(ATTACH_DIR, req.params.id);
    await fsp.mkdir(orderDir, { recursive: true });

    const category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : 'OTHER';

    const rawDisplayName = typeof req.body.displayName === 'string'
      ? req.body.displayName.trim().replace(/[/\\]/g, '').slice(0, 255)
      : null;

    const created = [];
    for (const file of req.files) {
      const { buffer, ext, mimetype } = await compressFile(file.buffer, file.mimetype, file.originalname);
      const storedAs = uuidv4() + ext;
      const filePath = path.join(orderDir, storedAs);
      await fsp.writeFile(filePath, buffer);
      const record = await orderAttachmentModel.create({
        data: {
          orderId: req.params.id,
          filename: rawDisplayName || file.originalname,
          storedAs,
          mimetype,
          size: buffer.length,
          category,
          uploadedBy: req.user.id
        },
        include: { uploader: { select: { name: true } } }
      });
      created.push(record);
      // Envoi email auto si catégorie concernée (non bloquant)
      sendAccountingEmail(order, record, filePath).catch(() => {});
      // OCR en arrière-plan (non bloquant)
      setImmediate(() => runOcr(record.id, mimetype, filePath).catch(() => {}));
    }
    res.status(201).json(created);
  } catch (err) {
    if (attachmentsTableMissing(err)) return attachmentsUnavailable(res);
    next(err);
  }
});

// GET /api/orders/:id/attachments/:attachId  (téléchargement)
router.get('/:id/attachments/:attachId', requireAuth, async (req, res, next) => {
  if (!orderAttachmentModel) return attachmentsUnavailable(res);
  try {
    const att = await orderAttachmentModel.findUnique({ where: { id: req.params.attachId } });
    if (!att || att.orderId !== req.params.id) return res.status(404).json({ error: 'Fichier introuvable' });
    const filePath = path.join(ATTACH_DIR, att.orderId, att.storedAs);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier manquant sur le disque' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.filename)}"`);
    res.setHeader('Content-Type', att.mimetype);
    res.sendFile(filePath);
  } catch (err) {
    if (attachmentsTableMissing(err)) return attachmentsUnavailable(res);
    next(err);
  }
});

// DELETE /api/orders/:id/attachments/:attachId
router.delete('/:id/attachments/:attachId', requireAuth, async (req, res, next) => {
  if (!orderAttachmentModel) return attachmentsUnavailable(res);
  try {
    const att = await orderAttachmentModel.findUnique({ where: { id: req.params.attachId } });
    if (!att || att.orderId !== req.params.id) return res.status(404).json({ error: 'Fichier introuvable' });
    const filePath = path.join(ATTACH_DIR, att.orderId, att.storedAs);
    await fsp.unlink(filePath).catch(() => {});
    await orderAttachmentModel.delete({ where: { id: req.params.attachId } });
    res.json({ message: 'Fichier supprimé' });
  } catch (err) {
    if (attachmentsTableMissing(err)) return attachmentsUnavailable(res);
    next(err);
  }
});

// PATCH /api/orders/:id/attachments/:attachId  (changer catégorie et/ou renommer)
router.patch('/:id/attachments/:attachId', requireAuth, async (req, res, next) => {
  if (!orderAttachmentModel) return attachmentsUnavailable(res);
  try {
    const { category, filename } = req.body;
    const data = {};

    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Catégorie invalide' });
      data.category = category;
    }
    if (filename !== undefined) {
      const clean = String(filename).trim().replace(/[/\\]/g, '').slice(0, 255);
      if (!clean) return res.status(400).json({ error: 'Nom de fichier invalide' });
      data.filename = clean;
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Aucun champ à modifier' });

    const att = await orderAttachmentModel.findUnique({ where: { id: req.params.attachId } });
    if (!att || att.orderId !== req.params.id) return res.status(404).json({ error: 'Fichier introuvable' });

    const updated = await orderAttachmentModel.update({
      where: { id: req.params.attachId },
      data,
      include: { uploader: { select: { name: true } } }
    });

    // Déclencher email auto si la catégorie a changé
    if (category !== undefined) {
      const filePath = path.join(ATTACH_DIR, att.orderId, att.storedAs);
      const order = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { requester: { select: { name: true } } }
      });
      sendAccountingEmail(order, updated, filePath).catch(() => {});
    }

    res.json(updated);
  } catch (err) {
    if (attachmentsTableMissing(err)) return attachmentsUnavailable(res);
    next(err);
  }
});

// POST /api/orders/:id/attachments/:attachId/send-email  (envoi manuel)
router.post('/:id/attachments/:attachId/send-email', requireAuth, async (req, res, next) => {
  if (!orderAttachmentModel) return attachmentsUnavailable(res);
  try {
    const att = await orderAttachmentModel.findUnique({ where: { id: req.params.attachId } });
    if (!att || att.orderId !== req.params.id) return res.status(404).json({ error: 'Fichier introuvable' });

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { requester: { select: { name: true } } }
    });
    const filePath = path.join(ATTACH_DIR, att.orderId, att.storedAs);

    // Pour l'envoi manuel, ignorer le filtre de catégorie
    const po = readSettings().poTemplate || {};
    const toRaw = req.body.to || po.accountingEmail || '';
    const toAddresses = toRaw.split(',').map(e => e.trim()).filter(Boolean);
    if (!toAddresses.length) return res.status(400).json({ error: 'Aucune adresse email destinataire configurée' });

    const { transporter, from } = createSmtpTransporter();
    if (!transporter) return res.status(400).json({ error: 'SMTP non configuré (voir Paramètres → Emails)' });

    const cat = ATTACH_CATEGORIES[att.category] || ATTACH_CATEGORIES.OTHER;
    await transporter.sendMail({
      from,
      to: toAddresses.join(', '),
      subject: `[${esc(cat.label)}] ${esc(order.title)} — ${esc(po.orgName || 'MaintenanceBoard')}`,
      html: `<p>Bonjour,</p>
<p>Veuillez trouver ci-joint le document <strong>${esc(cat.label)}</strong> pour la commande :</p>
<ul>
  <li><strong>Commande :</strong> ${esc(order.title)}</li>
  <li><strong>Fournisseur :</strong> ${esc(order.supplier || '—')}</li>
  <li><strong>Demandeur :</strong> ${esc(order.requester?.name || '—')}</li>
  <li><strong>Fichier :</strong> ${esc(att.filename)}</li>
</ul>
<p style="color:#64748b;font-size:12px">MaintenanceBoard</p>`,
      attachments: [{ filename: att.filename, path: filePath }]
    });

    res.json({ message: `Email envoyé à ${toAddresses.join(', ')}` });
  } catch (err) {
    if (attachmentsTableMissing(err)) return attachmentsUnavailable(res);
    next(err);
  }
});

// GET /api/orders/attachment-categories  (méta pour le frontend)
router.get('/attachment-categories', requireAuth, (req, res) => {
  res.json(ATTACH_CATEGORIES);
});

// ── Bon de commande (HTML print) ────────────────────────────────────────────

// GET /api/orders/:id/pdf
router.get('/:id/pdf', requireAuth, async (req, res, next) => {
  try {
    const rawOrder = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: orderInclude
    });
    if (!rawOrder) return res.status(404).json({ error: 'Commande introuvable' });
    const order = withParsedTags(rawOrder);

    const tpl = { ...{ orgName: '', orgAddress: '', orgCity: '', orgPhone: '', orgEmail: '', orgSiret: '', tvaRate: 20, currency: 'EUR', poPrefix: 'BC-', paymentTerms: '30 jours net', footerNote: '' }, ...(readSettings().poTemplate || {}) };

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(generatePOHtml(order, tpl));
  } catch (err) { next(err); }
});

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname + (u.search || '');
    return u.hostname + (path.length > 32 ? path.slice(0, 32) + '…' : path);
  } catch { return url.length > 40 ? url.slice(0, 40) + '…' : url; }
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtCurrency(n, currency) {
  if (n == null) return '-';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency || 'EUR' }).format(n);
}

function generatePOHtml(order, tpl) {
  const currency = tpl.currency || 'EUR';
  const tvaRate = parseFloat(tpl.tvaRate) || 20;

  let totalHT = 0, totalTTC = 0;
  const rows = (order.items || []).map((item, idx) => {
    const qty = item.quantity || 0;
    const price = item.unitPrice;
    let lineHT = null, lineTTC = null;
    if (price != null) {
      if (item.priceType === 'HT') {
        lineHT = qty * price;
        lineTTC = lineHT * (1 + tvaRate / 100);
      } else {
        lineTTC = qty * price;
        lineHT = lineTTC / (1 + tvaRate / 100);
      }
      totalHT += lineHT;
      totalTTC += lineTTC;
    }
    return { item, idx: idx + 1, qty, price, lineHT, lineTTC };
  });

  const tva = totalTTC - totalHT;
  const hasPrice = rows.some(r => r.price != null);
  const orderNum = tpl.poPrefix + new Date(order.createdAt).getFullYear() + '-' + order.id.slice(-6).toUpperCase();

  const statusColors = {
    PENDING:   { bg: '#fef9c3', color: '#854d0e', label: 'En attente' },
    ORDERED:   { bg: '#dbeafe', color: '#1e40af', label: 'Commandé' },
    PARTIAL:   { bg: '#ffedd5', color: '#9a3412', label: 'Partiel' },
    RECEIVED:  { bg: '#dcfce7', color: '#166534', label: 'Reçu' },
    CANCELLED: { bg: '#fee2e2', color: '#991b1b', label: 'Annulé' },
  };
  const st = statusColors[order.status] || { bg: '#f1f5f9', color: '#475569', label: order.status };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Bon de commande ${esc(orderNum)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Inter,-apple-system,'Segoe UI',system-ui,Arial,sans-serif;font-size:12px;background:#e5e7ff;color:#0f172a;line-height:1.5}
    .screen-bar{background:linear-gradient(120deg,#4f46e5,#2563eb);border:none;color:#fff;padding:14px 32px;display:flex;align-items:center;justify-content:space-between;gap:16px;box-shadow:0 10px 30px rgba(15,23,42,.2)}
    .screen-bar button{background:#fff;color:#111827;border:none;border-radius:999px;padding:10px 22px;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,.2);transition:transform .2s}
    .screen-bar button:hover{transform:translateY(-1px)}
    .screen-bar span{font-size:12px;opacity:.9}
    .print-page{max-width:900px;margin:24px auto 48px;padding:0}
    .page-card{background:#fff;border-radius:28px;overflow:hidden;box-shadow:0 35px 80px rgba(15,23,42,.25);border:1px solid rgba(99,102,241,.2)}
    .page-splash{height:60px;background:linear-gradient(90deg,#4338ca,#6366f1);border-radius:28px 28px 0 0}
    .po-header{padding:28px 36px 24px;display:flex;flex-wrap:wrap;gap:22px;border-bottom:1px solid #e5e7ff}
    .org-block{display:flex;gap:18px;align-items:flex-start;flex:1 1 320px;min-width:240px}
    .org-logo{max-width:140px;max-height:64px;object-fit:contain;border-radius:12px;box-shadow:0 16px 35px rgba(99,102,241,.3)}
    .org-details{font-size:11px;color:#475569;line-height:1.7}
    .org-name{font-size:18px;font-weight:700;color:#0f172a}
    .title-block{flex:1 1 260px;min-width:200px;text-align:right}
    .doc-title{font-size:26px;font-weight:800;color:#111827;letter-spacing:-.5px;line-height:1}
    .doc-num{margin-top:6px;font-size:12px;font-weight:600;color:#4f46e5}
    .meta-list{margin-top:12px;font-size:11px;color:#475569;display:grid;gap:4px}
    .meta-item strong{color:#0f172a;font-weight:600;margin-right:4px}
    .content-body{padding:28px 36px 32px;display:flex;flex-direction:column;gap:24px}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}
    .summary-card{border:1px solid #eef2ff;border-radius:18px;padding:16px;background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(244,247,255,.9));box-shadow:0 20px 40px rgba(15,23,42,.08);min-height:120px;display:flex;flex-direction:column;gap:6px}
    .summary-card span{color:#4f46e5;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    .summary-card strong{font-size:15px;color:#111827}
    .summary-card .subtitle{font-size:12px;color:#475569}
    .deployment-section{font-size:12px;color:#475569;background:none;padding:0;margin-bottom:0}
    .deployment-line{font-size:12px;color:#1e1b4b;line-height:1.6;white-space:nowrap;overflow:auto;font-weight:600}
    .deployment-line strong{font-weight:700;color:#0f172a;margin-right:4px}
    .deployment-text{font-weight:400}
    .items-table{width:100%;border-collapse:collapse}
    .items-table thead th{font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:.6px;padding:10px;border-bottom:2px solid #e0e7ff}
    .items-table tbody tr:nth-child(even){background:#f8fafc}
    .items-table tbody td{padding:12px 10px;border-bottom:1px solid #e0e7ff;font-size:11px;color:#1e1b4b}
    .items-table tbody td.num{color:#4f46e5;font-weight:600}
    .items-table tbody td a{color:#2563eb;text-decoration:none;font-size:10px;word-break:break-all}
    .items-table tbody td:last-child{white-space:nowrap}
    .items-table th.r,.items-table td.r{text-align:right}
    .items-table th.c,.items-table td.c{text-align:center}
    .totals-grid{display:flex;justify-content:flex-end}
    .totals-card{border-radius:18px;padding:18px 24px;background:#111827;color:#fff;min-width:260px;box-shadow:0 20px 40px rgba(15,23,42,.25)}
    .totals-row{display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;opacity:.9}
    .totals-row strong{font-size:13px}
    .totals-row.total strong{font-size:15px;letter-spacing:.5px}
    .payments{border:1px solid #e0e7ff;border-radius:18px;padding:16px;background:#f9fafb;font-size:11px;line-height:1.6;color:#475569}
    .payments strong{color:#0f172a}
    .signature-area{display:flex;justify-content:flex-start;gap:18px}
    .signature-card{border:1px dashed #c7d2fe;border-radius:16px;padding:20px 22px;background:#f5f7ff;min-width:260px;min-height:120px;box-shadow:0 10px 30px rgba(15,23,42,.08)}
    .signature-title{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#4f46e5;font-weight:700;margin-bottom:14px}
    .signature-line{height:1px;background:#c7d2fe;margin:26px 0 8px}
    .footer{margin-top:8px;font-size:11px;color:#94a3b8;text-align:center}

    @media print{
      body{background:#fff}
      .screen-bar{display:none!important}
      .page-card{box-shadow:none;border:none;box-sizing:border-box}
      .page-splash{display:none}
      @page{size:A4;margin:12mm}
    }
  </style>
</head>
<body>
  <div class="screen-bar">
    <button onclick="window.print()">
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 9V4h12v5M6 14H4v5h16v-5h-2M9 20h6"/>
      </svg>
      Imprimer / Exporter
    </button>
    <span>Utilisez l'aperçu d'impression pour créer un PDF propre.</span>
  </div>

  <main class="print-page">
    <section class="page-card">
      <div class="page-splash"></div>

      <header class="po-header">
        <div class="org-block">
          ${tpl.orgLogo ? `<img class="org-logo" src="${tpl.orgLogo}" alt="Logo">` : ''}
          <div>
            ${tpl.orgName ? `<div class="org-name">${esc(tpl.orgName)}</div>` : ''}
            <div class="org-details">
              ${tpl.orgAddress ? esc(tpl.orgAddress) + '<br>' : ''}
              ${tpl.orgCity ? esc(tpl.orgCity) + '<br>' : ''}
              ${tpl.orgPhone ? 'Tél. ' + esc(tpl.orgPhone) + '<br>' : ''}
              ${tpl.orgEmail ? esc(tpl.orgEmail) + '<br>' : ''}
              ${tpl.orgSiret ? 'SIRET/TVA : ' + esc(tpl.orgSiret) : ''}
            </div>
          </div>
        </div>
        <div class="title-block">
          <div class="doc-title">Bon de commande</div>
          <div class="doc-num">N° ${esc(orderNum)}</div>
          <div class="meta-list">
            <div class="meta-item"><strong>Date :</strong>${fmtDate(order.createdAt)}</div>
            ${order.orderedAt ? `<div class="meta-item"><strong>Commandé le :</strong>${fmtDate(order.orderedAt)}</div>` : ''}
            <div class="meta-item"><strong>Statut :</strong> ${esc(st.label)}</div>
            <div class="meta-item"><strong>Demandé par :</strong> ${esc(order.requester?.name || '—')}</div>
          </div>
        </div>
      </header>

      <div class="content-body">
        <div class="summary-grid">
          <article class="summary-card">
            <span>Demande</span>
            <strong>${esc(order.title)}</strong>
            ${order.description ? `<div class="subtitle">${esc(order.description)}</div>` : ''}
            <div class="subtitle">Demandeur : ${esc(order.requester?.name || '—')}</div>
          </article>
          <article class="summary-card">
            <span>Fournisseur</span>
            ${order.supplier ? `<strong>${esc(order.supplier)}</strong>` : '<div class="subtitle" style="font-style:italic;color:#9ca3af;">Non renseigné</div>'}
            <div class="subtitle">Articles : ${rows.length} · Créée le ${fmtDate(order.createdAt)}</div>
          </article>
        </div>

        ${order.deploymentTags && order.deploymentTags.length ? `
        <section class="deployment-section">
          <p class="deployment-line">
            <strong>Zones de déploiement — Immobilisation :</strong>
            <span class="deployment-text">
              ${order.deploymentTags.map(t => esc(t)).join(' · ')}
            </span>
          </p>
        </section>` : ''}

        <section>
          <table class="items-table">
            <thead>
              <tr>
                <th class="c" style="width:4%">#</th>
                <th style="width:${hasPrice ? '32' : '58'}%">Désignation</th>
                <th style="width:15%">Référence</th>
                <th class="c" style="width:6%">Qté</th>
                ${hasPrice ? `
                <th class="r" style="width:11%">P.U. HT</th>
                <th class="r" style="width:12%">P.U. TTC</th>
                <th class="r" style="width:15%">Total TTC</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${rows.map(({ item, idx, qty, lineHT, lineTTC }) => `
              <tr>
                <td class="c num">${idx}</td>
                <td>
                  <strong>${esc(item.name)}</strong>
                  ${item.notes ? `<div class="subtitle">${esc(item.notes)}</div>` : ''}
                  ${item.assetTag ? `<div class="subtitle">Immob. : ${esc(item.assetTag)}</div>` : ''}
                  ${item.productUrl ? `<a href="${esc(item.productUrl)}">${esc(shortUrl(item.productUrl))}</a>` : ''}
                </td>
                <td class="subtitle">${esc(item.reference || '—')}</td>
                <td class="c">${qty}</td>
                ${hasPrice ? `
                <td class="r">${lineHT != null ? fmtCurrency(lineHT / qty, currency) : '—'}</td>
                <td class="r">${lineTTC != null ? fmtCurrency(lineTTC / qty, currency) : '—'}</td>
                <td class="r"><strong>${lineTTC != null ? fmtCurrency(lineTTC, currency) : '—'}</strong></td>` : ''}
              </tr>`).join('')}
            </tbody>
          </table>
        </section>

        ${hasPrice ? `
        <div class="totals-grid">
          <div class="totals-card">
            <div class="totals-row"><span>Total HT</span><strong>${fmtCurrency(totalHT, currency)}</strong></div>
            <div class="totals-row"><span>TVA ${tvaRate}%</span><strong>${fmtCurrency(tva, currency)}</strong></div>
            <div class="totals-row total"><span>Total TTC</span><strong>${fmtCurrency(totalTTC, currency)}</strong></div>
          </div>
        </div>` : ''}

        ${tpl.paymentTerms ? `
        <section class="payments">
          <strong>Conditions de paiement :</strong><br>
          ${esc(tpl.paymentTerms)}
        </section>` : ''}

        <div class="signature-area">
          <div class="signature-card">
            <div class="signature-title">Signature validation</div>
            <div class="signature-line"></div>
            <p class="signature-note">&nbsp;</p>
          </div>
        </div>

        <div class="footer">
          ${tpl.footerNote ? `<p>${esc(tpl.footerNote)}</p>` : ''}
          <p>Document généré le ${fmtDate(new Date())} · MaintenanceBoard</p>
        </div>
      </div>
    </section>
  </main>
  <script>/* empty */</script>
</body>
</html>`;
}

module.exports = router;
