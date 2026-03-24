const express = require('express');
const { body, query, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const {
  ACTIVE_LOAN_STATUSES,
  getBundleInfo,
  computeReservedSlots,
  overlaps,
  getCalendarFeedToken,
  escapeIcsText,
  toIcsDate
} = require('../utils/loans');

const loansRouter = express.Router();
const loanPublicRouter = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

function mapResource(resource) {
  const bundle = getBundleInfo(resource);
  return {
    ...resource,
    ...bundle
  };
}

function ensureValidDates(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw Object.assign(new Error('Les dates de prêt sont invalides'), { status: 400 });
  }
  if (end <= start) {
    throw Object.assign(new Error('La date de fin doit être après la date de début'), { status: 400 });
  }
  return { start, end };
}

async function ensureAvailable(resourceId, startAt, endAt, requestedUnits, excludeReservationId = null) {
  const resource = await prisma.loanResource.findUnique({ where: { id: resourceId } });
  if (!resource || !resource.isActive) {
    throw Object.assign(new Error('Ressource de prêt introuvable'), { status: 404 });
  }

  const bundle = getBundleInfo(resource);
  const requested = Math.max(1, Math.min(bundle.totalUnits, Math.round(Number(requestedUnits) || 1)));
  const reservedSlots = computeReservedSlots(resource, requested);

  const overlapsWhere = {
    resourceId,
    status: { in: ACTIVE_LOAN_STATUSES },
    startAt: { lt: new Date(endAt) },
    endAt: { gt: new Date(startAt) }
  };

  if (excludeReservationId) {
    overlapsWhere.id = { not: excludeReservationId };
  }

  const overlapping = await prisma.loanReservation.findMany({ where: overlapsWhere });
  const usedSlots = overlapping.reduce((sum, item) => sum + (item.reservedSlots || 0), 0);

  if (usedSlots + reservedSlots > bundle.totalSlots) {
    throw Object.assign(new Error(`Disponibilité insuffisante sur cette période. ${bundle.totalSlots - usedSlots} lot(s) restant(s).`), { status: 409 });
  }

  return {
    resource,
    requestedUnits: requested,
    reservedSlots,
    remainingSlots: Math.max(0, bundle.totalSlots - usedSlots - reservedSlots)
  };
}

