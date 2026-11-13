'use strict';
(() => {
  let meeting = null;
  let dirty = false;
  let busy = false;
  let page = 1;
  let pages = 1;
  let dismissMentions = () => {};
  let baseline = null;
  let editEpoch = 0;
  let saveTimer;
  let saving = false;
  let conflict = null;
  let liveController;
  let liveGeneration = 0;
  let accessDenied = false;
  let saveFailures = 0;
  let creationId;
  let creationBase;
  let historyLoading = false;
  const expandedTopics = new Set();
  const statuses = { PLANNED: 'Planifiée', IN_PROGRESS: 'En cours', COMPLETED: 'Terminée' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const message = text => { document.getElementById('meeting-state').textContent = text; };
  function snapshot(doc) {
    return { title: doc.title, scheduledAt: doc.scheduledAt, status: doc.status,
      topics: doc.topics.map(t => ({ id: t.id, title: t.title, notes: t.notes, checked: t.checked,
        links: t.links.map(({ type, id }) => ({ type, id })) })) };
  }
  function scheduleSave(delay = 800) {
    clearTimeout(saveTimer);
    if (dirty && !conflict && !accessDenied) saveTimer = setTimeout(() => saveMeeting(), delay);
  }
  function markDirty() {
    dirty = true; editEpoch++; message(conflict ? 'Conflit à résoudre. Vos notes sont conservées.' : 'Modifications en cours…'); scheduleSave();
  }
  function canLeave() { return !dirty || window.confirm('Des modifications ne sont pas enregistrées. Les abandonner ?'); }
  const draft = () => ({ title: '', scheduledAt: null, status: 'PLANNED', topics: [] });
  function syncFab() {
    const fab = document.getElementById('meeting-fab');
    if (!fab) return;
    const create = !meeting || document.querySelector('.meeting-history-panel')?.open;
    const label = create ? 'Créer une réunion' : 'Ajouter un sujet';
    fab.dataset.mode = create ? 'meeting' : 'topic';
    fab.title = label; fab.setAttribute('aria-label', label);
    fab.disabled = busy || (saving && create) || (!create && meeting.topics.length >= 100);
  }
  function setBusy(value) { busy = value; syncFab(); }
  function createMeeting() {
    if (busy || saving || !canLeave()) return;
    stopLive(); baseline = null; conflict = null; accessDenied = false; clearTimeout(saveTimer);
    creationId = crypto.randomUUID(); creationBase = null; saveFailures = 0;
    document.querySelector('.meeting-history-panel').open = false;
    meeting = draft(); dirty = false; expandedTopics.clear();
    history.replaceState(null, '', '/meetings.html'); renderEditor(); message('Nouvelle réunion');
    document.querySelector('[name="title"]').focus();
  }
  function addTopic() {
    if (busy || !meeting || meeting.topics.length >= 100) return;
    const id = crypto.randomUUID(); expandedTopics.add(id);
    meeting.topics.push({ id, title: '', notes: '', checked: false, links: [] });
    markDirty(); renderEditor();
    const title = document.querySelector('[data-topic]:last-child [data-field="title"]');
    title.focus(); title.scrollIntoView({ block: 'center' });
  }
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
    dismissMentions();
    document.getElementById('page-content').classList.toggle('meeting-list-mode', !meeting);
    document.getElementById('back-meetings').hidden = !meeting;
    syncFab();
    document.getElementById('meeting-conflict').hidden = !conflict;
    const container = document.getElementById('meeting-editor');
    if (!meeting) { container.innerHTML = ''; return; }
    container.innerHTML = `<form id="meeting-form" class="meeting-editor">
      <div class="meeting-card meeting-heading">
        <div class="meeting-heading-top"><h2 data-meeting-title>${esc(meeting.title || 'Nouvelle réunion')}</h2><span class="meeting-status-pill">${statuses[meeting.status]}</span>
          <span id="agenda-progress">${meeting.topics.filter(t => t.checked).length} / ${meeting.topics.length} traités</span></div>
        <details class="meeting-settings" ${!meeting.id ? 'open' : ''}><summary>Modifier le titre, la date ou l’état</summary><div class="meeting-metadata">
        <label>Titre<input name="title" required maxlength="200" value="${esc(meeting.title)}"></label>
        <label>Date et heure<input name="scheduledAt" type="datetime-local" value="${localDate(meeting.scheduledAt)}"></label>
        <label>État<select name="status">${Object.entries(statuses).map(([value, label]) => `<option value="${value}" ${meeting.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        </div></details>
        <progress id="agenda-progress-bar" max="${Math.max(1, meeting.topics.length)}" value="${meeting.topics.filter(t => t.checked).length}" aria-label="Avancement de l’ordre du jour"></progress>
      </div>
      <div class="agenda-toolbar"><h3>Ordre du jour <span>(${meeting.topics.length})</span></h3>
        <div class="agenda-view-actions"><button type="button" id="expand-topics">Tout ouvrir</button><button type="button" id="collapse-topics">Tout replier</button></div></div>
      <div class="agenda-list">${meeting.topics.map((topic, index) => `<details class="meeting-card topic-card ${topic.checked ? 'topic-done' : ''}" data-topic="${index}" ${expandedTopics.has(topic.id) ? 'open' : ''}>
        <summary><input type="checkbox" data-field="checked" aria-label="Sujet ${index + 1} traité" ${topic.checked ? 'checked' : ''}>
          <span class="topic-number">${String(index + 1).padStart(2, '0')}</span><span class="topic-summary-content"><strong data-topic-summary>${esc(topic.title || 'Nouveau sujet')}</strong>
          </span><span class="topic-meta"><span data-topic-state class="topic-state">${topic.checked ? 'Traité' : 'À aborder'}</span><span data-notes-state title="${topic.notes ? 'Contient des notes' : 'Aucune note'}">${topic.notes ? 'Notes' : ''}</span>${topic.links.length ? `<span title="Liens liés au sujet">↗ ${topic.links.length}</span>` : ''}</span>
          <span class="topic-chevron" aria-hidden="true">⌄</span></summary>
        <div class="topic-body">
        <label>Sujet<input data-field="title" required maxlength="300" value="${esc(topic.title)}"></label>
        <label>Notes et décisions<textarea data-field="notes" maxlength="20000" placeholder="Notes, décisions… Tapez @commandes pour insérer une fiche.">${esc(topic.notes)}</textarea></label>
        <div>${topic.links.map((link, linkIndex) => `<div>${previewMarkup(link)}<button type="button" data-action="unlink" data-link="${linkIndex}" aria-label="Retirer le lien ${linkIndex + 1}">Retirer le lien</button></div>`).join('')}</div>
        <label>Lien ou mention de page<input type="text" data-link-url placeholder="@commandes, @salles… ou /orders.html?id=…" maxlength="2048"></label>
        <div class="flex flex-wrap gap-2"><button type="button" data-action="link" ${topic.links.length >= 10 ? 'disabled' : ''}>Ajouter le lien</button>
          <button type="button" data-action="up" aria-label="Monter le sujet ${index + 1}" ${index === 0 ? 'disabled' : ''}>↑ Monter</button>
          <button type="button" data-action="down" aria-label="Descendre le sujet ${index + 1}" ${index === meeting.topics.length - 1 ? 'disabled' : ''}>↓ Descendre</button>
          <button type="button" data-action="remove">Retirer le sujet</button></div>
        </div></details>`).join('') || '<div class="agenda-empty"><span aria-hidden="true">☷</span><h4>Le début d’une bonne discussion</h4><p>Ajoutez le premier sujet pour préparer votre réunion.</p></div>'}</div>
      <div class="meeting-savebar">
        <div class="flex flex-wrap gap-2"><button type="button" id="reload-meeting" ${!meeting.id ? 'disabled' : ''}>Recharger</button><button type="submit" class="meeting-primary">Enregistrer</button></div></div>
    </form>`;
    const form = document.getElementById('meeting-form');
    document.getElementById('meeting-conflict').hidden = !conflict;
    form.addEventListener('invalid', event => {
      const details = event.target.closest('details');
      if (details) details.open = true;
    }, true);
    form.querySelectorAll('details[data-topic]').forEach(details => {
      details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        const id = meeting.topics[Number(details.dataset.topic)].id;
        if (details.open) expandedTopics.add(id); else { expandedTopics.delete(id); dismissMentions(); }
      });
    });
    document.getElementById('expand-topics').onclick = () => {
      meeting.topics.forEach(t => expandedTopics.add(t.id));
      form.querySelectorAll('details[data-topic]').forEach(el => { el.open = true; });
    };
    document.getElementById('collapse-topics').onclick = () => {
      expandedTopics.clear(); dismissMentions();
      form.querySelectorAll('details[data-topic]').forEach(el => { el.open = false; });
    };
    const canInsertLink = input => {
      const topic = meeting.topics[Number(input.closest('[data-topic]').dataset.topic)];
      if (busy) return false;
      if (topic.links.length >= 10 || meeting.topics.reduce((n, t) => n + t.links.length, 0) >= 100) {
        message('Limite atteinte : 10 liens par sujet et 100 par réunion.'); return false;
      }
      return true;
    };
    dismissMentions = attachMeetingMentions(form, { previewMarkup, canSelect: canInsertLink,
      onSelect: (link, input, range) => {
        const topicIndex = Number(input.closest('[data-topic]').dataset.topic);
        const topic = meeting.topics[topicIndex];
        if (!topic.links.some(l => l.type === link.type && l.id === link.id)) topic.links.push(link);
        input.setRangeText('', range.start, range.end, 'end');
        if (input.dataset.field === 'notes') topic.notes = input.value;
        const notes = input.dataset.field === 'notes';
        markDirty(); renderEditor();
        const target = container.querySelector(`[data-topic="${topicIndex}"] ${notes ? 'textarea' : '[data-link-url]'}`);
        target.focus(); target.setSelectionRange(range.start, range.start);
      }
    });
    form.addEventListener('input', event => {
      const input = event.target;
      const section = input.closest('[data-topic]');
      if (input.hasAttribute('data-link-url')) return;
      if (section) {
        const topic = meeting.topics[Number(section.dataset.topic)];
        topic[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value;
        section.querySelector('[data-topic-summary]').textContent = topic.title || 'Nouveau sujet';
        section.querySelector('[data-topic-state]').textContent = topic.checked ? 'Traité' : 'À aborder';
        section.querySelector('[data-notes-state]').textContent = topic.notes ? 'Notes' : '';
        section.querySelector('[data-notes-state]').title = topic.notes ? 'Contient des notes' : 'Aucune note';
        section.classList.toggle('topic-done', topic.checked);
        const done = meeting.topics.filter(t => t.checked).length;
        document.getElementById('agenda-progress').textContent = `${done} / ${meeting.topics.length} traités`;
        document.getElementById('agenda-progress-bar').value = done;
      } else if (input.name) {
        meeting[input.name] = input.name === 'scheduledAt' ? (input.value ? new Date(input.value).toISOString() : null) : input.value;
        if (input.name === 'title') form.querySelector('[data-meeting-title]').textContent = meeting.title || 'Nouvelle réunion';
        if (input.name === 'status') form.querySelector('.meeting-status-pill').textContent = statuses[meeting.status];
      }
      markDirty();
    });
    document.getElementById('reload-meeting').onclick = () => openMeeting(meeting.id);
    form.addEventListener('click', async event => {
      const button = event.target.closest('[data-action]');
      if (!button || busy) return;
      const section = button.closest('[data-topic]');
      const index = Number(section.dataset.topic);
      const topic = meeting.topics[index];
      const action = button.dataset.action;
      if (action === 'link') {
        setBusy(true); button.disabled = true;
        try {
          const link = await api.post('/meetings/link-preview', { url: section.querySelector('[data-link-url]').value });
          if (!topic.links.some(l => l.type === link.type && l.id === link.id)) topic.links.push(link);
        } catch (err) { message(err.message); return; }
        finally { setBusy(false); button.disabled = false; }
      } else if (action === 'remove') {
        if (!window.confirm('Retirer ce sujet et ses notes ?')) return;
        expandedTopics.delete(topic.id); meeting.topics.splice(index, 1);
      } else if (action === 'unlink') topic.links.splice(Number(button.dataset.link), 1);
      else {
        const target = index + (action === 'up' ? -1 : 1);
        [meeting.topics[index], meeting.topics[target]] = [meeting.topics[target], meeting.topics[index]];
      }
      markDirty(); renderEditor();
    });
    form.onsubmit = event => { event.preventDefault(); saveMeeting(true); };
  }
  function stopLive() { liveGeneration++; liveController?.abort(); }
  function withPreviews(document, remote) {
    const previews = new Map(remote.topics.flatMap(t => t.links.map(l => [`${l.type}:${l.id}`, l.preview])));
    const own = new Map(meeting.topics.flatMap(t => t.links.map(l => [`${l.type}:${l.id}`, l.preview])));
    return { ...remote, ...document, topics: document.topics.map(t => ({ ...t,
      links: t.links.map(l => ({ ...l, preview: previews.has(`${l.type}:${l.id}`) ? previews.get(`${l.type}:${l.id}`) : own.get(`${l.type}:${l.id}`) || null })) })) };
  }
  function renderPreservingInput(oldTopics = meeting.topics) {
    const active = document.activeElement;
    const oldTopic = active?.closest('[data-topic]');
    const topicId = oldTopic ? oldTopics[Number(oldTopic.dataset.topic)]?.id : null;
    const field = active?.dataset.field;
    const linkInput = active?.hasAttribute('data-link-url');
    const name = active?.name;
    const selection = [active?.selectionStart, active?.selectionEnd];
    const settingsOpen = document.querySelector('.meeting-settings')?.open;
    const scroll = window.scrollY;
    const transient = [...document.querySelectorAll('[data-link-url]')].map(input => [oldTopics[Number(input.closest('[data-topic]').dataset.topic)]?.id, input.value]);
    renderEditor();
    const settings = document.querySelector('.meeting-settings'); if (settings) settings.open = settingsOpen;
    for (const [id, value] of transient) {
      const index = meeting.topics.findIndex(t => t.id === id);
      const input = document.querySelector(`[data-topic="${index}"] [data-link-url]`); if (input) input.value = value;
    }
    const index = topicId ? meeting.topics.findIndex(t => t.id === topicId) : -1;
    const target = index >= 0 ? document.querySelector(`[data-topic="${index}"] ${linkInput ? '[data-link-url]' : `[data-field="${field}"]`}`) : (name ? document.querySelector(`[name="${name}"]`) : null);
    if (target) {
      target.focus({ preventScroll: true });
      if (selection[0] != null && target.setSelectionRange && !['checkbox', 'datetime-local'].includes(target.type)) target.setSelectionRange(...selection);
      if (linkInput) target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    window.scrollTo(0, scroll);
  }
  function applyRemote(remote, prefer) {
    if (!meeting || remote.id !== meeting.id || !baseline || remote.version <= meeting.version) return;
    const local = snapshot(meeting);
    const merged = mergeMeeting(baseline, local, snapshot(remote), prefer);
    if (merged.conflicts.length && !prefer) {
      conflict = { base: baseline, remote }; clearTimeout(saveTimer);
      document.getElementById('meeting-conflict').hidden = false;
      message('Un collègue a modifié les mêmes informations. Choisissez la version à garder.'); return;
    }
    const previousTopics = meeting.topics;
    meeting = withPreviews(merged.document, remote);
    baseline = snapshot(remote); conflict = null;
    dirty = JSON.stringify(snapshot(meeting)) !== JSON.stringify(baseline);
    editEpoch++; renderPreservingInput(previousTopics);
    message(dirty ? 'Modifications fusionnées. Enregistrement…' : 'À jour en direct');
    if (dirty) scheduleSave();
  }
  async function saveMeeting(manual = false) {
    clearTimeout(saveTimer);
    if (!meeting || busy || saving || conflict || accessDenied) { if (dirty && !conflict) scheduleSave(); return; }
    const form = document.getElementById('meeting-form');
    if (!form?.checkValidity()) { message('Complétez les titres pour enregistrer automatiquement.'); if (manual) form?.reportValidity(); return; }
    const owner = meeting;
    const epoch = editEpoch;
    const payload = snapshot(meeting);
    saving = true; syncFab(); message('Enregistrement…');
    let retry = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      if (!owner.id && !creationBase) creationBase = payload;
      const saved = await apiFetch(owner.id ? `/meetings/${owner.id}` : '/meetings', {
        method: owner.id ? 'PATCH' : 'POST', signal: controller.signal,
        body: JSON.stringify(owner.id ? { ...payload, version: owner.version } : { ...payload, creationId })
      });
      if (meeting !== owner) return;
      const wasNew = !owner.id;
      history.replaceState(null, '', `/meetings.html?id=${encodeURIComponent(saved.id)}`);
      if (wasNew && JSON.stringify(snapshot(meeting)) !== JSON.stringify(snapshot(saved))) {
        meeting.id = saved.id; meeting.version = 0; baseline = creationBase;
        applyRemote(saved); startLive(); saveFailures = 0; retry = true;
        loadHistory(); return;
      }
      meeting.id = saved.id; meeting.version = saved.version;
      baseline = snapshot(saved);
      saveFailures = 0; retry = true;
      dirty = editEpoch !== epoch;
      if (!dirty) {
        // Keep the DOM and caret intact while acknowledging a background save.
        for (const key of ['title', 'scheduledAt', 'status']) meeting[key] = saved[key];
        const savedTopics = new Map(saved.topics.map(topic => [topic.id, topic]));
        for (const topic of meeting.topics) {
          const acknowledged = savedTopics.get(topic.id);
          if (acknowledged) Object.assign(topic, acknowledged);
        }
      }
      message(dirty ? 'Modifications en cours…' : 'Enregistré automatiquement');
      loadHistory();
      if (wasNew) startLive();
    } catch (err) {
      if (meeting !== owner) return;
      if (err.status === 409 || err.data?.code === 'MEETING_CONFLICT') {
        if (busy) { retry = true; return; }
        try {
          const remote = await apiFetch(`/meetings/${owner.id}`, { signal: controller.signal });
          if (meeting === owner) { applyRemote(remote); retry = true; }
        } catch (readError) { message(readError.message); }
      } else {
        accessDenied = [401, 403, 404].includes(err.status);
        retry = !accessDenied && (!err.status || err.status >= 500 || err.status === 429);
        saveFailures++;
        message(`Sauvegarde interrompue. Vos notes restent à l’écran. ${err.message}`);
      }
    } finally {
      clearTimeout(timeout);
      saving = false; syncFab();
      if (dirty && !conflict && retry) scheduleSave(Math.min(30000, 2000 * Math.max(1, saveFailures)));
    }
  }
  async function startLive() {
    stopLive();
    if (!meeting?.id) return;
    const generation = liveGeneration;
    const id = meeting.id;
    let failures = 0;
    while (generation === liveGeneration && meeting?.id === id) {
      if (saving || busy || conflict || document.hidden) { await new Promise(resolve => setTimeout(resolve, 500)); continue; }
      liveController = new AbortController();
      try {
        const remote = await apiFetch(`/meetings/${id}/updates?version=${meeting.version}`, { signal: liveController.signal });
        if (generation !== liveGeneration || meeting?.id !== id) return;
        if (remote && !saving && !busy && !conflict) applyRemote(remote);
        failures = 0;
      } catch (err) {
        if (generation !== liveGeneration) return;
        if ([401, 403, 404].includes(err.status)) { accessDenied = true; clearTimeout(saveTimer); message('Synchronisation arrêtée : accès indisponible. Vos notes restent à l’écran.'); return; }
        failures++;
        message('Connexion interrompue. Reconnexion automatique… Vos notes sont conservées.');
      }
      // Avoid spinning if a proxy returns empty responses immediately, or while saving/conflicted.
      await new Promise(resolve => setTimeout(resolve, failures ? Math.min(30000, 2000 * failures) : 500));
    }
  }
  async function loadHistory() {
    if (historyLoading) return;
    historyLoading = true;
    try {
      const result = await api.get('/meetings', { page, status: document.getElementById('history-status').value });
      pages = result.pagination.totalPages;
      document.getElementById('meeting-history').innerHTML = result.data.map(m => `<button type="button" class="meeting-card text-left w-full mb-2" data-meeting="${esc(m.id)}"><strong>${esc(m.title)}</strong><br><span class="text-sm text-slate-500">${esc(statuses[m.status])} · ${m.scheduledAt ? esc(new Date(m.scheduledAt).toLocaleString('fr-FR')) : 'Sans date'}</span></button>`).join('') || '<p>Aucune réunion.</p>';
      document.getElementById('history-page').textContent = `${page} / ${Math.max(1, pages)}`;
      document.getElementById('previous-page').disabled = page <= 1;
      document.getElementById('next-page').disabled = page >= pages;
    } catch (err) { message(err.message); }
    finally { historyLoading = false; }
  }
  async function openMeeting(id) {
    if (busy || saving || !canLeave()) return;
    setBusy(true);
    try {
      const data = await api.get(`/meetings/${encodeURIComponent(id)}`);
      stopLive(); clearTimeout(saveTimer); conflict = null; accessDenied = false;
      meeting = data; baseline = snapshot(data); dirty = false; editEpoch++; expandedTopics.clear();
      document.querySelector('.meeting-history-panel').open = false;
      history.replaceState(null, '', `/meetings.html?id=${encodeURIComponent(id)}`);
      renderEditor(); message('Réunion chargée');
      startLive();
    } catch (err) { message(err.message); }
    finally { setBusy(false); }
  }
  async function init() {
    const user = await requireLogin();
    document.getElementById('app').innerHTML = getLayoutTemplate('Réunions', 'meetings') + `
      <div class="meetings-tools"><button id="back-meetings" type="button" hidden>← Réunions</button><details class="meeting-controls meeting-history-panel" open><summary>Historique des réunions</summary><div class="meeting-history-body">
        <label for="history-status">Filtrer par état</label><select id="history-status" class="block border rounded p-2 my-2 w-full"><option value="">Tous les états</option>${Object.entries(statuses).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <div id="meeting-history"></div><div class="flex gap-2 items-center"><button id="previous-page" aria-label="Page précédente">←</button><span id="history-page"></span><button id="next-page" aria-label="Page suivante">→</button></div></div></details>
        </div>
      <p id="meeting-state" role="status" aria-live="polite" class="meeting-feedback"></p>
      <div id="meeting-conflict" class="meeting-conflict" hidden><p>Les mêmes informations ont été modifiées sur un autre écran. Les autres changements sont conservés dans les deux choix.</p><button type="button" data-conflict="local">Garder mes modifications</button><button type="button" data-conflict="remote">Utiliser la version distante</button></div>
      <div class="meeting-grid">
        <section id="meeting-editor" aria-label="Détail de la réunion"></section></div></div></main></div>
      <button id="meeting-fab" class="meeting-fab" type="button" data-mobile-fab="true" aria-label="Créer une réunion" title="Créer une réunion"><span aria-hidden="true">+</span></button>`;
    renderNav('meetings'); initUserNav(user);
    const historyPanel = document.querySelector('.meeting-history-panel');
    historyPanel.addEventListener('toggle', syncFab);
    document.addEventListener('pointerdown', event => {
      if (meeting && !historyPanel.contains(event.target) && !event.target.closest('#meeting-fab')) { historyPanel.open = false; syncFab(); }
    });
    historyPanel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { historyPanel.open = false; historyPanel.querySelector('summary').focus(); }
    });
    if (!['ADMIN', 'TECH'].includes(user.role)) { document.getElementById('page-content').textContent = 'Accès refusé'; document.getElementById('meeting-fab').remove(); return; }
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
    window.addEventListener('pagehide', () => { stopLive(); clearTimeout(saveTimer); });
    window.addEventListener('pageshow', event => { if (event.persisted) { startLive(); scheduleSave(); } });
    window.addEventListener('online', () => { if (!accessDenied) { startLive(); scheduleSave(); } });
    document.querySelectorAll('[data-conflict]').forEach(button => button.onclick = () => {
      if (!conflict || saving) return;
      const { base, remote } = conflict;
      baseline = base;
      applyRemote(remote, button.dataset.conflict);
    });
    document.getElementById('meeting-fab').onclick = () => {
      if (!meeting || historyPanel.open) createMeeting(); else addTopic();
    };
    document.getElementById('back-meetings').onclick = () => {
      if (busy || saving || !canLeave()) return;
      stopLive(); clearTimeout(saveTimer); baseline = null; conflict = null;
      meeting = null; dirty = false; expandedTopics.clear(); historyPanel.open = true;
      history.replaceState(null, '', '/meetings.html'); renderEditor(); message('');
    };
    document.getElementById('meeting-history').onclick = event => { const button = event.target.closest('[data-meeting]'); if (button) openMeeting(button.dataset.meeting); };
    document.getElementById('history-status').onchange = () => { page = 1; loadHistory(); };
    document.getElementById('previous-page').onclick = () => { if (page > 1) { page--; loadHistory(); } };
    document.getElementById('next-page').onclick = () => { if (page < pages) { page++; loadHistory(); } };
    renderEditor(); await loadHistory();
    let historyTimer;
    const startHistorySync = () => {
      clearInterval(historyTimer);
      historyTimer = setInterval(() => {
        if (!document.hidden && (!meeting || historyPanel.open)) loadHistory();
      }, 5000);
    };
    startHistorySync();
    window.addEventListener('pageshow', event => { if (event.persisted) startHistorySync(); });
    window.addEventListener('pagehide', () => clearInterval(historyTimer));
    const id = new URLSearchParams(location.search).get('id');
    if (id) await openMeeting(id);
  }
  init();
})();
