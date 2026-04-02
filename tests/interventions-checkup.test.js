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
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn()
  },
  interventionCheckupItem: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  equipment: {
    findMany: jest.fn(),
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

function buildCheckupIntervention(overrides = {}) {
  return {
    id: 'checkup-1',
    title: 'Checkup vidéoprojecteurs',
    kind: 'CHECKUP',
    status: 'OPEN',
    priority: 'NORMAL',
    photos: '[]',
    checkupTemplate: JSON.stringify([
      { id: 'task-1', label: 'Tester l affichage' },
      { id: 'task-2', label: 'Verifier les cables' }
    ]),
    room: null,
    equipment: null,
    tech: null,
    reporters: [],
    orders: [],
    messages: [],
    checkupItems: [],
    ...overrides
  };
}

describe('interventions checkup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('crée un checkup partagé avec une checklist et plusieurs équipements', async () => {
    prisma.equipment.findMany.mockResolvedValue([
      {
        id: 'eq-1',
        name: 'Projecteur A',
        type: 'PROJECTEUR',
        room: { id: 'room-1', name: 'Salle 101', number: '101', building: 'A' }
      },
      {
        id: 'eq-2',
        name: 'Projecteur B',
        type: 'PROJECTEUR',
        room: { id: 'room-2', name: 'Salle 102', number: '102', building: 'A' }
      }
    ]);
    prisma.intervention.create.mockImplementation(async ({ data }) => buildCheckupIntervention({
      title: data.title,
      status: data.status,
      priority: data.priority
    }));

    const res = await request(buildApp())
      .post('/api/interventions')
      .send({
        kind: 'CHECKUP',
        title: 'Checkup projecteurs',
        checkupTemplate: [
          { id: 'task-1', label: 'Tester l affichage' },
          { id: 'task-2', label: 'Verifier les cables' }
        ],
        checkupEquipmentIds: ['eq-1', 'eq-2']
      });

    expect(res.status).toBe(201);
    expect(prisma.intervention.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: 'CHECKUP',
        techId: null,
        checkupItems: {
          create: expect.arrayContaining([
            expect.objectContaining({ equipmentId: 'eq-1', orderIndex: 0 }),
            expect.objectContaining({ equipmentId: 'eq-2', orderIndex: 1 })
          ])
        }
      })
    }));
  });

  it('marque un équipement de checkup comme contrôlé et synchronise le statut parent', async () => {
    prisma.intervention.findUnique.mockResolvedValueOnce({
      id: 'checkup-1',
      kind: 'CHECKUP',
      techId: null,
      checkupTemplate: JSON.stringify([
        { id: 'task-1', label: 'Tester l affichage' }
      ])
    });
    prisma.interventionCheckupItem.findUnique.mockResolvedValue({
      id: 'item-1',
      interventionId: 'checkup-1',
      status: 'PENDING',
      checklistState: JSON.stringify([{ id: 'task-1', label: 'Tester l affichage', done: false }]),
      notes: null,
      equipment: {
        id: 'eq-1',
        name: 'Projecteur A',
        type: 'PROJECTEUR',
        status: 'ACTIVE',
        roomId: 'room-1',
        room: { id: 'room-1', name: 'Salle 101', number: '101', building: 'A' }
      },
      checkedBy: null
    });
    prisma.interventionCheckupItem.update.mockImplementation(async ({ data }) => ({
      id: 'item-1',
      interventionId: 'checkup-1',
      status: data.status,
      checklistState: data.checklistState,
      notes: data.notes,
      checkedAt: data.checkedAt,
      checkedBy: { id: 'admin-1', name: 'Admin', email: 'admin@test.com' },
      equipment: {
        id: 'eq-1',
        name: 'Projecteur A',
        type: 'PROJECTEUR',
        status: 'ACTIVE',
        roomId: 'room-1',
        room: { id: 'room-1', name: 'Salle 101', number: '101', building: 'A' }
      }
    }));
    prisma.interventionCheckupItem.findMany.mockResolvedValue([{ status: 'DONE' }]);
    prisma.intervention.update.mockResolvedValue(buildCheckupIntervention({
      status: 'RESOLVED',
      checkupItems: [
        {
          id: 'item-1',
          status: 'DONE',
          checklistState: JSON.stringify([{ id: 'task-1', label: 'Tester l affichage', done: true }]),
          notes: 'RAS',
          checkedAt: '2026-04-01T08:00:00.000Z',
          checkedBy: { id: 'admin-1', name: 'Admin', email: 'admin@test.com' },
          equipment: {
            id: 'eq-1',
            name: 'Projecteur A',
            type: 'PROJECTEUR',
            status: 'ACTIVE',
            roomId: 'room-1',
            room: { id: 'room-1', name: 'Salle 101', number: '101', building: 'A' }
          }
        }
      ]
    }));

    const res = await request(buildApp())
      .patch('/api/interventions/checkup-1/checkup/items/item-1')
      .send({
        checklistState: [{ id: 'task-1', done: true }],
        notes: 'RAS'
      });

    expect(res.status).toBe(200);
    expect(prisma.interventionCheckupItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DONE',
        checkedById: 'admin-1'
      })
    }));
    expect(prisma.intervention.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'RESOLVED'
      })
    }));
    expect(res.body.summary.done).toBe(1);
    expect(res.body.item.status).toBe('DONE');
  });
});
