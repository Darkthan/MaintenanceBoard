/**
 * Layout commun : navigation, déconnexion, sidebar mobile
 */

const APP_LOGO_SRC = '/assets/app-logo.svg';
const EQUIPMENT_ICON_PATH = 'M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm2.5 4h3m-3 3h3';

function ensureAppFavicon() {
  let favicon = document.querySelector('link[data-app-favicon]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = 'image/svg+xml';
    favicon.dataset.appFavicon = 'true';
    document.head.appendChild(favicon);
  }

  favicon.href = APP_LOGO_SRC;
}

function getSidebarBrandInnerMarkup() {
  return `
    <img src="${APP_LOGO_SRC}" alt="MaintenanceBoard" class="w-10 h-10 rounded-2xl shadow-lg shadow-blue-950/30 ring-1 ring-white/10 flex-shrink-0" />
    <div class="min-w-0">
      <p class="text-white font-bold text-sm tracking-tight">MaintenanceBoard</p>
      <p class="text-slate-400 text-xs">Parc informatique</p>
    </div>
  `;
}

function syncAppBrand() {
  document.querySelectorAll('aside#sidebar > div:first-child').forEach(brandEl => {
    brandEl.className = 'flex items-center gap-3 px-5 py-5 border-b border-slate-700';
    brandEl.innerHTML = getSidebarBrandInnerMarkup();
  });
}

function ensureResponsiveStyles() {
  if (document.getElementById('app-responsive-style')) return;

  const style = document.createElement('style');
  style.id = 'app-responsive-style';
  style.textContent = `
    @media (max-width: 767px) {
      body.app-mobile-refined {
        --mobile-content-clearance: calc(env(safe-area-inset-bottom, 0px) + 7.75rem);
        --mobile-fab-clearance: calc(env(safe-area-inset-bottom, 0px) + 6.55rem);
        --mobile-toast-clearance: calc(env(safe-area-inset-bottom, 0px) + 6.35rem);
      }

      body.app-mobile-refined main > header[data-app-header] {
        padding: 0.875rem 1rem;
        align-items: flex-start;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      body.app-mobile-refined main > header[data-app-header] h1 {
        font-size: 1.125rem;
        line-height: 1.4;
      }

      body.app-mobile-refined main > header[data-app-header] [data-mobile-header-actions] {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        order: 3;
      }

      body.app-mobile-refined main > header[data-app-header] [data-mobile-header-actions] > * {
        flex: 1 1 calc(50% - 0.25rem);
        min-width: 0;
        justify-content: center;
      }

      body.app-mobile-refined main > header[data-app-header] [data-spotlight-center-slot] {
        width: 100%;
        order: 2;
      }

      body.app-mobile-refined main > header[data-app-header] [data-spotlight-center-slot] .spotlight-trigger {
        width: 100%;
        min-width: 0;
      }

      body.app-mobile-refined main > header[data-app-header] [data-mobile-header-actions][data-single-action] > * {
        flex-basis: 100%;
      }

      body.app-mobile-refined main > .flex-1 {
        padding: 1rem;
        padding-bottom: calc(var(--mobile-content-clearance) + 0.5rem);
      }

      body.app-mobile-refined #sidebar {
        display: none !important;
      }

      body.app-mobile-refined button[onclick*="toggleSidebar"] {
        display: none !important;
      }

      body.app-mobile-refined #mobile-tabbar-shell {
        display: block !important;
      }

      body.app-mobile-refined .fixed.right-6.bottom-6,
      body.app-mobile-refined .fixed.bottom-6.right-6,
      body.app-mobile-refined [data-mobile-fab="true"] {
        bottom: var(--mobile-fab-clearance) !important;
      }

      body.app-mobile-refined .fixed.bottom-4.right-4,
      body.app-mobile-refined [data-mobile-toast-anchor="true"] {
        bottom: var(--mobile-toast-clearance) !important;
      }

      body.app-mobile-refined [data-mobile-filters] {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.75rem;
      }

      body.app-mobile-refined [data-mobile-filters] > * {
        min-width: 0 !important;
        width: 100%;
      }

      body.app-mobile-refined [data-mobile-filters] input,
      body.app-mobile-refined [data-mobile-filters] select,
      body.app-mobile-refined [data-mobile-filters] button {
        width: 100%;
      }

      body.app-mobile-refined [data-mobile-pagination] {
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
      }

      body.app-mobile-refined [data-mobile-pagination] > * {
        width: 100%;
      }

      body.app-mobile-refined [data-mobile-pagination] > div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }

      body.app-mobile-refined [data-mobile-table-wrap] {
        overflow: visible;
      }

      body.app-mobile-refined table[data-mobile-table],
      body.app-mobile-refined table[data-mobile-table] tbody,
      body.app-mobile-refined table[data-mobile-table] tr,
      body.app-mobile-refined table[data-mobile-table] td {
        display: block;
        width: 100%;
      }

      body.app-mobile-refined table[data-mobile-table] thead {
        display: none;
      }

      body.app-mobile-refined table[data-mobile-table] tbody {
        padding: 0.75rem;
      }

      body.app-mobile-refined table[data-mobile-table] tr {
        border: 1px solid rgb(226 232 240);
        border-radius: 0.9rem;
        padding: 0.85rem 1rem;
        background: white;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }

      body.app-mobile-refined table[data-mobile-table] tr + tr {
        margin-top: 0.75rem;
      }

      body.app-mobile-refined table[data-mobile-table] td {
        border: 0 !important;
        padding: 0.35rem 0 !important;
        text-align: left !important;
      }

      body.app-mobile-refined table[data-mobile-table] td[data-label] {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }

      body.app-mobile-refined table[data-mobile-table] td[data-label]::before {
        content: attr(data-label);
        flex: 0 0 42%;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: rgb(100 116 139);
      }

      body.app-mobile-refined table[data-mobile-table] td[data-label=""]::before {
        display: none;
      }

      body.app-mobile-refined table[data-mobile-table] td[data-label=""] {
        justify-content: flex-end;
      }

      body.app-mobile-refined table[data-mobile-table] td[data-label=""] > * {
        margin-left: auto;
      }

      body.app-mobile-refined [data-mobile-modal-panel] {
        width: 100% !important;
        border-radius: 1rem !important;
      }

      body.app-mobile-refined [data-mobile-modal-panel] .px-6,
      body.app-mobile-refined [data-mobile-modal-panel] .p-6 {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }

      body.app-mobile-refined [data-mobile-modal-panel] .py-4 {
        padding-top: 0.875rem !important;
        padding-bottom: 0.875rem !important;
      }

      body.app-mobile-refined [data-mobile-modal-footer] {
        flex-direction: column-reverse !important;
        align-items: stretch !important;
        gap: 0.75rem;
      }

      body.app-mobile-refined [data-mobile-modal-footer] > * {
        width: 100%;
      }

      body.app-mobile-refined [data-mobile-modal-footer] > div {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.5rem;
      }

      body.app-mobile-refined [data-mobile-tabbar] {
        overflow-x: auto;
        scrollbar-width: none;
      }

      body.app-mobile-refined [data-mobile-tabbar]::-webkit-scrollbar {
        display: none;
      }
    }
  `;

  document.head.appendChild(style);
}

function syncResponsiveTable(table) {
  const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
  if (!headers.length) return;

  table.dataset.mobileTable = 'true';
  table.closest('div')?.setAttribute('data-mobile-table-wrap', 'true');

  table.querySelectorAll('tbody tr').forEach(row => {
    Array.from(row.children).forEach((cell, index) => {
      if (cell.tagName !== 'TD') return;
      cell.dataset.label = headers[index] || '';
    });
  });
}

function enhanceResponsiveTables() {
  document.querySelectorAll('table').forEach(table => {
    if (!table.querySelector('thead')) return;
    syncResponsiveTable(table);

    const tbody = table.tBodies[0];
    if (!tbody || tbody.dataset.mobileObserved === 'true') return;

    const observer = new MutationObserver(() => syncResponsiveTable(table));
    observer.observe(tbody, { childList: true, subtree: true });
    tbody.dataset.mobileObserved = 'true';
  });
}

