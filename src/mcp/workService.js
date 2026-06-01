const prisma = require('../lib/prisma');
const { containsFilter, isSQLite } = require('../lib/db-utils');
const { applyMigration } = require('../services/ipMigrationService');

const INTERVENTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const INTERVENTION_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const CARD_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const ORDER_STATUSES = ['PENDING', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED'];
const ORDER_PRICE_TYPES = ['TTC', 'HT'];
const STOCK_MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUSTMENT'];

const INTERVENTION_INCLUDE = {
  room: { select: { id: true, name: true, number: true, building: true } },
  equipment: { select: { id: true, name: true, type: true, brand: true, model: true } },
  tech: { select: { id: true, name: true, email: true } },
  orders: {
    select: {
      id: true,
      title: true,
      status: true,
      supplier: true,
      totalAmount: true,
      expectedDeliveryAt: true,
      receivedAt: true
    },
    orderBy: { createdAt: 'desc' }
  },
  _count: { select: { todos: true, messages: true, orders: true } }
};

const TODO_INCLUDE = {
  intervention: {
    select: { id: true, title: true, status: true, priority: true }
  }
};

const CARD_INCLUDE = {
  assignee: { select: { id: true, name: true, email: true } },
  column: { select: { id: true, title: true } }
};

const PROJECT_FULL_INCLUDE = {
  creator: { select: { id: true, name: true, email: true } },
  columns: {
    orderBy: { position: 'asc' },
    include: {
      cards: {
        orderBy: { position: 'asc' },
        include: { assignee: { select: { id: true, name: true, email: true } } }
      }
    }
  }
};

const ORDER_INCLUDE = {
  requester: { select: { id: true, name: true, email: true } },
  intervention: {
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      techId: true,
      room: { select: { id: true, name: true, number: true } },
      equipment: { select: { id: true, name: true, type: true } }
    }
  },
  supplierRef: { select: { id: true, name: true } },
  items: { orderBy: { createdAt: 'asc' } }
};

const STOCK_ITEM_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  _count: { select: { movements: true } }
};

const STOCK_MOVEMENT_INCLUDE = {
  user: { select: { id: true, name: true, email: true } },
  intervention: { select: { id: true, title: true, status: true } },
  stockItem: { select: { id: true, name: true, reference: true, quantity: true } }
};

function badRequest(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function notFound(message) {
  throw Object.assign(new Error(message), { status: 404 });
}

function ensureEnum(value, allowed, label) {
  if (value !== undefined && !allowed.includes(value)) {
    badRequest(`${label} invalide. Valeurs acceptées : ${allowed.join(', ')}.`);
  }
}

function parseOptionalDate(value, label) {
  if (value === undefined) return undefined;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) badRequest(`${label} invalide (format ISO 8601 attendu).`);
  return date;
}

function cleanString(value, { max, min = 0, label }) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim();
  if (text.length < min) badRequest(`${label} doit contenir au moins ${min} caractère(s).`);
  if (max && text.length > max) badRequest(`${label} doit contenir ${max} caractères maximum.`);
  return text;
}

function nullableText(value, max, label) {
  if (value === undefined) return undefined;
  const text = String(value || '').trim();
  if (max && text.length > max) badRequest(`${label} doit contenir ${max} caractères maximum.`);
  return text || null;
}

function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function serializeTags(tags) {
  if (!Array.isArray(tags)) return isSQLite ? '[]' : [];
  const clean = [...new Set(tags.map(t => String(t || '').trim()).filter(Boolean))];
  return isSQLite ? JSON.stringify(clean) : clean;
}

function numberOrNull(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const number = Number(value);
  if (Number.isNaN(number) || number < 0) badRequest(`${label} doit être un nombre positif.`);
  return number;
}

function interventionAccessWhere(user, requestedTechId) {
  if (user?.role !== 'TECH') return requestedTechId ? { techId: requestedTechId } : null;
  if (requestedTechId && requestedTechId !== user.id) {
    return { OR: [{ techId: user.id }, { kind: 'CHECKUP' }] };
  }
  return { OR: [{ techId: user.id }, { kind: 'CHECKUP' }] };
}

function canAccessIntervention(user, intervention) {
  if (!intervention || user?.role !== 'TECH') return !!intervention;
  return intervention.techId === user.id || intervention.kind === 'CHECKUP';
}

