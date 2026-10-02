const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'tech', role: 'TECH' }; next(); }
}));
jest.mock('../src/middleware/roles', () => ({
  requireRole: () => (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
  requireTechOrAdmin: (_req, _res, next) => next()
}));
jest.mock('../src/lib/prisma', () => ({
  printer: { findMany: jest.fn() },
  printerJob: { groupBy: jest.fn(), findMany: jest.fn(), count: jest.fn() }
}));

const prisma = require('../src/lib/prisma');
const router = require('../src/routes/printerLogs');
const app = express();
app.use('/api/printer-logs', router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));

beforeEach(() => {
  jest.clearAllMocks();
  prisma.printer.findMany.mockResolvedValue([{ id: 'printer-1', name: 'RISO A', serial: '123' }]);
  prisma.printerJob.groupBy.mockResolvedValue([
    { ownerName: 'Alice', color: 'Black', duplex: 'Simplex', printerId: 'printer-1', _count: { _all: 2 }, _sum: { printCount: 12 } },
    { ownerName: 'Alice', color: 'Full color', duplex: 'Duplex', printerId: 'printer-1', _count: { _all: 1 }, _sum: { printCount: 3 } }
  ]);
});

test('le graphique mensuel additionne les faces et remplit les mois sans activité', async () => {
  prisma.printerJob.groupBy.mockResolvedValue([
    { startedAt: new Date('2025-01-31T23:00:00Z'), color: 'Grayscale', _count: { _all: 1 }, _sum: { printCount: 12 } },
    { startedAt: new Date('2025-01-12T10:00:00Z'), color: 'Full color', _count: { _all: 2 }, _sum: { printCount: 8 } },
    { startedAt: new Date('2025-03-01T00:00:00Z'), color: 'Auto', _count: { _all: 1 }, _sum: { printCount: 3 } }
  ]);
  const response = await request(app).get('/api/printer-logs/timeline');
  expect(response.status).toBe(200);
  expect(response.body.rows.map(row => row.period)).toEqual(['2025-01', '2025-02', '2025-03']);
  expect(response.body.rows[1].printCount).toBe(0);
  expect(response.body.totals).toEqual({ jobs: 4, blackCount: 12, colorCount: 8, otherCount: 3, printCount: 23 });
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { jobKind: { in: ['Print', 'Copy'] } } }));
});

test('le graphique journalier inclut le jour final et transmet les sélections multiples', async () => {
  prisma.printerJob.groupBy.mockResolvedValue([
    { startedAt: new Date('2024-02-29T23:59:00Z'), color: 'Black', _count: { _all: 1 }, _sum: { printCount: 10 } }
  ]);
  const response = await request(app).get('/api/printer-logs/timeline?interval=day&from=2024-02-28&to=2024-03-01&printerId=p1&printerId=p2&ownerName=Alice&ownerName=Bob&jobKind=Copy');
  expect(response.status).toBe(200);
  expect(response.body.rows.map(row => row.period)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  expect(response.body.rows.map(row => row.printCount)).toEqual([0, 10, 0]);
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: {
    printerId: { in: ['p1', 'p2'] }, ownerName: { in: ['Alice', 'Bob'] }, jobKind: 'Copy',
    startedAt: { gte: new Date('2024-02-28T00:00:00Z'), lt: new Date('2024-03-02T00:00:00Z') }
  } }));
});

test('le graphique sans données renvoie une liste vide ou des zéros pour une plage explicite', async () => {
  prisma.printerJob.groupBy.mockResolvedValue([]);
  expect((await request(app).get('/api/printer-logs/timeline')).body.rows).toEqual([]);
  const response = await request(app).get('/api/printer-logs/timeline?from=2025-01-01&to=2025-02-01');
  expect(response.body.rows.map(row => row.printCount)).toEqual([0, 0]);
});

test.each(['interval=year', 'from=2025-03-01&to=2025-01-01', 'from=2025-02-30'])('refuse les paramètres temporels invalides : %s', async query => {
  expect((await request(app).get('/api/printer-logs/timeline?' + query)).status).toBe(400);
  expect(prisma.printerJob.groupBy).not.toHaveBeenCalled();
});

