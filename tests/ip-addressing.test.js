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
  $transaction: jest.fn(),
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
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn()
  },
  equipment: {
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
    prisma.equipment.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async callback => callback(prisma));
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
    prisma.ipNetwork.findUnique.mockResolvedValue({ cidr: '10.0.0.0/24' });
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

  it('ajoute les IP agent du sous-reseau avec un lien vers leur equipement', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({
      id: 'network-1',
      cidr: '10.0.0.0/24',
      gateway: null,
      addresses: [],
      ranges: []
    });
    prisma.equipment.findMany.mockResolvedValue([
      {
        id: 'equipment-1',
        name: 'Poste CDI',
        type: 'PC',
        agentHostname: 'pc-cdi-01',
        agentInfo: JSON.stringify({ ips: ['10.0.0.15', '192.168.1.15'] })
      }
    ]);

    const res = await request(buildApp()).get('/api/ip-networks/network-1');

    expect(res.status).toBe(200);
    expect(res.body.addresses).toEqual([
      expect.objectContaining({
        ip: '10.0.0.15',
        hostname: 'pc-cdi-01',
        equipmentId: 'equipment-1',
        equipment: { id: 'equipment-1', name: 'Poste CDI', type: 'PC' },
        autoDiscovered: true
      })
    ]);
  });

  it('enrichit une IP existante avec le hostname de son equipement', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ cidr: '10.0.0.0/24' });
    prisma.ipAddress.findMany.mockResolvedValue([
      { id: 'address-1', ip: '10.0.0.15', hostname: 'ancien-nom' }
    ]);
    prisma.equipment.findMany.mockResolvedValue([
      {
        id: 'equipment-1',
        name: 'Poste CDI',
        type: 'PC',
        agentHostname: 'pc-cdi-01',
        agentInfo: JSON.stringify({ ips: ['10.0.0.15'] })
      }
    ]);

    const res = await request(buildApp()).get('/api/ip-networks/network-1/addresses');

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      id: 'address-1',
      ip: '10.0.0.15',
      hostname: 'pc-cdi-01',
      equipmentId: 'equipment-1'
    }));
    expect(res.body[0]).not.toHaveProperty('autoDiscovered');
  });

  it('masque aussi les adresses manuelles hors du reseau selectionne', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ cidr: '10.0.0.0/24' });
    prisma.ipAddress.findMany.mockResolvedValue([
      { id: 'address-in', ip: '10.0.0.15' },
      { id: 'address-out', ip: '192.168.1.15' }
    ]);

    const res = await request(buildApp()).get('/api/ip-networks/network-1/addresses');

    expect(res.status).toBe(200);
    expect(res.body.map(address => address.ip)).toEqual(['10.0.0.15']);
  });

  it('exporte uniquement les adresses du reseau selectionne en CSV', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ name: 'LAN CDI', cidr: '10.0.0.0/24' });
    prisma.ipAddress.findMany.mockResolvedValue([
      { id: 'address-in', ip: '10.0.0.15', hostname: 'pc-cdi-01', equipmentType: 'PC' },
      { id: 'address-out', ip: '192.168.1.15', hostname: 'hors-reseau' }
    ]);

    const res = await request(buildApp()).get('/api/ip-networks/network-1/addresses/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('plan-adressage-LAN-CDI.csv');
    expect(res.text).toContain('10.0.0.15,pc-cdi-01,PC,');
    expect(res.text).not.toContain('192.168.1.15');
  });

  it('met a jour en masse les adresses existantes lors de l import CSV', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ cidr: '10.0.0.0/24' });
    prisma.ipAddress.findUnique.mockResolvedValue({ id: 'address-1' });
    prisma.ipAddress.upsert.mockResolvedValue({ id: 'address-1' });

    const res = await request(buildApp())
      .post('/api/ip-networks/network-1/addresses/import')
      .send({ csv: 'ip,hostname,type,description\n10.0.0.15,pc-cdi-02,PC,\"Poste modifie, salle CDI\"' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 0, updated: 1, errors: [] });
    expect(prisma.ipAddress.upsert).toHaveBeenCalledWith({
      where: { networkId_ip: { networkId: 'network-1', ip: '10.0.0.15' } },
      create: expect.objectContaining({ networkId: 'network-1', hostname: 'pc-cdi-02' }),
      update: expect.objectContaining({ hostname: 'pc-cdi-02', description: 'Poste modifie, salle CDI' })
    });
  });

  it('refuse l import CSV d une adresse hors du reseau selectionne', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ cidr: '10.0.0.0/24' });

    const res = await request(buildApp())
      .post('/api/ip-networks/network-1/addresses/import')
      .send({ csv: 'ip,hostname\n192.168.1.15,hors-reseau' });

    expect(res.status).toBe(200);
    expect(res.body.errors[0].error).toContain('hors du réseau');
    expect(prisma.ipAddress.upsert).not.toHaveBeenCalled();
  });

  it('applique les modifications et suppressions groupees dans une transaction', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ cidr: '10.0.0.0/24' });
    prisma.ipAddress.findMany.mockResolvedValue([
      { id: 'address-update', networkId: 'network-1', ip: '10.0.0.15' },
      { id: 'address-delete', networkId: 'network-1', ip: '10.0.0.16' }
    ]);
    prisma.ipAddress.update.mockResolvedValue({ id: 'address-update' });
    prisma.ipAddress.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(buildApp())
      .post('/api/ip-networks/network-1/addresses/bulk')
      .send({
        updates: [{ id: 'address-update', ip: '10.0.0.25', hostname: 'pc-cdi-25', equipmentType: 'PC', description: 'Déplacé' }],
        deleteIds: ['address-delete']
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1, deleted: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.ipAddress.deleteMany).toHaveBeenCalledWith({
      where: { networkId: 'network-1', id: { in: ['address-delete'] } }
    });
    expect(prisma.ipAddress.update).toHaveBeenCalledWith({
      where: { id: 'address-update' },
      data: { ip: '10.0.0.25', hostname: 'pc-cdi-25', equipmentType: 'PC', description: 'Déplacé' }
    });
  });

  it('refuse une modification groupee hors du reseau avant transaction', async () => {
    prisma.ipNetwork.findUnique.mockResolvedValue({ cidr: '10.0.0.0/24' });
    prisma.ipAddress.findMany.mockResolvedValue([{ id: 'address-update', networkId: 'network-1', ip: '10.0.0.15' }]);

    const res = await request(buildApp())
      .post('/api/ip-networks/network-1/addresses/bulk')
      .send({ updates: [{ id: 'address-update', ip: '192.168.1.15' }], deleteIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('hors du réseau');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
