const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireTechOrAdmin } = require('../middleware/roles');
const { parsePrinterLog } = require('../services/printerLogService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const GROUP_FIELDS = {
  ownerName: 'Utilisateur',
  jobKind: 'Type',
  printerId: 'Imprimante',
  color: 'Couleur',
  duplex: 'Recto verso',
  paperSize: 'Papier',
  status: 'Statut'
};
const SUMMARY_COLUMNS = {
  jobs: 'Opérations',
  printCount: 'Exemplaires imprimés',
  simplexEquivalent: 'Équivalents simplex'
};

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
  if (query.color) where.color = query.color === 'Black' ? { in: ['Black', 'Grayscale'] } : String(query.color);
  if (query.duplex) where.duplex = String(query.duplex);
  const from = dateBound(query.from);
  const to = dateBound(query.to, true);
  if (from || to) where.startedAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  return where;
}

function groupFields(value) {
  const fields = String(value || 'ownerName,jobKind,printerId').split(',').map(field => field.trim());
  if (fields.length < 1 || fields.length > Object.keys(GROUP_FIELDS).length || new Set(fields).size !== fields.length ||
      fields.some(field => !Object.hasOwn(GROUP_FIELDS, field))) {
    throw Object.assign(new Error('Regroupement invalide'), { status: 400 });
  }
  return fields;
}

function summaryColumns(value) {
  if (value === undefined) return Object.keys(SUMMARY_COLUMNS);
  const columns = String(value).split(',').map(column => column.trim());
  if (!columns.length || new Set(columns).size !== columns.length ||
      columns.some(column => !Object.hasOwn(SUMMARY_COLUMNS, column))) {
    throw Object.assign(new Error('Colonnes de synthèse invalides'), { status: 400 });
  }
  return columns;
}

async function summary(where, by) {
  const [groups, printers] = await Promise.all([
    prisma.printerJob.groupBy({
      by: [...new Set([...by, 'duplex'])], where,
      _count: { _all: true },
      _sum: { printCount: true }
    }),
    by.includes('printerId')
      ? prisma.printer.findMany({ select: { id: true, name: true, serial: true } })
      : Promise.resolve([])
  ]);
  const printerById = Object.fromEntries(printers.map(item => [item.id, item]));
  const combined = new Map();
  for (const group of groups) {
    const dimensions = Object.fromEntries(by.map(field => [field, field === 'color' ? countedColor(group.color) : group[field]]));
    const key = JSON.stringify(by.map(field => dimensions[field]));
    if (!combined.has(key)) combined.set(key, {
      ...dimensions,
      ...(by.includes('printerId') ? {
        printerName: printerById[group.printerId]?.name || 'Imprimante inconnue',
        printerSerial: printerById[group.printerId]?.serial || ''
      } : {}),
      jobs: 0, printCount: 0, simplexEquivalent: 0
    });
    const row = combined.get(key);
    const count = group._sum.printCount || 0;
    row.jobs += group._count._all;
    row.printCount += count;
    row.simplexEquivalent += simplexEquivalent(count, group.duplex);
  }
  const rows = [...combined.values()];
  rows.sort((a, b) => b.simplexEquivalent - a.simplexEquivalent ||
    JSON.stringify(by.map(field => a[field])).localeCompare(JSON.stringify(by.map(field => b[field])), 'fr'));
  const totals = rows.reduce((total, row) => ({
    jobs: total.jobs + row.jobs,
    printCount: total.printCount + row.printCount,
    simplexEquivalent: total.simplexEquivalent + row.simplexEquivalent
  }), { jobs: 0, printCount: 0, simplexEquivalent: 0 });
  return { groupBy: by, totals, rows };
}

function countedColor(color) { return color === 'Grayscale' ? 'Black' : color; }
function simplexEquivalent(count, duplex) { return count * (duplex === 'Duplex' ? 2 : 1); }

function csvCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = String(value ?? '');
  // Empêcher qu'un nom d'utilisateur ou de document devienne une formule Excel.
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvLine(values) { return values.map(csvCell).join(';') + '\r\n'; }

function csvGroupValue(row, field) {
  if (field === 'printerId') return `${row.printerName} (${row.printerSerial})`;
  if (field === 'ownerName') return row.ownerName || 'Utilisateur inconnu';
  if (field === 'jobKind') return { Copy: 'Copie', Print: 'Impression', Scan: 'Scan' }[row.jobKind] || row.jobKind;
  if (field === 'status') return { Done: 'Terminé', Suspend: 'Suspendu', Error: 'Erreur' }[row.status] || row.status;
  return row[field] || '—';
}

function startCsv(res, filename) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('\uFEFF');
}

function waitForDrainOrClose(res) {
  return new Promise(resolve => {
    const finish = () => {
      res.off('drain', finish);
      res.off('close', finish);
      resolve();
    };
    res.once('drain', finish);
    res.once('close', finish);
  });
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
    res.json({ printers, owners: owners.map(row => row.ownerName).filter(Boolean), colors: [...new Set(colors.map(row => countedColor(row.color)).filter(Boolean))].sort(), duplexes: duplexes.map(row => row.duplex).filter(Boolean) });
  } catch (error) { next(error); }
});

router.get('/summary/export', async (req, res, next) => {
  try {
    const where = filters(req.query);
    const by = groupFields(req.query.groupBy);
    const columns = summaryColumns(req.query.columns);
    const report = await summary(where, by);
    startCsv(res, 'synthese-impressions.csv');
    res.write(csvLine([...by.map(field => GROUP_FIELDS[field]), ...columns.map(column => SUMMARY_COLUMNS[column])]));
    for (const row of report.rows) {
      res.write(csvLine([...by.map(field => csvGroupValue(row, field)), ...columns.map(column => row[column])]));
    }
    res.end();
  } catch (error) { next(error); }
});

router.get('/summary', async (req, res, next) => {
  try {
    res.json(await summary(filters(req.query), groupFields(req.query.groupBy)));
  } catch (error) { next(error); }
});

router.get('/copies/export', async (req, res, next) => {
  try {
    const where = filters(req.query);
    where.jobKind = 'Copy';
    startCsv(res, 'copies-riso.csv');
    res.write(csvLine(['Date', 'Utilisateur', 'Imprimante', 'N° de série', 'ID opération', 'Nom du document', 'Statut', 'Couleur source', 'Couleur comptabilisée', 'Recto verso', 'Papier', 'Pages originales', 'Pages imprimées', 'Volume de sortie', 'Exemplaires imprimés', 'Équivalents simplex']));
    let cursor;
    for (;;) {
      const jobs = await prisma.printerJob.findMany({
        where,
        include: { printer: { select: { name: true, serial: true } } },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
      if (!jobs.length) break;
      for (const job of jobs) {
        const line = csvLine([
          job.startedAt.toISOString().slice(0, 19).replace('T', ' '), job.ownerName,
          job.printer.name, job.printer.serial, job.jobId, job.jobName, job.status,
          job.color, countedColor(job.color), job.duplex, job.paperSize, job.originalPages, job.printPages,
          job.outputVolume, job.printCount, simplexEquivalent(job.printCount, job.duplex)
        ]);
        if (!res.write(line) && !res.destroyed) await waitForDrainOrClose(res);
        if (res.destroyed) return;
      }
      cursor = jobs.at(-1).id;
      if (jobs.length < 500) break;
    }
    res.end();
  } catch (error) { if (res.headersSent) res.destroy(error); else next(error); }
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
    res.json({ total, page, pageSize, rows: rows.map(row => ({
      ...row, countedColor: countedColor(row.color), simplexEquivalent: simplexEquivalent(row.printCount, row.duplex)
    })) });
  } catch (error) { next(error); }
});

module.exports = router;
