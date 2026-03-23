const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { uploadPhoto } = require('../middleware/upload');

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

const prisma = require('../lib/prisma');
const { containsFilter } = require('../lib/db-utils');
const { createSmtpTransporter } = require('../utils/mail');
const config = require('../config');
const {
  extractLowDiskMountFromTitle,
  parseAgentAlertState,
  serializeAgentAlertState,
  suppressLowDiskAlert
} = require('../utils/agentMonitoring');

// SQLite stocke photos en JSON string — normaliser en tableau JS
function parsePhotos(intervention) {
  if (!intervention) return intervention;
  const p = intervention.photos;
  intervention.photos = Array.isArray(p) ? p : (typeof p === 'string' ? JSON.parse(p || '[]') : []);
  return intervention;
}

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const VALID_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];

const interventionInclude = {
  room: { select: { id: true, name: true, number: true, building: true } },
  equipment: { select: { id: true, name: true, type: true, brand: true, model: true } },
  tech: { select: { id: true, name: true, email: true } },
  reporters: {
    select: { id: true, name: true, email: true, token: true, createdAt: true, isPrimary: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
  },
  orders: {
    select: {
      id: true,
      title: true,
      status: true,
      supplier: true,
      createdAt: true,
      orderedAt: true,
      expectedDeliveryAt: true,
      receivedAt: true,
      trackingNotes: true
    },
    orderBy: { createdAt: 'desc' }
  },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { authorType: true }
  }
};

// GET /api/interventions - Liste avec filtres
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { status, priority, roomId, equipmentId, techId, dateFrom, dateTo, search, source } = req.query;

    const where = { mergedIntoId: null };
    if (status) {
      const statuses = (Array.isArray(status) ? status : [status]).filter(value => VALID_STATUSES.includes(value));
      if (statuses.length === 1) where.status = statuses[0];
      else if (statuses.length > 1) where.status = { in: statuses };
    }
    if (priority && VALID_PRIORITIES.includes(priority)) where.priority = priority;
    if (roomId) where.roomId = roomId;
    if (equipmentId) where.equipmentId = equipmentId;
    // TECH ne voit que ses propres interventions (sauf admin)
    if (techId) where.techId = techId;
    else if (req.user.role === 'TECH') where.techId = req.user.id;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { title: containsFilter(search) },
        { description: containsFilter(search) }
      ];
    }
    if (source && ['INTERNAL', 'PUBLIC'].includes(source)) where.source = source;

    const [interventions, total] = await Promise.all([
      prisma.intervention.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: interventionInclude
      }),
      prisma.intervention.count({ where })
    ]);

    res.json({
      data: interventions.map(parsePhotos),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) { next(err); }
});

// GET /api/interventions/room/:roomId - Historique d'une salle
router.get('/room/:roomId', requireAuth, async (req, res, next) => {
  try {
    const interventions = await prisma.intervention.findMany({
      where: { roomId: req.params.roomId, mergedIntoId: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: interventionInclude
    });
    res.json(interventions.map(parsePhotos));
  } catch (err) { next(err); }
});

// GET /api/interventions/equipment/:equipId - Historique d'un équipement
router.get('/equipment/:equipId', requireAuth, async (req, res, next) => {
  try {
    const interventions = await prisma.intervention.findMany({
      where: { equipmentId: req.params.equipId, mergedIntoId: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: interventionInclude
    });
    res.json(interventions.map(parsePhotos));
  } catch (err) { next(err); }
});

// GET /api/interventions/:id - Détail
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      include: interventionInclude
    });
    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    // TECH ne peut voir que ses propres interventions
    if (req.user.role === 'TECH' && intervention.techId !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    res.json(parsePhotos(intervention));
  } catch (err) { next(err); }
});

