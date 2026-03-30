const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { createSmtpTransporter } = require('../utils/mail');
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
const loanAccessLinkLimiter = process.env.NODE_ENV !== 'test'
  ? rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      keyGenerator: req => (req.body?.requesterEmail || '').trim().toLowerCase() || req.ip,
      message: { error: 'Trop de demandes de lien pour cet email, réessayez dans une heure.' },
      skip: req => !req.body?.requesterEmail
    })
  : (_req, _res, next) => next();

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
  const equipments = (resource.equipments || []).map(e => e.equipment || e).filter(Boolean);
  const hasRepairEquipment = equipments.length > 0 && equipments.some(e => e.status === 'REPAIR');
  return { ...resource, ...bundle, equipments, hasRepairEquipment };
}

const EQUIPMENT_SELECT = {
  equipments: {
    include: {
      equipment: { select: { id: true, name: true, serialNumber: true, status: true, type: true } }
    }
  }
};

function computeOccurrences(startAt, endAt, recurrence) {
  const occurrences = [{ startAt: new Date(startAt), endAt: new Date(endAt) }];
  if (!recurrence?.type || recurrence.type === 'none') return occurrences;
  const duration = new Date(endAt) - new Date(startAt);
  const until = new Date(recurrence.until);
  let cur = new Date(startAt);
  for (let i = 0; i < 365; i++) {
    if (recurrence.type === 'daily')     cur.setDate(cur.getDate() + 1);
    else if (recurrence.type === 'weekly')    cur.setDate(cur.getDate() + 7);
    else if (recurrence.type === 'biweekly')  cur.setDate(cur.getDate() + 14);
    else if (recurrence.type === 'monthly')   cur.setMonth(cur.getMonth() + 1);
    else break;
    if (cur > until) break;
    occurrences.push({ startAt: new Date(cur), endAt: new Date(cur.getTime() + duration) });
  }
  return occurrences;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function fmtLoanDate(d) {
  return new Date(d).toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function sendLoanConfirmationEmail(reservation) {
  try {
    const { transporter, from } = createSmtpTransporter();
    if (!transporter) return;
    const r = reservation.resource;
    await transporter.sendMail({
      from,
      to: reservation.requesterEmail,
      subject: `Demande de prêt enregistrée – ${r.name}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="color:#0f172a;">Demande de prêt enregistrée</h2>
        <p>Bonjour ${reservation.requesterName},</p>
        <p>Votre demande a bien été reçue. Elle est en attente de validation.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Ressource</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #e2e8f0;">${r.name}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Début</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${fmtLoanDate(reservation.startAt)}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Fin</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${fmtLoanDate(reservation.endAt)}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;">Quantité</td><td style="padding:8px 0;">${reservation.requestedUnits} unité(s)</td></tr>
        </table>
        <p style="color:#64748b;font-size:13px;">Vous recevrez un email dès que votre demande sera traitée.</p>
      </div>`
    });
  } catch (err) {
    console.error('[loans] sendLoanConfirmationEmail:', err.message);
  }
}

async function sendLoanStatusEmail(reservation, newStatus) {
  if (!['APPROVED', 'REJECTED'].includes(newStatus)) return;
  try {
    const { transporter, from } = createSmtpTransporter();
    if (!transporter) return;
    const r = reservation.resource;
    const ok = newStatus === 'APPROVED';
    await transporter.sendMail({
      from,
      to: reservation.requesterEmail,
      subject: `${ok ? 'Prêt confirmé' : 'Demande non retenue'} – ${r.name}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
        <div style="background:${ok ? '#f0fdf4' : '#fff1f2'};border-radius:12px;padding:18px 22px;margin-bottom:20px;">
          <h2 style="color:${ok ? '#166534' : '#9f1239'};margin:0 0 6px;">
            ${ok ? '&#10003; Prêt confirmé' : '&#10007; Demande non retenue'}
          </h2>
          <p style="color:${ok ? '#166534' : '#9f1239'};margin:0;font-size:14px;">
            ${ok ? 'Votre demande de prêt a été approuvée.' : "Votre demande de prêt n'a pas pu être accordée."}
          </p>
        </div>
        <p>Bonjour ${reservation.requesterName},</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Ressource</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #e2e8f0;">${r.name}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Début</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${fmtLoanDate(reservation.startAt)}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;border-bottom:1px solid #e2e8f0;">Fin</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${fmtLoanDate(reservation.endAt)}</td></tr>
          <tr><td style="padding:8px 0;color:#475569;">Quantité</td><td style="padding:8px 0;">${reservation.requestedUnits} unité(s)</td></tr>
        </table>
        ${!ok && reservation.internalNotes ? `<p style="background:#f8fafc;border-left:3px solid #cbd5e1;padding:10px 14px;border-radius:6px;color:#475569;font-size:13px;">${reservation.internalNotes}</p>` : ''}
        <p style="color:#64748b;font-size:13px;">${ok ? 'Merci de vous présenter au lieu de retrait à la date convenue.' : "N'hésitez pas à reformuler votre demande à une autre date."}</p>
      </div>`
    });
  } catch (err) {
    console.error('[loans] sendLoanStatusEmail:', err.message);
  }
}

function getLoanRequestUrl(requestToken, accessToken) {
  const url = new URL('/loan-request.html', config.appUrl);
  url.searchParams.set('token', requestToken);
  url.searchParams.set('access', accessToken);
  return url.toString();
}

async function findValidRequestLink(token) {
  const link = await prisma.loanMagicLink.findUnique({
    where: { token },
    include: { resource: true }
  });

  if (!link || !link.isActive || (link.expiresAt && link.expiresAt < new Date())) {
    throw Object.assign(new Error('Lien de demande de prêt invalide ou expiré'), { status: 404 });
  }

  return link;
}

async function findValidAccessLink(requestToken, accessToken) {
  if (!accessToken) return null;

  const accessLink = await prisma.loanRequestAccessLink.findUnique({
    where: { token: accessToken },
    include: {
      requestLink: {
        include: { resource: true }
      }
    }
  });

  if (!accessLink) return null;
  if (accessLink.expiresAt < new Date()) return null;
  if (!accessLink.requestLink || accessLink.requestLink.token !== requestToken) return null;
  if (!accessLink.requestLink.isActive || (accessLink.requestLink.expiresAt && accessLink.requestLink.expiresAt < new Date())) return null;

  return accessLink;
}

async function getRequestResources(link) {
  const resources = await prisma.loanResource.findMany({
    where: {
      isActive: true,
      ...(link.resourceId ? { id: link.resourceId } : {})
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }]
  });
  return resources.map(mapResource);
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
  const resource = await prisma.loanResource.findUnique({
    where: { id: resourceId },
    include: { equipments: { include: { equipment: { select: { id: true, status: true } } } } }
  });
  if (!resource || !resource.isActive) {
    throw Object.assign(new Error('Ressource de prêt introuvable'), { status: 404 });
  }

  // Bloquer si au moins un équipement lié est en réparation
  const linkedEquipments = (resource.equipments || []).map(e => e.equipment).filter(Boolean);
  if (linkedEquipments.length > 0 && linkedEquipments.some(e => e.status === 'REPAIR')) {
    throw Object.assign(new Error('Cette ressource est temporairement indisponible : un équipement lié est en cours de réparation.'), { status: 409 });
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
    const link = await findValidRequestLink(req.params.token);
    const accessLink = await findValidAccessLink(req.params.token, req.query.access);

    res.json({
      token: link.token,
      title: link.title || 'Demande de prêt de matériel',
      resourceId: link.resourceId || null,
      expiresAt: link.expiresAt,
      authenticated: !!accessLink,
      requesterEmail: accessLink?.email || null,
      requesterName: accessLink?.requesterName || null,
      accessToken: accessLink?.token || null,
      resources: accessLink ? await getRequestResources(link) : []
    });
  } catch (err) {
    next(err);
  }
});

