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

describe('messages pages', () => {
  it('sert la boîte de réception avec liste des conversations et bouton plus', async () => {
    const res = await request(app).get('/messages.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Boîte de réception');
    expect(res.text).toContain('new-conversation-btn');
    expect(res.text).toContain('Choisir un contact');
    expect(res.text).toContain('fixed bottom-6 right-6');
    expect(res.text).not.toContain('Aucune conversation sélectionnée');
  });

  it('sert la page dédiée à une conversation', async () => {
    const res = await request(app).get('/messages-thread.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Retour aux conversations');
    expect(res.text).toContain('Chargement de la conversation');
    expect(res.text).toContain('message-form');
    expect(res.text).toContain('thread-shell');
    expect(res.text).toContain('sticky bottom-0 z-10');
  });
});
