const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  }
}));

jest.mock('../src/middleware/roles', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireTechOrAdmin: (_req, _res, next) => next()
}));

jest.mock('../src/middleware/upload', () => ({
  uploadImport: {
    single: () => (_req, _res, next) => next()
  }
}));

jest.mock('../src/services/importService', () => ({
  parseFile: jest.fn(),
  validateEquipmentRow: jest.fn(),
  cleanupFile: jest.fn()
}));

jest.mock('../src/services/qrService', () => ({
  generateQrCode: jest.fn()
}));

jest.mock('../src/lib/prisma', () => ({
  equipment: {
    create: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const equipmentRouter = require('../src/routes/equipment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/equipment', equipmentRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('POST /api/equipment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepte roomId a null lors de la creation', async () => {
    prisma.equipment.create.mockResolvedValue({
      id: 'equip-1',
      name: 'PC Salle profs',
      type: 'PC',
      status: 'ACTIVE',
      room: null,
      supplierRef: null
    });

    const res = await request(buildApp())
      .post('/api/equipment')
      .send({
        name: 'PC Salle profs',
        type: 'PC',
        status: 'ACTIVE',
        roomId: null
      });

    expect(res.status).toBe(201);
    expect(prisma.equipment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        roomId: null
      })
    }));
  });
});
