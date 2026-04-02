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

const VALID_INTERVENTION_KINDS = ['STANDARD', 'CHECKUP'];
const VALID_CHECKUP_ITEM_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE'];

// SQLite stocke photos en JSON string — normaliser en tableau JS
function parseStringArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseChecklistTemplate(value) {
  const items = parseStringArray(value, []);
  return items
    .map((item, index) => {
      const label = typeof item === 'string'
        ? item.trim()
        : String(item?.label || '').trim();
      if (!label) return null;
      return {
        id: typeof item === 'object' && item?.id ? String(item.id) : `task-${index + 1}`,
        label
      };
    })
    .filter(Boolean);
}

function normalizeCheckupState(value, template = []) {
  const rawItems = parseStringArray(value, []);
  const rawById = new Map();
  rawItems.forEach(item => {
    const key = String(item?.id || item?.label || '').trim();
    if (key) rawById.set(key, !!item?.done);
  });

  return template.map(task => ({
    id: task.id,
    label: task.label,
    done: rawById.get(task.id) ?? rawById.get(task.label) ?? false
  }));
}

function serializeCheckupItem(item, template = []) {
  const checklistState = normalizeCheckupState(item?.checklistState, template);
  const status = VALID_CHECKUP_ITEM_STATUSES.includes(String(item?.status || ''))
    ? String(item.status)
    : (checklistState.every(entry => entry.done) && checklistState.length ? 'DONE' : 'PENDING');

  return {
    ...item,
    status,
    checklistState,
    equipmentLabel: item?.equipment
      ? `${item.equipment.name}${item.equipment.type ? ` (${item.equipment.type})` : ''}`
      : 'Équipement',
    roomLabel: item?.equipment?.room
      ? `${item.equipment.room.name}${item.equipment.room.number ? ` (${item.equipment.room.number})` : ''}`
      : 'Sans salle'
  };
}

function serializeIntervention(intervention, { includeCheckupItems = true } = {}) {
  if (!intervention) return intervention;
  const p = intervention.photos;
  const photos = Array.isArray(p) ? p : parseStringArray(p, []);
  const checkupTemplate = parseChecklistTemplate(intervention.checkupTemplate || '[]');
  const rawCheckupItems = Array.isArray(intervention.checkupItems) ? intervention.checkupItems : [];
  const checkupItems = rawCheckupItems.map(item => serializeCheckupItem(item, checkupTemplate));
  const summary = checkupItems.reduce((acc, item) => {
    acc.total += 1;
    if (item.status === 'DONE') acc.done += 1;
    else if (item.status === 'IN_PROGRESS') acc.inProgress += 1;
    else acc.pending += 1;
    return acc;
  }, { total: 0, done: 0, inProgress: 0, pending: 0 });

  return {
    ...intervention,
    photos: photos.map(photo => toInterventionPhotoUrl(intervention.id, photo)),
    kind: VALID_INTERVENTION_KINDS.includes(String(intervention.kind || '')) ? intervention.kind : 'STANDARD',
    checkupTemplate,
    checkupSummary: summary,
    ...(includeCheckupItems ? { checkupItems } : {})
  };
}

function inferCheckupItemStatus(checklistState, notes) {
  if (Array.isArray(checklistState) && checklistState.length > 0 && checklistState.every(entry => entry.done)) {
    return 'DONE';
  }
  if ((Array.isArray(checklistState) && checklistState.some(entry => entry.done)) || String(notes || '').trim()) {
    return 'IN_PROGRESS';
  }
  return 'PENDING';
}

function sortCheckupEquipment(items = []) {
  return [...items].sort((left, right) => {
    const leftBuilding = left.room?.building || '';
    const rightBuilding = right.room?.building || '';
    const leftRoom = left.room?.name || '';
    const rightRoom = right.room?.name || '';
    const leftType = left.type || '';
    const rightType = right.type || '';
    const leftName = left.name || '';
    const rightName = right.name || '';

    return leftBuilding.localeCompare(rightBuilding, 'fr')
      || leftRoom.localeCompare(rightRoom, 'fr')
      || leftType.localeCompare(rightType, 'fr')
      || leftName.localeCompare(rightName, 'fr');
  });
}

