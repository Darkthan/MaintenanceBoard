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

describe('loan request public page', () => {
  it('sert la page publique avec les helpers de chargement du lien et le calendrier public', async () => {
    const res = await request(app).get('/loan-request.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Chargement du lien');
    expect(res.text).toContain('function getToken()');
    expect(res.text).toContain('function getAccessToken()');
    expect(res.text).toContain('function apiFetch(pathname)');
    expect(res.text).toContain('function renderResourceSummary()');
    expect(res.text).toContain("lrdpRenderCalendar();");
    expect(res.text).toContain("/loan-request/resources/${encodeURIComponent(resourceId)}/schedule?");
  });
});
