const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const TODO_INCLUDE = {
  intervention: {
    select: { id: true, title: true, status: true, room: { select: { name: true } } }
  }
};

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
    res.json(todos);
  } catch (err) { next(err); }
});

// POST /api/todos
router.post('/',
  requireAuth,
  body('title').trim().notEmpty().withMessage('Le titre est requis').isLength({ max: 500 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 2000 }),
  body('dueAt').optional({ nullable: true }).isISO8601().withMessage('Date invalide'),
  body('interventionId').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
      const interventionId = req.body.interventionId || null;
      if (interventionId) {
        const intervention = await prisma.intervention.findUnique({ where: { id: interventionId } });
        if (!intervention) return res.status(404).json({ error: 'Intervention introuvable' });
      }

      const todo = await prisma.todo.create({
        data: {
          interventionId,
          title: req.body.title.trim(),
          description: req.body.description?.trim() || null,
          dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null
        },
        include: TODO_INCLUDE
      });
      res.status(201).json(todo);
    } catch (err) { next(err); }
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
      data.dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
    }
    if (req.body.interventionId !== undefined) {
      data.interventionId = req.body.interventionId || null;
    }

    const updated = await prisma.todo.update({
      where: { id: req.params.id },
      data,
      include: TODO_INCLUDE
    });
    res.json(updated);
  } catch (err) { next(err); }
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
