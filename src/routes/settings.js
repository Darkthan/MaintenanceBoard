const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const config = require('../config');
const { readSettings, writeSettings } = require('../utils/settings');

const prisma = require('../lib/prisma');

const AGENT_MONITORING_DEFAULTS = {
  lowDiskAlertsEnabled: false,
  lowDiskThresholdGb: 20
};

// ── SMTP ───────────────────────────────────────────────────────────────────

// GET /api/settings/smtp
router.get('/smtp', requireAuth, requireAdmin, (req, res) => {
  const s = (readSettings().smtp) || {};
  res.json({
    host:      s.host  ?? config.smtp.host  ?? '',
    port:      s.port  ?? config.smtp.port  ?? 587,
    user:      s.user  ?? config.smtp.user  ?? '',
    pass:      (s.pass ?? config.smtp.pass) ? '••••••••' : '',
    from:      s.from  ?? config.smtp.from  ?? '',
    testTo:    s.testTo ?? req.user.email ?? '',
    secure:    s.secure ?? false,
    configured: !!(s.host ?? config.smtp.host)
  });
});

// PATCH /api/settings/smtp
router.patch('/smtp', requireAuth, requireAdmin, (req, res) => {
  const { host, port, user, pass, from, testTo, secure } = req.body;
  const cur = (readSettings().smtp) || {};
  writeSettings({
    smtp: {
      host:   host   !== undefined ? host   : cur.host,
      port:   port   !== undefined ? port   : cur.port,
      user:   user   !== undefined ? user   : cur.user,
      from:   from   !== undefined ? from   : cur.from,
      testTo: testTo !== undefined ? testTo : cur.testTo,
      secure: secure !== undefined ? secure : (cur.secure ?? false),
      // Ne pas écraser si l'UI renvoie les bullets masqués
      pass:   (pass && !pass.startsWith('•')) ? pass : cur.pass
    }
  });
  res.json({ message: 'Configuration SMTP enregistrée' });
});

// POST /api/settings/smtp/test
router.post('/smtp/test', requireAuth, requireAdmin, async (req, res, next) => {
  const s = (readSettings().smtp) || {};
  const host = s.host || config.smtp.host;
  const port = s.port || config.smtp.port || 587;
  const user = s.user || config.smtp.user;
  const pass = s.pass || config.smtp.pass;
  const from = s.from || config.smtp.from || 'noreply@maintenance.local';
  const to   = req.body.to || s.testTo || req.user.email;

  if (!host) return res.status(400).json({ error: 'Serveur SMTP non configuré' });

  try {
    const transporter = nodemailer.createTransport({
      host, port: parseInt(port), secure: s.secure || false,
      auth: user ? { user, pass } : undefined,
      tls: { rejectUnauthorized: false }
    });
    await transporter.sendMail({
      from, to,
      subject: '[MaintenanceBoard] Test de configuration',
      text: 'Configuration SMTP opérationnelle.',
      html: '<p>Configuration SMTP opérationnelle ✓</p><p style="color:#64748b;font-size:12px">Envoyé depuis MaintenanceBoard</p>'
    });
    res.json({ message: `Email de test envoyé à ${to}` });
  } catch (err) { next(err); }
});

// ── Monitoring agents ────────────────────────────────────────────────────────

// GET /api/settings/agent-monitoring
router.get('/agent-monitoring', requireAuth, requireAdmin, (_req, res) => {
  const saved = readSettings().agentMonitoring || {};
  res.json({ ...AGENT_MONITORING_DEFAULTS, ...saved });
});

// PATCH /api/settings/agent-monitoring
router.patch('/agent-monitoring', requireAuth, requireAdmin, (req, res) => {
  const current = readSettings().agentMonitoring || {};
  const next = {
    ...AGENT_MONITORING_DEFAULTS,
    ...current
  };

  if (req.body.lowDiskAlertsEnabled !== undefined) {
    next.lowDiskAlertsEnabled = !!req.body.lowDiskAlertsEnabled;
  }

  if (req.body.lowDiskThresholdGb !== undefined) {
    const threshold = Number(req.body.lowDiskThresholdGb);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 1000) {
      return res.status(400).json({ error: 'Le seuil disque doit être compris entre 1 et 1000 Go.' });
    }
    next.lowDiskThresholdGb = Math.round(threshold * 10) / 10;
  }

  writeSettings({ agentMonitoring: next });
  res.json({ message: 'Surveillance des agents enregistrée', settings: next });
});

// ── Export ─────────────────────────────────────────────────────────────────