test('regroupe les copies selon les dimensions choisies et conserve les totaux', async () => {
  const response = await request(app).get('/api/printer-logs/summary?jobKind=Copy&groupBy=ownerName,color,printerId');
  expect(response.status).toBe(200);
  expect(response.body.groupBy).toEqual(['ownerName', 'color', 'printerId']);
  expect(response.body.totals).toEqual({ jobs: 3, blackCount: 12, colorCount: 3, otherCount: 0, printCount: 15 });
  expect(response.body.rows[0].printerName).toBe('RISO A');
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({
    by: ['ownerName', 'color', 'printerId'], where: { jobKind: 'Copy' }
  }));
});

test('exporte le même regroupement en CSV', async () => {
  const response = await request(app).get('/api/printer-logs/summary/export?jobKind=Copy&groupBy=ownerName,color,printerId');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/csv');
  expect(response.text).toContain('"Utilisateur";');
  expect(response.text).toContain('RISO A (123)');
  expect(response.text).toContain('"Noir et blanc";"Couleur";"Auto / autre";"Faces imprimées"');
  expect(response.text).toContain(';2;12;0;0;12\r\n');
});

test('accepte plus de trois critères et exporte uniquement les colonnes sélectionnées', async () => {
  const response = await request(app).get('/api/printer-logs/summary/export?groupBy=ownerName,color,printerId,duplex&columns=blackCount,colorCount');
  expect(response.status).toBe(200);
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({
    by: ['ownerName', 'color', 'printerId', 'duplex']
  }));
  expect(response.text).toContain('"Utilisateur";"Mode couleur";"Imprimante";"Recto verso";"Noir et blanc";"Couleur"');
  expect(response.text).not.toContain('"Faces imprimées"');
  expect(response.text).toContain('"Duplex";0;3\r\n');
});

test('refuse les colonnes de synthèse inconnues', async () => {
  const response = await request(app).get('/api/printer-logs/summary/export?columns=ownerName');
  expect(response.status).toBe(400);
});

test('compte chaque face Duplex une seule fois et regroupe Grayscale avec Black', async () => {
  prisma.printerJob.groupBy.mockResolvedValueOnce([
    { ownerName: 'Alice', color: 'Black', duplex: 'Simplex', _count: { _all: 1 }, _sum: { printCount: 2 } },
    { ownerName: 'Alice', color: 'Grayscale', duplex: 'Duplex', _count: { _all: 1 }, _sum: { printCount: 3 } }
  ]);
  const response = await request(app).get('/api/printer-logs/summary?color=Black&groupBy=ownerName,color');
  expect(response.status).toBe(200);
  expect(response.body.rows).toEqual([{ ownerName: 'Alice', color: 'Black', jobs: 2, blackCount: 5, colorCount: 0, otherCount: 0, printCount: 5 }]);
  expect(response.body.totals).toEqual({ jobs: 2, blackCount: 5, colorCount: 0, otherCount: 0, printCount: 5 });
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({
    by: ['ownerName', 'color'], where: { color: { in: ['Black', 'Grayscale'] } }
  }));
});

test('sépare les faces noir et blanc, couleur et Auto par utilisateur', async () => {
  prisma.printerJob.groupBy.mockResolvedValueOnce([
    { ownerName: 'Alice', color: 'Black', _count: { _all: 1 }, _sum: { printCount: 10 } },
    { ownerName: 'Alice', color: 'Full color', _count: { _all: 1 }, _sum: { printCount: 4 } },
    { ownerName: 'Alice', color: 'Auto', _count: { _all: 1 }, _sum: { printCount: 2 } }
  ]);
  const response = await request(app).get('/api/printer-logs/summary?groupBy=ownerName');
  expect(response.status).toBe(200);
  expect(response.body.rows).toEqual([{ ownerName: 'Alice', jobs: 3, blackCount: 10, colorCount: 4, otherCount: 2, printCount: 16 }]);
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['ownerName', 'color'] }));
});

test('propose une seule couleur Black pour Black et Grayscale', async () => {
  prisma.printerJob.groupBy
    .mockResolvedValueOnce([{ ownerName: 'Alice' }])
    .mockResolvedValueOnce([{ color: 'Black' }, { color: 'Grayscale' }, { color: 'Full color' }])
    .mockResolvedValueOnce([{ duplex: 'Simplex' }]);
  const response = await request(app).get('/api/printer-logs/filters');
  expect(response.status).toBe(200);
  expect(response.body.colors).toEqual(['Black', 'Full color']);
});

