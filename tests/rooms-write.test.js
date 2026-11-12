const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    if (!req.headers['x-role']) return res.sendStatus(401);
    req.user = { id: 'u1', role: req.headers['x-role'], isActive: true };
    next();
  }
}));
jest.mock('../src/middleware/upload', () => ({ uploadImport: { single: () => (_req, _res, next) => next() } }));
jest.mock('../src/services/importService', () => ({}));
jest.mock('../src/services/qrService', () => ({}));
jest.mock('../src/utils/settings', () => ({}));
jest.mock('../src/lib/prisma', () => ({
  room: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn()
}));
const prisma = require('../src/lib/prisma');
const app = express();
app.use(express.json());
app.use('/api/rooms', require('../src/routes/rooms'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

describe('écritures HTTP salles via le service commun', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(fn => fn(prisma));
    prisma.room.findFirst.mockResolvedValue(null);
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', name: 'Info', building: 'A', floor: 1, number: '101' });
  });

  it('conserve la création HTTP et les étages numériques sous forme de texte', async () => {
    prisma.room.create.mockResolvedValue({ id: 'r1', name: 'Info', qrToken: 'secret' });
    const res = await request(app).post('/api/rooms').set('x-role', 'ADMIN').send({ name: ' Info ', floor: '2' });
    expect(res.status).toBe(201);
    expect(prisma.room.create).toHaveBeenCalledWith({ data: { name: 'Info', floor: 2 } });
    expect(res.body).not.toHaveProperty('qrToken');
  });

  it('conserve les champs omis lors des modifications partielles', async () => {
    prisma.room.update.mockResolvedValue({ id: 'r1', name: 'Info', floor: null });
    const res = await request(app).patch('/api/rooms/r1').set('x-role', 'ADMIN').send({ floor: null });
    expect(res.status).toBe(200);
    expect(prisma.room.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { floor: null } });
  });

  it('renvoie 400 pour les entrées invalides sans écrire', async () => {
    for (const body of [{ name: ' ' }, { name: 'Info', floor: 1.2 }, { name: 'Info', building: 'x'.repeat(101) }]) {
      expect((await request(app).post('/api/rooms').set('x-role', 'ADMIN').send(body)).status).toBe(400);
    }
    expect((await request(app).patch('/api/rooms/r1').set('x-role', 'ADMIN').send({})).status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse les écritures anonymes et TECH même avec des données valides', async () => {
    expect((await request(app).post('/api/rooms').send({ name: 'Info' })).status).toBe(401);
    expect((await request(app).post('/api/rooms').set('x-role', 'TECH').send({ name: 'Info' })).status).toBe(403);
    expect((await request(app).patch('/api/rooms/r1').set('x-role', 'TECH').send({ name: 'Info' })).status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('renvoie 409 pour les doublons et 404 pour les salles absentes', async () => {
    prisma.room.findFirst.mockResolvedValue({ id: 'other' });
    expect((await request(app).post('/api/rooms').set('x-role', 'ADMIN').send({ name: 'Info' })).status).toBe(409);
    expect((await request(app).patch('/api/rooms/r1').set('x-role', 'ADMIN').send({ name: 'Info' })).status).toBe(409);
    prisma.room.findUnique.mockResolvedValue(null);
    expect((await request(app).patch('/api/rooms/absent').set('x-role', 'ADMIN').send({ name: 'Info' })).status).toBe(404);
    expect(prisma.room.create).not.toHaveBeenCalled();
    expect(prisma.room.update).not.toHaveBeenCalled();
  });
});
