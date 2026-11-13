const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');
const request = require('./helpers/in-process-request');
const jwt = require('jsonwebtoken');

// A private real SQLite database: no existing developer/test database is modified.
jest.mock('../src/lib/prisma', () => {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'mb-pc-review-'));
  const dbPath = require('path').join(dir, 'review.db');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }) });
  client.testDirectory = dir;
  client.testDatabasePath = dbPath;
  return client;
});
jest.mock('../src/utils/settings', () => ({ readSettings: () => ({ agentMonitoring: { lowDiskAlertsEnabled: false } }) }));
jest.mock('../src/utils/supervision', () => ({ evaluateHarvestAlerts: () => [], getSupervisionSettings: () => ({}), notifyNewAlertsOnce: async () => {} }));

const prisma = require('../src/lib/prisma');
const { updateAgentEquipment } = require('../src/services/hostnameReviewService');
const app = express();
app.use(express.json());
app.use('/api/pc-review', require('../src/routes/pcReview'));
app.use('/api/agents', require('../src/routes/agents'));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
const auth = role => `Bearer ${jwt.sign({ userId: role }, process.env.JWT_SECRET)}`;
const get = (query = '', role = 'ADMIN') => request(app).get(`/api/pc-review${query}`).set('Authorization', auth(role));
const patch = (body, role = 'ADMIN') => request(app).patch('/api/pc-review/pc').set('Authorization', auth(role)).send(body);
const checkin = (hostname, token = 'machine') => request(app).post('/api/agents/checkin').set('X-Agent-Token', token).send({ hostname, serialNumber: 'SERIAL-1' });
const current = () => prisma.equipment.findUnique({ where: { id: 'pc' } });
const DAY = 86400000;

beforeAll(async () => {
  const sql = execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: `file:${prisma.testDatabasePath}` }, timeout: 60000
  });
  const db = new (require('better-sqlite3'))(prisma.testDatabasePath);
  db.exec(sql);
  db.close();
  for (const role of ['ADMIN', 'TECH', 'PRINT_MANAGER', 'VIEWER']) {
    await prisma.user.create({ data: { id: role, name: role, role, email: `${role}@test.local` } });
  }
  await prisma.room.createMany({ data: [{ id: 'r1', name: 'Salle 101', number: '101' }, { id: 'r2', name: 'Salle 105', number: '105' }] });
  await prisma.agentToken.create({ data: { id: 'enroll', token: 'enrollment', label: 'Test', createdById: 'ADMIN' } });
}, 65000);

beforeEach(async () => {
  jest.restoreAllMocks();
  await prisma.equipment.deleteMany();
  await prisma.equipment.create({ data: { id: 'pc', name: 'Nom métier', type: 'PC', roomId: 'r1', serialNumber: 'SERIAL-1', agentHostname: 'PC-101', agentToken: 'machine' } });
});
afterAll(async () => {
  await prisma.$disconnect();
  fs.rmSync(prisma.testDirectory, { recursive: true, force: true });
});

test('premier contact, nouveau PC et absence temporaire de hostname sans fausse alerte', async () => {
  await prisma.equipment.update({ where: { id: 'pc' }, data: { agentHostname: null, agentToken: null } });
  expect((await checkin('PC-101', 'enrollment')).status).toBe(200);
  expect(await current()).toMatchObject({ hostnameChangeId: null, agentHostname: 'PC-101', name: 'Nom métier', roomId: 'r1' });
  expect((await checkin(undefined, 'enrollment')).status).toBe(200);
  expect((await current()).agentHostname).toBe('PC-101');
  const created = await request(app).post('/api/agents/checkin').set('X-Agent-Token', 'enrollment').send({ hostname: 'NEW', serialNumber: 'NEW' });
  expect(created.status).toBe(201);
  expect(await prisma.equipment.findUnique({ where: { serialNumber: 'NEW' } })).toMatchObject({ hostnameChangeId: null, status: 'ACTIVE' });
});

test('check-in, renommages successifs, casse et suggestion existante', async () => {
  expect((await checkin('pc-101')).status).toBe(200);
  expect((await current()).hostnameChangeId).toBeNull();
  expect((await checkin('PC-105')).status).toBe(200);
  const first = await current();
  expect(first).toMatchObject({ hostnameChangeOld: 'pc-101', hostnameChangeNew: 'PC-105', name: 'Nom métier', roomId: 'r1' });
  expect(first.hostnameChangedAt).toBeInstanceOf(Date);
  expect((await checkin('pc-105')).status).toBe(200);
  expect((await current()).hostnameChangeId).toBe(first.hostnameChangeId);
  const listing = await get();
  expect(listing.body.renamed[0].suggestion.roomId).toBe('r2');
  expect(JSON.stringify(listing.body)).not.toContain('agentToken');
  expect((await checkin('PC-106')).status).toBe(200);
  expect(await current()).toMatchObject({ hostnameChangeOld: 'pc-101', hostnameChangeNew: 'PC-106' });
  expect((await current()).hostnameChangeId).not.toBe(first.hostnameChangeId);
});