function buildCheckupEquipmentWhere({ search, building, roomId, type }) {
  const clauses = [{ status: { not: 'DECOMMISSIONED' } }];

  if (building) clauses.push({ room: { building: containsFilter(building) } });
  if (roomId) clauses.push({ roomId });
  if (type) clauses.push({ type: containsFilter(type) });
  if (search) {
    clauses.push({
      OR: [
        { name: containsFilter(search) },
        { type: containsFilter(search) },
        { brand: containsFilter(search) },
        { model: containsFilter(search) },
        { room: { name: containsFilter(search) } },
        { room: { number: containsFilter(search) } },
        { room: { building: containsFilter(search) } }
      ]
    });
  }

  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

function buildInterventionAccessClauses(user, techId) {
  if (user.role === 'TECH') {
    if (techId && techId !== user.id) {
      return [{ kind: 'CHECKUP' }, { techId: user.id }];
    }
    return [{ OR: [{ techId: user.id }, { kind: 'CHECKUP' }] }];
  }

  return techId ? [{ techId }] : [];
}

async function syncCheckupInterventionStatus(interventionId) {
  const items = await prisma.interventionCheckupItem.findMany({
    where: { interventionId },
    select: { status: true }
  });

  let nextStatus = 'OPEN';
  if (items.length > 0 && items.every(item => item.status === 'DONE')) {
    nextStatus = 'RESOLVED';
  } else if (items.some(item => item.status === 'DONE' || item.status === 'IN_PROGRESS')) {
    nextStatus = 'IN_PROGRESS';
  }

  const updated = await prisma.intervention.update({
    where: { id: interventionId },
    data: {
      status: nextStatus,
      closedAt: nextStatus === 'RESOLVED' ? new Date() : null
    },
    include: interventionDetailInclude
  });

  return serializeIntervention(updated);
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

const interventionListInclude = {
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
  },
  checkupItems: {
    select: { id: true, status: true, checklistState: true }
  }
};

const interventionDetailInclude = {
  ...interventionListInclude,
  checkupItems: {
    orderBy: [
      { equipment: { room: { building: 'asc' } } },
      { equipment: { room: { name: 'asc' } } },
      { equipment: { type: 'asc' } },
      { equipment: { name: 'asc' } }
    ],
    include: {
      equipment: {
        select: {
          id: true,
          name: true,
          type: true,
          brand: true,
          model: true,
          status: true,
          room: { select: { id: true, name: true, number: true, building: true } }
        }
      },
      checkedBy: { select: { id: true, name: true, email: true } }
    }
  }
};

function canAccessIntervention(user, intervention) {
  if (!intervention) return false;
  if (user.role !== 'TECH') return true;
  if (intervention.kind === 'CHECKUP') return true;
  return intervention.techId === user.id;
}

function toInterventionPhotoUrl(interventionId, rawPath) {
  if (!rawPath) return rawPath;
  const filename = path.basename(String(rawPath));
  return `/api/interventions/${interventionId}/photos/${encodeURIComponent(filename)}`;
}

function toInterventionAttachmentUrl(interventionId, rawPath) {
  if (!rawPath) return null;
  const filename = path.basename(String(rawPath));
  return `/api/interventions/${interventionId}/attachments/${encodeURIComponent(filename)}`;
}

function serializeInterventionMessage(message, interventionId) {
  const attachmentUrl = toInterventionAttachmentUrl(interventionId, message.attachmentPath);
  return {
    ...message,
    attachmentPath: attachmentUrl,
    attachmentUrl
  };
}

// GET /api/interventions - Liste avec filtres
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { status, priority, roomId, equipmentId, techId, dateFrom, dateTo, search, source } = req.query;

    const clauses = [{ mergedIntoId: null }];
    if (status) {
      const statuses = (Array.isArray(status) ? status : [status]).filter(value => VALID_STATUSES.includes(value));
      if (statuses.length === 1) clauses.push({ status: statuses[0] });
      else if (statuses.length > 1) clauses.push({ status: { in: statuses } });
    }
    if (priority && VALID_PRIORITIES.includes(priority)) clauses.push({ priority });
    if (roomId) clauses.push({ roomId });
    if (equipmentId) clauses.push({ equipmentId });
    clauses.push(...buildInterventionAccessClauses(req.user, techId));

    if (dateFrom || dateTo) {
      const createdAt = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) createdAt.lte = new Date(dateTo);
      clauses.push({ createdAt });
    }
    if (search) {
      clauses.push({
        OR: [
          { title: containsFilter(search) },
          { description: containsFilter(search) }
        ]
      });
    }
    if (source && ['INTERNAL', 'PUBLIC'].includes(source)) clauses.push({ source });

    const where = clauses.length === 1 ? clauses[0] : { AND: clauses };

    const [interventions, total] = await Promise.all([
      prisma.intervention.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: interventionListInclude
      }),
      prisma.intervention.count({ where })
    ]);

    res.json({
      data: interventions.map(item => serializeIntervention(item, { includeCheckupItems: false })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) { next(err); }
});

