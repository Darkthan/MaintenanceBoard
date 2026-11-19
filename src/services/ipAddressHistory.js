const { parseNetworkSnapshot } = require('./ipAddressingUtils');

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

module.exports = { buildIpAddressHistory };
