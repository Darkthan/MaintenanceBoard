const prisma = require('../lib/prisma');
const { z } = require('zod');
const { localDateTimeToUTC } = require('../mcp/tzUtils');

const fields = {
  roomId: z.string().trim().min(1),
  visitedAt: z.string().min(1).optional(),
  observation: z.string().trim().max(10000).optional(),
  damageFound: z.boolean().optional(),
  controlImpossible: z.boolean().optional(),
  controlImpossibleReason: z.string().trim().max(2000).optional()
};
const createSchema = z.object(fields).strict();
const updateSchema = createSchema.partial();
const include = {
  room: { select: { id: true, name: true, number: true, building: true } },
  author: { select: { id: true, name: true } }
};
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) fail(400, result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(value)) fail(400, 'Date de passage invalide (ISO 8601 attendu)');
  const [day, time] = value.split('T');
  const calendarDate = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day || Number(time.slice(0, 2)) > 23 || Number(time.slice(3, 5)) > 59 || (time.length >= 8 && time[5] === ':' && Number(time.slice(6, 8)) > 59)) fail(400, 'Date de passage invalide');
  const result = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? new Date(value) : localDateTimeToUTC(day, time);
  if (!result || Number.isNaN(result.getTime())) fail(400, 'Date de passage invalide');
  return result;
}
async function dataFor(input, partial) {
  const data = parse(partial ? updateSchema : createSchema, input);
  if (data.roomId && !await prisma.room.findUnique({ where: { id: data.roomId }, select: { id: true } })) fail(404, 'Salle introuvable');
  if (data.visitedAt !== undefined) data.visitedAt = date(data.visitedAt);
  else if (!partial) data.visitedAt = new Date();
  return data;
}
function requireWriter(user) {
  if (!user || !['ADMIN', 'TECH'].includes(user.role)) fail(403, 'Accès réservé aux techniciens et administrateurs');
}
function validateControl(data, existing = {}) {
  const impossible = data.controlImpossible ?? existing.controlImpossible ?? false;
  const reason = data.controlImpossibleReason ?? existing.controlImpossibleReason ?? '';
  if (impossible && !reason.trim()) fail(400, 'Précisez la raison du contrôle impossible');
  if (!impossible && reason) {
    if (data.controlImpossible === false) data.controlImpossibleReason = '';
    else fail(400, 'Cochez Contrôle impossible pour renseigner une raison');
  }
}
async function listRoomVisits(input = {}) {
  const args = parse(z.object({ roomId: fields.roomId.optional(), from: z.string().optional(), to: z.string().optional(), damageFound: z.boolean().optional(), authorId: z.string().optional(), page: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), input);
  const { from, to, page = 1, limit = 50, ...where } = args;
  if (from || to) where.visitedAt = { ...(from ? { gte: date(from) } : {}), ...(to ? { lt: date(to) } : {}) };
  if (from && to && date(from) >= date(to)) fail(400, 'La fin doit suivre le début');
  const [data, total] = await Promise.all([
    prisma.roomVisit.findMany({ where, include, orderBy: [{ visitedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    prisma.roomVisit.count({ where })
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
async function createRoomVisit(input, user) {
  requireWriter(user);
  const data = await dataFor(input, false);
  validateControl(data);
  return prisma.roomVisit.create({ data: { ...data, authorId: user.id }, include });
}
async function updateRoomVisit(id, input, user) {
  requireWriter(user);
  const data = await dataFor(input, true);
  if (data.controlImpossible !== undefined || data.controlImpossibleReason !== undefined) {
    const existing = await prisma.roomVisit.findUnique({ where: { id }, select: { controlImpossible: true, controlImpossibleReason: true } });
    if (!existing) fail(404, 'Passage introuvable');
    validateControl(data, existing);
  }
  try { return await prisma.roomVisit.update({ where: { id }, data, include }); }
  catch (error) { if (error.code === 'P2025') fail(404, 'Passage introuvable'); throw error; }
}
async function deleteRoomVisit(id, user) {
  requireWriter(user);
  try { await prisma.roomVisit.delete({ where: { id } }); return { message: 'Passage supprimé' }; }
  catch (error) { if (error.code === 'P2025') fail(404, 'Passage introuvable'); throw error; }
}
module.exports = { listRoomVisits, createRoomVisit, updateRoomVisit, deleteRoomVisit };
