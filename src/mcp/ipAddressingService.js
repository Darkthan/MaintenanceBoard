const { z } = require('zod');
const prisma = require('../lib/prisma');
const utils = require('../services/ipAddressingUtils');
const { getIpAddressHistory } = require('../services/ipAddressHistory');

const id = z.string().trim().min(1);
const text = z.string().trim().max(10000).nullable().optional();
const ipv4 = z.string().trim().ip({ version: 'v4' });
const networkFields = {
  name: z.string().trim().min(1).max(200),
  cidr: z.string().trim().regex(/^\d+\.\d+\.\d+\.\d+\/(?:[0-9]|[12][0-9]|3[0-2])$/).refine(value => ipv4.safeParse(value.split('/')[0]).success, 'CIDR IPv4 invalide'),
  vlan: z.number().int().min(1).max(4094).nullable().optional(),
  gateway: ipv4.nullable().optional(),
  secondaryGateways: z.array(ipv4).max(100).nullable().optional(),
  description: text
};
const rangeFields = {
  startHost: z.number().int().min(0).max(4294967295),
  endHost: z.number().int().min(0).max(4294967295),
  label: z.string().trim().min(1).max(500),
  rangeType: z.enum(['STATIC', 'DHCP', 'RESERVED', 'OTHER']).optional()
};
const addressFields = {
  ip: ipv4, hostname: text, equipmentType: text, description: text,
  equipmentId: id.nullable().optional(), reserve: z.literal(true).optional()
};
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function requireUser(user, write = false) {
  if (!user?.id || user.isActive === false) fail('Utilisateur actif authentifié requis', 401);
  if (write && user.role !== 'ADMIN') fail('Administrateur requis pour modifier le plan IP', 403);
}
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) fail(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
function validate(fn) { try { return fn(); } catch (err) { fail(err.message); } }
async function networkById(db, networkId) {
  const row = await db.ipNetwork.findUnique({ where: { id: networkId }, include: { ranges: true, addresses: true } });
  if (!row) fail('Réseau introuvable', 404);
  return row;
}
function present(network) {
  return { ...network, secondaryGateways: utils.parseGatewayList(network.secondaryGateways),
    cidrInfo: utils.withStoredGateway(utils.parseCidr(network.cidr), network.gateway, network.secondaryGateways) };
}
async function write(user, fn) {
  requireUser(user, true);
  try { return await prisma.$transaction(fn, { isolationLevel: 'Serializable' }); }
  catch (err) {
    if (err.code === 'P2002') fail('Cette IP est déjà enregistrée dans ce réseau', 409);
    if (err.code === 'P2003') fail('Équipement ou réseau lié introuvable', 400);
    if (err.code === 'P2025') fail('Entrée introuvable', 404);
    if (err.code === 'P2034') fail('Modification concurrente, réessayez', 409);
    throw err;
  }
}
async function createNetwork(input, user) {
  const data = parse(z.object(networkFields).strict(), input);
  validate(() => utils.parseCidr(data.cidr));
  data.gateway = validate(() => utils.validateGateway(data.cidr, data.gateway));
  data.secondaryGateways = validate(() => utils.serializeSecondaryGateways(data.cidr, data.secondaryGateways, data.gateway));
  return write(user, async db => present(await db.ipNetwork.create({ data })));
}
async function updateNetwork({ networkId, ...input }, user) {
  const data = parse(z.object(networkFields).partial().strict(), input);
  if (!Object.keys(data).length) fail('Au moins un champ à modifier est requis');
  return write(user, async db => {
    const current = await networkById(db, networkId);
    const merged = { ...current, ...data };
    validate(() => utils.validateRestoredSections({ network: merged, ranges: current.ranges, addresses: current.addresses }, current, ['network']));
    data.gateway = validate(() => utils.validateGateway(merged.cidr, merged.gateway));
    data.secondaryGateways = validate(() => utils.serializeSecondaryGateways(merged.cidr, merged.secondaryGateways, data.gateway));
    await utils.createNetworkRevision(networkId, 'Modification du réseau via MCP', user, db);
    return present(await db.ipNetwork.update({ where: { id: networkId }, data }));
  });
}
async function mutateEntry(kind, operation, input, user) {
  const { networkId, rangeId, addressId, ...fields } = input;
  const schema = z.object(kind === 'range' ? rangeFields : addressFields).strict();
  const data = operation === 'delete' ? parse(z.object({}).strict(), fields) : parse(operation === 'update' ? schema.partial() : schema, fields);
  if (operation === 'update' && !Object.keys(data).length) fail('Au moins un champ à modifier est requis');
  const reserve = data.reserve === true;
  if (reserve) {
    if (data.equipmentId) fail('Une réservation ne peut pas être liée à un équipement');
    delete data.reserve;
    data.equipmentId = null;
    data.description ??= 'Réservé';
  }
  return write(user, async db => {
    const network = await networkById(db, networkId);
    const model = kind === 'range' ? db.ipRangeDefinition : db.ipAddress;
    const entryId = kind === 'range' ? rangeId : addressId;
    let current;
    if (operation !== 'create') {
      current = await model.findUnique({ where: { id: entryId } });
      if (!current || current.networkId !== networkId) fail('Entrée introuvable dans ce réseau', 404);
      if (reserve && await db.equipmentNetworkInterface.findUnique({ where: { ipAddressId: entryId }, select: { id: true } })) {
        fail('Une interface est encore liée à cette IP. Détachez-la avant de réserver l’adresse.', 409);
      }
    }
    if (operation !== 'delete') {
      const merged = { ...current, ...data };
      if (kind === 'range') {
        validate(() => utils.validateRangeOffsets(network.cidr, merged.startHost, merged.endHost));
        const overlap = network.ranges.find(range => range.id !== entryId &&
          range.startHost <= merged.endHost && range.endHost >= merged.startHost);
        if (overlap) fail(`Chevauchement avec la plage ${overlap.label} (${overlap.startHost}–${overlap.endHost})`, 409);
      } else {
        const { networkBase, totalHosts } = utils.parseCidr(network.cidr);
        const value = utils.ipToInt(merged.ip);
        if (value < networkBase || value >= networkBase + totalHosts) fail(`IP hors du réseau ${network.cidr}`);
        if (totalHosts > 2 && (value === networkBase || value === networkBase + totalHosts - 1)) {
          fail('Adresse réseau ou de diffusion inutilisable');
        }
        if (data.equipmentId && !await db.equipment.findUnique({ where: { id: data.equipmentId }, select: { id: true } })) fail('Équipement introuvable', 404);
      }
    }
    await utils.createNetworkRevision(networkId, `${operation} ${kind} via MCP`, user, db);
    if (operation === 'delete') { await model.delete({ where: { id: entryId } }); return { ok: true }; }
    if (operation === 'create') return model.create({ data: { networkId, ...data } });
    return model.update({ where: { id: entryId }, data });
  });
}
async function getNetwork(args, user) {
  requireUser(user);
  const network = await require('./workService').getIpNetwork(args);
  const addresses = args.manualOnly
    ? utils.sortIpAddresses(network.addresses)
    : await utils.loadEquipmentAddresses(network.addresses, network.cidr);
  return { ...present(network), addresses };
}
async function listNetworks(args, user) {
  requireUser(user);
  const { search } = args;
  const rows = await prisma.ipNetwork.findMany({ orderBy: [{ vlan: 'asc' }, { name: 'asc' }], include: { _count: { select: { addresses: true, ranges: true, migrations: { where: { status: 'PLANNED' } } } } } });
  const query = search?.toLowerCase();
  return rows.filter(n => !query || [n.name, n.cidr, n.description, n.vlan].some(v => String(v ?? '').toLowerCase().includes(query)))
    .map(n => ({ ...present(n), addressCount: n._count.addresses, rangeCount: n._count.ranges, pendingMigrations: n._count.migrations }));
}
async function listAddresses(args, user) {
  const network = await getNetwork(args, user);
  const query = args.search?.toLowerCase();
  return network.addresses.filter(a => !query || [a.ip, a.hostname, a.description, a.equipmentType].some(v => String(v ?? '').toLowerCase().includes(query)));
}
async function getAddressHistory(input, user) {
  requireUser(user);
  const { networkId, ip } = parse(z.object({ networkId: id, ip: ipv4 }).strict(), input);
  const history = await getIpAddressHistory(networkId, ip);
  if (!history) fail('Réseau introuvable', 404);
  return history;
}

module.exports = { id, ipv4, networkFields, rangeFields, addressFields, requireUser, createNetwork, updateNetwork, mutateEntry, getNetwork, listNetworks, listAddresses, getAddressHistory };
