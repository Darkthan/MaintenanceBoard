const request = require('supertest');

jest.mock('../src/lib/prisma', () => ({ user: { findUnique: jest.fn() } }));

jest.mock('@prisma/client', () => {
  const mockPrisma = { user: { findUnique: jest.fn() } };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'a@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

const app = require('../src/app');

describe('knowledge base page', () => {
  it('sert la page de base de connaissance', async () => {
    const res = await request(app).get('/knowledge-base.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Base de connaissance');
    expect(res.text).toContain('knowledge-article-list');
    expect(res.text).toContain('knowledge-article-view');
    expect(res.text).toContain('knowledge-editor-modal');
    expect(res.text).toContain('Nouvel article');
    expect(res.text).toContain('editor-image-input');
    expect(res.text).toContain('editor-document-input');
    expect(res.text).toContain('article-documents');
    expect(res.text).toContain('Les images sont compressées automatiquement');
  });
});
