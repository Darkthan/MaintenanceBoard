const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  }
}));

jest.mock('../src/middleware/roles', () => ({
  requireAdmin: (_req, _res, next) => next()
}));

jest.mock('../src/middleware/upload', () => ({
  uploadPhoto: {
    array: () => (_req, _res, next) => next()
  }
}));

jest.mock('../src/lib/prisma', () => ({
  intervention: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  interventionCheckupItem: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  equipment: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const interventionsRouter = require('../src/routes/interventions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/interventions', interventionsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('interventions scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('crée une intervention avec dates planifiées et date due', async () => {
    prisma.intervention.create.mockImplementation(async ({ data }) => ({
      id: 'int-1',
      photos: '[]',
      title: data.title,
      status: data.status,
      priority: data.priority,
      scheduledStartAt: data.scheduledStartAt,
      scheduledEndAt: data.scheduledEndAt,
      dueAt: data.dueAt,
      room: null,
      equipment: null,
      tech: { id: 'admin-1', name: 'Admin', email: 'admin@test.com' },
      reporters: [],
      orders: [],
      messages: []
    }));

    const res = await request(buildApp())
      .post('/api/interventions')
      .send({
        title: 'Maintenance vidéoprojecteur',
        status: 'OPEN',
        priority: 'HIGH',
        scheduledStartAt: '2026-03-31T08:00:00.000Z',
        scheduledEndAt: '2026-03-31T09:30:00.000Z',
        dueAt: '2026-04-01T16:00:00.000Z'
      });

    expect(res.status).toBe(201);
    expect(prisma.intervention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scheduledStartAt: new Date('2026-03-31T08:00:00.000Z'),
        scheduledEndAt: new Date('2026-03-31T09:30:00.000Z'),
        dueAt: new Date('2026-04-01T16:00:00.000Z')
      })
    }));
  });

  it('refuse une fin planifiée antérieure au début', async () => {
    const res = await request(buildApp())
      .post('/api/interventions')
      .send({
        title: 'Maintenance vidéoprojecteur',
        scheduledStartAt: '2026-03-31T10:00:00.000Z',
        scheduledEndAt: '2026-03-31T09:00:00.000Z'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fin d'intervention/i);
    expect(prisma.intervention.create).not.toHaveBeenCalled();
  });

  it('met à jour la planification d une intervention', async () => {
    prisma.intervention.findUnique.mockResolvedValue({
      id: 'int-1',
      techId: 'admin-1',
      source: 'INTERNAL',
      title: 'Maintenance',
      equipmentId: null,
      scheduledStartAt: null,
      scheduledEndAt: null
    });
    prisma.intervention.update.mockImplementation(async ({ data }) => ({
      id: 'int-1',
      photos: '[]',
      title: 'Maintenance',
      status: 'IN_PROGRESS',
      priority: 'NORMAL',
      scheduledStartAt: data.scheduledStartAt,
      scheduledEndAt: data.scheduledEndAt,
      dueAt: data.dueAt,
      room: null,
      equipment: null,
      tech: { id: 'admin-1', name: 'Admin', email: 'admin@test.com' },
      reporters: [],
      orders: [],
      messages: []
    }));

    const res = await request(buildApp())
      .patch('/api/interventions/int-1')
      .send({
        status: 'IN_PROGRESS',
        scheduledStartAt: '2026-03-31T08:00:00.000Z',
        scheduledEndAt: '2026-03-31T10:00:00.000Z',
        dueAt: '2026-04-02T16:00:00.000Z'
      });

    expect(res.status).toBe(200);
    expect(prisma.intervention.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scheduledStartAt: new Date('2026-03-31T08:00:00.000Z'),
        scheduledEndAt: new Date('2026-03-31T10:00:00.000Z'),
        dueAt: new Date('2026-04-02T16:00:00.000Z')
      })
    }));
  });
});
