const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const prisma = require('../lib/prisma');
const { createSmtpTransporter } = require('../utils/mail');
const config = require('../config');

// Rate limit magic-link par email (5/h par adresse) — en plus du rate limit IP dans app.js
const magicLinkEmailLimiter = process.env.NODE_ENV !== 'test'
  ? rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      keyGenerator: req => (req.body?.email || '').trim().toLowerCase() || req.ip,
      message: { error: 'Trop de tentatives pour cet email, réessayez dans une heure.' },
      skip: req => !req.body?.email
    })
  : (req, res, next) => next();

async function resolveReporterAccess(token) {
  if (prisma.interventionReporter?.findUnique) {
    const reporter = await prisma.interventionReporter.findUnique({
      where: { token },
      include: {
        intervention: {
          include: {
            room: { select: { name: true } },
            equipment: { select: { name: true } },
            tech: { select: { email: true, name: true } }
          }
        }
      }
    });
    if (reporter?.intervention) return { reporter, intervention: reporter.intervention };
  }

  const legacyIntervention = await prisma.intervention.findUnique({
    where: { reporterToken: token },
    include: {
      room: { select: { name: true } },
      equipment: { select: { name: true } },
      tech: { select: { email: true, name: true } }
    }
  });
  if (!legacyIntervention) return null;
  return {
    reporter: {
      token,
      name: legacyIntervention.reporterName,
      email: legacyIntervention.reporterEmail,
      interventionId: legacyIntervention.id
    },
    intervention: legacyIntervention
  };
}

const ALLOWED_CHAT_MIMES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'ticket-messages');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const uploadChatFile = multer({
  storage: chatStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ALLOWED_CHAT_MIMES.includes(file.mimetype) ? cb(null, true) : cb(new Error('Type de fichier non autorisé.'));
  }
}).single('attachment');

// POST /api/tickets — Soumission publique de ticket
router.post('/', (req, res, next) => {
  uploadChatFile(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    const {
      roomToken,
      equipmentToken,
      title,
      description,
      reporterName,
      reporterEmail,
      _honeypot
    } = req.body;

    // Anti-spam : honeypot
    if (_honeypot && _honeypot !== '') {
      return res.status(200).json({ success: true, message: 'Ticket soumis avec succès.' });
    }

    // Validation titre
    if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
      return res.status(400).json({ error: 'Le titre est requis (3 à 200 caractères).' });
    }

    // Validation email
    if (reporterEmail) {
      const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
      if (!emailRegex.test(reporterEmail)) {
        return res.status(400).json({ error: 'Format d\'email invalide.' });
      }

      // Cooldown 10 min par email (skippé en mode test)
      if (process.env.NODE_ENV !== 'test') {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const recentTicket = await prisma.intervention.findFirst({
          where: {
            reporterEmail,
            source: 'PUBLIC',
            createdAt: { gte: tenMinutesAgo }
          }
        });
        if (recentTicket) {
          return res.status(429).json({ error: 'Veuillez patienter avant de soumettre un nouveau ticket.' });
        }
      }
    }

    // Résoudre roomToken ou equipmentToken
    let roomId = null;
    let equipmentId = null;

    if (roomToken) {
      const room = await prisma.room.findUnique({ where: { qrToken: roomToken } });
      if (!room) return res.status(404).json({ error: 'QR code de salle introuvable.' });
      roomId = room.id;
    } else if (equipmentToken) {
      const equipment = await prisma.equipment.findUnique({ where: { qrToken: equipmentToken } });
      if (!equipment) return res.status(404).json({ error: 'QR code d\'équipement introuvable.' });
      equipmentId = equipment.id;
      if (equipment.roomId) roomId = equipment.roomId;
    } else if (req.body.roomId) {
      const room = await prisma.room.findUnique({ where: { id: req.body.roomId } });
      if (!room) return res.status(404).json({ error: 'Salle introuvable.' });
      roomId = room.id;
    } else {
      return res.status(400).json({ error: 'Une salle doit être renseignée.' });
    }

    const reporterToken = uuidv4();

    const intervention = await prisma.intervention.create({
      data: {
        title: title.trim(),
        description: description ? description.trim().slice(0, 2000) : null,
        status: 'OPEN',
        priority: 'NORMAL',
        source: 'PUBLIC',
        techId: null,
        roomId,
        equipmentId,
        reporterName: reporterName ? reporterName.trim() : null,
        reporterEmail: reporterEmail ? reporterEmail.trim() : null,
        reporterToken,
        reporters: {
          create: {
            name: reporterName ? reporterName.trim() : null,
            email: reporterEmail ? reporterEmail.trim().toLowerCase() : null,
            token: reporterToken,
            isPrimary: true
          }
        }
      }
    });

    // Si une photo/pièce jointe est envoyée, créer un message initial
    if (req.file) {
      await prisma.ticketMessage.create({
        data: {
          interventionId: intervention.id,
          content: '',
          authorType: 'REPORTER',
          authorName: reporterName ? reporterName.trim() : null,
          attachmentPath: `ticket-messages/${req.file.filename}`,
          attachmentName: req.file.originalname,
          attachmentMime: req.file.mimetype,
          attachmentSize: req.file.size
        }
      });
    }

    return res.status(201).json({
      success: true,
      token: reporterToken,
      message: 'Ticket soumis avec succès. Conservez ce token pour suivre votre demande.'
    });
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    next(err);
  }
});

