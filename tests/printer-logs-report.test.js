const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'tech', role: 'TECH' }; next(); }
}));
jest.mock('../src/middleware/roles', () => ({
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

test('regroupe les copies selon les dimensions choisies et conserve les totaux', async () => {
  const response = await request(app).get('/api/printer-logs/summary?jobKind=Copy&groupBy=ownerName,color,printerId');
  expect(response.status).toBe(200);
  expect(response.body.groupBy).toEqual(['ownerName', 'color', 'printerId']);
  expect(response.body.totals).toEqual({ jobs: 3, printCount: 15, simplexEquivalent: 18 });
  expect(response.body.rows[0].printerName).toBe('RISO A');
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({
    by: ['ownerName', 'color', 'printerId', 'duplex'], where: { jobKind: 'Copy' }
  }));
});

test('exporte le même regroupement en CSV', async () => {
  const response = await request(app).get('/api/printer-logs/summary/export?jobKind=Copy&groupBy=ownerName,color,printerId');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/csv');
  expect(response.text).toContain('"Utilisateur";');
  expect(response.text).toContain('RISO A (123)');
  expect(response.text).toContain('"Équivalents simplex"');
  expect(response.text).toContain(';12;12\r\n');
});

test('accepte plus de trois critères et exporte uniquement les colonnes sélectionnées', async () => {
  const response = await request(app).get('/api/printer-logs/summary/export?groupBy=ownerName,color,printerId,duplex&columns=simplexEquivalent');
  expect(response.status).toBe(200);
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({
    by: ['ownerName', 'color', 'printerId', 'duplex']
  }));
  expect(response.text).toContain('"Utilisateur";"Couleur";"Imprimante";"Recto verso";"Équivalents simplex"');
  expect(response.text).not.toContain('"Exemplaires imprimés"');
  expect(response.text).toContain('"Duplex";6\r\n');
});

test('refuse les colonnes de synthèse inconnues', async () => {
  const response = await request(app).get('/api/printer-logs/summary/export?columns=ownerName');
  expect(response.status).toBe(400);
});

test('compte Duplex deux fois et regroupe Grayscale avec Black', async () => {
  prisma.printerJob.groupBy.mockResolvedValueOnce([
    { ownerName: 'Alice', color: 'Black', duplex: 'Simplex', _count: { _all: 1 }, _sum: { printCount: 2 } },
    { ownerName: 'Alice', color: 'Grayscale', duplex: 'Duplex', _count: { _all: 1 }, _sum: { printCount: 3 } }
  ]);
  const response = await request(app).get('/api/printer-logs/summary?color=Black&groupBy=ownerName,color');
  expect(response.status).toBe(200);
  expect(response.body.rows).toEqual([{ ownerName: 'Alice', color: 'Black', jobs: 2, printCount: 5, simplexEquivalent: 8 }]);
  expect(response.body.totals).toEqual({ jobs: 2, printCount: 5, simplexEquivalent: 8 });
  expect(prisma.printerJob.groupBy).toHaveBeenCalledWith(expect.objectContaining({
    by: ['ownerName', 'color', 'duplex'], where: { color: { in: ['Black', 'Grayscale'] } }
  }));
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
  expect(response.text).toContain(';2;4\r\n');
  expect(prisma.printerJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { printerId: 'printer-1', jobKind: 'Copy' }
  }));
});

test('expose les compteurs calculés dans le journal sans modifier la source', async () => {
  prisma.printerJob.count.mockResolvedValueOnce(1);
  prisma.printerJob.findMany.mockResolvedValueOnce([{
    id: 'row-1', color: 'Grayscale', duplex: 'Duplex', printCount: 3,
    printer: { name: 'RISO A', serial: '123' }
  }]);
  const response = await request(app).get('/api/printer-logs/jobs?color=Black');
  expect(response.status).toBe(200);
  expect(response.body.rows[0]).toMatchObject({ color: 'Grayscale', countedColor: 'Black', printCount: 3, simplexEquivalent: 6 });
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