async function ensureInterventionLinkAllowed(interventionId, user) {
  if (!interventionId || user?.role !== 'TECH') return;
  const intervention = await prisma.intervention.findUnique({
    where: { id: interventionId },
    select: { id: true, techId: true, kind: true }
  });
  if (!intervention) notFound('Intervention introuvable');
  if (!canAccessIntervention(user, intervention)) {
    throw Object.assign(new Error('Accès refusé pour cette intervention'), { status: 403 });
  }
}

function mapIntervention(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description || null,
    notes: item.notes || null,
    status: item.status,
    priority: item.priority,
    kind: item.kind,
    source: item.source,
    room: item.room || null,
    equipment: item.equipment || null,
    tech: item.tech || null,
    scheduledStartAt: item.scheduledStartAt || null,
    scheduledEndAt: item.scheduledEndAt || null,
    dueAt: item.dueAt || null,
    closedAt: item.closedAt || null,
    archivedAt: item.archivedAt || null,
    orders: item.orders || undefined,
    counts: item._count || undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function mapOrder(order) {
  return {
    id: order.id,
    title: order.title,
    description: order.description || null,
    status: order.status,
    supplier: order.supplier || null,
    supplierRef: order.supplierRef || null,
    totalAmount: order.totalAmount ?? null,
    deploymentTags: parseTags(order.deploymentTags),
    requester: order.requester || null,
    interventionId: order.interventionId || null,
    intervention: order.intervention || null,
    orderedAt: order.orderedAt || null,
    expectedDeliveryAt: order.expectedDeliveryAt || null,
    receivedAt: order.receivedAt || null,
    trackingNotes: order.trackingNotes || null,
    archivedAt: order.archivedAt || null,
    items: order.items || undefined,
    counts: order._count || undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function mapStockItem(item) {
  return {
    id: item.id,
    name: item.name,
    reference: item.reference || null,
    barcode: item.barcode || null,
    category: item.category || null,
    description: item.description || null,
    quantity: item.quantity,
    minQuantity: item.minQuantity,
    lowStock: item.quantity <= item.minQuantity,
    unitCost: item.unitCost ?? null,
    location: item.location || null,
    supplier: item.supplier || null,
    counts: item._count || undefined,
    movements: item.movements || undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function mapTodo(todo) {
  return {
    id: todo.id,
    title: todo.title,
    description: todo.description || null,
    done: !!todo.done,
    doneAt: todo.doneAt || null,
    dueAt: todo.dueAt || null,
    interventionId: todo.interventionId || null,
    intervention: todo.intervention || null,
    createdAt: todo.createdAt
  };
}

function mapProject(project) {
  return {
    id: project.id,
    title: project.title,
    description: project.description || null,
    color: project.color,
    creator: project.creator || null,
    counts: project._count || undefined,
    columns: project.columns || undefined,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

async function listInterventions({ status, priority, search, roomId, equipmentId, techId, archived = false, limit = 20 } = {}, { user } = {}) {
  ensureEnum(status, INTERVENTION_STATUSES, 'Statut');
  ensureEnum(priority, INTERVENTION_PRIORITIES, 'Priorité');

  const clauses = [{ mergedIntoId: null }];
  clauses.push(archived ? { archivedAt: { not: null } } : { archivedAt: null });
  if (status) clauses.push({ status });
  if (priority) clauses.push({ priority });
  if (roomId) clauses.push({ roomId });
  if (equipmentId) clauses.push({ equipmentId });
  const accessWhere = interventionAccessWhere(user, techId);
  if (accessWhere) clauses.push(accessWhere);
  else if (techId) clauses.push({ techId });
  if (search) {
    clauses.push({
      OR: [
        { title: containsFilter(search) },
        { description: containsFilter(search) },
        { notes: containsFilter(search) }
      ]
    });
  }

  const take = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const where = clauses.length === 1 ? clauses[0] : { AND: clauses };
  const items = await prisma.intervention.findMany({
    where,
    take,
    orderBy: { createdAt: 'desc' },
    include: INTERVENTION_INCLUDE
  });
  return items.map(mapIntervention);
}

async function getIntervention({ id }, { user } = {}) {
  const item = await prisma.intervention.findUnique({
    where: { id },
    include: INTERVENTION_INCLUDE
  });
  if (!canAccessIntervention(user, item)) notFound('Intervention introuvable');
  return mapIntervention(item);
}

async function createIntervention(input, { userId, user } = {}) {
  const title = cleanString(input.title, { min: 3, max: 300, label: 'Le titre' });
  ensureEnum(input.status, INTERVENTION_STATUSES, 'Statut');
  ensureEnum(input.priority, INTERVENTION_PRIORITIES, 'Priorité');
  const scheduledStartAt = parseOptionalDate(input.scheduledStartAt, 'Date de début planifiée');
  const scheduledEndAt = parseOptionalDate(input.scheduledEndAt, 'Date de fin planifiée');
  if (scheduledStartAt && scheduledEndAt && scheduledEndAt < scheduledStartAt) {
    badRequest("La fin d'intervention doit être postérieure au début.");
  }

  const item = await prisma.intervention.create({
    data: {
      title,
      description: nullableText(input.description, 2000, 'La description'),
      notes: nullableText(input.notes, 5000, 'Les notes'),
      kind: 'STANDARD',
      status: input.status || 'OPEN',
      priority: input.priority || 'NORMAL',
      roomId: input.roomId || null,
      equipmentId: input.equipmentId || null,
      techId: user?.role === 'TECH' ? user.id : (input.techId || userId || null),
      scheduledStartAt: scheduledStartAt === undefined ? null : scheduledStartAt,
      scheduledEndAt: scheduledEndAt === undefined ? null : scheduledEndAt,
      dueAt: parseOptionalDate(input.dueAt, "Date d'échéance") ?? null,
      suggestedRoom: input.roomId ? null : nullableText(input.suggestedRoom, 200, 'La salle suggérée'),
      suggestedEquipment: input.equipmentId ? null : nullableText(input.suggestedEquipment, 200, "L'équipement suggéré")
    },
    include: INTERVENTION_INCLUDE
  });

  if (input.equipmentId && (!input.status || ['OPEN', 'IN_PROGRESS'].includes(input.status))) {
    await prisma.equipment.updateMany({
      where: { id: input.equipmentId, status: 'ACTIVE' },
      data: { status: 'REPAIR' }
    });
  }

  return mapIntervention(item);
}

async function updateIntervention({ id, ...input }, { user } = {}) {
  const existing = await prisma.intervention.findUnique({ where: { id } });
  if (!canAccessIntervention(user, existing)) notFound('Intervention introuvable');
  ensureEnum(input.status, INTERVENTION_STATUSES, 'Statut');
  ensureEnum(input.priority, INTERVENTION_PRIORITIES, 'Priorité');

  const scheduledStartAt = parseOptionalDate(input.scheduledStartAt, 'Date de début planifiée');
  const scheduledEndAt = parseOptionalDate(input.scheduledEndAt, 'Date de fin planifiée');
  const effectiveStart = scheduledStartAt !== undefined ? scheduledStartAt : existing.scheduledStartAt;
  const effectiveEnd = scheduledEndAt !== undefined ? scheduledEndAt : existing.scheduledEndAt;
  if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
    badRequest("La fin d'intervention doit être postérieure au début.");
  }

  const data = {};
  if (input.title !== undefined) data.title = cleanString(input.title, { min: 3, max: 300, label: 'Le titre' });
  if (input.description !== undefined) data.description = nullableText(input.description, 2000, 'La description');
  if (input.notes !== undefined) data.notes = nullableText(input.notes, 5000, 'Les notes');
  if (input.status !== undefined) {
    data.status = input.status;
    data.closedAt = ['RESOLVED', 'CLOSED'].includes(input.status) ? new Date() : null;
  }
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.resolution !== undefined) data.resolution = nullableText(input.resolution, 5000, 'La résolution');
  if (input.roomId !== undefined) data.roomId = input.roomId || null;
  if (input.equipmentId !== undefined) data.equipmentId = input.equipmentId || null;
  if (scheduledStartAt !== undefined) data.scheduledStartAt = scheduledStartAt;
  if (scheduledEndAt !== undefined) data.scheduledEndAt = scheduledEndAt;
  if (input.dueAt !== undefined) data.dueAt = parseOptionalDate(input.dueAt, "Date d'échéance");

  const item = await prisma.intervention.update({
    where: { id },
    data,
    include: INTERVENTION_INCLUDE
  });

  if (['RESOLVED', 'CLOSED'].includes(input.status) && existing.equipmentId) {
    await prisma.equipment.updateMany({
      where: { id: existing.equipmentId, status: 'REPAIR' },
      data: { status: 'ACTIVE' }
    });
  }

  return mapIntervention(item);
}

async function listTodos({ done, overdue, interventionId, limit = 100 } = {}) {
  const where = {};
  if (typeof done === 'boolean') where.done = done;
  if (overdue) {
    where.done = false;
    where.dueAt = { not: null, lt: new Date() };
  }
  if (interventionId) where.interventionId = interventionId;

  const items = await prisma.todo.findMany({
    where,
    take: Math.min(200, Math.max(1, parseInt(limit, 10) || 100)),
    orderBy: [{ done: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    include: TODO_INCLUDE
  });
  return items.map(mapTodo);
}

async function createTodo(input) {
  const interventionId = input.interventionId || null;
  if (interventionId) {
    const intervention = await prisma.intervention.findUnique({ where: { id: interventionId }, select: { id: true } });
    if (!intervention) notFound('Intervention introuvable');
  }

  const todo = await prisma.todo.create({
    data: {
      interventionId,
      title: cleanString(input.title, { min: 1, max: 500, label: 'Le titre' }),
      description: nullableText(input.description, 2000, 'La description'),
      dueAt: parseOptionalDate(input.dueAt, "Date d'échéance") ?? null
    },
    include: TODO_INCLUDE
  });
  return mapTodo(todo);
}

async function updateTodo({ id, ...input }) {
  const existing = await prisma.todo.findUnique({ where: { id } });
  if (!existing) notFound('Tâche introuvable');

  const data = {};
  if (typeof input.done === 'boolean') {
    data.done = input.done;
    data.doneAt = input.done ? new Date() : null;
  }
  if (input.title !== undefined) data.title = cleanString(input.title, { min: 1, max: 500, label: 'Le titre' });
  if (input.description !== undefined) data.description = nullableText(input.description, 2000, 'La description');
  if (input.dueAt !== undefined) data.dueAt = parseOptionalDate(input.dueAt, "Date d'échéance");
  if (input.interventionId !== undefined) data.interventionId = input.interventionId || null;

  const todo = await prisma.todo.update({ where: { id }, data, include: TODO_INCLUDE });
  return mapTodo(todo);
}

async function listProjects({ limit = 50 } = {}) {
  const projects = await prisma.project.findMany({
    take: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
    orderBy: { createdAt: 'desc' },
    include: {
      creator: { select: { id: true, name: true, email: true } },
      _count: { select: { columns: true } }
    }
  });
  return projects.map(mapProject);
}

async function getProject({ id }) {
  const project = await prisma.project.findUnique({ where: { id }, include: PROJECT_FULL_INCLUDE });
  if (!project) notFound('Projet introuvable');
  return mapProject(project);
}

async function createProject(input, { userId } = {}) {
  const project = await prisma.project.create({
    data: {
      title: cleanString(input.title, { min: 1, max: 200, label: 'Le titre' }),
      description: nullableText(input.description, 1000, 'La description'),
      color: input.color || '#3b82f6',
      createdBy: userId || input.createdBy
    },
    include: PROJECT_FULL_INCLUDE
  });
  return mapProject(project);
}

async function updateProject({ id, ...input }) {
  const existing = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!existing) notFound('Projet introuvable');

  const data = {};
  if (input.title !== undefined) data.title = cleanString(input.title, { min: 1, max: 200, label: 'Le titre' });
  if (input.description !== undefined) data.description = nullableText(input.description, 1000, 'La description');
  if (input.color !== undefined) data.color = input.color || '#3b82f6';

  const project = await prisma.project.update({ where: { id }, data, include: PROJECT_FULL_INCLUDE });
  return mapProject(project);
}

async function createProjectColumn({ projectId, title, color }) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) notFound('Projet introuvable');
  const last = await prisma.kanbanColumn.findFirst({
    where: { projectId },
    orderBy: { position: 'desc' }
  });
  return prisma.kanbanColumn.create({
    data: {
      projectId,
      title: cleanString(title, { min: 1, max: 100, label: 'Le titre' }),
      color: color || '#6b7280',
      position: (last?.position ?? -1) + 1
    },
    include: { cards: { include: { assignee: { select: { id: true, name: true, email: true } } } } }
  });
}

async function updateProjectColumn({ projectId, columnId, title, color }) {
  const column = await prisma.kanbanColumn.findFirst({
    where: { id: columnId, projectId }
  });
  if (!column) notFound('Colonne introuvable');

  const data = {};
  if (title !== undefined) data.title = cleanString(title, { min: 1, max: 100, label: 'Le titre' });
  if (color !== undefined) data.color = color || '#6b7280';

  return prisma.kanbanColumn.update({
    where: { id: columnId },
    data,
    include: { cards: { orderBy: { position: 'asc' }, include: { assignee: { select: { id: true, name: true, email: true } } } } }
  });
}

async function createProjectCard(input) {
  ensureEnum(input.priority, CARD_PRIORITIES, 'Priorité');
  const column = await prisma.kanbanColumn.findFirst({
    where: { id: input.columnId, projectId: input.projectId }
  });
  if (!column) notFound('Colonne introuvable');
  const last = await prisma.kanbanCard.findFirst({
    where: { columnId: input.columnId },
    orderBy: { position: 'desc' }
  });
  return prisma.kanbanCard.create({
    data: {
      columnId: input.columnId,
      projectId: input.projectId,
      title: cleanString(input.title, { min: 1, max: 300, label: 'Le titre' }),
      description: nullableText(input.description, 2000, 'La description'),
      priority: input.priority || 'NORMAL',
      dueDate: parseOptionalDate(input.dueDate, "Date d'échéance") ?? null,
      assigneeId: input.assigneeId || null,
      position: (last?.position ?? -1) + 1
    },
    include: CARD_INCLUDE
  });
}

async function updateProjectCard({ projectId, cardId, ...input }) {
  const card = await prisma.kanbanCard.findFirst({ where: { id: cardId, projectId } });
  if (!card) notFound('Carte introuvable');
  ensureEnum(input.priority, CARD_PRIORITIES, 'Priorité');

  const data = {};
  if (input.title !== undefined) data.title = cleanString(input.title, { min: 1, max: 300, label: 'Le titre' });
  if (input.description !== undefined) data.description = nullableText(input.description, 2000, 'La description');
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.dueDate !== undefined) data.dueDate = parseOptionalDate(input.dueDate, "Date d'échéance");
  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId || null;
  if (input.note !== undefined) data.note = nullableText(input.note, 100000, 'La note');
  if (input.columnId !== undefined) {
    const column = await prisma.kanbanColumn.findFirst({ where: { id: input.columnId, projectId } });
    if (!column) notFound('Colonne cible introuvable');
    data.columnId = input.columnId;
  }

  return prisma.kanbanCard.update({ where: { id: cardId }, data, include: CARD_INCLUDE });
}

function toOrderItemData(item) {
  ensureEnum(item.priceType, ORDER_PRICE_TYPES, 'Type de prix');
  return {
    name: cleanString(item.name, { min: 1, max: 300, label: 'Le nom de ligne' }),
    quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
    unitPrice: numberOrNull(item.unitPrice, 'Le prix unitaire') ?? null,
    priceType: item.priceType || 'TTC',
    reference: nullableText(item.reference, 200, 'La référence'),
    productUrl: nullableText(item.productUrl, 1000, "L'URL produit"),
    notes: nullableText(item.notes, 1000, 'Les notes de ligne')
  };
}

async function listOrders({ status, search, interventionId, archived = false, limit = 20 } = {}, { user } = {}) {
  ensureEnum(status, ORDER_STATUSES, 'Statut');
  const where = { archivedAt: archived ? { not: null } : null };
  if (status) where.status = status;
  if (interventionId) where.interventionId = interventionId;
  if (search) {
    where.OR = [
      { title: containsFilter(search) },
      { supplier: containsFilter(search) },
      { trackingNotes: containsFilter(search) }
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    take: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
    orderBy: { createdAt: 'desc' },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      intervention: ORDER_INCLUDE.intervention,
      supplierRef: ORDER_INCLUDE.supplierRef,
      _count: { select: { items: true } }
    }
  });
  return orders.map(order => {
    if (user?.role === 'TECH' && order.intervention?.techId && order.intervention.techId !== user.id) {
      return mapOrder({ ...order, intervention: null });
    }
    return mapOrder(order);
  });
}

async function getOrder({ id }, { user } = {}) {
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) notFound('Commande introuvable');
  if (user?.role === 'TECH' && order.intervention?.techId && order.intervention.techId !== user.id) {
    return mapOrder({ ...order, intervention: null });
  }
  return mapOrder(order);
}

async function createOrder(input, { userId, user } = {}) {
  if (!userId) badRequest('Utilisateur créateur introuvable pour créer une commande.');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    badRequest('La commande doit contenir au moins une ligne.');
  }
  ensureEnum(input.status, ORDER_STATUSES, 'Statut');
  await ensureInterventionLinkAllowed(input.interventionId, user);

  const order = await prisma.order.create({
    data: {
      title: cleanString(input.title, { min: 3, max: 300, label: 'Le titre' }),
      description: nullableText(input.description, 2000, 'La description'),
      status: input.status || 'PENDING',
      supplier: nullableText(input.supplier, 200, 'Le fournisseur'),
      supplierId: input.supplierId || null,
      totalAmount: numberOrNull(input.totalAmount, 'Le montant total') ?? null,
      deploymentTags: serializeTags(input.deploymentTags || []),
      requestedBy: userId,
      interventionId: input.interventionId || null,
      orderedAt: parseOptionalDate(input.orderedAt, 'Date de commande') ?? null,
      expectedDeliveryAt: parseOptionalDate(input.expectedDeliveryAt, 'Date de livraison prévue') ?? null,
      receivedAt: parseOptionalDate(input.receivedAt, 'Date de réception') ?? null,
      trackingNotes: nullableText(input.trackingNotes, 2000, 'Les notes de suivi'),
      items: { create: input.items.map(toOrderItemData) }
    },
    include: ORDER_INCLUDE
  });
  return mapOrder(order);
}

