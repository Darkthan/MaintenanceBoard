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
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  user: {
    findFirst: jest.fn()
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

describe('GET /api/interventions filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.intervention.findMany.mockResolvedValue([]);
    prisma.intervention.count.mockResolvedValue(0);
  });

  it('accepte plusieurs statuts en parallele', async () => {
    const res = await request(buildApp())
      .get('/api/interventions')
      .query({ status: ['OPEN', 'IN_PROGRESS'] });

    expect(res.status).toBe(200);
    expect(prisma.intervention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: expect.arrayContaining([
          { mergedIntoId: null },
          { status: { in: ['OPEN', 'IN_PROGRESS'] } }
        ])
      }
    }));
    expect(prisma.intervention.count).toHaveBeenCalledWith({
      where: {
        AND: expect.arrayContaining([
          { mergedIntoId: null },
          { status: { in: ['OPEN', 'IN_PROGRESS'] } }
        ])
      }
    });
  });

  it('filtre les tickets publics non attribués', async () => {
    const res = await request(buildApp())
      .get('/api/interventions')
      .query({ source: 'PUBLIC', unassigned: 'true' });

    expect(res.status).toBe(200);
    expect(prisma.intervention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: expect.arrayContaining([
          { source: 'PUBLIC' },
          { techId: null }
        ])
      }
    }));
  });

  it('filtre les tickets ayant un message demandeur non lu', async () => {
    const res = await request(buildApp())
      .get('/api/interventions')
      .query({ source: 'PUBLIC', needsReply: 'true' });

    expect(res.status).toBe(200);
    expect(prisma.intervention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: expect.arrayContaining([
          { messages: { some: { authorType: 'REPORTER', readAt: null } } }
        ])
      }
    }));
  });

  it('retourne les compteurs de la file de tickets', async () => {
    prisma.intervention.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const res = await request(buildApp()).get('/api/interventions/tickets/summary');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ open: 4, inProgress: 3, unread: 2, unassigned: 1 });
    expect(prisma.intervention.count).toHaveBeenCalledTimes(4);
  });

  it('permet à un administrateur d’attribuer un ticket', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'tech-1' });
    prisma.intervention.update.mockResolvedValue({
      id: 'ticket-1',
      title: 'Écran noir',
      source: 'PUBLIC',
      techId: 'tech-1',
      photos: '[]',
      checkupTemplate: '[]',
      checkupItems: []
    });

    const res = await request(buildApp())
      .patch('/api/interventions/ticket-1/assignment')
      .send({ techId: 'tech-1' });

    expect(res.status).toBe(200);
    expect(prisma.intervention.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ticket-1' },
      data: { techId: 'tech-1' }
    }));
  });
});