function enhanceResponsiveLayout() {
  ensureAppFavicon();
  ensureResponsiveStyles();
  syncAppBrand();
  document.body.classList.add('app-mobile-refined');

  document.querySelectorAll('main > header').forEach(header => {
    header.dataset.appHeader = 'true';
    const actionEl = header.lastElementChild;
    if (!actionEl || actionEl === header.firstElementChild) return;

    const isActionContainer = /^(DIV|BUTTON|A)$/.test(actionEl.tagName)
      && (actionEl.tagName !== 'DIV' || actionEl.querySelector('button, a'));

    if (!isActionContainer) return;

    if (actionEl.tagName === 'DIV') {
      actionEl.dataset.mobileHeaderActions = 'true';
      if (actionEl.children.length <= 1) actionEl.dataset.singleAction = 'true';
      return;
    }

    if (actionEl.dataset.mobileHeaderWrapped === 'true') return;
    const wrapper = document.createElement('div');
    wrapper.dataset.mobileHeaderActions = 'true';
    wrapper.dataset.singleAction = 'true';
    actionEl.parentNode.insertBefore(wrapper, actionEl);
    wrapper.appendChild(actionEl);
    actionEl.dataset.mobileHeaderWrapped = 'true';
  });

  document.querySelectorAll('#pagination').forEach(el => {
    el.dataset.mobilePagination = 'true';
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.parentElement?.setAttribute('data-mobile-tabbar', 'true');
  });

  document.querySelectorAll('div[id$="-modal"], #modal-detail').forEach(modal => {
    const panel = modal.firstElementChild?.classList?.contains('absolute')
      ? modal.lastElementChild
      : modal.firstElementChild;
    if (!panel) return;

    panel.setAttribute('data-mobile-modal-panel', 'true');

    const footer = Array.from(panel.querySelectorAll('div')).find(el =>
      el.className.includes('border-t') && (el.className.includes('justify-end') || el.className.includes('justify-between'))
    );

    if (footer) footer.setAttribute('data-mobile-modal-footer', 'true');
  });

  enhanceResponsiveTables();
}

function toggleSidebar() {
  if (window.matchMedia?.('(max-width: 767px)')?.matches) return;
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('nav-overlay');
  if (!sidebar) return;
  const isOpen = !sidebar.classList.contains('-translate-x-full');
  sidebar.classList.toggle('-translate-x-full', isOpen);
  if (overlay) overlay.classList.toggle('hidden', isOpen);
}

const spotlightState = {
  open: false,
  query: '',
  results: [],
  activeIndex: -1,
  loading: false,
  debounceId: null,
  controller: null
};

function ensureSpotlightStyles() {
  if (document.getElementById('app-spotlight-style')) return;

  const style = document.createElement('style');
  style.id = 'app-spotlight-style';
  style.textContent = `
    body.spotlight-open {
      overflow: hidden;
    }

    .spotlight-trigger {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      min-width: min(32rem, 52vw);
      padding: 0.7rem 0.9rem;
      border-radius: 1rem;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background:
        linear-gradient(135deg, rgba(255,255,255,0.96), rgba(241,245,249,0.92)),
        radial-gradient(circle at top left, rgba(14,165,233,0.12), transparent 40%);
      color: #0f172a;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
      transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    }

    .spotlight-trigger:hover {
      transform: translateY(-1px);
      box-shadow: 0 22px 50px rgba(15, 23, 42, 0.12);
      border-color: rgba(14, 165, 233, 0.35);
    }

    .spotlight-trigger__icon {
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(14,165,233,0.16), rgba(251,191,36,0.16));
      color: #0369a1;
      flex-shrink: 0;
    }

    .spotlight-trigger__text {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
      min-width: 0;
      flex: 1;
    }

    .spotlight-trigger__label {
      font-size: 0.86rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #0f172a;
    }

    .spotlight-trigger__hint {
      font-size: 0.73rem;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .spotlight-trigger__kbd {
      font-size: 0.74rem;
      font-weight: 700;
      color: #334155;
      padding: 0.32rem 0.55rem;
      border-radius: 0.75rem;
      background: rgba(255,255,255,0.8);
      border: 1px solid rgba(148, 163, 184, 0.25);
      box-shadow: inset 0 -1px 0 rgba(148, 163, 184, 0.18);
      flex-shrink: 0;
    }

    .spotlight-overlay {
      position: fixed;
      inset: 0;
      z-index: 120;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 3.5rem 1rem 1rem;
    }

    .spotlight-overlay.hidden {
      display: none;
    }

    .spotlight-backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at top, rgba(56, 189, 248, 0.18), transparent 34%),
        linear-gradient(180deg, rgba(15,23,42,0.68), rgba(15,23,42,0.82));
      backdrop-filter: blur(18px);
    }

    .spotlight-panel {
      position: relative;
      width: min(1080px, 100%);
      min-height: min(620px, calc(100vh - 5rem));
      max-height: min(740px, calc(100vh - 4.5rem));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 1.75rem;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background:
        linear-gradient(145deg, rgba(255,255,255,0.98), rgba(248,250,252,0.95)),
        radial-gradient(circle at top right, rgba(251,191,36,0.16), transparent 34%);
      box-shadow: 0 40px 110px rgba(15, 23, 42, 0.38);
    }

    .spotlight-topbar {
      padding: 1.15rem 1.25rem 1rem;
      border-bottom: 1px solid rgba(226, 232, 240, 0.85);
      background: linear-gradient(180deg, rgba(255,255,255,0.9), rgba(248,250,252,0.84));
    }

    .spotlight-topbar__row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .spotlight-searchbar {
      display: flex;
      align-items: center;
      gap: 0.9rem;
      padding: 0.95rem 1rem;
      border-radius: 1.25rem;
      border: 1px solid rgba(148, 163, 184, 0.2);
      background: rgba(255,255,255,0.82);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.65);
    }

    .spotlight-searchbar svg {
      color: #0369a1;
      flex-shrink: 0;
    }

    .spotlight-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      color: #0f172a;
      font-size: 1.08rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .spotlight-input::placeholder {
      color: #94a3b8;
      font-weight: 500;
    }

    .spotlight-searchbar__meta {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: #64748b;
      font-size: 0.74rem;
      flex-shrink: 0;
    }

    .spotlight-searchbar__pill {
      padding: 0.28rem 0.55rem;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(241, 245, 249, 0.8);
      font-weight: 700;
      color: #334155;
    }

    .spotlight-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.75rem;
      height: 2.75rem;
      flex-shrink: 0;
      border-radius: 1rem;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(255,255,255,0.82);
      color: #334155;
      transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
    }

    .spotlight-close:hover {
      background: rgba(248,250,252,0.96);
      border-color: rgba(14, 165, 233, 0.26);
      color: #0f172a;
    }

    .spotlight-body {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
      min-height: 0;
      flex: 1;
    }

    .spotlight-results {
      min-height: 0;
      overflow: auto;
      padding: 1rem 1.05rem 1.15rem;
    }

    .spotlight-group + .spotlight-group {
      margin-top: 1rem;
    }

    .spotlight-group__title {
      margin-bottom: 0.55rem;
      padding: 0 0.35rem;
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #64748b;
    }

    .spotlight-result {
      width: 100%;
      display: flex;
      align-items: flex-start;
      gap: 0.85rem;
      padding: 0.9rem 0.95rem;
      border: 1px solid transparent;
      border-radius: 1.1rem;
      background: transparent;
      color: inherit;
      text-align: left;
      transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
    }

    .spotlight-result:hover,
    .spotlight-result.is-active {
      background: linear-gradient(135deg, rgba(240,249,255,0.9), rgba(255,251,235,0.86));
      border-color: rgba(125, 211, 252, 0.42);
      transform: translateY(-1px);
    }

    .spotlight-result__icon {
      width: 2.4rem;
      height: 2.4rem;
      border-radius: 0.95rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #0f172a;
      background: linear-gradient(145deg, rgba(226,232,240,0.84), rgba(255,255,255,0.96));
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.85);
    }

    .spotlight-result[data-type="action"] .spotlight-result__icon {
      background: linear-gradient(135deg, rgba(14,165,233,0.18), rgba(251,191,36,0.22));
      color: #075985;
    }

    .spotlight-result__content {
      flex: 1;
      min-width: 0;
    }

    .spotlight-result__title {
      font-size: 0.92rem;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.25;
    }

    .spotlight-result__subtitle {
      margin-top: 0.28rem;
      font-size: 0.77rem;
      color: #64748b;
      line-height: 1.35;
    }

    .spotlight-result__meta {
      margin-top: 0.45rem;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #0f766e;
    }

    .spotlight-result__chevron {
      color: #94a3b8;
      padding-top: 0.2rem;
      flex-shrink: 0;
    }

    .spotlight-empty {
      min-height: 14rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.7rem;
      text-align: center;
      color: #64748b;
      padding: 1.5rem;
    }

    .spotlight-empty__title {
      font-size: 1rem;
      font-weight: 700;
      color: #0f172a;
    }

    .spotlight-preview {
      min-height: 0;
      overflow: auto;
      border-left: 1px solid rgba(226, 232, 240, 0.85);
      background:
        radial-gradient(circle at top right, rgba(251,191,36,0.14), transparent 36%),
        linear-gradient(180deg, rgba(248,250,252,0.9), rgba(241,245,249,0.85));
      padding: 1.2rem 1.2rem 1.35rem;
    }

    .spotlight-preview__eyebrow {
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #0f766e;
    }

    .spotlight-preview__title {
      margin-top: 0.55rem;
      font-size: 1.2rem;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: #0f172a;
    }

    .spotlight-preview__description {
      margin-top: 0.65rem;
      font-size: 0.88rem;
      line-height: 1.55;
      color: #475569;
    }

    .spotlight-preview__badges {
      margin-top: 0.9rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
    }

    .spotlight-preview__badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.42rem 0.68rem;
      border-radius: 999px;
      background: rgba(255,255,255,0.82);
      border: 1px solid rgba(148,163,184,0.2);
      font-size: 0.74rem;
      font-weight: 700;
      color: #334155;
    }

    .spotlight-preview__list {
      margin-top: 1rem;
      display: grid;
      gap: 0.6rem;
    }

    .spotlight-preview__item {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      padding: 0.78rem 0.85rem;
      border-radius: 1rem;
      background: rgba(255,255,255,0.72);
      border: 1px solid rgba(226,232,240,0.7);
      color: #334155;
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .spotlight-preview__item-dot {
      width: 0.48rem;
      height: 0.48rem;
      margin-top: 0.38rem;
      border-radius: 999px;
      background: linear-gradient(135deg, #0ea5e9, #f59e0b);
      flex-shrink: 0;
    }

    .spotlight-preview__footer {
      margin-top: auto;
      padding-top: 1rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.55rem;
      color: #64748b;
      font-size: 0.74rem;
    }

    .spotlight-preview__key {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2rem;
      padding: 0.3rem 0.45rem;
      border-radius: 0.7rem;
      border: 1px solid rgba(148,163,184,0.2);
      background: rgba(255,255,255,0.78);
      color: #0f172a;
      font-weight: 700;
    }

    .spotlight-spinner {
      width: 1rem;
      height: 1rem;
      border: 2px solid rgba(148, 163, 184, 0.35);
      border-top-color: #0284c7;
      border-radius: 999px;
      animation: spotlight-spin 0.75s linear infinite;
      display: none;
    }

    .spotlight-spinner.is-visible {
      display: inline-flex;
    }

    @keyframes spotlight-spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 900px) {
      .spotlight-trigger {
        min-width: 0;
        width: 100%;
      }

      .spotlight-body {
        grid-template-columns: 1fr;
      }

      .spotlight-preview {
        border-left: none;
        border-top: 1px solid rgba(226, 232, 240, 0.85);
      }
    }

    @media (max-width: 767px) {
      .spotlight-overlay {
        padding: 0.5rem;
      }

      .spotlight-panel {
        min-height: calc(100vh - 1rem);
        max-height: calc(100vh - 1rem);
        border-radius: 1.35rem;
      }

      .spotlight-trigger__hint,
      .spotlight-trigger__kbd {
        display: none;
      }

      .spotlight-trigger__label {
        font-size: 0.82rem;
      }

      .spotlight-topbar {
        padding: 0.9rem;
      }

      .spotlight-topbar__row {
        align-items: stretch;
      }

      .spotlight-close {
        width: 3rem;
        height: 3rem;
      }
    }

    @media (min-width: 768px) {
      main > header[data-app-header] {
        display: grid !important;
        grid-template-columns: minmax(0, max-content) minmax(14rem, 34rem) minmax(0, max-content);
        align-items: center;
        gap: 1rem;
      }

      main > header[data-app-header] [data-spotlight-center-slot] {
        grid-column: 2;
        justify-self: center;
        width: 100%;
      }

      main > header[data-app-header] [data-spotlight-center-slot] .spotlight-trigger {
        width: 100%;
        min-width: 0;
      }

      main > header[data-app-header] [data-mobile-header-actions] {
        grid-column: 3;
        justify-self: end;
      }
    }
  `;

  document.head.appendChild(style);
}