test('exporte les lignes Copie filtrées et neutralise les formules CSV', async () => {
  prisma.printerJob.findMany.mockResolvedValueOnce([{
    id: 'row-1', jobId: '42', jobKind: 'Copy', jobName: '=HYPERLINK("x")',
    ownerName: '=1+1', startedAt: new Date('2026-09-01T08:30:00.000Z'),
    status: 'Done', color: 'Grayscale', duplex: 'Duplex', paperSize: 'A4',
    originalPages: 1, printPages: 1, outputVolume: 2, printCount: 2,
    printer: { name: 'RISO A', serial: '123' }
  }]);
  const response = await request(app).get('/api/printer-logs/copies/export?printerId=printer-1');
  expect(response.status).toBe(200);
  expect(response.headers['content-disposition']).toContain('copies-riso.csv');
  expect(response.text).toContain("'=1+1");
  expect(response.text).toContain("'=HYPERLINK");
  expect(response.text).toContain('"Grayscale";"Black";"Duplex"');
  expect(response.text).toContain(';2\r\n');
  expect(prisma.printerJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { printerId: 'printer-1', jobKind: 'Copy' }
  }));
});

test('expose la couleur comptabilisée et le compteur source dans le journal', async () => {
  prisma.printerJob.count.mockResolvedValueOnce(1);
  prisma.printerJob.findMany.mockResolvedValueOnce([{
    id: 'row-1', color: 'Grayscale', duplex: 'Duplex', printCount: 3,
    printer: { name: 'RISO A', serial: '123' }
  }]);
  const response = await request(app).get('/api/printer-logs/jobs?color=Black');
  expect(response.status).toBe(200);
  expect(response.body.rows[0]).toMatchObject({ color: 'Grayscale', countedColor: 'Black', printCount: 3 });
  expect(prisma.printerJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { color: { in: ['Black', 'Grayscale'] } }
  }));
});

test('exporte toutes les copies au-delà du premier lot de 500', async () => {
  const job = index => ({
    id: `row-${index}`, jobId: String(index), ownerName: 'Alice', jobName: 'Copie',
    startedAt: new Date('2026-09-01T08:30:00.000Z'), status: 'Done',
    color: 'Black', duplex: 'Simplex', paperSize: 'A4', originalPages: 1,
    printPages: 1, outputVolume: 1, printCount: 1,
    printer: { name: 'RISO A', serial: '123' }
  });
  prisma.printerJob.findMany
    .mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => job(index)))
    .mockResolvedValueOnce([job(500)]);
  const response = await request(app).get('/api/printer-logs/copies/export');
  expect(response.status).toBe(200);
  expect(response.text.split('\r\n').filter(Boolean)).toHaveLength(502);
  expect(prisma.printerJob.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
    cursor: { id: 'row-499' }, skip: 1
  }));
});

test('refuse une dimension de regroupement inconnue', async () => {
  const response = await request(app).get('/api/printer-logs/summary?groupBy=passwordHash');
  expect(response.status).toBe(400);
});

test.each(['/summary?groupBy=ownerName', '/summary/export?groupBy=ownerName', '/copies/export', '/jobs'])('applique plusieurs imprimantes et utilisateurs à %s', async endpoint => {
  prisma.printerJob.findMany.mockResolvedValue([]);
  prisma.printerJob.count.mockResolvedValue(0);
  const params = new URLSearchParams();
  for (const value of ['printer-1', 'printer-2']) params.append('printerId', value);
  for (const value of ['Alice, service A', 'Bob']) params.append('ownerName', value);
  const response = await request(app).get('/api/printer-logs' + endpoint + (endpoint.includes('?') ? '&' : '?') + params);
  expect(response.status).toBe(200);
  const query = endpoint.startsWith('/summary') ? prisma.printerJob.groupBy : prisma.printerJob.findMany;
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    printerId: { in: ['printer-1', 'printer-2'] },
    ownerName: { in: ['Alice, service A', 'Bob'] }
  }) }));
});

test('ignore les sélections vides et déduplique les valeurs', async () => {
  const response = await request(app).get('/api/printer-logs/summary?groupBy=ownerName&printerId=p1&printerId=p1&ownerName=');
  expect(response.status).toBe(200);
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { printerId: 'p1' } }));
});
