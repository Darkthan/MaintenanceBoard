let mockPrisma;
jest.mock('../src/lib/prisma', () => new Proxy({}, {
  get(_target, key) {
    const value = mockPrisma?.[key];
    return typeof value === 'function' ? value.bind(mockPrisma) : value;
  }
}));
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { buildMcpServer } = require('../src/mcp/server');
let directory, server, client;

describe('salles via un client MCP et SQLite', () => {
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-rooms-'));
    const databasePath = path.join(directory, 'rooms.db');
    const database = new Database(databasePath);
    try {
      database.exec(`CREATE TABLE rooms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, building TEXT, floor INTEGER,
        number TEXT, description TEXT, qrToken TEXT NOT NULL UNIQUE,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL
      )`);
    } finally { database.close(); }
    mockPrisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${databasePath.replace(/\\/g, '/')}` }) });
    server = buildMcpServer({ scopes: ['rooms:read', 'rooms:write'], createdBy: { id: 'admin', role: 'ADMIN', isActive: true } });
    client = new Client({ name: 'rooms-test', version: '1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    await mockPrisma?.$disconnect();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('valide les schémas et les transactions réelles, refuse un doublon et conserve les champs omis', async () => {
    const invalid = await client.callTool({ name: 'create_room', arguments: { name: 'Info', floor: 1.5 } });
    expect(invalid.isError).toBe(true);
    expect(await mockPrisma.room.count()).toBe(0);
    const created = await client.callTool({ name: 'create_room', arguments: { name: ' Info ', building: 'A', floor: 1 } });
    expect(created.isError).not.toBe(true);
    const room = JSON.parse(created.content[0].text);
    expect(room).toMatchObject({ name: 'Info', building: 'A', floor: 1 });
    expect(room).not.toHaveProperty('qrToken');
    const duplicate = await client.callTool({ name: 'create_room', arguments: { name: 'Info', building: 'A', floor: 1 } });
    expect(duplicate.isError).toBe(true);
    expect(await mockPrisma.room.count()).toBe(1);
    const updated = await client.callTool({ name: 'update_room', arguments: { id: room.id, floor: null, description: 'Salle informatique' } });
    expect(updated.isError).not.toBe(true);
    expect(await mockPrisma.room.findUnique({ where: { id: room.id } })).toMatchObject({ name: 'Info', building: 'A', floor: null, description: 'Salle informatique' });
    const missing = await client.callTool({ name: 'update_room', arguments: { id: 'missing', name: 'Info' } });
    expect(missing.isError).toBe(true);
  });
});