function ensureSpotlightMarkup() {
  if (document.getElementById('spotlight-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'spotlight-overlay';
  overlay.className = 'spotlight-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="spotlight-backdrop" data-spotlight-close="true"></div>
    <section class="spotlight-panel" role="dialog" aria-modal="true" aria-labelledby="spotlight-input">
      <div class="spotlight-topbar">
        <div class="spotlight-topbar__row">
          <div class="spotlight-searchbar">
            <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/>
            </svg>
            <input id="spotlight-input" class="spotlight-input" type="search" autocomplete="off" spellcheck="false"
              placeholder="Rechercher une salle, un equipement, un agent, un fournisseur, un document, un fichier ou un reglage..." />
            <div class="spotlight-searchbar__meta">
              <span id="spotlight-spinner" class="spotlight-spinner" aria-hidden="true"></span>
              <span class="spotlight-searchbar__pill">Esc</span>
            </div>
          </div>
          <button type="button" class="spotlight-close" data-spotlight-close="true" aria-label="Fermer la recherche globale" title="Fermer">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="spotlight-body">
        <div id="spotlight-results" class="spotlight-results"></div>
        <aside id="spotlight-preview" class="spotlight-preview"></aside>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', event => {
    if (event.target.dataset.spotlightClose === 'true') {
      closeSpotlight();
    }
  });

  overlay.querySelector('.spotlight-panel').addEventListener('click', event => {
    event.stopPropagation();
  });

  overlay.querySelector('#spotlight-input').addEventListener('input', event => {
    spotlightState.query = event.target.value.trim();
    queueSpotlightSearch();
  });
}

function getSpotlightElements() {
  return {
    overlay: document.getElementById('spotlight-overlay'),
    input: document.getElementById('spotlight-input'),
    results: document.getElementById('spotlight-results'),
    preview: document.getElementById('spotlight-preview'),
    spinner: document.getElementById('spotlight-spinner')
  };
}

function getShortcutLabel() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Cmd K' : 'Ctrl K';
}

function getSpotlightIcon(type) {
  const icons = {
    action: 'M12 6v12m6-6H6',
    document: 'M9 3h6l5 5v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 1.5V9h4.5',
    room: 'M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5',
    equipment: EQUIPMENT_ICON_PATH,
    intervention: 'M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    message: 'M3 8l7.89 4.945a2 2 0 0 0 2.22 0L21 8m-16 8h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2z',
    loan: 'M8 7V5a4 4 0 1 1 8 0v2m-8 0h8m-8 0a2 2 0 0 0-2 2v8a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9a2 2 0 0 0-2-2m-8 0v2m8-2v2',
    order: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
    supplier: 'M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Zm0 0V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2M9 13h6m-3-3v6',
    stock: 'M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-9 4H8m0 3h3m5-3h-3m3 3h-3'
  };
  return icons[type] || icons.action;
}

function getSpotlightMetaLabel(result) {
  if (result.target === '_blank') return 'Ouverture nouvel onglet';
  if (result.type === 'action' || result.openMode === 'direct') return 'Ouverture directe';
  return 'Apercu disponible';
}

