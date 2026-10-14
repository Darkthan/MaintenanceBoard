jest.mock('../src/lib/prisma', () => ({
  equipment: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn()
}));
const prisma = require('../src/lib/prisma');
const service = require('../src/mcp/equipmentService');
const { buildMcpServer } = require('../src/mcp/server');
const row = { id: 'pc1', name: 'PC 1', serialNumber: 'SN-001', invoiceNumber: null, deliveryNoteNumber: null };

describe('Références facture / BL via MCP', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.equipment.findMany.mockResolvedValue([{ ...row }]);
    prisma.equipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(fn => fn(prisma));
  });
  it('prépare un aperçu sans écrire, avec les séries inconnues', async () => {
    const out = await service.previewEquipmentDocuments({ serialNumbers: ['SN-001', 'UNKNOWN'], deliveryNoteNumber: ' BL-42 ' });
    expect(out.references).toEqual({ deliveryNoteNumber: 'BL-42' });
    expect(out.missingSerialNumbers).toEqual(['UNKNOWN']);
    expect(out.canApply).toBe(false);
    expect(prisma.equipment.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('bloque tout le lot si une série est inconnue', async () => {
    await expect(service.associateEquipmentDocuments({ serialNumbers: ['SN-001', 'UNKNOWN'], invoiceNumber: 'F-1' })).rejects.toThrow('Association refusée');
    expect(prisma.equipment.updateMany).not.toHaveBeenCalled();
  });
  it('refuse les doublons et les références absentes ou invalides', async () => {
    for (const input of [
      { serialNumbers: ['SN-001', ' SN-001 '], invoiceNumber: 'F-1' },
      { serialNumbers: ['SN-001'] },
      { serialNumbers: ['SN-001'], invoiceNumber: ' ' },
      { serialNumbers: ['SN-001'], invoiceNumber: 42 }
    ]) await expect(service.previewEquipmentDocuments(input)).rejects.toThrow();
    expect(prisma.equipment.findMany).not.toHaveBeenCalled();
  });
  it('bloque les conflits sans remplacer une référence silencieusement', async () => {
    prisma.equipment.findMany.mockResolvedValue([{ ...row, invoiceNumber: 'OLD' }]);
    const input = { serialNumbers: ['SN-001'], invoiceNumber: 'NEW' };
    expect((await service.previewEquipmentDocuments(input)).conflicts).toEqual([
      { serialNumber: 'SN-001', field: 'invoiceNumber', previous: 'OLD', next: 'NEW' }
    ]);
    await expect(service.associateEquipmentDocuments(input)).rejects.toThrow('Association refusée');
    expect(prisma.equipment.updateMany).not.toHaveBeenCalled();
    expect((await service.associateEquipmentDocuments({ ...input, overwrite: true })).updatedCount).toBe(1);
  });
  it('applique les deux références à plusieurs PC dans la transaction', async () => {
    prisma.equipment.findMany.mockResolvedValue([row, { ...row, id: 'pc2', serialNumber: 'SN-002' }]);
    const out = await service.associateEquipmentDocuments({ serialNumbers: ['SN-001', 'SN-002'], invoiceNumber: 'F-1', deliveryNoteNumber: 'BL-1' });
    expect(out.updatedCount).toBe(2);
    expect(prisma.equipment.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.equipment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pc1', serialNumber: 'SN-001', invoiceNumber: null, deliveryNoteNumber: null },
      data: { invoiceNumber: 'F-1', deliveryNoteNumber: 'BL-1' }
    });
  });
  it('conserve les champs omis et ne réécrit pas un lot déjà associé', async () => {
    prisma.equipment.findMany.mockResolvedValue([{ ...row, invoiceNumber: 'F-1', deliveryNoteNumber: 'BL-1' }]);
    const out = await service.associateEquipmentDocuments({ serialNumbers: ['SN-001'], deliveryNoteNumber: 'BL-1' });
    expect(out.updatedCount).toBe(0);
    expect(out.unchangedCount).toBe(1);
    expect(prisma.equipment.updateMany).not.toHaveBeenCalled();
  });
  it('détecte une modification concurrente', async () => {
    prisma.equipment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.associateEquipmentDocuments({ serialNumbers: ['SN-001'], invoiceNumber: 'F-1' })).rejects.toThrow('fiche a changé');
  });
  it('filtre les séries exactes et retourne les références', async () => {
    const out = await service.listEquipment({ serialNumbers: [' SN-001 '] });
    expect(prisma.equipment.findMany.mock.calls[0][0].where.serialNumber).toEqual({ in: ['SN-001'] });
    expect(out.data[0]).toHaveProperty('invoiceNumber', null);
  });
  it('protège chaque outil par son scope', async () => {
    const read = buildMcpServer({ scopes: ['equipment:read'], createdBy: { id: 'u1' } });
    const input = { serialNumbers: ['SN-001'], deliveryNoteNumber: 'BL-1' };
    expect((await read._registeredTools.preview_equipment_documents.handler(input)).isError).toBeUndefined();
    expect((await read._registeredTools.associate_equipment_documents.handler(input)).isError).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const write = buildMcpServer({ scopes: ['equipment:write'], createdBy: { id: 'u1' } });
    expect((await write._registeredTools.associate_equipment_documents.handler(input)).isError).toBeUndefined();
  });
  it('autorise la modification individuelle et l’effacement explicite', async () => {
    prisma.equipment.findUnique.mockResolvedValue(row);
    await service.updateEquipment({ id: 'pc1', invoiceNumber: ' F-1 ', deliveryNoteNumber: null });
    expect(prisma.equipment.update).toHaveBeenCalledWith({ where: { id: 'pc1' }, data: { invoiceNumber: 'F-1', deliveryNoteNumber: null } });
  });
});