async function updateOrder({ id, ...input }, { user } = {}) {
  const existing = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!existing) notFound('Commande introuvable');
  ensureEnum(input.status, ORDER_STATUSES, 'Statut');
  if (input.items !== undefined && (!Array.isArray(input.items) || input.items.length === 0)) {
    badRequest('La commande doit contenir au moins une ligne.');
  }
  await ensureInterventionLinkAllowed(input.interventionId, user);

  const data = {};
  if (input.title !== undefined) data.title = cleanString(input.title, { min: 3, max: 300, label: 'Le titre' });
  if (input.description !== undefined) data.description = nullableText(input.description, 2000, 'La description');
  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === 'ORDERED' && input.orderedAt === undefined) data.orderedAt = new Date();
    if (input.status === 'RECEIVED' && input.receivedAt === undefined) data.receivedAt = new Date();
  }
  if (input.supplier !== undefined) data.supplier = nullableText(input.supplier, 200, 'Le fournisseur');
  if (input.supplierId !== undefined) data.supplierId = input.supplierId || null;
  if (input.totalAmount !== undefined) data.totalAmount = numberOrNull(input.totalAmount, 'Le montant total');
  if (input.deploymentTags !== undefined) data.deploymentTags = serializeTags(input.deploymentTags);
  if (input.interventionId !== undefined) data.interventionId = input.interventionId || null;
  if (input.orderedAt !== undefined) data.orderedAt = parseOptionalDate(input.orderedAt, 'Date de commande');
  if (input.expectedDeliveryAt !== undefined) data.expectedDeliveryAt = parseOptionalDate(input.expectedDeliveryAt, 'Date de livraison prévue');
  if (input.receivedAt !== undefined) data.receivedAt = parseOptionalDate(input.receivedAt, 'Date de réception');
  if (input.trackingNotes !== undefined) data.trackingNotes = nullableText(input.trackingNotes, 2000, 'Les notes de suivi');
  if (input.archived !== undefined) data.archivedAt = input.archived ? new Date() : null;
  if (input.items !== undefined) data.items = { deleteMany: {}, create: input.items.map(toOrderItemData) };

  const order = await prisma.order.update({ where: { id }, data, include: ORDER_INCLUDE });
  return mapOrder(order);
}

