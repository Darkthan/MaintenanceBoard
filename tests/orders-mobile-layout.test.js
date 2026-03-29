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

describe('orders mobile layout', () => {
  it('sert la page commandes avec les garde-fous mobiles contre le débordement', async () => {
    const res = await request(app).get('/orders.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('data-mobile-pagination="true"');
    expect(res.text).toContain('#orders-container > div');
    expect(res.text).toContain('overflow-wrap: anywhere');
  });
});
