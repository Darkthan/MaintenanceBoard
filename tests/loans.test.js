const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  }
}));

jest.mock('../src/config', () => ({
  appUrl: 'https://maintenanceboard.test'
}));

jest.mock('../src/lib/prisma', () => ({
  loanResource: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  loanMagicLink: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  loanReservation: {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const { loansRouter, loanPublicRouter } = require('../src/routes/loans');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loans', loansRouter);
  app.use('/api/loan-request', loanPublicRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('loan requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('verrouille un lot complet meme pour une demande partielle', async () => {
    prisma.loanMagicLink.findUnique.mockResolvedValue({
      id: 'link-1',
      token: 'magic-1',
      isActive: true,
      expiresAt: null,
      resourceId: 'resource-1'
    });
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'resource-1',
      name: 'Valise tablettes',
      totalUnits: 10,
      bundleSize: 10,
      isActive: true
    });
    prisma.loanReservation.findMany.mockResolvedValue([]);
    prisma.loanReservation.create.mockImplementation(async ({ data }) => ({
      id: 'reservation-1',
      status: 'PENDING',
      ...data,
      resource: {
        id: 'resource-1',
        name: 'Valise tablettes',
        totalUnits: 10,
        bundleSize: 10,
        isActive: true
      }
    }));

    const res = await request(buildApp())
      .post('/api/loan-request/magic-1/requests')
      .send({
        resourceId: 'resource-1',
        requesterName: 'Jean Dupont',
        requesterEmail: 'jean@example.com',
        startAt: '2026-03-25T08:00:00.000Z',
        endAt: '2026-03-25T12:00:00.000Z',
        requestedUnits: 3,
        additionalNeeds: 'Installer une application dédiée'
      });

    expect(res.status).toBe(201);
    expect(prisma.loanReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestedUnits: 3,
        reservedSlots: 1
      })
    }));
  });

  it('refuse une seconde demande quand un lot complet est deja verrouille', async () => {
    prisma.loanMagicLink.findUnique.mockResolvedValue({
      id: 'link-1',
      token: 'magic-1',
      isActive: true,
      expiresAt: null,
      resourceId: 'resource-1'
    });
    prisma.loanResource.findUnique.mockResolvedValue({
      id: 'resource-1',
      name: 'Valise tablettes',
      totalUnits: 10,
      bundleSize: 10,
      isActive: true
    });
    prisma.loanReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-existing',
        reservedSlots: 1,
        status: 'APPROVED',
        startAt: new Date('2026-03-25T08:00:00.000Z'),
        endAt: new Date('2026-03-25T12:00:00.000Z')
      }
    ]);

    const res = await request(buildApp())
      .post('/api/loan-request/magic-1/requests')
      .send({
        resourceId: 'resource-1',
        requesterName: 'Marie Martin',
        requesterEmail: 'marie@example.com',
        startAt: '2026-03-25T09:00:00.000Z',
        endAt: '2026-03-25T11:00:00.000Z',
        requestedUnits: 1
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Disponibilite insuffisante|Disponibilité insuffisante/i);
    expect(prisma.loanReservation.create).not.toHaveBeenCalled();
  });
});
