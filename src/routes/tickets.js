const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const prisma = require('../lib/prisma');
const { createSmtpTransporter } = require('../utils/mail');
const config = require('../config');

// POST /api/tickets — Soumission publique de ticket
router.post('/', async (req, res, next) => {
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
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

    await prisma.intervention.create({
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
        reporterToken
      }
    });

    return res.status(201).json({
      success: true,
      token: reporterToken,
      message: 'Ticket soumis avec succès. Conservez ce token pour suivre votre demande.'
    });
  } catch (err) { next(err); }
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
router.post('/magic-link', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email requis.' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Format d\'email invalide.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Vérifier si des tickets existent pour cet email
    const count = await prisma.intervention.count({
      where: { reporterEmail: normalizedEmail, source: 'PUBLIC' }
    });

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

    const tickets = await prisma.intervention.findMany({
      where: { reporterEmail: link.email, source: 'PUBLIC' },
      orderBy: { createdAt: 'desc' },
      include: {
        room: { select: { name: true } },
        equipment: { select: { name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });

    return res.json({ email: link.email, tickets });
  } catch (err) { next(err); }
});

// GET /api/tickets/:token/messages — Messages d'un ticket (public)
router.get('/:token/messages', async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { reporterToken: req.params.token }
    });

    if (!intervention) {
      return res.status(404).json({ error: 'Ticket introuvable.' });
    }

    const messages = await prisma.ticketMessage.findMany({
      where: { interventionId: intervention.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, authorType: true, authorName: true, createdAt: true }
    });

    return res.json(messages);
  } catch (err) { next(err); }
});

// POST /api/tickets/:token/messages — Envoyer un message (reporter public)
router.post('/:token/messages', async (req, res, next) => {
  try {
    const { content, authorName } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length < 1 || content.trim().length > 2000) {
      return res.status(400).json({ error: 'Le message doit contenir entre 1 et 2000 caractères.' });
    }

    const intervention = await prisma.intervention.findUnique({
      where: { reporterToken: req.params.token },
      include: { tech: { select: { email: true, name: true } } }
    });

    if (!intervention) {
      return res.status(404).json({ error: 'Ticket introuvable.' });
    }

    // Rate limit : max 5 messages par ticket par heure
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await prisma.ticketMessage.count({
      where: {
        interventionId: intervention.id,
        authorType: 'REPORTER',
        createdAt: { gte: oneHourAgo }
      }
    });

    if (recentCount >= 5) {
      return res.status(429).json({ error: 'Trop de messages envoyés. Réessayez dans une heure.' });
    }

    const message = await prisma.ticketMessage.create({
      data: {
        interventionId: intervention.id,
        content: content.trim(),
        authorType: 'REPORTER',
        authorName: authorName ? authorName.trim() : (intervention.reporterName || null)
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
          const senderName = message.authorName || intervention.reporterEmail || 'Demandeur';
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
    const intervention = await prisma.intervention.findUnique({
      where: { reporterToken: req.params.token },
      include: {
        room: { select: { name: true } },
        equipment: { select: { name: true } }
      }
    });

    if (!intervention) {
      return res.status(404).json({ error: 'Ticket introuvable.' });
    }

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
