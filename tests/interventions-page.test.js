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
    expect(res.text).toContain('Lien public');
    expect(res.text).toContain('id="public-request-link"');
    expect(res.text).toContain('id="public-general-request-link"');
    expect(res.text).toContain("new URL('/report.html', window.location.origin)");
    expect(res.text).toContain("api.get('/loans/general-request-link')");
    expect(res.text).toContain('copyPublicRequestLink()');
    expect(res.text).not.toContain('detail-intervention-link');
  });

  it('sert une interface dédiée à la gestion des tickets publics', async () => {
    const res = await request(app).get('/tickets.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Gestion des tickets');
    expect(res.text).toContain('/interventions/tickets/summary');
    expect(res.text).toContain('data-action="assignment"');
    expect(res.text).toContain('/messages-ticket.html?id=');
    expect(res.text).toContain('id="pagination"');
  });

  it('sert un menu avant les demandes d’intervention et les réservations', async () => {
    const res = await request(app).get('/requests.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Gestion des demandes');
    expect(res.text).toContain('Demandes d’intervention');
    expect(res.text).toContain('Réservations de matériel');
    expect(res.text).toContain('href="/tickets.html"');
    expect(res.text).toContain('href="/loans.html"');
    expect(res.text).toContain("renderNav('requests')");
  });

  it('sert le portail public qui propose intervention et réservation', async () => {
    const res = await request(app).get('/public-request.html?loan=token-general');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Signaler une intervention');
    expect(res.text).toContain('Réserver du matériel');
    expect(res.text).toContain('/report.html');
    expect(res.text).toContain('/loan-request.html?token=${encodeURIComponent(loanToken)}');
  });
});
