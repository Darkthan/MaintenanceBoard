jest.mock('../src/lib/prisma', () => ({}));

const { buildIpAddressHistory } = require('../src/services/ipAddressHistory');

const ip = '10.0.0.10';
const initial = { id: 'address-1', ip, hostname: 'pc-1' };
const renamed = { ...initial, hostname: 'pc-2' };
const snapshot = (id, addresses) => ({
  id,
  action: id,
  actorName: 'Louis',
  snapshot: JSON.stringify({ network: {}, ranges: [], addresses })
});

test('shows additions, changed fields and removals for the selected IP only', () => {
  const revisions = [
    snapshot('add', []),
    snapshot('other-address', [initial]),
    snapshot('rename', [initial, { id: 'other', ip: '10.0.0.20' }]),
    snapshot('delete', [renamed])
  ];

  const history = buildIpAddressHistory(ip, revisions, null);
  expect(history.map(({ id, type }) => [id, type])).toEqual([
    ['delete', 'removed'], ['rename', 'edited'], ['add', 'added']
  ]);
  expect(history[1]).toMatchObject({
    actorName: 'Louis',
    changes: [{ field: 'hostname', before: 'pc-1', after: 'pc-2' }]
  });
});

test('shows reassignment when the address changes record even with identical values', () => {
  const history = buildIpAddressHistory(ip, [snapshot('replace', [initial])], { ...initial, id: 'address-2' });
  expect(history).toEqual([expect.objectContaining({ type: 'reassigned', changes: [] })]);
});