// GET /api/interventions/room/:roomId - Historique d'une salle
router.get('/room/:roomId', requireAuth, async (req, res, next) => {
  try {
    const where = {
      AND: [
        { roomId: req.params.roomId, mergedIntoId: null },
        ...buildInterventionAccessClauses(req.user)
      ]
    };
    const interventions = await prisma.intervention.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: interventionListInclude
    });
    res.json(interventions.map(item => serializeIntervention(item, { includeCheckupItems: false })));
  } catch (err) { next(err); }
});

// GET /api/interventions/equipment/:equipId - Historique d'un équipement
router.get('/equipment/:equipId', requireAuth, async (req, res, next) => {
  try {
    const where = {
      AND: [
        { equipmentId: req.params.equipId, mergedIntoId: null },
        ...buildInterventionAccessClauses(req.user)
      ]
    };
    const interventions = await prisma.intervention.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: interventionListInclude
    });
    res.json(interventions.map(item => serializeIntervention(item, { includeCheckupItems: false })));
  } catch (err) { next(err); }
});

router.get('/checkup/catalog', requireAuth, async (req, res, next) => {
  try {
    const equipment = await prisma.equipment.findMany({
      where: buildCheckupEquipmentWhere(req.query),
      orderBy: [
        { room: { building: 'asc' } },
        { room: { name: 'asc' } },
        { type: 'asc' },
        { name: 'asc' }
      ],
      select: {
        id: true,
        name: true,
        type: true,
        brand: true,
        model: true,
        status: true,
        roomId: true,
        room: { select: { id: true, name: true, number: true, building: true } }
      }
    });

    res.json(sortCheckupEquipment(equipment));
  } catch (err) { next(err); }
});

router.get('/:id/checkup/items', requireAuth, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        kind: true,
        techId: true,
        checkupTemplate: true
      }
    });

    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    if (intervention.kind !== 'CHECKUP') return res.status(400).json({ error: 'Cette intervention n est pas un checkup.' });
    if (!canAccessIntervention(req.user, intervention)) return res.status(403).json({ error: 'Accès refusé' });

    const template = parseChecklistTemplate(intervention.checkupTemplate || '[]');
    const where = {
      interventionId: intervention.id
    };
    const filters = [];

    if (req.query.status && VALID_CHECKUP_ITEM_STATUSES.includes(req.query.status)) {
      filters.push({ status: req.query.status });
    }
    if (req.query.building) filters.push({ equipment: { room: { building: containsFilter(req.query.building) } } });
    if (req.query.roomId) filters.push({ equipment: { roomId: req.query.roomId } });
    if (req.query.type) filters.push({ equipment: { type: containsFilter(req.query.type) } });
    if (req.query.search) {
      filters.push({
        OR: [
          { equipment: { name: containsFilter(req.query.search) } },
          { equipment: { type: containsFilter(req.query.search) } },
          { equipment: { brand: containsFilter(req.query.search) } },
          { equipment: { model: containsFilter(req.query.search) } },
          { equipment: { room: { name: containsFilter(req.query.search) } } },
          { equipment: { room: { number: containsFilter(req.query.search) } } },
          { equipment: { room: { building: containsFilter(req.query.search) } } }
        ]
      });
    }
    if (filters.length) where.AND = filters;

    const items = await prisma.interventionCheckupItem.findMany({
      where,
      orderBy: [
        { equipment: { room: { building: 'asc' } } },
        { equipment: { room: { name: 'asc' } } },
        { equipment: { type: 'asc' } },
        { equipment: { name: 'asc' } }
      ],
      include: {
        equipment: {
          select: {
            id: true,
            name: true,
            type: true,
            brand: true,
            model: true,
            status: true,
            roomId: true,
            room: { select: { id: true, name: true, number: true, building: true } }
          }
        },
        checkedBy: { select: { id: true, name: true, email: true } }
      }
    });

    res.json({
      template,
      items: items.map(item => serializeCheckupItem(item, template))
    });
  } catch (err) { next(err); }
});

