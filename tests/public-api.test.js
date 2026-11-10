jest.mock('../src/lib/prisma', () => ({
  mcpToken: { findUnique: jest.fn(), update: jest.fn() },
  equipment: { findUnique: jest.fn(), findMany: jest.fn() },
  room: { findUnique: jest.fn(), findMany: jest.fn() }
}));

const express = require('express');
const prisma = require('../src/lib/prisma');
const publicApiRouter = require('../src/routes/publicApi');
const request = require('./helpers/in-process-request');

const app = express();
app.use(express.json());
app.use('/api/v1', publicApiRouter);

const owner = { id: 'admin1', name: 'Admin', email: 'a@x.test', contactEmail: null, role: 'ADMIN', isActive: true };

function mockToken({ scopes = [], isActive = true, expiresAt = null } = {}) {
  prisma.mcpToken.findUnique.mockResolvedValue({
    id: 'tok1', label: 'Intégration', scopes: JSON.stringify(scopes), isActive, expiresAt, createdBy: owner
  });
  prisma.mcpToken.update.mockResolvedValue({});
}

describe('API publique /api/v1', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse sans en-tête Authorization', async () => {
    const res = await request(app).get('/api/v1/equipment');
    expect(res.status).toBe(401);
  });

  it('refuse un token inconnu', async () => {
    prisma.mcpToken.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/equipment').set('Authorization', 'Bearer mcp_bad');
    expect(res.status).toBe(401);
  });

  it('refuse un token expiré', async () => {
    mockToken({ scopes: ['equipment:read'], expiresAt: new Date(Date.now() - 1000) });
    const res = await request(app).get('/api/v1/equipment').set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(401);
  });

  it('refuse sans le scope requis', async () => {
    mockToken({ scopes: ['rooms:read'] });
    const res = await request(app).get('/api/v1/equipment').set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(403);
  });

  it('liste les équipements avec le scope equipment:read', async () => {
    mockToken({ scopes: ['equipment:read'] });
    prisma.equipment.findMany.mockResolvedValue([{ id: 'eq1', name: 'PC-01', agentToken: 'secret', qrToken: 'secret', agentAlertState: null }]);
    const res = await request(app).get('/api/v1/equipment').set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe('eq1');
    expect(res.body.data[0].agentToken).toBeUndefined();
  });

  it('refuse /rooms sans le scope rooms:read', async () => {
    mockToken({ scopes: ['equipment:read'] });
    const res = await request(app).get('/api/v1/rooms').set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(403);
  });

  it('liste les salles avec le scope rooms:read', async () => {
    mockToken({ scopes: ['rooms:read'] });
    prisma.room.findMany.mockResolvedValue([{ id: 'r1', name: 'Salle 101', qrToken: 'secret', _count: { equipment: 2, interventions: 0 } }]);
    const res = await request(app).get('/api/v1/rooms').set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe('r1');
    expect(res.body.data[0].qrToken).toBeUndefined();
  });

  it('renvoie le détail d\'une salle', async () => {
    mockToken({ scopes: ['rooms:read'] });
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', name: 'Salle 101', qrToken: 'secret', equipment: [], _count: { equipment: 0, interventions: 0 } });
    const res = await request(app).get('/api/v1/rooms/r1').set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('r1');
  });

  it('404 si la salle est introuvable', async () => {
    mockToken({ scopes: ['rooms:read'] });
    prisma.room.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/rooms/missing').set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(404);
  });
});