loanPublicRouter.post('/:token/access-link',
  loanAccessLinkLimiter,
  [
    body('requesterEmail').isEmail().normalizeEmail(),
    body('requesterName').optional({ values: 'falsy' }).trim().isLength({ max: 200 })
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const link = await findValidRequestLink(req.params.token);
      const requesterEmail = normalizeEmail(req.body.requesterEmail);
      const requesterName = (req.body.requesterName || '').trim() || null;

      const accessLink = await prisma.loanRequestAccessLink.create({
        data: {
          requestLinkId: link.id,
          email: requesterEmail,
          requesterName,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      const { transporter, from } = createSmtpTransporter();
      if (!transporter) {
        return res.status(503).json({ error: 'La configuration SMTP est requise pour envoyer un lien de connexion.' });
      }

      const accessUrl = getLoanRequestUrl(link.token, accessLink.token);

      await transporter.sendMail({
        from,
        to: requesterEmail,
        subject: `Accès à votre demande de prêt${link.title ? ` – ${link.title}` : ''}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
            <h2 style="color:#0f172a;">Connexion à votre demande de prêt</h2>
            <p>Bonjour${requesterName ? ` ${requesterName}` : ''},</p>
            <p>Cliquez sur le lien ci-dessous pour ouvrir le formulaire de prêt sécurisé :</p>
            <p style="margin:24px 0;">
              <a href="${accessUrl}" style="background:#0284c7;color:white;padding:12px 24px;text-decoration:none;border-radius:10px;font-weight:600;display:inline-block;">Ouvrir le formulaire</a>
            </p>
            <p style="color:#475569;font-size:14px;">Ce lien est valable 24 heures et est lié à cette adresse email.</p>
            <p style="color:#94a3b8;font-size:12px;word-break:break-all;">Lien direct : <a href="${accessUrl}">${accessUrl}</a></p>
          </div>
        `
      });

      res.json({
        success: true,
        message: 'Un lien de connexion a été envoyé à cette adresse email.'
      });
    } catch (err) {
      next(err);
    }
  }
);

loanPublicRouter.post('/:token/requests',
  [
    body('accessToken').isString().isLength({ min: 10, max: 200 }),
    body('resourceId').isString(),
    body('requesterName').trim().isLength({ min: 2, max: 200 }),
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

      const link = await findValidRequestLink(req.params.token);
      const accessLink = await findValidAccessLink(req.params.token, req.body.accessToken);
      if (!accessLink) {
        return res.status(403).json({ error: 'Lien de connexion invalide ou expiré. Demandez un nouveau lien.' });
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
          requesterEmail: accessLink.email,
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

      // Email de confirmation en arrière-plan (ne bloque pas la réponse)
      sendLoanConfirmationEmail(reservation).catch(() => {});

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
        _count: { select: { reservations: true, magicLinks: true } },
        ...EQUIPMENT_SELECT
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
    body('color').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
    body('equipmentIds').optional().isArray()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const totalUnits = Number(req.body.totalUnits);
      const bundleSize = Math.min(totalUnits, Number(req.body.bundleSize) || 1);
      const equipmentIds = Array.isArray(req.body.equipmentIds) ? req.body.equipmentIds : [];

      const resource = await prisma.loanResource.create({
        data: {
          name: req.body.name,
          category: req.body.category || null,
          description: req.body.description || null,
          totalUnits,
          bundleSize,
          location: req.body.location || null,
          instructions: req.body.instructions || null,
          color: req.body.color || null,
          equipments: equipmentIds.length > 0
            ? { create: equipmentIds.map(id => ({ equipmentId: id })) }
            : undefined
        },
        include: { ...EQUIPMENT_SELECT }
      });

      res.status(201).json(mapResource(resource));
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.post('/resources/bulk',
  [body('equipmentIds').isArray({ min: 1, max: 200 })],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { equipmentIds } = req.body;

      // Récupérer les équipements valides
      const equipments = await prisma.equipment.findMany({
        where: { id: { in: equipmentIds } },
        select: { id: true, name: true, type: true, location: true }
      });

      // Filtrer ceux qui ont déjà une ressource de prêt liée
      const alreadyLinked = await prisma.loanResourceEquipment.findMany({
        where: { equipmentId: { in: equipmentIds } },
        select: { equipmentId: true }
      });
      const linkedIds = new Set(alreadyLinked.map(r => r.equipmentId));
      const toCreate = equipments.filter(e => !linkedIds.has(e.id));

      const created = await prisma.$transaction(
        toCreate.map(e => prisma.loanResource.create({
          data: {
            name: e.name,
            totalUnits: 1,
            bundleSize: 1,
            equipments: { create: [{ equipmentId: e.id }] }
          }
        }))
      );

      res.status(201).json({
        created: created.length,
        skipped: equipmentIds.length - toCreate.length,
        message: `${created.length} ressource(s) créée(s), ${equipmentIds.length - toCreate.length} déjà liée(s) ignorée(s).`
      });
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
    body('isActive').optional().isBoolean(),
    body('equipmentIds').optional().isArray()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.loanResource.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Ressource introuvable' });

      const totalUnits = req.body.totalUnits !== undefined ? Number(req.body.totalUnits) : existing.totalUnits;
      const bundleSize = req.body.bundleSize !== undefined ? Math.min(totalUnits, Number(req.body.bundleSize) || 1) : existing.bundleSize;

      const updateData = {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.category !== undefined ? { category: req.body.category || null } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description || null } : {}),
        ...(req.body.totalUnits !== undefined ? { totalUnits } : {}),
        ...(req.body.bundleSize !== undefined || req.body.totalUnits !== undefined ? { bundleSize } : {}),
        ...(req.body.location !== undefined ? { location: req.body.location || null } : {}),
        ...(req.body.instructions !== undefined ? { instructions: req.body.instructions || null } : {}),
        ...(req.body.color !== undefined ? { color: req.body.color || null } : {}),
        ...(req.body.isActive !== undefined ? { isActive: !!req.body.isActive } : {})
      };

      // Si equipmentIds fourni, remplacer la liste
      if (Array.isArray(req.body.equipmentIds)) {
        await prisma.loanResourceEquipment.deleteMany({ where: { loanResourceId: req.params.id } });
        if (req.body.equipmentIds.length > 0) {
          await prisma.loanResourceEquipment.createMany({
            data: req.body.equipmentIds.map(eId => ({ loanResourceId: req.params.id, equipmentId: eId })),
            skipDuplicates: true
          });
        }
      }

      const updated = await prisma.loanResource.update({
        where: { id: req.params.id },
        data: updateData,
        include: { ...EQUIPMENT_SELECT }
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

loansRouter.post('/reservations',
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
    body('internalNotes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('status').optional().isIn(['PENDING', 'APPROVED']),
    body('recurrence.type').optional().isIn(['none', 'daily', 'weekly', 'biweekly', 'monthly']),
    body('recurrence.until').optional().isISO8601()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { start, end } = ensureValidDates(req.body.startAt, req.body.endAt);
      const occurrences = computeOccurrences(start, end, req.body.recurrence);

      const created = [];
      for (const occ of occurrences) {
        const availability = await ensureAvailable(req.body.resourceId, occ.startAt, occ.endAt, req.body.requestedUnits);
        const reservation = await prisma.loanReservation.create({
          data: {
            resourceId: availability.resource.id,
            requesterName: req.body.requesterName,
            requesterEmail: normalizeEmail(req.body.requesterEmail),
            requesterPhone: req.body.requesterPhone || null,
            requesterOrganization: req.body.requesterOrganization || null,
            startAt: occ.startAt,
            endAt: occ.endAt,
            requestedUnits: availability.requestedUnits,
            reservedSlots: availability.reservedSlots,
            notes: req.body.notes || null,
            internalNotes: req.body.internalNotes || null,
            status: req.body.status || 'APPROVED',
            createdById: req.user.id
          },
          include: { resource: true }
        });
        created.push(reservation);
      }

      res.status(201).json({
        count: created.length,
        reservations: created.map(r => ({ ...r, resource: mapResource(r.resource) }))
      });
    } catch (err) {
      next(err);
    }
  }
);

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

      // Email si statut changé vers APPROVED ou REJECTED
      if (req.body.status && req.body.status !== existing.status) {
        sendLoanStatusEmail(reservation, req.body.status).catch(() => {});
      }

      res.json({
        ...reservation,
        resource: mapResource(reservation.resource)
      });
    } catch (err) {
      next(err);
    }
  }
);

loansRouter.delete('/reservations/:id', async (req, res, next) => {
  try {
    const existing = await prisma.loanReservation.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Réservation introuvable' });
    }

    await prisma.loanReservation.delete({
      where: { id: req.params.id }
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = { loansRouter, loanPublicRouter };