// GET /api/tickets/rooms — Liste publique des salles (pour formulaire générique)
router.get('/rooms', async (req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({
      orderBy: [{ building: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, building: true, number: true, floor: true }
    });
    res.json(rooms);
  } catch (err) { next(err); }
});

// GET /api/tickets/rooms/:id/equipment — Équipements d'une salle (pour autocomplétion)
router.get('/rooms/:id/equipment', async (req, res, next) => {
  try {
    const equipment = await prisma.equipment.findMany({
      where: { roomId: req.params.id, status: { not: 'DECOMMISSIONED' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true, brand: true, model: true }
    });
    res.json(equipment);
  } catch (err) { next(err); }
});

// POST /api/tickets/magic-link — Envoi d'un magic link par email
router.post('/magic-link', magicLinkEmailLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email requis.' });
    }
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Format d\'email invalide.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Vérifier si des tickets existent pour cet email
    const [legacyCount, participantCount] = await Promise.all([
      prisma.intervention.count({ where: { reporterEmail: normalizedEmail, source: 'PUBLIC' } }),
      prisma.interventionReporter?.count ? prisma.interventionReporter.count({ where: { email: normalizedEmail } }) : 0
    ]);
    const count = legacyCount + participantCount;

    if (count > 0) {
      // Créer le magic link
      const magicToken = uuidv4();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.reporterMagicLink.create({
        data: { email: normalizedEmail, token: magicToken, expiresAt }
      });

      // Envoyer l'email
      try {
        const { transporter, from } = createSmtpTransporter();
        if (transporter) {
          const link = `${config.appUrl}/my-tickets.html?token=${magicToken}`;
          await transporter.sendMail({
            from,
            to: normalizedEmail,
            subject: 'Accès à vos demandes – MaintenanceBoard',
            html: `
              <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
                <h2 style="color:#1e293b;">Accès à vos demandes</h2>
                <p>Bonjour,</p>
                <p>Vous avez demandé un accès à vos tickets de maintenance. Cliquez sur le lien ci-dessous pour consulter l'état de vos demandes :</p>
                <p style="margin:24px 0;">
                  <a href="${link}" style="background:#f97316;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:bold;">Accéder à mes demandes</a>
                </p>
                <p style="color:#64748b;font-size:13px;">Ce lien est valable 24 heures. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
                <p style="color:#64748b;font-size:12px;">Lien direct : <a href="${link}">${link}</a></p>
              </div>
            `
          });
        }
      } catch (mailErr) {
        // Fail silently — SMTP peut ne pas être configuré
      }
    }

    // Toujours retourner le même message (ne pas révéler si l'email existe)
    return res.json({ success: true, message: 'Si des tickets sont associés à cet email, vous recevrez un lien.' });
  } catch (err) { next(err); }
});

