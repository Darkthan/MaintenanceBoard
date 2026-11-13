const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

let mockRole = 'ADMIN';
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1', role: mockRole, name: 'Admin' }; next(); }
}));
const router = require('../src/routes/userDocumentation');
function app() { const instance = express(); instance.use(express.json()); instance.use('/api/user-documentation', router); instance.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message })); return instance; }

describe('documentation utilisateurs', () => {
  const file = path.join(process.cwd(), 'tests', '.tmp', 'user-documentation.test.json');
  beforeEach(() => { mockRole = 'ADMIN'; process.env.USER_DOCUMENTATION_FILE = file; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.rmSync(file, { force: true }); });
  afterEach(() => { fs.rmSync(file, { force: true }); delete process.env.USER_DOCUMENTATION_FILE; });

  it('conserve les guides utilisateurs dans un espace distinct', async () => {
    const created = await request(app()).post('/api/user-documentation').send({ title: 'Aucun affichage sur le vidéoprojecteur', summary: 'Vérifier la duplication', tags: 'écran, projecteur', content: 'Appuyez sur Windows + P.', showInReports: true });
    expect(created.status).toBe(201);
    expect(created.body.article.showInReports).toBe(true);
    const list = await request(app()).get('/api/user-documentation?q=projecteur');
    expect(list.body.items).toEqual([expect.objectContaining({ title: 'Aucun affichage sur le vidéoprojecteur' })]);
  });

  it('réserve la création aux administrateurs', async () => {
    mockRole = 'TECH';
    expect((await request(app()).post('/api/user-documentation').send({ title: 'Article', content: 'Texte' })).status).toBe(403);
  });
});
