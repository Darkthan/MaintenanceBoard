// Cas réel fourni par l’utilisateur, exécuté exclusivement sur une base SQLite temporaire.
let mockPrisma;
jest.mock('../src/lib/prisma', () => new Proxy({}, {
  get(_target, key) {
    const value = mockPrisma?.[key];
    return typeof value === 'function' ? value.bind(mockPrisma) : value;
  }
}));

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { buildMcpServer } = require('../src/mcp/server');

const groups = [
  { type: 'Tablette', brand: 'Apple', model: 'iPad 9', serialNumbers:
    ['SCK4HWF0Y34', 'SHDXDCP6DN9', 'SH2WDQC2D7J', 'SLQ0R9TX1M9', 'SJC2X5WKGVV', 'SVP4FK24G5P'] },
  { type: 'Apple TV', brand: 'Apple', model: 'Apple TV 4K', serialNumbers:
    ['SL6QY60TWX1', 'SNQX0KGW5JY', 'SG6X361XN0F'] }
];
const serialNumbers = groups.flatMap(group => group.serialNumbers);
let client, server, databasePath, directory;
let existingIpad, existingTv;
const payload = group => ({ ...group, invoiceNumber: '050055' });
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
};

describe('Facture 050055 : neuf séries via un client MCP et une vraie base SQLite', () => {
  beforeAll(async () => {
    const temporaryRoot = path.join(__dirname, '.tmp');
    fs.mkdirSync(temporaryRoot, { recursive: true });
    directory = fs.mkdtempSync(path.join(temporaryRoot, 'invoice-050055-'));
    databasePath = path.join(directory, 'test.db');
    const sql = execFileSync(process.execPath, [path.join(__dirname, '../node_modules/prisma/build/index.js'),
      'migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000,
      env: { ...process.env, DATABASE_URL: `file:${databasePath.replace(/\\/g, '/')}` }
    });
    const database = new Database(databasePath);
    try { database.exec(sql); } finally { database.close(); }
    mockPrisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${databasePath.replace(/\\/g, '/')}` }) });
    server = buildMcpServer({ scopes: ['equipment:read', 'equipment:write'], createdBy: { id: 'test-user' } });
    client = new Client({ name: 'invoice-test', version: '1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await mockPrisma.supplier.create({ data: { id: 'supplier-test', name: 'C&C' } });
    await mockPrisma.room.create({ data: { id: 'room-test', name: 'Salle existante' } });
  }, 45000);

  beforeEach(async () => {
    await mockPrisma.equipment.deleteMany();
    existingIpad = await mockPrisma.equipment.create({ data: {
      name: 'iPad déjà inventorié', type: 'Tablette', brand: 'Apple', model: 'iPad 9',
      serialNumber: serialNumbers[0], status: 'ACTIVE', deliveryNoteNumber: 'BL-EXISTANT',
      purchaseDate: new Date('2023-09-01'), warrantyEnd: new Date('2028-09-01'), purchasePrice: 450,
      supplierId: 'supplier-test', roomId: 'room-test', description: 'À conserver'
    } });
    existingTv = await mockPrisma.equipment.create({ data: {
      name: 'TV existante', type: 'Apple TV', brand: 'Apple', model: 'Apple TV 4K',
      serialNumber: groups[1].serialNumbers[0], status: 'REPAIR', invoiceNumber: '050055'
    } });
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    await mockPrisma?.$disconnect();
    if (databasePath && fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
    if (directory && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  });

  it('associe les neuf séries, crée sept fiches inactives, conserve les autres champs et supporte la répétition', async () => {
    const before = await mockPrisma.equipment.findMany({ orderBy: { serialNumber: 'asc' } });
    const previews = [];
    for (const group of groups) previews.push(await call('preview_equipment_documents', payload(group)));
    expect(previews.every(preview => preview.canApply)).toBe(true);
    expect(previews.reduce((count, preview) => count + preview.creations.length, 0)).toBe(7);
    expect(await mockPrisma.equipment.findMany({ orderBy: { serialNumber: 'asc' } })).toEqual(before);

    const results = [];
    for (const group of groups) results.push(await call('associate_equipment_documents', payload(group)));
    expect(results.reduce((count, result) => count + result.createdCount, 0)).toBe(7);
    expect(results.reduce((count, result) => count + result.updatedCount, 0)).toBe(1);
    const inventory = await call('list_equipment', { serialNumbers });
    expect(inventory.data).toHaveLength(9);
    for (const item of inventory.data) expect(item.invoiceNumber).toBe('050055');

    const ipad = await mockPrisma.equipment.findUnique({ where: { id: existingIpad.id } });
    const { updatedAt: beforeUpdated, ...beforeFields } = existingIpad;
    const { updatedAt: afterUpdated, ...afterFields } = ipad;
    expect(afterFields).toEqual({ ...beforeFields, invoiceNumber: '050055' });
    expect(await mockPrisma.equipment.findUnique({ where: { id: existingTv.id } })).toEqual(existingTv);

    const created = inventory.data.filter(item => ![existingIpad.id, existingTv.id].includes(item.id));
    expect(created).toHaveLength(7);
    for (const item of created) {
      const group = groups.find(group => group.serialNumbers.includes(item.serialNumber));
      expect(item).toEqual(expect.objectContaining({ status: 'INACTIVE', type: group.type, brand: 'Apple', model: group.model,
        deliveryNoteNumber: null, purchaseDate: null, warrantyEnd: null, purchasePrice: null, supplierId: null }));
    }

    const saved = await mockPrisma.equipment.findMany({ orderBy: { serialNumber: 'asc' } });
    for (const group of groups) {
      const repeated = await call('associate_equipment_documents', payload(group));
      expect(repeated.createdCount).toBe(0);
      expect(repeated.updatedCount).toBe(0);
    }
    expect(await mockPrisma.equipment.findMany({ orderBy: { serialNumber: 'asc' } })).toEqual(saved);
  });

  it('refuse une facture en conflit avant de créer les autres fiches du lot', async () => {
    await mockPrisma.equipment.update({ where: { id: existingIpad.id }, data: { invoiceNumber: 'AUTRE' } });
    const before = await mockPrisma.equipment.findMany({ orderBy: { serialNumber: 'asc' } });
    const preview = await call('preview_equipment_documents', payload(groups[0]));
    expect(preview.canApply).toBe(false);
    await expect(call('associate_equipment_documents', payload(groups[0]))).rejects.toThrow('Association refusée');
    expect(await mockPrisma.equipment.findMany({ orderBy: { serialNumber: 'asc' } })).toEqual(before);
  });
});
