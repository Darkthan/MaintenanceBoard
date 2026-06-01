const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
};

// ── Utilitaires CIDR ──────────────────────────────────────────────────────────

function parseCidr(cidr) {
  const [networkStr, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) throw new Error('Préfixe CIDR invalide');
  const parts = networkStr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) throw new Error('Adresse réseau invalide');

  const networkInt = (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const networkBase = (networkInt & mask) >>> 0;
  const broadcast = (networkBase | ~mask) >>> 0;
  const totalHosts = Math.pow(2, 32 - prefix);
  const usableHosts = prefix >= 31 ? totalHosts : Math.max(0, totalHosts - 2);
  const gateway = prefix >= 31 ? intToIp(networkBase) : intToIp(networkBase + 1);

  return {
    network: intToIp(networkBase),
    networkBase,
    broadcast: intToIp(broadcast),
    gateway,
    prefix,
    totalHosts,
    usableHosts,
    firstUsable: prefix >= 31 ? intToIp(networkBase) : intToIp(networkBase + 1),
    lastUsable: prefix >= 31 ? intToIp(broadcast) : intToIp(broadcast - 1),
    subnetMask: intToIp(mask),
  };
}

function intToIp(int) {
  return [(int >>> 24) & 0xFF, (int >>> 16) & 0xFF, (int >>> 8) & 0xFF, int & 0xFF].join('.');
}

function ipToInt(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error('Adresse IP invalide');
  }
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
}

function validateGateway(cidr, gateway) {
  if (!gateway) return null;
  const info = parseCidr(cidr);
  const gatewayInt = ipToInt(gateway);
  const networkInt = ipToInt(info.network);
  const broadcastInt = ipToInt(info.broadcast);
  if (gatewayInt < networkInt || gatewayInt > broadcastInt) {
    throw new Error('La passerelle doit appartenir au sous-réseau');
  }
  if (info.prefix < 31 && (gatewayInt === networkInt || gatewayInt === broadcastInt)) {
    throw new Error('La passerelle doit être une adresse utilisable du sous-réseau');
  }
  return gateway.trim();
}

function withStoredGateway(cidrInfo, gateway) {
  return cidrInfo && gateway ? { ...cidrInfo, gateway } : cidrInfo;
}

function validateRangeOffsets(cidr, startHost, endHost) {
  const start = parseInt(startHost);
  const end = parseInt(endHost);
  const { totalHosts } = parseCidr(cidr);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= totalHosts) {
    throw new Error('La plage doit appartenir au sous-réseau');
  }
  return { start, end };
}

function ipToHostOffset(networkCidr, ip) {
  const [netStr, prefixStr] = networkCidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const netParts = netStr.split('.').map(Number);
  const networkBase = (netParts[0] << 24 | netParts[1] << 16 | netParts[2] << 8 | netParts[3]) >>> 0;
  const cleanBase = (networkBase & mask) >>> 0;
  const ipParts = ip.split('.').map(Number);
  const ipInt = (ipParts[0] << 24 | ipParts[1] << 16 | ipParts[2] << 8 | ipParts[3]) >>> 0;
  return ipInt - cleanBase;
}

// ── Réseaux ───────────────────────────────────────────────────────────────────

// GET /api/ip-networks
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const networks = await prisma.ipNetwork.findMany({
      orderBy: [{ vlan: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { addresses: true, ranges: true } }
      }
    });
    const result = networks.map(n => {
      let cidrInfo = null;
      try { cidrInfo = withStoredGateway(parseCidr(n.cidr), n.gateway); } catch {}
      return { ...n, cidrInfo };
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/ip-networks/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const network = await prisma.ipNetwork.findUnique({
      where: { id: req.params.id },
      include: {
        addresses: {
          orderBy: { ip: 'asc' },
          include: { equipment: { select: { id: true, name: true, type: true } } }
        },
        ranges: { orderBy: { startHost: 'asc' } }
      }
    });
    if (!network) return res.status(404).json({ error: 'Réseau introuvable' });
    let cidrInfo = null;
    try { cidrInfo = withStoredGateway(parseCidr(network.cidr), network.gateway); } catch {}
    res.json({ ...network, cidrInfo });
  } catch (err) { next(err); }
});