router.patch('/:id/checkup/items/:itemId', requireAuth, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        kind: true,
        techId: true,
        checkupTemplate: true
      }
    });

    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    if (intervention.kind !== 'CHECKUP') return res.status(400).json({ error: 'Cette intervention n est pas un checkup.' });
    if (!canAccessIntervention(req.user, intervention)) return res.status(403).json({ error: 'Accès refusé' });

    const existingItem = await prisma.interventionCheckupItem.findUnique({
      where: { id: req.params.itemId },
      include: {
        equipment: {
          select: {
            id: true,
            name: true,
            type: true,
            brand: true,
            model: true,
            status: true,
            roomId: true,
            room: { select: { id: true, name: true, number: true, building: true } }
          }
        },
        checkedBy: { select: { id: true, name: true, email: true } }
      }
    });

    if (!existingItem || existingItem.interventionId !== intervention.id) {
      return res.status(404).json({ error: 'Équipement de checkup introuvable' });
    }

    const template = parseChecklistTemplate(intervention.checkupTemplate || '[]');
    const notes = req.body.notes !== undefined ? String(req.body.notes || '').trim() || null : existingItem.notes;
    const checklistState = req.body.checklistState !== undefined
      ? normalizeCheckupState(req.body.checklistState, template)
      : normalizeCheckupState(existingItem.checklistState, template);
    const status = inferCheckupItemStatus(checklistState, notes);

    const updated = await prisma.interventionCheckupItem.update({
      where: { id: existingItem.id },
      data: {
        notes,
        status,
        checklistState: JSON.stringify(checklistState),
        checkedAt: status === 'DONE' ? new Date() : null,
        checkedById: status === 'DONE' ? req.user.id : null
      },
      include: {
        equipment: {
          select: {
            id: true,
            name: true,
            type: true,
            brand: true,
            model: true,
            status: true,
            roomId: true,
            room: { select: { id: true, name: true, number: true, building: true } }
          }
        },
        checkedBy: { select: { id: true, name: true, email: true } }
      }
    });

    const parent = await syncCheckupInterventionStatus(intervention.id);

    res.json({
      item: serializeCheckupItem(updated, template),
      intervention: parent,
      summary: parent.checkupSummary
    });
  } catch (err) { next(err); }
});

// GET /api/interventions/:id - Détail
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      include: interventionDetailInclude
    });
    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    // TECH ne peut voir que ses propres interventions
    if (!canAccessIntervention(req.user, intervention)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    res.json(serializeIntervention(intervention));
  } catch (err) { next(err); }
});

// GET /api/interventions/:id/photos/:filename - Servir une photo avec auth
router.get('/:id/photos/:filename', requireAuth, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      select: { id: true, techId: true, kind: true, photos: true }
    });
    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    if (!canAccessIntervention(req.user, intervention)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const photos = parseStringArray(intervention.photos, []);
    const filename = path.basename(req.params.filename);
    const allowed = photos.some(photo => path.basename(String(photo)) === filename);
    if (!allowed) return res.status(404).json({ error: 'Photo introuvable' });

    const filePath = path.join(process.cwd(), 'uploads', 'photos', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Photo introuvable' });

    res.sendFile(filePath);
  } catch (err) { next(err); }
});

