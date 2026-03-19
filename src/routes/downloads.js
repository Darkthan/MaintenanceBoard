const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const config = require('../config');
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const TEMPLATES_DIR = path.join(__dirname, '../../downloads/templates');
const VERSION = '1.0.0';

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

// ── GET /downloads/agent.ps1 ──────────────────────────────────────────────────
// Script agent brut — réservé aux admins authentifiés
router.get('/agent.ps1', requireAuth, (req, res) => {
  const content = readTemplate('agent.ps1');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="agent.ps1"');
  res.send(content);
});

// ── GET /downloads/agent.sh ───────────────────────────────────────────────────
router.get('/agent.sh', requireAuth, (req, res) => {
  const content = readTemplate('agent.sh');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="agent.sh"');
  res.send(content);
});

// ── GET /downloads/maintenance-agent.service ──────────────────────────────────
router.get('/maintenance-agent.service', requireAuth, (req, res) => {
  const content = readTemplate('maintenance-agent.service');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="maintenance-agent.service"');
  res.send(content);
});

// ── Helper : valider un enrollment token ──────────────────────────────────────
async function validateEnrollmentToken(token) {
  if (!token) return null;
  const record = await prisma.agentToken.findUnique({ where: { token } });
  if (!record || !record.isActive) return null;
  return record;
}

// ── GET /downloads/windows?enrollmentToken=<token> ────────────────────────────
// Génère un .nupkg (ZIP) avec JSZip si disponible, sinon ZIP basique Node
router.get('/windows', requireAuth, async (req, res, next) => {
  const { enrollmentToken } = req.query;
  if (!enrollmentToken) {
    return res.status(400).json({ error: 'enrollmentToken requis' });
  }

  try {
    if (!await validateEnrollmentToken(enrollmentToken)) {
      return res.status(403).json({ error: 'Token d\'enrollment invalide ou désactivé' });
    }
    const serverUrl = config.appUrl;
    const configJson = JSON.stringify({ serverUrl, enrollmentToken }, null, 2);
    const nuspecContent = readTemplate('agent.nuspec.template')
      .replace(/\{\{VERSION\}\}/g, VERSION)
      .replace(/\{\{SERVER_URL\}\}/g, serverUrl);
    const agentPs1 = readTemplate('agent.ps1');
    const chocoInstall = readTemplate('chocolateyInstall.ps1');

    // Essayer JSZip, sinon construire un ZIP manuel minimaliste
    let JSZip;
    try { JSZip = require('jszip'); } catch { JSZip = null; }

    if (JSZip) {
      const zip = new JSZip();
      zip.file('maintenance-agent.nuspec', nuspecContent);
      zip.folder('tools').file('agent.ps1', agentPs1);
      zip.folder('tools').file('chocolateyInstall.ps1', chocoInstall);
      zip.folder('tools').file('config.json', configJson);

      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="maintenance-agent.nupkg"');
      res.send(buffer);
    } else {
      // Fallback : envoyer config.json seul + instructions
      res.status(503).json({
        error: 'jszip non installé. Installez jszip (npm install jszip) pour générer le .nupkg.',
        hint: 'Utilisez /downloads/install.ps1 à la place (script PowerShell standalone).'
      });
    }
  } catch (err) { next(err); }
});

// ── GET /downloads/linux?enrollmentToken=<token> ─────────────────────────────
// Retourne install.sh avec variables injectées
router.get('/linux', requireAuth, async (req, res, next) => {
  const { enrollmentToken } = req.query;
  if (!enrollmentToken) {
    return res.status(400).json({ error: 'enrollmentToken requis' });
  }

  try {
    if (!await validateEnrollmentToken(enrollmentToken)) {
      return res.status(403).json({ error: 'Token d\'enrollment invalide ou désactivé' });
    }
    const serverUrl = config.appUrl;
    const content = readTemplate('install.sh')
      .replace(/\{\{SERVER_URL\}\}/g, serverUrl)
      .replace(/\{\{ENROLLMENT_TOKEN\}\}/g, enrollmentToken);

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="install-maintenance-agent.sh"');
    res.send(content);
  } catch (err) { next(err); }
});

