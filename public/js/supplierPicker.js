/**
 * SupplierPicker — combobox recherche + création inline de fournisseur.
 * Dépend de : api.js (objet `api` global) et escapeHtml() global.
 *
 * Usage :
 *   const picker = new SupplierPicker('container-id');
 *   await picker.load(selectedId);   // charge la liste + pré-sélectionne
 *   picker.getValue();               // → id sélectionné (string|null)
 */
class SupplierPicker {
  constructor(containerId, { placeholder = '— Aucun —', onChange } = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.placeholder = placeholder;
    this.onChange    = onChange;
    this.suppliers   = [];
    this.selectedId  = null;
    this.selectedName = null;
    this._render();
    document.addEventListener('click', e => {
      if (!this.container.contains(e.target)) this._close();
    });
  }

  _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  _render() {
    this.container.innerHTML = `
      <div class="sp-root relative">
        <button type="button" class="sp-toggle w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
          <span class="sp-label text-slate-400">${this._esc(this.placeholder)}</span>
          <svg class="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div class="sp-dropdown hidden absolute z-30 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div class="p-2 border-b border-slate-100">
            <input class="sp-search w-full text-sm px-2.5 py-1.5 border border-slate-200 rounded-md
                          focus:outline-none focus:ring-1 focus:ring-blue-500"
                   type="text" placeholder="Rechercher…" autocomplete="off" />
          </div>
          <div class="sp-list max-h-44 overflow-y-auto"></div>
          <div class="border-t border-slate-100">
            <button type="button" class="sp-new-btn w-full text-left text-sm text-blue-600 hover:bg-blue-50
                                         px-3 py-2.5 flex items-center gap-2 transition">
              <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Nouveau fournisseur
            </button>
          </div>
          <div class="sp-new-form hidden border-t border-slate-100 p-3 space-y-2 bg-blue-50/50">
            <input class="sp-new-name w-full text-sm border border-slate-300 rounded-md px-2.5 py-1.5
                          focus:outline-none focus:ring-1 focus:ring-blue-500"
                   type="text" placeholder="Nom du fournisseur *" />
            <div class="flex gap-2">
              <button type="button" class="sp-new-save flex-1 text-sm bg-blue-600 text-white rounded-md
                                           px-3 py-1.5 hover:bg-blue-700 font-medium transition">Créer</button>
              <button type="button" class="sp-new-cancel flex-1 text-sm border border-slate-300 bg-white
                                           rounded-md px-3 py-1.5 hover:bg-slate-50 transition">Annuler</button>
            </div>
          </div>
        </div>
        <input class="sp-value" type="hidden" />
      </div>`;

    const r          = this.container.querySelector('.sp-root');
    this.toggleBtn   = r.querySelector('.sp-toggle');
    this.dropdown    = r.querySelector('.sp-dropdown');
    this.search      = r.querySelector('.sp-search');
    this.list        = r.querySelector('.sp-list');
    this.newBtn      = r.querySelector('.sp-new-btn');
    this.newForm     = r.querySelector('.sp-new-form');
    this.newName     = r.querySelector('.sp-new-name');
    this.newSave     = r.querySelector('.sp-new-save');
    this.newCancel   = r.querySelector('.sp-new-cancel');
    this.hidden      = r.querySelector('.sp-value');
    this.label       = r.querySelector('.sp-label');

    this.toggleBtn.addEventListener('click', () => this._toggle());
    this.search.addEventListener('input', () => {
      const q = this.search.value.toLowerCase();
      this._renderList(this.suppliers.filter(s => s.name.toLowerCase().includes(q)));
    });
    this.newBtn.addEventListener('click', () => {
      this.newForm.classList.remove('hidden');
      this.newName.focus();
    });
    this.newCancel.addEventListener('click', () => this._hideForm());
    this.newSave.addEventListener('click', () => this._createSupplier());
    this.newName.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this._createSupplier(); }
      if (e.key === 'Escape') this._hideForm();
    });
  }

  _toggle() {
    if (!this.dropdown.classList.contains('hidden')) { this._close(); return; }
    this.search.value = '';
    this._renderList(this.suppliers);
    this.dropdown.classList.remove('hidden');
    setTimeout(() => this.search.focus(), 30);
  }

  _close() {
    this.dropdown.classList.add('hidden');
    this._hideForm();
  }

  _hideForm() {
    this.newForm.classList.add('hidden');
    this.newName.value = '';
    this.newName.classList.remove('ring-1', 'ring-red-400', 'border-red-400');
  }

  _renderList(items) {
    const none = `<button type="button" class="sp-opt w-full text-left text-sm px-3 py-2 hover:bg-slate-50 text-slate-400" data-id="" data-name="">— Aucun —</button>`;
    const rows = items.length
      ? items.map(s => `<button type="button" class="sp-opt w-full text-left text-sm px-3 py-2 transition
          ${s.id === this.selectedId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}"
          data-id="${this._esc(s.id)}" data-name="${this._esc(s.name)}">${this._esc(s.name)}</button>`).join('')
      : '<p class="text-xs text-slate-400 px-3 py-2.5 italic">Aucun résultat</p>';

    this.list.innerHTML = none + rows;
    this.list.querySelectorAll('.sp-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        this._select(btn.dataset.id || null, btn.dataset.name || null);
        this._close();
      })
    );
  }

  _select(id, name) {
    this.selectedId   = id   || null;
    this.selectedName = name || null;
    this.hidden.value = id   || '';
    this.label.textContent = name || this.placeholder;
    this.label.classList.toggle('text-slate-400', !name);
    this.label.classList.toggle('text-slate-800', !!name);
    if (this.onChange) this.onChange(id || null, name || null);
  }

  async _createSupplier() {
    const name = this.newName.value.trim();
    if (!name) {
      this.newName.classList.add('border-red-400');
      this.newName.focus();
      return;
    }
    this.newName.classList.remove('border-red-400');
    this.newSave.disabled = true;
    this.newSave.textContent = '…';
    try {
      const s = await api.post('/suppliers', { name });
      this.suppliers.unshift(s);
      this._select(s.id, s.name);
      this._close();
    } catch (err) {
      alert('Erreur création fournisseur : ' + (err.message || 'Erreur inconnue'));
    } finally {
      this.newSave.disabled = false;
      this.newSave.textContent = 'Créer';
    }
  }

  /** Charge la liste depuis l'API et pré-sélectionne si un id est fourni. */
  async load(selectedId = null) {
    try {
      this.suppliers = await api.get('/suppliers');
    } catch { this.suppliers = []; }
    const found = selectedId ? this.suppliers.find(s => s.id === selectedId) : null;
    this._select(found?.id ?? null, found?.name ?? null);
  }

  getValue()  { return this.hidden.value || null; }
  getName()   { return this.selectedName || null; }
  reset()     { this._select(null, null); }
}