// POST /api/interventions - Créer
router.post('/',
  requireAuth,
  [
    body('title').trim().isLength({ min: 3, max: 300 }),
    body('status').optional().isIn(VALID_STATUSES),
    body('priority').optional().isIn(VALID_PRIORITIES),
    body('roomId').optional().isUUID(),
    body('equipmentId').optional().isUUID()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const { title, description, notes, status, priority, roomId, equipmentId, techId, suggestedRoom, suggestedEquipment } = req.body;

      // TECH peut seulement créer pour lui-même
      const assignedTechId = req.user.role === 'ADMIN' && techId ? techId : req.user.id;

      const intervention = await prisma.intervention.create({
        data: {
          title,
          description: description || null,
          notes: notes || null,
          status: status || 'OPEN',
          priority: priority || 'NORMAL',
          roomId: roomId || null,
          equipmentId: equipmentId || null,
          techId: assignedTechId,
          suggestedRoom: (!roomId && suggestedRoom) ? String(suggestedRoom).trim() || null : null,
          suggestedEquipment: (!equipmentId && suggestedEquipment) ? String(suggestedEquipment).trim() || null : null
        },
        include: interventionInclude
      });

      // Mettre l'équipement en REPAIR si intervention ouverte
      if (equipmentId && (!status || status === 'OPEN' || status === 'IN_PROGRESS')) {
        await prisma.equipment.updateMany({
          where: { id: equipmentId, status: 'ACTIVE' },
          data: { status: 'REPAIR' }
        });
      }

      res.status(201).json(parsePhotos(intervention));
    } catch (err) { next(err); }
  }
);

// PATCH /api/interventions/:id - Modifier statut/description
router.patch('/:id',
  requireAuth,
  [
    body('status').optional().isIn(VALID_STATUSES),
    body('priority').optional().isIn(VALID_PRIORITIES)
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.intervention.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Intervention introuvable' });
      if (req.user.role === 'TECH' && existing.techId !== req.user.id) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      const { title, description, notes, status, priority, resolution, roomId, equipmentId, suggestedRoom, suggestedEquipment } = req.body;
      const data = {};
      if (title !== undefined) data.title = title;
      if (description !== undefined) data.description = description;
      if (notes !== undefined) data.notes = notes;
      if (status !== undefined) {
        data.status = status;
        if (status === 'CLOSED' || status === 'RESOLVED') {
          data.closedAt = new Date();
        }
      }
      if (priority !== undefined) data.priority = priority;
      if (resolution !== undefined) data.resolution = resolution;
      if (roomId !== undefined) {
        data.roomId = roomId || null;
        if (roomId) data.suggestedRoom = null;
      }
      if (equipmentId !== undefined) {
        data.equipmentId = equipmentId || null;
        if (equipmentId) data.suggestedEquipment = null;
      }
      if (suggestedRoom !== undefined) data.suggestedRoom = suggestedRoom ? String(suggestedRoom).trim() || null : null;
      if (suggestedEquipment !== undefined) data.suggestedEquipment = suggestedEquipment ? String(suggestedEquipment).trim() || null : null;

      const intervention = await prisma.intervention.update({
        where: { id: req.params.id },
        data,
        include: interventionInclude
      });

      // Remettre l'équipement en ACTIVE si intervention résolue/fermée
      if ((status === 'RESOLVED' || status === 'CLOSED') && existing.equipmentId) {
        await prisma.equipment.updateMany({
          where: { id: existing.equipmentId, status: 'REPAIR' },
          data: { status: 'ACTIVE' }
        });
      }

      const lowDiskMount = extractLowDiskMountFromTitle(existing.title);
      if ((status === 'RESOLVED' || status === 'CLOSED') && existing.equipmentId && existing.source === 'INTERNAL' && lowDiskMount) {
        const equipment = await prisma.equipment.findUnique({
          where: { id: existing.equipmentId },
          select: { id: true, agentAlertState: true }
        });

        if (equipment) {
          const nextState = suppressLowDiskAlert(parseAgentAlertState(equipment.agentAlertState), lowDiskMount, existing.id);
          await prisma.equipment.update({
            where: { id: equipment.id },
            data: { agentAlertState: serializeAgentAlertState(nextState) }
          });
        }
      }

      res.json(parsePhotos(intervention));
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Intervention introuvable' });
      next(err);
    }
  }
);

// POST /api/interventions/:id/photos - Ajouter des photos
router.post('/:id/photos',
  requireAuth,
  uploadPhoto.array('photos', 10),
  async (req, res, next) => {
    try {
      const existing = await prisma.intervention.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Intervention introuvable' });
      if (req.user.role === 'TECH' && existing.techId !== req.user.id) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Aucun fichier fourni' });
      }

      const photoPaths = req.files.map(f => `/uploads/photos/${f.filename}`);
      const current = Array.isArray(existing.photos) ? existing.photos : JSON.parse(existing.photos || '[]');
      const merged = [...current, ...photoPaths];
      const intervention = await prisma.intervention.update({
        where: { id: req.params.id },
        data: { photos: JSON.stringify(merged) },
        include: interventionInclude
      });

      res.json({ message: `${req.files.length} photo(s) ajoutée(s)`, intervention: parsePhotos(intervention) });
    } catch (err) { next(err); }
  }
);

