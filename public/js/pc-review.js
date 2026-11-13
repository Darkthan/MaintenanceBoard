'use strict';

(() => {
  let user;
  let data;
  let days = 60;
  let loadVersion = 0;
  const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const roomLabel = room => room ? [room.name, room.building].filter(Boolean).join(' · ') : 'Sans salle';
  const field = (label, value) => `<dt>${label}</dt><dd>${esc(value)}</dd>`;
  const link = e => `<a href="/equipment.html?focus=${encodeURIComponent(e.id)}">${esc(e.name)}</a>`;
  const basics = e => `${field('Hostname actuel', e.agentHostname)}${field('Numéro de série', e.serialNumber)}${field('Salle actuelle', roomLabel(e.room))}`;

  function renamedCard(e, index) {
    const suggestionRoom = data.rooms.find(r => r.id === e.suggestion?.roomId);
    const editable = ['ADMIN', 'TECH'].includes(user.role);
    return `<article class="review-card"><h3 class="font-semibold text-lg">${link(e)}</h3>
      <dl>${basics(e)}${field('Ancien hostname', e.hostnameChangeOld)}${field('Nouveau hostname', e.hostnameChangeNew)}${field('Changement détecté le', formatDate(e.hostnameChangedAt, true))}${field('Suggestion de salle', suggestionRoom ? roomLabel(suggestionRoom) : 'Aucune correspondance suffisante')}</dl>
      ${editable ? `<form data-review-index="${index}">
        ${user.role === 'ADMIN' ? `<label>Nom de la fiche équipement<input name="name" value="${esc(e.name)}" required maxlength="255" /></label>
        <button type="button" data-use-hostname class="mt-2 text-blue-700">Reprendre le nouveau hostname</button>` : '<p class="text-sm text-slate-500 mt-3">La modification du nom est réservée aux administrateurs.</p>'}
        <label>Salle après traitement<select name="roomId">
          <option value="__keep">Conserver la salle actuelle</option><option value="">Sans salle</option>
          ${data.rooms.map(r => `<option value="${esc(r.id)}">${esc(roomLabel(r))}</option>`).join('')}
        </select></label>
        ${suggestionRoom ? '<button type="button" data-use-room class="mt-2 text-blue-700">Choisir la salle suggérée</button>' : ''}
        <div class="review-actions"><button type="submit" class="bg-blue-600 text-white">Valider le traitement</button><button type="button" data-ignore>Ignorer le changement</button></div>
        <p data-feedback role="status" class="mt-2 text-sm text-red-700"></p>
      </form>` : ''}</article>`;
  }

  function disconnectedCard(e, never = false) {
    return `<article class="review-card"><h3 class="font-semibold text-lg">${link(e)}</h3><dl>${basics(e)}
      ${field('Dernière connexion', never ? 'Jamais connecté' : formatDate(e.lastSeenAt, true))}
      ${field('Durée d’inactivité', never ? 'Inconnue' : `${e.inactivityDays} jours révolus`)}
      </dl></article>`;
  }

  async function load() {
    const version = ++loadVersion;
    const state = document.getElementById('review-state');
    state.textContent = 'Chargement…';
    try {
      const response = await api.get('/pc-review', { days });
      if (version !== loadVersion) return;
      data = response;
      document.getElementById('renamed-cards').innerHTML = data.renamed.map(renamedCard).join('') || '<p>Aucun renommage à traiter.</p>';
      document.getElementById('inactive-cards').innerHTML = data.inactive.map(e => disconnectedCard(e)).join('') || '<p>Aucun PC au-delà de ce seuil.</p>';
      document.getElementById('never-cards').innerHTML = data.neverConnected.map(e => disconnectedCard(e, true)).join('') || '<p>Aucun PC jamais connecté.</p>';
      document.getElementById('renamed-count').textContent = data.renamed.length;
      document.getElementById('inactive-count').textContent = data.inactive.length;
      document.getElementById('never-count').textContent = data.neverConnected.length;
      state.textContent = '';
      document.querySelectorAll('[data-review-index]').forEach(form => {
        const e = data.renamed[Number(form.dataset.reviewIndex)];
        form.querySelector('[data-use-hostname]')?.addEventListener('click', () => { form.elements.name.value = e.hostnameChangeNew; });
        form.querySelector('[data-use-room]')?.addEventListener('click', () => { form.elements.roomId.value = e.suggestion.roomId; });
        form.addEventListener('submit', event => { event.preventDefault(); review(form, e, 'validate'); });
        form.querySelector('[data-ignore]').addEventListener('click', () => review(form, e, 'ignore'));
      });
    } catch (err) { if (version === loadVersion) state.textContent = err.message; }
  }

  async function review(form, e, action) {
    const payload = { changeId: e.hostnameChangeId, action };
    if (action === 'validate') {
      if (user.role === 'ADMIN') payload.name = form.elements.name.value;
      if (form.elements.roomId.value !== '__keep') payload.roomId = form.elements.roomId.value || null;
    }
    form.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      await api.patch(`/pc-review/${encodeURIComponent(e.id)}`, payload);
      showToast(action === 'ignore' ? 'Changement ignoré' : 'Fiche mise à jour', 'success');
      await load();
    } catch (err) {
      const conflict = err.status === 409 || err.data?.code === 'HOSTNAME_REVIEW_CONFLICT' || /déjà été traité/.test(err.message);
      if (conflict) {
        await load();
        document.getElementById('review-state').textContent = 'Un nouveau changement est intervenu ou le renommage a déjà été traité. La liste a été actualisée ; vérifiez les nouvelles informations.';
      } else {
        form.querySelector('[data-feedback]').textContent = err.message;
        form.querySelectorAll('button').forEach(b => { b.disabled = false; });
      }
    }
  }

  async function init() {
    user = await requireLogin();
    document.getElementById('app').innerHTML = getLayoutTemplate('PC à vérifier', 'pc-review') + `
      <p id="review-state" role="status" aria-live="polite" class="text-sm text-red-700 mb-4"></p>
      <div class="space-y-8">
        <section aria-labelledby="renamed-title"><h2 id="renamed-title" class="text-xl font-semibold mb-2">PC renommés (<span id="renamed-count">…</span>)</h2>
          <p class="text-sm text-slate-600 mb-4">Vérifiez le nom et la salle de la fiche. Le PC Windows ne sera pas renommé.</p>
          <div id="renamed-cards" class="review-grid"></div></section>
        <section aria-labelledby="inactive-title"><h2 id="inactive-title" class="text-xl font-semibold mb-2">PC sans connexion récente (<span id="inactive-count">…</span>)</h2>
          <form id="days-form" class="flex flex-wrap items-end gap-3 mb-4">
            <label for="days" class="text-sm">Dernière remontée datant de plus de (jours)
              <input id="days" name="days" type="number" min="1" max="36500" step="1" value="60" required class="block border border-slate-300 rounded-lg px-3 py-2 mt-1 w-40 text-base" /></label>
            <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Appliquer</button>
          </form><p class="text-sm text-slate-600 mb-4">Calculé sur la dernière remontée de l’agent. Le statut de gestion reste inchangé.</p>
          <div id="inactive-cards" class="review-grid"></div>
          <h3 class="text-lg font-semibold mt-6 mb-3">Jamais connectés (<span id="never-count">…</span>)</h3>
          <div id="never-cards" class="review-grid"></div></section>
      </div></div></main></div>`;
    renderNav('pc-review');
    initUserNav(user);
    document.getElementById('days-form').addEventListener('submit', event => {
      event.preventDefault();
      const input = document.getElementById('days');
      if (!input.checkValidity()) return input.reportValidity();
      days = Number(input.value);
      load();
    });
    await load();
  }
  init();
})();
