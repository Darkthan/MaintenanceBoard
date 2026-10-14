jest.mock('../src/lib/prisma', () => ({
  equipment: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  room: { findUnique: jest.fn() }, supplier: { findUnique: jest.fn(), findMany: jest.fn() },
  agentToken: { findUnique: jest.fn() }
}));
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');
const service = require('../src/mcp/equipmentService');
const { equipmentFields, readOnlyFields, protectedFields } = require('../src/mcp/equipmentFields');
const { buildMcpServer } = require('../src/mcp/server');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

describe('Accès complet aux fiches équipements via MCP', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.equipment.findUnique.mockResolvedValue({ id: 'pc1', serialNumber: 'SN1' });
    prisma.room.findUnique.mockResolvedValue({ id: 'room1' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup1' });
    prisma.agentToken.findUnique.mockResolvedValue({ id: 'deploy1' });
  });

  it.each(['schema.prisma', 'schema.postgresql.prisma'])('couvre chaque champ scalaire du modèle %s', schema => {
    const source = fs.readFileSync(path.join(__dirname, '../prisma', schema), 'utf8');
    const model = source.match(/model Equipment \{([\s\S]*?)\n\}/)[1];
    const scalarFields = [...model.matchAll(/^\s*(\w+)\s+(?:String|DateTime|Float|Boolean|EquipStatus)\??\s/gm)].map(match => match[1]);
    expect([...Object.keys(equipmentFields), ...readOnlyFields, ...protectedFields].sort()).toEqual(scalarFields.sort());
  });

  it('lit directement par série avec le fournisseur et les informations de facture', async () => {
    prisma.equipment.findUnique.mockResolvedValue({ id: 'pc1', serialNumber: 'SN1', invoiceNumber: 'F1',
      supplierRef: { id: 'sup1', name: 'Fournisseur' }, agentToken: 'secret', qrToken: 'secret', agentAlertState: '{}' });
    const row = await service.getEquipment({ serialNumber: ' SN1 ' });
    expect(prisma.equipment.findUnique.mock.calls[0][0].where).toEqual({ serialNumber: 'SN1' });
    expect(row.invoiceNumber).toBe('F1');
    expect(row.supplierRef.name).toBe('Fournisseur');
    for (const field of protectedFields) expect(row).not.toHaveProperty(field);
  });

  it('modifie la facturation et les données de découverte par série sans changer la série', async () => {
    await service.updateEquipment({ targetSerialNumber: 'SN1', invoiceNumber: 'F1', deliveryNoteNumber: 'BL1',
      supplierId: 'sup1', purchasePrice: 0, purchaseDate: '2026-10-14', warrantyEnd: null,
      discoverySource: 'AGENT', discoveryStatus: 'CONFIRMED', suggestedRoomId: 'room1',
      lastSeenAt: '2026-10-14T09:00:00Z', agentInfo: { cpu: 'Intel', ram: 16 }, agentRevoked: true, enrollmentTokenId: 'deploy1' });
    const saved = prisma.equipment.update.mock.calls[0][0];
    expect(saved.where).toEqual({ id: 'pc1' });
    expect(saved.data).toEqual(expect.objectContaining({ invoiceNumber: 'F1', deliveryNoteNumber: 'BL1',
      purchasePrice: 0, supplierId: 'sup1', warrantyEnd: null, purchaseDate: new Date('2026-10-14'),
      discoveryStatus: 'CONFIRMED', agentInfo: '{"cpu":"Intel","ram":16}', agentRevoked: true }));
    expect(saved.data).not.toHaveProperty('serialNumber');
  });

  it('crée une fiche inactive par défaut sans exposer de secret', async () => {
    prisma.equipment.create.mockResolvedValue({ id: 'pc2', status: 'INACTIVE', agentToken: 'secret' });
    const row = await service.createEquipment({ name: ' PC 2 ', type: 'PC', serialNumber: 'SN2', invoiceNumber: 'F2' });
    expect(prisma.equipment.create.mock.calls[0][0].data).toEqual({ name: 'PC 2', type: 'PC', serialNumber: 'SN2', invoiceNumber: 'F2', status: 'INACTIVE' });
    expect(row).not.toHaveProperty('agentToken');
  });

  it('refuse les champs internes, données invalides et sélecteurs ambigus', async () => {
    for (const input of [{ agentToken: 'secret' }, { createdAt: '2026-10-14' }, { agentInfo: '[]' },
      { discoverySource: 'UNKNOWN' }, { purchasePrice: -1 }, { purchaseDate: '2026-02-31' }]) {
      await expect(service.updateEquipment({ id: 'pc1', ...input })).rejects.toThrow();
    }
    await expect(service.updateEquipment({ id: 'pc1', targetSerialNumber: 'SN1', name: 'PC' })).rejects.toThrow('soit id');
    await expect(service.updateEquipment({ name: 'PC' })).rejects.toThrow('soit id');
    expect(prisma.equipment.update).not.toHaveBeenCalled();
  });

  it('refuse un fournisseur absent avant l’écriture', async () => {
    prisma.supplier.findUnique.mockResolvedValue(null);
    await expect(service.updateEquipment({ id: 'pc1', supplierId: 'missing' })).rejects.toThrow('Fournisseur introuvable');
    expect(prisma.equipment.update).not.toHaveBeenCalled();
  });

  it('refuse les appels de création et de catalogue sans les scopes nécessaires', async () => {
    const server = buildMcpServer({ scopes: [], createdBy: { id: 'u1' } });
    for (const name of ['get_equipment_fields', 'list_equipment_suppliers', 'create_equipment']) {
      const result = await server._registeredTools[name].handler({ name: 'PC', type: 'PC' });
      expect(result.isError).toBe(true);
    }
    expect(prisma.equipment.create).not.toHaveBeenCalled();
    expect(prisma.supplier.findMany).not.toHaveBeenCalled();
    await server.close();
  });

  it('recherche et pagine les fournisseurs', async () => {
    prisma.supplier.findMany.mockResolvedValue([{ id: 's1', name: 'Dell' }, { id: 's2', name: 'Dell partenaire' }]);
    expect(await service.listEquipmentSuppliers({ search: 'Dell', limit: 1 })).toEqual({ data: [{ id: 's1', name: 'Dell' }], nextCursor: 's1' });
    expect(prisma.supplier.findMany.mock.calls[0][0].where).toEqual({ name: { contains: 'Dell' } });
  });

  it('publie le vrai catalogue MCP et accepte une modification via tools/call', async () => {
    const server = buildMcpServer({ scopes: ['equipment:read', 'equipment:write'], createdBy: { id: 'u1' } });
    const client = new Client({ name: 'equipment-test', version: '1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const catalog = await client.listTools();
      const update = catalog.tools.find(tool => tool.name === 'update_equipment');
      expect(Object.keys(update.inputSchema.properties)).toEqual(expect.arrayContaining(Object.keys(equipmentFields)));
      for (const name of ['create_equipment', 'get_equipment', 'list_equipment', 'get_equipment_fields',
        'list_equipment_suppliers', 'preview_equipment_documents', 'associate_equipment_documents']) {
        expect(catalog.tools.some(tool => tool.name === name)).toBe(true);
      }
      const result = await client.callTool({ name: 'update_equipment', arguments: { targetSerialNumber: 'SN1', invoiceNumber: 'F1', deliveryNoteNumber: 'BL1' } });
      expect(result.isError).not.toBe(true);
      expect(prisma.equipment.update).toHaveBeenCalledWith({ where: { id: 'pc1' }, data: { invoiceNumber: 'F1', deliveryNoteNumber: 'BL1' } });
    } finally { await client.close(); await server.close(); }
  });
});
