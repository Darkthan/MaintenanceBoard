const express = require('express');
const request = require('supertest');
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'admin', role: req.headers['x-role'] || 'ADMIN' }; next(); }
}));
jest.mock('../src/lib/prisma', () => ({
  user: { findUnique: jest.fn(), delete: jest.fn(), update: jest.fn() },
  $transaction: jest.fn()
}));
const prisma = require('../src/lib/prisma');
const app = express();
app.use('/api/users', require('../src/routes/users'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  prisma.user.findUnique.mockResolvedValue({ id: 'target', _count: { interventions: 0, sentInternalMessages: 0 } });
  prisma.user.delete.mockResolvedValue({ id: 'target' });
  prisma.user.update.mockResolvedValue({ id: 'target', isActive: false });
});

test('supprime définitivement un compte sans historique', async () => {
  const response = await request(app).delete('/api/users/target?permanent=true');
  expect(response.status).toBe(200);
  expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target' } });
  expect(prisma.user.update).not.toHaveBeenCalled();
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
});

test.each(['interventions', 'sentInternalMessages', 'orders', 'projects'])('préserve un historique lié : %s', async field => {
  prisma.user.findUnique.mockResolvedValue({ id: 'target', _count: { [field]: 1 } });
  const response = await request(app).delete('/api/users/target?permanent=true');
  expect(response.status).toBe(409);
  expect(prisma.user.delete).not.toHaveBeenCalled();
});

test('interdit la suppression de son propre compte', async () => {
  expect((await request(app).delete('/api/users/admin?permanent=true')).status).toBe(400);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

test.each(['TECH', 'PRINT_MANAGER'])('interdit la suppression au rôle %s', async role => {
  expect((await request(app).delete('/api/users/target?permanent=true').set('x-role', role)).status).toBe(403);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

test('retourne 404 pour un compte absent', async () => {
  prisma.user.findUnique.mockResolvedValue(null);
  expect((await request(app).delete('/api/users/missing?permanent=true')).status).toBe(404);
});

test('signale une relation bloquante sans erreur interne', async () => {
  prisma.user.delete.mockRejectedValue({ code: 'P2003' });
  expect((await request(app).delete('/api/users/target?permanent=true')).status).toBe(409);
});

test('conserve la désactivation pour les anciens clients', async () => {
  expect((await request(app).delete('/api/users/target')).status).toBe(200);
  expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { isActive: false } });
  expect(prisma.user.delete).not.toHaveBeenCalled();
});
