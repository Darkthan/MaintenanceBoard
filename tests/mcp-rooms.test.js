jest.mock('../src/lib/prisma', () => ({
  room: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn()
}));

const prisma = require('../src/lib/prisma');
const rooms = require('../src/services/roomService');
const { buildMcpServer } = require('../src/mcp/server');
const admin = { id: 'admin', role: 'ADMIN', isActive: true };
const call = (name, args, scopes = ['rooms:read', 'rooms:write'], user = admin) =>
  buildMcpServer({ scopes, createdBy: user })._registeredTools[name].handler(args);
const payload = result => JSON.parse(result.content[0].text);

describe('outils MCP salles et service partagé', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(fn => fn(prisma));
    prisma.room.findFirst.mockResolvedValue(null);
  });

  it('expose les quatre outils avec leurs annotations', () => {
    const tools = buildMcpServer({ scopes: [], createdBy: admin })._registeredTools;
    expect(tools.list_rooms.annotations.readOnlyHint).toBe(true);
    expect(tools.get_room.annotations.readOnlyHint).toBe(true);
    expect(tools.create_room.annotations.idempotentHint).toBe(false);
    expect(tools.update_room.annotations.idempotentHint).toBe(true);
  });

  it.each(['list_rooms', 'get_room', 'create_room', 'update_room'])('refuse %s sans scope avant accès à la base', async name => {
    expect((await call(name, { id: 'r1', name: 'Salle' }, [])).isError).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.room.findMany).not.toHaveBeenCalled();
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });

  it.each([null, { id: 'u', role: 'TECH' }, { id: 'u', role: 'PRINT_MANAGER' }, { ...admin, isActive: false }])('refuse les écritures avec un utilisateur non autorisé %j', async user => {
    for (const name of ['create_room', 'update_room']) {
      expect((await call(name, { id: 'r1', name: 'Salle' }, undefined, user)).isError).toBe(true);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('autorise la lecture TECH, filtre et pagine sans exposer les tokens QR', async () => {
    prisma.room.findMany.mockResolvedValue([{ id: 'r1', qrToken: 'secret' }, { id: 'r2' }]);
    const result = await call('list_rooms', { search: 'Info', building: 'A', limit: 1, cursor: 'r0' }, ['rooms:read'], { id: 'tech', role: 'TECH' });
    expect(payload(result)).toEqual({ data: [{ id: 'r1' }], nextCursor: 'r1' });
    expect(prisma.room.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2, cursor: { id: 'r0' }, skip: 1,
      where: { building: { contains: 'A' }, OR: ['name', 'number', 'description'].map(field => ({ [field]: { contains: 'Info' } })) }
    }));
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', qrToken: 'secret', equipment: [], _count: { equipment: 0 } });
    expect(payload(await call('get_room', { id: 'r1' }))).toEqual({ id: 'r1', equipment: [], _count: { equipment: 0 } });
  });

  it('refuse les lectures sans utilisateur ou avec un compte désactivé', async () => {
    expect((await call('list_rooms', {}, undefined, null)).isError).toBe(true);
    expect((await call('get_room', { id: 'r1' }, undefined, { ...admin, isActive: false })).isError).toBe(true);
    expect(prisma.room.findMany).not.toHaveBeenCalled();
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });

  it('crée une salle normalisée sans exposer le token QR', async () => {
    prisma.room.create.mockResolvedValue({ id: 'r1', name: 'Info', qrToken: 'secret' });
    expect(payload(await call('create_room', { name: ' Info ', building: '', floor: 0 }))).toEqual({ id: 'r1', name: 'Info' });
    expect(prisma.room.create).toHaveBeenCalledWith({ data: { name: 'Info', building: null, floor: 0 } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('modifie seulement les champs fournis et permet de les effacer', async () => {
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', name: 'Info', building: 'A', floor: 1, number: '101' });
    prisma.room.update.mockResolvedValue({ id: 'r1', name: 'Info', building: null, floor: null, qrToken: 'secret' });
    expect(payload(await call('update_room', { id: 'r1', building: null, floor: null }))).not.toHaveProperty('qrToken');
    expect(prisma.room.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { building: null, floor: null } });
    expect(prisma.room.findFirst).toHaveBeenCalledWith({ where: { id: { not: 'r1' }, name: 'Info', building: null, floor: null, number: '101' } });
  });

  it.each([{ name: '' }, { name: '  ' }, { name: 'x'.repeat(201) }, { name: 'A', building: 'x'.repeat(101) }, { name: 'A', number: 'x'.repeat(51) }, { name: 'A', floor: 1.2 }, { name: 'A', floor: '1' }, { name: 'A', qrToken: 'secret' }])('valide les créations %j dans le service aussi', async input => {
    await expect(rooms.createRoom(input, admin)).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse une modification vide ou sans identifiant', async () => {
    await expect(rooms.updateRoom({ id: 'r1' }, admin)).rejects.toMatchObject({ status: 400 });
    await expect(rooms.updateRoom({ name: 'A' }, admin)).rejects.toMatchObject({ status: 400 });
  });

  it('retourne les erreurs métier des salles absentes et des doublons', async () => {
    prisma.room.findUnique.mockResolvedValue(null);
    expect((await call('get_room', { id: 'absent' })).content[0].text).toMatch('introuvable');
    expect((await call('update_room', { id: 'absent', name: 'Info' })).isError).toBe(true);
    prisma.room.findFirst.mockResolvedValue({ id: 'duplicate' });
    await expect(rooms.createRoom({ name: 'Info' }, admin)).rejects.toMatchObject({ status: 409 });
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', name: 'Info' });
    expect((await call('update_room', { id: 'r1', name: 'Info' })).content[0].text).toMatch('existe déjà');
    expect(prisma.room.create).not.toHaveBeenCalled();
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it.each([['P2002', 409], ['P2025', 404], ['P2034', 409]])('traduit les erreurs Prisma %s', async (code, status) => {
    prisma.room.create.mockRejectedValue({ code });
    await expect(rooms.createRoom({ name: 'Info' }, admin)).rejects.toMatchObject({ status });
  });

  it('laisse remonter les pannes inattendues', async () => {
    prisma.room.findUnique.mockRejectedValue(new Error('database unavailable'));
    await expect(call('get_room', { id: 'r1' })).rejects.toThrow('database unavailable');
  });
});
