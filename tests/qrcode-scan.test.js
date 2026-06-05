const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  },
  optionalAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  }
}));

jest.mock('../src/lib/prisma', () => ({
  room: {
    findUnique: jest.fn()
  },
  equipment: {
    findUnique: jest.fn(),
    findFirst: jest.fn()
  },
  user: {
    findUnique: jest.fn()
  }
}));

jest.mock('@prisma/client', () => {
  const mockPrisma = {
    user: { findUnique: jest.fn() }
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

const app = require('../src/app');
const prisma = require('../src/lib/prisma');

describe('scan mobile equipment resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.room.findUnique.mockResolvedValue(null);
    prisma.equipment.findUnique.mockResolvedValue(null);
    prisma.equipment.findFirst.mockResolvedValue(null);
  });

  it('sert la page de scan technicien', async () => {
    const res = await request(app).get('/scan-code.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Scanner un équipement');
    expect(res.text).toContain('BarcodeDetector');
    expect(res.text).toContain('/qrcode/scan/resolve');
  });

  it('affiche un bouton icone de scan sur la page equipements', async () => {
    const res = await request(app).get('/equipment.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/scan-code.html"');
    expect(res.text).toContain('aria-label="Scanner un QR code ou un code-barres"');
    expect(res.text).not.toContain('>Scanner</a>');
  });

  it('resout un code-barres contenant uniquement le numero de serie', async () => {
    prisma.equipment.findFirst.mockResolvedValue({
      id: 'eq-serial-1',
      name: 'PC CDI 01',
      serialNumber: 'SN-DELL-001',
      room: null
    });

    const res = await request(app)
      .post('/api/qrcode/scan/resolve')
      .send({ code: 'SN-DELL-001' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      type: 'equipment',
      match: 'serialNumber',
      href: '/equipment.html?focus=eq-serial-1'
    }));
    expect(prisma.equipment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { serialNumber: { equals: 'SN-DELL-001' } }
    }));
  });

  it('resout un QR MaintenanceBoard contenant une URL de scan', async () => {
    prisma.equipment.findUnique.mockResolvedValue({
      id: 'eq-token-1',
      name: 'PC B12',
      qrToken: 'qr-token-1',
      room: { id: 'room-1', name: 'B12', number: '12', building: 'Bat A' }
    });

    const res = await request(app)
      .post('/api/qrcode/scan/resolve')
      .send({ code: 'https://maintenance.test/scan?token=qr-token-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      type: 'equipment',
      match: 'qrToken',
      href: '/equipment.html?focus=eq-token-1'
    }));
    expect(prisma.equipment.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { qrToken: 'qr-token-1' }
    }));
  });

  it('extrait le numero de serie depuis un QR JSON', async () => {
    prisma.equipment.findFirst.mockResolvedValue({
      id: 'eq-json-1',
      name: 'Latitude 5440',
      serialNumber: 'JSON-SN-42',
      room: null
    });

    const res = await request(app)
      .post('/api/qrcode/scan/resolve')
      .send({ code: JSON.stringify({ serialNumber: 'JSON-SN-42', model: 'Latitude 5440' }) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      type: 'equipment',
      match: 'serialNumber',
      serialNumber: 'JSON-SN-42',
      href: '/equipment.html?focus=eq-json-1'
    }));
  });
});
