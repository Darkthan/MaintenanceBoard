const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

let mockRole = 'ADMIN';

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: 'user-1',
      role: mockRole,
      name: mockRole === 'ADMIN' ? 'Admin Test' : 'Tech Test',
      email: 'user@test.local',
      isActive: true
    };
    next();
  }
}));

const knowledgeBaseRouter = require('../src/routes/knowledgeBase');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge-base', knowledgeBaseRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('knowledge base routes', () => {
  const tempDir = path.join(process.cwd(), 'tests', '.tmp');
  const knowledgeBaseFile = path.join(tempDir, 'knowledge-base.test.json');
  const knowledgeBaseUploadDir = path.join(tempDir, 'knowledge-base-uploads');
  const tinyPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B2u0AAAAASUVORK5CYII=',
    'base64'
  );

  beforeEach(() => {
    mockRole = 'ADMIN';
    process.env.KNOWLEDGE_BASE_FILE = knowledgeBaseFile;
    process.env.KNOWLEDGE_BASE_UPLOAD_DIR = knowledgeBaseUploadDir;
    fs.mkdirSync(tempDir, { recursive: true });
    fs.rmSync(knowledgeBaseFile, { force: true });
    fs.rmSync(knowledgeBaseUploadDir, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(knowledgeBaseFile, { force: true });
    fs.rmSync(knowledgeBaseUploadDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_BASE_FILE;
    delete process.env.KNOWLEDGE_BASE_UPLOAD_DIR;
  });

  it('cree un article puis le relit', async () => {
    const createRes = await request(buildApp())
      .post('/api/knowledge-base')
      .send({
        title: 'Procedure imprimante',
        category: 'Support',
        tags: 'imprimante, reseau',
        summary: 'Relancer une imprimante bloquee',
        content: '# Etapes\n\n1. Redemarrer\n2. Tester'
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.article).toEqual(expect.objectContaining({
      title: 'Procedure imprimante',
      category: 'Support',
      tags: ['imprimante', 'reseau']
    }));

    const listRes = await request(buildApp()).get('/api/knowledge-base');
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.categories).toEqual([{ value: 'Support', count: 1 }]);

    const readRes = await request(buildApp()).get(`/api/knowledge-base/${createRes.body.article.id}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.content).toContain('# Etapes');
  });

  it('filtre les articles par recherche et categorie', async () => {
    fs.writeFileSync(knowledgeBaseFile, JSON.stringify({
      articles: [
        {
          id: 'kb-1',
          slug: 'vpn',
          title: 'VPN enseignant',
          summary: 'Connexion distante',
          category: 'Reseau',
          tags: ['vpn'],
          content: 'Portail VPN',
          createdAt: '2026-03-31T08:00:00.000Z',
          updatedAt: '2026-03-31T08:00:00.000Z',
          createdByName: 'Admin',
          updatedByName: 'Admin'
        },
        {
          id: 'kb-2',
          slug: 'inventaire',
          title: 'Inventaire mobile',
          summary: 'Scanner les QR codes',
          category: 'Materiel',
          tags: ['qr'],
          content: 'Utiliser le scan mobile',
          createdAt: '2026-03-31T08:00:00.000Z',
          updatedAt: '2026-03-31T08:00:00.000Z',
          createdByName: 'Admin',
          updatedByName: 'Admin'
        }
      ]
    }, null, 2));

    const res = await request(buildApp()).get('/api/knowledge-base?q=vpn&category=Reseau');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('kb-1');
  });

  it('refuse la creation a un technicien', async () => {
    mockRole = 'TECH';

    const res = await request(buildApp())
      .post('/api/knowledge-base')
      .send({
        title: 'Article interdit',
        content: 'Contenu'
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Acces refuse');
  });

  it('met a jour puis supprime un article', async () => {
    fs.writeFileSync(knowledgeBaseFile, JSON.stringify({
      articles: [
        {
          id: 'kb-1',
          slug: 'vpn',
          title: 'VPN',
          summary: '',
          category: '',
          tags: [],
          content: 'Ancien contenu',
          createdAt: '2026-03-31T08:00:00.000Z',
          updatedAt: '2026-03-31T08:00:00.000Z',
          createdByName: 'Admin',
          updatedByName: 'Admin'
        }
      ]
    }, null, 2));

    const updateRes = await request(buildApp())
      .patch('/api/knowledge-base/kb-1')
      .send({
        title: 'VPN professeurs',
        summary: 'Nouvelle version',
        content: 'Contenu mis a jour'
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.article.title).toBe('VPN professeurs');

    const deleteRes = await request(buildApp()).delete('/api/knowledge-base/kb-1');
    expect(deleteRes.status).toBe(200);

    const listRes = await request(buildApp()).get('/api/knowledge-base');
    expect(listRes.body.items).toHaveLength(0);
  });

  it('ajoute une image compressee et un document a un article', async () => {
    const createRes = await request(buildApp())
      .post('/api/knowledge-base')
      .send({
        title: 'Procédure projecteur',
        content: ''
      });

    expect(createRes.status).toBe(201);
    const articleId = createRes.body.article.id;

    const imageRes = await request(buildApp())
      .post(`/api/knowledge-base/${articleId}/attachments`)
      .attach('file', tinyPngBuffer, 'photo.png');

    expect(imageRes.status).toBe(201);
    expect(imageRes.body.attachment).toEqual(expect.objectContaining({
      kind: 'image',
      mime: 'image/webp'
    }));

    const articleRes = await request(buildApp()).get(`/api/knowledge-base/${articleId}`);
    expect(articleRes.status).toBe(200);
    expect(articleRes.body.attachments).toHaveLength(1);
    expect(articleRes.body.attachments[0].url).toContain(`/api/knowledge-base/${articleId}/attachments/`);

    const docRes = await request(buildApp())
      .post(`/api/knowledge-base/${articleId}/attachments`)
      .attach('file', Buffer.from('guide'), 'guide.txt');

    expect(docRes.status).toBe(201);
    expect(docRes.body.attachment).toEqual(expect.objectContaining({
      kind: 'file',
      mime: 'text/plain'
    }));

    const attachmentFileRes = await request(buildApp()).get(docRes.body.attachment.url);
    expect(attachmentFileRes.status).toBe(200);
    expect(attachmentFileRes.headers['content-type']).toContain('text/plain');

    const deleteAttachmentRes = await request(buildApp())
      .delete(`/api/knowledge-base/${articleId}/attachments/${docRes.body.attachment.id}`);

    expect(deleteAttachmentRes.status).toBe(200);
    expect(deleteAttachmentRes.body.article.attachments).toHaveLength(1);

    const deleteArticleRes = await request(buildApp()).delete(`/api/knowledge-base/${articleId}`);
    expect(deleteArticleRes.status).toBe(200);
    expect(fs.existsSync(path.join(knowledgeBaseUploadDir, articleId))).toBe(false);
  });
});
