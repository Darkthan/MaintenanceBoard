jest.mock('../src/lib/prisma', () => ({
  equipment: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  equipmentNetworkInterface: { findUnique: jest.fn() },
  ipAddress: { findUnique: jest.fn() },
  room: { findUnique: jest.fn() },
  $transaction: jest.fn()
}));

const prisma = require('../src/lib/prisma');
const service = require('../src/mcp/equipmentService');
const { buildMcpServer } = require('../src/mcp/server');

describe('MCP equipment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('expose les cinq outils et refuse la lecture sans scope', async () => {
    const server = buildMcpServer({ scopes: [], createdBy: { id: 'u1' } });
    for (const name of ['list_equipment', 'get_equipment', 'update_equipment',
      'list_equipment_network_interfaces', 'update_equipment_network_interface']) {
      expect(server._registeredTools[name]).toBeDefined();
    }
    const result = await server._registeredTools.get_equipment.handler({ id: 'eq1' });
    expect(result.isError).toBe(true);
    expect(prisma.equipment.findUnique).not.toHaveBeenCalled();
  });

  it('lit la fiche sans exposer les tokens internes', async () => {
    prisma.equipment.findUnique.mockResolvedValue({
      id: 'eq1', name: 'PC-01', qrToken: 'qr-secret', agentToken: 'agent-secret',
      agentAlertState: '{}', networkInterfaces: [{ macAddress: 'AA:BB:CC:DD:EE:FF' }],
      ipAddresses: [{ ip: '10.0.0.2' }]
    });
    const server = buildMcpServer({ scopes: ['equipment:read'], createdBy: { id: 'u1' } });
    const result = await server._registeredTools.get_equipment.handler({ id: 'eq1' });
    const data = JSON.parse(result.content[0].text);
    expect(data.networkInterfaces[0].macAddress).toBe('AA:BB:CC:DD:EE:FF');
    expect(data.ipAddresses[0].ip).toBe('10.0.0.2');
    expect(data).not.toHaveProperty('agentToken');
    expect(data).not.toHaveProperty('qrToken');
  });

  it('valide les modifications et protège le lien IPAM par un scope supplémentaire', async () => {
    const server = buildMcpServer({ scopes: ['equipment:write'], createdBy: { id: 'u1' } });
    const denied = await server._registeredTools.update_equipment_network_interface.handler({
      equipmentId: 'eq1', name: 'Ethernet', ipAddressId: 'ip1'
    });
    expect(denied.isError).toBe(true);
    expect(prisma.equipment.findUnique).not.toHaveBeenCalled();
    await expect(service.updateEquipment({ id: 'eq1', status: 'BOGUS' })).rejects.toThrow('Statut invalide');
    prisma.equipment.findUnique.mockResolvedValue({ id: 'eq1' });
    await expect(service.updateEquipmentNetworkInterface({ equipmentId: 'eq1', name: 'Ethernet', macAddress: 'invalid' }))
      .rejects.toThrow('Adresse MAC invalide');
  });

  it('refuse une IPAM déjà affectée à une autre machine', async () => {
    prisma.equipment.findUnique.mockResolvedValue({ id: 'eq1' });
    prisma.ipAddress.findUnique.mockResolvedValue({ id: 'ip1', equipmentId: 'eq2', networkInterface: null });
    await expect(service.updateEquipmentNetworkInterface({ equipmentId: 'eq1', name: 'Ethernet', ipAddressId: 'ip1' }))
      .rejects.toThrow('autre équipement');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lie une interface MAC à une entrée IPAM sans créer d’adresse', async () => {
    prisma.equipment.findUnique.mockResolvedValue({ id: 'eq1' });
    prisma.ipAddress.findUnique.mockResolvedValue({ id: 'ip1', equipmentId: null, networkInterface: null });
    const tx = {
      equipmentNetworkInterface: { create: jest.fn().mockResolvedValue({ id: 'if1', ipAddressId: 'ip1' }) },
      ipAddress: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
    };
    prisma.$transaction.mockImplementation(fn => fn(tx));
    prisma.equipmentNetworkInterface.findUnique.mockResolvedValue({ id: 'if1', macAddress: 'AA:BB:CC:DD:EE:FF' });
    const out = await service.updateEquipmentNetworkInterface({
      equipmentId: 'eq1', name: 'Ethernet', macAddress: 'aa-bb-cc-dd-ee-ff', ipAddressId: 'ip1'
    });
    expect(tx.equipmentNetworkInterface.create).toHaveBeenCalledWith({ data: {
      equipmentId: 'eq1', name: 'Ethernet', macAddress: 'AA:BB:CC:DD:EE:FF', ipAddressId: 'ip1'
    } });
    expect(tx.ipAddress.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { equipmentId: 'eq1' } }));
    expect(out.id).toBe('if1');
  });
});
