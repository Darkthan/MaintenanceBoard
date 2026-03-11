/**
 * Layout commun : navigation, déconnexion, sidebar mobile
 */

function ensureResponsiveStyles() {
  if (document.getElementById('app-responsive-style')) return;

  const style = document.createElement('style');
  style.id = 'app-responsive-style';
  style.textContent = `
    @media (max-width: 767px) {
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
      }

      body.app-mobile-refined main > header[data-app-header] [data-mobile-header-actions] > * {
        flex: 1 1 calc(50% - 0.25rem);
        min-width: 0;
        justify-content: center;
      }

      body.app-mobile-refined main > header[data-app-header] [data-mobile-header-actions][data-single-action] > * {
        flex-basis: 100%;
      }

      body.app-mobile-refined main > .flex-1 {
        padding: 1rem;
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
        max-height: calc(100vh - 1rem) !important;
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
  ensureResponsiveStyles();
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
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('nav-overlay');
  if (!sidebar) return;
  const isOpen = !sidebar.classList.contains('-translate-x-full');
  sidebar.classList.toggle('-translate-x-full', isOpen);
  if (overlay) overlay.classList.toggle('hidden', isOpen);
}

function renderNav(activePage) {
  enhanceResponsiveLayout();

  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) return;

  const navItems = [
    { href: '/index.html', label: 'Tableau de bord', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', id: 'dashboard' },
    { href: '/rooms.html', label: 'Salles', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4', id: 'rooms' },
    { href: '/equipment.html', label: 'Équipements', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2', id: 'equipment' },
    { href: '/interventions.html', label: 'Interventions', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', id: 'interventions' },
    { href: '/orders.html', label: 'Commandes', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', id: 'orders' },
    ...(user.role === 'ADMIN' ? [
      { href: '/agents.html', label: 'Agents', icon: 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18', id: 'agents' },
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
    </a>
  `).join('');

  // Afficher nom, rôle et avatar
  const nameEl   = document.getElementById('user-name');
  const roleEl   = document.getElementById('user-role');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl)   nameEl.textContent   = user.name;
  if (roleEl)   roleEl.textContent   = user.role;
  if (avatarEl) avatarEl.textContent = user.name ? user.name[0].toUpperCase() : '?';

  // Bouton déconnexion
  document.getElementById('logout-btn')?.addEventListener('click', logout);

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
}

/**
 * Toast notifications
 */
function showToast(message, type = 'success') {
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
    warning: 'bg-yellow-600'
  };

  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 z-[100] px-5 py-3 rounded-xl text-white shadow-lg text-sm font-medium
                     transform translate-y-2 opacity-0 transition-all duration-300 ${colors[type] || colors.info}`;
  toast.textContent = message;
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
        <div class="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
          </svg>
        </div>
        <div>
          <p class="text-white font-bold text-sm">MaintenanceBoard</p>
          <p class="text-slate-400 text-xs">Parc informatique</p>
        </div>
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
