const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  }
}));

jest.mock('../src/utils/settings', () => {
  let state = { globalCalendar: { token: 'global-feed-token' } };
  return {
    readSettings: jest.fn(() => state),
    writeSettings: jest.fn(patch => {
      state = { ...state, ...patch };
      return state;
    }),
    __setState(nextState) {
      state = nextState;
    }
  };
});

jest.mock('../src/lib/prisma', () => ({
  intervention: { findMany: jest.fn() },
  loanReservation: { findMany: jest.fn() }
}));

const prisma = require('../src/lib/prisma');
const calendarRouter = require('../src/routes/calendar');
const interventionsRouter = require('../src/routes/interventions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/calendar', calendarRouter);
  app.use('/api/interventions', interventionsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('global calendar feed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retourne le lien iCal global authentifié', async () => {
    const res = await request(buildApp()).get('/api/calendar/global-feed');

    expect(res.status).toBe(200);
    expect(res.body.token).toBe('global-feed-token');
    expect(res.body.url).toContain('/api/calendar/global.ics?token=global-feed-token');
  });

  it('agrège interventions planifiées, dates dues et prêts dans le flux iCal', async () => {
    prisma.intervention.findMany.mockResolvedValue([
      {
        id: 'int-1',
        title: 'Projecteur à vérifier',
        status: 'OPEN',
        priority: 'HIGH',
        scheduledStartAt: new Date('2026-03-31T08:00:00.000Z'),
        scheduledEndAt: new Date('2026-03-31T09:00:00.000Z'),
        dueAt: new Date('2026-04-01T16:00:00.000Z'),
        room: { name: 'Salle 201', number: '201' },
        equipment: { name: 'Vidéoprojecteur', type: 'Projecteur' },
        tech: { name: 'Admin', email: 'admin@test.com' }
      }
    ]);
    prisma.loanReservation.findMany.mockResolvedValue([
      {
        id: 'loan-1',
        status: 'APPROVED',
        requesterName: 'Mme Martin',
        requesterEmail: 'martin@test.com',
        requesterOrganization: 'Lycée',
        requestedUnits: 1,
        startAt: new Date('2026-03-31T12:00:00.000Z'),
        endAt: new Date('2026-03-31T14:00:00.000Z'),
        resource: { name: 'Chariot iPad', location: 'Réserve' }
      }
    ]);

    const res = await request(buildApp()).get('/api/calendar/global.ics?token=global-feed-token');

    expect(res.status).toBe(200);
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('Intervention');
    expect(res.text).toContain('Échéance');
    expect(res.text).toContain('Prêt');
    expect(res.text).toContain('Projecteur à vérifier');
    expect(res.text).toContain('Chariot iPad');
  });
});
