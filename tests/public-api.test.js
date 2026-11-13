jest.mock('../src/lib/prisma', () => ({
  mcpToken: { findUnique: jest.fn(), update: jest.fn() },
  equipment: { findUnique: jest.fn(), findMany: jest.fn() },
  room: { findUnique: jest.fn(), findMany: jest.fn() },
  user: { findUnique: jest.fn() }
}));

const express = require('express');
const prisma = require('../src/lib/prisma');
const publicApiRouter = require('../src/routes/publicApi');
const request = require('./helpers/in-process-request');
const jwt = require('jsonwebtoken');
const config = require('../src/config');

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

  it('pagine les équipements sans exposer les secrets et transmet les filtres', async () => {
    mockToken({ scopes: ['equipment:read'] });
    prisma.equipment.findMany.mockResolvedValue([
      { id: 'eq2', name: 'PC-02', agentToken: 'secret', qrToken: 'qr', agentAlertState: '{}' },
      { id: 'eq3', name: 'PC-03' }
    ]);
    const res = await request(app).get('/api/v1/equipment')
      .query({ limit: 1, cursor: 'eq1', roomId: 'r1', status: 'ACTIVE', ip: '10.0.', mac: 'AA:BB' })
      .set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBe('eq2');
    expect(res.body.data).toHaveLength(1);
    for (const secret of ['agentToken', 'qrToken', 'agentAlertState']) expect(res.body.data[0]).not.toHaveProperty(secret);
    expect(prisma.equipment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2, skip: 1, cursor: { id: 'eq1' },
      where: {
        roomId: 'r1', status: 'ACTIVE', ipAddresses: { some: { ip: { contains: '10.0.' } } },
        networkInterfaces: { some: { macAddress: { contains: 'AA:BB' } } }
      }
    }));
  });

  it('termine la pagination des salles et applique les filtres', async () => {
    mockToken({ scopes: ['rooms:read'] });
    prisma.room.findMany.mockResolvedValue([{ id: 'r1', name: '101', qrToken: 'secret' }]);
    const res = await request(app).get('/api/v1/rooms').query({ building: 'A', search: '101', limit: 100 })
      .set('Authorization', 'Bearer mcp_x');
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    expect(prisma.room.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 101, where: { building: { contains: 'A' }, OR: [
        { name: { contains: '101' } }, { number: { contains: '101' } }, { description: { contains: '101' } }
      ] }
    }));
  });

  it('renvoie 400 pour un statut invalide et 404 pour un équipement absent', async () => {
    mockToken({ scopes: ['equipment:read'] });
    const invalid = await request(app).get('/api/v1/equipment?status=BOGUS').set('Authorization', 'Bearer mcp_x');
    expect(invalid.status).toBe(400);
    expect(prisma.equipment.findMany).not.toHaveBeenCalled();
    prisma.equipment.findUnique.mockResolvedValue(null);
    const missing = await request(app).get('/api/v1/equipment/missing').set('Authorization', 'Bearer mcp_x');
    expect(missing.status).toBe(404);
  });

  it('accepte OAuth client_credentials et vérifie les scopes courants du client', async () => {
    mockToken({ scopes: ['rooms:read'] });
    prisma.room.findMany.mockResolvedValue([]);
    const access = jwt.sign({ sub: 'tok1', type: 'mcp_access' }, config.jwt.secret, { expiresIn: '5m' });
    const allowed = await request(app).get('/api/v1/rooms').set('Authorization', `Bearer ${access}`);
    expect(allowed.status).toBe(200);
    const denied = await request(app).get('/api/v1/equipment').set('Authorization', `Bearer ${access}`);
    expect(denied.status).toBe(403);
  });

  it('refuse un JWT de session web et un compte propriétaire désactivé', async () => {
    const session = jwt.sign({ sub: 'admin1', type: 'access' }, config.jwt.secret);
    expect((await request(app).get('/api/v1/rooms').set('Authorization', `Bearer ${session}`)).status).toBe(401);
    mockToken({ scopes: ['rooms:read'] });
    const token = await prisma.mcpToken.findUnique();
    prisma.mcpToken.findUnique.mockResolvedValue({ ...token, createdBy: { ...owner, isActive: false } });
    expect((await request(app).get('/api/v1/rooms').set('Authorization', 'Bearer mcp_x')).status).toBe(401);
  });
});
