'use strict';
/*!
 * SigPlacement — outil de définition de zone de signature par glisser-déposer
 *
 * Usage :
 *   SigPlacement.init(containerEl, { onUpdate, initialPos? })
 *   SigPlacement.getPos(containerEl)   → { x, y, w, h }  (fractions 0-1, origine haut-gauche)
 *   SigPlacement.reset(containerEl, pos?)
 *   SigPlacement.destroy(containerEl)
 */
(function (global) {
  // Position par défaut : bas-droite, environ 40 % × 15 % de la page
  const DEFAULT_POS = { x: 0.54, y: 0.78, w: 0.40, h: 0.15 };
  const MIN_W = 0.08, MIN_H = 0.05;

  const _map = new WeakMap();

  const SP = {
    DEFAULT_POS,

    /**
     * Initialise l'outil sur un conteneur DOM.
     * Le conteneur doit avoir position:relative et overflow:hidden.
     * Les enfants (canvas, img) doivent avoir pointer-events:none.
     */
    init(container, opts) {
      if (typeof container === 'string') container = document.getElementById(container);
      if (!container) return;
      SP.destroy(container);

      const pos = (opts && opts.initialPos) ? { ...opts.initialPos } : { ...DEFAULT_POS };
      const onUpdate = (opts && opts.onUpdate) || (() => {});
      const state = { pos, drawing: false, start: null, onUpdate };

      const h = {};
      h.mousedown  = e => _down(e, container, state);
      h.mousemove  = e => _move(e, container, state);
      h.mouseup    = e => _up(e, container, state);
      h.mouseleave = e => _up(e, container, state);
      h.touchstart = e => { e.preventDefault(); _down(e.touches[0], container, state); };
      h.touchmove  = e => { e.preventDefault(); _move(e.touches[0], container, state); };
      h.touchend   = e => { e.preventDefault(); _up(e.changedTouches[0], container, state); };
      state.h = h;

      for (const [evt, fn] of Object.entries(h)) {
        container.addEventListener(evt, fn, evt.startsWith('touch') ? { passive: false } : {});
      }

      _map.set(container, state);
      _render(container, state);
      onUpdate({ ...pos });
    },

    getPos(container) {
      if (typeof container === 'string') container = document.getElementById(container);
      const s = _map.get(container);
      return s ? { ...s.pos } : { ...DEFAULT_POS };
    },

    reset(container, pos) {
      if (typeof container === 'string') container = document.getElementById(container);
      const s = _map.get(container);
      if (!s) return;
      s.pos = pos ? { ...pos } : { ...DEFAULT_POS };
      _render(container, s);
      s.onUpdate({ ...s.pos });
    },

    destroy(container) {
      if (typeof container === 'string') container = document.getElementById(container);
      const s = _map.get(container);
      if (!s) return;
      for (const [evt, fn] of Object.entries(s.h || {})) container.removeEventListener(evt, fn);
      container.querySelector('.sp-zone')?.remove();
      _map.delete(container);
    },
  };

  // ── Interaction ─────────────────────────────────────────────────────────────

  function _rel(e, el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height)),
    };
  }

  function _down(e, el, s) {
    const p = _rel(e, el);
    s.drawing = true;
    s.start = p;
    s.pos = { x: p.x, y: p.y, w: 0.001, h: 0.001 };
    _render(el, s, true);
  }

  function _move(e, el, s) {
    if (!s.drawing) return;
    const p = _rel(e, el);
    s.pos = {
      x: Math.min(s.start.x, p.x),
      y: Math.min(s.start.y, p.y),
      w: Math.abs(p.x - s.start.x),
      h: Math.abs(p.y - s.start.y),
    };
    _render(el, s, true);
  }

  function _up(e, el, s) {
    if (!s.drawing) return;
    s.drawing = false;
    // Taille minimale
    if (s.pos.w < MIN_W || s.pos.h < MIN_H) {
      s.pos.w = Math.max(s.pos.w, MIN_W);
      s.pos.h = Math.max(s.pos.h, MIN_H);
      s.pos.x = Math.min(s.pos.x, 1 - s.pos.w);
      s.pos.y = Math.min(s.pos.y, 1 - s.pos.h);
    }
    _render(el, s, false);
    s.onUpdate({ ...s.pos });
  }

  // ── Rendu ────────────────────────────────────────────────────────────────────

  function _render(el, s, drawing) {
    let zone = el.querySelector('.sp-zone');
    if (!zone) {
      zone = document.createElement('div');
      zone.className = 'sp-zone';
      zone.style.cssText = [
        'position:absolute', 'box-sizing:border-box', 'pointer-events:none',
        'border-radius:3px', 'transition:border-color .1s',
      ].join(';');
      el.appendChild(zone);
    }

    const { x, y, w, h } = s.pos;
    zone.style.left   = `${x * 100}%`;
    zone.style.top    = `${y * 100}%`;
    zone.style.width  = `${w * 100}%`;
    zone.style.height = `${h * 100}%`;
    zone.style.border    = drawing ? '2px dashed rgba(99,102,241,.45)' : '2px dashed #4f46e5';
    zone.style.background = drawing ? 'rgba(99,102,241,.04)' : 'rgba(79,70,229,.07)';

    if (!drawing && w >= MIN_W && h >= MIN_H) {
      // Aperçu du contenu de la zone de signature
      const fsPx = Math.max(7, Math.min(10, h * 130)); // approximation adaptée à l'aperçu
      zone.innerHTML = `
        <div style="position:absolute;inset:3px 4px;display:flex;flex-direction:column;overflow:hidden;gap:1px;">
          <div style="flex:1;min-height:0;display:flex;align-items:center;padding:0 2px;">
            <span style="font-size:${fsPx * .9}px;color:#4f46e5;font-style:italic;opacity:.55;white-space:nowrap;overflow:hidden;">&#x270D; Signature</span>
          </div>
          <div style="height:1px;background:rgba(79,70,229,.35);flex-shrink:0;"></div>
          <div style="flex-shrink:0;padding:1px 2px;line-height:1.35;">
            <span style="font-size:${fsPx * .75}px;color:#4f46e5;opacity:.45;display:block;white-space:nowrap;overflow:hidden;">Nom · Qualité · Date</span>
            <span style="font-size:${fsPx * .65}px;color:#4f46e5;opacity:.32;display:block;white-space:nowrap;overflow:hidden;font-family:monospace;">SIG-XXXX-XXXXXXXX</span>
          </div>
        </div>`;
    } else {
      zone.innerHTML = '';
    }
  }

  global.SigPlacement = SP;
})(window);
