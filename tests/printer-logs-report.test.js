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
  printerJob: { groupBy: jest.fn(), findMany: jest.fn() }
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
    { ownerName: 'Alice', color: 'Black', printerId: 'printer-1', _count: { _all: 2 }, _sum: { printCount: 12 } },
    { ownerName: 'Alice', color: 'Full color', printerId: 'printer-1', _count: { _all: 1 }, _sum: { printCount: 3 } }
  ]);
});

test('regroupe les copies selon les dimensions choisies et conserve les totaux', async () => {
  const response = await request(app).get('/api/printer-logs/summary?jobKind=Copy&groupBy=ownerName,color,printerId');
  expect(response.status).toBe(200);
  expect(response.body.groupBy).toEqual(['ownerName', 'color', 'printerId']);
  expect(response.body.totals).toEqual({ jobs: 3, printCount: 15 });
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
  expect(response.text).toContain(';12\r\n');
});

test('exporte les lignes Copie filtrées et neutralise les formules CSV', async () => {
  prisma.printerJob.findMany.mockResolvedValueOnce([{
    id: 'row-1', jobId: '42', jobKind: 'Copy', jobName: '=HYPERLINK("x")',
    ownerName: '=1+1', startedAt: new Date('2026-09-01T08:30:00.000Z'),
    status: 'Done', color: 'Black', duplex: 'Simplex', paperSize: 'A4',
    originalPages: 1, printPages: 1, outputVolume: 2, printCount: 2,
    printer: { name: 'RISO A', serial: '123' }
  }]);
  const response = await request(app).get('/api/printer-logs/copies/export?printerId=printer-1');
  expect(response.status).toBe(200);
  expect(response.headers['content-disposition']).toContain('copies-riso.csv');
  expect(response.text).toContain("'=1+1");
  expect(response.text).toContain("'=HYPERLINK");
  expect(prisma.printerJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { printerId: 'printer-1', jobKind: 'Copy' }
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