// DELETE /api/interventions/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.intervention.delete({ where: { id: req.params.id } });
    res.json({ message: 'Intervention supprimée' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Intervention introuvable' });
    next(err);
  }
});

// POST /api/interventions/:id/merge - Fusionner deux demandes publiques
router.post('/:id/merge',
  requireAuth,
  [body('targetInterventionId').isUUID()],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const sourceId = req.params.id;
      const { targetInterventionId } = req.body;

      if (sourceId === targetInterventionId) {
        return res.status(400).json({ error: 'Impossible de fusionner une intervention avec elle-même.' });
      }

      const [source, target] = await Promise.all([
        prisma.intervention.findUnique({ where: { id: sourceId }, include: interventionInclude }),
        prisma.intervention.findUnique({ where: { id: targetInterventionId }, include: interventionInclude })
      ]);

      if (!source || !target) return res.status(404).json({ error: 'Intervention introuvable.' });
      if (source.source !== 'PUBLIC' || target.source !== 'PUBLIC') {
        return res.status(400).json({ error: 'Seules les demandes publiques peuvent être fusionnées.' });
      }
      if (source.mergedIntoId || target.mergedIntoId) {
        return res.status(400).json({ error: 'Une demande déjà fusionnée ne peut pas être utilisée ici.' });
      }
      if (req.user.role === 'TECH' && (source.techId !== req.user.id || target.techId !== req.user.id)) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      const sourcePhotos = Array.isArray(source.photos) ? source.photos : [];
      const targetPhotos = Array.isArray(target.photos) ? target.photos : [];
      const mergedPhotos = [...new Set([...targetPhotos, ...sourcePhotos])];
      const mergeNote = [
        target.notes || '',
        `--- Fusion de demande (${new Date().toLocaleString('fr-FR')}) ---`,
        `Demande fusionnée : ${source.title}`,
        source.description ? `Description : ${source.description}` : '',
        source.reporters?.length
          ? `Demandeurs : ${source.reporters.map(r => `${r.name || 'Sans nom'}${r.email ? ` <${r.email}>` : ''}`).join(', ')}`
          : ''
      ].filter(Boolean).join('\n');

      await prisma.$transaction([
        prisma.ticketMessage.updateMany({ where: { interventionId: sourceId }, data: { interventionId: targetInterventionId } }),
        prisma.order.updateMany({ where: { interventionId: sourceId }, data: { interventionId: targetInterventionId } }),
        prisma.stockMovement.updateMany({ where: { interventionId: sourceId }, data: { interventionId: targetInterventionId } }),
        prisma.interventionReporter.updateMany({ where: { interventionId: sourceId }, data: { interventionId: targetInterventionId } }),
        prisma.intervention.update({
          where: { id: targetInterventionId },
          data: {
            notes: mergeNote,
            photos: JSON.stringify(mergedPhotos),
            roomId: target.roomId || source.roomId,
            equipmentId: target.equipmentId || source.equipmentId,
            techId: target.techId || source.techId || null
          }
        }),
        prisma.intervention.update({
          where: { id: sourceId },
          data: { mergedIntoId: targetInterventionId, status: 'CLOSED', closedAt: new Date() }
        })
      ]);

      const merged = await prisma.intervention.findUnique({
        where: { id: targetInterventionId },
        include: interventionInclude
      });

      res.json({ message: 'Demandes fusionnées', intervention: parsePhotos(merged) });
    } catch (err) { next(err); }
  }
);

// GET /api/interventions/:id/messages — Messages d'une intervention (auth requise)
router.get('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      include: { reporters: true }
    });
    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    if (req.user.role === 'TECH' && intervention.techId !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Marquer les messages REPORTER non lus comme lus (le tech les consulte)
    await prisma.ticketMessage.updateMany({
      where: { interventionId: req.params.id, authorType: 'REPORTER', readAt: null },
      data: { readAt: new Date() }
    });

    const messages = await prisma.ticketMessage.findMany({
      where: { interventionId: req.params.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, content: true, authorType: true, authorName: true, createdAt: true,
                readAt: true, attachmentPath: true, attachmentName: true, attachmentMime: true, attachmentSize: true }
    });

    res.json(messages);
  } catch (err) { next(err); }
});

