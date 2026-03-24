const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'a@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

jest.mock('../src/lib/prisma', () => ({
  room: { findMany: jest.fn() },
  equipment: { findMany: jest.fn() },
  intervention: { findMany: jest.fn() },
  order: { findMany: jest.fn() },
  orderAttachment: { findMany: jest.fn() },
  signatureRequest: { findMany: jest.fn() },
  supplier: { findMany: jest.fn() },
  stockItem: { findMany: jest.fn() },
  stockMovement: { findMany: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() }
}));

jest.mock('@prisma/client', () => {
  const mockPrisma = {
    supplier: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    user: { findUnique: jest.fn() }
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

const app = require('../src/app');
const prisma = require('../src/lib/prisma');

function setupEmptyMocks() {
  prisma.room.findMany.mockResolvedValue([]);
  prisma.equipment.findMany.mockResolvedValue([]);
  prisma.intervention.findMany.mockResolvedValue([]);
  prisma.order.findMany.mockResolvedValue([]);
  prisma.orderAttachment.findMany.mockResolvedValue([]);
  prisma.signatureRequest.findMany.mockResolvedValue([]);
  prisma.supplier.findMany.mockResolvedValue([]);
  prisma.stockItem.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
}

describe('GET /api/search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupEmptyMocks();
  });

  it('retourne 200 avec résultats groupés pour une requête valide', async () => {
    prisma.room.findMany.mockResolvedValue([
      {
        id: 'room-1',
        name: 'Salle Informatique',
        number: '101',
        building: 'Bâtiment A',
        floor: 1,
        description: 'Salle principale',
        _count: { equipment: 5, interventions: 2 }
      }
    ]);

    const res = await request(app).get('/api/search?q=informatique');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('retourne 200 avec results tableau pour une requête courte', async () => {
    const res = await request(app).get('/api/search?q=ab');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('retourne 200 avec actions rapides si query manquante', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('retourne les résultats groupés avec les bons types', async () => {
    prisma.room.findMany.mockResolvedValue([
      {
        id: 'room-2',
        name: 'Salle de réunion',
        number: '202',
        building: 'Bâtiment B',
        floor: 2,
        description: null,
        _count: { equipment: 2, interventions: 0 }
      }
    ]);
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'ord-1',
        title: 'Commande fournitures',
        description: null,
        status: 'PENDING',
        supplier: 'Dell',
        deploymentTags: '[]',
        createdAt: new Date(),
        requester: { id: 'u1', name: 'Admin' },
        _count: { items: 3 }
      }
    ]);

    const res = await request(app).get('/api/search?q=salle');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'room')).toBe(true);
  });

  it('retrouve une salle meme si la requete ne contient pas les accents', async () => {
    prisma.room.findMany.mockResolvedValue([
      {
        id: 'room-3',
        name: 'Salle Étude',
        number: '303',
        building: 'Bâtiment C',
        floor: 3,
        description: 'Salle dédiée aux révisions',
        _count: { equipment: 1, interventions: 0 }
      }
    ]);

    const res = await request(app).get('/api/search?q=etude');
    expect(res.status).toBe(200);
    expect(res.body.results.some(r => r.type === 'room' && r.title === 'Salle Étude')).toBe(true);
  });
});
