const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  },
  optionalAuth: (_req, _res, next) => next()
}));

jest.mock('../src/lib/prisma', () => ({
  room: {
    findMany: jest.fn()
  },
  equipment: {
    findMany: jest.fn()
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

describe('bulk QR print page', () => {
  it('sert la page d impression avec la previsualisation A4 2 par feuille', async () => {
    const res = await request(app).get('/qr-print.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Impression QR en masse');
    expect(res.text).toContain('print-sheet');
    expect(res.text).toContain('/rooms/print-list');
    expect(res.text).toContain('/equipment/print-list');
    expect(res.text).toContain('window.print()');
  });

  it('expose une liste imprimable des salles', async () => {
    prisma.room.findMany.mockResolvedValue([
      { id: 'room-1', name: 'B12', building: 'Bat A', number: '12' }
    ]);

    const res = await request(app).get('/api/rooms/print-list');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'room-1', name: 'B12', building: 'Bat A', number: '12', qrCodeUrl: '/api/rooms/room-1/qrcode' }
    ]);
  });

  it('expose une liste imprimable des equipements', async () => {
    prisma.equipment.findMany.mockResolvedValue([
      { id: 'eq-1', name: 'PC Salle B12', type: 'PC', room: { name: 'B12', number: '12', building: 'Bat A' } }
    ]);

    const res = await request(app).get('/api/equipment/print-list');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'eq-1',
        name: 'PC Salle B12',
        type: 'PC',
        room: { name: 'B12', number: '12', building: 'Bat A' },
        qrCodeUrl: '/api/equipment/eq-1/qrcode'
      }
    ]);
  });

  it('ajoute un acces rapide depuis les pages salles et equipements', async () => {
    const [roomsRes, equipmentRes] = await Promise.all([
      request(app).get('/rooms.html'),
      request(app).get('/equipment.html')
    ]);

    expect(roomsRes.status).toBe(200);
    expect(equipmentRes.status).toBe(200);
    expect(roomsRes.text).toContain('/qr-print.html?type=rooms');
    expect(equipmentRes.text).toContain('/qr-print.html?type=equipment');
  });
});