function ensureSpotlightTrigger() {
  ensureSpotlightStyles();
  ensureSpotlightMarkup();

  const header = document.querySelector('main > header[data-app-header]');
  if (!header) return;

  let actions = header.querySelector('[data-mobile-header-actions]');
  if (!actions) {
    const currentRight = header.lastElementChild && header.lastElementChild !== header.firstElementChild
      ? header.lastElementChild
      : null;

    actions = document.createElement('div');
    actions.className = 'flex items-center gap-2';
    actions.dataset.mobileHeaderActions = 'true';

    if (currentRight) {
      header.replaceChild(actions, currentRight);
      actions.appendChild(currentRight);
    } else {
      header.appendChild(actions);
    }
  }

  let centerSlot = header.querySelector('[data-spotlight-center-slot]');
  if (!centerSlot) {
    centerSlot = document.createElement('div');
    centerSlot.dataset.spotlightCenterSlot = 'true';
    centerSlot.className = 'flex items-center justify-center';
    header.insertBefore(centerSlot, actions || null);
  }

  let trigger = header.querySelector('[data-spotlight-trigger="true"]');
  if (!trigger) {
    trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'spotlight-trigger';
    trigger.dataset.spotlightTrigger = 'true';
    trigger.innerHTML = `
      <span class="spotlight-trigger__icon" aria-hidden="true">
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/>
        </svg>
      </span>
      <span class="spotlight-trigger__text">
        <span class="spotlight-trigger__label">Recherche globale</span>
        <span class="spotlight-trigger__hint">Donnees, fichiers, parametres, documents, actions</span>
      </span>
      <span class="spotlight-trigger__kbd">${getShortcutLabel()}</span>
    `;
    trigger.addEventListener('click', () => openSpotlight());
  }

  if (trigger.parentElement !== centerSlot) {
    centerSlot.appendChild(trigger);
  }

  if (actions.children.length <= 1) actions.dataset.singleAction = 'true';
  else delete actions.dataset.singleAction;
}

function groupSpotlightResults(results) {
  const groups = [];
  const seen = new Map();

  results.forEach(result => {
    if (!seen.has(result.group)) {
      const group = { name: result.group, items: [] };
      seen.set(result.group, group);
      groups.push(group);
    }
    seen.get(result.group).items.push(result);
  });

  return groups;
}

function setSpotlightLoading(isLoading) {
  spotlightState.loading = isLoading;
  const { spinner } = getSpotlightElements();
  if (spinner) spinner.classList.toggle('is-visible', isLoading);
}

function getActiveSpotlightResult() {
  if (spotlightState.activeIndex < 0) return null;
  return spotlightState.results[spotlightState.activeIndex] || null;
}

function renderSpotlightPreview() {
  const { preview } = getSpotlightElements();
  if (!preview) return;

  const active = getActiveSpotlightResult();

  if (!active) {
    preview.innerHTML = `
      <div class="spotlight-preview__eyebrow">Spotlight</div>
      <div class="spotlight-preview__title">Recherche transversale</div>
      <p class="spotlight-preview__description">
        Tape pour filtrer les donnees, fichiers, reglages et actions rapides. Les fleches changent la selection, Entree ouvre la cible.
      </p>
      <div class="spotlight-preview__list">
        <div class="spotlight-preview__item"><span class="spotlight-preview__item-dot"></span><span>Commence par une salle, une commande, un fournisseur, un utilisateur, un fichier ou un mot-cle de configuration.</span></div>
        <div class="spotlight-preview__item"><span class="spotlight-preview__item-dot"></span><span>Les actions rapides ouvrent directement les onglets de parametres, exports et pages utiles.</span></div>
        <div class="spotlight-preview__item"><span class="spotlight-preview__item-dot"></span><span>Le bouton fermer permet de quitter le menu aussi sur mobile.</span></div>
      </div>
      <div class="spotlight-preview__footer">
        <span class="spotlight-preview__key">${getShortcutLabel()}</span><span>ouvrir</span>
        <span class="spotlight-preview__key">Esc</span><span>fermer</span>
      </div>
    `;
    return;
  }

  const lines = Array.isArray(active.preview?.lines) ? active.preview.lines : [];
  const badges = Array.isArray(active.preview?.badges) ? active.preview.badges : [];

  preview.innerHTML = `
    <div class="spotlight-preview__eyebrow">${active.group}</div>
    <div class="spotlight-preview__title">${escapeSpotlightHtml(active.preview?.title || active.title)}</div>
    <p class="spotlight-preview__description">${escapeSpotlightHtml(active.preview?.description || active.subtitle || '')}</p>
    ${badges.length ? `
      <div class="spotlight-preview__badges">
        ${badges.map(badge => `<span class="spotlight-preview__badge">${escapeSpotlightHtml(badge)}</span>`).join('')}
      </div>` : ''}
    ${lines.length ? `
      <div class="spotlight-preview__list">
        ${lines.map(line => `
          <div class="spotlight-preview__item">
            <span class="spotlight-preview__item-dot"></span>
            <span>${escapeSpotlightHtml(line)}</span>
          </div>`).join('')}
      </div>` : ''}
    <div class="spotlight-preview__footer">
      <span class="spotlight-preview__key">Enter</span><span>${active.target === '_blank' ? 'ouvrir le document' : active.type === 'action' || active.openMode === 'direct' ? 'ouvrir maintenant' : 'ouvrir la page cible'}</span>
      <span class="spotlight-preview__key">Esc</span><span>fermer</span>
    </div>
  `;
}

function renderSpotlightResults() {
  const { results } = getSpotlightElements();
  if (!results) return;

  if (spotlightState.loading && !spotlightState.results.length) {
    results.innerHTML = `
      <div class="spotlight-empty">
        <div class="spotlight-empty__title">Recherche en cours...</div>
        <p>Le spotlight agrege les donnees de l application.</p>
      </div>
    `;
    renderSpotlightPreview();
    return;
  }

  if (!spotlightState.results.length) {
    results.innerHTML = `
      <div class="spotlight-empty">
        <div class="spotlight-empty__title">Aucun resultat</div>
        <p>Essaie un nom de salle, un utilisateur, un fournisseur, un fichier export, un reglage ou une action rapide.</p>
      </div>
    `;
    renderSpotlightPreview();
    return;
  }

  const grouped = groupSpotlightResults(spotlightState.results);
  let offset = 0;

  results.innerHTML = grouped.map(group => {
    const sectionHtml = `
      <section class="spotlight-group">
        <div class="spotlight-group__title">${escapeSpotlightHtml(group.name)}</div>
        <div class="spotlight-group__items">
          ${group.items.map((item, index) => {
            const realIndex = offset + index;
            const isActive = realIndex === spotlightState.activeIndex;
            return `
              <button type="button" class="spotlight-result ${isActive ? 'is-active' : ''}" data-index="${realIndex}" data-type="${escapeSpotlightHtml(item.type)}">
                <span class="spotlight-result__icon" aria-hidden="true">
                  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${getSpotlightIcon(item.type)}"/>
                  </svg>
                </span>
                <span class="spotlight-result__content">
                  <span class="spotlight-result__title">${escapeSpotlightHtml(item.title)}</span>
                  <span class="spotlight-result__subtitle">${escapeSpotlightHtml(item.subtitle || '')}</span>
                  <span class="spotlight-result__meta">${escapeSpotlightHtml(getSpotlightMetaLabel(item))}</span>
                </span>
                <span class="spotlight-result__chevron" aria-hidden="true">
                  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 6 6 6-6 6"/>
                  </svg>
                </span>
              </button>
            `;
          }).join('')}
        </div>
      </section>
    `;
    offset += group.items.length;
    return sectionHtml;
  }).join('');

  results.querySelectorAll('.spotlight-result').forEach(button => {
    button.addEventListener('mouseenter', () => {
      const nextIndex = Number(button.dataset.index);
      if (nextIndex === spotlightState.activeIndex) return;
      spotlightState.activeIndex = nextIndex;
      renderSpotlightResults();
    });
    button.addEventListener('click', () => {
      spotlightState.activeIndex = Number(button.dataset.index);
      renderSpotlightResults();
      activateSpotlightResult();
    });
  });

  renderSpotlightPreview();
  syncSpotlightActiveItemIntoView();
}

