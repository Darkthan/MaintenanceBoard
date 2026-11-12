const prisma = require('../lib/prisma');
const { createRoomSchema, updateRoomSchema } = require('./roomFields');

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function present(row) {
  if (!row) return row;
  const { qrToken, ...room } = row;
  return room;
}

async function getRoom({ id }) {
  if (!id) fail('Renseignez id pour identifier la salle');
  const row = await prisma.room.findUnique({
    where: { id },
    include: {
      equipment: {
        orderBy: { name: 'asc' },
        select: { id: true, name: true, type: true, brand: true, model: true, status: true, serialNumber: true }
      },
      _count: { select: { equipment: true, interventions: true } }
    }
  });
  if (!row) fail('Salle introuvable', 404);
  return present(row);
}

async function listRooms({ search, building, limit = 50, cursor } = {}) {
  const where = {};
  if (building) where.building = { contains: building };
  if (search) where.OR = ['name', 'number', 'description'].map(field => ({ [field]: { contains: search } }));
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await prisma.room.findMany({
    where, take: take + 1, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: 'asc' }, include: { _count: { select: { equipment: true, interventions: true } } }
  });
  return { data: rows.slice(0, take).map(present), nextCursor: rows.length > take ? rows[take - 1].id : null };
}

function requireRoomUser(user, write = false) {
  if (!user?.id || user.isActive === false) fail('Utilisateur authentifié actif requis', 401);
  if (!['ADMIN', 'TECH'].includes(user.role) || (write && user.role !== 'ADMIN')) {
    fail('Accès refusé : gestion des salles réservée aux administrateurs', 403);
  }
}

async function saveRoom(input, user, id) {
  requireRoomUser(user, true);
  const parsed = (id === undefined ? createRoomSchema : updateRoomSchema).safeParse(input);
  if (!parsed.success) fail(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const data = { ...parsed.data };
  for (const field of ['building', 'number', 'description']) {
    if (data[field] === '') data[field] = null;
  }
  try {
    return await prisma.$transaction(async tx => {
      const current = id === undefined ? null : await tx.room.findUnique({ where: { id } });
      if (id !== undefined && !current) fail('Salle introuvable', 404);
      const merged = { building: null, floor: null, number: null, ...current, ...data };
      // Une identité de salle est son nom et sa localisation (bâtiment, étage, numéro).
      const duplicate = await tx.room.findFirst({ where: {
        name: merged.name, building: merged.building, floor: merged.floor, number: merged.number,
        ...(id === undefined ? {} : { id: { not: id } })
      } });
      if (duplicate) fail('Une salle avec ce nom et cette localisation existe déjà', 409);
      const row = id === undefined
        ? await tx.room.create({ data })
        : await tx.room.update({ where: { id }, data });
      return present(row);
    }, { isolationLevel: 'Serializable' });
  } catch (err) {
    if (err.code === 'P2025') fail('Salle introuvable', 404);
    if (err.code === 'P2002') fail('Une salle existe déjà avec ces informations', 409);
    if (err.code === 'P2034') fail('Modification concurrente des salles : réessayez', 409);
    throw err;
  }
}

const createRoom = (input, user) => saveRoom(input, user);
async function updateRoom({ id, ...input }, user) {
  if (typeof id !== 'string' || !id.trim()) fail('Renseignez id pour identifier la salle');
  return saveRoom(input, user, id);
}

module.exports = { getRoom, listRooms, createRoom, updateRoom, requireRoomUser };
