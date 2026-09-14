const request = require('supertest');

jest.mock('../src/lib/prisma', () => ({ user: { findUnique: jest.fn() } }));

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({ user: { findUnique: jest.fn() } })) }));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1', role: 'ADMIN' }; next(); },
  optionalAuth: (_req, _res, next) => next(),
}));

const app = require('../src/app');

describe('page des tâches', () => {
  it('propose un calendrier mensuel des échéances avec navigation et détail journalier', async () => {
    const res = await request(app).get('/todos.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="todo-view-calendar-btn"');
    expect(res.text).toContain('id="todos-calendar-grid"');
    expect(res.text).toContain('function setTodoView(mode)');
    expect(res.text).toContain('function changeTodoCalendarMonth(delta)');
    expect(res.text).toContain('function showTodoCalendarDay(dayKey)');
    expect(res.text).toContain('getTodosForDay(dayKey)');
    expect(res.text).toContain('id="todo-start"');
    expect(res.text).toContain('id="todo-predecessors"');
  });
});
