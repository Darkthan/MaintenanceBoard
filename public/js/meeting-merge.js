'use strict';
// Shared pure merge logic: no preview snapshots and no implicit overwrite of a concurrent field.
(function (root) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function mergeMeeting(base, local, remote, prefer = 'local') {
    const conflicts = [];
    function field(path, before, mine, theirs) {
      if (equal(mine, theirs) || equal(theirs, before)) return mine;
      if (equal(mine, before)) return theirs;
      conflicts.push(path);
      return prefer === 'remote' ? theirs : mine;
    }
    const result = {};
    for (const key of ['title', 'scheduledAt', 'status']) result[key] = field(key, base[key], local[key], remote[key]);
    const maps = [base, local, remote].map(doc => new Map(doc.topics.map(t => [t.id, t])));
    const topics = new Map();
    for (const id of new Set([...maps[1].keys(), ...maps[2].keys()])) {
      const [before, mine, theirs] = maps.map(map => map.get(id));
      if (!before || !mine || !theirs) {
        const topic = field(`topics.${id}`, before, mine, theirs);
        if (topic) topics.set(id, topic);
        continue;
      }
      const topic = { id };
      for (const key of ['title', 'notes', 'checked']) topic[key] = field(`topics.${id}.${key}`, before[key], mine[key], theirs[key]);
      const key = link => `${link.type}:${link.id}`;
      const links = [before, mine, theirs].map(t => new Map(t.links.map(l => [key(l), { type: l.type, id: l.id }])));
      topic.links = [];
      for (const id of new Set([...links[1].keys(), ...links[2].keys()])) {
        const link = field(`topics.${topic.id}.links.${id}`, ...links.map(map => map.get(id)));
        if (link) topic.links.push(link);
      }
      topics.set(id, topic);
    }
    // Compare only surviving base subjects: independent additions/deletions do not conflict with a reorder.
    const common = new Set(base.topics.filter(t => maps[1].has(t.id) && maps[2].has(t.id)).map(t => t.id));
    const orders = [base, local, remote].map(doc => doc.topics.map(t => t.id).filter(id => common.has(id)));
    const order = field('topicOrder', ...orders);
    const localStructureChanged = !equal(local.topics.map(t => t.id), base.topics.map(t => t.id));
    const source = !equal(order, orders[2]) || (equal(orders[2], orders[0]) && localStructureChanged) ? local : remote;
    const ids = [...new Set([...source.topics.map(t => t.id), ...local.topics.map(t => t.id), ...remote.topics.map(t => t.id)])];
    result.topics = ids.filter(id => topics.has(id)).map(id => topics.get(id));
    return { document: result, conflicts };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { mergeMeeting };
  else root.mergeMeeting = mergeMeeting;
})(typeof window === 'undefined' ? globalThis : window);
