const isFreeLoanPage = document.body.dataset.loanScope === 'free';
let currentUser;
let loanResources = [];
let loanLinks = [];
let loanReservations = [];
let currentReservationEditId = null;
let reservationEquipmentSelection = new Set();

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function getLocalDayKey(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatStatus(status) {
  return {
    PENDING: '<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">En attente</span>',
    APPROVED: '<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Approuvé</span>',
    REJECTED: '<span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Refusé</span>',
    CANCELLED: '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Annulé</span>',
    RETURNED: '<span class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Restitué</span>'
  }[status] || status;
}

function formatContractStatus(status) {
  return {
    PENDING: '<span class="inline-flex items-center rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">Signature en attente</span>',
    SIGNED: '<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Fiche signée</span>',
    CANCELLED: '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Fiche annulée</span>',
    EXPIRED: '<span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Lien expiré</span>'
  }[status] || '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sans fiche</span>';
}

const FREE_LOAN_RESOURCE_ID = 'free-loan';
function addFreeLoanItem(item = {}) {
  const row = document.createElement('div');
  row.className = 'grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] items-center gap-2';
  row.dataset.freeLoanItem = '';
  row.innerHTML = `<input data-free-name type="text" maxlength="200" required aria-label="Désignation du matériel" placeholder="Désignation du matériel" value="${escapeHtml(item.name || '')}" class="min-w-0 w-full sm:flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    <input data-free-type type="text" maxlength="200" aria-label="Type de matériel" placeholder="Type de matériel" value="${escapeHtml(item.type || '')}" class="min-w-0 w-full sm:flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    <input data-free-serial type="text" maxlength="200" aria-label="Numéro de série (facultatif)" placeholder="N° de série (facultatif)" value="${escapeHtml(item.serialNumber || '')}" class="min-w-0 flex-1 sm:w-40 sm:flex-none rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    <button type="button" aria-label="Retirer ce matériel" class="px-2 py-2 text-red-600 hover:text-red-800">×</button>`;
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    if (!document.querySelector('[data-free-loan-item]')) addFreeLoanItem();
  });
  document.getElementById('free-loan-items').appendChild(row);
  syncFreeLoanForm();
}

function syncFreeLoanForm() {
  const isFree = document.getElementById('resv-resource').value === FREE_LOAN_RESOURCE_ID;
  document.getElementById('free-loan-panel').classList.toggle('hidden', !isFree);
  const noPeriod = document.getElementById('resv-no-period');
  noPeriod.disabled = !isFree;
  document.getElementById('resv-no-period-row').classList.toggle('hidden', !isFree);
  document.getElementById('resv-date-picker').classList.toggle('hidden', isFree && noPeriod.checked);
  document.getElementById('resv-recurrence-panel').classList.toggle('hidden', !!currentReservationEditId || (isFree && noPeriod.checked));
  const email = document.getElementById('resv-email');
  if (email.dataset.defaultPlaceholder === undefined) email.dataset.defaultPlaceholder = email.placeholder;
  email.placeholder = isFree ? 'Facultatif pour le lien mobile ; email de l’emprunteur pour l’envoi' : email.dataset.defaultPlaceholder;
  document.querySelectorAll('#free-loan-items input').forEach(input => { input.disabled = !isFree; });
}

function openFreeLoanModal() {
  if (currentUser?.role !== 'ADMIN') return;
  openReservationModal();
  document.getElementById('resv-resource').value = FREE_LOAN_RESOURCE_ID;
  document.getElementById('reservation-modal-title').textContent = 'Feuille de prêt Libre';
  renderReservationEquipmentSelector();
  dpLoadSchedule(FREE_LOAN_RESOURCE_ID);
}

function getLoanResourceById(resourceId) {
  if (resourceId === FREE_LOAN_RESOURCE_ID) return { id: resourceId, name: 'Libre', equipments: [] };
  return loanResources.find(item => item.id === resourceId) || null;
}

function buildReservationContractDefaultText(resource) {
  const resourceLabel = resource?.id === FREE_LOAN_RESOURCE_ID ? 'le matériel décrit ci-dessous' : resource?.name || 'le matériel concerné';
  return `Je reconnais recevoir en prêt ${resourceLabel} et m'engage à l'utiliser conformément aux consignes, à en prendre soin, puis à restituer l'ensemble du matériel complet et en bon état selon les modalités convenues avec l’établissement. Le retour sera validé par un administrateur ou un technicien.`;
}

function updateReservationEquipmentCount() {
  const countEl = document.getElementById('resv-equip-count');
  if (!countEl) return;
  if (reservationEquipmentSelection.size > 0) {
    countEl.textContent = `${reservationEquipmentSelection.size} sélectionné(s)`;
    countEl.classList.remove('hidden');
  } else {
    countEl.classList.add('hidden');
  }
}

function toggleReservationEquipment(id) {
  if (reservationEquipmentSelection.has(id)) {
    reservationEquipmentSelection.delete(id);
  } else {
    reservationEquipmentSelection.add(id);
  }
  renderReservationEquipmentSelector();
}

function renderReservationEquipmentSelector() {
  syncFreeLoanForm();
  const panel = document.getElementById('reservation-equipment-panel');
  const list = document.getElementById('resv-equip-list');
  const resource = getLoanResourceById(document.getElementById('resv-resource').value);
  const equipments = Array.isArray(resource?.equipments) ? resource.equipments : [];

  if (!equipments.length) {
    reservationEquipmentSelection = new Set();
    panel.classList.add('hidden');
    list.innerHTML = '';
    updateReservationEquipmentCount();
    return;
  }

  panel.classList.remove('hidden');
  list.innerHTML = equipments.map(eq => {
    const selected = reservationEquipmentSelection.has(eq.id);
    const label = [eq.type, eq.brand, eq.model].filter(Boolean).join(' · ');
    return `
      <button type="button" onclick="toggleReservationEquipment('${eq.id}')"
        class="flex w-full items-start gap-3 px-3 py-3 text-left transition ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}">
        <span class="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}">
          ${selected ? '<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium ${selected ? 'text-blue-900' : 'text-slate-700'}">${escapeHtml(eq.name)}</span>
          <span class="mt-0.5 block text-xs text-slate-500">
            ${label ? escapeHtml(label) : 'Appareil lié à la ressource'}
            ${eq.serialNumber ? ` · <span class="font-mono">${escapeHtml(eq.serialNumber)}</span>` : ''}
            ${eq.lotNumber ? ` · Lot ${eq.lotNumber}` : ''}
          </span>
        </span>
      </button>`;
  }).join('');
  updateReservationEquipmentCount();
}

function closeResourceModal() {
  const el = document.getElementById('resource-modal');
  el.classList.add('hidden');
  el.classList.remove('flex');
}

function closeLinkModal() {
  const el = document.getElementById('link-modal');
  el.classList.add('hidden');
  el.classList.remove('flex');
}

// ── Picker multi-équipements ──────────────────────────────────────
let eqPickerAll = [];
let eqPickerSelected = new Set();   // Set<equipmentId>
let eqLotMap = new Map();           // Map<equipmentId, lotNumber>

function getFormTotalSlots() {
  const usesBundles = document.getElementById('resource-uses-bundles').checked;
  const totalUnits = parseInt(document.getElementById('resource-total-units').value) || 1;

  if (!usesBundles) {
    return totalUnits;
  }

  const bundleSize = Math.max(1, parseInt(document.getElementById('resource-bundle-size').value) || 1);
  return Math.max(1, Math.floor(totalUnits / bundleSize));
}