// GET /api/tickets/my/:magicToken — Liste des tickets via magic link
router.get('/my/:magicToken', async (req, res, next) => {
  try {
    const link = await prisma.reporterMagicLink.findUnique({
      where: { token: req.params.magicToken }
    });

    if (!link || link.expiresAt < new Date()) {
      return res.status(404).json({ error: 'Lien invalide ou expiré.' });
    }

    const reporterLinks = prisma.interventionReporter?.findMany
      ? await prisma.interventionReporter.findMany({
          where: { email: link.email },
          orderBy: { createdAt: 'desc' },
          include: {
            intervention: {
              include: {
                room: { select: { name: true } },
                equipment: { select: { name: true } },
                messages: { orderBy: { createdAt: 'desc' }, take: 1 }
              }
            }
          }
        })
      : [];

    const deduped = new Map();
    for (const reporter of reporterLinks) {
      const intervention = reporter.intervention;
      if (!intervention || intervention.mergedIntoId) continue;
      if (!deduped.has(intervention.id)) {
        deduped.set(intervention.id, {
          ...intervention,
          reporterToken: reporter.token
        });
      }
    }

    if (deduped.size === 0) {
      const legacyTickets = await prisma.intervention.findMany({
        where: { reporterEmail: link.email, source: 'PUBLIC', mergedIntoId: null },
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { name: true } },
          equipment: { select: { name: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 }
        }
      });
      for (const ticket of legacyTickets) {
        deduped.set(ticket.id, ticket);
      }
    }

    return res.json({ email: link.email, tickets: [...deduped.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch (err) { next(err); }
});

// GET /api/tickets/:token/messages — Messages d'un ticket (public)
router.get('/:token/messages', async (req, res, next) => {
  try {
    const access = await resolveReporterAccess(req.params.token);
    if (!access) {
      return res.status(404).json({ error: 'Ticket introuvable.' });
    }
    const { intervention } = access;

    // Marquer les messages TECH non lus comme lus (le reporter les consulte)
    await prisma.ticketMessage.updateMany({
      where: { interventionId: intervention.id, authorType: 'TECH', readAt: null },
      data: { readAt: new Date() }
    });

    const messages = await prisma.ticketMessage.findMany({
      where: { interventionId: intervention.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, authorType: true, authorName: true, createdAt: true,
                readAt: true, attachmentPath: true, attachmentName: true, attachmentMime: true, attachmentSize: true }
    });

    return res.json(messages);
  } catch (err) { next(err); }
});

// POST /api/tickets/:token/messages — Envoyer un message (reporter public)
router.post('/:token/messages', (req, res, next) => {
  uploadChatFile(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    const content = (req.body.content || '').trim();
    const hasFile = !!req.file;

    if (!content && !hasFile) {
      return res.status(400).json({ error: 'Message ou fichier requis.' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message trop long (2000 caractères max).' });
    }

    const { authorName } = req.body;

    const access = await resolveReporterAccess(req.params.token);
    if (!access) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Ticket introuvable.' });
    }
    const { intervention, reporter } = access;

    // Rate limit : 5 messages max depuis la dernière réponse du support (ou depuis 1h)
    const lastTechMsg = await prisma.ticketMessage.findFirst({
      where: { interventionId: intervention.id, authorType: 'TECH' },
      orderBy: { createdAt: 'desc' }
    });
    const windowStart = lastTechMsg
      ? lastTechMsg.createdAt
      : new Date(Date.now() - 60 * 60 * 1000);

    const recentCount = await prisma.ticketMessage.count({
      where: { interventionId: intervention.id, authorType: 'REPORTER', createdAt: { gte: windowStart } }
    });

    if (recentCount >= 5) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(429).json({ error: 'Trop de messages envoyés. Attendez une réponse du support.' });
    }

    const message = await prisma.ticketMessage.create({
      data: {
        interventionId: intervention.id,
        content,
        authorType: 'REPORTER',
        authorName: authorName ? authorName.trim() : (reporter?.name || intervention.reporterName || null),
        ...(req.file ? {
          attachmentPath: `ticket-messages/${req.file.filename}`,
          attachmentName: req.file.originalname,
          attachmentMime: req.file.mimetype,
          attachmentSize: req.file.size
        } : {})
      }
    });

    // Notification email à l'équipe technique
    try {
      const { transporter, from } = createSmtpTransporter();
      if (transporter) {
        let recipientEmail = null;
        let recipientName = null;

        if (intervention.tech?.email) {
          recipientEmail = intervention.tech.email;
          recipientName = intervention.tech.name;
        } else {
          const admin = await prisma.user.findFirst({
            where: { role: 'ADMIN' },
            select: { email: true, name: true }
          });
          if (admin) {
            recipientEmail = admin.email;
            recipientName = admin.name;
          }
        }

        if (recipientEmail) {
          const senderName = message.authorName || reporter?.email || intervention.reporterEmail || 'Demandeur';
          await transporter.sendMail({
            from,
            to: recipientEmail,
            subject: `[Nouveau message] ${intervention.title}`,
            html: `
              <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
                <h2 style="color:#1e293b;">Nouveau message sur un ticket</h2>
                <p><strong>${senderName}</strong> a envoyé un message :</p>
                <blockquote style="border-left:3px solid #f97316;padding-left:12px;color:#475569;">${content.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</blockquote>
                <p><a href="${config.appUrl}/interventions.html">Voir les interventions</a></p>
              </div>
            `
          });
        }
      }
    } catch (mailErr) {
      // Fail silently
    }

    return res.status(201).json(message);
  } catch (err) { next(err); }
});

// GET /api/tickets/:token — Suivi public du statut
router.get('/:token', async (req, res, next) => {
  try {
    const access = await resolveReporterAccess(req.params.token);
    if (!access) {
      return res.status(404).json({ error: 'Ticket introuvable.' });
    }
    const { intervention } = access;

    // Retourner uniquement les infos non sensibles
    return res.json({
      status: intervention.status,
      priority: intervention.priority,
      title: intervention.title,
      createdAt: intervention.createdAt,
      room: intervention.room ? { name: intervention.room.name } : null,
      equipment: intervention.equipment ? { name: intervention.equipment.name } : null
    });
  } catch (err) { next(err); }
});

module.exports = router;
