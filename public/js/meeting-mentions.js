'use strict';

// One picker per editor; request generations prevent results from an old subject/search appearing.
function attachMeetingMentions(form, { onSelect, canSelect, previewMarkup }) {
  const types = { commandes: 'orders', equipements: 'equipment', salles: 'rooms', interventions: 'interventions', projets: 'projects' };
  let generation = 0;
  let timer;
  let active = null;
  let panel;
  function close() {
    generation++; clearTimeout(timer);
    active?.input.removeAttribute('aria-expanded');
    active?.input.removeAttribute('aria-controls');
    active = null; panel?.remove(); panel = null;
  }
  function parse(input) {
    const end = input.selectionStart ?? input.value.length;
    const match = /(?:^|\s)(@([\p{L}]*)(?:[ \t]+([^\n@]*))?)$/u.exec(input.value.slice(0, end));
    if (!match) return null;
    const name = match[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return { input, start: end - match[1].length, end, name, q: (match[3] || '').trim(), type: types[name], value: input.value };
  }
  function button(text, handler) {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = text; el.onclick = handler;
    return el;
  }
  function status(text) {
    panel.replaceChildren();
    const el = document.createElement('p'); el.textContent = text; el.setAttribute('role', 'status'); panel.appendChild(el);
  }
  function show(input, page = 1) {
    close();
    const state = parse(input);
    if (!state || !form.contains(input)) return;
    active = state;
    const version = generation;
    const current = () => active === state && generation === version && input.isConnected && input.value === state.value && input.selectionStart === state.end;
    panel = document.createElement('div'); panel.className = 'meeting-mentions'; panel.id = 'meeting-mentions';
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Choisir une fiche à mentionner');
    input.setAttribute('aria-controls', panel.id); input.setAttribute('aria-expanded', 'true');
    input.closest('label').insertAdjacentElement('afterend', panel);
    if (!state.type) {
      const names = Object.keys(types).filter(name => name.startsWith(state.name));
      status(names.length ? 'Choisir une page :' : 'Page inconnue. Essayez @commandes, @equipements, @salles, @interventions ou @projets.');
      for (const name of names) panel.appendChild(button(`@${name}`, () => {
        input.focus(); input.setRangeText(`@${name} `, state.start, state.end, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }));
      return;
    }
    if (state.q.length > 100) { status('Recherche limitée à 100 caractères.'); return; }
    status('Recherche…');
    timer = setTimeout(async () => {
      try {
        const result = await api.get('/meetings/link-search', { type: state.type, q: state.q, page });
        if (!current()) return;
        status(result.data.length ? 'Choisir une fiche pour ajouter son lien :' : 'Aucun résultat accessible.');
        for (const link of result.data) {
          const el = button('', async () => {
            if (!current() || !canSelect(input)) return;
            el.disabled = true;
            try {
              // Recheck visibility when selected, including reassignment/deletion since the search.
              const fresh = await api.post('/meetings/link-preview', { url: link.preview.url });
              if (current() && canSelect(input)) onSelect(fresh, input, state);
            } catch (err) {
              if (current()) { status(err.message); panel.appendChild(button('Réessayer', () => show(input, page))); }
            } finally { el.disabled = false; }
          });
          // The existing renderer escapes every value and only uses canonical server URLs.
          const template = document.createElement('template'); template.innerHTML = previewMarkup(link);
          const content = document.createElement('span');
          content.innerHTML = template.content.firstElementChild.innerHTML;
          el.appendChild(content); el.className = 'meeting-mention-result'; panel.appendChild(el);
        }
        if (page > 1) panel.appendChild(button('← Précédents', () => { input.focus(); show(input, page - 1); }));
        if (result.hasMore) panel.appendChild(button('Suivants →', () => { input.focus(); show(input, page + 1); }));
      } catch (err) {
        if (current()) { status(err.message); panel.appendChild(button('Réessayer', () => show(input, page))); }
      }
    }, 200);
  }
  const eligible = input => input.matches('[data-field="notes"], [data-link-url]');
  form.addEventListener('input', event => { if (eligible(event.target)) show(event.target); });
  form.addEventListener('click', event => { if (eligible(event.target)) show(event.target); });
  form.addEventListener('keyup', event => {
    if (eligible(event.target) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) show(event.target);
  });
  form.addEventListener('focusin', event => {
    if (active && event.target !== active.input && !panel?.contains(event.target)) close();
  });
  form.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); const input = active.input; close(); input.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const buttons = [...panel.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    } else if (event.key === 'Enter' && event.target === active.input && !event.shiftKey) {
      event.preventDefault(); panel.querySelector('button:not(:disabled)')?.click();
    }
  });
  return close;
}
