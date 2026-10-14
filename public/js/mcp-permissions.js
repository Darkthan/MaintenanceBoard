(function (root) {
  'use strict';
  const categories = [
    { id: 'equipment', label: 'Équipements', description: 'Fiches du parc, factures, bons de livraison et interfaces réseau' },
    { id: 'equipment_bookings', label: 'Emprunts', description: 'Matériel empruntable et réservations', aliases: ['reservations'] },
    { id: 'room_visits', label: 'Carnet de passages', description: 'Contrôles des salles et observations' },
    { id: 'interventions', label: 'Interventions', description: 'Maintenance et demandes de support' },
    { id: 'todos', label: 'Tâches', description: 'Tâches et suivi des interventions' },
    { id: 'projects', label: 'Projets', description: 'Projets Kanban, colonnes et cartes' },
    { id: 'orders', label: 'Commandes', description: 'Commandes, lignes et suivi des livraisons' },
    { id: 'stock', label: 'Stock', description: 'Articles et mouvements de stock' },
    { id: 'ip_addressing', label: 'Plan IP', description: 'Réseaux, adresses et migrations IP' }
  ];
  const levels = { none: 'Aucun accès', read: 'Lecture', write: 'Lecture, écriture et modification' };
  function groups(available) {
    return categories.map(category => {
      const prefixes = [category.id, ...(category.aliases || [])];
      const read = available.filter(scope => prefixes.some(prefix => scope === prefix + ':read'));
      const write = available.filter(scope => prefixes.some(prefix => scope === prefix + ':write'));
      return { ...category, read, write };
    }).filter(group => group.read.length || group.write.length);
  }
  function scopesFor(group, level) {
    return level === 'write' ? [...group.read, ...group.write] : level === 'read' ? [...group.read] : [];
  }
  function mount(container, available, selected = []) {
    container.replaceChildren();
    for (const group of groups(available)) {
      const row = document.createElement('div');
      row.className = 'rounded-lg border border-slate-200 p-3 space-y-2';
      const label = document.createElement('label');
      const select = document.createElement('select');
      select.id = container.id + '-' + group.id;
      select.className = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
      label.htmlFor = select.id;
      label.className = 'block text-sm font-semibold text-slate-700';
      label.textContent = group.label;
      const description = document.createElement('p');
      description.className = 'text-xs text-slate-500';
      description.textContent = group.description;
      for (const level of ['none', ...(group.read.length ? ['read'] : []), ...(group.write.length ? ['write'] : [])]) {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = level === 'write' && !group.read.length ? 'Écriture et modification' : levels[level];
        select.appendChild(option);
      }
      const original = [...group.read, ...group.write].filter(scope => selected.includes(scope));
      select.value = group.write.some(scope => original.includes(scope)) ? 'write' : original.length ? 'read' : 'none';
      if (select.value === 'write' && group.read.length && !group.read.some(scope => original.includes(scope))) {
        const option = document.createElement('option');
        option.value = 'existing';
        option.textContent = 'Écriture et modification uniquement (droits existants)';
        select.appendChild(option);
        select.value = 'existing';
      }
      // Conserver exactement les droits existants tant que cette catégorie n'est pas modifiée.
      select.permissionScopes = original;
      select.addEventListener('change', () => { select.permissionScopes = select.value === 'existing' ? original : scopesFor(group, select.value); });
      row.append(label, description, select);
      container.appendChild(row);
    }
  }
  function selected(container) {
    return [...new Set([...container.querySelectorAll('select')].flatMap(select => select.permissionScopes || []))];
  }
  function summary(scopes) {
    return groups(scopes).map(group => group.label + ' : ' + (group.write.length
      ? (group.read.length ? levels.write : 'Écriture et modification') : levels.read));
  }
  const api = { categories, groups, scopesFor, mount, selected, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.McpPermissions = api;
})(typeof window === 'undefined' ? globalThis : window);