async function listStockItems({ q, category, lowStock = false, limit = 100 } = {}) {
  const where = {};
  if (q) {
    where.OR = [
      { name: containsFilter(q) },
      { reference: containsFilter(q) },
      { barcode: containsFilter(q) },
      { category: containsFilter(q) }
    ];
  }
  if (category) where.category = category;

  const items = await prisma.stockItem.findMany({
    where,
    take: Math.min(200, Math.max(1, parseInt(limit, 10) || 100)),
    orderBy: { name: 'asc' },
    include: STOCK_ITEM_INCLUDE
  });
  return (lowStock ? items.filter(i => i.quantity <= i.minQuantity) : items).map(mapStockItem);
}

async function getStockItem({ id }) {
  const item = await prisma.stockItem.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      movements: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { id: true, name: true, email: true } } }
      }
    }
  });
  if (!item) notFound('Article introuvable');
  return mapStockItem(item);
}

function stockItemData(input) {
  const data = {};
  if (input.name !== undefined) data.name = cleanString(input.name, { min: 1, max: 300, label: 'Le nom' });
  if (input.reference !== undefined) data.reference = nullableText(input.reference, 200, 'La référence');
  if (input.barcode !== undefined) data.barcode = nullableText(input.barcode, 100, 'Le code-barres');
  if (input.category !== undefined) data.category = nullableText(input.category, 100, 'La catégorie');
  if (input.description !== undefined) data.description = nullableText(input.description, 1000, 'La description');
  if (input.quantity !== undefined) data.quantity = Math.max(0, parseInt(input.quantity, 10) || 0);
  if (input.minQuantity !== undefined) data.minQuantity = Math.max(0, parseInt(input.minQuantity, 10) || 0);
  if (input.unitCost !== undefined) data.unitCost = numberOrNull(input.unitCost, 'Le coût unitaire');
  if (input.location !== undefined) data.location = nullableText(input.location, 200, "L'emplacement");
  if (input.supplierId !== undefined) data.supplierId = input.supplierId || null;
  return data;
}