function syncSpotlightActiveItemIntoView() {
  const { results } = getSpotlightElements();
  if (!results) return;
  const activeButton = results.querySelector(`.spotlight-result[data-index="${spotlightState.activeIndex}"]`);
  activeButton?.scrollIntoView({ block: 'nearest' });
}

function escapeSpotlightHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function performSpotlightSearch() {
  const query = spotlightState.query;
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('limit', '6');

  if (spotlightState.controller) spotlightState.controller.abort();
  spotlightState.controller = new AbortController();

  setSpotlightLoading(true);

  try {
    const data = await apiFetch(`/search?${params.toString()}`, { signal: spotlightState.controller.signal });
    spotlightState.results = Array.isArray(data.results) ? data.results : [];
    spotlightState.activeIndex = spotlightState.results.length ? 0 : -1;
  } catch (err) {
    const aborted = err?.name === 'AbortError' || /abort/i.test(err?.message || '');
    if (!aborted) {
      spotlightState.results = [];
      spotlightState.activeIndex = -1;
    }
  } finally {
    spotlightState.controller = null;
    setSpotlightLoading(false);
    renderSpotlightResults();
  }
}

function queueSpotlightSearch() {
  clearTimeout(spotlightState.debounceId);
  spotlightState.debounceId = setTimeout(() => {
    performSpotlightSearch();
  }, 140);
}

function openSpotlight() {
  ensureSpotlightTrigger();
  const { overlay, input } = getSpotlightElements();
  if (!overlay || !input) return;

  spotlightState.open = true;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('spotlight-open');
  input.value = spotlightState.query;
  input.focus();
  input.select();

  if (!spotlightState.results.length) {
    spotlightState.query = '';
    input.value = '';
    performSpotlightSearch();
  } else {
    renderSpotlightResults();
  }
}

function closeSpotlight() {
  const { overlay, input } = getSpotlightElements();
  if (!overlay || !input) return;

  spotlightState.open = false;
  if (spotlightState.controller) spotlightState.controller.abort();
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('spotlight-open');
  input.blur();
}

function activateSpotlightResult() {
  const active = getActiveSpotlightResult();
  if (!active) return;
  closeSpotlight();
  if (active.target === '_blank') {
    window.open(active.href, '_blank', 'noopener');
    return;
  }
  window.location.href = active.href;
}

function handleSpotlightKeyboard(event) {
  const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
  if (isShortcut) {
    event.preventDefault();
    if (spotlightState.open) closeSpotlight();
    else openSpotlight();
    return;
  }

  if (!spotlightState.open) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeSpotlight();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!spotlightState.results.length) return;
    spotlightState.activeIndex = (spotlightState.activeIndex + 1 + spotlightState.results.length) % spotlightState.results.length;
    renderSpotlightResults();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!spotlightState.results.length) return;
    spotlightState.activeIndex = spotlightState.activeIndex <= 0
      ? spotlightState.results.length - 1
      : spotlightState.activeIndex - 1;
    renderSpotlightResults();
    return;
  }

  if (event.key === 'Enter') {
    const activeEl = document.activeElement;
    if (activeEl?.id === 'spotlight-input') {
      event.preventDefault();
      activateSpotlightResult();
    }
  }
}

function initSpotlight() {
  if (window.__spotlightInitialized) {
    ensureSpotlightTrigger();
    return;
  }

  window.__spotlightInitialized = true;
  ensureSpotlightTrigger();
  document.addEventListener('keydown', handleSpotlightKeyboard);
}

const accountSettingsState = {
  initialized: false,
  currentProfile: null
};

function splitAccountName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (!value) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = value.split(' ');
  return { firstName, lastName: rest.join(' ') };
}

function syncStoredUser(user) {
  if (!user) return;
  _currentUser = user;
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl) nameEl.textContent = user.name || 'Utilisateur';
  if (roleEl) roleEl.textContent = user.role || '';
  if (avatarEl) avatarEl.textContent = user.name ? user.name[0].toUpperCase() : '?';
}

