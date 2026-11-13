const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { linkSchema, parseInternalLink, resolveLink, searchLinks } = require('../services/meetingLinks');

const router = express.Router();
router.use(requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['ADMIN', 'TECH'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
  next();
});
const documentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']),
  topics: z.array(z.object({
    id: z.string().uuid(), title: z.string().trim().min(1).max(300),
    checked: z.boolean(), notes: z.string().max(20000),
    links: z.array(linkSchema).max(10)
  }).strict()).max(100)
    .refine(topics => new Set(topics.map(t => t.id)).size === topics.length, 'Sujets dupliqués')
    .refine(topics => topics.reduce((count, t) => count + t.links.length, 0) <= 100, 'Trop de liens')
}).strict();
const updateSchema = documentSchema.extend({ version: z.number().int().min(1) });
const summarySelect = { id: true, title: true, scheduledAt: true, status: true, version: true, createdAt: true, updatedAt: true,
  creator: { select: { id: true, name: true } } };

async function serialize(meeting, user) {
  const topics = JSON.parse(meeting.topics);
  // Never persist preview snapshots: authorization is checked for the current reader.
  const previews = new Map();
  for (const topic of topics) for (const link of topic.links) {
    const key = `${link.type}:${link.id}`;
    if (!previews.has(key)) previews.set(key, await resolveLink(link, user));
  }
  return { ...meeting, topics: topics.map(topic => ({ ...topic,
    links: topic.links.map(link => ({ ...link, preview: previews.get(`${link.type}:${link.id}`) })) })) };
}

router.post('/link-preview', async (req, res, next) => {
  const link = parseInternalLink(req.body?.url);
  if (!link) return res.status(400).json({ error: 'Lien interne non pris en charge. Utilisez une URL de fiche avec id ou focus.' });
  try {
    const preview = await resolveLink(link, req.user);
    if (!preview) return res.status(404).json({ error: 'Objet indisponible' });
    res.json({ ...link, preview });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Math.min(1000000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const where = req.query.status ? { status: String(req.query.status) } : {};
    const [data, total] = await Promise.all([
      prisma.meeting.findMany({ where, select: summarySelect, orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], skip: (page - 1) * 30, take: 30 }),
      prisma.meeting.count({ where })
    ]);
    res.json({ data, pagination: { page, total, totalPages: Math.ceil(total / 30) } });
  } catch (err) { next(err); }
});

router.get('/link-search', async (req, res, next) => {
  const parsed = z.object({ type: linkSchema.shape.type, q: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Recherche de lien invalide' });
  try { res.json(await searchLinks(parsed.data, req.user)); }
  catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { id: req.params.id }, include: { creator: { select: { id: true, name: true } } } });
    if (!meeting) return res.status(404).json({ error: 'Réunion introuvable' });
    res.json(await serialize(meeting, req.user));
  } catch (err) { next(err); }
});

async function validateLinks(topics, user) {
  // Missing or no longer authorized references already saved may be retained,
  // but a new reference must be readable by its author.
  const seen = new Set();
  for (const topic of topics) for (const link of topic.links) {
    const key = `${link.type}:${link.id}`;
    if (!seen.has(key) && !await resolveLink(link, user)) return false;
    seen.add(key);
  }
  return true;
}

router.post('/', async (req, res, next) => {
  const parsed = documentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Réunion invalide : vérifiez le titre, la date et les sujets.' });
  try {
    const { topics, scheduledAt, ...fields } = parsed.data;
    if (!await validateLinks(topics, req.user)) return res.status(404).json({ error: 'Objet indisponible' });
    const meeting = await prisma.meeting.create({ data: { ...fields, scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      topics: JSON.stringify(topics), createdBy: req.user.id } });
    res.status(201).json(await serialize(meeting, req.user));
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Réunion invalide : vérifiez le titre, la date et les sujets.' });
  try {
    const previous = await prisma.meeting.findUnique({ where: { id: req.params.id } });
    if (!previous) return res.status(404).json({ error: 'Réunion introuvable' });
    const { topics, version, scheduledAt, ...fields } = parsed.data;
    const existing = new Set(JSON.parse(previous.topics).flatMap(t => t.links.map(l => `${l.type}:${l.id}`)));
    const added = topics.map(t => ({ links: t.links.filter(l => !existing.has(`${l.type}:${l.id}`)) }));
    if (!await validateLinks(added, req.user)) return res.status(404).json({ error: 'Objet indisponible' });
    const updatedAt = new Date();
    const result = await prisma.meeting.updateMany({ where: { id: req.params.id, version }, data: {
      ...fields, scheduledAt: scheduledAt ? new Date(scheduledAt) : null, topics: JSON.stringify(topics), version: { increment: 1 }, updatedAt
    } });
    if (!result.count) return res.status(409).json({ error: 'Cette réunion a été modifiée par un collègue. Vos notes sont conservées à l’écran ; copiez-les avant de recharger.', code: 'MEETING_CONFLICT' });
    // Return the version written by this request, even if another writer saves immediately afterwards.
    res.json(await serialize({ ...previous, ...fields, scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      topics: JSON.stringify(topics), version: version + 1, updatedAt }, req.user));
  } catch (err) { next(err); }
});

module.exports = router;
