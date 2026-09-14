const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { applyMigration } = require('../services/ipMigrationService');

const router = express.Router();

const TODO_INCLUDE = {
  intervention: {
    select: { id: true, title: true, status: true, room: { select: { name: true } } }
  },
  predecessorLinks: {
    select: {
      predecessor: { select: { id: true, title: true, done: true, startAt: true, dueAt: true } }
    }
  }
};

function mapTodo(todo) {
  return {
    ...todo,
    predecessors: (todo.predecessorLinks || []).map(link => link.predecessor),
    predecessorLinks: undefined
  };
}

function parseDate(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} invalide`);
  return date;
}

function parsePredecessorIds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Les tâches précédentes doivent être une liste');
  return [...new Set(value.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
}

async function validatePredecessors(todoId, predecessorIds) {
  if (predecessorIds === undefined) return;
  if (todoId && predecessorIds.includes(todoId)) throw new Error('Une tâche ne peut pas être son propre précédent');
  const found = await prisma.todo.findMany({ where: { id: { in: predecessorIds } }, select: { id: true } });
  if (found.length !== predecessorIds.length) throw new Error('Une tâche précédente est introuvable');

  // Une nouvelle tâche n'a pas encore d'identifiant : il n'existe donc pas
  // encore de chemin de retour possible vers elle.
  if (!todoId) return;
  const links = await prisma.todoDependency.findMany({ select: { predecessorId: true, successorId: true } });
  const edges = links.filter(link => link.successorId !== todoId);
  predecessorIds.forEach(predecessorId => edges.push({ predecessorId, successorId: todoId }));
  const graph = new Map();
  edges.forEach(edge => {
    if (!graph.has(edge.predecessorId)) graph.set(edge.predecessorId, []);
    graph.get(edge.predecessorId).push(edge.successorId);
  });
  const seen = new Set();
  const visit = id => {
    if (id === todoId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (graph.get(id) || []).some(visit);
  };
  if (predecessorIds.some(visit)) throw new Error('Cette relation créerait une boucle de dépendances');
}

function dependencyData(predecessorIds, updating = false) {
  return predecessorIds === undefined ? undefined : {
    predecessorLinks: {
      ...(updating ? { deleteMany: {} } : {}),
      create: predecessorIds.map(predecessorId => ({ predecessor: { connect: { id: predecessorId } } }))
    }
  };
}

// GET /api/todos
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.done === 'true') where.done = true;
    if (req.query.done === 'false') where.done = false;
    if (req.query.overdue === 'true') {
      where.done = false;
      where.dueAt = { not: null, lt: new Date() };
    }
    if (req.query.interventionId) where.interventionId = req.query.interventionId;

    const todos = await prisma.todo.findMany({
      where,
      orderBy: [{ done: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
      include: TODO_INCLUDE
    });
    res.json(todos.map(mapTodo));
  } catch (err) { next(err); }
});

// POST /api/todos
router.post('/',
  requireAuth,
    body('title').trim().notEmpty().withMessage('Le titre est requis').isLength({ max: 500 }),
    body('description').optional({ nullable: true }).trim().isLength({ max: 2000 }),
    body('startAt').optional({ nullable: true }).isISO8601().withMessage('Date de début invalide'),
    body('dueAt').optional({ nullable: true }).isISO8601().withMessage('Date invalide'),
  body('interventionId').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const interventionId = req.body.interventionId || null;
      const startAt = parseDate(req.body.startAt, 'Date de début');
      const dueAt = parseDate(req.body.dueAt, "Date d'échéance");
      if (startAt && dueAt && dueAt < startAt) return res.status(400).json({ error: "L'échéance doit être postérieure à la date de début" });
      const predecessorIds = parsePredecessorIds(req.body.predecessorIds) || [];
      await validatePredecessors(null, predecessorIds);
      if (interventionId) {
        const intervention = await prisma.intervention.findUnique({ where: { id: interventionId } });
        if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
      }

      const todo = await prisma.todo.create({
        data: {
          interventionId,
          title: req.body.title.trim(),
          description: req.body.description?.trim() || null,
          startAt: startAt ?? null,
          dueAt: dueAt ?? null,
          ...dependencyData(predecessorIds)
        },
        include: TODO_INCLUDE
      });
      res.status(201).json(mapTodo(todo));
    } catch (err) {
      if (err.message?.includes('précédente') || err.message?.includes('boucle') || err.message?.includes('propre') || err.message?.includes('invalide')) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

// PATCH /api/todos/:id
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const todo = await prisma.todo.findUnique({ where: { id: req.params.id } });
    if (!todo) return res.status(404).json({ error: 'Tâche introuvable' });

    const data = {};
    if (typeof req.body.done === 'boolean') {
      data.done = req.body.done;
      data.doneAt = req.body.done ? new Date() : null;
    }
    if (typeof req.body.title === 'string') {
      const title = req.body.title.trim();
      if (!title) return res.status(400).json({ error: 'Le titre est requis' });
      data.title = title;
    }
    if (req.body.description !== undefined) {
      data.description = typeof req.body.description === 'string' ? req.body.description.trim() || null : null;
    }
    if (req.body.dueAt !== undefined) {
      data.dueAt = parseDate(req.body.dueAt, "Date d'échéance");
    }
    if (req.body.startAt !== undefined) data.startAt = parseDate(req.body.startAt, 'Date de début');
    if (req.body.interventionId !== undefined) {
      data.interventionId = req.body.interventionId || null;
    }

    const predecessorIds = parsePredecessorIds(req.body.predecessorIds);
    await validatePredecessors(req.params.id, predecessorIds);
    const effectiveStart = data.startAt !== undefined ? data.startAt : todo.startAt;
    const effectiveDue = data.dueAt !== undefined ? data.dueAt : todo.dueAt;
    if (effectiveStart && effectiveDue && effectiveDue < effectiveStart) return res.status(400).json({ error: "L'échéance doit être postérieure à la date de début" });
    if (data.done === true) {
      const currentLinks = predecessorIds === undefined
        ? await prisma.todoDependency.findMany({ where: { successorId: req.params.id }, select: { predecessorId: true } })
        : [];
      const ids = predecessorIds || currentLinks.map(link => link.predecessorId);
      const predecessors = await prisma.todo.findMany({ where: { id: { in: ids } }, select: { done: true } });
      if (predecessors.some(predecessor => !predecessor.done)) return res.status(409).json({ error: 'Terminez d’abord les tâches précédentes' });
    }
    Object.assign(data, dependencyData(predecessorIds, true) || {});

    const updated = await prisma.todo.update({
      where: { id: req.params.id },
      data,
      include: TODO_INCLUDE
    });

    // Auto-appliquer la migration IP liée si la tâche vient d'être validée
    if (data.done === true && !todo.done) {
      const migration = await prisma.ipMigration.findUnique({
        where: { todoId: req.params.id },
        include: { ipAddress: true, network: true, todo: true }
      });
      if (migration && migration.status === 'PLANNED') {
        try {
          await applyMigration(migration, req.user?.id);
        } catch (e) {
          // Ne pas bloquer la réponse si l'application échoue, mais logger
          console.error('[ip-migration] Auto-apply failed:', e.message);
        }
      }
    }

    res.json(mapTodo(updated));
  } catch (err) {
    if (err.message?.includes('précédente') || err.message?.includes('boucle') || err.message?.includes('propre') || err.message?.includes('invalide')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/todos/:id
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const todo = await prisma.todo.findUnique({ where: { id: req.params.id } });
    if (!todo) return res.status(404).json({ error: 'Tâche introuvable' });

    await prisma.todo.delete({ where: { id: req.params.id } });
    res.json({ message: 'Tâche supprimée' });
  } catch (err) { next(err); }
});

module.exports = router;
