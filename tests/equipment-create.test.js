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

jest.mock('../src/middleware/upload', () => ({
  uploadImport: {
    single: () => (_req, _res, next) => next()
  }
}));

jest.mock('../src/services/importService', () => ({
  parseFile: jest.fn(),
  validateEquipmentRow: jest.fn(),
  cleanupFile: jest.fn()
}));

jest.mock('../src/services/qrService', () => ({
  generateQrCode: jest.fn()
}));

jest.mock('../src/lib/prisma', () => ({
  equipment: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const equipmentRouter = require('../src/routes/equipment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/equipment', equipmentRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('POST /api/equipment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepte roomId a null lors de la creation', async () => {
    prisma.equipment.create.mockResolvedValue({
      id: 'equip-1',
      name: 'PC Salle profs',
      type: 'PC',
      status: 'ACTIVE',
      room: null,
      supplierRef: null
    });

    const res = await request(buildApp())
      .post('/api/equipment')
      .send({
        name: 'PC Salle profs',
        type: 'PC',
        status: 'ACTIVE',
        roomId: null
      });

    expect(res.status).toBe(201);
    expect(prisma.equipment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        roomId: null
      })
    }));
  });

  it('exclut les équipements DEEE de la liste principale par défaut', async () => {
    prisma.equipment.findMany.mockResolvedValue([]);
    prisma.equipment.count.mockResolvedValue(0);

    const res = await request(buildApp()).get('/api/equipment');

    expect(res.status).toBe(200);
    expect(prisma.equipment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { not: 'DEEE' } })
    }));
  });

  it('crée une fiche DEEE minimale avec seulement un numéro de série', async () => {
    prisma.equipment.findUnique.mockResolvedValue(null);
    prisma.equipment.create.mockResolvedValue({
      id: 'deee-1',
      name: 'Equipement DEEE SN-DEEE-001',
      type: 'DEEE',
      serialNumber: 'SN-DEEE-001',
      status: 'DEEE',
      room: null,
      supplierRef: null
    });

    const res = await request(buildApp())
      .post('/api/equipment/deee')
      .send({ serialNumber: 'SN-DEEE-001' });

    expect(res.status).toBe(201);
    expect(res.body.action).toBe('created');
    expect(prisma.equipment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        serialNumber: 'SN-DEEE-001',
        status: 'DEEE',
        roomId: null
      })
    }));
  });

  it('bascule une fiche existante en DEEE via son numéro de série', async () => {
    prisma.equipment.findUnique.mockResolvedValueOnce({
      id: 'equip-1',
      name: 'PC existant',
      serialNumber: 'SN-EXISTING',
      description: null
    });
    prisma.equipment.update.mockResolvedValue({
      id: 'equip-1',
      name: 'PC existant',
      serialNumber: 'SN-EXISTING',
      status: 'DEEE',
      room: null,
      supplierRef: null
    });

    const res = await request(buildApp())
      .post('/api/equipment/deee')
      .send({ serialNumber: 'SN-EXISTING' });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('updated');
    expect(prisma.equipment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'equip-1' },
      data: expect.objectContaining({ status: 'DEEE', roomId: null })
    }));
  });
});

describe('Références des équipements via la page', () => {
  beforeEach(() => jest.clearAllMocks());
  it('enregistre uniquement les numéros normalisés à la création', async () => {
    prisma.equipment.create.mockResolvedValue({ id: 'pc1', invoiceNumber: 'F-01', deliveryNoteNumber: 'BL-01' });
    const res = await request(buildApp()).post('/api/equipment').send({ name: 'PC', type: 'PC', invoiceNumber: ' F-01 ', deliveryNoteNumber: ' BL-01 ' });
    expect(res.status).toBe(201);
    expect(prisma.equipment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ invoiceNumber: 'F-01', deliveryNoteNumber: 'BL-01' }) }));
  });
  it('permet de compléter la facture sans effacer le BL et d’effacer explicitement', async () => {
    prisma.equipment.update.mockResolvedValue({ id: 'pc1' });
    const res = await request(buildApp()).patch('/api/equipment/pc1').send({ invoiceNumber: ' F-02 ' });
    expect(res.status).toBe(200);
    expect(prisma.equipment.update.mock.calls[0][0].data).toEqual({ invoiceNumber: 'F-02' });
    await request(buildApp()).patch('/api/equipment/pc1').send({ invoiceNumber: null, deliveryNoteNumber: '' });
    expect(prisma.equipment.update.mock.calls[1][0].data).toEqual({ invoiceNumber: null, deliveryNoteNumber: null });
  });
  it('refuse les références invalides avant toute écriture', async () => {
    for (const value of [42, 'F'.repeat(201), {}]) {
      const res = await request(buildApp()).patch('/api/equipment/pc1').send({ invoiceNumber: value });
      expect(res.status).toBe(400);
    }
    expect(prisma.equipment.update).not.toHaveBeenCalled();
  });
});
