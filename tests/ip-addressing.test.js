const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com', isActive: true };
    next();
  }
}));

jest.mock('../src/middleware/roles', () => ({
  requireAdmin: (_req, _res, next) => next()
}));

jest.mock('../src/lib/prisma', () => ({
  ipNetwork: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  ipRangeDefinition: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  },
  ipAddress: {
    findMany: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const ipAddressingRouter = require('../src/routes/ipAddressing');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ip-networks', ipAddressingRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('ip addressing gateways', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enregistre une passerelle personnalisee a la creation', async () => {
    prisma.ipNetwork.create.mockImplementation(async ({ data }) => ({ id: 'network-1', ...data }));

    const res = await request(buildApp())
      .post('/api/ip-networks')
      .send({ name: 'LAN Bureau', cidr: '10.0.1.0/24', gateway: '10.0.1.254' });

    expect(res.status).toBe(201);
    expect(prisma.ipNetwork.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ gateway: '10.0.1.254' })
    });
  });

  it('expose la passerelle personnalisee dans les informations CIDR', async () => {
    prisma.ipNetwork.findMany.mockResolvedValue([
      { id: 'network-1', name: 'LAN Bureau', cidr: '10.0.1.0/24', gateway: '10.0.1.254', _count: { addresses: 0, ranges: 0 } }
    ]);

    const res = await request(buildApp()).get('/api/ip-networks');

    expect(res.status).toBe(200);
    expect(res.body[0].cidrInfo.gateway).toBe('10.0.1.254');
    expect(res.body[0].cidrInfo.networkBase).toBe(167772416);
  });

  it('modifie la passerelle d un reseau existant', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ id: 'network-1', cidr: '10.0.1.0/24', gateway: null });
    prisma.ipNetwork.update.mockImplementation(async ({ data }) => ({ id: 'network-1', ...data }));

    const res = await request(buildApp())
      .patch('/api/ip-networks/network-1')
      .send({ gateway: '10.0.1.253' });

    expect(res.status).toBe(200);
    expect(prisma.ipNetwork.update).toHaveBeenCalledWith({
      where: { id: 'network-1' },
      data: { gateway: '10.0.1.253' }
    });
  });

  it('refuse une passerelle hors du sous-reseau', async () => {
    const res = await request(buildApp())
      .post('/api/ip-networks')
      .send({ name: 'LAN Bureau', cidr: '10.0.1.0/24', gateway: '10.0.2.1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sous-réseau');
    expect(prisma.ipNetwork.create).not.toHaveBeenCalled();
  });

  it('enregistre une plage exprimee en offsets si elle reste dans le reseau', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ id: 'network-1', cidr: '10.0.1.0/24' });
    prisma.ipRangeDefinition.create.mockImplementation(async ({ data }) => ({ id: 'range-1', ...data }));

    const res = await request(buildApp())
      .post('/api/ip-networks/network-1/ranges')
      .send({ startHost: 10, endHost: 50, label: 'DHCP', rangeType: 'DHCP' });

    expect(res.status).toBe(201);
    expect(prisma.ipRangeDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ startHost: 10, endHost: 50 })
    });
  });

  it('refuse une plage qui depasse le sous-reseau', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ id: 'network-1', cidr: '10.0.1.0/24' });

    const res = await request(buildApp())
      .post('/api/ip-networks/network-1/ranges')
      .send({ startHost: 10, endHost: 300, label: 'Invalide' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sous-réseau');
    expect(prisma.ipRangeDefinition.create).not.toHaveBeenCalled();
  });

  it('trie les adresses IP octet par octet', async () => {
    prisma.ipAddress.findMany.mockResolvedValue([
      { id: 'ip-100', ip: '10.0.0.100' },
      { id: 'ip-10', ip: '10.0.0.10' },
      { id: 'ip-2', ip: '10.0.0.2' },
      { id: 'ip-1', ip: '10.0.0.1' }
    ]);

    const res = await request(buildApp()).get('/api/ip-networks/network-1/addresses');

    expect(res.status).toBe(200);
    expect(res.body.map(address => address.ip)).toEqual([
      '10.0.0.1',
      '10.0.0.2',
      '10.0.0.10',
      '10.0.0.100'
    ]);
  });

  it('trie aussi les adresses exposees dans le detail du reseau', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({
      id: 'network-1',
      cidr: '10.0.0.0/24',
      gateway: null,
      addresses: [
        { id: 'ip-100', ip: '10.0.0.100' },
        { id: 'ip-10', ip: '10.0.0.10' },
        { id: 'ip-2', ip: '10.0.0.2' },
        { id: 'ip-1', ip: '10.0.0.1' }
      ],
      ranges: []
    });

    const res = await request(buildApp()).get('/api/ip-networks/network-1');

    expect(res.status).toBe(200);
    expect(res.body.addresses.map(address => address.ip)).toEqual([
      '10.0.0.1',
      '10.0.0.2',
      '10.0.0.10',
      '10.0.0.100'
    ]);
  });
});
