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

describe('interventions page', () => {
  it('sert la page avec planification et panneau iCal global', async () => {
    const res = await request(app).get('/interventions.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Interventions');
    expect(res.text).toContain('toggle-filters-btn');
    expect(res.text).toContain('int-scheduled-start');
    expect(res.text).toContain('int-scheduled-end');
    expect(res.text).toContain('int-due-at');
    expect(res.text).toContain('detail-scheduled');
    expect(res.text).toContain('detail-due');
    expect(res.text).toContain('add-checkup-btn');
    expect(res.text).toContain('checkup-form');
    expect(res.text).toContain('detail-checkup-section');
  });
});
