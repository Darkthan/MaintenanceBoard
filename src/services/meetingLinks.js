const { z } = require('zod');
const prisma = require('../lib/prisma');
const config = require('../config');
const { readSettings } = require('../utils/settings');

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
      ...(user.role === 'TECH' ? { OR: [{ techId: user.id }, { kind: 'CHECKUP' }] } : {})
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

module.exports = { linkSchema, parseInternalLink, resolveLink };