// POST /api/interventions - Créer
router.post('/',
  requireAuth,
  [
    body('title').trim().isLength({ min: 3, max: 300 }),
    body('kind').optional().isIn(VALID_INTERVENTION_KINDS),
    body('status').optional().isIn(VALID_STATUSES),
    body('priority').optional().isIn(VALID_PRIORITIES),
    body('roomId').optional({ nullable: true }).isUUID(),
    body('equipmentId').optional({ nullable: true }).isUUID(),
    body('scheduledStartAt').optional({ nullable: true }).isISO8601(),
    body('scheduledEndAt').optional({ nullable: true }).isISO8601(),
    body('dueAt').optional({ nullable: true }).isISO8601()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const {
        title,
        description,
        notes,
        kind,
        status,
        priority,
        roomId,
        equipmentId,
        techId,
        suggestedRoom,
        suggestedEquipment,
        scheduledStartAt,
        scheduledEndAt,
        dueAt
      } = req.body;
      const interventionKind = VALID_INTERVENTION_KINDS.includes(kind) ? kind : 'STANDARD';

      if (scheduledStartAt && scheduledEndAt && new Date(scheduledEndAt) < new Date(scheduledStartAt)) {
        return res.status(400).json({ error: "La fin d'intervention doit être postérieure au début." });
      }

      if (interventionKind === 'CHECKUP') {
        const checkupTemplate = parseChecklistTemplate(req.body.checkupTemplate || []);
        const requestedEquipmentIds = [...new Set(
          (Array.isArray(req.body.checkupEquipmentIds) ? req.body.checkupEquipmentIds : [req.body.checkupEquipmentIds])
            .filter(Boolean)
            .map(value => String(value))
        )];

        if (!checkupTemplate.length) {
          return res.status(400).json({ error: 'Définissez au moins une action à vérifier pour le checkup.' });
        }
        if (!requestedEquipmentIds.length) {
          return res.status(400).json({ error: 'Sélectionnez au moins un équipement pour le checkup.' });
        }

        const equipmentList = sortCheckupEquipment(await prisma.equipment.findMany({
          where: {
            id: { in: requestedEquipmentIds },
            status: { not: 'DECOMMISSIONED' }
          },
          select: {
            id: true,
            name: true,
            type: true,
            room: { select: { id: true, name: true, number: true, building: true } }
          }
        }));

        if (equipmentList.length !== requestedEquipmentIds.length) {
          return res.status(400).json({ error: 'Au moins un équipement sélectionné est introuvable ou indisponible.' });
        }

        const intervention = await prisma.intervention.create({
          data: {
            title,
            description: description || null,
            notes: notes || null,
            kind: 'CHECKUP',
            status: status || 'OPEN',
            priority: priority || 'NORMAL',
            techId: null,
            scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
            scheduledEndAt: scheduledEndAt ? new Date(scheduledEndAt) : null,
            dueAt: dueAt ? new Date(dueAt) : null,
            checkupTemplate: JSON.stringify(checkupTemplate),
            checkupItems: {
              create: equipmentList.map((equipment, index) => ({
                equipmentId: equipment.id,
                orderIndex: index,
                checklistState: JSON.stringify(checkupTemplate.map(task => ({
                  id: task.id,
                  label: task.label,
                  done: false
                })))
              }))
            }
          },
          include: interventionDetailInclude
        });

        return res.status(201).json(serializeIntervention(intervention));
      }

      // TECH peut seulement créer pour lui-même
      const assignedTechId = req.user.role === 'ADMIN' && techId ? techId : req.user.id;

      const intervention = await prisma.intervention.create({
        data: {
          title,
          description: description || null,
          notes: notes || null,
          kind: 'STANDARD',
          status: status || 'OPEN',
          priority: priority || 'NORMAL',
          roomId: roomId || null,
          equipmentId: equipmentId || null,
          techId: assignedTechId,
          scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
          scheduledEndAt: scheduledEndAt ? new Date(scheduledEndAt) : null,
          dueAt: dueAt ? new Date(dueAt) : null,
          suggestedRoom: (!roomId && suggestedRoom) ? String(suggestedRoom).trim() || null : null,
          suggestedEquipment: (!equipmentId && suggestedEquipment) ? String(suggestedEquipment).trim() || null : null
        },
        include: interventionDetailInclude
      });

      // Mettre l'équipement en REPAIR si intervention ouverte
      if (equipmentId && (!status || status === 'OPEN' || status === 'IN_PROGRESS')) {
        await prisma.equipment.updateMany({
          where: { id: equipmentId, status: 'ACTIVE' },
          data: { status: 'REPAIR' }
        });
      }

      res.status(201).json(serializeIntervention(intervention));
    } catch (err) { next(err); }
  }
);