// POST /api/ip-networks
router.post('/',
  requireAuth, requireAdmin,
  body('name').trim().notEmpty().withMessage('Nom requis'),
  body('cidr').trim().notEmpty().withMessage('CIDR requis').matches(/^\d+\.\d+\.\d+\.\d+\/\d+$/).withMessage('Format CIDR invalide (ex: 10.0.0.0/24)'),
  body('gateway').optional({ nullable: true, checkFalsy: true }).trim().matches(/^\d+\.\d+\.\d+\.\d+$/).withMessage('Format de passerelle invalide'),
  body('vlan').optional({ nullable: true }).isInt({ min: 1, max: 4094 }).withMessage('VLAN entre 1 et 4094'),
  async (req, res, next) => {
    if (!validate(req, res)) return;
    try {
      parseCidr(req.body.cidr); // valide le CIDR
      validateGateway(req.body.cidr, req.body.gateway);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    try {
      const network = await prisma.ipNetwork.create({
        data: {
          name: req.body.name.trim(),
          cidr: req.body.cidr.trim(),
          gateway: validateGateway(req.body.cidr, req.body.gateway),
          vlan: req.body.vlan ? parseInt(req.body.vlan) : null,
          description: req.body.description?.trim() || null,
        }
      });
      res.status(201).json(network);
    } catch (err) { next(err); }
  }
);

// PATCH /api/ip-networks/:id
router.patch('/:id',
  requireAuth, requireAdmin,
  body('name').optional().trim().notEmpty(),
  body('cidr').optional().trim().matches(/^\d+\.\d+\.\d+\.\d+\/\d+$/),
  body('gateway').optional({ nullable: true, checkFalsy: true }).trim().matches(/^\d+\.\d+\.\d+\.\d+$/),
  body('vlan').optional({ nullable: true }).isInt({ min: 1, max: 4094 }),
  async (req, res, next) => {
    if (!validate(req, res)) return;
    try {
      const current = await prisma.ipNetwork.findUnique({ where: { id: req.params.id } });
      if (!current) return res.status(404).json({ error: 'Réseau introuvable' });
      const cidr = req.body.cidr?.trim() || current.cidr;
      parseCidr(cidr);
      const gateway = req.body.gateway !== undefined
        ? validateGateway(cidr, req.body.gateway)
        : validateGateway(cidr, current.gateway);
      const data = {};
      if (req.body.name !== undefined) data.name = req.body.name.trim();
      if (req.body.cidr !== undefined) data.cidr = req.body.cidr.trim();
      if (req.body.gateway !== undefined || req.body.cidr !== undefined) data.gateway = gateway;
      if (req.body.vlan !== undefined) data.vlan = req.body.vlan ? parseInt(req.body.vlan) : null;
      if (req.body.description !== undefined) data.description = req.body.description?.trim() || null;
      const network = await prisma.ipNetwork.update({ where: { id: req.params.id }, data });
      res.json(network);
    } catch (err) {
      if (err.message.includes('CIDR') || err.message.includes('Adresse') || err.message.includes('passerelle')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  }
);

// DELETE /api/ip-networks/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.ipNetwork.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Plages de définition ──────────────────────────────────────────────────────

// GET /api/ip-networks/:id/ranges
router.get('/:id/ranges', requireAuth, async (req, res, next) => {
  try {
    const ranges = await prisma.ipRangeDefinition.findMany({
      where: { networkId: req.params.id },
      orderBy: { startHost: 'asc' }
    });
    res.json(ranges);
  } catch (err) { next(err); }
});

// POST /api/ip-networks/:id/ranges
router.post('/:id/ranges',
  requireAuth, requireAdmin,
  body('startHost').isInt({ min: 0 }).withMessage('startHost requis'),
  body('endHost').isInt({ min: 0 }).withMessage('endHost requis'),
  body('label').trim().notEmpty().withMessage('label requis'),
  body('rangeType').optional().isIn(['STATIC', 'DHCP', 'RESERVED', 'OTHER']),
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { startHost, endHost, label, rangeType } = req.body;
    try {
      const network = await prisma.ipNetwork.findUnique({ where: { id: req.params.id } });
      if (!network) return res.status(404).json({ error: 'Réseau introuvable' });
      const offsets = validateRangeOffsets(network.cidr, startHost, endHost);
      const range = await prisma.ipRangeDefinition.create({
        data: {
          networkId: req.params.id,
          startHost: offsets.start,
          endHost: offsets.end,
          label: label.trim(),
          rangeType: rangeType || 'STATIC',
        }
      });
      res.status(201).json(range);
    } catch (err) {
      if (err.message.includes('plage') || err.message.includes('CIDR')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  }
);

// PATCH /api/ip-networks/:id/ranges/:rangeId
router.patch('/:id/ranges/:rangeId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [network, current] = await Promise.all([
      prisma.ipNetwork.findUnique({ where: { id: req.params.id } }),
      prisma.ipRangeDefinition.findUnique({ where: { id: req.params.rangeId } })
    ]);
    if (!network || !current) return res.status(404).json({ error: 'Plage introuvable' });
    const offsets = validateRangeOffsets(
      network.cidr,
      req.body.startHost ?? current.startHost,
      req.body.endHost ?? current.endHost
    );
    const data = {};
    if (req.body.startHost !== undefined) data.startHost = offsets.start;
    if (req.body.endHost !== undefined) data.endHost = offsets.end;
    if (req.body.label !== undefined) data.label = req.body.label.trim();
    if (req.body.rangeType !== undefined) data.rangeType = req.body.rangeType;
    const range = await prisma.ipRangeDefinition.update({
      where: { id: req.params.rangeId },
      data
    });
    res.json(range);
  } catch (err) {
    if (err.message.includes('plage') || err.message.includes('CIDR')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// DELETE /api/ip-networks/:id/ranges/:rangeId
router.delete('/:id/ranges/:rangeId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.ipRangeDefinition.delete({ where: { id: req.params.rangeId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Adresses IP ───────────────────────────────────────────────────────────────

// GET /api/ip-networks/:id/addresses
router.get('/:id/addresses', requireAuth, async (req, res, next) => {
  try {
    const { q } = req.query;
    const where = { networkId: req.params.id };
    if (q) {
      where.OR = [
        { ip: { contains: q } },
        { hostname: { contains: q } },
        { description: { contains: q } },
        { equipmentType: { contains: q } },
      ];
    }
    const addresses = await prisma.ipAddress.findMany({
      where,
      orderBy: { ip: 'asc' },
      include: { equipment: { select: { id: true, name: true, type: true } } }
    });
    res.json(addresses);
  } catch (err) { next(err); }
});

// POST /api/ip-networks/:id/addresses
router.post('/:id/addresses',
  requireAuth, requireAdmin,
  body('ip').trim().notEmpty().withMessage('IP requise').matches(/^\d+\.\d+\.\d+\.\d+$/).withMessage('Format IP invalide'),
  async (req, res, next) => {
    if (!validate(req, res)) return;
    try {
      const addr = await prisma.ipAddress.create({
        data: {
          networkId: req.params.id,
          ip: req.body.ip.trim(),
          hostname: req.body.hostname?.trim() || null,
          equipmentType: req.body.equipmentType?.trim() || null,
          description: req.body.description?.trim() || null,
          equipmentId: req.body.equipmentId || null,
        },
        include: { equipment: { select: { id: true, name: true, type: true } } }
      });
      res.status(201).json(addr);
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ error: 'Cette IP est déjà enregistrée dans ce réseau' });
      next(err);
    }
  }
);

// PATCH /api/ip-networks/:id/addresses/:addrId
router.patch('/:id/addresses/:addrId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = {};
    if (req.body.ip !== undefined) data.ip = req.body.ip.trim();
    if (req.body.hostname !== undefined) data.hostname = req.body.hostname?.trim() || null;
    if (req.body.equipmentType !== undefined) data.equipmentType = req.body.equipmentType?.trim() || null;
    if (req.body.description !== undefined) data.description = req.body.description?.trim() || null;
    if (req.body.equipmentId !== undefined) data.equipmentId = req.body.equipmentId || null;
    const addr = await prisma.ipAddress.update({
      where: { id: req.params.addrId },
      data,
      include: { equipment: { select: { id: true, name: true, type: true } } }
    });
    res.json(addr);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Cette IP est déjà enregistrée dans ce réseau' });
    next(err);
  }
});

// DELETE /api/ip-networks/:id/addresses/:addrId
router.delete('/:id/addresses/:addrId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.ipAddress.delete({ where: { id: req.params.addrId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/ip-networks/:id/addresses/import — Import CSV
// Colonnes attendues : ip, hostname (opt), equipmentType (opt), description (opt)
router.post('/:id/addresses/import', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { csv, skipErrors } = req.body;
    if (!csv) return res.status(400).json({ error: 'Contenu CSV requis' });

    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV vide ou sans données' });

    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
    const ipIdx          = header.indexOf('ip');
    const hostnameIdx    = header.indexOf('hostname');
    const typeIdx        = header.findIndex(h => ['equipmenttype', 'type'].includes(h));
    const descIdx        = header.findIndex(h => ['description', 'desc'].includes(h));

    if (ipIdx === -1) return res.status(400).json({ error: 'Colonne "ip" manquante dans le CSV' });

    const results = { created: 0, updated: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const ip = cols[ipIdx];
      if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        results.errors.push({ line: i + 1, error: `IP invalide: "${ip}"` });
        if (!skipErrors) break;
        continue;
      }

      const data = {
        ip,
        hostname: hostnameIdx >= 0 ? (cols[hostnameIdx] || null) : null,
        equipmentType: typeIdx >= 0 ? (cols[typeIdx] || null) : null,
        description: descIdx >= 0 ? (cols[descIdx] || null) : null,
      };

      try {
        await prisma.ipAddress.upsert({
          where: { networkId_ip: { networkId: req.params.id, ip } },
          create: { networkId: req.params.id, ...data },
          update: data,
        });
        results.created++;
      } catch (e) {
        results.errors.push({ line: i + 1, error: e.message });
        if (!skipErrors) break;
      }
    }

    res.json(results);
  } catch (err) { next(err); }
});

