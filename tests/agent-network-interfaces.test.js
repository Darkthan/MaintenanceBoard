jest.mock('../src/lib/prisma', () => ({
  equipmentNetworkInterface: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  }
}));

const prisma = require('../src/lib/prisma');
const { sanitizeAgentNetworkInterfaces, syncAgentNetworkInterfaces } = require('../src/services/agentNetworkInterfaces');

describe('adresses MAC remontées par l’agent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalise les interfaces et prend en charge les anciens agents', () => {
    expect(sanitizeAgentNetworkInterfaces(
      [{ name: 'Ethernet', macAddress: 'aa-bb-cc-dd-ee-ff' }],
      ['11:22:33:44:55:66']
    )).toEqual([{ name: 'Ethernet', macAddress: 'AA:BB:CC:DD:EE:FF' }]);
    expect(sanitizeAgentNetworkInterfaces(undefined, [
      'aa-bb-cc-dd-ee-ff', 'AA:BB:CC:DD:EE:FF', 'invalid'
    ])).toEqual([{ name: 'Agent 1', macAddress: 'AA:BB:CC:DD:EE:FF' }]);
  });

  it('ajoute la MAC dans la fiche réseau sans modifier le lien IPAM existant', async () => {
    prisma.equipmentNetworkInterface.findMany.mockResolvedValue([
      { id: 'if-1', name: 'Ethernet', macAddress: null, ipAddressId: 'ip-1' }
    ]);
    await syncAgentNetworkInterfaces('eq-1', [
      { name: 'Ethernet', macAddress: 'AA:BB:CC:DD:EE:FF' },
      { name: 'Wi-Fi', macAddress: '11:22:33:44:55:66' }
    ]);
    expect(prisma.equipmentNetworkInterface.update).toHaveBeenCalledWith({
      where: { id: 'if-1' }, data: { macAddress: 'AA:BB:CC:DD:EE:FF' }
    });
    expect(prisma.equipmentNetworkInterface.create).toHaveBeenCalledWith({
      data: { equipmentId: 'eq-1', name: 'Wi-Fi', macAddress: '11:22:33:44:55:66' }
    });
  });
});
