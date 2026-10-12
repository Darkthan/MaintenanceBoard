jest.mock('../src/lib/prisma', () => ({
  room: { findUnique: jest.fn() },
  roomVisit: { create: jest.fn(), update: jest.fn(), delete: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() }
}));
jest.mock('../src/middleware/auth', () => ({ requireAuth: (req, res, next) => {
  if (!req.headers['x-role']) return res.status(401).json({ error: 'Non authentifié' });
  req.user = { id: 'u1', role: req.headers['x-role'] }; next();
} }));
const prisma = require('../src/lib/prisma');
const service = require('../src/services/roomVisitService');
const { buildMcpServer } = require('../src/mcp/server');
const request = require('supertest');
const express = require('express');
const app = express(); app.use(express.json()); app.use('/api/room-visits', require('../src/routes/roomVisits'));
const user = { id: 'u1', role: 'TECH' };
beforeEach(() => { jest.clearAllMocks(); prisma.room.findUnique.mockResolvedValue({ id: 'r1' }); });
test('crée un passage daté maintenant, attribué au technicien, avec dégradations', async () => {
  prisma.roomVisit.create.mockImplementation(async args => args.data);
  const before = Date.now();
  const result = await service.createRoomVisit({ roomId: 'r1', observation: ' Porte abîmée ', damageFound: true }, user);
  expect(result.authorId).toBe('u1'); expect(result.observation).toBe('Porte abîmée');
  expect(result.damageFound).toBe(true); expect(result.visitedAt.getTime()).toBeGreaterThanOrEqual(before);
});
test('interprète les dates MCP sans décalage en Europe/Paris', async () => {
  await service.createRoomVisit({ roomId: 'r1', visitedAt: '2026-10-12T10:15' }, user);
  expect(prisma.roomVisit.create.mock.calls[0][0].data.visitedAt.toISOString()).toBe('2026-10-12T08:15:00.000Z');
});
test('rejette les entrées invalides et les salles absentes', async () => {
  for (const input of [{ damageFound: 'false' }, { visitedAt: 'bad' }, { visitedAt: '2026-02-30T10:00' }, { authorId: 'someone' }]) {
    await expect(service.createRoomVisit({ roomId: 'r1', ...input }, user)).rejects.toMatchObject({ status: 400 });
  }
  prisma.room.findUnique.mockResolvedValue(null);
  await expect(service.createRoomVisit({ roomId: 'missing' }, user)).rejects.toMatchObject({ status: 404 });
  expect(prisma.roomVisit.create).not.toHaveBeenCalled();
});
test('modification partielle permet de retirer une dégradation sans changer la date', async () => {
  await service.updateRoomVisit('v1', { observation: 'Contrôle corrigé', damageFound: false }, user);
  expect(prisma.roomVisit.update.mock.calls[0][0].data).toEqual({ observation: 'Contrôle corrigé', damageFound: false });
  prisma.roomVisit.delete.mockRejectedValue({ code: 'P2025' });
  await expect(service.deleteRoomVisit('missing', user)).rejects.toMatchObject({ status: 404 });
});
test('liste paginée avec intervalle exclusif, auteur et dégradations', async () => {
  prisma.roomVisit.findMany.mockResolvedValue([]); prisma.roomVisit.count.mockResolvedValue(201);
  const result = await service.listRoomVisits({ roomId: 'r1', from: '2026-10-01T00:00Z', to: '2026-11-01T00:00Z', authorId: 'u1', damageFound: true, page: 2, limit: 100 });
  expect(result.pagination.totalPages).toBe(3);
  expect(prisma.roomVisit.findMany.mock.calls[0][0]).toMatchObject({ skip: 100, take: 100, where: { roomId: 'r1', authorId: 'u1', damageFound: true, visitedAt: { gte: expect.any(Date), lt: expect.any(Date) } } });
});
test('API protège les accès et permet création, modification, suppression', async () => {
  expect((await request(app).get('/api/room-visits')).status).toBe(401);
  expect((await request(app).post('/api/room-visits').set('x-role', 'PRINT_MANAGER').send({ roomId: 'r1' })).status).toBe(403);
  prisma.roomVisit.create.mockResolvedValue({ id: 'v1' }); prisma.roomVisit.update.mockResolvedValue({ id: 'v1', damageFound: false }); prisma.roomVisit.delete.mockResolvedValue({});
  expect((await request(app).post('/api/room-visits').set('x-role', 'TECH').send({ roomId: 'r1' })).status).toBe(201);
  expect((await request(app).patch('/api/room-visits/v1').set('x-role', 'TECH').send({ damageFound: false })).body.damageFound).toBe(false);
  expect((await request(app).delete('/api/room-visits/v1').set('x-role', 'ADMIN')).status).toBe(200);
  expect((await request(app).get('/api/room-visits?damageFound=bogus').set('x-role', 'TECH')).status).toBe(400);
});
test('MCP expose les quatre outils et impose scopes et rôle', async () => {
  const names = ['list_room_visits', 'create_room_visit', 'update_room_visit', 'delete_room_visit'];
  const denied = buildMcpServer({ scopes: [], createdBy: user });
  for (const name of names) {
    expect(denied._registeredTools[name]).toBeDefined();
    expect((await denied._registeredTools[name].handler({ id: 'v1', roomId: 'r1' })).isError).toBe(true);
  }
  const server = buildMcpServer({ scopes: ['room_visits:write'], createdBy: user });
  prisma.roomVisit.create.mockResolvedValue({ id: 'v1', damageFound: true });
  const result = await server._registeredTools.create_room_visit.handler({ roomId: 'r1', damageFound: true });
  expect(JSON.parse(result.content[0].text).damageFound).toBe(true);
  const noUser = buildMcpServer({ scopes: ['room_visits:write'], createdBy: null });
  expect((await noUser._registeredTools.delete_room_visit.handler({ id: 'v1' })).isError).toBe(true);
});
test('contrôle impossible exige une raison non vide à la création', async () => {
  for (const reason of [undefined, '', '   ']) {
    await expect(service.createRoomVisit({ roomId: 'r1', controlImpossible: true, ...(reason !== undefined ? { controlImpossibleReason: reason } : {}) }, user)).rejects.toMatchObject({ status: 400 });
  }
  expect(prisma.roomVisit.create).not.toHaveBeenCalled();
  await service.createRoomVisit({ roomId: 'r1', controlImpossible: true, controlImpossibleReason: '  Salle occupée  ' }, user);
  expect(prisma.roomVisit.create.mock.calls[0][0].data).toMatchObject({ controlImpossible: true, controlImpossibleReason: 'Salle occupée' });
});
test('modification partielle conserve la raison existante et refuse son effacement', async () => {
  prisma.roomVisit.findUnique.mockResolvedValue({ controlImpossible: true, controlImpossibleReason: 'Porte verrouillée' });
  await service.updateRoomVisit('v1', { controlImpossible: true }, user);
  expect(prisma.roomVisit.update.mock.calls[0][0].data).toEqual({ controlImpossible: true });
  await expect(service.updateRoomVisit('v1', { controlImpossibleReason: ' ' }, user)).rejects.toMatchObject({ status: 400 });
  await service.updateRoomVisit('v1', { controlImpossible: false }, user);
  expect(prisma.roomVisit.update.mock.calls[1][0].data).toEqual({ controlImpossible: false, controlImpossibleReason: '' });
});
test('refuse un contrôle impossible sans raison lors de la modification et un passage absent', async () => {
  prisma.roomVisit.findUnique.mockResolvedValue({ controlImpossible: false, controlImpossibleReason: '' });
  await expect(service.updateRoomVisit('v1', { controlImpossible: true }, user)).rejects.toMatchObject({ status: 400 });
  await expect(service.updateRoomVisit('v1', { controlImpossibleReason: 'Occupée' }, user)).rejects.toMatchObject({ status: 400 });
  prisma.roomVisit.findUnique.mockResolvedValue(null);
  await expect(service.updateRoomVisit('missing', { controlImpossible: true, controlImpossibleReason: 'Occupée' }, user)).rejects.toMatchObject({ status: 404 });
});
test('API et MCP enregistrent le contrôle impossible et protègent la raison obligatoire', async () => {
  const payload = { roomId: 'r1', controlImpossible: true, controlImpossibleReason: 'Cours en cours' };
  prisma.roomVisit.create.mockImplementation(async args => ({ id: 'v1', ...args.data }));
  const response = await request(app).post('/api/room-visits').set('x-role', 'TECH').send(payload);
  expect(response.status).toBe(201); expect(response.body.controlImpossibleReason).toBe('Cours en cours');
  expect((await request(app).post('/api/room-visits').set('x-role', 'TECH').send({ ...payload, controlImpossibleReason: '' })).status).toBe(400);
  const server = buildMcpServer({ scopes: ['room_visits:write'], createdBy: user });
  const result = await server._registeredTools.create_room_visit.handler(payload);
  expect(JSON.parse(result.content[0].text)).toMatchObject({ controlImpossible: true, controlImpossibleReason: 'Cours en cours' });
  expect((await server._registeredTools.create_room_visit.handler({ roomId: 'r1', controlImpossible: true })).isError).toBe(true);
});
