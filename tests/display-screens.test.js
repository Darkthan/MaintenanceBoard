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

jest.mock('../src/utils/settings', () => {
  let state = {};
  return {
    readSettings: jest.fn(() => state),
    writeSettings: jest.fn(patch => {
      state = { ...state, ...patch };
      return state;
    }),
    __setState(nextState) {
      state = nextState;
    },
    __getState() {
      return state;
    }
  };
});

jest.mock('../src/lib/prisma', () => ({
  room: { count: jest.fn() },
  equipment: { count: jest.fn(), findMany: jest.fn() },
  intervention: { count: jest.fn(), findMany: jest.fn() },
  order: { findMany: jest.fn() },
  stockItem: { findMany: jest.fn() },
  loanReservation: { findMany: jest.fn() }
}));

const settingsStore = require('../src/utils/settings');
const prisma = require('../src/lib/prisma');
const settingsRouter = require('../src/routes/settings');
const displayRouter = require('../src/routes/display');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  app.use('/api/display', displayRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('display screens settings and public payload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.__setState({});

    prisma.room.count.mockResolvedValue(0);
    prisma.equipment.count.mockResolvedValue(0);
    prisma.equipment.findMany.mockResolvedValue([]);
    prisma.intervention.count.mockResolvedValue(0);
    prisma.intervention.findMany.mockResolvedValue([]);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.stockItem.findMany.mockResolvedValue([]);
    prisma.loanReservation.findMany.mockResolvedValue([]);
  });

  it('crée un écran avec lien public dédié puis peut régénérer le lien', async () => {
    const app = buildApp();

    const createRes = await request(app)
      .post('/api/settings/screens')
      .send({
        name: 'Hall principal',
        refreshSeconds: 60,
        widgets: ['overview', 'interventions', 'stockAlerts']
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.screen.name).toBe('Hall principal');
    expect(createRes.body.screen.publicUrl).toContain('/screen/');
    expect(settingsStore.__getState().displayScreens).toHaveLength(1);

    const screenId = createRes.body.screen.id;
    const originalToken = createRes.body.screen.token;

    const regenerateRes = await request(app)
      .post(`/api/settings/screens/${screenId}/regenerate`)
      .send({});

    expect(regenerateRes.status).toBe(200);
    expect(regenerateRes.body.screen.token).not.toBe(originalToken);
    expect(regenerateRes.body.screen.publicUrl).toContain(`/screen/${encodeURIComponent(regenerateRes.body.screen.token)}`);
  });

  it('retourne un payload public avec les alertes visibles en rouge', async () => {
    settingsStore.__setState({
      displayScreens: [
        {
          id: 'screen-1',
          name: 'Accueil',
          token: 'public-token',
          refreshSeconds: 30,
          widgets: ['overview', 'interventions', 'stockAlerts'],
          createdAt: '2026-03-30T08:00:00.000Z',
          updatedAt: '2026-03-30T08:00:00.000Z'
        }
      ]
    });

    prisma.room.count.mockResolvedValue(12);
    prisma.equipment.count.mockImplementation(async ({ where } = {}) => {
      if (where?.status === 'REPAIR') return 2;
      if (where?.discoveryStatus === 'PENDING') return 1;
      return 54;
    });
    prisma.intervention.count.mockResolvedValue(3);
    prisma.intervention.findMany.mockResolvedValue([
      {
        id: 'int-1',
        title: 'Projecteur hors service',
        status: 'OPEN',
        priority: 'HIGH',
        createdAt: new Date('2026-03-30T08:30:00.000Z'),
        room: { name: 'Salle 201', number: '201' },
        equipment: { name: 'Vidéoprojecteur Epson' }
      }
    ]);
    prisma.stockItem.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        name: 'Toner noir',
        quantity: 1,
        minQuantity: 3,
        category: 'Impression',
        location: 'Réserve',
        supplier: { name: 'HP' }
      }
    ]);

    const res = await request(buildApp()).get('/api/display/public-token');

    expect(res.status).toBe(200);
    expect(res.body.screen.name).toBe('Accueil');
    expect(res.body.alertCount).toBeGreaterThan(0);
    expect(res.body.widgets.some(widget => widget.id === 'overview' && widget.tone === 'alert')).toBe(true);
    expect(res.body.widgets.some(widget => widget.id === 'interventions' && widget.items[0].alert)).toBe(true);
    expect(res.body.widgets.some(widget => widget.id === 'stockAlerts' && widget.items[0].title === 'Toner noir')).toBe(true);
  });

  it('retourne 404 pour un écran inconnu', async () => {
    const res = await request(buildApp()).get('/api/display/unknown-token');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Écran introuvable');
  });
});