function renderEqPicker(filter = '') {
  const list = document.getElementById('eq-picker-list');
  const countEl = document.getElementById('eq-picker-count');
  const q = filter.toLowerCase();
  const filtered = q
    ? eqPickerAll.filter(e =>
        (e.name + (e.serialNumber || '') + (e.type || '')).toLowerCase().includes(q))
    : eqPickerAll;

  if (filtered.length === 0) {
    list.innerHTML = '<p class="px-3 py-3 text-slate-400 text-xs text-center">Aucun équipement trouvé</p>';
  } else {
    list.innerHTML = filtered.map(eq => {
      const selected = eqPickerSelected.has(eq.id);
      const isRepair = eq.status === 'REPAIR';
      return `
        <div data-eq-id="${eq.id}" onclick="toggleEqPicker('${eq.id}')"
          class="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition select-none
            ${selected ? 'bg-blue-50 ring-inset ring-1 ring-blue-400' : 'hover:bg-slate-50'}">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium ${selected ? 'text-blue-800' : 'text-slate-700'} truncate">${escapeHtml(eq.name)}</p>
            ${eq.serialNumber ? `<p class="text-xs text-slate-400 font-mono">${escapeHtml(eq.serialNumber)}</p>` : ''}
          </div>
          ${isRepair ? '<span class="flex-shrink-0 text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded font-medium">En réparation</span>' : ''}
          ${selected ? `<svg class="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>` : ''}
        </div>`;
    }).join('');
  }

  if (eqPickerSelected.size > 0) {
    countEl.textContent = eqPickerSelected.size + ' sélectionné(s)';
    countEl.classList.remove('hidden');
  } else {
    countEl.classList.add('hidden');
  }

  updateLotBtnRow();
}

// ── Bouton "Répartir par lots" dans le formulaire ─────────────────
function updateLotBtnRow() {
  const totalSlots = getFormTotalSlots();
  const btnRow = document.getElementById('eq-lot-btn-row');
  if (totalSlots <= 1 || eqPickerSelected.size === 0) {
    btnRow.classList.add('hidden');
    return;
  }
  btnRow.classList.remove('hidden');
  // Résumé : "3 lots · 6 équipements"
  document.getElementById('eq-lot-btn-summary').textContent =
    `· ${totalSlots} lot(s) · ${eqPickerSelected.size} équipement(s)`;
}

// ── Modal répartition des lots ────────────────────────────────────
let lotModalDraftMap = new Map(); // copie de travail pendant que le modal est ouvert

function openLotModal() {
  const totalSlots = getFormTotalSlots();
  // Clamp les lots existants et copier dans le brouillon
  lotModalDraftMap = new Map();
  for (const id of eqPickerSelected) {
    const lot = Math.min(Math.max(1, eqLotMap.get(id) || 1), totalSlots);
    lotModalDraftMap.set(id, lot);
  }
  document.getElementById('lot-modal-subtitle').textContent =
    `${totalSlots} lot(s) · ${eqPickerSelected.size} équipement(s) sélectionné(s)`;
  renderLotModal();
  const m = document.getElementById('lot-modal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closeLotModal() {
  const m = document.getElementById('lot-modal');
  m.classList.add('hidden');
  m.classList.remove('flex');
}

function saveLotModal() {
  // Copier le brouillon dans eqLotMap
  for (const [id, lot] of lotModalDraftMap) eqLotMap.set(id, lot);
  closeLotModal();
  updateLotBtnRow();
}

function renderLotModal() {
  const totalSlots = getFormTotalSlots();
  // Grouper par lot
  const lots = {};
  for (let l = 1; l <= totalSlots; l++) lots[l] = [];
  for (const id of eqPickerSelected) {
    const lot = lotModalDraftMap.get(id) || 1;
    (lots[lot] = lots[lot] || []).push(id);
  }

  document.getElementById('lot-modal-body').innerHTML = Object.entries(lots).map(([lotNum, ids]) => {
    const lotN = parseInt(lotNum);
    const items = ids.map(id => {
      const eq = eqPickerAll.find(e => e.id === id);
      if (!eq) return '';
      const isRepair = eq.status === 'REPAIR';
      return `
        <div class="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
          <div class="flex-1 min-w-0">
            <p class="text-sm ${isRepair ? 'text-orange-600' : 'text-slate-700'} truncate">
              ${escapeHtml(eq.name)}
            </p>
            ${eq.serialNumber ? `<p class="text-xs text-slate-400 font-mono">${escapeHtml(eq.serialNumber)}</p>` : ''}
          </div>
          ${isRepair ? '<span class="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded flex-shrink-0">Réparation</span>' : ''}
          <div class="flex gap-1 flex-shrink-0">
            ${Array.from({length: totalSlots}, (_, i) => i + 1).map(n => `
              <button type="button" onclick="setLotDraft('${id}', ${n})"
                class="w-7 h-7 rounded-lg text-xs font-semibold transition
                  ${lotModalDraftMap.get(id) === n
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">
                ${n}
              </button>`).join('')}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="border border-slate-200 rounded-xl overflow-hidden">
        <div class="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">${lotN}</span>
          <span class="text-sm font-medium text-slate-700">Lot ${lotN}</span>
          <span class="text-xs text-slate-400 ml-auto">${ids.length} équipement(s)</span>
        </div>
        <div class="px-4 py-1">
          ${items || '<p class="text-xs text-slate-300 py-3 italic text-center">Aucun équipement assigné</p>'}
        </div>
      </div>`;
  }).join('');
}

function setLotDraft(equipmentId, lotNumber) {
  lotModalDraftMap.set(equipmentId, lotNumber);
  renderLotModal();
}

function toggleEqPicker(id) {
  if (eqPickerSelected.has(id)) {
    eqPickerSelected.delete(id);
    eqLotMap.delete(id);
  } else {
    eqPickerSelected.add(id);
    // Assigner au lot le moins rempli
    const totalSlots = getFormTotalSlots();
    const counts = {};
    for (let l = 1; l <= totalSlots; l++) counts[l] = 0;
    for (const [, lot] of eqLotMap) counts[lot] = (counts[lot] || 0) + 1;
    const minLot = Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0];
    eqLotMap.set(id, parseInt(minLot) || 1);
  }
  renderEqPicker(document.getElementById('eq-picker-search').value);
}

document.getElementById('eq-picker-search').addEventListener('input', e => {
  renderEqPicker(e.target.value);
});

// Gérer le toggle "Fonctionner par lots"
function updateBundlesToggle() {
  const usesBundles = document.getElementById('resource-uses-bundles').checked;
  document.getElementById('bundle-size-group').classList.toggle('hidden', !usesBundles);
  document.getElementById('total-lots-group').classList.toggle('hidden', usesBundles);
  updateLotBtnRow();
}

document.getElementById('resource-uses-bundles').addEventListener('change', updateBundlesToggle);

// Mettre à jour la répartition quand totalUnits change
document.getElementById('resource-total-units').addEventListener('input', () => {
  updateLotBtnRow();
});

// Recalculer le bouton lot si bundleSize ou totalLots changent
['resource-bundle-size', 'resource-total-lots'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => updateLotBtnRow());
});

async function openResourceModal(resource = null) {
  closeCreateMenu();
  document.getElementById('resource-form').reset();
  document.getElementById('resource-error').classList.add('hidden');
  document.getElementById('resource-id').value = resource?.id || '';
  document.getElementById('resource-modal-title').textContent = resource ? 'Modifier la ressource' : 'Nouvelle ressource';
  document.getElementById('resource-name').value = resource?.name || '';
  document.getElementById('resource-category').value = resource?.category || '';
  document.getElementById('resource-description').value = resource?.description || '';
  document.getElementById('resource-total-units').value = resource?.totalUnits || 1;
  document.getElementById('resource-bundle-size').value = resource?.bundleSize || 1;
  document.getElementById('resource-uses-bundles').checked = resource?.usesBundles === true;
  document.getElementById('resource-location').value = resource?.location || '';
  document.getElementById('resource-instructions').value = resource?.instructions || '';
  document.getElementById('resource-color').value = resource?.color || '';
  document.getElementById('resource-active').checked = resource?.isActive ?? true;

  if (resource && !resource.usesBundles) {
    const totalSlots = resource.totalSlots || resource.totalUnits || 1;
    document.getElementById('resource-total-lots').value = totalSlots;
  } else {
    document.getElementById('resource-total-lots').value = 1;
  }

  updateBundlesToggle();

  // Init picker
  eqPickerSelected = new Set((resource?.equipments || []).map(e => e.id));
  eqLotMap = new Map((resource?.equipments || []).map(e => [e.id, e.lotNumber || 1]));
  document.getElementById('eq-picker-search').value = '';
  document.getElementById('eq-picker-list').innerHTML =
    '<p class="px-3 py-3 text-slate-400 text-xs text-center">Chargement…</p>';
  document.getElementById('eq-picker-count').classList.add('hidden');
  document.getElementById('eq-lot-btn-row').classList.add('hidden');

  try {
    const data = await api.get('/equipment', { limit: 500 });
    eqPickerAll = (data.data || data.items || []);
    renderEqPicker();
  } catch (_) {
    document.getElementById('eq-picker-list').innerHTML =
      '<p class="px-3 py-3 text-red-400 text-xs text-center">Impossible de charger les équipements</p>';
  }

  const rm = document.getElementById('resource-modal');
  rm.classList.remove('hidden');
  rm.classList.add('flex');
}

function openReservationModal(reservation = null) {
  document.getElementById('reservation-form').reset();
  document.getElementById('resv-no-period').checked = reservation ? !reservation.startAt && !reservation.endAt : true;
  document.getElementById('reservation-error').classList.add('hidden');
  reservationEquipmentSelection = new Set();
  document.getElementById('free-loan-items').replaceChildren();
  const freeItems = reservation?.resourceId === FREE_LOAN_RESOURCE_ID ? reservation.selectedEquipments || [] : [];
  (freeItems.length ? freeItems : [{}]).forEach(addFreeLoanItem);
  currentReservationEditId = reservation?.id || null;
  document.getElementById('resv-id').value = currentReservationEditId || '';
  document.getElementById('resv-recurrence-type').value = 'none';
  document.getElementById('resv-until-row').classList.add('hidden');
  document.getElementById('resv-recurrence-panel').classList.toggle('hidden', !!reservation);
  document.getElementById('reservation-modal-title').textContent = reservation ? 'Modifier la réservation' : 'Nouvelle réservation';
  document.getElementById('reservation-submit-btn').textContent = reservation ? 'Enregistrer les modifications' : 'Enregistrer';

  dpInit();

  const sel = document.getElementById('resv-resource');
  sel.innerHTML = '<option value="">-- Choisir une ressource --</option>' + (currentUser?.role === 'ADMIN' ? '<option value="free-loan">Libre — matériel non référencé</option>' : '');
  loanResources.filter(r => r.isActive || r.id === reservation?.resourceId || r.id === reservation?.resource?.id).forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    const repairSuffix = r.hasRepairEquipment ? ' ⚠ En réparation' : '';
    opt.textContent = r.name + (r.category ? ` (${r.category})` : '') + repairSuffix;
    if (r.hasRepairEquipment && r.id !== reservation?.resourceId && r.id !== reservation?.resource?.id) opt.disabled = true;
    sel.appendChild(opt);
  });
  if (reservation) {
    const resourceId = reservation.resourceId || reservation.resource?.id || '';
    document.getElementById('resv-resource').value = resourceId;
    document.getElementById('resv-name').value = reservation.requesterName || '';
    document.getElementById('resv-email').value = reservation.requesterEmail || '';
    document.getElementById('resv-phone').value = reservation.requesterPhone || '';
    document.getElementById('resv-org').value = reservation.requesterOrganization || '';
    document.getElementById('resv-units').value = reservation.requestedUnits || 1;
    document.getElementById('resv-status').value = reservation.status || 'APPROVED';
    document.getElementById('resv-notes').value = reservation.internalNotes || '';
    reservationEquipmentSelection = new Set((reservation.selectedEquipments || []).map(item => item.equipmentId).filter(Boolean));
    document.getElementById('resv-contract-body').value = reservation.contractBody || buildReservationContractDefaultText(getLoanResourceById(resourceId));
    if (reservation.startAt && reservation.endAt) dpSetFromExisting(reservation.startAt, reservation.endAt);
    dpRenderCalendar();
    dpShowStartTimeGrid();
    dpShowEndTimeGrid();
    dpUpdateSelection();
    if (resourceId) dpLoadSchedule(resourceId);
  } else {
    const currentResource = getLoanResourceById(sel.value);
    document.getElementById('resv-contract-body').value = buildReservationContractDefaultText(currentResource);
  }
  renderReservationEquipmentSelector();
  const resm = document.getElementById('reservation-modal');
  resm.classList.remove('hidden');
  resm.classList.add('flex');
}

function closeReservationModal() {
  currentReservationEditId = null;
  document.getElementById('resv-id').value = '';
  const resm = document.getElementById('reservation-modal');
  resm.classList.add('hidden');
  resm.classList.remove('flex');
}

function editReservation(reservationId) {
  const reservation = loanReservations.find(item => item.id === reservationId);
  if (!reservation) return;
  closeCreateMenu();
  openReservationModal(reservation);
}

function toggleRecurrenceUntil() {
  const type = document.getElementById('resv-recurrence-type').value;
  document.getElementById('resv-until-row').classList.toggle('hidden', type === 'none');
}

function openLinkModal() {
  closeCreateMenu();
  document.getElementById('link-form').reset();
  document.getElementById('link-error').classList.add('hidden');
  document.getElementById('link-resource-id').innerHTML = '<option value="">Choisir une ressource active</option>' +
    loanResources.filter(resource => resource.isActive).map(resource => `<option value="${resource.id}">${resource.name}</option>`).join('');
  updateLinkScope();
  const lm = document.getElementById('link-modal');
  lm.classList.remove('hidden');
  lm.classList.add('flex');
}

function updateLinkScope() {
  const isGeneric = document.getElementById('link-scope-all').checked;
  document.getElementById('link-resource-picker').classList.toggle('hidden', isGeneric);
  if (isGeneric) {
    document.getElementById('link-resource-id').value = '';
  }
}

function renderResources() {
  document.getElementById('resource-count').textContent = `${loanResources.length} ressource${loanResources.length > 1 ? 's' : ''}`;
  document.getElementById('resources-list').innerHTML = loanResources.map(resource => `
    <article class="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <button type="button" onclick="openResourceModal(loanResources.find(resource => resource.id === '${resource.id}'))" class="text-left hover:text-blue-600 transition">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-semibold text-slate-800 hover:underline">${resource.name}</h3>
              ${resource.isActive ? '<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>' : '<span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Inactive</span>'}
              ${resource.usesBundles ? '<span class="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">Lots</span>' : ''}
              ${resource.hasRepairEquipment ? '<span class="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>En réparation</span>' : ''}
            </div>
            <p class="text-sm text-slate-500 mt-1">${resource.category || 'Sans catégorie'}</p>
          </button>
        </div>
        <button type="button" onclick="openResourceModal(loanResources.find(resource => resource.id === '${resource.id}'))" class="text-sm text-blue-600 hover:text-blue-700 transition flex-shrink-0">Modifier</button>
      </div>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div class="rounded-xl bg-white px-3 py-2 border border-slate-200">
          <p class="text-slate-400 text-xs uppercase tracking-wide">Capacité</p>
          <p class="mt-1 font-medium text-slate-800">${resource.totalUnits} unité(s)</p>
        </div>
        ${resource.usesBundles ? `<div class="rounded-xl bg-white px-3 py-2 border border-slate-200">
          <p class="text-slate-400 text-xs uppercase tracking-wide">Lots</p>
          <p class="mt-1 font-medium text-slate-800">${resource.totalSlots}</p>
        </div>` : ''}
      </div>
    </article>
  `).join('');
}

function renderMagicLinks() {
  document.getElementById('magic-links-list').innerHTML = loanLinks.length
    ? loanLinks.map(link => `
      <div class="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-medium text-slate-800">${link.title || 'Lien sans titre'}</p>
            <p class="text-sm text-slate-500">${link.resource?.name || 'Toutes les ressources'} · ${link._count?.requests || 0} demande(s)</p>
          </div>
          <button type="button" onclick="toggleLink('${link.id}', ${link.isActive ? 'false' : 'true'})" class="text-sm ${link.isActive ? 'text-red-600 hover:text-red-700' : 'text-emerald-600 hover:text-emerald-700'} transition">
            ${link.isActive ? 'Désactiver' : 'Réactiver'}
          </button>
        </div>
        <div class="flex flex-wrap gap-2 text-xs text-slate-500">
          <span class="${link.resource ? 'text-slate-500' : 'font-medium text-blue-700'}">${link.resource ? 'Ressource ciblée' : 'Lien générique'}</span>
          <span>${link.isActive ? 'Actif' : 'Inactif'}</span>
          <span>Créé le ${formatDateTime(link.createdAt)}</span>
          ${link.expiresAt ? `<span>Expire le ${formatDateTime(link.expiresAt)}</span>` : '<span>Sans expiration</span>'}
        </div>
        <div class="flex gap-2">
          <input type="text" readonly value="${link.url}" class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600" />
          <button type="button" onclick="copyText('${link.url.replace(/'/g, "\\'")}')" class="px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-700 hover:bg-slate-100 transition">Copier</button>
        </div>
      </div>
    `).join('')
    : '<p class="text-sm text-slate-400">Aucun lien de demande créé.</p>';
}

function setCreateMenuOpen(isOpen) {
  const menu = document.getElementById('loan-create-menu');
  const icon = document.getElementById('loan-create-icon');
  menu.classList.toggle('opacity-0', !isOpen);
  menu.classList.toggle('scale-95', !isOpen);
  menu.classList.toggle('pointer-events-none', !isOpen);
  menu.style.pointerEvents = isOpen ? 'auto' : 'none';
  icon.style.transform = isOpen ? 'rotate(45deg)' : '';
}

let createMenuIsOpen = false;

function toggleCreateMenu() {
  createMenuIsOpen = !createMenuIsOpen;
  setCreateMenuOpen(createMenuIsOpen);
}

function closeCreateMenu() {
  createMenuIsOpen = false;
  setCreateMenuOpen(false);
}

function openCreateMenuAction(type) {
  closeCreateMenu();
  if (type === 'resource') { openResourceModal(); return; }
  if (type === 'reservation') { openReservationModal(); return; }
  if (type === 'free-loan') { if (isFreeLoanPage) openFreeLoanModal(); else window.location.href = '/free-loans.html?create=1'; return; }
  if (type === 'bulk') { openBulkModal(); return; }
  openLinkModal();
}

// ── Modale sélection en masse ──────────────────────────────────────────────
let bulkEquipments = [];

async function openBulkModal() {
  document.getElementById('bulk-result').classList.add('hidden');
  document.getElementById('bulk-search').value = '';
  document.getElementById('bulk-select-all').checked = false;
  document.getElementById('bulk-selected-count').textContent = '0 sélectionné(s)';
  document.getElementById('bulk-list').innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">Chargement…</p>';
  const bm = document.getElementById('bulk-modal');
  bm.classList.remove('hidden');
  bm.classList.add('flex');
  try {
    const [equipData, resources] = await Promise.all([
      api.get('/equipment', { limit: 500 }),
      api.get('/loans/resources')
    ]);
    const linkedIds = new Set(resources.filter(r => r.equipmentId).map(r => r.equipmentId));
    const all = (equipData.data || equipData.items || []).filter(e => !linkedIds.has(e.id));
    bulkEquipments = all;
    renderBulkList(all);
  } catch (err) {
    document.getElementById('bulk-list').innerHTML = `<p class="text-sm text-red-500 py-4 text-center">${err.message}</p>`;
  }
}

function renderBulkList(items) {
  const list = document.getElementById('bulk-list');
  if (!items.length) {
    list.innerHTML = '<p class="text-sm text-slate-400 py-4 text-center">Tous les équipements ont déjà une ressource de prêt liée.</p>';
    return;
  }
  list.innerHTML = items.map(e => `
    <label class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
      <input type="checkbox" class="bulk-cb rounded" value="${e.id}" onchange="updateBulkCount()" />
      <div class="min-w-0">
        <p class="text-sm font-medium text-slate-800 truncate">${e.name}</p>
        <p class="text-xs text-slate-500">${e.type}${e.brand ? ' · ' + e.brand : ''}${e.serialNumber ? ' · ' + e.serialNumber : ''}</p>
      </div>
    </label>
  `).join('');
  updateBulkCount();
}

function filterBulkList() {
  const q = document.getElementById('bulk-search').value.toLowerCase();
  const filtered = q
    ? bulkEquipments.filter(e => (e.name + e.type + (e.brand || '') + (e.serialNumber || '')).toLowerCase().includes(q))
    : bulkEquipments;
  renderBulkList(filtered);
}

function updateBulkCount() {
  const checked = document.querySelectorAll('.bulk-cb:checked').length;
  document.getElementById('bulk-selected-count').textContent = `${checked} sélectionné(s)`;
  document.getElementById('bulk-select-all').checked = checked > 0 && checked === document.querySelectorAll('.bulk-cb').length;
}

function toggleBulkSelectAll() {
  const all = document.getElementById('bulk-select-all').checked;
  document.querySelectorAll('.bulk-cb').forEach(cb => { cb.checked = all; });
  updateBulkCount();
}

async function submitBulk() {
  const ids = [...document.querySelectorAll('.bulk-cb:checked')].map(cb => cb.value);
  if (!ids.length) { showToast('Sélectionnez au moins un équipement', 'error'); return; }
  const btn = document.getElementById('bulk-submit-btn');
  btn.disabled = true;
  try {
    const result = await api.post('/loans/resources/bulk', { equipmentIds: ids });
    const resultEl = document.getElementById('bulk-result');
    resultEl.textContent = result.message;
    resultEl.classList.remove('hidden');
    await loadResources();
    showToast(`${result.created} ressource(s) créée(s)`, 'success');
    setTimeout(() => closeBulkModal(), 1500);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function closeBulkModal() {
  const bm = document.getElementById('bulk-modal');
  bm.classList.add('hidden');
  bm.classList.remove('flex');
}

// ── Agenda ───────────────────────────────────────────────────
let calendarViewMode = 'calendar';
let calendarMonth = new Date(); // mois courant affiché
calendarMonth.setDate(1);
calendarMonth.setHours(0, 0, 0, 0);
let loansPageInitPromise = null;
let loansPageEventsBound = false;
const reservationUpdatesInFlight = new Set();
let showArchivedReservations = false;

function setCalendarView(mode) {
  calendarViewMode = mode;
  document.getElementById('calendar-view').classList.toggle('hidden', mode !== 'calendar');
  document.getElementById('calendar-list-view').classList.toggle('hidden', mode !== 'list');
  const calBtn = document.getElementById('view-calendar-btn');
  const listBtn = document.getElementById('view-list-btn');
  if (mode === 'calendar') {
    calBtn.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
    calBtn.classList.remove('text-slate-500');
    listBtn.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
    listBtn.classList.add('text-slate-500');
  } else {
    listBtn.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
    listBtn.classList.remove('text-slate-500');
    calBtn.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
    calBtn.classList.add('text-slate-500');
  }
  renderCalendar();
}

function getReservationsForDay(dayKey) {
  const dayStart = new Date(`${dayKey}T00:00:00`);
  const dayEnd = new Date(`${dayKey}T23:59:59`);
  return loanReservations.filter(item =>
    item.startAt && item.endAt && ['PENDING', 'APPROVED'].includes(item.status) &&
    new Date(item.startAt) <= dayEnd && new Date(item.endAt) >= dayStart
  );
}

function renderCalendar() {
  if (calendarViewMode === 'list') { renderCalendarList(); return; }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  document.getElementById('cal-month-label').textContent =
    calendarMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  // Premier jour de la semaine du mois (lundi=0)
  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay(); // 0=dim
  startDow = startDow === 0 ? 6 : startDow - 1; // lundi=0

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  // Cases vides avant le 1er
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  // Compléter à un multiple de 7
  while (cells.length % 7 !== 0) cells.push(null);

  const gridEl = document.getElementById('calendar-grid');
  gridEl.innerHTML = cells.map(date => {
    if (!date) return `<div class="bg-slate-50 min-h-[72px]"></div>`;
    const key = getLocalDayKey(date);
    const items = getReservationsForDay(key);
    const isToday = date.getTime() === today.getTime();
    const isPast = date < today;
    return `
      <div onclick="showDayDetail('${key}')"
        class="bg-white min-h-[72px] p-2 cursor-pointer hover:bg-blue-50 transition group ${isPast ? 'opacity-60' : ''}">
        <div class="flex justify-between items-start">
          <span class="text-xs font-medium ${isToday ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white' : 'text-slate-500 group-hover:text-slate-800'}">${date.getDate()}</span>
          ${items.length ? `<span class="text-xs font-medium text-blue-600">${items.length}</span>` : ''}
        </div>
        <div class="mt-1 space-y-0.5">
          ${items.slice(0, 2).map(item => {
            const color = item.status === 'APPROVED' ? 'bg-emerald-500' : 'bg-amber-400';
            return `<div class="truncate rounded text-white text-xs px-1 py-0.5 ${color}">${item.resource.name}</div>`;
          }).join('')}
          ${items.length > 2 ? `<div class="text-xs text-slate-400 pl-1">+${items.length - 2}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  document.getElementById('cal-day-detail').classList.add('hidden');
}

function showDayDetail(dayKey) {
  const items = getReservationsForDay(dayKey);
  const el = document.getElementById('cal-day-detail');
  const label = new Date(`${dayKey}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (!items.length) {
    el.innerHTML = `<p class="text-sm text-slate-400">Aucune réservation le ${label}.</p>`;
  } else {
    el.innerHTML = `
      <h4 class="text-sm font-semibold text-slate-700 capitalize">${label}</h4>
      <div class="space-y-2 mt-2">
        ${items.map(item => `
          <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex-1 min-w-0">
                <p class="font-medium text-slate-800 text-sm">${escapeHtml(item.resource.name)}</p>
                <p class="text-sm text-slate-500 mt-0.5">${escapeHtml(item.requesterName)} · ${item.requestedUnits} unité(s)</p>
                <p class="text-xs text-slate-400 mt-0.5">${formatReservationPeriod(item)}</p>
              </div>
              ${formatStatus(item.status)}
              ${item.returnedAt ? `<span class="text-xs text-slate-500">Retour validé le ${formatDateTime(item.returnedAt)} par ${escapeHtml(item.returnedByName || 'un membre de l’équipe')}</span>` : ''}
            </div>
            <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
              ${canManageReservation(item) && item.status !== 'APPROVED' ? `<button type="button" data-action="reservation-status" data-id="${item.id}" data-status="APPROVED" class="px-2 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 transition">Approuver</button>` : ''}
              ${canManageReservation(item) && item.status !== 'REJECTED' ? `<button type="button" data-action="reservation-status" data-id="${item.id}" data-status="REJECTED" class="px-2 py-1 border border-red-300 text-red-700 rounded text-xs hover:bg-red-50 transition">Refuser</button>` : ''}
              ${canApproveLoanReturn(item) ? `<button type="button" data-action="reservation-status" data-id="${item.id}" data-status="RETURNED" class="px-2 py-1 border border-slate-300 text-slate-700 rounded text-xs hover:bg-slate-100 transition">Valider le retour</button>` : ''}
              ${canManageReservation(item) && item.status !== 'CANCELLED' ? `<button type="button" data-action="reservation-status" data-id="${item.id}" data-status="CANCELLED" class="px-2 py-1 border border-slate-300 text-slate-700 rounded text-xs hover:bg-slate-100 transition">Annuler</button>` : ''}
              <button type="button" data-action="reservation-edit" data-id="${item.id}" class="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition" title="Modifier" aria-label="Modifier">
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 11l6.232-6.232a2.5 2.5 0 013.536 3.536L12.536 14.536A4 4 0 0110.05 15.65L7 16l.35-3.05A4 4 0 018.464 10.464L9 11z"/></svg>
              </button>
              <button type="button" data-action="reservation-delete" data-id="${item.id}" class="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition" title="Supprimer" aria-label="Supprimer">
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8"/></svg>
              </button>
            </div>
          </div>`).join('')}
      </div>`;
  }
  el.classList.remove('hidden');
}

function renderCalendarList() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const upcoming = loanReservations
    .filter(item => item.startAt && item.endAt && ['PENDING', 'APPROVED'].includes(item.status) && new Date(item.endAt) >= now)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  const el = document.getElementById('calendar-list-view');
  if (!upcoming.length) {
    el.innerHTML = '<p class="text-sm text-slate-400">Aucune réservation à venir.</p>';
    return;
  }

  // Grouper par date de début
  const groups = {};
  upcoming.forEach(item => {
    const key = getLocalDayKey(item.startAt);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  el.innerHTML = Object.entries(groups).map(([key, items]) => {
    const label = new Date(`${key}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return `
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-400 px-1 mb-1 capitalize">${label}</p>
        <div class="space-y-1.5">
          ${items.map(item => `
            <div class="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div class="mt-1 h-2 w-2 flex-shrink-0 rounded-full ${item.status === 'APPROVED' ? 'bg-emerald-500' : 'bg-amber-400'}"></div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium text-slate-800 text-sm">${item.resource.name}</span>
                  ${formatStatus(item.status)}
                </div>
                <p class="text-sm text-slate-500 mt-0.5">${item.requesterName}${item.requesterOrganization ? ` · ${item.requesterOrganization}` : ''} · ${item.requestedUnits} unité(s)</p>
                <p class="text-xs text-slate-400 mt-0.5">${formatReservationPeriod(item)}</p>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function isArchivedReservation(item) {
  if (['RETURNED', 'CANCELLED', 'REJECTED'].includes(item.status)) return true;
  return item.resourceId !== FREE_LOAN_RESOURCE_ID && !!item.endAt && new Date(item.endAt) < new Date();
}

function updateArchivedReservationsButton(count) {
  const button = document.getElementById('toggle-archived-reservations-btn');
  if (!count) {
    showArchivedReservations = false;
    button.classList.add('hidden');
    button.textContent = '';
    return;
  }
  button.classList.remove('hidden');
  button.textContent = showArchivedReservations
    ? `Masquer les archives (${count})`
    : `Afficher les archives (${count})`;
}

function canManageReservation(item) {
  return currentUser?.role === 'ADMIN' || (currentUser?.role === 'TECH' && item.resourceId !== FREE_LOAN_RESOURCE_ID);
}
function canApproveLoanReturn(item) {
  return ['ADMIN', 'TECH'].includes(currentUser?.role) && item.status === 'APPROVED';
}
function formatReservationPeriod(item) {
  return item.startAt && item.endAt ? formatDateTime(item.startAt) + ' → ' + formatDateTime(item.endAt) : 'Sans période définie';
}
function renderReservationCard(item, { archived = false } = {}) {
  const contractState = item.contractSignatureRequest
    ? formatContractStatus(item.contractSignatureRequest.status)
    : '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sans fiche</span>';
  const selectedSummary = Array.isArray(item.selectedEquipments) && item.selectedEquipments.length
    ? item.selectedEquipments.map(eq => `${escapeHtml(eq.name)}${eq.serialNumber ? ` <span class="font-mono text-slate-400">${escapeHtml(eq.serialNumber)}</span>` : ''}`).join(' · ')
    : 'Aucun appareil nominatif sélectionné.';
  const mobileAction = currentUser?.role === 'ADMIN' && ['PENDING', 'APPROVED'].includes(item.status) && (!item.contractSignatureRequest || ['EXPIRED', 'CANCELLED'].includes(item.contractSignatureRequest.status) || (item.contractSignatureRequest.status === 'PENDING' && item.contractSignatureRequest.verificationMethod === 'LOAN_LINK'))
    ? `<button type="button" data-action="reservation-mobile-signature" data-id="${item.id}" class="px-3 py-2 border border-blue-300 text-blue-700 rounded-lg text-xs hover:bg-blue-50 transition">Lien pour signer au doigt</button>` : '';
  const contractAction = !canManageReservation(item) ? '' : item.contractSignatureRequest?.status === 'SIGNED'
    ? `<button type="button" data-action="reservation-contract-download" data-signature-id="${item.contractSignatureRequest.id}" class="px-3 py-2 border border-emerald-300 text-emerald-700 rounded-lg text-xs hover:bg-emerald-50 transition">Télécharger la fiche</button>`
    : item.contractSignatureRequest?.status === 'PENDING'
      ? `<span class="px-3 py-2 rounded-lg bg-cyan-50 text-cyan-700 text-xs font-medium border border-cyan-200">${item.contractSignatureRequest?.verificationMethod === 'LOAN_LINK' ? 'Lien mobile prêt' : 'Fiche envoyée'}</span>`
      : `<button type="button" data-action="reservation-contract-generate" data-id="${item.id}" class="px-3 py-2 border border-cyan-300 text-cyan-700 rounded-lg text-xs hover:bg-cyan-50 transition">Générer la fiche par email</button>`;
  return `
      <article class="rounded-2xl border border-slate-200 ${archived ? 'bg-slate-100' : 'bg-slate-50'} p-4 space-y-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-semibold text-slate-800">${escapeHtml(item.resourceId === FREE_LOAN_RESOURCE_ID ? (item.selectedEquipments || []).map(eq => eq.name).join(', ') || 'Matériel prêté' : item.resource.name)}</h3>
              ${formatStatus(item.status)}
              ${archived ? '<span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Archivé</span>' : ''}
            </div>
            <p class="text-sm text-slate-500">${item.requesterName} · ${item.requesterEmail}${item.requesterOrganization ? ` · ${item.requesterOrganization}` : ''}</p>
            <p class="text-xs text-slate-400">${formatReservationPeriod(item)} · ${item.requestedUnits} unité(s) · ${item.resourceId === FREE_LOAN_RESOURCE_ID ? "Matériel non référencé" : `${item.reservedSlots} lot(s) verrouillé(s)`}</p>
          </div>
          <div class="relative z-10 flex flex-wrap items-center gap-2">
            ${canManageReservation(item) && item.status !== 'APPROVED' ? `<button type="button" data-action="reservation-status" data-id="${item.id}" data-status="APPROVED" class="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs hover:bg-emerald-700 transition">Approuver</button>` : ''}
            ${canManageReservation(item) && item.status !== 'REJECTED' ? `<button type="button" data-action="reservation-status" data-id="${item.id}" data-status="REJECTED" class="px-3 py-2 border border-red-300 text-red-700 rounded-lg text-xs hover:bg-red-50 transition">Refuser</button>` : ''}
            ${canApproveLoanReturn(item) ? `<button type="button" data-action="reservation-status" data-id="${item.id}" data-status="RETURNED" class="px-3 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs hover:bg-slate-100 transition">Valider le retour</button>` : ''}
            ${canManageReservation(item) && item.status !== 'CANCELLED' ? `<button type="button" data-action="reservation-status" data-id="${item.id}" data-status="CANCELLED" class="px-3 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs hover:bg-slate-100 transition">Annuler</button>` : ''}
            ${contractAction}
            ${mobileAction}
            <button
              type="button"
              data-action="reservation-edit"
              data-id="${item.id}"
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
              style="display:${canManageReservation(item) ? 'inline-flex' : 'none'}"
              title="Modifier la demande"
              aria-label="Modifier la demande">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 11l6.232-6.232a2.5 2.5 0 013.536 3.536L12.536 14.536A4 4 0 0110.05 15.65L7 16l.35-3.05A4 4 0 018.464 10.464L9 11z"/>
              </svg>
            </button>
            <button
              type="button"
              data-action="reservation-delete"
              data-id="${item.id}"
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition"
              style="display:${canManageReservation(item) ? 'inline-flex' : 'none'}"
              title="Supprimer la demande"
              aria-label="Supprimer la demande">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div class="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-400">Besoins complémentaires</p>
            <p class="mt-1 text-slate-600">${item.additionalNeeds || 'Aucun besoin spécifique.'}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-400">Notes</p>
            <p class="mt-1 text-slate-600">${item.notes || 'Aucune note.'}</p>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div class="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-400">Fiche de prêt</p>
              ${contractState}
            </div>
            <p class="mt-1 text-slate-600">${item.contractBody ? escapeHtml(item.contractBody) : 'Le paragraphe par défaut sera utilisé lors de la génération.'}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-400">Appareils sélectionnés</p>
            <p class="mt-1 text-slate-600">${selectedSummary}</p>
          </div>
        </div>
      </article>
    `;
}

function renderReservations() {
  const activeReservations = loanReservations.filter(item => !isArchivedReservation(item));
  const archivedReservations = loanReservations.filter(item => isArchivedReservation(item));
  updateArchivedReservationsButton(archivedReservations.length);

  if (!activeReservations.length && !archivedReservations.length) {
    document.getElementById('reservations-list').innerHTML = '<p class="text-sm text-slate-400">Aucune demande sur la période.</p>';
    return;
  }

  const sections = [];

  if (activeReservations.length) {
    sections.push(activeReservations.map(item => renderReservationCard(item)).join(''));
  } else {
    sections.push('<p class="text-sm text-slate-400">Aucune demande active ou à venir.</p>');
  }

  if (showArchivedReservations && archivedReservations.length) {
    sections.push(`
      <section class="space-y-4 border-t border-slate-200 pt-4">
        <div>
          <h3 class="text-sm font-semibold text-slate-700">Archives</h3>
          <p class="text-xs text-slate-400">Demandes terminées ou passées conservées pour consultation.</p>
        </div>
        <div class="space-y-4">
          ${archivedReservations.map(item => renderReservationCard(item, { archived: true })).join('')}
        </div>
      </section>
    `);
  }

  document.getElementById('reservations-list').innerHTML = sections.join('');
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  showToast('Lien copié', 'success');
}

async function loadResources() {
  try {
    loanResources = await api.get('/loans/resources');
    renderResources();
  } catch (err) {
    document.getElementById('resources-list').innerHTML = `<p class="col-span-2 text-sm text-red-600">Erreur lors du chargement des ressources : ${err.message}</p>`;
  }
}

async function loadMagicLinks() {
  try {
    const links = await api.get('/loans/magic-links');
    loanLinks = links.map(link => ({
      ...link,
      url: `${window.location.origin}/loan-request.html?token=${encodeURIComponent(link.token)}`
    }));
    renderMagicLinks();
  } catch (err) {
    console.error('loadMagicLinks:', err);
  }
}

async function loadReservations() {
  try {
    const start = new Date();
    start.setDate(start.getDate() - 180);
    const end = new Date();
    end.setDate(end.getDate() + 90);
    loanReservations = await api.get('/loans/reservations', { kind: isFreeLoanPage ? 'free' : 'catalogue',
      start: start.toISOString(),
      end: end.toISOString()
    });
    renderReservations();
    renderCalendar();
  } catch (err) {
    console.error('loadReservations:', err);
    document.getElementById('reservations-list').innerHTML =
      `<p class="text-sm text-red-600">Erreur lors du chargement des réservations : ${err.message}</p>`;
  }
}

async function loadCalendarFeed() {
  try {
    const feed = await api.get('/loans/calendar-feed');
    document.getElementById('calendar-feed-url').value = feed.url;
  } catch (err) {
    console.error('loadCalendarFeed:', err);
  }
}

async function toggleLink(id, nextState) {
  await api.patch(`/loans/magic-links/${id}`, { isActive: nextState });
  await loadMagicLinks();
}

async function updateReservationStatus(id, status, triggerButton = null) {
  const requestKey = `${id}:${status}`;
  if (reservationUpdatesInFlight.has(requestKey)) return;
  reservationUpdatesInFlight.add(requestKey);
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.classList.add('opacity-60', 'cursor-not-allowed');
  }
  try {
    const updated = status === 'RETURNED'
      ? await api.post(`/loans/reservations/${id}/approve-return`, {})
      : await api.patch(`/loans/reservations/${id}`, { status });
    await loadReservations();
    showToast('Réservation mise à jour', 'success');
    if (status === 'APPROVED') await offerReservationSignatures(updated);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    reservationUpdatesInFlight.delete(requestKey);
    if (triggerButton && document.body.contains(triggerButton)) {
      triggerButton.disabled = false;
      triggerButton.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

async function deleteReservation(id, triggerButton = null) {
  if (!confirm('Supprimer définitivement cette demande de prêt ?')) return;

  const requestKey = `delete:${id}`;
  if (reservationUpdatesInFlight.has(requestKey)) return;
  reservationUpdatesInFlight.add(requestKey);

  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.classList.add('opacity-60', 'cursor-not-allowed');
  }

  try {
    await api.delete(`/loans/reservations/${id}`);
    await loadReservations();
    showToast('Demande supprimée', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    reservationUpdatesInFlight.delete(requestKey);
    if (triggerButton && document.body.contains(triggerButton)) {
      triggerButton.disabled = false;
      triggerButton.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

let mobileSignatureLoanId = null;
let mobileSignatureCandidates = [];
let mobileSignatureRequestVersion = 0;
async function offerReservationSignatures(reservations) {
  if (currentUser?.role !== 'ADMIN') return;
  mobileSignatureCandidates = (Array.isArray(reservations) ? reservations : [reservations]).filter(loan => {
    if (!loan?.id || !['PENDING', 'APPROVED'].includes(loan.status)) return false;
    const signature = loan.contractSignatureRequest;
    return !signature || ['EXPIRED', 'CANCELLED'].includes(signature.status)
      || (signature.status === 'PENDING' && signature.verificationMethod === 'LOAN_LINK');
  });
  if (!mobileSignatureCandidates.length) return;
  const select = document.getElementById('signature-link-reservations');
  select.innerHTML = mobileSignatureCandidates.map(loan => `<option value="${escapeHtml(loan.id)}">${escapeHtml(loan.requesterName)} — ${escapeHtml(formatReservationPeriod(loan))}</option>`).join('');
  select.value = mobileSignatureCandidates[0].id;
  document.getElementById('signature-link-reservations-row').classList.toggle('hidden', mobileSignatureCandidates.length < 2);
  await openMobileSignatureLink(mobileSignatureCandidates[0].id, null, mobileSignatureCandidates[0]);
}
async function openSelectedSignatureLink() {
  const id = document.getElementById('signature-link-reservations').value;
  const loan = mobileSignatureCandidates.find(item => item.id === id);
  if (loan) await openMobileSignatureLink(id, null, loan);
}
function closeSignatureLinkModal() {
  const modal = document.getElementById('signature-link-modal');
  modal.classList.add('hidden'); modal.classList.remove('flex');
  document.getElementById('signature-link-url').value = '';
  document.getElementById('signature-link-qr').removeAttribute('src');
  mobileSignatureLoanId = null;
  mobileSignatureCandidates = [];
  mobileSignatureRequestVersion++;
  document.getElementById('signature-link-reservations-row').classList.add('hidden');
}
async function openMobileSignatureLink(id, button, reservation = null) {
  if (currentUser?.role !== 'ADMIN') return;
  const version = ++mobileSignatureRequestVersion;
  document.getElementById('signature-link-copy').disabled = true;
  document.getElementById('signature-link-email').disabled = true;
  document.getElementById('signature-link-url').value = '';
  document.getElementById('signature-link-qr').removeAttribute('src');
  document.getElementById('signature-link-expiry').textContent = 'Préparation du lien…';
  if (button) button.disabled = true;
  try {
    const loan = reservation || loanReservations.find(item => item.id === id);
    const result = loan?.contractSignatureRequest?.status === 'PENDING' && new Date(loan.contractSignatureRequest.expiresAt) > new Date()
      ? await api.get(`/loans/reservations/${id}/signature-link`)
      : await api.post(`/loans/reservations/${id}/contract-signature`, { mode: 'LOAN_LINK' });
    if (result.signatureRequest && loan) loan.contractSignatureRequest = { ...result.signatureRequest, verificationMethod: 'LOAN_LINK', expiresAt: result.expiresAt };
    if (version !== mobileSignatureRequestVersion) return;
    mobileSignatureLoanId = id;
    document.getElementById('signature-link-copy').disabled = false;
    document.getElementById('signature-link-url').value = result.signUrl;
    document.getElementById('signature-link-qr').src = result.qrCode;
    document.getElementById('signature-link-expiry').textContent = 'Expire le ' + formatDateTime(result.expiresAt);
    document.getElementById('signature-link-email').disabled = !loan?.requesterEmail;
    const modal = document.getElementById('signature-link-modal');
    modal.classList.remove('hidden'); modal.classList.add('flex');
    await loadReservations();
  } catch (err) { showToast(err.message, 'error'); }
  finally { if (button) button.disabled = false; }
}
async function emailMobileSignatureLink(button) {
  if (!mobileSignatureLoanId) return;
  button.disabled = true;
  try {
    await api.post(`/loans/reservations/${mobileSignatureLoanId}/signature-link/email`, {});
    showToast('Lien de signature envoyé à l’emprunteur', 'success');
  } catch (err) { showToast(err.message, 'error'); }
  finally { button.disabled = false; }
}

async function generateReservationContract(id, triggerButton = null) {
  const requestKey = `contract:${id}`;
  if (reservationUpdatesInFlight.has(requestKey)) return;
  reservationUpdatesInFlight.add(requestKey);

  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.classList.add('opacity-60', 'cursor-not-allowed');
  }

  try {
    await api.post(`/loans/reservations/${id}/contract-signature`, {});
    await loadReservations();
    showToast('Fiche de prêt envoyée en signature', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    reservationUpdatesInFlight.delete(requestKey);
    if (triggerButton && document.body.contains(triggerButton)) {
      triggerButton.disabled = false;
      triggerButton.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

function bindLoansPageEvents() {
  if (loansPageEventsBound) return;
  loansPageEventsBound = true;

  document.getElementById('cal-prev').addEventListener('click', () => {
    calendarMonth.setMonth(calendarMonth.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calendarMonth.setMonth(calendarMonth.getMonth() + 1);
    renderCalendar();
  });

  document.getElementById('dp-prev').addEventListener('click', () => {
    dpCurrentMonth.setMonth(dpCurrentMonth.getMonth() - 1);
    dpRenderCalendar();
  });
  document.getElementById('dp-next').addEventListener('click', () => {
    dpCurrentMonth.setMonth(dpCurrentMonth.getMonth() + 1);
    dpRenderCalendar();
  });
  document.getElementById('resv-resource').addEventListener('change', async e => {
    if (!document.getElementById('resv-contract-body').value.trim()) {
      document.getElementById('resv-contract-body').value = buildReservationContractDefaultText(getLoanResourceById(e.target.value));
    }
    reservationEquipmentSelection = new Set();
    renderReservationEquipmentSelector();
    dpInit();
    if (e.target.value) await dpLoadSchedule(e.target.value);
  });

  document.querySelectorAll('[data-action="calendar-view"]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      setCalendarView(button.dataset.view);
    });
  });

  function handleReservationClick(event) {
    const deleteBtn = event.target.closest('[data-action="reservation-delete"]');
    if (deleteBtn && !deleteBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      deleteReservation(deleteBtn.dataset.id, deleteBtn);
      return;
    }

    const editBtn = event.target.closest('[data-action="reservation-edit"]');
    if (editBtn && !editBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      editReservation(editBtn.dataset.id);
      return;
    }

    const mobileBtn = event.target.closest('[data-action="reservation-mobile-signature"]');
    if (mobileBtn && !mobileBtn.disabled) {
      event.preventDefault(); event.stopPropagation();
      openMobileSignatureLink(mobileBtn.dataset.id, mobileBtn);
      return;
    }
    const contractBtn = event.target.closest('[data-action="reservation-contract-generate"]');
    if (contractBtn && !contractBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      generateReservationContract(contractBtn.dataset.id, contractBtn);
      return;
    }

    const downloadBtn = event.target.closest('[data-action="reservation-contract-download"]');
    if (downloadBtn && !downloadBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      window.open(`/api/signatures/${downloadBtn.dataset.signatureId}/download`, '_blank', 'noopener');
      return;
    }

    const btn = event.target.closest('[data-action="reservation-status"]');
    if (!btn || btn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    updateReservationStatus(btn.dataset.id, btn.dataset.status, btn);
  }

  document.getElementById('reservations-list').addEventListener('click', handleReservationClick);
  document.getElementById('cal-day-detail').addEventListener('click', handleReservationClick);

  document.getElementById('refresh-reservations-btn').addEventListener('click', loadReservations);
  document.getElementById('toggle-archived-reservations-btn').addEventListener('click', () => {
    showArchivedReservations = !showArchivedReservations;
    renderReservations();
  });
  document.getElementById('refresh-calendar-btn').addEventListener('click', loadReservations);
  document.getElementById('refresh-calendar-feed-btn').addEventListener('click', loadCalendarFeed);
  document.getElementById('copy-calendar-feed-btn').addEventListener('click', () => copyText(document.getElementById('calendar-feed-url').value));
  document.getElementById('link-scope-all').addEventListener('change', updateLinkScope);
  document.getElementById('link-scope-resource').addEventListener('change', updateLinkScope);

  document.addEventListener('click', event => {
    if (!createMenuIsOpen) return;
    const menu = document.getElementById('loan-create-menu');
    const button = document.getElementById('loan-create-btn');
    if (menu.contains(event.target) || button.contains(event.target)) return;
    closeCreateMenu();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeCreateMenu();
      closeReservationModal();
      closeSignatureLinkModal();
      closeBulkModal();
    }
  });
}

document.getElementById('resource-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = document.getElementById('resource-error');
  errorEl.classList.add('hidden');

  const usesBundles = document.getElementById('resource-uses-bundles').checked;
  const totalUnits = parseInt(document.getElementById('resource-total-units').value, 10) || 1;

  let bundleSize;
  if (usesBundles) {
    bundleSize = parseInt(document.getElementById('resource-bundle-size').value, 10) || 1;
    bundleSize = Math.max(1, Math.min(totalUnits, bundleSize)); // Limiter entre 1 et totalUnits
  } else {
    bundleSize = 1;
  }

  const payload = {
    name: document.getElementById('resource-name').value.trim(),
    category: document.getElementById('resource-category').value.trim() || null,
    description: document.getElementById('resource-description').value.trim() || null,
    totalUnits: totalUnits,
    bundleSize: bundleSize,
    usesBundles: usesBundles,
    location: document.getElementById('resource-location').value.trim() || null,
    instructions: document.getElementById('resource-instructions').value.trim() || null,
    color: document.getElementById('resource-color').value.trim() || null,
    isActive: document.getElementById('resource-active').checked,
    equipments: [...eqPickerSelected].map(id => ({ id, lotNumber: eqLotMap.get(id) || 1 }))
  };
  const id = document.getElementById('resource-id').value;

  try {
    if (id) {
      await api.patch(`/loans/resources/${id}`, payload);
    } else {
      await api.post('/loans/resources', payload);
    }
    closeResourceModal();
    await loadResources();
    showToast('Ressource enregistrée', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

document.getElementById('reservation-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = document.getElementById('reservation-error');
  errorEl.classList.add('hidden');
  const reservationId = document.getElementById('resv-id').value;
  const noPeriod = document.getElementById('resv-resource').value === FREE_LOAN_RESOURCE_ID && document.getElementById('resv-no-period').checked;
  const startVal = noPeriod ? null : document.getElementById('resv-start').value;
  const endVal = noPeriod ? null : document.getElementById('resv-end').value;
  if (!noPeriod && (!startVal || !endVal)) {
    errorEl.textContent = 'Veuillez sélectionner une période complète (début et fin) dans le calendrier.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (!noPeriod && new Date(endVal) <= new Date(startVal)) {
    errorEl.textContent = 'La date de fin doit être après la date de début.';
    errorEl.classList.remove('hidden');
    return;
  }
  const recurrenceType = noPeriod ? 'none' : document.getElementById('resv-recurrence-type').value;
  const payload = {
    resourceId: document.getElementById('resv-resource').value,
    requesterName: document.getElementById('resv-name').value.trim(),
    requesterEmail: document.getElementById('resv-email').value.trim(),
    requesterPhone: document.getElementById('resv-phone').value.trim() || null,
    requesterOrganization: document.getElementById('resv-org').value.trim() || null,
    startAt: startVal,
    endAt: endVal,
    requestedUnits: parseInt(document.getElementById('resv-units').value, 10),
    status: document.getElementById('resv-status').value,
    internalNotes: document.getElementById('resv-notes').value.trim() || null,
    contractBody: document.getElementById('resv-contract-body').value.trim() || null,
    selectedEquipmentIds: [...reservationEquipmentSelection],
    ...(document.getElementById('resv-resource').value === FREE_LOAN_RESOURCE_ID ? {
      freeEquipments: [...document.querySelectorAll('[data-free-loan-item]')].map(row => ({
        name: row.querySelector('[data-free-name]').value.trim(),
        type: row.querySelector('[data-free-type]').value.trim() || null,
        serialNumber: row.querySelector('[data-free-serial]').value.trim() || null
      }))
    } : {})
  };
  try {
    if (reservationId) {
      const updated = await api.patch(`/loans/reservations/${reservationId}`, {
        ...payload,
        skipNotification: true
      });
      closeReservationModal();
      await loadReservations();
      showToast('Réservation modifiée', 'success');
      await offerReservationSignatures(updated);
      return;
    }

    const result = await api.post('/loans/reservations', {
      ...payload,
      recurrence: recurrenceType !== 'none' ? {
        type: recurrenceType,
        until: document.getElementById('resv-until').value
      } : undefined
    });
    closeReservationModal();
    await loadReservations();
    showToast(result.count > 1 ? `${result.count} réservations créées` : 'Réservation créée', 'success');
    await offerReservationSignatures(result.reservations);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

document.getElementById('link-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = document.getElementById('link-error');
  errorEl.classList.add('hidden');
  try {
    const selectedResourceId = document.getElementById('link-resource-id').value || null;
    if (document.getElementById('link-scope-resource').checked && !selectedResourceId) {
      throw new Error('Choisis une ressource pour créer un lien ciblé.');
    }

    const link = await api.post('/loans/magic-links', {
      title: document.getElementById('link-title').value.trim() || null,
      resourceId: document.getElementById('link-scope-resource').checked ? selectedResourceId : null,
      expiresAt: document.getElementById('link-expires-at').value ? new Date(document.getElementById('link-expires-at').value).toISOString() : null
    });
    closeLinkModal();
    await loadMagicLinks();
    await copyText(link.url);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

// ── Date Picker pour modale réservation ──────────────────────────────────────
let dpSchedule = { totalSlots: 1, reservations: [] };
let dpCurrentMonth = new Date();
let dpStep = 'pick-start-date';
let dpStartDate = null;
let dpEndDate = null;
let dpStartHour = null;
let dpEndHour = null;
let dpStartMinute = 0;
let dpEndMinute = 0;
let dpStartValue = '';
let dpEndValue = '';

function dpGetDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dpGetReservationsForDay(dateKey) {
  const dayStart = new Date(`${dateKey}T00:00:00`);
  const dayEnd = new Date(`${dateKey}T23:59:59`);
  return (dpSchedule.reservations || []).filter(r =>
    new Date(r.startAt) <= dayEnd && new Date(r.endAt) >= dayStart
  );
}

function dpGetUsedSlotsForHour(dateKey, hour) {
  const slotStart = new Date(`${dateKey}T${String(hour).padStart(2, '0')}:00:00`);
  const slotEnd = new Date(`${dateKey}T${String(hour).padStart(2, '0')}:59:59`);
  return (dpSchedule.reservations || [])
    .filter(r => new Date(r.startAt) < slotEnd && new Date(r.endAt) > slotStart)
    .reduce((sum, r) => sum + (r.reservedSlots || 0), 0);
}

function dpFormatControlDate(date) {
  return date
    ? date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : 'Choisir';
}

function dpFormatControlTime(hour, minute) {
  return hour !== null ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : 'Choisir';
}

function dpRefreshHiddenValues() {
  document.getElementById('resv-start').value = dpStartValue;
  document.getElementById('resv-end').value = dpEndValue;
}

function dpUpdateStepControls() {
  const activeStep = {
    startDate: dpStep === 'pick-start-date',
    startTime: ['pick-start-time', 'pick-start-min'].includes(dpStep),
    endDate: dpStep === 'pick-end-date',
    endTime: ['pick-end-time', 'pick-end-min'].includes(dpStep)
  };
  const states = [
    {
      buttonId: 'dp-start-date-btn',
      valueId: 'dp-start-date-value',
      active: activeStep.startDate,
      enabled: true,
      value: dpFormatControlDate(dpStartDate)
    },
    {
      buttonId: 'dp-start-time-btn',
      valueId: 'dp-start-time-value',
      active: activeStep.startTime,
      enabled: !!dpStartDate,
      value: dpFormatControlTime(dpStartHour, dpStartMinute)
    },
    {
      buttonId: 'dp-end-date-btn',
      valueId: 'dp-end-date-value',
      active: activeStep.endDate,
      enabled: !!dpStartDate && dpStartHour !== null,
      value: dpFormatControlDate(dpEndDate)
    },
    {
      buttonId: 'dp-end-time-btn',
      valueId: 'dp-end-time-value',
      active: activeStep.endTime,
      enabled: !!dpEndDate,
      value: dpFormatControlTime(dpEndHour, dpEndMinute)
    }
  ];

  states.forEach(({ buttonId, valueId, active, enabled, value }) => {
    const button = document.getElementById(buttonId);
    const valueEl = document.getElementById(valueId);
    if (!button || !valueEl) return;
    valueEl.textContent = value;
    button.disabled = !enabled;
    if (active) {
      button.className = 'rounded-xl border border-blue-500 bg-blue-50 px-3 py-2 text-left text-blue-900 shadow-sm transition';
    } else if (enabled) {
      button.className = 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-slate-700 transition hover:border-blue-300 hover:bg-blue-50';
    } else {
      button.className = 'rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-left text-slate-400 transition cursor-not-allowed';
    }
  });
}

function dpRenderCalendar() {
  const monthLabel = document.getElementById('dp-month-label');
  const gridEl = document.getElementById('dp-grid');
  if (!monthLabel || !gridEl) return;

  const year = dpCurrentMonth.getFullYear();
  const month = dpCurrentMonth.getMonth();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  monthLabel.textContent = dpCurrentMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const startKey = dpStartDate ? dpGetDayKey(dpStartDate) : null;
  const endKey = dpEndDate ? dpGetDayKey(dpEndDate) : null;
  const totalSlots = dpSchedule.totalSlots || 1;

  gridEl.innerHTML = cells.map(date => {
    if (!date) return `<div class="min-h-[30px]"></div>`;
    const key = dpGetDayKey(date);
    const hasReservations = dpGetReservationsForDay(key).length > 0;
    const isPast = date < today;
    const isStart = key === startKey;
    const isEnd = key === endKey;
    const inRange = startKey && endKey && key > startKey && key < endKey;

    let isFullyBooked = false;
    if (hasReservations) {
      isFullyBooked = Array.from({ length: 24 }, (_, h) => h)
        .every(h => dpGetUsedSlotsForHour(key, h) >= totalSlots);
    }

    let cls = 'min-h-[30px] flex items-center justify-center rounded-lg text-xs font-medium relative select-none transition ';
    if (isPast) cls += 'opacity-35 cursor-default text-slate-400 ';
    else if (isStart || isEnd) cls += 'bg-blue-600 text-white cursor-pointer ';
    else if (inRange) cls += 'bg-blue-100 text-blue-800 cursor-pointer ';
    else if (isFullyBooked) cls += 'bg-red-100 text-red-600 hover:bg-red-200 cursor-pointer ';
    else if (hasReservations) cls += 'bg-orange-50 text-orange-700 hover:bg-orange-100 cursor-pointer ';
    else cls += 'hover:bg-slate-200 text-slate-700 cursor-pointer ';

    const dot = hasReservations && !isStart && !isEnd
      ? `<span class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isFullyBooked ? 'bg-red-400' : 'bg-orange-400'}"></span>`
      : '';

    return `<div class="${cls}" ${isPast ? '' : `onclick="dpSelectDay('${key}')"`}>${date.getDate()}${dot}</div>`;
  }).join('');

  dpUpdateHint();
  dpUpdateStepControls();
}

function dpSelectDay(key) {
  const date = new Date(`${key}T00:00:00`);
  if (!dpStartDate || dpStep === 'pick-start-date' || dpStep === 'done') {
    dpStartDate = date;
    dpEndDate = null;
    dpStartHour = null;
    dpEndHour = null;
    dpStartMinute = 0;
    dpEndMinute = 0;
    dpStartValue = '';
    dpEndValue = '';
    dpStep = 'pick-start-time';
    dpRenderCalendar();
    dpSyncUi();
  } else if (dpStep === 'pick-end-date') {
    if (key < dpGetDayKey(dpStartDate)) {
      dpStartDate = date;
      dpEndDate = null;
      dpStartHour = null;
      dpEndHour = null;
      dpStartMinute = 0;
      dpEndMinute = 0;
      dpStartValue = '';
      dpEndValue = '';
      dpStep = 'pick-start-time';
      dpRenderCalendar();
      dpSyncUi();
    } else {
      dpEndDate = date;
      dpEndHour = null;
      dpEndMinute = 0;
      dpEndValue = '';
      dpStep = 'pick-end-time';
      dpRenderCalendar();
      dpSyncUi();
    }
  }
}

function dpBuildTimeGrid(dateKey, selectedHour, onClickFn, minHour = null) {
  const totalSlots = dpSchedule.totalSlots || 1;
  return Array.from({ length: 24 }, (_, h) => {
    const used = dpGetUsedSlotsForHour(dateKey, h);
    const isFullyBooked = used >= totalSlots;
    const isPartial = used > 0 && used < totalSlots;
    const isSelected = selectedHour === h;
    const isTooEarly = minHour !== null && h < minHour;
    const disabled = isFullyBooked || isTooEarly;
    let cls = 'rounded-lg py-1 text-xs font-mono text-center border transition ';
    if (isSelected) cls += 'bg-blue-600 text-white border-blue-700 ';
    else if (isFullyBooked) cls += 'bg-red-100 text-red-500 border-red-200 cursor-not-allowed ';
    else if (isTooEarly) cls += 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed ';
    else if (isPartial) cls += 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200 cursor-pointer ';
    else cls += 'bg-white text-slate-700 border-slate-200 hover:bg-blue-50 hover:border-blue-300 cursor-pointer ';
    return `<button type="button" class="${cls}" ${disabled ? 'disabled' : ''} onclick="${onClickFn}(${h})">${String(h).padStart(2, '0')}h</button>`;
  }).join('');
}

function dpBuildMinuteGrid(selectedMinute, onClickFn, minMinute = null) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i * 5;
    const isSelected = selectedMinute === m;
    const isTooEarly = minMinute !== null && m <= minMinute;
    const disabled = isTooEarly;
    let cls = 'rounded-lg py-1 text-xs font-mono text-center border transition ';
    if (isSelected) cls += 'bg-blue-600 text-white border-blue-700 ';
    else if (isTooEarly) cls += 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed ';
    else cls += 'bg-white text-slate-700 border-slate-200 hover:bg-blue-50 hover:border-blue-300 cursor-pointer ';
    return `<button type="button" class="${cls}" ${disabled ? 'disabled' : ''} onclick="${disabled ? '' : `${onClickFn}(${m})`}">${String(m).padStart(2, '0')}</button>`;
  }).join('');
}

function dpShowStartTimeGrid() {
  const key = dpGetDayKey(dpStartDate);
  document.getElementById('dp-start-date-label').textContent =
    dpStartDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  document.getElementById('dp-start-time-grid').innerHTML = dpBuildTimeGrid(key, dpStartHour, 'dpSelectStartHour');
  document.getElementById('dp-time-section').classList.remove('hidden');
  document.getElementById('dp-start-time-section').classList.remove('hidden');
  document.getElementById('dp-end-time-section').classList.add('hidden');
  const sm = document.getElementById('dp-start-minute-section');
  const em = document.getElementById('dp-end-minute-section');
  if (sm) sm.classList.add('hidden');
  if (em) em.classList.add('hidden');
}

function dpShowEndTimeGrid() {
  const startKey = dpGetDayKey(dpStartDate);
  const endKey = dpGetDayKey(dpEndDate);
  const minHour = startKey === endKey ? dpStartHour : null;
  document.getElementById('dp-end-date-label').textContent =
    dpEndDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  document.getElementById('dp-end-time-grid').innerHTML = dpBuildTimeGrid(endKey, dpEndHour, 'dpSelectEndHour', minHour);
  document.getElementById('dp-time-section').classList.remove('hidden');
  document.getElementById('dp-start-time-section').classList.add('hidden');
  document.getElementById('dp-end-time-section').classList.remove('hidden');
  const em = document.getElementById('dp-end-minute-section');
  if (em) em.classList.add('hidden');
}

function dpSelectStartHour(h) {
  dpStartHour = h;
  dpStartMinute = 0;
  dpStep = 'pick-start-min';
  dpStartValue = '';
  dpEndDate = null;
  dpEndHour = null;
  dpEndMinute = 0;
  dpEndValue = '';
  dpSyncUi();
}

function dpSelectStartMinute(m) {
  dpStartMinute = m;
  dpStep = 'pick-end-date';
  dpStartValue = new Date(
    dpStartDate.getFullYear(),
    dpStartDate.getMonth(),
    dpStartDate.getDate(),
    dpStartHour,
    m,
    0
  ).toISOString();
  dpEndDate = null;
  dpEndHour = null;
  dpEndMinute = 0;
  dpEndValue = '';
  dpRenderCalendar();
  dpSyncUi();
}

function dpSelectEndHour(h) {
  dpEndHour = h;
  dpEndMinute = 0;
  dpStep = 'pick-end-min';
  dpEndValue = '';
  dpSyncUi();
}

function dpSelectEndMinute(m) {
  dpEndMinute = m;
  dpStep = 'done';
  dpEndValue = new Date(
    dpEndDate.getFullYear(),
    dpEndDate.getMonth(),
    dpEndDate.getDate(),
    dpEndHour,
    m,
    0
  ).toISOString();
  dpRenderCalendar();
  dpSyncUi();
}

function dpUpdateSelection() {
  const el = document.getElementById('dp-selection-display');
  if (!el) return;
  if (dpStep === 'done' && dpStartDate && dpEndDate && dpStartHour !== null && dpEndHour !== null) {
    const fmt = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    const sh = String(dpStartHour).padStart(2, '0');
    const sm = String(dpStartMinute).padStart(2, '0');
    const eh = String(dpEndHour).padStart(2, '0');
    const em = String(dpEndMinute).padStart(2, '0');
    el.innerHTML = `<strong>Du</strong> ${fmt(dpStartDate)} à ${sh}:${sm} &nbsp;→&nbsp; <strong>au</strong> ${fmt(dpEndDate)} à ${eh}:${em}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function dpUpdateHint() {
  const el = document.getElementById('dp-hint');
  if (!el) return;
  const hints = {
    'pick-start-date': 'Cliquez sur un jour pour définir la date de début',
    'pick-start-time': 'Sélectionnez l\'heure de début',
    'pick-start-min': 'Sélectionnez les minutes de début',
    'pick-end-date': 'Sélectionnez ensuite la date de fin',
    'pick-end-time': 'Sélectionnez l\'heure de fin',
    'pick-end-min': 'Sélectionnez les minutes de fin',
    'done': 'Utilisez les quatre étapes ci-dessus pour corriger facilement la période'
  };
  el.textContent = hints[dpStep] || '';
}

function dpSyncUi() {
  const timeSection = document.getElementById('dp-time-section');
  const startSection = document.getElementById('dp-start-time-section');
  const endSection = document.getElementById('dp-end-time-section');
  const startMinuteSection = document.getElementById('dp-start-minute-section');
  const endMinuteSection = document.getElementById('dp-end-minute-section');

  if (timeSection) timeSection.classList.add('hidden');
  if (startSection) startSection.classList.add('hidden');
  if (endSection) endSection.classList.add('hidden');
  if (startMinuteSection) startMinuteSection.classList.add('hidden');
  if (endMinuteSection) endMinuteSection.classList.add('hidden');

  if (dpStartDate && ['pick-start-time', 'pick-start-min'].includes(dpStep)) {
    dpShowStartTimeGrid();
    if (dpStartHour !== null && startMinuteSection && dpStep !== 'pick-start-time') {
      document.getElementById('dp-start-minute-grid').innerHTML =
        dpBuildMinuteGrid(dpStartMinute, 'dpSelectStartMinute');
      startMinuteSection.classList.remove('hidden');
    }
  }

  if (dpEndDate && ['pick-end-time', 'pick-end-min'].includes(dpStep)) {
    dpShowEndTimeGrid();
    if (dpEndHour !== null && endMinuteSection && dpStep !== 'pick-end-time') {
      const sameDay = dpGetDayKey(dpStartDate) === dpGetDayKey(dpEndDate);
      const minMinute = sameDay && dpEndHour === dpStartHour ? dpStartMinute : null;
      document.getElementById('dp-end-minute-grid').innerHTML =
        dpBuildMinuteGrid(dpEndMinute, 'dpSelectEndMinute', minMinute);
      endMinuteSection.classList.remove('hidden');
    }
  }

  dpRefreshHiddenValues();
  dpUpdateSelection();
  dpUpdateHint();
  dpUpdateStepControls();
}

function dpEditStep(target) {
  if (target === 'start-date') {
    dpStep = 'pick-start-date';
    dpStartHour = null;
    dpStartMinute = 0;
    dpEndDate = null;
    dpEndHour = null;
    dpEndMinute = 0;
    dpStartValue = '';
    dpEndValue = '';
  } else if (target === 'start-time') {
    if (!dpStartDate) {
      dpStep = 'pick-start-date';
    } else {
      dpStep = 'pick-start-time';
      dpStartHour = null;
      dpStartMinute = 0;
      dpEndDate = null;
      dpEndHour = null;
      dpEndMinute = 0;
      dpStartValue = '';
      dpEndValue = '';
    }
  } else if (target === 'end-date') {
    if (!dpStartDate || dpStartHour === null) {
      dpEditStep(dpStartDate ? 'start-time' : 'start-date');
      return;
    }
    dpStep = 'pick-end-date';
    dpEndDate = null;
    dpEndHour = null;
    dpEndMinute = 0;
    dpEndValue = '';
  } else if (target === 'end-time') {
    if (!dpEndDate) {
      dpEditStep('end-date');
      return;
    }
    dpStep = 'pick-end-time';
    dpEndHour = null;
    dpEndMinute = 0;
    dpEndValue = '';
  }

  dpRenderCalendar();
  dpSyncUi();
}

function dpInit() {
  dpCurrentMonth = new Date(); dpCurrentMonth.setDate(1); dpCurrentMonth.setHours(0, 0, 0, 0);
  dpStep = 'pick-start-date';
  dpStartDate = null; dpEndDate = null;
  dpStartHour = null; dpEndHour = null;
  dpStartMinute = 0; dpEndMinute = 0;
  dpStartValue = ''; dpEndValue = '';
  dpSchedule = { totalSlots: 1, reservations: [] };
  dpRenderCalendar();
  dpSyncUi();
}

function dpSetFromExisting(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  dpStartDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  dpEndDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  dpStartHour = start.getHours();
  dpEndHour = end.getHours();
  dpStartMinute = Math.round(start.getMinutes() / 5) * 5 % 60;
  dpEndMinute = Math.round(end.getMinutes() / 5) * 5 % 60;
  dpStartValue = start.toISOString();
  dpEndValue = end.toISOString();
  dpCurrentMonth = new Date(dpStartDate.getFullYear(), dpStartDate.getMonth(), 1);
  dpStep = 'done';
  dpRefreshHiddenValues();
  dpSyncUi();
}

async function dpLoadSchedule(resourceId) {
  if (!resourceId || resourceId === FREE_LOAN_RESOURCE_ID) {
    dpSchedule = { totalSlots: 1, reservations: [] };
    dpRenderCalendar();
    return;
  }
  try {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setMonth(end.getMonth() + 6);
    dpSchedule = await api.get(`/loans/resources/${resourceId}/schedule`, { start: start.toISOString(), end: end.toISOString() });
  } catch (_) {
    dpSchedule = { totalSlots: 1, reservations: [] };
  }
  dpRenderCalendar();
  dpSyncUi();
}

async function initLoansPage({ forceReload = false } = {}) {
  if (loansPageInitPromise && !forceReload) return loansPageInitPromise;

  const initPromise = (async () => {
    bindLoansPageEvents();

    const user = await requireLogin();
    currentUser = user;
    if (isFreeLoanPage && !['ADMIN', 'TECH'].includes(user.role)) { window.location.replace('/loans.html'); return; }
    if (isFreeLoanPage) document.getElementById('loan-create-btn').classList.toggle('hidden', user.role !== 'ADMIN');
    document.querySelectorAll('[data-admin-only]').forEach(el => el.classList.toggle('hidden', user.role !== 'ADMIN'));
    renderNav('requests');

    if (forceReload) {
      reservationUpdatesInFlight.clear();
      closeCreateMenu();
      closeReservationModal();
      closeBulkModal();
    }

    if (!isFreeLoanPage) { await loadResources(); await loadMagicLinks(); }
    await loadReservations();
    if (!isFreeLoanPage) await loadCalendarFeed();
    if (isFreeLoanPage && user.role === 'ADMIN' && new URLSearchParams(window.location.search).get('create') === '1') {
      openFreeLoanModal();
      window.history.replaceState(null, '', window.location.pathname);
    }
  })();

  loansPageInitPromise = initPromise;

  try {
    await initPromise;
  } finally {
    if (loansPageInitPromise === initPromise) {
      loansPageInitPromise = null;
    }
  }
}

initLoansPage().catch(err => {
  console.error('initLoansPage:', err);
});

window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  initLoansPage({ forceReload: true }).catch(err => {
    console.error('initLoansPage pageshow:', err);
  });
});
