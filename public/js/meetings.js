'use strict';
(() => {
  let meeting = null;
  let dirty = false;
  let busy = false;
  let page = 1;
  let pages = 1;
  const statuses = { PLANNED: 'Planifiée', IN_PROGRESS: 'En cours', COMPLETED: 'Terminée' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const message = text => { document.getElementById('meeting-state').textContent = text; };
  function markDirty() { dirty = true; message('Modifications non enregistrées'); }
  function canLeave() { return !dirty || window.confirm('Des modifications ne sont pas enregistrées. Les abandonner ?'); }
  const draft = () => ({ title: '', scheduledAt: null, status: 'PLANNED', topics: [] });
  function localDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function previewMarkup(link) {
    const p = link.preview;
    if (!p) return '<span class="meeting-preview text-slate-500">Objet indisponible</span>';
    let amount = '';
    if (p.totalAmount != null) {
      try { amount = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: p.currency }).format(p.totalAmount); }
      catch { amount = `${p.totalAmount} ${p.currency}`; }
    }
    return `<a class="meeting-preview" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(p.title)}</strong><br>${esc([p.reference, p.status, amount && `${amount} TTC`].filter(Boolean).join(' · '))}</a>`;
  }
  function renderEditor() {
    const container = document.getElementById('meeting-editor');
    if (!meeting) { container.innerHTML = '<p>Sélectionnez une réunion ou créez-en une.</p>'; return; }
    container.innerHTML = `<form id="meeting-form" class="meeting-editor">
      <div class="meeting-card">
        <h2 class="text-xl font-semibold">${meeting.id ? 'Réunion' : 'Nouvelle réunion'}</h2>
        <label>Titre<input name="title" required maxlength="200" value="${esc(meeting.title)}"></label>
        <label>Date et heure<input name="scheduledAt" type="datetime-local" value="${localDate(meeting.scheduledAt)}"></label>
        <label>État<select name="status">${Object.entries(statuses).map(([value, label]) => `<option value="${value}" ${meeting.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <p class="text-sm text-slate-500">${meeting.topics.filter(t => t.checked).length} / ${meeting.topics.length} sujets traités · Enregistrement manuel</p>
      </div>
      <h3 class="text-lg font-semibold my-4">Ordre du jour</h3>
      <div class="space-y-4">${meeting.topics.map((topic, index) => `<section class="meeting-card" data-topic="${index}">
        <div class="flex gap-2 items-center"><input type="checkbox" data-field="checked" aria-label="Sujet traité" ${topic.checked ? 'checked' : ''}>
        <span class="font-semibold">Sujet ${index + 1}${topic.checked ? ' · Traité' : ''}</span></div>
        <label>Sujet<input data-field="title" required maxlength="300" value="${esc(topic.title)}"></label>
        <label>Notes et décisions<textarea data-field="notes" maxlength="20000">${esc(topic.notes)}</textarea></label>
        <div>${topic.links.map((link, linkIndex) => `<div>${previewMarkup(link)}<button type="button" data-action="unlink" data-link="${linkIndex}" aria-label="Retirer le lien ${linkIndex + 1}">Retirer le lien</button></div>`).join('')}</div>
        <label>Lien vers une fiche interne<input type="text" data-link-url placeholder="/orders.html?id=…" maxlength="2048"></label>
        <div class="flex flex-wrap gap-2"><button type="button" data-action="link" ${topic.links.length >= 10 ? 'disabled' : ''}>Ajouter le lien</button>
          <button type="button" data-action="up" aria-label="Monter le sujet ${index + 1}" ${index === 0 ? 'disabled' : ''}>↑ Monter</button>
          <button type="button" data-action="down" aria-label="Descendre le sujet ${index + 1}" ${index === meeting.topics.length - 1 ? 'disabled' : ''}>↓ Descendre</button>
          <button type="button" data-action="remove">Retirer le sujet</button></div>
      </section>`).join('') || '<p class="text-slate-500">Aucun sujet. Préparez l’ordre du jour ou ajoutez un sujet pendant la réunion.</p>'}</div>
      <div class="flex flex-wrap gap-3 mt-4"><button type="button" id="add-topic" ${meeting.topics.length >= 100 ? 'disabled' : ''}>Ajouter un sujet</button>
        <button type="submit" class="bg-blue-600 text-white">Enregistrer</button><button type="button" id="reload-meeting" ${!meeting.id ? 'disabled' : ''}>Recharger</button></div>
    </form>`;
    const form = document.getElementById('meeting-form');
    form.addEventListener('input', event => {
      const input = event.target;
      const section = input.closest('[data-topic]');
      if (input.hasAttribute('data-link-url')) return;
      if (section) {
        const topic = meeting.topics[Number(section.dataset.topic)];
        topic[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value;
      } else if (input.name) {
        meeting[input.name] = input.name === 'scheduledAt' ? (input.value ? new Date(input.value).toISOString() : null) : input.value;
      }
      markDirty();
    });
    document.getElementById('add-topic').onclick = () => {
      if (busy) return;
      meeting.topics.push({ id: crypto.randomUUID(), title: '', notes: '', checked: false, links: [] });
      markDirty(); renderEditor();
      container.querySelector('[data-topic]:last-child [data-field="title"]').focus();
    };
    document.getElementById('reload-meeting').onclick = () => openMeeting(meeting.id);
    form.addEventListener('click', async event => {
      const button = event.target.closest('[data-action]');
      if (!button || busy) return;
      const section = button.closest('[data-topic]');
      const index = Number(section.dataset.topic);
      const topic = meeting.topics[index];
      const action = button.dataset.action;
      if (action === 'link') {
        busy = true; button.disabled = true;
        try {
          const link = await api.post('/meetings/link-preview', { url: section.querySelector('[data-link-url]').value });
          if (!topic.links.some(l => l.type === link.type && l.id === link.id)) topic.links.push(link);
        } catch (err) { message(err.message); return; }
        finally { busy = false; button.disabled = false; }
      } else if (action === 'remove') {
        if (!window.confirm('Retirer ce sujet et ses notes ?')) return;
        meeting.topics.splice(index, 1);
      } else if (action === 'unlink') topic.links.splice(Number(button.dataset.link), 1);
      else {
        const target = index + (action === 'up' ? -1 : 1);
        [meeting.topics[index], meeting.topics[target]] = [meeting.topics[target], meeting.topics[index]];
      }
      markDirty(); renderEditor();
    });
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const controls = [...form.querySelectorAll('button, input, textarea, select')].map(el => [el, el.disabled]);
      controls.forEach(([el]) => { el.disabled = true; });
      message('Enregistrement…');
      const payload = { title: meeting.title, scheduledAt: meeting.scheduledAt, status: meeting.status,
        topics: meeting.topics.map(t => ({ ...t, links: t.links.map(({ type, id }) => ({ type, id })) })) };
      try {
        const saved = meeting.id ? await api.patch(`/meetings/${meeting.id}`, { ...payload, version: meeting.version }) : await api.post('/meetings', payload);
        meeting = saved; dirty = false;
        history.replaceState(null, '', `/meetings.html?id=${encodeURIComponent(saved.id)}`);
        renderEditor(); message('Réunion enregistrée'); await loadHistory();
      } catch (err) { message(err.message); }
      finally { busy = false; controls.forEach(([el, disabled]) => { el.disabled = disabled; }); }
    };
  }
  async function loadHistory() {
    try {
      const result = await api.get('/meetings', { page, status: document.getElementById('history-status').value });
      pages = result.pagination.totalPages;
      document.getElementById('meeting-history').innerHTML = result.data.map(m => `<button type="button" class="meeting-card text-left w-full mb-2" data-meeting="${esc(m.id)}"><strong>${esc(m.title)}</strong><br><span class="text-sm text-slate-500">${esc(statuses[m.status])} · ${m.scheduledAt ? esc(new Date(m.scheduledAt).toLocaleString('fr-FR')) : 'Sans date'}</span></button>`).join('') || '<p>Aucune réunion.</p>';
      document.getElementById('history-page').textContent = `${page} / ${Math.max(1, pages)}`;
      document.getElementById('previous-page').disabled = page <= 1;
      document.getElementById('next-page').disabled = page >= pages;
    } catch (err) { message(err.message); }
  }
  async function openMeeting(id) {
    if (busy || !canLeave()) return;
    busy = true;
    try {
      const data = await api.get(`/meetings/${encodeURIComponent(id)}`);
      meeting = data; dirty = false;
      history.replaceState(null, '', `/meetings.html?id=${encodeURIComponent(id)}`);
      renderEditor(); message('Réunion chargée');
    } catch (err) { message(err.message); }
    finally { busy = false; }
  }
  async function init() {
    const user = await requireLogin();
    document.getElementById('app').innerHTML = getLayoutTemplate('Réunions', 'meetings') + `
      <p id="meeting-state" role="status" aria-live="polite" class="mb-4 text-blue-800"></p>
      <div class="meeting-grid"><aside class="meeting-controls"><button id="new-meeting" class="bg-blue-600 text-white mb-4">Créer une réunion</button>
        <h2 class="text-lg font-semibold mb-2">Historique des réunions</h2>
        <label for="history-status">Filtrer par état</label><select id="history-status" class="block border rounded p-2 my-2 w-full"><option value="">Tous les états</option>${Object.entries(statuses).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <div id="meeting-history"></div><div class="flex gap-2 items-center"><button id="previous-page" aria-label="Page précédente">←</button><span id="history-page"></span><button id="next-page" aria-label="Page suivante">→</button></div></aside>
        <section id="meeting-editor" aria-label="Détail de la réunion"></section></div></div></main></div>`;
    renderNav('meetings'); initUserNav(user);
    if (!['ADMIN', 'TECH'].includes(user.role)) { document.getElementById('page-content').textContent = 'Accès refusé'; return; }
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
    document.getElementById('new-meeting').onclick = () => {
      if (busy || !canLeave()) return;
      meeting = draft(); dirty = false; history.replaceState(null, '', '/meetings.html'); renderEditor(); message('Nouvelle réunion');
    };
    document.getElementById('meeting-history').onclick = event => { const button = event.target.closest('[data-meeting]'); if (button) openMeeting(button.dataset.meeting); };
    document.getElementById('history-status').onchange = () => { page = 1; loadHistory(); };
    document.getElementById('previous-page').onclick = () => { if (page > 1) { page--; loadHistory(); } };
    document.getElementById('next-page').onclick = () => { if (page < pages) { page++; loadHistory(); } };
    renderEditor(); await loadHistory();
    const id = new URLSearchParams(location.search).get('id');
    if (id) await openMeeting(id);
  }
  init();
})();