test('ré-enrôlement détecte le renommage sans modifier le nom métier ni la salle', async () => {
  expect((await checkin('PC-105', 'enrollment')).status).toBe(200);
  expect(await current()).toMatchObject({ hostnameChangeOld: 'PC-101', hostnameChangeNew: 'PC-105', name: 'Nom métier', roomId: 'r1' });
});

test.each(['validate', 'ignore'])('%s acquitte sans alertes répétées et conserve la salle par défaut', async action => {
  await checkin('PC-105');
  const e = await current();
  expect((await patch({ action, changeId: e.hostnameChangeId })).status).toBe(200);
  await checkin('PC-105');
  expect(await current()).toMatchObject({ hostnameChangeId: null, name: 'Nom métier', roomId: 'r1', status: 'ACTIVE' });
  expect((await get()).body.renamed).toEqual([]);
  expect((await patch({ action, changeId: e.hostnameChangeId })).status).toBe(409);
});

test('validation met à jour la fiche, choix de salle et maintien explicite sans salle', async () => {
  await checkin('PC-105');
  expect((await patch({ action: 'validate', changeId: (await current()).hostnameChangeId, name: ' PC-105 ', roomId: 'r2' })).status).toBe(200);
  expect(await current()).toMatchObject({ name: 'PC-105', roomId: 'r2', agentHostname: 'PC-105', status: 'ACTIVE' });
  await checkin('PC-106');
  expect((await patch({ action: 'validate', changeId: (await current()).hostnameChangeId, roomId: null })).status).toBe(200);
  expect((await current()).roomId).toBeNull();
});

test.each(['validate', 'ignore'])('%s refuse une version périmée après un nouveau check-in', async action => {
  await checkin('PC-105');
  const old = await current();
  await checkin('PC-106');
  expect((await patch({ action, changeId: old.hostnameChangeId, name: 'Périmé', roomId: 'r2' })).status).toBe(409);
  expect(await current()).toMatchObject({ name: 'Nom métier', roomId: 'r1', hostnameChangeNew: 'PC-106' });
});

test('un check-in concurrent entre la validation de salle et l’écriture provoque un conflit atomique', async () => {
  await checkin('PC-105');
  const e = await current();
  const original = prisma.room.findUnique.bind(prisma.room);
  jest.spyOn(prisma.room, 'findUnique').mockImplementation(async args => {
    await checkin('PC-106');
    return original(args);
  });
  expect((await patch({ action: 'validate', changeId: e.hostnameChangeId, name: 'Périmé', roomId: 'r2' })).status).toBe(409);
  expect(await current()).toMatchObject({ name: 'Nom métier', roomId: 'r1', hostnameChangeNew: 'PC-106' });
});

test('un check-in ayant lu une ancienne version ne rétablit pas une alerte déjà traitée', async () => {
  await checkin('PC-105');
  const stale = await current();
  await patch({ action: 'validate', changeId: stale.hostnameChangeId });
  await updateAgentEquipment(stale, 'pc-105', { lastSeenAt: new Date() });
  expect((await current()).hostnameChangeId).toBeNull();
  await updateAgentEquipment(stale, 'PC-107', { lastSeenAt: new Date() });
  expect(await current()).toMatchObject({ hostnameChangeOld: 'pc-105', hostnameChangeNew: 'PC-107' });
});

test('seuil strict de 60 jours, seuil personnalisé, jamais connectés et statut indépendant', async () => {
  const now = Date.now();
  await prisma.equipment.update({ where: { id: 'pc' }, data: { lastSeenAt: new Date(now - 61 * DAY), status: 'ACTIVE' } });
  await prisma.equipment.createMany({ data: [
    { id: 'recent', name: 'Recent', type: 'PC', status: 'INACTIVE', lastSeenAt: new Date(now - 59 * DAY) },
    { id: 'never', name: 'Jamais', type: 'PC' },
    { id: 'printer', name: 'Imprimante', type: 'Imprimante' },
    { id: 'boundary', name: 'Exactement au seuil', type: 'PC' }
  ] });
  const original = prisma.equipment.findMany.bind(prisma.equipment);
  jest.spyOn(prisma.equipment, 'findMany').mockImplementation(async args => {
    if (args.where.lastSeenAt?.lt) {
      await prisma.equipment.update({ where: { id: 'boundary' }, data: { lastSeenAt: args.where.lastSeenAt.lt } });
    }
    return original(args);
  });
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.body.days).toBe(60);
  expect(new Date(res.body.asOf) - new Date(res.body.cutoff)).toBe(60 * DAY);
  expect(res.body.inactive.map(e => e.id)).toEqual(['pc']);
  expect(res.body.inactive[0].inactivityDays).toBe(61);
  expect(res.body.neverConnected.map(e => e.id)).toEqual(['never']);
  expect((await get('?days=30')).body.inactive.map(e => e.id)).toEqual(['pc', 'recent']);
  expect((await get('?days=90')).body.inactive).toEqual([]);
  expect((await current()).status).toBe('ACTIVE');
});

