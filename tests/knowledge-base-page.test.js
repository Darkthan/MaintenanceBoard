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
    expect(res.text).toContain('id="ip-panel"');
    expect(res.text).toContain("ipShowPanel()");
    expect(res.text).toContain("ipOpenNetworkForm()");
    expect(res.text).toContain("Nouveau plan d'adressage");
    expect(res.text).not.toContain('fab-new-ip-range');
    expect(res.text).toContain("await selectArticle('system-ip-addressing')");
    expect(res.text).toContain("actions.classList.remove('pointer-events-none', 'opacity-0', 'scale-95')");
    expect(res.text).toContain("style.transform = 'rotate(45deg)'");
    expect(res.text).toContain('id="kb-fab-wrap" class="hidden fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3"');
    expect(res.text).toContain('id="ip-fn-gateway"');
    expect(res.text).toContain("gateway: document.getElementById('ip-fn-gateway').value||null");
    expect(res.text).toContain('Les images sont compressées automatiquement');
  });

  it('redirige l ancienne page du plan d adressage vers la documentation', async () => {
    const res = await request(app).get('/ip-addressing.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain("window.location.replace('/knowledge-base.html?article=system-ip-addressing')");
  });
});
