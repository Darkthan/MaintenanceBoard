const request = require('supertest');

// Mock prisma AVANT d'importer app
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

jest.mock('@prisma/client', () => {
  const mockPrisma = {
    supplier: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn() }
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

const app = require('../src/app');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const mockSupplier = {
  id: 'sup-1',
  name: 'Dell France',
  contact: 'Jean Dupont',
  email: 'contact@dell.fr',
  phone: '0123456789',
  website: 'https://dell.fr',
  address: '1 rue de la Tech',
  notes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  _count: { orders: 2 }
};

describe('GET /api/suppliers', () => {
  it('retourne la liste des fournisseurs', async () => {
    prisma.supplier.findMany.mockResolvedValue([mockSupplier]);
    const res = await request(app).get('/api/suppliers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('Dell France');
  });
});

describe('GET /api/suppliers/:id', () => {
  it('retourne un fournisseur par ID', async () => {
    prisma.supplier.findUnique.mockResolvedValue(mockSupplier);
    const res = await request(app).get('/api/suppliers/sup-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('sup-1');
  });

  it('retourne 404 si inexistant', async () => {
    prisma.supplier.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/suppliers/notfound');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/suppliers', () => {
  it('crée un fournisseur', async () => {
    prisma.supplier.create.mockResolvedValue(mockSupplier);
    const res = await request(app).post('/api/suppliers').send({ name: 'Dell France' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Dell France');
  });

  it('refuse si name manquant', async () => {
    const res = await request(app).post('/api/suppliers').send({});
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/suppliers/:id', () => {
  it('met à jour un fournisseur', async () => {
    prisma.supplier.findUnique.mockResolvedValue(mockSupplier);
    prisma.supplier.update.mockResolvedValue({ ...mockSupplier, contact: 'Marie Martin' });
    const res = await request(app).patch('/api/suppliers/sup-1').send({ contact: 'Marie Martin' });
    expect(res.status).toBe(200);
  });

  it('retourne 404 si inexistant', async () => {
    prisma.supplier.findUnique.mockResolvedValue(null);
    const res = await request(app).patch('/api/suppliers/notfound').send({ contact: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/suppliers/:id', () => {
  it('supprime un fournisseur sans commandes', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ ...mockSupplier, _count: { orders: 0 } });
    prisma.supplier.delete.mockResolvedValue(mockSupplier);
    const res = await request(app).delete('/api/suppliers/sup-1');
    expect(res.status).toBe(200);
  });

  it('refuse la suppression si commandes liées', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ ...mockSupplier, _count: { orders: 2 } });
    const res = await request(app).delete('/api/suppliers/sup-1');
    expect(res.status).toBe(409);
  });
});
