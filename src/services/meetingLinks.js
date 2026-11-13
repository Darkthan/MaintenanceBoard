const { z } = require('zod');
const prisma = require('../lib/prisma');
const config = require('../config');
const { readSettings } = require('../utils/settings');
const { containsFilter } = require('../lib/db-utils');

const linkSchema = z.object({
  type: z.enum(['orders', 'equipment', 'rooms', 'interventions', 'projects']),
  id: z.string().uuid()
}).strict();

// Parse a small allowlist of application routes. Never fetch a supplied URL.
function parseInternalLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const base = new URL(config.appUrl);
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null;
    const match = /^\/(orders|equipment|rooms|interventions|projects)\.html$/.exec(url.pathname);
    if (!match) return null;
    const id = url.searchParams.get('id') || url.searchParams.get('focus');
    const parsed = linkSchema.safeParse({ type: match[1], id });
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

const interventionAccess = user => user.role === 'TECH' ? { OR: [{ techId: user.id }, { kind: 'CHECKUP' }] } : {};

async function searchLinks({ type, q = '', page = 1 }, user) {
  if (!user?.isActive || !['ADMIN', 'TECH'].includes(user.role)) return { data: [], hasMore: false };
  const models = { orders: 'order', equipment: 'equipment', rooms: 'room', interventions: 'intervention', projects: 'project' };
  const title = ['equipment', 'rooms'].includes(type) ? 'name' : 'title';
  const search = q ? { OR: [{ [title]: containsFilter(q) }, { id: containsFilter(q) },
    ...(type === 'orders' ? [{ supplier: containsFilter(q) },
      ...(/-([a-f0-9]{6})$/i.test(q) ? [{ id: { endsWith: q.slice(-6).toLowerCase() } }] : [])] : [])] } : {};
  // Apply visibility BEFORE pagination so counts/pages never reveal inaccessible work.
  const candidates = await prisma[models[type]].findMany({
    where: { AND: [search, ...(type === 'interventions' ? [interventionAccess(user)] : [])] },
    select: { id: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * 10, take: 11
  });
  const links = await Promise.all(candidates.slice(0, 10).map(async ({ id }) => {
    const preview = await resolveLink({ type, id }, user);
    return preview ? { type, id, preview } : null;
  }));
  return { data: links.filter(Boolean), hasMore: candidates.length > 10 };
}

async function resolveLink(link, user) {
  if (!user?.isActive || !['ADMIN', 'TECH'].includes(user.role)) return null;
  const { type, id } = linkSchema.parse(link);
  let object;
  if (type === 'orders') {
    object = await prisma.order.findUnique({ where: { id }, select: {
      id: true, title: true, status: true, totalAmount: true, createdAt: true,
      items: { select: { quantity: true, unitPrice: true, priceType: true } }
    } });
    if (!object) return null;
    const tpl = { poPrefix: 'BC-', ...(readSettings().poTemplate || {}) };
    const rate = parseFloat(tpl.tvaRate) || 20;
    const hasPrices = object.items.some(item => item.unitPrice !== null);
    const total = hasPrices ? object.items.reduce((sum, item) => sum + item.quantity * (item.unitPrice || 0) * (item.priceType === 'HT' ? 1 + rate / 100 : 1), 0) : object.totalAmount;
    return { type, id, title: object.title, status: object.status,
      reference: `${tpl.poPrefix}${object.createdAt.getFullYear()}-${id.slice(-6).toUpperCase()}`,
      totalAmount: total == null ? null : Math.round(total * 100) / 100,
      currency: tpl.currency || 'EUR', url: `/orders.html?id=${encodeURIComponent(id)}` };
  }
  if (type === 'interventions') {
    // Same visibility as GET /api/interventions/:id: a TECH sees their work and checkups.
    object = await prisma.intervention.findFirst({ where: { id,
      ...interventionAccess(user)
    }, select: { id: true, title: true, status: true } });
  } else if (type === 'equipment') {
    object = await prisma.equipment.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  } else if (type === 'rooms') {
    object = await prisma.room.findUnique({ where: { id }, select: { id: true, name: true } });
  } else if (type === 'projects') {
    object = await prisma.project.findUnique({ where: { id }, select: { id: true, title: true } });
  }
  return object ? { type, id, title: object.title || object.name, status: object.status || null,
    reference: id, url: `/${type}.html?${type === 'projects' ? 'id' : 'focus'}=${encodeURIComponent(id)}` } : null;
}

module.exports = { linkSchema, parseInternalLink, resolveLink, searchLinks };