function buildIcs(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MaintenanceBoard//Loans//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  events.forEach(event => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@maintenanceboard`,
      `DTSTAMP:${toIcsDate(new Date())}`,
      `DTSTART:${toIcsDate(event.startAt)}`,
      `DTEND:${toIcsDate(event.endAt)}`,
      `SUMMARY:${escapeIcsText(`${event.resource.name} - ${event.requesterName}`)}`,
      `DESCRIPTION:${escapeIcsText([
        `Demandeur : ${event.requesterName}`,
        `Email : ${event.requesterEmail}`,
        `Quantité : ${event.requestedUnits}`,
        event.requesterOrganization ? `Organisation : ${event.requesterOrganization}` : null,
        event.additionalNeeds ? `Besoins : ${event.additionalNeeds}` : null
      ].filter(Boolean).join('\n'))}`,
      `LOCATION:${escapeIcsText(event.resource.location || 'MaintenanceBoard')}`,
      `STATUS:${event.status === 'APPROVED' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function getCalendarEvents(startAt, endAt) {
  return prisma.loanReservation.findMany({
    where: {
      status: { in: ACTIVE_LOAN_STATUSES },
      startAt: { lt: endAt },
      endAt: { gt: startAt }
    },
    orderBy: { startAt: 'asc' },
    include: {
      resource: true,
      requestLink: { select: { id: true, title: true } }
    }
  });
}

loanPublicRouter.get('/:token', async (req, res, next) => {
  try {
    const link = await prisma.loanMagicLink.findUnique({
      where: { token: req.params.token },
      include: { resource: true }
    });

    if (!link || !link.isActive || (link.expiresAt && link.expiresAt < new Date())) {
      return res.status(404).json({ error: 'Lien de demande de prêt invalide ou expiré' });
    }

    const resources = await prisma.loanResource.findMany({
      where: {
        isActive: true,
        ...(link.resourceId ? { id: link.resourceId } : {})
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }]
    });

    res.json({
      token: link.token,
      title: link.title || 'Demande de prêt de matériel',
      resourceId: link.resourceId || null,
      expiresAt: link.expiresAt,
      resources: resources.map(mapResource)
    });
  } catch (err) {
    next(err);
  }
});

loanPublicRouter.post('/:token/requests',
  [
    body('resourceId').isString(),
    body('requesterName').trim().isLength({ min: 2, max: 200 }),
    body('requesterEmail').isEmail().normalizeEmail(),
    body('requesterPhone').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
    body('requesterOrganization').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('startAt').isISO8601(),
    body('endAt').isISO8601(),
    body('requestedUnits').isInt({ min: 1, max: 500 }),
    body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('additionalNeeds').optional({ values: 'falsy' }).trim().isLength({ max: 2000 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const link = await prisma.loanMagicLink.findUnique({
        where: { token: req.params.token }
      });

      if (!link || !link.isActive || (link.expiresAt && link.expiresAt < new Date())) {
        return res.status(404).json({ error: 'Lien de demande de prêt invalide ou expiré' });
      }

      if (link.resourceId && link.resourceId !== req.body.resourceId) {
        return res.status(400).json({ error: 'Ce lien est limité à une ressource précise.' });
      }

      const { start, end } = ensureValidDates(req.body.startAt, req.body.endAt);
      const availability = await ensureAvailable(req.body.resourceId, start, end, req.body.requestedUnits);

      const reservation = await prisma.loanReservation.create({
        data: {
          resourceId: availability.resource.id,
          requestLinkId: link.id,
          requesterName: req.body.requesterName,
          requesterEmail: req.body.requesterEmail,
          requesterPhone: req.body.requesterPhone || null,
          requesterOrganization: req.body.requesterOrganization || null,
          startAt: start,
          endAt: end,
          requestedUnits: availability.requestedUnits,
          reservedSlots: availability.reservedSlots,
          notes: req.body.notes || null,
          additionalNeeds: req.body.additionalNeeds || null
        },
        include: {
          resource: true
        }
      });

      res.status(201).json({
        message: 'Demande de prêt enregistrée',
        reservation: {
          id: reservation.id,
          status: reservation.status,
          resource: mapResource(reservation.resource)
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.get('/calendar.ics', async (req, res, next) => {
  try {
    if (req.query.token !== getCalendarFeedToken()) {
      return res.status(403).send('Flux iCal non autorisé');
    }

    const startAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const events = await getCalendarEvents(startAt, endAt);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(buildIcs(events));
  } catch (err) {
    next(err);
  }
});

loansRouter.use(requireAuth);

loansRouter.get('/calendar-feed', (req, res) => {
  const token = getCalendarFeedToken();
  res.json({
    token,
    url: `${config.appUrl}/api/loans/calendar.ics?token=${encodeURIComponent(token)}`
  });
});

loansRouter.get('/resources', async (_req, res, next) => {
  try {
    const resources = await prisma.loanResource.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { reservations: true, magicLinks: true } }
      }
    });
    res.json(resources.map(resource => ({ ...mapResource(resource) })));
  } catch (err) {
    next(err);
  }
});

loansRouter.post('/resources',
  [
    body('name').trim().isLength({ min: 2, max: 200 }),
    body('category').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('totalUnits').isInt({ min: 1, max: 500 }),
    body('bundleSize').optional().isInt({ min: 1, max: 500 }),
    body('location').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('instructions').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('color').optional({ values: 'falsy' }).trim().isLength({ max: 20 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const totalUnits = Number(req.body.totalUnits);
      const bundleSize = Math.min(totalUnits, Number(req.body.bundleSize) || 1);

      const resource = await prisma.loanResource.create({
        data: {
          name: req.body.name,
          category: req.body.category || null,
          description: req.body.description || null,
          totalUnits,
          bundleSize,
          location: req.body.location || null,
          instructions: req.body.instructions || null,
          color: req.body.color || null
        }
      });

      res.status(201).json(mapResource(resource));
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.patch('/resources/:id',
  [
    body('name').optional().trim().isLength({ min: 2, max: 200 }),
    body('category').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('totalUnits').optional().isInt({ min: 1, max: 500 }),
    body('bundleSize').optional().isInt({ min: 1, max: 500 }),
    body('location').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('instructions').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('color').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
    body('isActive').optional().isBoolean()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.loanResource.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Ressource introuvable' });

      const totalUnits = req.body.totalUnits !== undefined ? Number(req.body.totalUnits) : existing.totalUnits;
      const bundleSize = req.body.bundleSize !== undefined ? Math.min(totalUnits, Number(req.body.bundleSize) || 1) : existing.bundleSize;

      const updated = await prisma.loanResource.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.category !== undefined ? { category: req.body.category || null } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description || null } : {}),
          ...(req.body.totalUnits !== undefined ? { totalUnits } : {}),
          ...(req.body.bundleSize !== undefined || req.body.totalUnits !== undefined ? { bundleSize } : {}),
          ...(req.body.location !== undefined ? { location: req.body.location || null } : {}),
          ...(req.body.instructions !== undefined ? { instructions: req.body.instructions || null } : {}),
          ...(req.body.color !== undefined ? { color: req.body.color || null } : {}),
          ...(req.body.isActive !== undefined ? { isActive: !!req.body.isActive } : {})
        }
      });

      res.json(mapResource(updated));
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.get('/magic-links', async (_req, res, next) => {
  try {
    const links = await prisma.loanMagicLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        resource: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { requests: true } }
      }
    });
    res.json(links);
  } catch (err) {
    next(err);
  }
});

loansRouter.post('/magic-links',
  [
    body('title').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('resourceId').optional({ values: 'falsy' }).isString(),
    body('expiresAt').optional({ values: 'falsy' }).isISO8601()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      if (req.body.resourceId) {
        const resource = await prisma.loanResource.findUnique({ where: { id: req.body.resourceId } });
        if (!resource) return res.status(404).json({ error: 'Ressource introuvable' });
      }

      const link = await prisma.loanMagicLink.create({
        data: {
          title: req.body.title || null,
          resourceId: req.body.resourceId || null,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
          createdById: req.user.id
        },
        include: {
          resource: { select: { id: true, name: true } }
        }
      });

      res.status(201).json({
        ...link,
        url: `${config.appUrl}/loan-request.html?token=${encodeURIComponent(link.token)}`
      });
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.patch('/magic-links/:id',
  [
    body('isActive').optional().isBoolean()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const link = await prisma.loanMagicLink.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.isActive !== undefined ? { isActive: !!req.body.isActive } : {})
        }
      });
      res.json(link);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Lien introuvable' });
      next(err);
    }
  }
);

loansRouter.get('/reservations',
  [
    query('start').optional().isISO8601(),
    query('end').optional().isISO8601(),
    query('status').optional().isString()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

      const where = {
        startAt: { lt: end },
        endAt: { gt: start }
      };

      if (req.query.status) {
        where.status = req.query.status;
      }

      const reservations = await prisma.loanReservation.findMany({
        where,
        orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
        include: {
          resource: true,
          requestLink: { select: { id: true, title: true, token: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } }
        }
      });

      res.json(reservations.map(item => ({
        ...item,
        resource: mapResource(item.resource)
      })));
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.get('/calendar', async (req, res, next) => {
  try {
    const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const reservations = await getCalendarEvents(start, end);
    res.json(reservations.map(item => ({
      ...item,
      resource: mapResource(item.resource)
    })));
  } catch (err) {
    next(err);
  }
});

loansRouter.patch('/reservations/:id',
  [
    body('status').optional().isIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURNED']),
    body('internalNotes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('additionalNeeds').optional({ values: 'falsy' }).trim().isLength({ max: 2000 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.loanReservation.findUnique({
        where: { id: req.params.id },
        include: { resource: true }
      });
      if (!existing) return res.status(404).json({ error: 'Réservation introuvable' });

      if (req.body.status === 'APPROVED') {
        await ensureAvailable(existing.resourceId, existing.startAt, existing.endAt, existing.requestedUnits, existing.id);
      }

      const reservation = await prisma.loanReservation.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.status !== undefined ? { status: req.body.status, approvedById: req.body.status === 'APPROVED' ? req.user.id : existing.approvedById } : {}),
          ...(req.body.internalNotes !== undefined ? { internalNotes: req.body.internalNotes || null } : {}),
          ...(req.body.additionalNeeds !== undefined ? { additionalNeeds: req.body.additionalNeeds || null } : {})
        },
        include: {
          resource: true,
          requestLink: { select: { id: true, title: true, token: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } }
        }
      });

      res.json({
        ...reservation,
        resource: mapResource(reservation.resource)
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = { loansRouter, loanPublicRouter };
