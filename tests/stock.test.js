const request = require('supertest');

// Mock auth middleware AVANT d'importer app
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

// Mock du client Prisma partagé
jest.mock('../src/lib/prisma', () => ({
  stockItem: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  stockMovement: {
    findMany: jest.fn(),
    create: jest.fn()
  },
  supplier: {
    findMany: jest.fn()
  },
  user: {
    findUnique: jest.fn()
  },
  $transaction: jest.fn()
}));

// Mock @prisma/client (utilisé par d'autres routes chargées via app.js)
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    supplier: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    user: { findUnique: jest.fn() }
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const mockItem = {
  id: 'item-1',
  name: 'Câble HDMI',
  reference: 'HDMI-2M',
  category: 'Câblerie',
  description: 'Câble HDMI 2m',
  quantity: 10,
  minQuantity: 5,
  unitCost: 8.99,
  location: 'Armoire A',
  supplierId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  supplier: null,
  _count: { movements: 3 }
};

const mockMovement = {
  id: 'mov-1',
  stockItemId: 'item-1',
  type: 'IN',
  quantity: 5,
  reason: 'Réapprovisionnement',
  interventionId: null,
  userId: 'user-1',
  createdAt: new Date().toISOString(),
  user: { id: 'user-1', name: 'Admin' }
};

describe('GET /api/stock', () => {
  it('retourne la liste des articles', async () => {
    prisma.stockItem.findMany.mockResolvedValue([mockItem]);
    const res = await request(app).get('/api/stock');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('Câble HDMI');
  });
});

describe('GET /api/stock/alerts', () => {
  it('retourne les articles sous le seuil', async () => {
    const lowItem = { ...mockItem, quantity: 3, minQuantity: 5, supplier: null };
    prisma.stockItem.findMany.mockResolvedValue([lowItem]);
    const res = await request(app).get('/api/stock/alerts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('items');
    expect(res.body.count).toBe(1);
  });

  it('retourne count=0 si aucun article sous le seuil', async () => {
    const okItem = { ...mockItem, quantity: 10, minQuantity: 5, supplier: null };
    prisma.stockItem.findMany.mockResolvedValue([okItem]);
    const res = await request(app).get('/api/stock/alerts');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe('GET /api/stock/categories', () => {
  it('retourne la liste des catégories', async () => {
    prisma.stockItem.findMany.mockResolvedValue([{ category: 'Câblerie' }, { category: 'RAM' }]);
    const res = await request(app).get('/api/stock/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/stock/:id', () => {
  it('retourne un article par ID', async () => {
    prisma.stockItem.findUnique.mockResolvedValue({ ...mockItem, movements: [] });
    const res = await request(app).get('/api/stock/item-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('item-1');
  });

  it('retourne 404 si inexistant', async () => {
    prisma.stockItem.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/stock/notfound');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/stock', () => {
  it('crée un article avec name', async () => {
    prisma.stockItem.create.mockResolvedValue(mockItem);
    const res = await request(app).post('/api/stock').send({ name: 'Câble HDMI' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Câble HDMI');
  });

  it('refuse si name manquant', async () => {
    const res = await request(app).post('/api/stock').send({});
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/stock/:id', () => {
  it('met à jour un article', async () => {
    prisma.stockItem.findUnique.mockResolvedValue(mockItem);
    prisma.stockItem.update.mockResolvedValue({ ...mockItem, location: 'Armoire B' });
    const res = await request(app).patch('/api/stock/item-1').send({ location: 'Armoire B' });
    expect(res.status).toBe(200);
    expect(res.body.location).toBe('Armoire B');
  });

  it('retourne 404 si inexistant', async () => {
    prisma.stockItem.findUnique.mockResolvedValue(null);
    const res = await request(app).patch('/api/stock/notfound').send({ location: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/stock/:id', () => {
  it('supprime un article', async () => {
    prisma.stockItem.findUnique.mockResolvedValue(mockItem);
    prisma.stockItem.delete.mockResolvedValue(mockItem);
    const res = await request(app).delete('/api/stock/item-1');
    expect(res.status).toBe(200);
  });

  it('retourne 404 si inexistant', async () => {
    prisma.stockItem.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/stock/notfound');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/stock/:id/movements', () => {
  it('enregistre un mouvement IN', async () => {
    prisma.stockItem.findUnique.mockResolvedValue({ ...mockItem, movements: [] });
    prisma.$transaction.mockResolvedValue([mockMovement, { ...mockItem, quantity: 15 }]);
    const res = await request(app)
      .post('/api/stock/item-1/movements')
      .send({ type: 'IN', quantity: 5, reason: 'Réapprovisionnement' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('IN');
  });

  it('retourne 409 si OUT et stock insuffisant', async () => {
    prisma.stockItem.findUnique.mockResolvedValue({ ...mockItem, quantity: 2, movements: [] });
    const res = await request(app)
      .post('/api/stock/item-1/movements')
      .send({ type: 'OUT', quantity: 5 });
    expect(res.status).toBe(409);
  });

  it('retourne 400 si type invalide', async () => {
    const res = await request(app)
      .post('/api/stock/item-1/movements')
      .send({ type: 'INVALID', quantity: 3 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/stock/:id/movements', () => {
  it('retourne l\'historique des mouvements', async () => {
    prisma.stockItem.findUnique.mockResolvedValue({ ...mockItem, movements: [] });
    prisma.stockMovement.findMany.mockResolvedValue([mockMovement]);
    const res = await request(app).get('/api/stock/item-1/movements');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].type).toBe('IN');
  });
});
