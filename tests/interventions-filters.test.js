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
      where: expect.objectContaining({
        mergedIntoId: null,
        status: { in: ['OPEN', 'IN_PROGRESS'] }
      })
    }));
    expect(prisma.intervention.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        mergedIntoId: null,
        status: { in: ['OPEN', 'IN_PROGRESS'] }
      })
    });
  });
});
