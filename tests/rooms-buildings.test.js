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
  validateRoomRow: jest.fn(),
  cleanupFile: jest.fn()
}));

jest.mock('../src/services/qrService', () => ({
  generateQrCode: jest.fn()
}));

jest.mock('../src/utils/settings', () => ({
  readSettings: jest.fn(),
  writeSettings: jest.fn()
}));

jest.mock('../src/lib/prisma', () => ({
  room: {
    findMany: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const { readSettings, writeSettings } = require('../src/utils/settings');
const roomsRouter = require('../src/routes/rooms');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rooms', roomsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('rooms buildings metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readSettings.mockReturnValue({
      roomBuildings: {
        'Bâtiment A': { floorsCount: 3 }
      }
    });
  });

  it('liste les bâtiments avec le nombre de salles et les métadonnées', async () => {
    prisma.room.findMany.mockResolvedValue([
      { building: 'Bâtiment A' },
      { building: 'Bâtiment A' },
      { building: 'Bâtiment B' }
    ]);

    const res = await request(buildApp()).get('/api/rooms/buildings');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { name: 'Bâtiment A', roomCount: 2, floorsCount: 3 },
      { name: 'Bâtiment B', roomCount: 1, floorsCount: null }
    ]);
  });

  it('enregistre le nombre d étages d un bâtiment', async () => {
    const res = await request(buildApp())
      .patch('/api/rooms/buildings')
      .send({ name: 'Bâtiment B', floorsCount: 5 });

    expect(res.status).toBe(200);
    expect(writeSettings).toHaveBeenCalledWith({
      roomBuildings: {
        'Bâtiment A': { floorsCount: 3 },
        'Bâtiment B': { floorsCount: 5 }
      }
    });
  });
});