// POST /api/interventions/:id/messages — Envoyer un message tech
router.post('/:id/messages', requireAuth, (req, res, next) => {
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
      return res.status(400).json({ error: 'Le message doit contenir 2000 caractères max.' });
    }

    const intervention = await prisma.intervention.findUnique({ where: { id: req.params.id } });
    if (!intervention) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Intervention introuvable' });
    }
    if (req.user.role === 'TECH' && intervention.techId !== req.user.id) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const message = await prisma.ticketMessage.create({
      data: {
        interventionId: req.params.id,
        content,
        authorType: 'TECH',
        authorName: req.user.name,
        ...(req.file ? {
          attachmentPath: `ticket-messages/${req.file.filename}`,
          attachmentName: req.file.originalname,
          attachmentMime: req.file.mimetype,
          attachmentSize: req.file.size
        } : {})
      }
    });

    const reporterRecipients = [...new Map((intervention.reporters || [])
      .filter(r => r.email)
      .map(r => [String(r.email).toLowerCase(), { email: r.email, name: r.name, token: r.token }]))
      .values()];

    // Notification email à tous les demandeurs rattachés
    if (reporterRecipients.length > 0) {
      try {
        const { transporter, from } = createSmtpTransporter();
        if (transporter) {
          await Promise.all(reporterRecipients.map(recipient => {
            const ticketLink = `${config.appUrl}/ticket-status.html?token=${recipient.token}`;
            return transporter.sendMail({
              from,
              to: recipient.email,
              subject: `[Réponse] ${intervention.title} – MaintenanceBoard`,
              html: `
                <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
                  <h2 style="color:#1e293b;">Réponse de l'équipe technique</h2>
                  <p>Bonjour${recipient.name ? ' ' + recipient.name : ''},</p>
                  <p><strong>${req.user.name}</strong> a répondu à votre demande :</p>
                  <blockquote style="border-left:3px solid #3b82f6;padding-left:12px;color:#475569;">${content.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</blockquote>
                  <p style="margin-top:24px;">
                    <a href="${ticketLink}" style="background:#f97316;color:white;padding:10px 20px;text-decoration:none;border-radius:8px;font-weight:bold;">Voir ma demande</a>
                  </p>
                  <p style="color:#64748b;font-size:12px;margin-top:16px;">Lien direct : <a href="${ticketLink}">${ticketLink}</a></p>
                </div>
              `
            });
          }));
        }
      } catch (mailErr) {
        // Fail silently
      }
    }

    res.status(201).json(message);
  } catch (err) { next(err); }
});

// POST /api/interventions/:id/approve-room — Admin valide une suggestion de salle
router.post('/:id/approve-room', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({ where: { id: req.params.id } });
    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    if (!intervention.suggestedRoom) return res.status(400).json({ error: 'Aucune suggestion de salle en attente' });

    const room = await prisma.room.create({ data: { name: intervention.suggestedRoom } });
    const updated = await prisma.intervention.update({
      where: { id: req.params.id },
      data: { roomId: room.id, suggestedRoom: null },
      include: interventionInclude
    });
    res.json({ message: `Salle "${room.name}" créée et liée à l'intervention`, intervention: parsePhotos(updated) });
  } catch (err) { next(err); }
});

// POST /api/interventions/:id/approve-equipment — Admin valide une suggestion d'équipement
router.post('/:id/approve-equipment', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({ where: { id: req.params.id } });
    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    if (!intervention.suggestedEquipment) return res.status(400).json({ error: "Aucune suggestion d'équipement en attente" });

    const equipment = await prisma.equipment.create({ data: { name: intervention.suggestedEquipment, type: 'OTHER' } });
    const updated = await prisma.intervention.update({
      where: { id: req.params.id },
      data: { equipmentId: equipment.id, suggestedEquipment: null },
      include: interventionInclude
    });
    res.json({ message: `Équipement "${equipment.name}" créé et lié à l'intervention`, intervention: parsePhotos(updated) });
  } catch (err) { next(err); }
});

module.exports = router;
