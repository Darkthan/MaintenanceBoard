const express = require('express');
const request = require('supertest');

const mockPrisma = {
  todo: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  todoDependency: { findMany: jest.fn() },
  intervention: { findUnique: jest.fn() },
  ipMigration: { findUnique: jest.fn() }
};

jest.mock('../src/lib/prisma', () => mockPrisma);
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1', role: 'ADMIN' }; next(); }
}));
jest.mock('../src/services/ipMigrationService', () => ({ applyMigration: jest.fn() }));

const todosRouter = require('../src/routes/todos');
const app = express();
app.use(express.json());
app.use('/api/todos', todosRouter);

describe('dépendances entre tâches', () => {
  beforeEach(() => {
    Object.values(mockPrisma).forEach(model => Object.values(model).forEach(fn => fn.mockReset()));
  });

  it('crée une tâche avec une date de début et ses précédents', async () => {
    mockPrisma.todo.findMany
      .mockResolvedValueOnce([{ id: 'previous-1' }])
      .mockResolvedValueOnce([]);
    mockPrisma.todoDependency.findMany.mockResolvedValue([]);
    mockPrisma.todo.create.mockResolvedValue({
      id: 'todo-2', title: 'Déployer', startAt: new Date('2026-09-15'), dueAt: null,
      predecessorLinks: [{ predecessor: { id: 'previous-1', title: 'Préparer', done: false } }]
    });

    const res = await request(app).post('/api/todos').send({
      title: 'Déployer', startAt: '2026-09-15T08:00:00.000Z', predecessorIds: ['previous-1']
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.todo.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        startAt: new Date('2026-09-15T08:00:00.000Z'),
        predecessorLinks: { create: [{ predecessor: { connect: { id: 'previous-1' } } }] }
      })
    }));
    expect(res.body.predecessors).toEqual([{ id: 'previous-1', title: 'Préparer', done: false }]);
  });

  it('refuse une dépendance qui crée une boucle', async () => {
    mockPrisma.todo.findUnique.mockResolvedValue({ id: 'todo-2', title: 'Déployer', startAt: null, dueAt: null });
    mockPrisma.todo.findMany.mockResolvedValue([{ id: 'previous-1' }]);
    mockPrisma.todoDependency.findMany.mockResolvedValue([
      { predecessorId: 'todo-2', successorId: 'previous-1' }
    ]);

    const res = await request(app).patch('/api/todos/todo-2').send({ predecessorIds: ['previous-1'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boucle/i);
    expect(mockPrisma.todo.update).not.toHaveBeenCalled();
  });
});
