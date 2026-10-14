const prisma = require('../lib/prisma');
const { equipmentReferences, REFERENCE_FIELDS } = require('../utils/equipmentReferences');

const STATUSES = ['ACTIVE', 'INACTIVE', 'REPAIR', 'DECOMMISSIONED', 'DEEE'];
const detailInclude = {
  room: { select: { id: true, name: true, number: true, building: true } },
  ipAddresses: { include: { network: { select: { id: true, name: true, vlan: true, cidr: true } } } },
  networkInterfaces: { include: { ipAddress: { include: { network: { select: { id: true, name: true, vlan: true, cidr: true } } } } }, orderBy: { name: 'asc' } }
};

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function present(row) {
  if (!row) return row;
  const { agentToken, qrToken, agentAlertState, ...equipment } = row;
  return {
    ...equipment,
    networkInterfaces: row.networkInterfaces || [],
    // Les liens IPAM antérieurs à l'ajout des interfaces restent visibles.
    ipAddresses: row.ipAddresses || []
  };
}

async function getEquipment({ id }) {
  const row = await prisma.equipment.findUnique({ where: { id }, include: detailInclude });
  if (!row) fail('Équipement introuvable', 404);
  return present(row);
}

async function listEquipment({ search, serialNumbers, type, roomId, status, ip, mac, limit = 50, cursor } = {}) {
  const where = {};
  if (serialNumbers) where.serialNumber = { in: serialNumbers.map(value => value.trim()) };
  if (status) {
    if (!STATUSES.includes(status)) fail('Statut invalide');
    where.status = status;
  }
  if (type) where.type = { contains: type };
  if (roomId) where.roomId = roomId;
  if (search) where.OR = ['name', 'serialNumber', 'brand', 'model', 'agentHostname'].map(field => ({ [field]: { contains: search } }));
  if (ip) where.ipAddresses = { some: { ip: { contains: ip } } };
  if (mac) where.networkInterfaces = { some: { macAddress: { contains: mac } } };
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await prisma.equipment.findMany({
    where, take: take + 1, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: 'asc' }, include: detailInclude
  });
  return { data: rows.slice(0, take).map(present), nextCursor: rows.length > take ? rows[take - 1].id : null };
}

async function updateEquipment({ id, ...input }) {
  const allowed = ['name', 'type', 'brand', 'model', 'serialNumber', 'status', 'description', 'roomId', 'agentHostname', 'purchaseDate', 'warrantyEnd'];
  const data = Object.fromEntries(allowed.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  Object.assign(data, equipmentReferences(input));
  if (!Object.keys(data).length) fail('Aucun champ à modifier');
  if (data.status && !STATUSES.includes(data.status)) fail('Statut invalide');
  for (const key of ['name', 'type']) if (key in data && !String(data[key] || '').trim()) fail(`${key} ne peut pas être vide`);
  for (const key of ['purchaseDate', 'warrantyEnd']) {
    if (key in data && data[key] !== null) {
      if (Number.isNaN(Date.parse(data[key]))) fail(`${key} doit être une date ISO valide`);
      data[key] = new Date(data[key]);
    }
  }
  if (data.roomId) {
    if (!await prisma.room.findUnique({ where: { id: data.roomId }, select: { id: true } })) fail('Salle introuvable', 404);
  }
  if (!await prisma.equipment.findUnique({ where: { id }, select: { id: true } })) fail('Équipement introuvable', 404);
  try {
    await prisma.equipment.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2002') fail('Numéro de série déjà utilisé', 409);
    throw error;
  }
  return getEquipment({ id });
}

async function listEquipmentNetworkInterfaces({ equipmentId }) {
  const equipment = await getEquipment({ id: equipmentId });
  return { equipmentId, interfaces: equipment.networkInterfaces, ipAddresses: equipment.ipAddresses };
}

function normalizeMac(mac) {
  if (mac === null) return null;
  const raw = String(mac).replace(/[-:.]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(raw)) fail('Adresse MAC invalide');
  return raw.match(/.{2}/g).join(':');
}

async function updateEquipmentNetworkInterface({ equipmentId, interfaceId, name, macAddress, ipAddressId }) {
  if (!await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { id: true } })) fail('Équipement introuvable', 404);
  const current = interfaceId ? await prisma.equipmentNetworkInterface.findUnique({ where: { id: interfaceId } }) : null;
  if (interfaceId && (!current || current.equipmentId !== equipmentId)) fail('Interface introuvable', 404);
  if (!interfaceId && (!name || !String(name).trim())) fail('Nom de l’interface requis');
  const data = {};
  if (name !== undefined) {
    if (!String(name).trim()) fail('Nom de l’interface requis');
    data.name = String(name).trim();
  }
  if (macAddress !== undefined) data.macAddress = normalizeMac(macAddress);
  if (ipAddressId !== undefined) data.ipAddressId = ipAddressId;
  if (!Object.keys(data).length) fail('Aucun champ à modifier');

  if (ipAddressId) {
    const address = await prisma.ipAddress.findUnique({ where: { id: ipAddressId }, include: { networkInterface: true } });
    if (!address) fail('Adresse IPAM introuvable', 404);
    if (address.equipmentId && address.equipmentId !== equipmentId) fail('Adresse IPAM affectée à un autre équipement', 409);
    if (address.networkInterface && address.networkInterface.id !== interfaceId) fail('Adresse IPAM liée à une autre interface', 409);
  }

  try {
    const row = await prisma.$transaction(async tx => {
      const saved = interfaceId
        ? await tx.equipmentNetworkInterface.update({ where: { id: interfaceId }, data })
        : await tx.equipmentNetworkInterface.create({ data: { equipmentId, ...data } });
      if (current?.ipAddressId && current.ipAddressId !== saved.ipAddressId) {
        await tx.ipAddress.updateMany({
          where: { id: current.ipAddressId, equipmentId }, data: { equipmentId: null }
        });
      }
      if (ipAddressId) {
        const linked = await tx.ipAddress.updateMany({
          where: { id: ipAddressId, OR: [{ equipmentId: null }, { equipmentId }] },
          data: { equipmentId }
        });
        if (linked.count !== 1) fail('Adresse IPAM affectée à un autre équipement', 409);
      }
      return saved;
    });
    return prisma.equipmentNetworkInterface.findUnique({ where: { id: row.id }, include: { ipAddress: { include: { network: true } } } });
  } catch (error) {
    if (error.code === 'P2002') fail('Adresse IPAM déjà liée à une interface', 409);
    throw error;
  }
}

