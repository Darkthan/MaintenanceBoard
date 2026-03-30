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

describe('loans page', () => {
  it('sert la page des prêts avec un bouton d’édition compact et des clés locales pour l’agenda', async () => {
    const res = await request(app).get('/loans.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Agenda des prêts');
    expect(res.text).toContain('function getLocalDayKey(value)');
    expect(res.text).toContain("const key = getLocalDayKey(date);");
    expect(res.text).toContain("const key = getLocalDayKey(item.startAt);");
    expect(res.text).toContain('aria-label="Modifier la demande"');
    expect(res.text).not.toContain('data-action="reservation-edit" data-id="${item.id}" class="px-3 py-2');
  });
});
