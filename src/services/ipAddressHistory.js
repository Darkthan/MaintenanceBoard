const { parseNetworkSnapshot } = require('./ipAddressingUtils');
const prisma = require('../lib/prisma');

const fields = ['hostname', 'equipmentType', 'description', 'equipmentId'];

function buildIpAddressHistory(ip, revisions, current) {
  const versions = revisions.map(revision => ({
    revision,
    address: parseNetworkSnapshot(revision).addresses.find(address => address.ip === ip)
  }));
  const history = [];

  // Each revision stores the state immediately before its action.
  versions.forEach(({ revision, address: before }, index) => {
    const after = index + 1 < versions.length ? versions[index + 1].address : current;
    const changes = fields.flatMap(field => {
      const previous = before?.[field] ?? null;
      const value = after?.[field] ?? null;
      return previous === value ? [] : [{ field, before: previous, after: value }];
    });
    if (!before && !after) return;
    if (before?.id === after?.id && !changes.length) return;
    history.push({
      id: revision.id,
      action: revision.action,
      actorName: revision.actorName,
      createdAt: revision.createdAt,
      type: !before ? 'added' : !after ? 'removed' : before.id !== after.id ? 'reassigned' : 'edited',
      changes
    });
  });

  return history.reverse();
}

async function getIpAddressHistory(networkId, ip) {
  return prisma.$transaction(async tx => {
    const network = await tx.ipNetwork.findUnique({ where: { id: networkId }, select: { id: true } });
    if (!network) return null;
    const current = await tx.ipAddress.findUnique({ where: { networkId_ip: { networkId, ip } } });
    const revisions = await tx.ipNetworkRevision.findMany({
      where: { networkId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    return buildIpAddressHistory(ip, revisions, current);
  }, { isolationLevel: 'Serializable' });
}

module.exports = { buildIpAddressHistory, getIpAddressHistory };
