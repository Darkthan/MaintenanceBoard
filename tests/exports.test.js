const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'a@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

jest.mock('../src/lib/prisma', () => ({
  supplier: { findMany: jest.fn() },
  stockItem: { findMany: jest.fn() },
  stockMovement: { findMany: jest.fn() },
  equipment: { findMany: jest.fn() },
  intervention: { findMany: jest.fn() },
  order: { findMany: jest.fn() },
  user: { findUnique: jest.fn() }
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

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('GET /downloads/export/suppliers', () => {
  it('retourne 200 et content-type xlsx', async () => {
    prisma.supplier.findMany.mockResolvedValue([
      {
        id: 'sup-1',
        name: 'Dell France',
        contact: 'Jean',
        email: 'jean@dell.fr',
        phone: '0102030405',
        website: 'https://dell.fr',
        address: '1 rue Tech',
        notes: null,
        createdAt: new Date().toISOString(),
        _count: { orders: 3 }
      }
    ]);
    const res = await request(app).get('/downloads/export/suppliers');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_CONTENT_TYPE);
  });

  it('retourne un fichier xlsx non vide même si aucun fournisseur', async () => {
    prisma.supplier.findMany.mockResolvedValue([]);
    const res = await request(app).get('/downloads/export/suppliers');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_CONTENT_TYPE);
  });
});

describe('GET /downloads/export/stock', () => {
  it('retourne 200 et content-type xlsx', async () => {
    prisma.stockItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        name: 'Câble HDMI',
        reference: 'HDMI-2M',
        category: 'Câblerie',
        location: 'Armoire A',
        quantity: 10,
        minQuantity: 2,
        unitCost: 5.5,
        createdAt: new Date().toISOString(),
        supplier: { name: 'Dell France' }
      }
    ]);
    const res = await request(app).get('/downloads/export/stock');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_CONTENT_TYPE);
  });
});

describe('GET /downloads/export/stock-movements', () => {
  it('retourne 200 et content-type xlsx', async () => {
    prisma.stockMovement.findMany.mockResolvedValue([
      {
        id: 'mov-1',
        type: 'IN',
        quantity: 5,
        reason: 'Réapprovisionnement',
        createdAt: new Date().toISOString(),
        stockItem: { name: 'Câble HDMI' },
        user: { name: 'Admin' }
      }
    ]);
    const res = await request(app).get('/downloads/export/stock-movements');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_CONTENT_TYPE);
  });
});

describe('GET /downloads/export/equipment', () => {
  it('retourne 200 et content-type xlsx', async () => {
    prisma.equipment.findMany.mockResolvedValue([
      {
        id: 'eq-1',
        name: 'PC Bureau',
        type: 'PC',
        brand: 'Dell',
        model: 'OptiPlex',
        serialNumber: 'SN001',
        status: 'ACTIVE',
        purchaseDate: new Date().toISOString(),
        warrantyEnd: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        room: { name: 'Salle 101', number: '101' }
      }
    ]);
    const res = await request(app).get('/downloads/export/equipment');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_CONTENT_TYPE);
  });
});