async function createStockItem(input) {
  const item = await prisma.stockItem.create({
    data: {
      ...stockItemData(input),
      name: cleanString(input.name, { min: 1, max: 300, label: 'Le nom' }),
      quantity: input.quantity !== undefined ? Math.max(0, parseInt(input.quantity, 10) || 0) : 0,
      minQuantity: input.minQuantity !== undefined ? Math.max(0, parseInt(input.minQuantity, 10) || 0) : 0
    },
    include: STOCK_ITEM_INCLUDE
  });
  return mapStockItem(item);
}

async function updateStockItem({ id, ...input }) {
  const existing = await prisma.stockItem.findUnique({ where: { id }, select: { id: true } });
  if (!existing) notFound('Article introuvable');
  const item = await prisma.stockItem.update({
    where: { id },
    data: stockItemData(input),
    include: STOCK_ITEM_INCLUDE
  });
  return mapStockItem(item);
}

async function listStockMovements({ stockItemId, interventionId, limit = 50 } = {}) {
  const where = {};
  if (stockItemId) where.stockItemId = stockItemId;
  if (interventionId) where.interventionId = interventionId;
  return prisma.stockMovement.findMany({
    where,
    take: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
    orderBy: { createdAt: 'desc' },
    include: STOCK_MOVEMENT_INCLUDE
  });
}

