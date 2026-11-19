const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('./helpers/in-process-request');

jest.mock('../src/lib/prisma', () => {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'mb-projects-'));
  const dbPath = require('path').join(dir, 'projects.db');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }) });
  client.testDirectory = dir; client.testDatabasePath = dbPath;
  return client;
});
const prisma = require('../src/lib/prisma');
const app = express();
app.use(express.json());
app.use('/api/projects', require('../src/routes/projects'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
function call(method, suffix = '', body, role = 'TECH') {
  const req = request(app)[method](`/api/projects${suffix}`);
  if (role) req.set('Authorization', `Bearer ${jwt.sign({ userId: role }, process.env.JWT_SECRET)}`);
  return body === undefined ? req : req.send(body);
}
beforeAll(async () => {
  const sql = execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], { encoding: 'utf8', timeout: 60000 });
  const db = new (require('better-sqlite3'))(prisma.testDatabasePath);
  db.exec(sql);
  db.exec('ALTER TABLE projects DROP COLUMN isActive');
  db.prepare('INSERT INTO users (id,email,name,role,updatedAt) VALUES (?,?,?,?,?)').run('ADMIN', 'admin@test.local', 'Admin', 'ADMIN', Date.now());
  db.prepare('INSERT INTO projects (id,title,createdBy,updatedAt) VALUES (?,?,?,?)').run('legacy', 'Projet existant', 'ADMIN', Date.now());
  db.exec(fs.readFileSync(path.resolve('prisma/migrations/20261119_project_activity/migration.sql'), 'utf8'));
  db.close();
  for (const role of ['TECH', 'TECH2', 'PRINT_MANAGER', 'INACTIVE']) {
    await prisma.user.create({ data: { id: role, email: `${role}@test.local`, name: role,
      role: role === 'TECH2' ? 'TECH' : role, isActive: role !== 'INACTIVE' } });
  }
}, 65000);
afterAll(async () => {
  await prisma.$disconnect();
  const dir = path.resolve(prisma.testDirectory);
  if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('mb-projects-')) throw new Error('Unsafe cleanup');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration conserve les anciens projets actifs et statut modifiable sans masquage ni perte', async () => {
  expect((await call('get', '/legacy')).body.isActive).toBe(true);
  const created = await call('post', '', { title: 'Nouveau' });
  expect(created.status).toBe(201);
  expect(created.body.isActive).toBe(true);
  const id = created.body.id;
  await call('post', `/${id}/columns`, { title: 'À faire' });
  const inactive = await call('patch', `/${id}`, { isActive: false }, 'TECH2');
  expect(inactive.status).toBe(200);
  expect(inactive.body).toMatchObject({ title: 'Nouveau', isActive: false });
  expect(inactive.body.columns).toHaveLength(1);
  expect((await call('get')).body.find(p => p.id === id).isActive).toBe(false);
  expect((await call('get', `/${id}`)).body.isActive).toBe(false);
  await call('patch', `/${id}`, { title: 'Renommé' });
  expect((await call('get', `/${id}`)).body.isActive).toBe(false);
  expect((await call('patch', `/${id}`, { isActive: true })).body.isActive).toBe(true);
  expect((await call('post', '', { title: 'Inactif dès création', isActive: false })).body.isActive).toBe(false);
});

test.each([null, 'false', 0, 'INACTIVE', {}, []])('refuse un statut non booléen : %p', async isActive => {
  expect((await call('patch', '/legacy', { isActive })).status).toBe(400);
  expect((await call('post', '', { title: 'Invalid', isActive })).status).toBe(400);
  expect((await call('get', '/legacy')).body.isActive).toBe(true);
});

test('ordre persistant, ajout en fin et déplacement de cartes conservé', async () => {
  const { id } = (await call('post', '', { title: 'Kanban' })).body;
  const cols = [];
  for (const title of ['A', 'B', 'C']) cols.push((await call('post', `/${id}/columns`, { title })).body.id);
  const card = (await call('post', `/${id}/cards`, { title: 'Carte', columnId: cols[0] })).body;
  const order = [cols[2], cols[0], cols[1]];
  expect((await call('post', `/${id}/columns/reorder`, { columnIds: order }, 'TECH2')).status).toBe(200);
  const reloaded = (await call('get', `/${id}`)).body;
  expect(reloaded.columns.map(c => c.id)).toEqual(order);
  expect(reloaded.columns.map(c => c.position)).toEqual([0, 1, 2]);
  expect(reloaded.columns[1].cards[0].id).toBe(card.id);
  const added = (await call('post', `/${id}/columns`, { title: 'D' })).body;
  expect(added.position).toBe(3);
  expect((await call('post', `/${id}/cards/move`, { cardId: card.id, toColumnId: cols[1], cardIds: [card.id] })).status).toBe(200);
  expect((await call('get', `/${id}`)).body.columns.find(c => c.id === cols[1]).cards[0].id).toBe(card.id);
  const foreign = (await call('post', '/legacy/columns', { title: 'Autre projet' })).body.id;
  const full = [...order, added.id];
  for (const columnIds of [null, {}, [7], [...full, full[0]], full.slice(1), [...full, 'unknown'], [foreign, ...full.slice(1)]]) {
    expect((await call('post', `/${id}/columns/reorder`, { columnIds })).status).toBe(400);
    expect((await call('get', `/${id}`)).body.columns.map(c => c.id)).toEqual(full);
  }
  expect((await call('post', '/missing/columns/reorder', { columnIds: [] })).status).toBe(404);
  expect((await call('patch', '/missing', { isActive: false })).status).toBe(404);
});

test.each([null, 'INACTIVE', 'PRINT_MANAGER'])('refuse les mutations non autorisées : %s', async role => {
  const status = role === 'PRINT_MANAGER' ? 403 : 401;
  expect((await call('patch', '/legacy', { isActive: false }, role)).status).toBe(status);
  expect((await call('post', '/legacy/columns/reorder', { columnIds: [] }, role)).status).toBe(status);
});

test('annule toutes les positions si une écriture échoue au milieu de la transaction', async () => {
  const { id } = (await call('post', '', { title: 'Transaction' })).body;
  const ids = [];
  for (const title of ['A', 'B', 'C']) ids.push((await call('post', `/${id}/columns`, { title })).body.id);
  const db = new (require('better-sqlite3'))(prisma.testDatabasePath);
  // The generated project UUID is trusted test data. Fail after the first position write.
  db.exec(`CREATE TRIGGER fail_reorder BEFORE UPDATE OF position ON kanban_columns
    WHEN NEW.projectId = '${id}' AND NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`);
  try {
    expect((await call('post', `/${id}/columns/reorder`, { columnIds: [...ids].reverse() })).status).toBe(500);
    const columns = (await call('get', `/${id}`)).body.columns;
    expect(columns.map(c => c.id)).toEqual(ids);
    expect(columns.map(c => c.position)).toEqual([0, 1, 2]);
  } finally { db.exec('DROP TRIGGER fail_reorder'); db.close(); }
});

test('suppression du projet toujours réservée à un administrateur', async () => {
  const { id } = (await call('post', '', { title: 'Suppression' })).body;
  expect((await call('delete', `/${id}`)).status).toBe(403);
  expect((await call('delete', `/${id}`, undefined, 'ADMIN')).status).toBe(200);
});
