const request = require('supertest');

jest.mock('../src/lib/prisma', () => ({ user: { findUnique: jest.fn() } }));

jest.mock('@prisma/client', () => {
  const mockPrisma = { user: { findUnique: jest.fn() } };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'A', email: 'a@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

const app = require('../src/app');

describe('dashboard upcoming loans summary', () => {
  it('sert le tableau de bord avec le bloc des réservations à venir', async () => {
    const res = await request(app).get('/index.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Réservations à venir');
    expect(res.text).toContain('upcoming-loans-overview');
    expect(res.text).toContain('upcoming-loans-list');
    expect(res.text).toContain('/loans.html');
  });
});