// POST /api/ip-networks/import — Import CSV réseaux
// Colonnes : name, cidr, vlan (opt), gateway (opt), description (opt)
router.post('/import', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { csv, skipErrors } = req.body;
    if (!csv) return res.status(400).json({ error: 'Contenu CSV requis' });

    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV vide ou sans données' });

    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
    const nameIdx = header.indexOf('name');
    const cidrIdx = header.indexOf('cidr');
    const vlanIdx = header.indexOf('vlan');
    const gatewayIdx = header.indexOf('gateway');
    const descIdx = header.findIndex(h => ['description', 'desc'].includes(h));

    if (nameIdx === -1 || cidrIdx === -1) return res.status(400).json({ error: 'Colonnes "name" et "cidr" requises' });

    const results = { created: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const name = cols[nameIdx];
      const cidr = cols[cidrIdx];
      if (!name || !cidr) {
        results.errors.push({ line: i + 1, error: 'name ou cidr manquant' });
        if (!skipErrors) break;
        continue;
      }
      try {
        parseCidr(cidr);
        validateGateway(cidr, gatewayIdx >= 0 ? cols[gatewayIdx] : null);
      } catch (e) {
        results.errors.push({ line: i + 1, error: `CIDR invalide: ${e.message}` });
        if (!skipErrors) break;
        continue;
      }
      try {
        await prisma.ipNetwork.create({
          data: {
            name: name.trim(),
            cidr: cidr.trim(),
            gateway: validateGateway(cidr, gatewayIdx >= 0 ? cols[gatewayIdx] : null),
            vlan: vlanIdx >= 0 && cols[vlanIdx] ? parseInt(cols[vlanIdx]) || null : null,
            description: descIdx >= 0 ? (cols[descIdx] || null) : null,
          }
        });
        results.created++;
      } catch (e) {
        results.errors.push({ line: i + 1, error: e.message });
        if (!skipErrors) break;
      }
    }

    res.json(results);
  } catch (err) { next(err); }
});

module.exports = router;
