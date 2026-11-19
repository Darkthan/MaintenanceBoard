let mockPrisma;
jest.mock('../src/lib/prisma', () => new Proxy({}, { get(_target, key) {
  const value = mockPrisma?.[key];
  return typeof value === 'function' ? value.bind(mockPrisma) : value;
} }));
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const service = require('../src/mcp/ipAddressingService');
const admin = { id: 'admin', role: 'ADMIN', name: 'Louis' };
let directory;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ip-'));
  const databasePath = path.join(directory, 'ip.db');
  const database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TABLE ip_networks (id TEXT PRIMARY KEY, name TEXT NOT NULL, cidr TEXT NOT NULL, vlan INTEGER, gateway TEXT, secondaryGateways TEXT, description TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL);
      CREATE TABLE ip_range_definitions (id TEXT PRIMARY KEY, networkId TEXT NOT NULL REFERENCES ip_networks(id), startHost INTEGER NOT NULL, endHost INTEGER NOT NULL, label TEXT NOT NULL, rangeType TEXT NOT NULL DEFAULT 'STATIC', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL);
      CREATE TABLE ip_addresses (id TEXT PRIMARY KEY, networkId TEXT NOT NULL REFERENCES ip_networks(id), ip TEXT NOT NULL, hostname TEXT, equipmentType TEXT, description TEXT, equipmentId TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL, UNIQUE(networkId,ip));
      CREATE TABLE ip_network_revisions (id TEXT PRIMARY KEY, networkId TEXT NOT NULL REFERENCES ip_networks(id), action TEXT NOT NULL, actorName TEXT, snapshot TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE ip_migrations (id TEXT PRIMARY KEY, networkId TEXT NOT NULL, status TEXT NOT NULL);
    `);
  } finally { database.close(); }
  mockPrisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${databasePath.replace(/\\/g, '/')}` }) });
});
afterAll(async () => {
  await mockPrisma?.$disconnect();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
it('enregistre les modifications, refuse un doublon sans conserver son historique et protège les autres réseaux', async () => {
  const network = await service.createNetwork({ name: 'Test', cidr: '10.0.0.0/24', gateway: '10.0.0.254' }, admin);
  const address = await service.mutateEntry('address', 'create', { networkId: network.id, ip: '10.0.0.10', hostname: 'PC' }, admin);
  expect(await mockPrisma.ipNetworkRevision.count()).toBe(1);
  await expect(service.mutateEntry('address', 'create', { networkId: network.id, ip: address.ip }, admin)).rejects.toMatchObject({ status: 409 });
  expect(await mockPrisma.ipNetworkRevision.count()).toBe(1);
  const updated = await service.mutateEntry('address', 'update', { networkId: network.id, addressId: address.id, hostname: null, description: 'Réservé' }, admin);
  expect(updated).toMatchObject({ ip: address.ip, hostname: null, description: 'Réservé' });
  const snapshots = await mockPrisma.ipNetworkRevision.findMany({ orderBy: { createdAt: 'asc' } });
  expect(snapshots).toHaveLength(2);
  expect(JSON.parse(snapshots[1].snapshot).addresses[0]).toMatchObject({ ip: address.ip, hostname: 'PC' });
  expect(snapshots[1].actorName).toBe('Louis');
  const other = await service.createNetwork({ name: 'Autre', cidr: '10.1.0.0/24' }, admin);
  await expect(service.mutateEntry('address', 'delete', { networkId: other.id, addressId: address.id }, admin)).rejects.toMatchObject({ status: 404 });
  expect(await mockPrisma.ipAddress.count()).toBe(1);
  const range = await service.mutateEntry('range', 'create', { networkId: network.id, startHost: 200, endHost: 220, label: 'DHCP', rangeType: 'DHCP' }, admin);
  const updatedRange = await service.mutateEntry('range', 'update', { networkId: network.id, rangeId: range.id, endHost: 219 }, admin);
  expect(updatedRange).toMatchObject({ startHost: 200, endHost: 219, rangeType: 'DHCP' });
  await expect(service.updateNetwork({ networkId: network.id, cidr: '10.0.0.0/25', gateway: null }, admin)).rejects.toMatchObject({ status: 400 });
  expect((await mockPrisma.ipNetwork.findUnique({ where: { id: network.id } })).cidr).toBe('10.0.0.0/24');
  await service.updateNetwork({ networkId: network.id, name: 'Renommé', secondaryGateways: ['10.0.0.253'] }, admin);
  const listed = await service.listNetworks({ search: 'Renommé' }, admin);
  expect(listed).toEqual([expect.objectContaining({ name: 'Renommé', secondaryGateways: ['10.0.0.253'], addressCount: 1, rangeCount: 1, pendingMigrations: 0 })]);
  await service.mutateEntry('range', 'delete', { networkId: network.id, rangeId: range.id }, admin);
  await service.mutateEntry('address', 'delete', { networkId: network.id, addressId: address.id }, admin);
  expect(await mockPrisma.ipAddress.count()).toBe(0);
  expect(await mockPrisma.ipRangeDefinition.count()).toBe(0);
  const history = await service.getAddressHistory({ networkId: network.id, ip: address.ip }, admin);
  expect(history.map(entry => entry.type)).toEqual(['removed', 'edited', 'added']);
  expect(history.every(entry => entry.actorName === 'Louis')).toBe(true);
});