// PATCH /api/interventions/:id - Modifier statut/description
router.patch('/:id',
  requireAuth,
  [
    body('status').optional().isIn(VALID_STATUSES),
    body('priority').optional().isIn(VALID_PRIORITIES),
    body('scheduledStartAt').optional({ nullable: true }).isISO8601(),
    body('scheduledEndAt').optional({ nullable: true }).isISO8601(),
    body('dueAt').optional({ nullable: true }).isISO8601()
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const existing = await prisma.intervention.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Intervention introuvable' });
      if (!canAccessIntervention(req.user, existing)) {
        return res.status(403).json({ error: 'Accès refusé' });
      }

      const {
        title,
        description,
        notes,
        status,
        priority,
        resolution,
        roomId,
        equipmentId,
        suggestedRoom,
        suggestedEquipment,
        scheduledStartAt,
        scheduledEndAt,
        dueAt
      } = req.body;
      const effectiveStart = scheduledStartAt !== undefined ? (scheduledStartAt ? new Date(scheduledStartAt) : null) : existing.scheduledStartAt;
      const effectiveEnd = scheduledEndAt !== undefined ? (scheduledEndAt ? new Date(scheduledEndAt) : null) : existing.scheduledEndAt;
      if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
        return res.status(400).json({ error: "La fin d'intervention doit être postérieure au début." });
      }
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
      if (scheduledStartAt !== undefined) data.scheduledStartAt = scheduledStartAt ? new Date(scheduledStartAt) : null;
      if (scheduledEndAt !== undefined) data.scheduledEndAt = scheduledEndAt ? new Date(scheduledEndAt) : null;
      if (dueAt !== undefined) data.dueAt = dueAt ? new Date(dueAt) : null;

      const intervention = await prisma.intervention.update({
        where: { id: req.params.id },
        data,
        include: interventionDetailInclude
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

      res.json(serializeIntervention(intervention));
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

      const photoPaths = req.files.map(f => `photos/${f.filename}`);
      const current = parseStringArray(existing.photos, []);
      const merged = [...current, ...photoPaths];
      const intervention = await prisma.intervention.update({
        where: { id: req.params.id },
        data: { photos: JSON.stringify(merged) },
        include: interventionDetailInclude
      });

      res.json({ message: `${req.files.length} photo(s) ajoutée(s)`, intervention: serializeIntervention(intervention) });
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
        prisma.intervention.findUnique({ where: { id: sourceId }, include: interventionDetailInclude }),
        prisma.intervention.findUnique({ where: { id: targetInterventionId }, include: interventionDetailInclude })
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
        include: interventionDetailInclude
      });

      res.json({ message: 'Demandes fusionnées', intervention: serializeIntervention(merged) });
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
    if (!canAccessIntervention(req.user, intervention)) {
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

    res.json(messages.map(message => serializeInterventionMessage(message, intervention.id)));
  } catch (err) { next(err); }
});

// GET /api/interventions/:id/attachments/:filename — Pièce jointe de conversation côté support
router.get('/:id/attachments/:filename', requireAuth, async (req, res, next) => {
  try {
    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      select: { id: true, techId: true }
    });
    if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    if (!canAccessIntervention(req.user, intervention)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const filename = path.basename(req.params.filename);
    const attachmentPath = `ticket-messages/${filename}`;
    const message = await prisma.ticketMessage.findFirst({
      where: { interventionId: intervention.id, attachmentPath },
      select: { attachmentName: true, attachmentMime: true }
    });
    if (!message) return res.status(404).json({ error: 'Pièce jointe introuvable' });

    const filePath = path.join(process.cwd(), 'uploads', 'ticket-messages', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Pièce jointe introuvable' });

    res.setHeader('Content-Type', message.attachmentMime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(message.attachmentName || filename)}"`);
    res.sendFile(filePath);
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

    const intervention = await prisma.intervention.findUnique({
      where: { id: req.params.id },
      include: { reporters: true }
    });
    if (!intervention) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Intervention introuvable' });
    }
    if (!canAccessIntervention(req.user, intervention)) {
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

    res.status(201).json(serializeInterventionMessage(message, req.params.id));
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
      include: interventionDetailInclude
    });
    res.json({ message: `Salle "${room.name}" créée et liée à l'intervention`, intervention: serializeIntervention(updated) });
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
      include: interventionDetailInclude
    });
    res.json({ message: `Équipement "${equipment.name}" créé et lié à l'intervention`, intervention: serializeIntervention(updated) });
  } catch (err) { next(err); }
});

module.exports = router;
