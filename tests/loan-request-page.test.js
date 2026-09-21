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
    expect(res.text).toContain('function getAccessToken(token = getToken())');
    expect(res.text).toContain('function apiFetch(pathname)');
    expect(res.text).toContain('function renderResourceSummary()');
    expect(res.text).toContain("lrdpRenderCalendar();");
    expect(res.text).toContain("lrdpEditStep('start-date')");
    expect(res.text).toContain('function lrdpEditStep(target)');
    expect(res.text).toContain("['pick-start-time', 'pick-start-min'].includes(lrdpStep)");
    expect(res.text).toContain("['pick-end-time', 'pick-end-min'].includes(lrdpStep)");
    expect(res.text).toContain('Date de début');
    expect(res.text).toContain('Heure de fin');
    expect(res.text).toContain("/loan-request/resources/${encodeURIComponent(resourceId)}/schedule?");
    expect(res.text).toContain("const ACCESS_STORAGE_PREFIX = 'loan-request-access-'");
    expect(res.text).toContain('sessionStorage.setItem(key, value)');
    expect(res.text).toContain('localStorage.setItem(key, value)');
    expect(res.text).toContain('waitForAuthBroadcast(currentToken, rememberMe)');
    expect(res.text).not.toContain("url.searchParams.set('access', accessToken);");
  });

  it("sert une page d'autorisation séparée qui déverrouille la demande initiale", async () => {
    const res = await request(app).get('/loan-auth.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Connexion autorisée');
    expect(res.text).toContain('function broadcastAuthorization(token, accessToken, rememberMe)');
    expect(res.text).toContain("history.replaceState(null, '', '/loan-auth.html')");
    expect(res.text).toContain('/loan-request.html?token=${encodeURIComponent(token)}');
    expect(res.text).not.toContain('id="request-form"');
  });
});