async function createStockMovement(input, { userId } = {}) {
  if (!userId) badRequest('Utilisateur créateur introuvable pour créer un mouvement de stock.');
  ensureEnum(input.type, STOCK_MOVEMENT_TYPES, 'Type de mouvement');
  const quantity = parseInt(input.quantity, 10);
  if (!quantity || quantity < 1) badRequest('La quantité doit être un entier supérieur à 0.');

  const item = await prisma.stockItem.findUnique({ where: { id: input.stockItemId } });
  if (!item) notFound('Article introuvable');

  let newQuantity;
  if (input.type === 'IN') {
    newQuantity = item.quantity + quantity;
  } else if (input.type === 'OUT') {
    if (item.quantity < quantity) {
      throw Object.assign(new Error(`Stock insuffisant : ${item.quantity} disponible(s), ${quantity} demandé(s).`), { status: 409 });
    }
    newQuantity = item.quantity - quantity;
  } else {
    newQuantity = quantity;
  }

  const [movement] = await prisma.$transaction([
    prisma.stockMovement.create({
      data: {
        stockItemId: item.id,
        type: input.type,
        quantity,
        reason: nullableText(input.reason, 500, 'Le motif'),
        interventionId: input.interventionId || null,
        userId
      },
      include: STOCK_MOVEMENT_INCLUDE
    }),
    prisma.stockItem.update({
      where: { id: item.id },
      data: { quantity: newQuantity }
    })
  ]);

  return movement;
}

