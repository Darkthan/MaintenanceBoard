const { mergeMeeting } = require('../public/js/meeting-merge');
const topic = (id, extra = {}) => ({ id, title: id, checked: false, notes: '', links: [], ...extra });
const base = () => ({ title: 'Réunion', scheduledAt: null, status: 'IN_PROGRESS', topics: [topic('a'), topic('b')] });
const copy = doc => JSON.parse(JSON.stringify(doc));

test('fusionne des modifications sur différents champs sans perdre les notes', () => {
  const before = base(), local = copy(before), remote = copy(before);
  local.topics[0].notes = 'Décision locale'; remote.topics[0].checked = true; remote.topics[1].notes = 'Autre décision';
  const result = mergeMeeting(before, local, remote);
  expect(result.conflicts).toEqual([]);
  expect(result.document.topics[0]).toMatchObject({ notes: 'Décision locale', checked: true });
  expect(result.document.topics[1].notes).toBe('Autre décision');
  expect(before.topics[0].notes).toBe('');
});
test('signale une collision de notes et ne choisit une version que sur demande explicite', () => {
  const before = base(), local = copy(before), remote = copy(before);
  local.topics[0].notes = 'Mes notes'; remote.topics[0].notes = 'Ses notes'; local.title = 'Titre local'; remote.status = 'COMPLETED';
  expect(mergeMeeting(before, local, remote).conflicts).toEqual(['topics.a.notes']);
  for (const [prefer, expected] of [['local', 'Mes notes'], ['remote', 'Ses notes']]) {
    const result = mergeMeeting(before, local, remote, prefer);
    expect(result.document.topics[0].notes).toBe(expected);
    expect(result.document).toMatchObject({ title: 'Titre local', status: 'COMPLETED' });
  }
});
test('conserve des ajouts simultanés, des liens indépendants et leur ordre local', () => {
  const before = base(), local = copy(before), remote = copy(before);
  local.topics.unshift(topic('local')); remote.topics.push(topic('remote'));
  local.topics[1].links = [{ type: 'orders', id: '1' }]; remote.topics[0].links = [{ type: 'rooms', id: '2' }];
  const result = mergeMeeting(before, local, remote);
  expect(result.conflicts).toEqual([]);
  expect(result.document.topics.map(t => t.id)).toEqual(['local', 'a', 'b', 'remote']);
  expect(result.document.topics[1].links).toEqual([{ type: 'orders', id: '1' }, { type: 'rooms', id: '2' }]);
});
test('accepte une suppression non conflictuelle et la suppression d’un lien', () => {
  const before = base(); before.topics[0].links = [{ type: 'orders', id: '1' }];
  const local = copy(before), remote = copy(before); local.topics.pop(); local.topics[0].links = []; remote.title = 'Titre distant';
  const result = mergeMeeting(before, local, remote);
  expect(result.conflicts).toEqual([]); expect(result.document.topics).toHaveLength(1);
  expect(result.document.topics[0].links).toEqual([]);
});
test('ne supprime pas silencieusement un sujet modifié sur un autre écran', () => {
  const before = base(), local = copy(before), remote = copy(before);
  local.topics.shift(); remote.topics[0].notes = 'Note distante';
  expect(mergeMeeting(before, local, remote).conflicts).toEqual(['topics.a']);
  expect(mergeMeeting(before, local, remote, 'remote').document.topics.find(t => t.id === 'a').notes).toBe('Note distante');
});
test('préserve un réordonnancement et détecte deux ordres incompatibles', () => {
  const before = base(); before.topics.push(topic('c'));
  const local = copy(before), remote = copy(before);
  local.topics.reverse(); remote.topics[0].notes = 'Une note';
  expect(mergeMeeting(before, local, remote).document.topics.map(t => t.id)).toEqual(['c', 'b', 'a']);
  remote.topics = [remote.topics[1], remote.topics[0], remote.topics[2]];
  expect(mergeMeeting(before, local, remote).conflicts).toContain('topicOrder');
  expect(mergeMeeting(before, local, remote, 'remote').document.topics.map(t => t.id)).toEqual(['b', 'a', 'c']);
});
test('deux changements identiques ne constituent pas un conflit', () => {
  const before = base(), changed = copy(before); changed.topics[0].notes = 'Identique';
  expect(mergeMeeting(before, changed, copy(changed)).conflicts).toEqual([]);
});
