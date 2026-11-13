const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('./helpers/in-process-request');

jest.mock('../src/lib/prisma', () => {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'mb-meetings-'));
  const dbPath = require('path').join(dir, 'meetings.db');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }) });
  client.testDirectory = dir; client.testDatabasePath = dbPath;
  return client;
});
jest.mock('../src/utils/settings', () => ({ readSettings: () => ({ poTemplate: { poPrefix: 'CMD-', tvaRate: 20, currency: 'EUR' } }) }));
const prisma = require('../src/lib/prisma');
const app = express();
app.use(express.json());
app.use('/api/meetings', require('../src/routes/meetings'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
const ids = { order: randomUUID(), intervention: randomUUID(), checkup: randomUUID(), equipment: randomUUID(), room: randomUUID(), project: randomUUID() };
const topic = (title = 'Sujet') => ({ id: randomUUID(), title, notes: '', checked: false, links: [] });
const draft = () => ({ title: 'Réunion technique', scheduledAt: '2026-11-13T14:00:00+01:00', status: 'PLANNED', topics: [topic()] });
function call(method, suffix = '', body, role = 'ADMIN') {
  const req = request(app)[method](`/api/meetings${suffix}`);
  if (role) req.set('Authorization', `Bearer ${jwt.sign({ userId: role }, process.env.JWT_SECRET)}`);
  return body === undefined ? req : req.send(body);
}
const preview = (type, id, role = 'ADMIN') => call('post', '/link-preview', { url: `/${type}.html?focus=${id}` }, role);

beforeAll(async () => {
  const sql = execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], { encoding: 'utf8', timeout: 60000 });
  const db = new (require('better-sqlite3'))(prisma.testDatabasePath);
  db.exec(sql);
  // Apply the actual incremental migration to an existing database.
  db.exec('DROP TABLE meetings');
  db.exec(fs.readFileSync(path.resolve('prisma/migrations/20261113_meetings/migration.sql'), 'utf8'));
  db.close();
  for (const role of ['ADMIN', 'TECH', 'TECH2', 'PRINT_MANAGER', 'VIEWER', 'INACTIVE']) {
    await prisma.user.create({ data: { id: role, email: `${role}@test.local`, name: role,
      role: role === 'TECH2' ? 'TECH' : role, isActive: role !== 'INACTIVE' } });
  }
  await prisma.order.create({ data: { id: ids.order, title: '<img src=x onerror=alert(1)>', requestedBy: 'ADMIN', status: 'ORDERED',
    description: 'PRIVATE_DESCRIPTION', trackingNotes: 'PRIVATE_TRACKING', totalAmount: 999,
    items: { create: [{ name: 'Test', quantity: 2, unitPrice: 100, priceType: 'HT' }, { name: 'Test TTC', quantity: 1, unitPrice: 30 }] } } });
  await prisma.intervention.create({ data: { id: ids.intervention, title: 'SECRET_INTERVENTION', techId: 'TECH2' } });
  await prisma.intervention.create({ data: { id: ids.checkup, title: 'Vérification partagée', kind: 'CHECKUP', techId: 'TECH2' } });
  await prisma.room.create({ data: { id: ids.room, name: 'Salle' } });
  await prisma.equipment.create({ data: { id: ids.equipment, name: 'PC', type: 'PC', agentToken: 'PRIVATE_MACHINE_TOKEN' } });
  await prisma.project.create({ data: { id: ids.project, title: 'Projet', createdBy: 'ADMIN' } });
}, 65000);
beforeEach(async () => { await prisma.meeting.deleteMany(); });
afterAll(async () => {
  await prisma.$disconnect();
  const resolved = path.resolve(prisma.testDirectory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('mb-meetings-')) throw new Error('Unsafe cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});

test('création, historique et persistance des cases, notes, sujets ajoutés et ordre', async () => {
  const body = draft();
  const created = await call('post', '', body, 'TECH');
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ version: 1, createdBy: 'TECH', title: body.title });
  const id = created.body.id;
  body.topics[0].checked = true; body.topics[0].notes = 'Décision\nDeuxième ligne';
  body.topics.unshift(topic('Ajout pendant la réunion')); body.status = 'IN_PROGRESS';
  expect((await call('patch', `/${id}`, { ...body, version: 1 }, 'TECH2')).status).toBe(200);
  const reloaded = await call('get', `/${id}`, undefined, 'TECH');
  expect(reloaded.body.topics.map(t => t.title)).toEqual(['Ajout pendant la réunion', 'Sujet']);
  expect(reloaded.body.topics[1]).toMatchObject({ checked: true, notes: 'Décision\nDeuxième ligne' });
  expect(reloaded.body.version).toBe(2);
  expect(reloaded.headers['cache-control']).toBe('no-store');
  expect((await call('get', '?status=IN_PROGRESS')).body.data).toHaveLength(1);
  expect((await call('get', '?status=COMPLETED')).body.data).toHaveLength(0);
  expect((await call('patch', `/${id}`, { ...body, status: 'COMPLETED', version: 2 })).status).toBe(200);
  expect((await call('get', '?status=COMPLETED')).body.data).toHaveLength(1);
});

test('une sauvegarde périmée ne peut pas écraser les notes d’un collègue', async () => {
  const body = draft(); const { id } = (await call('post', '', body)).body;
  const first = { ...body, title: 'Premier auteur', version: 1 };
  const results = await Promise.all([call('patch', `/${id}`, first), call('patch', `/${id}`, { ...first, title: 'Autre auteur' })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await call('get', `/${id}`)).body.version).toBe(2);
});

test.each([null, 'INACTIVE', 'PRINT_MANAGER', 'VIEWER'])('refuse les accès non autorisés : %s', async role => {
  for (const [method, suffix, body] of [['get', ''], ['post', '', draft()], ['get', `/${randomUUID()}`],
    ['patch', `/${randomUUID()}`, { ...draft(), version: 1 }], ['post', '/link-preview', { url: `/orders.html?id=${ids.order}` }], ['get', '/link-search?type=orders'], ['get', `/${randomUUID()}/updates?version=1`]]) {
    expect((await call(method, suffix, body, role)).status).toBe([null, 'INACTIVE'].includes(role) ? 401 : 403);
  }
});

test('aperçu commande limité aux champs autorisés, montant TTC et référence conformes', async () => {
  const result = await preview('orders', ids.order, 'TECH');
  expect(result.status).toBe(200);
  expect(result.body.preview).toMatchObject({ title: '<img src=x onerror=alert(1)>', totalAmount: 270, status: 'ORDERED', currency: 'EUR' });
  expect(result.body.preview.reference).toMatch(/^CMD-\d{4}-[A-Z0-9]{6}$/);
  expect(result.text).not.toMatch(/PRIVATE_|requestedBy|items|requester/);
});

test.each(['equipment', 'rooms', 'projects'])('aperçu %s et URL de fiche', async type => {
  const result = await preview(type, ids[{ equipment: 'equipment', rooms: 'room', projects: 'project' }[type]], 'TECH');
  expect(result.status).toBe(200);
  expect(result.body.preview.url).toContain(`${type}.html?`);
  expect(result.text).not.toContain('PRIVATE_MACHINE_TOKEN');
});

test('contrôle d’accès aux interventions à l’insertion et à chaque lecture, sans snapshot', async () => {
  expect((await preview('interventions', ids.intervention, 'TECH')).status).toBe(404);
  expect((await preview('interventions', ids.checkup, 'TECH')).status).toBe(200);
  const body = draft(); body.topics[0].links = [{ type: 'interventions', id: ids.intervention }];
  expect((await call('post', '', body, 'TECH')).status).toBe(404);
  const { id } = (await call('post', '', body)).body;
  const tech = await call('get', `/${id}`, undefined, 'TECH');
  expect(tech.body.topics[0].links[0].preview).toBeNull();
  expect(tech.text).not.toContain('SECRET_INTERVENTION');
  expect((await prisma.meeting.findUnique({ where: { id } })).topics).not.toContain('SECRET_INTERVENTION');
  // An inaccessible saved reference does not prevent editing unrelated notes.
  expect((await call('patch', `/${id}`, { ...body, version: 1 }, 'TECH')).status).toBe(200);
  expect((await call('get', `/${id}`, undefined, 'TECH2')).body.topics[0].links[0].preview.title).toBe('SECRET_INTERVENTION');
  await prisma.intervention.update({ where: { id: ids.intervention }, data: { techId: 'ADMIN' } });
  expect((await call('get', `/${id}`, undefined, 'TECH2')).body.topics[0].links[0].preview).toBeNull();
});

test('objet supprimé indisponible sans casser la réunion', async () => {
  const order = await prisma.order.create({ data: { title: 'Éphémère', requestedBy: 'ADMIN' } });
  const body = draft(); body.topics[0].links = [{ type: 'orders', id: order.id }];
  const { id } = (await call('post', '', body)).body;
  await prisma.order.delete({ where: { id: order.id } });
  expect((await call('get', `/${id}`)).body.topics[0].links[0].preview).toBeNull();
});

test.each(['https://evil.example/orders.html?id=', '//evil.example/orders.html?id=', 'file:///orders.html?id=',
  'http://127.0.0.1/orders.html?id=', 'javascript:alert(1)', '/api/orders/', '/orders.html?search=', '/orders.html?id=not-a-uuid'])('rejette les URL non admises %s', async prefix => {
  expect((await call('post', '/link-preview', { url: prefix + ids.order })).status).toBe(400);
});

test('liens absolus du domaine configuré acceptés ; objets absents et interdits indistinguables', async () => {
  const { appUrl } = require('../src/config');
  expect((await call('post', '/link-preview', { url: `${appUrl}/orders.html?id=${ids.order}` })).status).toBe(200);
  const missing = await preview('interventions', randomUUID(), 'TECH');
  const denied = await preview('interventions', ids.intervention, 'TECH');
  expect(missing.status).toBe(denied.status); expect(missing.body).toEqual(denied.body);
});

test('valide limites, version, types et refuse les métadonnées injectées', async () => {
  const body = draft();
  for (const invalid of [{ ...body, title: ' ' }, { ...body, scheduledAt: 'demain' }, { ...body, status: 'BAD' },
    { ...body, topics: [body.topics[0], body.topics[0]] }, { ...body, topics: [{ ...topic(), checked: 'true' }] },
    { ...body, topics: [{ ...topic(), notes: 'a'.repeat(20001) }] },
    { ...body, topics: [{ ...topic(), links: [{ type: 'orders', id: ids.order, preview: { title: 'spoof' } }] }] },
    { ...body, createdBy: 'TECH2' }]) expect((await call('post', '', invalid)).status).toBe(400);
  const { id } = (await call('post', '', body)).body;
  expect((await call('patch', `/${id}`, body)).status).toBe(400);
  expect((await call('get', `/${randomUUID()}`)).status).toBe(404);
  expect((await call('patch', `/${randomUUID()}`, { ...body, version: 1 })).status).toBe(404);
});

test('historique paginé sans contenu des notes ni aperçus', async () => {
  await prisma.meeting.createMany({ data: Array.from({ length: 31 }, (_, n) => ({ title: `Réunion ${n}`, createdBy: 'ADMIN', topics: JSON.stringify([{ ...topic(), notes: 'PRIVATE_NOTES' }]) })) });
  const first = await call('get'); const second = await call('get', '?page=2');
  expect(first.body.data).toHaveLength(30); expect(second.body.data).toHaveLength(1);
  expect(first.body.pagination.total).toBe(31); expect(first.text).not.toContain('PRIVATE_NOTES');
});

test('le service worker ne met jamais en cache les réunions et ne réutilise aucun aperçu hors ligne', async () => {
  const vm = require('vm');
  const handlers = {};
  const fetch = jest.fn(async () => ({ ok: true }));
  const caches = { open: jest.fn(), match: jest.fn() };
  vm.runInNewContext(fs.readFileSync(path.resolve('public/sw.js'), 'utf8'), {
    self: { addEventListener: (name, handler) => { handlers[name] = handler; }, location: { origin: 'https://maintenance.test' } },
    URL, fetch, caches
  });
  let response;
  handlers.fetch({ request: { url: 'https://maintenance.test/api/meetings/test', method: 'GET' }, respondWith: value => { response = value; } });
  await response;
  expect(fetch).toHaveBeenCalledWith(expect.anything(), { cache: 'no-store' });
  expect(caches.open).not.toHaveBeenCalled(); expect(caches.match).not.toHaveBeenCalled();
  fetch.mockRejectedValueOnce(new Error('offline'));
  handlers.fetch({ request: { url: 'https://maintenance.test/api/meetings', method: 'GET' }, respondWith: value => { response = value; } });
  await expect(response).rejects.toThrow('offline');
  expect(caches.match).not.toHaveBeenCalled();
});

test('mentions : liste paginée, recherche et aperçus limités aux champs autorisés', async () => {
  const marker = `mention-${randomUUID()}`;
  await prisma.order.createMany({ data: Array.from({ length: 12 }, (_, n) => ({ title: `${marker} ${n}`, requestedBy: 'ADMIN', supplier: 'Fournisseur recherche', trackingNotes: 'PRIVATE_SEARCH' })) });
  const path = `/link-search?type=orders&q=${marker}`;
  const first = await call('get', path, undefined, 'TECH');
  const second = await call('get', `${path}&page=2`, undefined, 'TECH');
  expect(first.status).toBe(200); expect(first.headers['cache-control']).toBe('no-store');
  expect(first.body.data).toHaveLength(10); expect(first.body.hasMore).toBe(true);
  expect(second.body.data).toHaveLength(2); expect(second.body.hasMore).toBe(false);
  expect(new Set([...first.body.data, ...second.body.data].map(l => l.id)).size).toBe(12);
  expect(first.text).not.toMatch(/PRIVATE_SEARCH|requestedBy|trackingNotes/);
  const reference = (await preview('orders', ids.order)).body.preview.reference;
  const byReference = await call('get', `/link-search?type=orders&q=${reference}`);
  expect(byReference.body.data.map(l => l.id)).toContain(ids.order);
  expect((await call('get', '/link-search?type=orders&q=Fournisseur%20recherche')).body.data.length).toBe(10);
});

test('mentions : les interventions privées sont filtrées avant pagination et après réaffectation', async () => {
  const marker = `mention-${randomUUID()}`;
  const intervention = await prisma.intervention.create({ data: { title: marker, techId: 'TECH2' } });
  const url = `/link-search?type=interventions&q=${marker}`;
  const denied = await call('get', url, undefined, 'TECH');
  expect(denied.body).toEqual({ data: [], hasMore: false });
  expect((await call('get', url, undefined, 'TECH2')).body.data[0].id).toBe(intervention.id);
  await prisma.intervention.update({ where: { id: intervention.id }, data: { techId: 'TECH' } });
  expect((await call('get', url, undefined, 'TECH2')).body).toEqual({ data: [], hasMore: false });
  expect((await call('get', url, undefined, 'TECH')).body.data[0].id).toBe(intervention.id);
  expect((await call('get', '/link-search?type=interventions&q=Vérification', undefined, 'TECH')).body.data.map(l => l.id)).toContain(ids.checkup);
});

test.each([['equipment', 'PC'], ['rooms', 'Salle'], ['projects', 'Projet']])('mentions : recherche %s', async (type, q) => {
  const response = await call('get', `/link-search?type=${type}&q=${q}`, undefined, 'TECH');
  expect(response.status).toBe(200); expect(response.body.data.length).toBeGreaterThan(0);
  expect(response.text).not.toContain('PRIVATE_MACHINE_TOKEN');
});

test.each(['', '?type=users', '?type=orders&page=0', '?type=orders&page=1.5', '?type=orders&page=10001',
  '?type=orders&q=' + 'x'.repeat(101), '?type=orders&q[x]=test', '?type=orders&url=https://example.com'])('mentions : valide la recherche %s', async query => {
  expect((await call('get', `/link-search${query}`)).status).toBe(400);
});

test('synchronisation : reçoit la version suivante après une modification sur un autre écran', async () => {
  const body = draft(); const created = (await call('post', '', body)).body;
  const pending = Promise.resolve(call('get', `/${created.id}/updates?version=1`, undefined, 'TECH'));
  await new Promise(resolve => setTimeout(resolve, 50));
  await call('patch', `/${created.id}`, { ...body, title: 'Changement en direct', version: 1 });
  const response = await pending;
  expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toMatchObject({ title: 'Changement en direct', version: 2 });
});
test('synchronisation : contrôle les aperçus avec les droits du lecteur', async () => {
  await prisma.intervention.update({ where: { id: ids.intervention }, data: { techId: 'ADMIN' } });
  const body = draft(); body.topics[0].links = [{ type: 'interventions', id: ids.intervention }];
  const created = (await call('post', '', body)).body;
  await call('patch', `/${created.id}`, { ...body, version: 1 });
  const response = await call('get', `/${created.id}/updates?version=1`, undefined, 'TECH2');
  expect(response.status).toBe(200); expect(response.body.topics[0].links[0].preview).toBeNull();
  expect(response.text).not.toContain('SECRET_INTERVENTION');
});
test('synchronisation : arrête une requête interrompue et révoque un compte désactivé en attente', async () => {
  const body = draft(); const { id } = (await call('post', '', body)).body;
  const controller = new AbortController();
  const watch = require('../src/services/meetingUpdates').waitForMeetingChange(id, 1, controller.signal);
  controller.abort(); expect(await watch).toEqual({ cancelled: true });
  const pending = Promise.resolve(call('get', `/${id}/updates?version=1`, undefined, 'TECH2'));
  await new Promise(resolve => setTimeout(resolve, 50));
  await prisma.user.update({ where: { id: 'TECH2' }, data: { isActive: false } });
  await call('patch', `/${id}`, { ...body, version: 1 });
  expect((await pending).status).toBe(401);
  await prisma.user.update({ where: { id: 'TECH2' }, data: { isActive: true } });
});
test.each(['', '?version=0', '?version=abc', '?version=1.5', '?version=1&extra=true'])('synchronisation : refuse une version invalide %s', async query => {
  expect((await call('get', `/${randomUUID()}/updates${query}`)).status).toBe(400);
});
test('synchronisation : réunion absente', async () => {
  expect((await call('get', `/${randomUUID()}/updates?version=1`)).status).toBe(404);
});

test('sauvegarde automatique : rejouer une création ne duplique pas une réunion et ne réécrit pas sa version courante', async () => {
  const body = { ...draft(), creationId: randomUUID() };
  const responses = await Promise.all([call('post', '', body, 'TECH'), call('post', '', body, 'TECH')]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
  expect(await prisma.meeting.count()).toBe(1);
  const { creationId, ...updated } = body;
  await call('patch', `/${creationId}`, { ...updated, title: 'Titre plus récent', version: 1 }, 'TECH');
  const retry = await call('post', '', body, 'TECH');
  expect(retry.body).toMatchObject({ id: creationId, title: 'Titre plus récent', version: 2 });
  expect((await call('post', '', body, 'TECH2')).status).toBe(404);
});

test('synchronisation : termine l’attente sans changement après 20 secondes', async () => {
  const read = jest.spyOn(prisma.meeting, 'findUnique').mockResolvedValue({ version: 1 });
  jest.useFakeTimers();
  try {
    const pending = require('../src/services/meetingUpdates').waitForMeetingChange(randomUUID(), 1, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(20000);
    expect(await pending).toEqual({ changed: false });
  } finally { jest.useRealTimers(); read.mockRestore(); }
});
