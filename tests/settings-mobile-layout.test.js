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

describe('settings mobile layout', () => {
  it('sert la page paramètres avec des sections mobiles qui se replient sans dépasser', async () => {
    const res = await request(app).get('/settings.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('#settings-content .inline-flex');
    expect(res.text).toContain('overflow-wrap: anywhere');
    expect(res.text).toContain('flex flex-col items-start gap-2 px-6 py-4 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between');
    expect(res.text).toContain('flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between');
  });
});
