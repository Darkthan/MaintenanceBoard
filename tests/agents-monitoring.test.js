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

jest.mock('../src/middleware/agentAuth', () => ({
  agentAuth: (req, _res, next) => {
    const mode = req.headers['x-test-agent-mode'];
    if (mode === 'machine') {
      req.equipmentRecord = {
        id: 'equip-1',
        roomId: 'room-1',
        brand: 'Old brand',
        model: 'Old model'
      };
    } else if (mode === 'enrollment') {
      req.enrollmentToken = { id: 'token-1' };
    }
    next();
  }
}));

jest.mock('../src/utils/settings', () => ({
  readSettings: jest.fn(),
  writeSettings: jest.fn()
}));

jest.mock('../src/services/discoveryService', () => ({
  findBestRoom: jest.fn(() => null),
  findTopRooms: jest.fn(() => [])
}));

jest.mock('../src/lib/prisma', () => ({
  equipment: {
    update: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn()
  },
  intervention: {
    findFirst: jest.fn(),
    create: jest.fn()
  },
  agentToken: {
    update: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn()
  },
  room: {
    findMany: jest.fn()
  }
}));

const { readSettings, writeSettings } = require('../src/utils/settings');
const prisma = require('../src/lib/prisma');
const agentsRouter = require('../src/routes/agents');
const settingsRouter = require('../src/routes/settings');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);
  app.use('/api/settings', settingsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('agent monitoring settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enregistre le seuil disque faible', async () => {
    readSettings.mockReturnValue({ agentMonitoring: { lowDiskAlertsEnabled: false, lowDiskThresholdGb: 20 } });

    const res = await request(buildApp())
      .patch('/api/settings/agent-monitoring')
      .send({ lowDiskAlertsEnabled: true, lowDiskThresholdGb: 15 });

    expect(res.status).toBe(200);
    expect(writeSettings).toHaveBeenCalledWith({
      agentMonitoring: {
        lowDiskAlertsEnabled: true,
        lowDiskThresholdGb: 15
      }
    });
  });
});

describe('POST /api/agents/checkin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readSettings.mockReturnValue({
      agentMonitoring: {
        lowDiskAlertsEnabled: true,
        lowDiskThresholdGb: 20
      }
    });
  });

  it('met à jour fabricant/modèle et crée une intervention si un disque est sous le seuil', async () => {
    prisma.equipment.update.mockResolvedValue({
      id: 'equip-1',
      roomId: 'room-1',
      brand: 'Dell',
      model: 'OptiPlex 7010',
      agentHostname: 'PC-101',
      agentAlertState: null
    });
    prisma.intervention.findFirst.mockResolvedValue(null);
    prisma.intervention.create.mockResolvedValue({ id: 'int-1' });

    const res = await request(buildApp())
      .post('/api/agents/checkin')
      .set('x-test-agent-mode', 'machine')
      .send({
        hostname: 'PC-101',
        manufacturer: 'Dell',
        model: 'OptiPlex 7010',
        cpu: 'Intel Core i5',
        ramGb: 16,
        os: 'Windows 11',
        disks: [
          { mount: 'C:', totalGb: 512, freeGb: 9.5, usedPercent: 98.1 }
        ]
      });

    expect(res.status).toBe(200);
    expect(prisma.equipment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'equip-1' },
      data: expect.objectContaining({
        brand: 'Dell',
        model: 'OptiPlex 7010'
      })
    }));
    expect(prisma.intervention.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        equipmentId: 'equip-1',
        title: 'Espace disque faible - C:'
      })
    }));
    expect(prisma.intervention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        equipmentId: 'equip-1',
        roomId: 'room-1',
        title: 'Espace disque faible - C:',
        priority: 'HIGH'
      })
    }));
  });

  it('ne recrée pas d’intervention si l’alerte disque a déjà été acquittée', async () => {
    prisma.equipment.update.mockResolvedValue({
      id: 'equip-1',
      roomId: 'room-1',
      brand: 'Dell',
      model: 'OptiPlex 7010',
      agentHostname: 'PC-101',
      agentAlertState: JSON.stringify({
        lowDisk: {
          'C:': {
            suppressed: true,
            interventionId: 'int-1',
            acknowledgedAt: '2026-03-23T09:00:00.000Z'
          }
        }
      })
    });

    const res = await request(buildApp())
      .post('/api/agents/checkin')
      .set('x-test-agent-mode', 'machine')
      .send({
        hostname: 'PC-101',
        manufacturer: 'Dell',
        model: 'OptiPlex 7010',
        disks: [
          { mount: 'C:', totalGb: 512, freeGb: 8.2, usedPercent: 98.4 }
        ]
      });

    expect(res.status).toBe(200);
    expect(prisma.intervention.findFirst).not.toHaveBeenCalled();
    expect(prisma.intervention.create).not.toHaveBeenCalled();
  });

  it('réarme l’alerte après retour à la normale puis recrée une intervention si le défaut revient', async () => {
    prisma.equipment.update
      .mockResolvedValueOnce({
        id: 'equip-1',
        roomId: 'room-1',
        brand: 'Dell',
        model: 'OptiPlex 7010',
        agentHostname: 'PC-101',
        agentAlertState: JSON.stringify({
          lowDisk: {
            'C:': {
              suppressed: true,
              interventionId: 'int-1',
              acknowledgedAt: '2026-03-23T09:00:00.000Z'
            }
          }
        })
      })
      .mockResolvedValueOnce({
        id: 'equip-1',
        roomId: 'room-1',
        agentAlertState: null
      })
      .mockResolvedValueOnce({
        id: 'equip-1',
        roomId: 'room-1',
        brand: 'Dell',
        model: 'OptiPlex 7010',
        agentHostname: 'PC-101',
        agentAlertState: null
      });
    prisma.intervention.findFirst.mockResolvedValue(null);
    prisma.intervention.create.mockResolvedValue({ id: 'int-2' });

    const healthyRes = await request(buildApp())
      .post('/api/agents/checkin')
      .set('x-test-agent-mode', 'machine')
      .send({
        hostname: 'PC-101',
        manufacturer: 'Dell',
        model: 'OptiPlex 7010',
        disks: [
          { mount: 'C:', totalGb: 512, freeGb: 120, usedPercent: 76.5 }
        ]
      });

    const lowDiskRes = await request(buildApp())
      .post('/api/agents/checkin')
      .set('x-test-agent-mode', 'machine')
      .send({
        hostname: 'PC-101',
        manufacturer: 'Dell',
        model: 'OptiPlex 7010',
        disks: [
          { mount: 'C:', totalGb: 512, freeGb: 7.1, usedPercent: 98.9 }
        ]
      });

    expect(healthyRes.status).toBe(200);
    expect(lowDiskRes.status).toBe(200);
    expect(prisma.equipment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'equip-1' },
      data: expect.objectContaining({
        agentAlertState: null
      })
    }));
    expect(prisma.intervention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'Espace disque faible - C:',
        equipmentId: 'equip-1'
      })
    }));
  });
});
