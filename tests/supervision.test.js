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

jest.mock('../src/utils/settings', () => ({
  readSettings: jest.fn(),
  writeSettings: jest.fn()
}));

jest.mock('../src/lib/prisma', () => ({
  equipment: {
    findMany: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const { readSettings, writeSettings } = require('../src/utils/settings');
const supervisionRouter = require('../src/routes/supervision');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/supervision', supervisionRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

describe('supervision routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readSettings.mockReturnValue({
      supervision: {
        alertRules: [
          {
            id: 'latency',
            label: 'Latence élevée',
            enabled: true,
            equipmentType: 'Switch',
            harvestName: '',
            metric: 'latencyMs',
            operator: 'gt',
            threshold: 1000,
            severity: 'HIGH'
          }
        ]
      }
    });
  });

  it('retourne la synthèse des récoltes regroupées par type', async () => {
    prisma.equipment.findMany.mockResolvedValue([
      {
        id: 'equip-1',
        name: 'Puller 1',
        type: 'PC',
        agentHostname: 'PULLER-1',
        lastSeenAt: new Date(),
        agentInfo: JSON.stringify({
          harvests: [
            {
              equipmentName: 'Switch coeur',
              equipmentType: 'Switch',
              name: 'HTTPS admin',
              type: 'HTTPS',
              target: 'https://10.0.0.1/',
              status: 'UP',
              httpStatus: 200,
              latencyMs: 120,
              checkedAt: '2026-07-07T10:00:00Z'
            },
            {
              equipmentName: 'Switch coeur',
              equipmentType: 'Switch',
              name: 'API',
              type: 'HTTPS',
              target: 'https://10.0.0.1/api',
              status: 'DOWN',
              httpStatus: 503,
              latencyMs: 1500,
              checkedAt: '2026-07-07T10:00:00Z'
            }
          ]
        })
      }
    ]);

    const res = await request(buildApp()).get('/api/supervision');

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 2, up: 1, down: 1 });
    expect(res.body.groups[0]).toMatchObject({ type: 'Switch', total: 2, up: 1, down: 1 });
    expect(res.body.harvests[0]).toMatchObject({
      equipmentName: 'Switch coeur',
      status: 'DOWN'
    });
    expect(res.body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Supervision indisponible - Switch coeur - API' })
    ]));
  });

  it('enregistre les règles de dépassement de limites', async () => {
    const res = await request(buildApp())
      .patch('/api/supervision/settings')
      .send({
        alertRules: [
          {
            label: 'Latence switch',
            equipmentType: 'Switch',
            metric: 'latencyMs',
            operator: 'gt',
            threshold: 800
          }
        ]
      });

    expect(res.status).toBe(200);
    expect(writeSettings).toHaveBeenCalledWith(expect.objectContaining({
      supervision: expect.objectContaining({
        alertRules: [
          expect.objectContaining({
            label: 'Latence switch',
            equipmentType: 'Switch',
            metric: 'latencyMs',
            threshold: 800
          })
        ]
      })
    }));
  });

  it('enregistre un abonnement push', async () => {
    readSettings.mockReturnValue({ supervision: { pushSubscriptions: [] } });

    const res = await request(buildApp())
      .post('/api/supervision/push-subscriptions')
      .send({
        subscription: {
          endpoint: 'https://push.example/sub',
          keys: { p256dh: 'p256', auth: 'auth' }
        }
      });

    expect(res.status).toBe(201);
    expect(writeSettings).toHaveBeenCalledWith(expect.objectContaining({
      supervision: expect.objectContaining({
        pushSubscriptions: [
          expect.objectContaining({ endpoint: 'https://push.example/sub' })
        ]
      })
    }));
  });
});
