const prisma = require('../lib/prisma');

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

module.exports = { getRoom, listRooms };