// ── Plan d'adressage IP ────────────────────────────────────────────────────────

async function listIpNetworks({ search } = {}) {
  const networks = await prisma.ipNetwork.findMany({
    include: { _count: { select: { addresses: true, ranges: true, migrations: true } } },
    orderBy: [{ vlan: 'asc' }, { name: 'asc' }],
  });
  const filtered = search
    ? networks.filter(n => n.name.toLowerCase().includes(search.toLowerCase()) || n.cidr.includes(search))
    : networks;
  return filtered.map(n => ({
    id: n.id, name: n.name, vlan: n.vlan, cidr: n.cidr, gateway: n.gateway, description: n.description,
    addressCount: n._count.addresses, rangeCount: n._count.ranges,
    pendingMigrations: n._count.migrations,
  }));
}

async function getIpNetwork({ networkId }) {
  const network = await prisma.ipNetwork.findUnique({
    where: { id: networkId },
    include: {
      addresses: { orderBy: { ip: 'asc' } },
      ranges: { orderBy: { startHost: 'asc' } },
      migrations: {
        where: { status: 'PLANNED' },
        include: { todo: { select: { id: true, title: true, done: true, dueAt: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!network) { const err = new Error('Réseau introuvable'); err.status = 404; throw err; }
  return network;
}

async function listIpAddresses({ networkId, search }) {
  const where = { networkId };
  if (search) {
    where.OR = [
      { ip: { contains: search } },
      { hostname: { contains: search } },
      { equipmentType: { contains: search } },
    ];
  }
  return prisma.ipAddress.findMany({ where, orderBy: { ip: 'asc' } });
}

async function listIpMigrations({ networkId, status } = {}) {
  const where = {};
  if (networkId) where.networkId = networkId;
  if (status) where.status = status;
  return prisma.ipMigration.findMany({
    where,
    include: {
      network: { select: { id: true, name: true, cidr: true } },
      todo: { select: { id: true, title: true, done: true, dueAt: true } },
      intervention: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function createIpMigration({ networkId, oldIp, newIp, newHostname, newType, notes, interventionId, scheduledAt }, { userId } = {}) {
  const network = await prisma.ipNetwork.findUnique({ where: { id: networkId } });
  if (!network) { const err = new Error('Réseau introuvable'); err.status = 404; throw err; }

  const existingAddr = await prisma.ipAddress.findUnique({
    where: { networkId_ip: { networkId, ip: oldIp } }
  });

  const todo = await prisma.todo.create({
    data: {
      title: `Migration IP : ${oldIp} → ${newIp} (${network.name})`,
      description: notes || null,
      interventionId: interventionId || null,
      dueAt: scheduledAt ? new Date(scheduledAt) : null,
    }
  });

  return prisma.ipMigration.create({
    data: {
      networkId, oldIp, newIp,
      newHostname: newHostname || null, newType: newType || null,
      notes: notes || null,
      ipAddressId: existingAddr?.id || null,
      interventionId: interventionId || null,
      todoId: todo.id,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      createdById: userId || null,
    },
    include: {
      network: { select: { id: true, name: true, cidr: true } },
      todo: { select: { id: true, title: true } },
    },
  });
}

async function applyIpMigration({ migrationId }, { userId } = {}) {
  const migration = await prisma.ipMigration.findUnique({
    where: { id: migrationId },
    include: { ipAddress: true, network: true, todo: true }
  });
  if (!migration) { const err = new Error('Migration introuvable'); err.status = 404; throw err; }
  if (migration.status !== 'PLANNED') {
    const err = new Error(`Migration déjà ${migration.status === 'APPLIED' ? 'appliquée' : 'annulée'}`);
    err.status = 400; throw err;
  }
  await applyMigration(migration, userId);
  return prisma.ipMigration.findUnique({
    where: { id: migrationId },
    include: { network: { select: { id: true, name: true } }, todo: { select: { id: true, done: true } } },
  });
}

module.exports = {
  INTERVENTION_STATUSES,
  INTERVENTION_PRIORITIES,
  CARD_PRIORITIES,
  ORDER_STATUSES,
  ORDER_PRICE_TYPES,
  STOCK_MOVEMENT_TYPES,
  listInterventions,
  getIntervention,
  createIntervention,
  updateIntervention,
  listTodos,
  createTodo,
  updateTodo,
  listProjects,
  getProject,
  createProject,
  updateProject,
  createProjectColumn,
  updateProjectColumn,
  createProjectCard,
  updateProjectCard,
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
  listStockItems,
  getStockItem,
  createStockItem,
  updateStockItem,
  listStockMovements,
  createStockMovement,
  // Plan d'adressage IP
  listIpNetworks,
  getIpNetwork,
  listIpAddresses,
  listIpMigrations,
  createIpMigration,
  applyIpMigration,
};
