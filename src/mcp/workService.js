const prisma = require('../lib/prisma');
const { containsFilter } = require('../lib/db-utils');

const INTERVENTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const INTERVENTION_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const CARD_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];

const INTERVENTION_INCLUDE = {
  room: { select: { id: true, name: true, number: true, building: true } },
  equipment: { select: { id: true, name: true, type: true, brand: true, model: true } },
  tech: { select: { id: true, name: true, email: true } },
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
    counts: item._count || undefined,
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

async function listInterventions({ status, priority, search, roomId, equipmentId, techId, archived = false, limit = 20 } = {}) {
  ensureEnum(status, INTERVENTION_STATUSES, 'Statut');
  ensureEnum(priority, INTERVENTION_PRIORITIES, 'Priorité');

  const clauses = [{ mergedIntoId: null }];
  clauses.push(archived ? { archivedAt: { not: null } } : { archivedAt: null });
  if (status) clauses.push({ status });
  if (priority) clauses.push({ priority });
  if (roomId) clauses.push({ roomId });
  if (equipmentId) clauses.push({ equipmentId });
  if (techId) clauses.push({ techId });
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

async function getIntervention({ id }) {
  const item = await prisma.intervention.findUnique({
    where: { id },
    include: INTERVENTION_INCLUDE
  });
  if (!item) notFound('Intervention introuvable');
  return mapIntervention(item);
}

async function createIntervention(input, { userId } = {}) {
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
      techId: input.techId || userId || null,
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

async function updateIntervention({ id, ...input }) {
  const existing = await prisma.intervention.findUnique({ where: { id } });
  if (!existing) notFound('Intervention introuvable');
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

module.exports = {
  INTERVENTION_STATUSES,
  INTERVENTION_PRIORITIES,
  CARD_PRIORITIES,
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
  updateProjectCard
};
