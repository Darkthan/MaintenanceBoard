const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireTechOrAdmin } = require('../middleware/roles');
const { parsePrinterLog } = require('../services/printerLogService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth, requireTechOrAdmin);

function dateBound(value, end = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Object.assign(new Error('Date de filtre invalide'), { status: 400 });
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw Object.assign(new Error('Date de filtre invalide'), { status: 400 });
  }
  if (end) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function filters(query) {
  const where = {};
  if (query.printerId) where.printerId = String(query.printerId);
  if (query.ownerName) where.ownerName = String(query.ownerName);
  if (query.jobKind) {
    if (!['Copy', 'Print', 'Scan'].includes(query.jobKind)) throw Object.assign(new Error('Type invalide'), { status: 400 });
    where.jobKind = query.jobKind;
  }
  if (query.status) where.status = String(query.status);
  if (query.color) where.color = String(query.color);
  if (query.duplex) where.duplex = String(query.duplex);
  const from = dateBound(query.from);
  const to = dateBound(query.to, true);
  if (from || to) where.startedAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  return where;
}

router.post('/import', requireAdmin, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !/\.csv$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: 'Déposez un fichier CSV RISO' });
    }
    const parsed = await parsePrinterLog(req.file.buffer);
    const printer = await prisma.printer.upsert({
      where: { serial: parsed.printer.serial },
      create: parsed.printer,
      update: { name: parsed.printer.name, model: parsed.printer.model }
    });
    const existing = await prisma.printerJob.findMany({
      where: { printerId: printer.id, jobId: { in: [...new Set(parsed.jobs.map(job => job.jobId))] } }
    });
    const identity = job => JSON.stringify([job.jobId, job.startedAt.toISOString()]);
    const previous = new Map(existing.map(job => [identity(job), job]));
    const fields = ['jobKind', 'jobName', 'ownerName', 'status', 'statusCode', 'color', 'duplex', 'paperSize', 'originalPages', 'printPages', 'outputVolume', 'printCount'];
    const newJobs = [];
    const changedJobs = [];
    let unchanged = 0;
    for (const job of parsed.jobs) {
      const old = previous.get(identity(job));
      if (!old) newJobs.push({ ...job, printerId: printer.id });
      else if (fields.some(field => old[field] !== job[field]) || old.endedAt?.getTime() !== job.endedAt?.getTime()) {
        changedJobs.push({ old, job });
      } else unchanged++;
    }
    for (let index = 0; index < newJobs.length; index += 100) {
      await prisma.printerJob.createMany({ data: newJobs.slice(index, index + 100) });
    }
    for (const { old, job } of changedJobs) {
      await prisma.printerJob.update({ where: { id: old.id }, data: job });
    }
    res.json({ printer: { id: printer.id, name: printer.name, serial: printer.serial }, processed: parsed.jobs.length, imported: newJobs.length, updated: changedJobs.length, unchanged });
  } catch (error) { next(error); }
});

router.get('/filters', async (_req, res, next) => {
  try {
    const [printers, owners, colors, duplexes] = await Promise.all([
      prisma.printer.findMany({ select: { id: true, name: true, serial: true }, orderBy: { name: 'asc' } }),
      prisma.printerJob.groupBy({ by: ['ownerName'], where: { ownerName: { not: null } }, orderBy: { ownerName: 'asc' } }),
      prisma.printerJob.groupBy({ by: ['color'], where: { color: { not: null } }, orderBy: { color: 'asc' } }),
      prisma.printerJob.groupBy({ by: ['duplex'], where: { duplex: { not: null } }, orderBy: { duplex: 'asc' } })
    ]);
    res.json({ printers, owners: owners.map(row => row.ownerName).filter(Boolean), colors: colors.map(row => row.color).filter(Boolean), duplexes: duplexes.map(row => row.duplex).filter(Boolean) });
  } catch (error) { next(error); }
});

router.get('/summary', async (req, res, next) => {
  try {
    const where = filters(req.query);
    const [groups, printers] = await Promise.all([
      prisma.printerJob.groupBy({
        by: ['printerId', 'ownerName', 'jobKind', 'color', 'duplex', 'paperSize', 'status'],
        where,
        _count: { _all: true },
        _sum: { printCount: true, outputVolume: true }
      }),
      prisma.printer.findMany({ select: { id: true, name: true, serial: true } })
    ]);
    const printerById = Object.fromEntries(printers.map(item => [item.id, item]));
    const rows = groups.map(group => ({
      printerId: group.printerId,
      printerName: printerById[group.printerId]?.name || 'Imprimante inconnue',
      printerSerial: printerById[group.printerId]?.serial || '',
      ownerName: group.ownerName || 'Utilisateur inconnu',
      jobKind: group.jobKind, color: group.color, duplex: group.duplex, paperSize: group.paperSize, status: group.status,
      jobs: group._count._all, printCount: group._sum.printCount || 0,
      outputVolume: group._sum.outputVolume || 0
    }));
    res.json({
      totals: rows.reduce((total, row) => ({ jobs: total.jobs + row.jobs, printCount: total.printCount + row.printCount }), { jobs: 0, printCount: 0 }),
      rows
    });
  } catch (error) { next(error); }
});

router.get('/jobs', async (req, res, next) => {
  try {
    const where = filters(req.query);
    const page = Math.min(100000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const pageSize = 50;
    const [total, rows] = await Promise.all([
      prisma.printerJob.count({ where }),
      prisma.printerJob.findMany({ where, include: { printer: { select: { name: true, serial: true } } }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })
    ]);
    res.json({ total, page, pageSize, rows });
  } catch (error) { next(error); }
});

module.exports = router;
