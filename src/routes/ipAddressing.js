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

function sortIpAddresses(addresses) {
  return addresses.slice().sort((left, right) => {
    try {
      return ipToInt(left.ip) - ipToInt(right.ip);
    } catch {
      return String(left.ip || '').localeCompare(String(right.ip || ''), 'fr', { numeric: true });
    }
  });
}

function parseAgentInfo(agentInfo) {
  if (!agentInfo) return {};
  if (typeof agentInfo === 'object') return agentInfo;
  try { return JSON.parse(agentInfo); } catch { return {}; }
}

function mergeEquipmentAddresses(addresses, equipment, cidr) {
  const { networkBase, totalHosts } = parseCidr(cidr);
  const belongsToNetwork = ip => {
    try {
      const ipInt = ipToInt(ip);
      return ipInt >= networkBase && ipInt < networkBase + totalHosts;
    } catch {
      return false;
    }
  };
  const byIp = new Map(
    addresses.filter(address => belongsToNetwork(address.ip)).map(address => [address.ip, { ...address }])
  );

  equipment.forEach(item => {
    const info = parseAgentInfo(item.agentInfo);
    if (!Array.isArray(info.ips)) return;

    info.ips.forEach(rawIp => {
      const ip = String(rawIp || '').trim();
      if (!belongsToNetwork(ip)) return;

      const current = byIp.get(ip);
      const equipmentInfo = { id: item.id, name: item.name, type: item.type };
      if (current) {
        byIp.set(ip, {
          ...current,
          hostname: item.agentHostname || item.name || current.hostname,
          equipmentType: item.type || current.equipmentType,
          equipmentId: item.id,
          equipment: equipmentInfo,
        });
        return;
      }

      byIp.set(ip, {
        id: `equipment:${item.id}:${ip}`,
        networkId: null,
        ip,
        hostname: item.agentHostname || item.name || null,
        equipmentType: item.type || null,
        description: null,
        equipmentId: item.id,
        equipment: equipmentInfo,
        autoDiscovered: true,
      });
    });
  });

  return sortIpAddresses([...byIp.values()]);
}

async function loadEquipmentAddresses(addresses, cidr) {
  const equipment = await prisma.equipment.findMany({
    where: { agentInfo: { not: null } },
    select: { id: true, name: true, type: true, agentHostname: true, agentInfo: true }
  });
  return mergeEquipmentAddresses(addresses, equipment, cidr);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function addressesToCsv(addresses) {
  const rows = addresses.map(address => [
    address.ip,
    address.hostname,
    address.equipmentType,
    address.description,
  ].map(csvCell).join(','));
  return ['ip,hostname,type,description', ...rows].join('\r\n');
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
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

function serializeNetworkSnapshot(network) {
  return JSON.stringify({
    network: {
      name: network.name,
      vlan: network.vlan,
      cidr: network.cidr,
      gateway: network.gateway,
      description: network.description,
    },
    ranges: (network.ranges || []).map(({ id, startHost, endHost, label, rangeType }) => ({
      id, startHost, endHost, label, rangeType,
    })),
    addresses: (network.addresses || []).map(({ id, ip, hostname, equipmentType, description, equipmentId }) => ({
      id, ip, hostname, equipmentType, description, equipmentId,
    })),
  });
}

function parseNetworkSnapshot(revision) {
  try {
    const snapshot = JSON.parse(revision.snapshot);
    if (!snapshot?.network || !Array.isArray(snapshot.ranges) || !Array.isArray(snapshot.addresses)) {
      throw new Error();
    }
    return snapshot;
  } catch {
    throw new Error('Instantané d historique invalide');
  }
}

async function createNetworkRevision(networkId, action, user, db = prisma) {
  if (!db.ipNetworkRevision?.create) return null;
  const network = await db.ipNetwork.findUnique({
    where: { id: networkId },
    include: { ranges: true, addresses: true }
  });
  if (!network) return null;
  return db.ipNetworkRevision.create({
    data: {
      networkId,
      action,
      actorName: user?.name || user?.email || null,
      snapshot: serializeNetworkSnapshot(network),
    }
  });
}

function validateRestoredSections(snapshot, current, sections) {
  const cidr = sections.includes('network') ? snapshot.network.cidr : current.cidr;
  const ranges = sections.includes('ranges') ? snapshot.ranges : current.ranges;
  const addresses = sections.includes('addresses') ? snapshot.addresses : current.addresses;
  const { networkBase, totalHosts } = parseCidr(cidr);
  validateGateway(cidr, sections.includes('network') ? snapshot.network.gateway : current.gateway);
  ranges.forEach(range => validateRangeOffsets(cidr, range.startHost, range.endHost));
  addresses.forEach(address => {
    const ipInt = ipToInt(address.ip);
    if (ipInt < networkBase || ipInt >= networkBase + totalHosts) {
      throw new Error(`IP hors du réseau ${cidr}: "${address.ip}"`);
    }
  });
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
    const addresses = await loadEquipmentAddresses(network.addresses, network.cidr);
    res.json({ ...network, addresses, cidrInfo });
  } catch (err) { next(err); }
});

