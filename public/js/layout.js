/**
 * Layout commun : navigation, déconnexion, breadcrumb
 */

function renderNav(activePage) {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) return;

  const navItems = [
    { href: '/index.html', label: 'Tableau de bord', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', id: 'dashboard' },
    { href: '/rooms.html', label: 'Salles', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4', id: 'rooms' },
    { href: '/equipment.html', label: 'Équipements', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2', id: 'equipment' },
    { href: '/interventions.html', label: 'Interventions', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', id: 'interventions' },
    { href: '/orders.html', label: 'Commandes', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', id: 'orders' },
    ...(user.role === 'ADMIN' ? [{ href: '/agents.html', label: 'Agents', icon: 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18', id: 'agents' }] : []),
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

  // Afficher nom et rôle
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.role;

  // Bouton déconnexion
  document.getElementById('logout-btn')?.addEventListener('click', logout);
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
  toast.className = `fixed bottom-4 right-4 z-50 px-5 py-3 rounded-xl text-white shadow-lg text-sm font-medium
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
    // Équipements
    ACTIVE: 'bg-green-100 text-green-800',
    INACTIVE: 'bg-slate-100 text-slate-600',
    REPAIR: 'bg-yellow-100 text-yellow-800',
    DECOMMISSIONED: 'bg-red-100 text-red-700',
    // Interventions
    OPEN: 'bg-blue-100 text-blue-800',
    IN_PROGRESS: 'bg-orange-100 text-orange-800',
    RESOLVED: 'bg-green-100 text-green-800',
    CLOSED: 'bg-slate-100 text-slate-600',
    // Commandes
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
    <aside class="w-64 bg-slate-800 flex flex-col fixed inset-y-0 left-0 z-30">
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
    <main class="flex-1 ml-64 flex flex-col min-h-screen">
      <header class="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <h1 class="text-xl font-semibold text-slate-800">${title}</h1>
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </header>
      <div class="flex-1 p-6" id="page-content">
  `;
}