function ensureAccountSettingsModal() {
  if (document.getElementById('account-settings-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'account-settings-modal';
  modal.className = 'hidden fixed inset-0 z-[130] overflow-y-auto';
  modal.innerHTML = `
    <div id="account-settings-backdrop" class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"></div>
    <div class="relative z-10 flex min-h-full items-center justify-center p-4">
      <div class="w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-2xl" data-mobile-modal-panel="true">
        <div class="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Utilisateur</p>
            <h2 class="text-xl font-semibold text-slate-900">Paramètres du compte</h2>
            <p class="mt-1 text-sm text-slate-500">Mettez à jour vos informations et vos accès.</p>
          </div>
          <button type="button" id="account-settings-close" class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-900">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 6 12 12M18 6 6 18"/>
            </svg>
          </button>
        </div>
        <div class="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <form id="account-profile-form" class="space-y-5 border-b border-slate-200 px-6 py-6 lg:border-b-0 lg:border-r">
            <div>
              <h3 class="text-sm font-semibold text-slate-900">Informations</h3>
              <p class="mt-1 text-sm text-slate-500">Le prénom et le nom affichés dans l’application sont mis à jour immédiatement.</p>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block text-sm">
                <span class="mb-1.5 block font-medium text-slate-700">Prénom</span>
                <input id="account-first-name" type="text" required maxlength="60" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200" />
              </label>
              <label class="block text-sm">
                <span class="mb-1.5 block font-medium text-slate-700">Nom</span>
                <input id="account-last-name" type="text" required maxlength="60" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200" />
              </label>
            </div>
            <label class="block text-sm">
              <span class="mb-1.5 block font-medium text-slate-700">Email de connexion</span>
              <input id="account-login-email" type="email" disabled class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-500 outline-none" />
            </label>
            <label class="block text-sm">
              <span class="mb-1.5 block font-medium text-slate-700">Email de contact</span>
              <input id="account-contact-email" type="email" maxlength="200" placeholder="notifications@etablissement.fr" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200" />
              <span class="mt-1.5 block text-xs text-slate-400">Utilisé pour les notifications, sans changer votre identifiant de connexion.</span>
            </label>
            <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-4" data-mobile-modal-footer="true">
              <p id="account-profile-feedback" class="text-sm text-slate-500"></p>
              <button type="submit" id="account-profile-submit" class="inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700">Enregistrer</button>
            </div>
          </form>
          <div class="flex flex-col divide-y divide-slate-200 overflow-y-auto">
            <form id="account-password-form" class="space-y-5 px-6 py-6">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">Sécurité</h3>
                <p class="mt-1 text-sm text-slate-500">Changez votre mot de passe sans quitter la page.</p>
              </div>
              <label class="block text-sm">
                <span class="mb-1.5 block font-medium text-slate-700">Mot de passe actuel</span>
                <input id="account-current-password" type="password" autocomplete="current-password" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200" />
              </label>
              <label class="block text-sm">
                <span class="mb-1.5 block font-medium text-slate-700">Nouveau mot de passe</span>
                <input id="account-new-password" type="password" autocomplete="new-password" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200" />
              </label>
              <label class="block text-sm">
                <span class="mb-1.5 block font-medium text-slate-700">Confirmer le nouveau mot de passe</span>
                <input id="account-confirm-password" type="password" autocomplete="new-password" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200" />
              </label>
              <p class="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">Le mot de passe doit contenir au moins 8 caractères avec une majuscule, une minuscule et un chiffre.</p>
              <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-4" data-mobile-modal-footer="true">
                <p id="account-password-feedback" class="text-sm text-slate-500"></p>
                <button type="submit" id="account-password-submit" class="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700">Changer le mot de passe</button>
              </div>
            </form>

            <!-- Passkeys -->
            <div class="border-t border-slate-200 px-6 py-6 space-y-4">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="text-sm font-semibold text-slate-900">Passkeys enregistrées</h3>
                  <p class="text-xs text-slate-500 mt-0.5">Empreinte, Face ID ou clé matérielle.</p>
                </div>
                <button type="button" id="account-add-passkey-btn"
                  class="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                  Ajouter
                </button>
              </div>
              <ul id="account-passkeys-list" class="space-y-2 text-sm text-slate-500 italic">
                <li>Chargement...</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function fillAccountSettingsForm(profile) {
  const parts = splitAccountName(profile?.name);
  document.getElementById('account-first-name').value = profile?.firstName || parts.firstName || '';
  document.getElementById('account-last-name').value = profile?.lastName || parts.lastName || '';
  document.getElementById('account-login-email').value = profile?.email || '';
  document.getElementById('account-contact-email').value = profile?.contactEmail || '';
  document.getElementById('account-profile-feedback').textContent = '';
  document.getElementById('account-password-feedback').textContent = '';
  renderPasskeyList(profile?.passkeys || []);
}

function renderPasskeyList(passkeys) {
  const list = document.getElementById('account-passkeys-list');
  if (!list) return;
  if (!passkeys.length) {
    list.innerHTML = '<li class="text-slate-400">Aucune passkey enregistrée.</li>';
    return;
  }
  list.innerHTML = passkeys.map(pk => `
    <li class="flex items-center justify-between gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 not-italic">
      <div class="flex items-center gap-2 min-w-0">
        <svg class="w-4 h-4 text-sky-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
        <div class="min-w-0">
          <p class="font-medium text-slate-800 text-sm truncate">${escapeHtml(pk.name)}</p>
          <p class="text-xs text-slate-400">${pk.lastUsedAt ? 'Utilisée le ' + new Date(pk.lastUsedAt).toLocaleDateString('fr-FR') : 'Jamais utilisée'}</p>
        </div>
      </div>
      <button type="button" onclick="deletePasskey('${pk.id}')"
        class="flex-shrink-0 text-slate-400 hover:text-red-500 transition p-1 rounded-lg hover:bg-red-50">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </li>
  `).join('');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function deletePasskey(passkeyId) {
  if (!confirm('Supprimer cette passkey ?')) return;
  try {
    await api.delete(`/auth/passkeys/${passkeyId}`);
    const profile = await api.get('/auth/me');
    renderPasskeyList(profile.passkeys || []);
    showToast('Passkey supprimée', 'success');
  } catch (err) {
    showToast(err.message || 'Erreur lors de la suppression', 'error');
  }
}

async function ensureWebAuthnClientLoaded() {
  if (window.WebAuthnClient) return window.WebAuthnClient;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/js/webauthn-client.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Impossible de charger le module WebAuthn'));
    document.head.appendChild(script);
  });
  return window.WebAuthnClient;
}


function closeAccountSettings() {
  const modal = document.getElementById('account-settings-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

async function openAccountSettings() {
  ensureAccountSettingsModal();
  const modal = document.getElementById('account-settings-modal');
  const feedback = document.getElementById('account-profile-feedback');
  const profileSubmit = document.getElementById('account-profile-submit');

  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  feedback.textContent = 'Chargement du profil...';
  profileSubmit.disabled = true;

  try {
    const profile = await api.get('/auth/me');
    accountSettingsState.currentProfile = profile;
    fillAccountSettingsForm(profile);
  } catch (err) {
    feedback.textContent = err.message || 'Impossible de charger le profil.';
    feedback.className = 'text-sm text-red-600';
    return;
  } finally {
    profileSubmit.disabled = false;
  }

  feedback.className = 'text-sm text-slate-500';
  document.getElementById('account-first-name').focus();
}

function initAccountSettings() {
  if (accountSettingsState.initialized) return;
  accountSettingsState.initialized = true;
  ensureAccountSettingsModal();

  document.getElementById('account-settings-close')?.addEventListener('click', closeAccountSettings);
  document.getElementById('account-settings-backdrop')?.addEventListener('click', closeAccountSettings);

  document.getElementById('account-profile-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = document.getElementById('account-profile-feedback');
    const submit = document.getElementById('account-profile-submit');

    feedback.className = 'text-sm text-slate-500';
    feedback.textContent = 'Enregistrement...';
    submit.disabled = true;

    try {
      const payload = {
        firstName: document.getElementById('account-first-name').value.trim(),
        lastName: document.getElementById('account-last-name').value.trim(),
        contactEmail: document.getElementById('account-contact-email').value.trim() || null
      };

      const updated = await api.patch('/auth/me', payload);
      accountSettingsState.currentProfile = updated;

      syncStoredUser({
        ...(_currentUser || {}),
        id: updated.id,
        email: updated.email,
        contactEmail: updated.contactEmail,
        name: updated.name,
        role: updated.role,
        isActive: updated.isActive
      });

      fillAccountSettingsForm(updated);
      feedback.className = 'text-sm text-emerald-600';
      feedback.textContent = 'Profil mis à jour.';
      showToast('Profil mis à jour', 'success');
    } catch (err) {
      feedback.className = 'text-sm text-red-600';
      feedback.textContent = err.message || 'Impossible d’enregistrer le profil.';
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('account-password-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = document.getElementById('account-password-feedback');
    const submit = document.getElementById('account-password-submit');
    const currentPassword = document.getElementById('account-current-password').value;
    const newPassword = document.getElementById('account-new-password').value;
    const confirmPassword = document.getElementById('account-confirm-password').value;

    if (newPassword !== confirmPassword) {
      feedback.className = 'text-sm text-red-600';
      feedback.textContent = 'La confirmation ne correspond pas au nouveau mot de passe.';
      return;
    }

    feedback.className = 'text-sm text-slate-500';
    feedback.textContent = 'Mise à jour du mot de passe...';
    submit.disabled = true;

    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      document.getElementById('account-current-password').value = '';
      document.getElementById('account-new-password').value = '';
      document.getElementById('account-confirm-password').value = '';
      feedback.className = 'text-sm text-emerald-600';
      feedback.textContent = 'Mot de passe mis à jour.';
      showToast('Mot de passe mis à jour', 'success');
    } catch (err) {
      feedback.className = 'text-sm text-red-600';
      feedback.textContent = err.message || 'Impossible de changer le mot de passe.';
    } finally {
      submit.disabled = false;
    }
  });

  // Ajouter une passkey
  document.getElementById('account-add-passkey-btn')?.addEventListener('click', async () => {
    const addBtn = document.getElementById('account-add-passkey-btn');

    const name = window.prompt('Nom de la passkey (ex : MacBook Touch ID, iPhone Face ID)');
    if (name === null) return;

    addBtn.disabled = true;
    addBtn.textContent = '...';

    try {
      const webauthn = await ensureWebAuthnClientLoaded();
      if (!webauthn?.supportsWebAuthn?.()) {
        throw new Error('WebAuthn non supporté par ce navigateur');
      }
      const options = await api.post('/auth/webauthn/register/begin', {});
      if (!options?.challenge || !options?.user?.id || !options?.rp?.id) {
        throw new Error('Configuration WebAuthn invalide ou incomplète');
      }
      let attResp;
      try {
        attResp = await webauthn.startRegistration(options);
      } catch (err) {
        if (err.name === 'InvalidStateError') throw new Error('Un authenticateur identique est déjà enregistré');
        if (err.name === 'NotAllowedError') throw new Error('Enregistrement annulé');
        throw err;
      }

      attResp.name = name.trim() || 'Ma passkey';
      await api.post('/auth/webauthn/register/finish', attResp);
      const updated = await api.get('/auth/me');
      renderPasskeyList(updated.passkeys || []);
      showToast('Passkey enregistrée avec succès', 'success');
    } catch (err) {
      console.error('[Passkey registration]', err);
      showToast(err.message || 'Échec de l\'enregistrement', 'error');
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = 'Passkey';
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('account-settings-modal')?.classList.contains('hidden')) {
      closeAccountSettings();
    }
  });
}

let _navUnreadCount = 0;
let _navBadgeInterval = null;

async function refreshNavBadge() {
  try {
    const data = await api.get('/messages/unread-count');
    const newCount = (data && data.total) ? data.total : 0;
    if (newCount !== _navUnreadCount) {
      _navUnreadCount = newCount;
      document.querySelectorAll('[data-nav-messages-badge]').forEach(el => {
        el.textContent = newCount > 99 ? '99+' : newCount;
        el.classList.toggle('hidden', newCount === 0);
      });
      document.querySelectorAll('[data-mobile-messages-badge]').forEach(el => {
        el.classList.toggle('hidden', newCount === 0);
      });
    }
  } catch (_err) {
    // silencieux (ex: déconnexion)
  }
}

function renderNav(activePage) {
  enhanceResponsiveLayout();
  initAccountSettings();

  const user = _currentUser;
  if (!user) return;

  const navItems = [
    { href: '/index.html', label: 'Accueil', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', id: 'dashboard' },
    { href: '/rooms.html', label: 'Salles', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4', id: 'rooms' },
    { href: '/equipment.html', label: 'Équipements', icon: EQUIPMENT_ICON_PATH, id: 'equipment' },
    { href: '/interventions.html', label: 'Interventions', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', id: 'interventions' },
    { href: '/messages.html', label: 'Messagerie', icon: 'M3 8l7.89 4.945a2 2 0 002.22 0L21 8m-16 8h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2z', id: 'messages' },
    { href: '/knowledge-base.html', label: 'Documentation', icon: 'M12 6.253v13m0-13C10.832 5.483 9.246 5 7.5 5C4.462 5 2 6.462 2 8.265v11C2 17.462 4.462 16 7.5 16c1.746 0 3.332.483 4.5 1.253m0-11C13.168 5.483 14.754 5 16.5 5 19.538 5 22 6.462 22 8.265v11C22 17.462 19.538 16 16.5 16c-1.746 0-3.332.483-4.5 1.253', id: 'knowledge-base' },
    { href: '/loans.html', label: 'Prêt de matériel', icon: 'M8 7V5a4 4 0 118 0v2m-8 0h8m-8 0a2 2 0 00-2 2v8a3 3 0 003 3h6a3 3 0 003-3V9a2 2 0 00-2-2m-8 0v2m8-2v2', id: 'loans' },
    { href: '/orders.html', label: 'Commandes', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', id: 'orders' },
    { href: '/signatures.html', label: 'Signatures', icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z', id: 'signatures' },
    ...(user.role === 'ADMIN' ? [
      { href: '/stock.html', label: 'Stock', icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4', id: 'stock' },
      { href: '/suppliers.html', label: 'Fournisseurs', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', id: 'suppliers' },
      { href: '/settings.html', label: 'Paramètres', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z', id: 'settings' }
    ] : []),
  ];

  const navEl = document.getElementById('main-nav');
  if (!navEl) return;

  navEl.innerHTML = navItems.map(item => `
    <a href="${item.href}"
       class="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition
              ${activePage === item.id
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white'}">
      <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}" />
      </svg>
      <span>${item.label}</span>
      ${item.id === 'messages' ? `<span data-nav-messages-badge class="ml-auto inline-flex min-w-5 justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white ${_navUnreadCount > 0 ? '' : 'hidden'}">${_navUnreadCount > 99 ? '99+' : _navUnreadCount}</span>` : ''}
    </a>
  `).join('');

  // Afficher nom, rôle et avatar
  const nameEl   = document.getElementById('user-name');
  const roleEl   = document.getElementById('user-role');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl)   nameEl.textContent   = user.name;
  if (roleEl)   roleEl.textContent   = user.role;
  if (avatarEl) avatarEl.textContent = user.name ? user.name[0].toUpperCase() : '?';

  const accountTrigger = document.getElementById('account-settings-btn')
    || avatarEl?.closest('.flex.items-center');
  if (accountTrigger && accountTrigger.dataset.accountBound !== 'true') {
    accountTrigger.dataset.accountBound = 'true';
    accountTrigger.classList.add('cursor-pointer', 'transition');
    accountTrigger.title = 'Ouvrir les paramètres du compte';
    accountTrigger.setAttribute('role', 'button');
    accountTrigger.setAttribute('tabindex', '0');
    accountTrigger.addEventListener('click', () => openAccountSettings());
    accountTrigger.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openAccountSettings();
      }
    });
  }

  // Bouton déconnexion
  document.getElementById('logout-btn')?.addEventListener('click', event => {
    event.stopPropagation();
    logout();
  });

  // Overlay mobile (injecté une seule fois)
  if (!document.getElementById('nav-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'nav-overlay';
    overlay.className = 'hidden fixed inset-0 z-30 bg-black/50 lg:hidden';
    overlay.addEventListener('click', toggleSidebar);
    document.body.appendChild(overlay);
  }

  // Fermer sidebar au clic sur un lien (mobile)
  navEl.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && window.innerWidth < 1024) {
        sidebar.classList.add('-translate-x-full');
        document.getElementById('nav-overlay')?.classList.add('hidden');
      }
    });
  });

  renderMobileTabbar(navItems, activePage);

  // Badge notifications messagerie
  refreshNavBadge();
  if (!_navBadgeInterval) {
    _navBadgeInterval = setInterval(refreshNavBadge, 30000);
  }

  initSpotlight();
}

function renderMobileTabbar(navItems, activePage) {
  const coreIds = ['dashboard', 'equipment', 'interventions', 'messages'];
  const coreTabs = coreIds
    .map(id => navItems.find(item => item.id === id))
    .filter(Boolean);
  const overflowTabs = navItems.filter(item => !coreIds.includes(item.id));
  const moreActive = !coreIds.includes(activePage);

  let shell = document.getElementById('mobile-tabbar-shell');
  if (!shell) {
    shell = document.createElement('div');
    shell.id = 'mobile-tabbar-shell';
    shell.className = 'hidden lg:hidden';
    document.body.appendChild(shell);
  }

  shell.innerHTML = `
    <div id="mobile-tabbar-overlay" class="hidden fixed inset-0 z-[35] bg-black/40"></div>
    <div class="fixed inset-x-0 bottom-0 z-[40] lg:hidden px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-2">
      <div class="rounded-[1.75rem] border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur">
        <div class="grid grid-cols-5 gap-1 px-2 py-2">
          ${coreTabs.map(item => `
            <a href="${item.href}"
              class="flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition ${
                activePage === item.id
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }">
              <div class="relative">
                <svg class="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}" />
                </svg>
                ${item.id === 'messages' ? `<span data-mobile-messages-badge class="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-white ${_navUnreadCount > 0 ? '' : 'hidden'}"></span>` : ''}
              </div>
              <span class="truncate">${item.label}</span>
            </a>
          `).join('')}
          <button id="mobile-tabbar-more-btn" type="button"
            class="flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition ${
              moreActive
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }">
            <svg class="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span class="truncate">Plus</span>
          </button>
        </div>
      </div>
    </div>
    <div id="mobile-tabbar-sheet" class="hidden fixed inset-x-0 bottom-0 z-[45] rounded-t-[2rem] bg-white px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-5 shadow-2xl shadow-slate-900/20 lg:hidden">
      <div class="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-200"></div>
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Navigation</p>
          <h3 class="text-lg font-semibold text-slate-800">Plus d’actions</h3>
        </div>
        <button id="mobile-tabbar-close-btn" type="button" class="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="mt-5 grid grid-cols-1 gap-2">
        ${overflowTabs.map(item => `
          <a href="${item.href}"
            class="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition ${
              activePage === item.id
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-50'
            }">
            <svg class="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}" />
            </svg>
            <span>${item.label}</span>
          </a>
        `).join('')}
      </div>
      <div class="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">
        <button id="mobile-tabbar-account-btn" type="button"
          class="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
          Compte
        </button>
        <button id="mobile-tabbar-logout-btn" type="button"
          class="rounded-2xl border border-red-200 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition">
          Déconnexion
        </button>
      </div>
    </div>
  `;

  const overlay = document.getElementById('mobile-tabbar-overlay');
  const sheet = document.getElementById('mobile-tabbar-sheet');
  const openSheet = () => {
    overlay?.classList.remove('hidden');
    sheet?.classList.remove('hidden');
  };
  const closeSheet = () => {
    overlay?.classList.add('hidden');
    sheet?.classList.add('hidden');
  };

  document.getElementById('mobile-tabbar-more-btn')?.addEventListener('click', openSheet);
  document.getElementById('mobile-tabbar-close-btn')?.addEventListener('click', closeSheet);
  overlay?.addEventListener('click', closeSheet);
  document.getElementById('mobile-tabbar-account-btn')?.addEventListener('click', () => {
    closeSheet();
    openAccountSettings();
  });
  document.getElementById('mobile-tabbar-logout-btn')?.addEventListener('click', () => {
    closeSheet();
    logout();
  });
  sheet?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeSheet);
  });
}

/**
 * Toast notifications
 */
async function copyToastMessageToClipboard(message) {
  const text = String(message || '').trim();
  if (!text) throw new Error('Message vide');

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.className = 'fixed -left-[9999px] -top-[9999px] opacity-0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function showToast(message, type = 'success') {
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
    warning: 'bg-yellow-600'
  };

  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 z-[200] px-5 py-3 rounded-xl text-white shadow-lg text-sm font-medium
                     transform translate-y-2 opacity-0 transition-all duration-300 ${colors[type] || colors.info}`;
  toast.textContent = message;

  if (type === 'error') {
    toast.classList.add('cursor-copy', 'select-text', 'relative', 'pr-14');
    toast.title = 'Cliquer pour copier le message d’erreur';

    const hint = document.createElement('span');
    hint.className = 'absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide text-white/80 pointer-events-none';
    hint.textContent = 'Copier';
    toast.appendChild(hint);

    toast.addEventListener('click', async () => {
      try {
        await copyToastMessageToClipboard(message);
        toast.classList.remove('bg-red-600');
        toast.classList.add('bg-emerald-600');
        toast.textContent = 'Erreur copiée dans le presse-papiers';
      } catch {
        toast.classList.add('ring-2', 'ring-white/70');
      }
    }, { once: true });
  }

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Rendu d'un badge de statut
 */
function statusBadge(status, type = 'intervention') {
  const badges = {
    ACTIVE: 'bg-green-100 text-green-800',
    INACTIVE: 'bg-slate-100 text-slate-600',
    REPAIR: 'bg-yellow-100 text-yellow-800',
    DECOMMISSIONED: 'bg-red-100 text-red-700',
    OPEN: 'bg-blue-100 text-blue-800',
    IN_PROGRESS: 'bg-orange-100 text-orange-800',
    RESOLVED: 'bg-green-100 text-green-800',
    CLOSED: 'bg-slate-100 text-slate-600',
    PENDING: 'bg-yellow-100 text-yellow-800',
    ORDERED: 'bg-blue-100 text-blue-800',
    PARTIAL: 'bg-orange-100 text-orange-800',
    RECEIVED: 'bg-green-100 text-green-800',
    CANCELLED: 'bg-red-100 text-red-700',
  };

  const labels = {
    ACTIVE: 'Actif', INACTIVE: 'Inactif', REPAIR: 'En réparation', DECOMMISSIONED: 'Déclassé',
    OPEN: 'Ouvert', IN_PROGRESS: 'En cours', RESOLVED: 'Résolu', CLOSED: 'Fermé',
    PENDING: 'En attente', ORDERED: 'Commandé', PARTIAL: 'Partiel', RECEIVED: 'Reçu', CANCELLED: 'Annulé',
    LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', CRITICAL: 'Critique'
  };

  const cls = badges[status] || 'bg-slate-100 text-slate-600';
  const label = labels[status] || status;
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}">${label}</span>`;
}

/**
 * Formater une date
 */
function formatDate(dateStr, withTime = false) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return '-';
  return withTime
    ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * Template du layout principal
 */
function getLayoutTemplate(title, activePage) {
  return `
  <div class="min-h-screen bg-slate-50 flex">
    <!-- Sidebar -->
    <aside id="sidebar" class="w-64 bg-slate-800 flex flex-col fixed inset-y-0 left-0 z-40 -translate-x-full lg:translate-x-0 transition-transform duration-300 ease-in-out">
      <div class="flex items-center gap-3 px-5 py-5 border-b border-slate-700">
        ${getSidebarBrandInnerMarkup()}
      </div>

      <nav id="main-nav" class="flex-1 p-3 space-y-1 overflow-y-auto"></nav>

      <div class="p-3 border-t border-slate-700">
        <div class="flex items-center gap-3 px-3 py-2 rounded-lg">
          <div class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold" id="user-avatar">?</div>
          <div class="flex-1 min-w-0">
            <p id="user-name" class="text-white text-sm font-medium truncate">...</p>
            <p id="user-role" class="text-slate-400 text-xs"></p>
          </div>
          <button id="logout-btn" title="Déconnexion"
            class="text-slate-400 hover:text-red-400 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main content -->
    <main class="flex-1 lg:ml-64 flex flex-col min-h-screen">
      <header class="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <div class="flex items-center gap-3">
          <button onclick="toggleSidebar()" class="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <h1 class="text-xl font-semibold text-slate-800">${title}</h1>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400 hidden sm:block">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </header>
      <div class="flex-1 p-6" id="page-content">
  `;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enhanceResponsiveLayout, { once: true });
} else {
  enhanceResponsiveLayout();
}