// ── GET /downloads/install.ps1?enrollmentToken=<token> ───────────────────────
// Script PowerShell standalone (sans choco) avec config inline
router.get('/install.ps1', requireAuth, async (req, res, next) => {
  const { enrollmentToken } = req.query;
  if (!enrollmentToken) {
    return res.status(400).json({ error: 'enrollmentToken requis' });
  }

  try {
    if (!await validateEnrollmentToken(enrollmentToken)) {
      return res.status(403).json({ error: 'Token d\'enrollment invalide ou désactivé' });
    }
    const serverUrl = config.appUrl;
    const content = readTemplate('install.ps1.template')
      .replace(/\{\{SERVER_URL\}\}/g, serverUrl)
      .replace(/\{\{ENROLLMENT_TOKEN\}\}/g, enrollmentToken);

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="install-maintenance-agent.ps1"');
    res.send(content);
  } catch (err) { next(err); }
});

// ── Helper : envoyer un buffer XLSX ───────────────────────────────────────────
function sendXlsx(res, data, sheetName, filename) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

// ── GET /downloads/export/suppliers ──────────────────────────────────────────
router.get('/export/suppliers', requireAuth, async (req, res, next) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { orders: true } } }
    });
    const data = suppliers.map(s => ({
      id: s.id,
      name: s.name,
      contact: s.contact || '',
      email: s.email || '',
      phone: s.phone || '',
      website: s.website || '',
      address: s.address || '',
      notes: s.notes || '',
      orderCount: s._count.orders,
      createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : ''
    }));
    sendXlsx(res, data, 'Fournisseurs', `export-fournisseurs-${Date.now()}.xlsx`);
  } catch (err) { next(err); }
});

// ── GET /downloads/export/stock ───────────────────────────────────────────────
router.get('/export/stock', requireAuth, async (req, res, next) => {
  try {
    const items = await prisma.stockItem.findMany({
      orderBy: { name: 'asc' },
      include: { supplier: { select: { name: true } } }
    });
    const data = items.map(i => ({
      id: i.id,
      name: i.name,
      reference: i.reference || '',
      category: i.category || '',
      location: i.location || '',
      quantity: i.quantity,
      minQuantity: i.minQuantity,
      unitCost: i.unitCost != null ? i.unitCost : '',
      supplier: i.supplier?.name || '',
      createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : ''
    }));
    sendXlsx(res, data, 'Stock', `export-stock-${Date.now()}.xlsx`);
  } catch (err) { next(err); }
});

// ── GET /downloads/export/stock-movements ────────────────────────────────────
router.get('/export/stock-movements', requireAuth, async (req, res, next) => {
  try {
    const movements = await prisma.stockMovement.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        stockItem: { select: { name: true } },
        user: { select: { name: true } }
      }
    });
    const data = movements.map(m => ({
      stockItem: m.stockItem?.name || '',
      type: m.type,
      quantity: m.quantity,
      reason: m.reason || '',
      user: m.user?.name || '',
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : ''
    }));
    sendXlsx(res, data, 'Mouvements', `export-mouvements-stock-${Date.now()}.xlsx`);
  } catch (err) { next(err); }
});

// ── GET /downloads/export/equipment ──────────────────────────────────────────
router.get('/export/equipment', requireAuth, async (req, res, next) => {
  try {
    const equipments = await prisma.equipment.findMany({
      orderBy: { name: 'asc' },
      include: { room: { select: { name: true, number: true } } }
    });
    const data = equipments.map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      brand: e.brand || '',
      model: e.model || '',
      serialNumber: e.serialNumber || '',
      status: e.status,
      room: e.room ? `${e.room.name}${e.room.number ? ` (${e.room.number})` : ''}` : '',
      purchaseDate: e.purchaseDate ? new Date(e.purchaseDate).toISOString() : '',
      warrantyEnd: e.warrantyEnd ? new Date(e.warrantyEnd).toISOString() : '',
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : ''
    }));
    sendXlsx(res, data, 'Equipements', `export-equipements-${Date.now()}.xlsx`);
  } catch (err) { next(err); }
});

module.exports = router;
