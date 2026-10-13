const el = id => document.getElementById(id);
let visits = [], rooms = [], editing = null, mode = 'list', page = 1, pages = 1, requestVersion = 0;
const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
function localInput(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function textNode(tag, text, classes = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = classes; return node;
}
function visitCard(visit, compact = false) {
  const button = document.createElement('button'); button.type = 'button';
  button.className = `block w-full text-left rounded-lg p-3 border ${visit.damageFound ? 'bg-red-50 border-red-300 text-red-800' : visit.controlImpossible ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-800'}`;
  const date = new Date(visit.visitedAt);
  button.append(textNode('p', `${compact ? date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} · ${visit.room.name}`, 'font-semibold'));
  if (visit.damageFound) button.append(textNode('p', 'Dégradations constatées', 'text-xs font-semibold'));
  if (visit.controlImpossible) {
    button.append(textNode('p', 'Contrôle impossible', 'text-xs font-semibold'));
    button.append(textNode('p', visit.controlImpossibleReason, 'text-sm whitespace-pre-wrap break-words'));
  }
  if (!compact) {
    button.append(textNode('p', visit.observation || 'Aucune observation', 'whitespace-pre-wrap break-words mt-2'));
    button.append(textNode('p', visit.author?.name || 'Ancien utilisateur', 'text-xs mt-2'));
  }
  button.onclick = () => openVisit(visit); return button;
}
function render() {
  el('visit-list').classList.toggle('hidden', mode !== 'list');
  el('visit-calendar').classList.toggle('hidden', mode !== 'calendar');
  el('month-nav').classList.toggle('hidden', mode !== 'calendar');
  el('pagination').classList.toggle('hidden', mode !== 'list');
  el('list-view').setAttribute('aria-pressed', String(mode === 'list'));
  el('calendar-view').setAttribute('aria-pressed', String(mode === 'calendar'));
  el('visit-list').replaceChildren(...visits.map(v => visitCard(v)));
  if (!visits.length) el('visit-list').append(textNode('p', 'Aucun passage pour ces filtres.', 'p-6 text-slate-500'));
  el('page-label').textContent = `Page ${page} sur ${Math.max(1, pages)}`;
  el('previous-page').disabled = page <= 1; el('next-page').disabled = page >= pages;
  if (mode !== 'calendar') return;
  el('month-title').textContent = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const grid = document.createElement('div'); grid.className = 'grid grid-cols-7 min-w-[700px]';
  for (const day of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']) grid.append(textNode('div', day, 'p-3 bg-slate-50 font-semibold text-center'));
  const start = new Date(month); start.setDate(1 - (month.getDay() + 6) % 7);
  for (let index = 0; index < 42; index++) {
    const day = new Date(start); day.setDate(start.getDate() + index);
    const cell = document.createElement('div'); cell.className = `border p-2 min-h-28 space-y-2 ${day.getMonth() === month.getMonth() ? '' : 'bg-slate-50 text-slate-400'}`;
    cell.append(textNode('p', String(day.getDate()), 'text-sm'));
    visits.filter(v => new Date(v.visitedAt).toDateString() === day.toDateString()).sort((a, b) => new Date(a.visitedAt) - new Date(b.visitedAt)).forEach(v => cell.append(visitCard(v, true)));
    grid.append(cell);
  }
  el('visit-calendar').replaceChildren(grid);
}
async function loadVisits() {
  const version = ++requestVersion;
  el('page-error').textContent = '';
  const params = new URLSearchParams({ limit: '100', page: String(mode === 'list' ? page : 1) });
  if (el('room-filter').value) params.set('roomId', el('room-filter').value);
  if (el('damage-filter').checked) params.set('damageFound', 'true');
  if (el('mine-filter').checked) params.set('authorId', _currentUser.id);
  if (mode === 'calendar') {
    const start = new Date(month); start.setDate(1 - (month.getDay() + 6) % 7);
    const end = new Date(start); end.setDate(end.getDate() + 42);
    params.set('from', start.toISOString()); params.set('to', end.toISOString());
  }
  try {
    const response = await api.get(`/room-visits?${params}`);
    let data = response.data;
    if (mode === 'calendar') for (let next = 2; next <= response.pagination.totalPages; next++) {
      params.set('page', String(next)); const more = await api.get(`/room-visits?${params}`); data = data.concat(more.data);
    }
    if (version !== requestVersion) return;
    visits = data; pages = response.pagination.totalPages;
    if (mode === 'list' && page > Math.max(1, pages)) { page = Math.max(1, pages); return loadVisits(); }
    render();
  } catch (error) { if (version === requestVersion) el('page-error').textContent = error.message; }
}
function openVisit(visit = null) {
  editing = visit;
  el('visit-form').reset(); el('form-error').textContent = '';
  el('dialog-title').textContent = visit ? 'Modifier le passage' : 'Ajouter un passage';
  el('visit-room').value = visit?.roomId || el('room-filter').value || rooms[0]?.id || '';
  el('visit-date').value = localInput(visit?.visitedAt || new Date());
  el('visit-observation').value = visit?.observation || '';
  el('visit-damage').checked = visit?.damageFound || false;
  el('visit-impossible').checked = visit?.controlImpossible || false;
  el('visit-impossible-reason').value = visit?.controlImpossibleReason || '';
  updateImpossibleField();
  el('delete-visit').classList.toggle('hidden', !visit);
  el('visit-media').value = '';
  el('visit-media-list').replaceChildren(...(visit?.media || []).map(media => { const row = document.createElement('div'); row.className = 'flex items-center justify-between gap-2 text-sm'; const link = document.createElement('a'); link.href = `/api/room-visits/${visit.id}/media/${media.id}`; link.target = '_blank'; link.textContent = `${media.filename} (${Math.round(media.size / 1024)} Ko)`; link.className = 'text-blue-700 underline truncate'; row.append(link); return row; }));
  el('visit-dialog').showModal();
}
el('add-visit').onclick = () => openVisit();
el('visit-fab').onclick = () => openVisit();
function updateImpossibleField() {
  const impossible = el('visit-impossible').checked;
  el('impossible-reason-field').classList.toggle('hidden', !impossible);
  el('visit-impossible-reason').required = impossible;
  el('visit-impossible-reason').disabled = !impossible;
}
el('visit-impossible').onchange = updateImpossibleField;
el('close-dialog').onclick = () => el('visit-dialog').close();
for (const id of ['room-filter', 'damage-filter', 'mine-filter']) el(id).onchange = () => { page = 1; loadVisits(); };
for (const view of ['list', 'calendar']) el(`${view}-view`).onclick = () => { mode = view; page = 1; loadVisits(); };
el('previous-month').onclick = () => { month.setMonth(month.getMonth() - 1); loadVisits(); };
el('next-month').onclick = () => { month.setMonth(month.getMonth() + 1); loadVisits(); };
el('previous-page').onclick = () => { page--; loadVisits(); };
el('next-page').onclick = () => { page++; loadVisits(); };
el('visit-form').onsubmit = async event => {
  event.preventDefault(); el('save-visit').disabled = true; el('form-error').textContent = '';
  try {
    const data = { roomId: el('visit-room').value, visitedAt: new Date(el('visit-date').value).toISOString(), observation: el('visit-observation').value, damageFound: el('visit-damage').checked, controlImpossible: el('visit-impossible').checked, controlImpossibleReason: el('visit-impossible').checked ? el('visit-impossible-reason').value.trim() : '' };
    let saved;
    if (editing) saved = await api.patch(`/room-visits/${editing.id}`, data); else saved = await api.post('/room-visits', data);
    const file = el('visit-media').files[0];
    if (file) { const form = new FormData(); form.append('media', file); await api.post(`/room-visits/${saved.id}/media`, form); }
    el('visit-dialog').close(); await loadVisits();
  } catch (error) { el('form-error').textContent = error.message; }
  finally { el('save-visit').disabled = false; }
};
el('delete-visit').onclick = async () => {
  if (!editing || !confirm('Supprimer ce passage et son observation ?')) return;
  el('delete-visit').disabled = true;
  try { await api.delete(`/room-visits/${editing.id}`); el('visit-dialog').close(); await loadVisits(); }
  catch (error) { el('form-error').textContent = error.message; }
  finally { el('delete-visit').disabled = false; }
};
requireLogin().then(async user => {
  renderNav('room-visits');
  if (user?.role === 'PRINT_MANAGER') { location.href = '/printer-logs.html'; return; }
  try {
    let next = 1, response;
    do { response = await api.get(`/rooms?limit=100&page=${next++}`); rooms.push(...response.data); } while (next <= response.pagination.totalPages);
    for (const room of rooms) {
      const label = [room.building, room.number, room.name].filter(Boolean).join(' · ');
      for (const id of ['visit-room', 'room-filter']) { const option = textNode('option', label); option.value = room.id; el(id).append(option); }
    }
    const roomId = new URLSearchParams(location.search).get('roomId'); if (roomId) el('room-filter').value = roomId;
    el('add-visit').disabled = !rooms.length;
    if (!rooms.length) el('page-error').textContent = 'Créez une salle pour ajouter un passage.';
    await loadVisits();
  } catch (error) { el('page-error').textContent = error.message; }
}).catch(error => { el('page-error').textContent = error.message; });
