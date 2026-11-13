const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'layout.js'), 'utf8');
const css = source.match(/style\.textContent = `([\s\S]*?)`;/)?.[1];
if (!css) throw new Error('Responsive CSS not found');

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: sans-serif; }
  main > .flex-1 { padding: 16px; }
  .spacer { height: 1000px; }
  #pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  #pagination > div { display: flex; gap: 8px; }
  #pagination button { padding: 8px 12px; }
  .fixed.right-6.bottom-6 { position: fixed; right: 24px; bottom: 24px; width: 56px; height: 56px; border-radius: 100%; }
  #mobile-tabbar-shell { display: none; }
  #mobile-tabbar-bar { height: 86px; background: #e2e8f0; }
  #mobile-tabbar-sheet, #mobile-tabbar-overlay { display: none; }
  ${css}
</style></head><body class="app-mobile-refined app-has-pagination-fab"><main><div class="flex-1"><div class="spacer"></div>
<div id="pagination" data-mobile-pagination="true" data-pagination-fab-clearance="true"><span>Affichage de 21 à 40 sur 300 équipements</span><div><button id="previous">Précédent</button><span>2 / 15</span><button id="next">Suivant</button></div></div>
</div></main><button id="fab" class="fixed right-6 bottom-6" data-mobile-fab="true">+</button>
<div id="mobile-tabbar-shell"><div id="mobile-tabbar-overlay"></div><div id="mobile-tabbar-bar">Navigation</div><div id="mobile-tabbar-sheet"></div></div>
<pre id="result"></pre><script>
  window.addEventListener('load', () => { window.scrollTo(0, document.documentElement.scrollHeight); setTimeout(() => {
    const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; };
    const overlap = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const next = rect('next'), previous = rect('previous'), fab = rect('fab'), bar = rect('mobile-tabbar-bar');
    const result = { width:innerWidth, height:innerHeight, scrollY, next, previous, fab, bar, nextFabOverlap:overlap(next,fab), previousFabOverlap:overlap(previous,fab), nextBarOverlap:overlap(next,bar), previousBarOverlap:overlap(previous,bar) };
    document.getElementById('result').textContent = JSON.stringify(result);
  }, 100); });
</script></body></html>`;

fs.writeFileSync(path.join(__dirname, '.mobile-layout-smoke.html'), html);
