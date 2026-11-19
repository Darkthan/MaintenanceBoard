jest.mock('../src/lib/prisma', () => {
  const model = () => Object.fromEntries(['findMany', 'findFirst', 'findUnique', 'create', 'update', 'delete'].map(key => [key, jest.fn()]));
  const db = { ipNetwork: model(), ipAddress: model(), ipRangeDefinition: model(), ipNetworkRevision: model(), equipment: model() };
  db.$transaction = jest.fn(fn => fn(db));
  return db;
});
const db = require('../src/lib/prisma');
const service = require('../src/mcp/ipAddressingService');
const { buildMcpServer } = require('../src/mcp/server');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const admin = { id: 'admin', role: 'ADMIN', name: 'Louis', isActive: true };
const network = { id: 'net', name: 'Pédagogie', cidr: '10.0.0.0/24', gateway: '10.0.0.254', secondaryGateways: '["10.0.0.253"]', ranges: [], addresses: [] };
beforeEach(() => {
  jest.clearAllMocks();
  db.ipNetwork.findUnique.mockResolvedValue({ ...network });
  db.ipNetwork.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }));
  db.ipNetwork.update.mockImplementation(async ({ data }) => ({ ...network, ...data }));
  db.ipAddress.create.mockImplementation(async ({ data }) => ({ id: 'addr', ...data }));
  db.ipAddress.update.mockImplementation(async ({ data }) => ({ id: 'addr', ...data }));
  db.ipRangeDefinition.create.mockImplementation(async ({ data }) => ({ id: 'range', ...data }));
});
describe('plan IP MCP : validation, droits et historique', () => {
  it('refuse une plage qui partage une borne avec une autre', async () => {
    db.ipNetwork.findUnique.mockResolvedValue({ ...network, ranges: [{ id: 'existing', label: 'DHCP', startHost: 10, endHost: 20 }] });
    await expect(service.mutateEntry('range', 'create', { networkId: 'net', startHost: 20, endHost: 22, label: 'PC' }, admin)).rejects.toMatchObject({ status: 409 });
    expect(db.ipNetworkRevision.create).not.toHaveBeenCalled();
  });
  it('réserve une adresse sans équipement et refuse une liaison explicite', async () => {
    const args = { networkId: 'net', ip: '10.0.0.2', reserve: true, equipmentType: 'IoT' };
    await expect(service.mutateEntry('address', 'create', { ...args, equipmentId: 'pc' }, admin)).rejects.toMatchObject({ status: 400 });
    expect(await service.mutateEntry('address', 'create', args, admin)).toMatchObject({ equipmentId: null, description: 'Réservé', equipmentType: 'IoT' });
  });
  it('crée un réseau avec passerelles validées et dédupliquées', async () => {
    const result = await service.createNetwork({ name: ' Test ', cidr: '10.0.0.0/24', gateway: '10.0.0.254', secondaryGateways: ['10.0.0.253', '10.0.0.253', '10.0.0.254'], vlan: 99 }, admin);
    expect(result).toMatchObject({ name: 'Test', secondaryGateways: ['10.0.0.253'], cidrInfo: { gateway: '10.0.0.254' } });
  });
  it.each(['10.0.0.999/24', '10.0.0.0/33', '10..0.0/24', '10.0.0.0/24extra'])('refuse le CIDR %s', async cidr => {
    await expect(service.createNetwork({ name: 'Test', cidr }, admin)).rejects.toMatchObject({ status: 400 });
    expect(db.ipNetwork.create).not.toHaveBeenCalled();
  });
  it('refuse une passerelle hors réseau', async () => {
    await expect(service.createNetwork({ name: 'Test', cidr: '10.0.0.0/24', gateway: '10.1.0.1' }, admin)).rejects.toMatchObject({ status: 400 });
  });
  it('conserve les champs omis, efface avec null et historise avec acteur dans la transaction', async () => {
    await service.updateNetwork({ networkId: 'net', description: null, vlan: null }, admin);
    expect(db.ipNetwork.update).toHaveBeenCalledWith({ where: { id: 'net' }, data: { description: null, vlan: null, gateway: network.gateway, secondaryGateways: network.secondaryGateways } });
    expect(db.ipNetworkRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ networkId: 'net', actorName: 'Louis', snapshot: expect.any(String) }) });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('refuse de sortir les adresses existantes du réseau', async () => {
    db.ipNetwork.findUnique.mockResolvedValue({ ...network, addresses: [{ ip: '10.0.0.200' }] });
    await expect(service.updateNetwork({ networkId: 'net', cidr: '10.1.0.0/24', gateway: null, secondaryGateways: null }, admin)).rejects.toMatchObject({ status: 400 });
    expect(db.ipNetworkRevision.create).not.toHaveBeenCalled();
    expect(db.ipNetwork.update).not.toHaveBeenCalled();
  });
  it.each([{}, { id: 'disabled', role: 'ADMIN', isActive: false }, { id: 'tech', role: 'TECH' }])('refuse une écriture non autorisée %j', async user => {
    await expect(service.createNetwork({ name: 'Test', cidr: network.cidr }, user)).rejects.toHaveProperty('status');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('refuse une adresse hors réseau et un équipement absent', async () => {
    await expect(service.mutateEntry('address', 'create', { networkId: 'net', ip: '10.1.0.2' }, admin)).rejects.toMatchObject({ status: 400 });
    db.equipment.findUnique.mockResolvedValue(null);
    await expect(service.mutateEntry('address', 'create', { networkId: 'net', ip: '10.0.0.2', equipmentId: 'missing' }, admin)).rejects.toMatchObject({ status: 404 });
    expect(db.ipAddress.create).not.toHaveBeenCalled();
  });
  it('crée une IP liée et remonte les doublons comme conflits', async () => {
    db.equipment.findUnique.mockResolvedValue({ id: 'pc' });
    expect(await service.mutateEntry('address', 'create', { networkId: 'net', ip: '10.0.0.2', equipmentId: 'pc' }, admin)).toMatchObject({ ip: '10.0.0.2', equipmentId: 'pc' });
    db.ipAddress.create.mockRejectedValueOnce(Object.assign(new Error(), { code: 'P2002' }));
    await expect(service.mutateEntry('address', 'create', { networkId: 'net', ip: '10.0.0.2' }, admin)).rejects.toMatchObject({ status: 409 });
  });
  it.each(['range', 'address'])('bloque update/delete d’une %s appartenant à un autre réseau', async kind => {
    const model = kind === 'range' ? db.ipRangeDefinition : db.ipAddress;
    model.findUnique.mockResolvedValue({ id: 'other', networkId: 'other-net' });
    for (const operation of ['update', 'delete']) {
      const args = { networkId: 'net', [kind === 'range' ? 'rangeId' : 'addressId']: 'other', ...(operation === 'update' ? kind === 'range' ? { label: 'Test' } : { hostname: 'Test' } : {}) };
      await expect(service.mutateEntry(kind, operation, args, admin)).rejects.toMatchObject({ status: 404 });
    }
    expect(model.update).not.toHaveBeenCalled();
    expect(model.delete).not.toHaveBeenCalled();
    expect(db.ipNetworkRevision.create).not.toHaveBeenCalled();
  });
  it('valide les offsets de plages', async () => {
    await expect(service.mutateEntry('range', 'create', { networkId: 'net', startHost: 20, endHost: 10, label: 'PC' }, admin)).rejects.toMatchObject({ status: 400 });
    await expect(service.mutateEntry('range', 'create', { networkId: 'net', startHost: 1, endHost: 256, label: 'PC' }, admin)).rejects.toMatchObject({ status: 400 });
    expect(await service.mutateEntry('range', 'create', { networkId: 'net', startHost: 10, endHost: 20, label: 'PC', rangeType: 'RESERVED' }, admin)).toMatchObject({ startHost: 10, endHost: 20, rangeType: 'RESERVED' });
  });
  it('consulte aussi les IP agent, trie numériquement et filtre après fusion', async () => {
    db.ipNetwork.findUnique.mockResolvedValue({ ...network, addresses: [{ id: 'a', ip: '10.0.0.100', hostname: 'Imprimante' }] });
    db.equipment.findMany.mockResolvedValue([{ id: 'pc', name: 'PC', type: 'PC', agentHostname: 'classe', agentInfo: JSON.stringify({ ips: ['10.0.0.2', '192.168.1.1'] }) }]);
    const rows = await service.listAddresses({ networkId: 'net' }, admin);
    expect(rows.map(a => a.ip)).toEqual(['10.0.0.2', '10.0.0.100']);
    expect(await service.listAddresses({ networkId: 'net', search: 'classe' }, admin)).toEqual([expect.objectContaining({ autoDiscovered: true })]);
  });
  it('retrouve les entrées manuelles historiques hors réseau pour les libérer', async () => {
    const address = { id: 'legacy', ip: '10.1.0.2', hostname: 'Ancien poste' };
    db.ipNetwork.findUnique.mockResolvedValue({ ...network, addresses: [address] });
    expect(await service.listAddresses({ networkId: 'net', manualOnly: true }, admin)).toEqual([address]);
    expect(db.equipment.findMany).not.toHaveBeenCalled();
  });
});
describe('outils via le protocole MCP', () => {
  let server, client;
  async function connect(scopes, user = admin) {
    server = buildMcpServer({ scopes, createdBy: user });
    client = new Client({ name: 'ip-test', version: '1.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
  }
  afterEach(async () => { await client?.close(); await server?.close(); });
  it('publie les outils et exécute une création validée', async () => {
    await connect(['ip_addressing:read', 'ip_addressing:write']);
    const result = await client.listTools();
    expect(result.tools.map(t => t.name)).toEqual(expect.arrayContaining(['create_ip_network', 'update_ip_network', 'create_ip_range', 'update_ip_range', 'delete_ip_range', 'create_ip_address', 'update_ip_address', 'delete_ip_address']));
    expect(result.tools.find(t => t.name === 'delete_ip_address').annotations.destructiveHint).toBe(true);
    const invalid = await client.callTool({ name: 'create_ip_address', arguments: { networkId: 'net', ip: '999.0.0.1' } });
    expect(invalid.isError).toBe(true);
    const created = await client.callTool({ name: 'create_ip_address', arguments: { networkId: 'net', ip: '10.0.0.2', hostname: 'PC' } });
    expect(created.isError).not.toBe(true);
    expect(JSON.parse(created.content[0].text)).toMatchObject({ hostname: 'PC' });
  });
  it('refuse une écriture avec le scope lecture seul', async () => {
    await connect(['ip_addressing:read']);
    const response = await client.callTool({ name: 'create_ip_network', arguments: { name: 'Test', cidr: network.cidr } });
    expect(response.isError).toBe(true);
    expect(db.ipNetwork.create).not.toHaveBeenCalled();
    db.ipNetworkRevision.findMany.mockResolvedValue([]);
    const history = await client.callTool({ name: 'get_ip_address_history', arguments: { networkId: 'net', ip: '10.0.0.2' } });
    expect(JSON.parse(history.content[0].text)).toEqual([]);
  });
  it('refuse un technicien même avec le scope écriture', async () => {
    await connect(['ip_addressing:write'], { id: 'tech', role: 'TECH' });
    const response = await client.callTool({ name: 'create_ip_network', arguments: { name: 'Test', cidr: network.cidr } });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Administrateur');
    expect(db.ipNetwork.create).not.toHaveBeenCalled();
    const history = await client.callTool({ name: 'get_ip_address_history', arguments: { networkId: 'net', ip: '10.0.0.2' } });
    expect(history.isError).toBe(true);
  });
});
