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

describe('mobile tab bar navigation', () => {
  it('sert le layout partagé avec la tab bar mobile et le panneau Plus', async () => {
    const res = await request(app).get('/js/layout.js');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('mobile-tabbar-shell');
    expect(res.text).toContain('mobile-tabbar-more-btn');
    expect(res.text).toContain('Plus d’actions');
    expect(res.text).toContain('button[onclick*="toggleSidebar"]');
    expect(res.text).toContain('--mobile-content-clearance');
    expect(res.text).toContain('--mobile-fab-clearance');
    expect(res.text).toContain('position: fixed');
    expect(res.text).toContain('overscroll-behavior-y: none');
    expect(res.text).toContain('100dvh');
    expect(res.text).toContain('touch-action: manipulation');
    expect(res.text).toContain('[data-mobile-fab="true"]');
    expect(res.text).toContain('const THRESHOLD = 140');
    expect(res.text).toContain('const MIN_PULL_DURATION_MS = 350');
    expect(res.text).toContain("label: 'Accueil'");
  });
});
