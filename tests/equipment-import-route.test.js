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
    single: () => (req, _res, next) => {
      req.file = { path: 'tmp/import.csv' };
      next();
    }
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
  room: {
    findFirst: jest.fn()
  },
  equipment: {
    create: jest.fn()
  },
  equipmentAttachment: {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn()
  },
  intervention: {
    findMany: jest.fn()
  },
  stockMovement: {
    findMany: jest.fn()
  },
  $transaction: jest.fn()
}));

const prisma = require('../src/lib/prisma');
const importService = require('../src/services/importService');
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

describe('equipment import route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('importe une ligne enrichie agent avec salles resolues', async () => {
    const rows = [{ hostname: 'pc-cdi-01' }];
    const validRow = {
      valid: true,
      errors: [],
      data: {
        name: 'pc-cdi-01',
        type: 'PC',
        brand: 'Dell',
        model: 'OptiPlex 7090',
        serialNumber: 'SN-AGENT-01',
        status: 'ACTIVE',
        description: null,
        roomNumber: '101',
        suggestedRoomNumber: '202',
        discoverySource: 'AGENT',
        discoveryStatus: 'PENDING',
        agentHostname: 'pc-cdi-01',
        lastSeenAt: new Date('2026-03-30T08:15:00.000Z'),
        agentInfo: JSON.stringify({
          cpu: 'Intel Core i5',
          ramGb: 16,
          os: 'Windows 11',
          ips: ['10.0.0.15']
        }),
        agentRevoked: false
      }
    };

    importService.parseFile.mockResolvedValue(rows);
    importService.validateEquipmentRow.mockReturnValue(validRow);

    prisma.$transaction.mockImplementation(async (callback) => callback({
      room: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'room-101' })
          .mockResolvedValueOnce({ id: 'room-202' })
      },
      equipment: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'equip-1', ...data }))
      }
    }));

    const res = await request(buildApp()).post('/api/equipment/import').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: '1 équipement(s) importé(s) avec succès',
      imported: 1
    });
    expect(importService.parseFile).toHaveBeenCalledWith('tmp/import.csv');
    expect(importService.validateEquipmentRow).toHaveBeenCalledWith(rows[0], 0);
    expect(importService.cleanupFile).toHaveBeenCalledWith('tmp/import.csv');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('passe les champs agent et les salles resolues a Prisma', async () => {
    const createdEquipment = jest.fn().mockResolvedValue({ id: 'equip-1' });
    const roomLookup = jest.fn()
      .mockResolvedValueOnce({ id: 'room-101' })
      .mockResolvedValueOnce({ id: 'room-202' });

    importService.parseFile.mockResolvedValue([{ hostname: 'pc-cdi-01' }]);
    importService.validateEquipmentRow.mockReturnValue({
      valid: true,
      errors: [],
      data: {
        name: 'pc-cdi-01',
        type: 'PC',
        brand: 'Dell',
        model: 'OptiPlex 7090',
        serialNumber: 'SN-AGENT-01',
        status: 'ACTIVE',
        description: "Decouvert par l'agent",
        roomNumber: '101',
        suggestedRoomNumber: '202',
        discoverySource: 'AGENT',
        discoveryStatus: 'PENDING',
        agentHostname: 'pc-cdi-01',
        lastSeenAt: new Date('2026-03-30T08:15:00.000Z'),
        agentInfo: '{"cpu":"Intel Core i5","ramGb":16}',
        agentRevoked: false
      }
    });

    prisma.$transaction.mockImplementation(async (callback) => callback({
      room: { findFirst: roomLookup },
      equipment: { create: createdEquipment }
    }));

    const res = await request(buildApp()).post('/api/equipment/import').send({});

    expect(res.status).toBe(200);
    expect(roomLookup).toHaveBeenNthCalledWith(1, {
      where: { number: { equals: '101', mode: 'insensitive' } }
    });
    expect(roomLookup).toHaveBeenNthCalledWith(2, {
      where: { number: { equals: '202', mode: 'insensitive' } }
    });
    expect(createdEquipment).toHaveBeenCalledWith({
      data: {
        name: 'pc-cdi-01',
        type: 'PC',
        brand: 'Dell',
        model: 'OptiPlex 7090',
        serialNumber: 'SN-AGENT-01',
        status: 'ACTIVE',
        description: "Decouvert par l'agent",
        discoverySource: 'AGENT',
        discoveryStatus: 'PENDING',
        agentHostname: 'pc-cdi-01',
        lastSeenAt: new Date('2026-03-30T08:15:00.000Z'),
        agentInfo: '{"cpu":"Intel Core i5","ramGb":16}',
        agentRevoked: false,
        roomId: 'room-101',
        suggestedRoomId: 'room-202'
      }
    });
  });
});