// GET /api/settings/export
router.get('/export', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [users, rooms, equipment, interventions, orders] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, updatedAt: true }
      }),
      prisma.room.findMany(),
      prisma.equipment.findMany(),
      prisma.intervention.findMany(),
      prisma.order.findMany({ include: { items: true } })
    ]);

    const backup = {
      app: 'MaintenanceBoard',
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: { users: users.length, rooms: rooms.length, equipment: equipment.length, interventions: interventions.length, orders: orders.length },
      data: { users, rooms, equipment, interventions, orders }
    };

    const filename = `mb-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) { next(err); }
});

// GET /api/settings/stats
router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [users, rooms, equipment, interventions, orders] = await Promise.all([
      prisma.user.count(),
      prisma.room.count(),
      prisma.equipment.count(),
      prisma.intervention.count(),
      prisma.order.count()
    ]);
    res.json({ users, rooms, equipment, interventions, orders });
  } catch (err) { next(err); }
});

// ── Import ─────────────────────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/settings/import
router.post('/import', requireAuth, requireAdmin, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });

  let backup;
  try {
    backup = JSON.parse(req.file.buffer.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Fichier JSON invalide' });
  }

  if (backup.app !== 'MaintenanceBoard' || !backup.data) {
    return res.status(400).json({ error: 'Format de sauvegarde non reconnu' });
  }

  const { users, rooms, equipment, interventions, orders } = backup.data;
  const results = { users: 0, rooms: 0, equipment: 0, interventions: 0, orders: 0, errors: 0 };

  async function upsertSafe(fn) {
    try { await fn(); } catch { results.errors++; }
  }

  // Utilisateurs (sans mot de passe)
  for (const u of (users || [])) {
    await upsertSafe(() => prisma.user.upsert({
      where: { id: u.id },
      update: { name: u.name, role: u.role, isActive: u.isActive },
      create: { id: u.id, email: u.email, name: u.name, role: u.role, isActive: u.isActive, createdAt: new Date(u.createdAt), updatedAt: new Date(u.updatedAt) }
    }));
    results.users++;
  }

  // Salles
  for (const r of (rooms || [])) {
    await upsertSafe(() => prisma.room.upsert({
      where: { id: r.id },
      update: { name: r.name, building: r.building, floor: r.floor, number: r.number, description: r.description },
      create: { ...r, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) }
    }));
    results.rooms++;
  }

  // Équipements
  for (const e of (equipment || [])) {
    const { createdAt, updatedAt, purchaseDate, warrantyEnd, lastSeenAt, ...rest } = e;
    await upsertSafe(() => prisma.equipment.upsert({
      where: { id: e.id },
      update: { name: e.name, type: e.type, brand: e.brand, model: e.model, status: e.status, description: e.description },
      create: {
        ...rest,
        createdAt: new Date(createdAt), updatedAt: new Date(updatedAt),
        ...(purchaseDate ? { purchaseDate: new Date(purchaseDate) } : {}),
        ...(warrantyEnd  ? { warrantyEnd:  new Date(warrantyEnd)  } : {}),
        ...(lastSeenAt   ? { lastSeenAt:   new Date(lastSeenAt)   } : {})
      }
    }));
    results.equipment++;
  }

  // Interventions
  for (const i of (interventions || [])) {
    await upsertSafe(() => prisma.intervention.upsert({
      where: { id: i.id },
      update: { title: i.title, description: i.description, status: i.status, priority: i.priority, resolution: i.resolution },
      create: { ...i, createdAt: new Date(i.createdAt), updatedAt: new Date(i.updatedAt), ...(i.closedAt ? { closedAt: new Date(i.closedAt) } : {}) }
    }));
    results.interventions++;
  }

  // Commandes
  for (const o of (orders || [])) {
    const { items, createdAt, updatedAt, orderedAt, receivedAt, ...orderData } = o;
    await upsertSafe(() => prisma.order.upsert({
      where: { id: o.id },
      update: { title: o.title, status: o.status, description: o.description },
      create: {
        ...orderData, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt),
        ...(orderedAt  ? { orderedAt:  new Date(orderedAt)  } : {}),
        ...(receivedAt ? { receivedAt: new Date(receivedAt) } : {})
      }
    }));
    results.orders++;
  }

  res.json({
    message: `Import terminé : ${results.users} utilisateurs, ${results.rooms} salles, ${results.equipment} équipements, ${results.interventions} interventions, ${results.orders} commandes.${results.errors ? ` ${results.errors} erreur(s) ignorée(s).` : ''}`,
    results
  });
});

// ── Modèle bon de commande ──────────────────────────────────────────────────

const PO_DEFAULTS = {
  orgName: '',
  orgAddress: '',
  orgCity: '',
  orgPhone: '',
  orgEmail: '',
  orgSiret: '',
  tvaRate: 20,
  currency: 'EUR',
  poPrefix: 'BC-',
  paymentTerms: '30 jours net',
  footerNote: '',
  orgLogo: '',
  accountingEmail: '',
  autoEmailCategories: []
};

// GET /api/settings/po-template
router.get('/po-template', requireAuth, requireAdmin, (req, res) => {
  const saved = readSettings().poTemplate || {};
  res.json({ ...PO_DEFAULTS, ...saved });
});

// PATCH /api/settings/po-template
router.patch('/po-template', requireAuth, requireAdmin, (req, res) => {
  const allowed = Object.keys(PO_DEFAULTS);
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  const cur = readSettings().poTemplate || {};
  writeSettings({ poTemplate: { ...cur, ...patch } });
  res.json({ message: 'Modèle enregistré' });
});

// POST /api/settings/po-template/logo
router.post('/po-template/logo', requireAuth, requireAdmin, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Format image requis' });
  if (req.file.size > 2 * 1024 * 1024) return res.status(400).json({ error: 'Image trop grande (max 2 Mo)' });
  const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  const cur = readSettings().poTemplate || {};
  writeSettings({ poTemplate: { ...cur, orgLogo: base64 } });
  res.json({ logo: base64 });
});

// DELETE /api/settings/po-template/logo
router.delete('/po-template/logo', requireAuth, requireAdmin, (req, res) => {
  const cur = readSettings().poTemplate || {};
  delete cur.orgLogo;
  writeSettings({ poTemplate: cur });
  res.json({ message: 'Logo supprimé' });
});

module.exports = router;
