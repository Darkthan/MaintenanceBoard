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

  afterEach(() => {
    jest.useRealTimers();
  });

  it('crée un écran avec lien public dédié puis peut régénérer le lien', async () => {
    const app = buildApp();

    const createRes = await request(app)
      .post('/api/settings/screens')
      .send({
        name: 'Hall principal',
        alertsEnabled: false,
        openingHour: '07:30',
        layoutMode: 'MANUAL',
        refreshSeconds: 60,
        widgets: ['overview', 'interventions', 'stockAlerts'],
        widgetLayouts: [
          { id: 'interventions', size: 'hero' },
          { id: 'overview', size: 'wide' },
          { id: 'stockAlerts', size: 'compact' }
        ]
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.screen.name).toBe('Hall principal');
    expect(createRes.body.screen.alertsEnabled).toBe(false);
    expect(createRes.body.screen.openingHour).toBe('07:30');
    expect(createRes.body.screen.layoutMode).toBe('MANUAL');
    expect(createRes.body.screen.widgetLayouts.map(item => item.id)).toEqual(['interventions', 'overview', 'stockAlerts']);
    expect(createRes.body.screen.widgetLayouts[0].size).toBe('hero');
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
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-30T08:30:00.000Z'));

    settingsStore.__setState({
      displayScreens: [
        {
          id: 'screen-1',
          name: 'Accueil',
          token: 'public-token',
          alertsEnabled: true,
          openingHour: '08:00',
          refreshSeconds: 30,
          widgets: ['overview', 'interventions', 'stockAlerts', 'upcomingLoans'],
          createdAt: '2026-03-30T08:00:00.000Z',
          updatedAt: '2026-03-30T08:00:00.000Z'
        }
      ]
    });

    prisma.room.count.mockResolvedValue(12);
    prisma.equipment.count.mockImplementation(async ({ where } = {}) => {
      if (where?.status === 'REPAIR') return 2;
      return 54;
    });
    prisma.intervention.count.mockImplementation(async ({ where } = {}) => where?.status ? 3 : 9);
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
    prisma.loanReservation.findMany
      .mockResolvedValueOnce([
        {
          id: 'loan-overview-late',
          status: 'APPROVED',
          requesterName: 'Deux jours',
          requesterOrganization: 'Lycée Beaupeyrat',
          startAt: new Date('2026-04-01T12:00:00.000Z'),
          endAt: new Date('2026-04-01T14:00:00.000Z'),
          createdAt: new Date('2026-03-20T08:00:00.000Z'),
          resource: { name: 'Caméra', location: 'Local' }
        },
        {
          id: 'loan-overview-1',
          status: 'APPROVED',
          requesterName: 'Lycée Beaupeyrat',
          requesterOrganization: 'Lycée Beaupeyrat',
          startAt: new Date('2026-03-30T12:00:00.000Z'),
          endAt: new Date('2026-03-30T14:00:00.000Z'),
          createdAt: new Date('2026-03-29T08:00:00.000Z'),
          resource: { name: 'Chariot iPad', location: 'Réserve' }
        }
      ])
      .mockResolvedValueOnce([
      {
        id: 'loan-1',
        status: 'APPROVED',
        requesterName: 'Lycée Beaupeyrat',
        requesterOrganization: 'Lycée Beaupeyrat',
        startAt: new Date('2026-03-30T12:00:00.000Z'),
        endAt: new Date('2026-03-30T14:00:00.000Z'),
        resource: { name: 'Chariot iPad', location: 'Réserve' }
      },
      {
        id: 'loan-2',
        status: 'APPROVED',
        requesterName: 'Collège',
        requesterOrganization: 'Collège',
        startAt: new Date('2026-03-31T12:00:00.000Z'),
        endAt: new Date('2026-03-31T14:00:00.000Z'),
        resource: { name: 'Caméra', location: 'Local' }
      }
    ]);

    const res = await request(buildApp()).get('/api/display/public-token');

    expect(res.status).toBe(200);
    expect(res.body.screen.name).toBe('Accueil');
    expect(res.body.alertCount).toBeGreaterThan(0);
    expect(res.body.widgets.some(widget => widget.id === 'overview' && widget.tone === 'alert')).toBe(true);
    const overview = res.body.widgets.find(widget => widget.id === 'overview');
    expect(overview.stats.find(stat => stat.key === 'interventions')).toMatchObject({
      label: 'Interventions',
      value: 9,
      alert: false
    });
    expect(overview.stats.find(stat => stat.key === 'nextLoan')).toMatchObject({
      label: 'Prochaine réservation',
      countdownTo: '2026-03-30T12:00:00.000Z',
      alert: false
    });
    expect(res.body.widgets.some(widget => widget.id === 'interventions' && widget.items[0].alert)).toBe(true);
    expect(res.body.widgets.some(widget => widget.id === 'stockAlerts' && widget.items[0].title === 'Toner noir')).toBe(true);
    const loansWidget = res.body.widgets.find(widget => widget.id === 'upcomingLoans');
    expect(loansWidget.items[0].alert).toBe(true);
    expect(loansWidget.items[1].alert).toBe(false);
    expect(res.body.widgets[0].id).toBe('overview');
    expect(res.body.widgets[0].layout.size).toBe('hero');
  });

  it('ne met pas en rouge une intervention deja en cours de traitement', async () => {
    settingsStore.__setState({
      displayScreens: [
        {
          id: 'screen-4',
          name: 'Support',
          token: 'support-token',
          alertsEnabled: true,
          refreshSeconds: 30,
          widgets: ['overview', 'interventions'],
          createdAt: '2026-03-30T08:00:00.000Z',
          updatedAt: '2026-03-30T08:00:00.000Z'
        }
      ]
    });

    prisma.intervention.count.mockImplementation(async ({ where } = {}) => where?.status ? 0 : 7);
    prisma.intervention.findMany.mockResolvedValue([
      {
        id: 'int-3',
        title: 'PC salle info',
        status: 'IN_PROGRESS',
        priority: 'CRITICAL',
        createdAt: new Date('2026-03-30T10:00:00.000Z'),
        room: { name: 'Info', number: '14' },
        equipment: { name: 'PC-14' }
      }
    ]);

    const res = await request(buildApp()).get('/api/display/support-token');

    expect(res.status).toBe(200);
    const overview = res.body.widgets.find(widget => widget.id === 'overview');
    const interventions = res.body.widgets.find(widget => widget.id === 'interventions');
    expect(overview.stats.find(stat => stat.key === 'interventions').alert).toBe(false);
    expect(overview.stats.find(stat => stat.key === 'interventions').value).toBe(7);
    expect(interventions.tone).toBe('neutral');
    expect(interventions.items[0].alert).toBe(false);
  });

  it('met en rouge les prets de demain seulement avant l heure d ouverture', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-30T04:30:00.000Z'));

    settingsStore.__setState({
      displayScreens: [
        {
          id: 'screen-5',
          name: 'Prêts',
          token: 'loans-token',
          alertsEnabled: true,
          openingHour: '08:00',
          refreshSeconds: 30,
          widgets: ['upcomingLoans'],
          createdAt: '2026-03-30T08:00:00.000Z',
          updatedAt: '2026-03-30T08:00:00.000Z'
        }
      ]
    });

    prisma.loanReservation.findMany.mockResolvedValue([
      {
        id: 'loan-3',
        status: 'APPROVED',
        requesterName: 'Lycée',
        requesterOrganization: 'Lycée',
        startAt: new Date('2026-03-31T08:00:00.000Z'),
        endAt: new Date('2026-03-31T10:00:00.000Z'),
        resource: { name: 'Chariot PC', location: 'Reserve' }
      }
    ]);

    const beforeOpening = await request(buildApp()).get('/api/display/loans-token');

    expect(beforeOpening.status).toBe(200);
    expect(beforeOpening.body.widgets[0].tone).toBe('alert');
    expect(beforeOpening.body.widgets[0].items[0].alert).toBe(true);

    jest.setSystemTime(new Date('2026-03-30T07:30:00.000Z'));

    const afterOpening = await request(buildApp()).get('/api/display/loans-token');

    expect(afterOpening.status).toBe(200);
    expect(afterOpening.body.widgets[0].tone).toBe('neutral');
    expect(afterOpening.body.widgets[0].items[0].alert).toBe(false);
  });

  it('désactive toutes les alertes visuelles quand l écran le demande', async () => {
    settingsStore.__setState({
      displayScreens: [
        {
          id: 'screen-2',
          name: 'Bibliothèque',
          token: 'mute-token',
          alertsEnabled: false,
          openingHour: '08:00',
          refreshSeconds: 30,
          widgets: ['interventions', 'upcomingLoans'],
          createdAt: '2026-03-30T08:00:00.000Z',
          updatedAt: '2026-03-30T08:00:00.000Z'
        }
      ]
    });

    prisma.intervention.count.mockResolvedValue(1);
    prisma.intervention.findMany.mockResolvedValue([
      {
        id: 'int-2',
        title: 'PC salle info',
        status: 'OPEN',
        priority: 'CRITICAL',
        createdAt: new Date(),
        room: { name: 'Info', number: '14' },
        equipment: { name: 'PC-14' }
      }
    ]);
    prisma.loanReservation.findMany.mockResolvedValue([
      {
        id: 'loan-2',
        status: 'APPROVED',
        requesterName: 'Collège',
        requesterOrganization: 'Collège',
        startAt: new Date(),
        endAt: new Date(Date.now() + 60 * 60 * 1000),
        resource: { name: 'Caméra', location: 'Local' }
      }
    ]);

    const res = await request(buildApp()).get('/api/display/mute-token');

    expect(res.status).toBe(200);
    expect(res.body.screen.alertsEnabled).toBe(false);
    expect(res.body.alertCount).toBe(0);
    expect(res.body.widgets.every(widget => widget.tone === 'neutral')).toBe(true);
    expect(res.body.widgets.every(widget => widget.items.every(item => item.alert === false))).toBe(true);
  });

  it('respecte l ordre et la taille en mode manuel', async () => {
    settingsStore.__setState({
      displayScreens: [
        {
          id: 'screen-3',
          name: 'Accueil manuel',
          token: 'manual-token',
          alertsEnabled: true,
          openingHour: '08:00',
          layoutMode: 'MANUAL',
          refreshSeconds: 30,
          widgets: ['orders', 'overview'],
          widgetLayouts: [
            { id: 'orders', size: 'hero' },
            { id: 'overview', size: 'compact' }
          ],
          createdAt: '2026-03-30T08:00:00.000Z',
          updatedAt: '2026-03-30T08:00:00.000Z'
        }
      ]
    });

    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        title: 'Cartouches',
        supplier: 'Canon',
        requester: { name: 'Admin' },
        status: 'PENDING'
      }
    ]);

    const res = await request(buildApp()).get('/api/display/manual-token');

    expect(res.status).toBe(200);
    expect(res.body.screen.layoutMode).toBe('MANUAL');
    expect(res.body.widgets.map(widget => widget.id)).toEqual(['orders', 'overview']);
    expect(res.body.widgets[0].layout.size).toBe('hero');
    expect(res.body.widgets[1].layout.size).toBe('compact');
  });

  it('retourne 404 pour un écran inconnu', async () => {
    const res = await request(buildApp()).get('/api/display/unknown-token');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Écran introuvable');
  });
});