test.each(['0', '-1', '1.5', 'abc', '', '36501', 'Infinity', '1e2', '60&days=90'])('refuse le seuil invalide %s', async value => {
  expect((await get(`?days=${value}`)).status).toBe(400);
});

test('permissions de consultation, modification du nom, affectation et rejet', async () => {
  expect((await request(app).get('/api/pc-review')).status).toBe(401);
  expect((await get('', 'PRINT_MANAGER')).status).toBe(403);
  expect((await get('', 'TECH')).status).toBe(200);
  await checkin('PC-105');
  const changeId = (await current()).hostnameChangeId;
  expect((await patch({ action: 'validate', changeId }, 'VIEWER')).status).toBe(403);
  expect((await patch({ action: 'ignore', changeId }, 'PRINT_MANAGER')).status).toBe(403);
  expect((await patch({ action: 'validate', changeId, name: 'Autre' }, 'TECH')).status).toBe(403);
  expect((await patch({ action: 'validate', changeId, roomId: 'r2' }, 'TECH')).status).toBe(200);
  expect(await current()).toMatchObject({ name: 'Nom métier', roomId: 'r2' });
  await checkin('PC-106');
  expect((await patch({ action: 'ignore', changeId: (await current()).hostnameChangeId }, 'TECH')).status).toBe(200);
});

test.each([{ name: '' }, { name: ' ' }, { name: 42 }, { name: 'x'.repeat(256) }, { roomId: 'missing' }, { roomId: 123 }])('refuse les données de traitement invalides %p', async values => {
  await checkin('PC-105');
  const e = await current();
  expect((await patch({ action: 'validate', changeId: e.hostnameChangeId, ...values })).status).toBe(400);
  expect((await current()).hostnameChangeId).toBe(e.hostnameChangeId);
});

test('migration additive préserve les données et initialise les alertes à null', () => {
  const db = new (require('better-sqlite3'))(':memory:');
  db.exec('CREATE TABLE equipment (id TEXT PRIMARY KEY, name TEXT, lastSeenAt DATETIME); INSERT INTO equipment VALUES (\'existing\', \'Nom métier\', NULL);');
  db.exec(fs.readFileSync(path.resolve('prisma/migrations/20261110_pc_review/migration.sql'), 'utf8'));
  expect(db.prepare('SELECT name, hostnameChangeId FROM equipment').get()).toEqual({ name: 'Nom métier', hostnameChangeId: null });
  db.close();
});

test('les types PC saisis librement et les machines agent sont inclus', async () => {
  await prisma.equipment.createMany({ data: [
    { id: 'portable', name: 'Portable', type: 'PC portable' },
    { id: 'computer', name: 'Ordinateur', type: 'Ordinateur portable' },
    { id: 'managed', name: 'Agent', type: 'Autre', discoverySource: 'AGENT' }
  ] });
  expect((await get()).body.neverConnected.map(e => e.id).sort()).toEqual(['computer', 'managed', 'pc', 'portable']);
});

test.each([123, {}, true])('refuse un hostname non textuel %p sans modification', async hostname => {
  expect((await checkin(hostname)).status).toBe(400);
  expect((await current()).agentHostname).toBe('PC-101');
});

test('la page est accessible dans les menus + en dehors des actions réservées aux administrateurs', () => {
  for (const page of ['equipment', 'rooms']) {
    const html = fs.readFileSync(path.resolve(`public/${page}.html`), 'utf8');
    const menu = html.slice(html.indexOf(`id="fab-${page === 'equipment' ? 'equip' : 'room'}-menu"`));
    expect(menu.indexOf('href="/pc-review.html"')).toBeGreaterThan(0);
    expect(menu.indexOf('href="/pc-review.html"')).toBeLessThan(menu.indexOf('id="admin-actions"'));
  }
});