// ── Pull-to-refresh PWA ───────────────────────────────────────────────────────
(function () {
  if (!('ontouchstart' in window)) return; // desktop : no-op

  const THRESHOLD = 80;
  let startY = 0, pulling = false, pullDist = 0, refreshing = false;

  // Keyframe spinner
  const style = document.createElement('style');
  style.textContent = '@keyframes ptr-spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(style);

  // Barre indicateur
  const bar = document.createElement('div');
  bar.style.cssText = [
    'position:fixed;top:0;left:0;right:0;z-index:99999',
    'height:56px;display:flex;align-items:center;justify-content:center;gap:10px',
    'background:#eff6ff;border-bottom:1px solid #bfdbfe',
    'transform:translateY(-100%);transition:transform .25s ease',
    'pointer-events:none;will-change:transform',
  ].join(';');

  const spinner = document.createElement('div');
  spinner.style.cssText = 'width:20px;height:20px;border:2px solid #93c5fd;border-top-color:#2563eb;border-radius:50%';

  const label = document.createElement('span');
  label.style.cssText = 'font-size:13px;font-weight:500;color:#1d4ed8;font-family:system-ui,sans-serif';
  label.textContent = 'Tirez pour actualiser';

  bar.append(spinner, label);
  document.body.appendChild(bar);

  function show(px) {
    bar.style.transition = 'none';
    bar.style.transform = `translateY(${px - 56}px)`;
  }
  function hide() {
    bar.style.transition = 'transform .3s ease';
    bar.style.transform = 'translateY(-100%)';
  }
  function showLoading() {
    bar.style.transition = 'transform .2s ease';
    bar.style.transform = 'translateY(0)';
    spinner.style.animation = 'ptr-spin .7s linear infinite';
    label.textContent = 'Mise à jour…';
  }

  document.addEventListener('touchstart', e => {
    if (refreshing || window.scrollY > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling || refreshing) return;
    pullDist = Math.max(0, e.touches[0].clientY - startY);
    if (pullDist < 8) return;
    const progress = Math.min(pullDist / THRESHOLD, 1);
    show(Math.min(pullDist * 0.45, 56));
    spinner.style.transform = `rotate(${progress * 320}deg)`;
    label.textContent = pullDist >= THRESHOLD ? 'Relâchez pour actualiser' : 'Tirez pour actualiser';
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!pulling || refreshing) return;
    pulling = false;
    const dist = pullDist;
    pullDist = 0;
    if (dist < THRESHOLD) { hide(); return; }

    refreshing = true;
    showLoading();

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            await new Promise(r => setTimeout(r, 400));
          }
        }
      }
    } catch (_) {}

    window.location.reload();
  }, { passive: true });
})();

// ── Invalidation du cache au changement de version Docker ─────────────────────
(async function checkAppVersion() {
  try {
    const res = await fetch('/api/version');
    if (!res.ok) return;
    const { version } = await res.json();
    const stored = localStorage.getItem('app_build_id');
    if (stored && stored !== version) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('app_build_id', version);
      window.location.reload();
      return;
    }
    localStorage.setItem('app_build_id', version);
  } catch {
    // Ne pas bloquer l'app en cas d'erreur réseau
  }
})();