// GET /api/ip-networks/:id/history
router.get('/:id/history', requireAuth, async (req, res, next) => {
  try {
    if (!prisma.ipNetworkRevision?.findMany) return res.json([]);
    const revisions = await prisma.ipNetworkRevision.findMany({
      where: { networkId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json(revisions.map(revision => {
      const snapshot = parseNetworkSnapshot(revision);
      return {
        id: revision.id,
        action: revision.action,
        actorName: revision.actorName,
        createdAt: revision.createdAt,
        summary: {
          networkName: snapshot.network.name,
          ranges: snapshot.ranges.length,
          addresses: snapshot.addresses.length,
        }
      };
    }));
  } catch (err) { next(err); }
});

// POST /api/ip-networks/:id/history/:revisionId/restore
router.post('/:id/history/:revisionId/restore', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sections = Array.isArray(req.body.sections) ? req.body.sections : [];
    const allowedSections = ['network', 'ranges', 'addresses'];
    if (!sections.length || sections.some(section => !allowedSections.includes(section))) {
      return res.status(400).json({ error: 'Sélectionnez au moins une partie valide à restaurer' });
    }
    const revision = await prisma.ipNetworkRevision.findUnique({
      where: { id: req.params.revisionId }
    });
    if (!revision || revision.networkId !== req.params.id) {
      return res.status(404).json({ error: 'Version introuvable' });
    }
    const snapshot = parseNetworkSnapshot(revision);
    const current = await prisma.ipNetwork.findUnique({
      where: { id: req.params.id },
      include: { ranges: true, addresses: true }
    });
    if (!current) return res.status(404).json({ error: 'Réseau introuvable' });
    validateRestoredSections(snapshot, current, sections);
    await createNetworkRevision(req.params.id, `Avant restauration de ${revision.id}`, req.user);
    await prisma.$transaction(async tx => {
      if (sections.includes('network')) {
        await tx.ipNetwork.update({
          where: { id: req.params.id },
          data: snapshot.network
        });
      }
      if (sections.includes('ranges')) {
        await tx.ipRangeDefinition.deleteMany({ where: { networkId: req.params.id } });
        if (snapshot.ranges.length) {
          await tx.ipRangeDefinition.createMany({
            data: snapshot.ranges.map(range => ({ ...range, networkId: req.params.id }))
          });
        }
      }
      if (sections.includes('addresses')) {
        await tx.ipAddress.deleteMany({ where: { networkId: req.params.id } });
        if (snapshot.addresses.length) {
          await tx.ipAddress.createMany({
            data: snapshot.addresses.map(address => ({ ...address, networkId: req.params.id }))
          });
        }
      }
    });
    res.json({ restored: sections });
  } catch (err) {
    if (err.message.includes('CIDR') || err.message.includes('Adresse') || err.message.includes('passerelle') || err.message.includes('historique')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
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
      await createNetworkRevision(req.params.id, 'Modification du réseau', req.user);
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
      await createNetworkRevision(req.params.id, 'Ajout d une plage', req.user);
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
    await createNetworkRevision(req.params.id, 'Modification d une plage', req.user);
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
    await createNetworkRevision(req.params.id, 'Suppression d une plage', req.user);
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
    const [network, addresses] = await Promise.all([
      prisma.ipNetwork.findUnique({ where: { id: req.params.id }, select: { cidr: true } }),
      prisma.ipAddress.findMany({
        where,
        orderBy: { ip: 'asc' },
        include: { equipment: { select: { id: true, name: true, type: true } } }
      })
    ]);
    if (!network) return res.status(404).json({ error: 'Réseau introuvable' });
    res.json(await loadEquipmentAddresses(addresses, network.cidr));
  } catch (err) { next(err); }
});

// GET /api/ip-networks/:id/addresses/export
router.get('/:id/addresses/export', requireAuth, async (req, res, next) => {
  try {
    const [network, addresses] = await Promise.all([
      prisma.ipNetwork.findUnique({ where: { id: req.params.id }, select: { name: true, cidr: true } }),
      prisma.ipAddress.findMany({
        where: { networkId: req.params.id },
        orderBy: { ip: 'asc' },
        include: { equipment: { select: { id: true, name: true, type: true } } }
      })
    ]);
    if (!network) return res.status(404).json({ error: 'Réseau introuvable' });
    const exported = await loadEquipmentAddresses(addresses, network.cidr);
    const filename = `plan-adressage-${network.name || req.params.id}.csv`.replace(/[^a-zA-Z0-9._-]+/g, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${addressesToCsv(exported)}`);
  } catch (err) { next(err); }
});

// POST /api/ip-networks/:id/addresses/bulk
router.post('/:id/addresses/bulk', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    const deleteIds = Array.isArray(req.body.deleteIds) ? req.body.deleteIds : [];
    if (updates.some(item => !item?.id) || deleteIds.some(id => !id)) {
      return res.status(400).json({ error: 'Identifiant d’adresse manquant' });
    }
    const updateIds = updates.map(item => item.id);
    if (new Set(updateIds).size !== updateIds.length || deleteIds.some(id => updateIds.includes(id))) {
      return res.status(400).json({ error: 'Brouillon de modification incohérent' });
    }
    const network = await prisma.ipNetwork.findUnique({ where: { id: req.params.id }, select: { cidr: true } });
    if (!network) return res.status(404).json({ error: 'Réseau introuvable' });

    const { networkBase, totalHosts } = parseCidr(network.cidr);
    const ids = [...new Set([...updates.map(item => item.id), ...deleteIds].filter(Boolean))];
    const current = ids.length
      ? await prisma.ipAddress.findMany({ where: { networkId: req.params.id, id: { in: ids } } })
      : [];
    if (current.length !== ids.length) {
      return res.status(400).json({ error: 'Une adresse à modifier est introuvable dans ce réseau' });
    }

    const normalizedUpdates = updates.map(item => {
      const ip = String(item.ip || '').trim();
      const ipInt = ipToInt(ip);
      if (ipInt < networkBase || ipInt >= networkBase + totalHosts) {
        throw new Error(`IP hors du réseau ${network.cidr}: "${ip}"`);
      }
      return {
        id: item.id,
        data: {
          ip,
          hostname: String(item.hostname || '').trim() || null,
          equipmentType: String(item.equipmentType || '').trim() || null,
          description: String(item.description || '').trim() || null,
        }
      };
    });

    await createNetworkRevision(req.params.id, 'Modification groupée des adresses', req.user);
    await prisma.$transaction(async tx => {
      if (deleteIds.length) {
        await tx.ipAddress.deleteMany({ where: { networkId: req.params.id, id: { in: deleteIds } } });
      }
      for (const item of normalizedUpdates) {
        await tx.ipAddress.update({ where: { id: item.id }, data: item.data });
      }
    });

    res.json({ updated: normalizedUpdates.length, deleted: deleteIds.length });
  } catch (err) {
    if (err.message.includes('Adresse IP') || err.message.includes('hors du réseau')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 'P2002') return res.status(409).json({ error: 'Une adresse IP est présente plusieurs fois dans ce réseau' });
    next(err);
  }
});

// POST /api/ip-networks/:id/addresses
router.post('/:id/addresses',
  requireAuth, requireAdmin,
  body('ip').trim().notEmpty().withMessage('IP requise').matches(/^\d+\.\d+\.\d+\.\d+$/).withMessage('Format IP invalide'),
  async (req, res, next) => {
    if (!validate(req, res)) return;
    try {
      await createNetworkRevision(req.params.id, 'Ajout d une adresse IP', req.user);
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
    await createNetworkRevision(req.params.id, 'Modification d une adresse IP', req.user);
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
    await createNetworkRevision(req.params.id, 'Suppression d une adresse IP', req.user);
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
    const network = await prisma.ipNetwork.findUnique({ where: { id: req.params.id }, select: { cidr: true } });
    if (!network) return res.status(404).json({ error: 'Réseau introuvable' });
    const { networkBase, totalHosts } = parseCidr(network.cidr);

    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV vide ou sans données' });

    const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
    const ipIdx          = header.indexOf('ip');
    const hostnameIdx    = header.indexOf('hostname');
    const typeIdx        = header.findIndex(h => ['equipmenttype', 'type'].includes(h));
    const descIdx        = header.findIndex(h => ['description', 'desc'].includes(h));

    if (ipIdx === -1) return res.status(400).json({ error: 'Colonne "ip" manquante dans le CSV' });

    const results = { created: 0, updated: 0, errors: [] };
    await createNetworkRevision(req.params.id, 'Import CSV des adresses', req.user);

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const ip = cols[ipIdx];
      let ipInt = null;
      try { ipInt = ipToInt(ip); } catch {}
      if (ipInt === null) {
        results.errors.push({ line: i + 1, error: `IP invalide: "${ip}"` });
        if (!skipErrors) break;
        continue;
      }
      if (ipInt < networkBase || ipInt >= networkBase + totalHosts) {
        results.errors.push({ line: i + 1, error: `IP hors du réseau ${network.cidr}: "${ip}"` });
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
        const existing = await prisma.ipAddress.findUnique({
          where: { networkId_ip: { networkId: req.params.id, ip } }
        });
        await prisma.ipAddress.upsert({
          where: { networkId_ip: { networkId: req.params.id, ip } },
          create: { networkId: req.params.id, ...data },
          update: data,
        });
        if (existing) results.updated++;
        else results.created++;
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

// ── Migrations IP ─────────────────────────────────────────────────────────────

const MIGRATION_INCLUDE = {
  network: { select: { id: true, name: true, cidr: true } },
  ipAddress: { select: { id: true, ip: true, hostname: true } },
  intervention: { select: { id: true, title: true } },
  todo: { select: { id: true, title: true, done: true, doneAt: true } },
  createdBy: { select: { id: true, name: true } },
  appliedBy: { select: { id: true, name: true } },
};

// GET /api/ip-networks/:id/migrations
router.get('/:id/migrations', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = { networkId: req.params.id };
    if (status) where.status = status;
    const migrations = await prisma.ipMigration.findMany({
      where,
      include: MIGRATION_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });
    res.json(migrations);
  } catch (err) { next(err); }
});

// GET /api/ip-networks/migrations/:migrationId
router.get('/migrations/:migrationId', requireAuth, async (req, res, next) => {
  try {
    const migration = await prisma.ipMigration.findUnique({
      where: { id: req.params.migrationId },
      include: MIGRATION_INCLUDE,
    });
    if (!migration) return res.status(404).json({ error: 'Migration introuvable' });
    res.json(migration);
  } catch (err) { next(err); }
});

// POST /api/ip-networks/:id/migrations — Créer une migration + tâche liée
router.post('/:id/migrations',
  requireAuth, requireAdmin,
  body('oldIp').trim().notEmpty().withMessage('oldIp requis'),
  body('newIp').trim().notEmpty().withMessage('newIp requis').matches(/^\d+\.\d+\.\d+\.\d+$/).withMessage('Format IP invalide'),
  async (req, res, next) => {
    if (!validate(req, res)) return;
    try {
      const network = await prisma.ipNetwork.findUnique({ where: { id: req.params.id } });
      if (!network) return res.status(404).json({ error: 'Réseau introuvable' });

      // Trouver l'adresse IP source si elle existe dans le plan
      const existingAddr = await prisma.ipAddress.findUnique({
        where: { networkId_ip: { networkId: req.params.id, ip: req.body.oldIp } }
      });

      const { oldIp, newIp, newHostname, newType, notes, interventionId, scheduledAt } = req.body;

      // Créer la tâche Todo liée
      const todoTitle = `Migration IP : ${oldIp} → ${newIp} (${network.name})`;
      const todo = await prisma.todo.create({
        data: {
          title: todoTitle,
          description: notes || null,
          interventionId: interventionId || null,
          dueAt: scheduledAt ? new Date(scheduledAt) : null,
        }
      });

      const migration = await prisma.ipMigration.create({
        data: {
          networkId: req.params.id,
          ipAddressId: existingAddr?.id || null,
          oldIp: oldIp.trim(),
          newIp: newIp.trim(),
          newHostname: newHostname?.trim() || null,
          newType: newType?.trim() || null,
          notes: notes?.trim() || null,
          interventionId: interventionId || null,
          todoId: todo.id,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          createdById: req.user?.id || null,
        },
        include: MIGRATION_INCLUDE,
      });

      res.status(201).json(migration);
    } catch (err) { next(err); }
  }
);

// POST /api/ip-networks/migrations/:migrationId/apply — Appliquer manuellement
router.post('/migrations/:migrationId/apply', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const migration = await prisma.ipMigration.findUnique({
      where: { id: req.params.migrationId },
      include: { ipAddress: true, network: true, todo: true }
    });
    if (!migration) return res.status(404).json({ error: 'Migration introuvable' });
    if (migration.status !== 'PLANNED') {
      return res.status(400).json({ error: `Migration déjà ${migration.status === 'APPLIED' ? 'appliquée' : 'annulée'}` });
    }

    await applyMigration(migration, req.user?.id);
    const updated = await prisma.ipMigration.findUnique({ where: { id: req.params.migrationId }, include: MIGRATION_INCLUDE });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/ip-networks/migrations/:migrationId — Annuler
router.delete('/migrations/:migrationId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const migration = await prisma.ipMigration.findUnique({ where: { id: req.params.migrationId } });
    if (!migration) return res.status(404).json({ error: 'Migration introuvable' });
    if (migration.status === 'APPLIED') return res.status(400).json({ error: 'Impossible d\'annuler une migration déjà appliquée' });
    await prisma.ipMigration.update({
      where: { id: req.params.migrationId },
      data: { status: 'CANCELLED', updatedAt: new Date() }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Logique d'application d'une migration ─────────────────────────────────────
async function applyMigration(migration, appliedById) {
  const { id, networkId, ipAddressId, oldIp, newIp, newHostname, newType, todoId } = migration;

  await prisma.$transaction(async (tx) => {
    // 1. Mettre à jour ou créer l'entrée IP dans le plan
    if (ipAddressId) {
      // Vérifier qu'aucune autre IP n'a déjà la nouvelle adresse
      const conflict = await tx.ipAddress.findUnique({
        where: { networkId_ip: { networkId, ip: newIp } }
      });
      if (conflict && conflict.id !== ipAddressId) {
        // Supprimer l'entrée conflictuelle (ancienne entrée de la newIp)
        await tx.ipAddress.delete({ where: { id: conflict.id } });
      }
      await tx.ipAddress.update({
        where: { id: ipAddressId },
        data: {
          ip: newIp,
          ...(newHostname !== null && newHostname !== undefined ? { hostname: newHostname } : {}),
          ...(newType !== null && newType !== undefined ? { equipmentType: newType } : {}),
        }
      });
    } else {
      // L'ancienne IP n'existait pas dans le plan → créer la nouvelle
      await tx.ipAddress.upsert({
        where: { networkId_ip: { networkId, ip: newIp } },
        create: { networkId, ip: newIp, hostname: newHostname || null, equipmentType: newType || null },
        update: {
          ...(newHostname !== undefined ? { hostname: newHostname } : {}),
          ...(newType !== undefined ? { equipmentType: newType } : {}),
        }
      });
    }

    // 2. Marquer la migration comme appliquée
    await tx.ipMigration.update({
      where: { id },
      data: { status: 'APPLIED', appliedAt: new Date(), appliedById: appliedById || null }
    });

    // 3. Marquer la tâche como terminée si pas déjà fait
    if (todoId) {
      const todo = await tx.todo.findUnique({ where: { id: todoId } });
      if (todo && !todo.done) {
        await tx.todo.update({ where: { id: todoId }, data: { done: true, doneAt: new Date() } });
      }
    }
  });
}

// Exposer applyMigration pour le hook todos
module.exports = { router, applyMigration };

