const prisma = require('../lib/prisma');

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

function parseGatewayList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(item => parseGatewayList(item));
  }

  const text = String(value).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.flatMap(item => parseGatewayList(item));
  } catch {}

  return text
    .split(/[\n,;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeSecondaryGateways(cidr, value, primaryGateway = null) {
  const seen = new Set();
  const gateways = [];
  parseGatewayList(value).forEach(entry => {
    const normalized = validateGateway(cidr, entry);
    if (!normalized) return;
    if (primaryGateway && normalized === primaryGateway) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    gateways.push(normalized);
  });
  return gateways;
}

function serializeSecondaryGateways(cidr, value, primaryGateway = null) {
  const gateways = normalizeSecondaryGateways(cidr, value, primaryGateway);
  return gateways.length ? JSON.stringify(gateways) : null;
}

function withStoredGateway(cidrInfo, gateway, secondaryGateways) {
  return cidrInfo ? {
    ...cidrInfo,
    gateway: gateway || cidrInfo.gateway,
    secondaryGateways: parseGatewayList(secondaryGateways)
  } : cidrInfo;
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
      secondaryGateways: parseGatewayList(network.secondaryGateways),
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
    snapshot.network.secondaryGateways = parseGatewayList(snapshot.network.secondaryGateways);
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
  const latest = await db.ipNetworkRevision.findFirst({
    where: { networkId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const createdAt = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
  return db.ipNetworkRevision.create({
    data: {
      networkId,
      action,
      actorName: user?.name || user?.email || null,
      snapshot: serializeNetworkSnapshot(network),
      createdAt,
    }
  });
}

function validateRestoredSections(snapshot, current, sections) {
  const cidr = sections.includes('network') ? snapshot.network.cidr : current.cidr;
  const ranges = sections.includes('ranges') ? snapshot.ranges : current.ranges;
  const addresses = sections.includes('addresses') ? snapshot.addresses : current.addresses;
  const { networkBase, totalHosts } = parseCidr(cidr);
  validateGateway(cidr, sections.includes('network') ? snapshot.network.gateway : current.gateway);
  normalizeSecondaryGateways(
    cidr,
    sections.includes('network') ? snapshot.network.secondaryGateways : current.secondaryGateways,
    sections.includes('network') ? snapshot.network.gateway : current.gateway
  );
  ranges.forEach(range => validateRangeOffsets(cidr, range.startHost, range.endHost));
  addresses.forEach(address => {
    const ipInt = ipToInt(address.ip);
    if (ipInt < networkBase || ipInt >= networkBase + totalHosts) {
      throw new Error(`IP hors du réseau ${cidr}: "${address.ip}"`);
    }
  });
}

// ── Réseaux ───────────────────────────────────────────────────────────────────


module.exports = { parseCidr, intToIp, ipToInt, sortIpAddresses, parseAgentInfo, mergeEquipmentAddresses, loadEquipmentAddresses, csvCell, addressesToCsv, parseCsvLine, validateGateway, parseGatewayList, normalizeSecondaryGateways, serializeSecondaryGateways, withStoredGateway, validateRangeOffsets, ipToHostOffset, serializeNetworkSnapshot, parseNetworkSnapshot, createNetworkRevision, validateRestoredSections };