// Correspondances exactes uniquement : aucune correction OCR implicite des séries.
async function prepareEquipmentDocuments(db, input) {
  if (!Array.isArray(input.serialNumbers) || !input.serialNumbers.length || input.serialNumbers.length > 100 ||
      input.serialNumbers.some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 200)) {
    fail('Renseignez de 1 à 100 numéros de série non vides (200 caractères maximum)');
  }
  const serialNumbers = input.serialNumbers.map(value => value.trim());
  if (new Set(serialNumbers).size !== serialNumbers.length) fail('Numéros de série dupliqués dans le lot');
  const references = equipmentReferences(input);
  if (!Object.keys(references).length || Object.values(references).some(value => !value)) {
    fail('Renseignez au moins un numéro de facture ou de BL non vide ; les champs omis restent inchangés');
  }
  const rows = await db.equipment.findMany({
    where: { serialNumber: { in: serialNumbers } },
    select: { id: true, name: true, serialNumber: true, invoiceNumber: true, deliveryNoteNumber: true }
  });
  const bySerial = new Map(rows.map(row => [row.serialNumber, row]));
  const missingSerialNumbers = serialNumbers.filter(serial => !bySerial.has(serial));
  const matches = serialNumbers.filter(serial => bySerial.has(serial)).map(serial => {
    const row = bySerial.get(serial);
    const changes = Object.entries(references).filter(([field, value]) => row[field] !== value)
      .map(([field, value]) => ({ field, previous: row[field] ?? null, next: value }));
    return { ...row, changes };
  });
  const conflicts = matches.flatMap(row => row.changes.filter(change => change.previous !== null && change.previous !== '')
    .map(change => ({ serialNumber: row.serialNumber, ...change })));
  return { references, matches, missingSerialNumbers, conflicts,
    canApply: !missingSerialNumbers.length && (!conflicts.length || input.overwrite === true) };
}

async function previewEquipmentDocuments(input) {
  return prepareEquipmentDocuments(prisma, input);
}

async function associateEquipmentDocuments(input) {
  return prisma.$transaction(async tx => {
    const preview = await prepareEquipmentDocuments(tx, input);
    if (!preview.canApply) {
      fail(`Association refusée : ${JSON.stringify({ missingSerialNumbers: preview.missingSerialNumbers, conflicts: preview.conflicts })}`, 409);
    }
    let updatedCount = 0;
    for (const row of preview.matches) {
      if (!row.changes.length) continue;
      const where = { id: row.id, serialNumber: row.serialNumber };
      for (const field of REFERENCE_FIELDS) where[field] = row[field] ?? null;
      const result = await tx.equipment.updateMany({ where, data: preview.references });
      if (result.count !== 1) fail('La fiche a changé pendant l’association. Relancez l’aperçu.', 409);
      updatedCount++;
    }
    return { ...preview, updatedCount, unchangedCount: preview.matches.length - updatedCount };
  });
}

module.exports = { listEquipment, getEquipment, updateEquipment, listEquipmentNetworkInterfaces, updateEquipmentNetworkInterface,
  previewEquipmentDocuments, associateEquipmentDocuments };
