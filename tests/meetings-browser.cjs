// Optional real-browser smoke test, without TCP sockets or extra dependencies.
// Usage (Windows): node tests/meetings-browser.cjs [path-to-chrome]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const chrome = process.argv[2] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function inspect(file, dir, width) {
  const child = spawn(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--disable-background-networking', '--no-first-run',
    `--user-data-dir=${path.join(dir, 'profile')}`, '--allow-file-access-from-files', '--remote-debugging-pipe'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let sequence = 0, buffer = '';
  const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout CDP: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
  child.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timer); pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
      }
    }
  });
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, mobile: width < 768, deviceScaleFactor: 1 }, sessionId);
    await send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
    for (let attempt = 0; attempt < 350; attempt++) {
      const response = await send('Runtime.evaluate', { expression: 'document.getElementById("smoke-result")?.textContent', returnByValue: true }, sessionId);
      if (response.result?.value) {
        await send('Runtime.evaluate', { expression: 'document.getElementById("smoke-result").hidden = true; window.scrollTo(0,0)' }, sessionId);
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        fs.mkdirSync(path.resolve('tests/.tmp/meetings'), { recursive: true });
        fs.writeFileSync(path.resolve(`tests/.tmp/meetings/${width}.png`), Buffer.from(screenshot.data, 'base64'));
        return JSON.parse(response.result.value);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Le navigateur ne fournit pas de résultat.');
  } finally { child.kill(); }
}

async function scenario(width, role) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-meetings-browser-'));
  try {
    let html = fs.readFileSync(path.resolve('public/meetings.html'), 'utf8');
    // Use the app's CDN runtime locally when available so screenshots include its real styling.
    const tailwind = path.resolve('tests/.tmp/meetings/tailwind.js');
    if (fs.existsSync(tailwind)) html = html.replace('https://cdn.tailwindcss.com', pathToFileURL(tailwind).href);
    html = html.replace(/src="(\/js\/[^" ]+)"/g, (_, url) => `src="${pathToFileURL(path.resolve('public' + url)).href}"`);
    html = html.replace(/href="(\/css\/[^" ]+)"/g, (_, url) => `href="${pathToFileURL(path.resolve('public' + url)).href}"`);
    const setup = `<script>
      window.testSaves = []; window.testConflict = false; window.testConfirm = true; window.testSearchFail = false; window.testPreviewDenied = false; window.testOffline = false;
      window.confirm = () => testConfirm;
      let saved = null;
      const meetingId = '11111111-1111-4111-8111-111111111111';
      const orderId = '22222222-2222-4222-8222-222222222222';
      window.makeDenseMeeting = () => {
        saved = { ...saved, version:saved.version+1, topics: [...saved.topics, ...['Suivi des commandes', 'Renouvellement des postes', 'Interventions en attente', 'Prêts de matériel', 'Réseau et accès', 'Calendrier de maintenance', 'Budget prévisionnel', 'Documentation', 'Questions diverses', 'Prochaines actions'].map(title => ({id:crypto.randomUUID(),title,checked:false,notes:'',links:[]}))] };
      };
      window.remoteEdit = (field, value, index = 0) => { saved = JSON.parse(JSON.stringify(saved)); saved.version++; saved.topics[index][field] = value; };
      const originalReplaceState = history.replaceState.bind(history);
      history.replaceState = (...args) => { try { originalReplaceState(...args); } catch {} };
      window.fetch = async (url, options = {}) => {
        const u = String(url); let body = {}; let status = 200;
        if (testOffline && u.includes('/meetings')) throw new TypeError('Offline');
        if (u.includes('/auth/me')) body = { id: 'user', name: 'Test', role: ${JSON.stringify(role)} };
        else if (u.includes('/meetings/link-search')) {
          if (testSearchFail) { status = 500; body = { error: 'Recherche momentanément indisponible' }; }
          else {
            const q = new URL(u, 'https://test.local').searchParams.get('q');
            if (q === 'lent') await new Promise(resolve => setTimeout(resolve, 700));
            body = { data: q === 'absente' ? [] : [{ type: 'orders', id: orderId, preview: { title: q === 'lent' ? 'OLD_SEARCH' : '<img src=x onerror=alert(1)>', status: 'ORDERED', reference: 'BC-2026-222222', totalAmount: 270, currency: 'EUR', url: '/orders.html?id=' + orderId } }], hasMore: false };
          }
        }
        else if (u.includes('/meetings/link-preview') && testPreviewDenied) { status = 404; body = { error: 'Objet indisponible' }; }
        else if (u.includes('/meetings/link-preview')) body = { type: 'orders', id: orderId, preview: { title: '<img src=x onerror=alert(1)>', status: 'ORDERED', reference: 'BC-2026-222222', totalAmount: 270, currency: 'EUR', url: '/orders.html?id=' + orderId } };
        else if (u.includes('/meetings') && options.method) {
          const payload = JSON.parse(options.body); testSaves.push(payload);
          if (testConflict || (options.method === 'PATCH' && payload.version !== saved.version)) {
            if (testConflict) remoteEdit('notes', 'Note du collègue', 1);
            status = 409; body = { error: 'Cette réunion a été modifiée par un collègue.', code: 'MEETING_CONFLICT' };
          }
          else { saved = { ...payload, id: meetingId, version: (payload.version || 0) + 1 }; body = saved; }
        } else if (u.includes('/updates?')) {
          const version = Number(new URL(u, 'https://test.local').searchParams.get('version'));
          if (!saved || saved.version === version) status = 204; else body = saved;
        } else if (u.includes('/meetings/')) body = saved;
        else if (u.includes('/meetings')) body = { data: saved ? [saved] : [], pagination: { totalPages: 1 } };
        else if (u.includes('/messages/unread-count')) body = {total:0};
        else if (u.includes('/version')) body = {version:'meetings-test'};
        return new Response(status === 204 ? null : JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
      };
    </script>`;
    html = html.replace('<script src=', setup + '<script src=');
    const verify = `<script>
      const pause = () => new Promise(r => setTimeout(r, 80));
      const until = async (predicate, label) => { for(let i=0;i<75;i++) { if(predicate()) return; await pause(); } throw new Error(label); };
      function check(value, message) { if (!value) throw new Error(message); }
      function input(selector, value) {
        const el = document.querySelector(selector); check(el, 'Champ absent ' + selector);
        if (el.type === 'checkbox') el.checked = value; else el.value = value;
        el.dispatchEvent(new Event('input', {bubbles:true}));
      }
      setTimeout(async () => {
        const result = document.createElement('pre'); result.id = 'smoke-result';
        try {
          check(document.querySelector('a[href="/meetings.html"]'), 'Navigation Réunions absente');
          check(document.getElementById('meeting-fab').getAttribute('aria-label') === 'Créer une réunion', 'Contexte initial du bouton +');
          document.getElementById('meeting-fab').click();
          check(document.getElementById('meeting-fab').getAttribute('aria-label') === 'Ajouter un sujet', 'Contexte du bouton + dans une réunion');
          input('[name="title"]', 'Comité technique');
          input('[name="status"]', 'IN_PROGRESS');
          document.getElementById('meeting-fab').click();
          document.getElementById('collapse-topics').click();
          check(!document.getElementById('meeting-form').reportValidity(), 'Sujet vide accepté');
          check(document.querySelector('[data-topic="0"]').open, 'Sujet invalide masqué à la validation');
          input('[data-topic="0"] [data-field="title"]', 'Premier sujet');
          input('[data-topic="0"] [data-field="notes"]', 'Décision <script> dangereuse</' + 'script>');
          input('[data-topic="0"] [data-field="checked"]', true);
          input('[data-topic="0"] [data-link-url]', '@'); await pause();
          check(document.querySelector('.meeting-mentions').textContent.includes('@commandes'), 'Liste de pages absente');
          input('[data-topic="0"] [data-link-url]', '@commandes absente'); await pause(); await pause(); await pause(); await pause();
          check(document.querySelector('.meeting-mentions').textContent.includes('Aucun résultat'), 'État vide absent');
          testSearchFail = true;
          input('[data-topic="0"] [data-link-url]', '@commandes panne'); await pause(); await pause(); await pause(); await pause();
          check(document.querySelector('.meeting-mentions').textContent.includes('momentanément'), 'Erreur de recherche absente');
          testSearchFail = false; document.querySelector('.meeting-mentions button').click(); await pause(); await pause(); await pause(); await pause();
          check(document.querySelector('.meeting-mention-result'), 'Réessai de recherche');
          input('[data-topic="0"] [data-link-url]', '@commandes lent'); await pause(); await pause(); await pause();
          input('[data-topic="0"] [data-link-url]', '@commandes nouvelle');
          for (let i=0;i<12;i++) await pause();
          check(!document.querySelector('.meeting-mentions').textContent.includes('OLD_SEARCH'), 'Ancienne recherche réaffichée');
          testPreviewDenied = true; document.querySelector('.meeting-mention-result').click(); await pause(); await pause();
          check(document.querySelector('.meeting-mentions').textContent.includes('Objet indisponible'), 'Accès non revérifié à la sélection');
          check(!document.querySelector('.meeting-preview'), 'Objet révoqué inséré'); testPreviewDenied = false;
          const notes = document.querySelector('[data-topic="0"] textarea');
          input('[data-topic="0"] textarea', notes.value + ' @commandes');
          await pause(); await pause(); await pause(); await pause();
          check(document.querySelector('.meeting-mention-result').textContent.includes('270'), 'Mention sans total');
          check(!document.querySelector('.meeting-mentions img'), 'Titre de mention non échappé');
          notes.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
          await pause(); await pause();
          check(!document.querySelector('[data-topic="0"] textarea').value.includes('@commandes'), 'Déclencheur mention non remplacé');
          check(document.querySelectorAll('.meeting-preview').length === 1, 'Lien de mention non inséré');
          check(document.querySelector('[data-topic="0"] textarea').value.includes('Décision'), 'Notes perdues à la mention');
          input('[data-topic="0"] [data-link-url]', '/orders.html?id=22222222-2222-4222-8222-222222222222');
          document.querySelector('[data-action="link"]').click(); await pause(); await pause();
          check(document.querySelector('.meeting-preview').textContent.includes('270'), 'Total absent');
          check(!document.querySelector('#meeting-editor img'), 'Aperçu non échappé');
          check(document.querySelector('.meeting-preview a') === null, 'Structure aperçu inattendue');
          document.getElementById('meeting-fab').click();
          input('[data-topic="1"] [data-field="title"]', 'Sujet ajouté en séance');
          document.querySelector('[data-topic="1"] [data-action="up"]').click();
          document.getElementById('meeting-form').requestSubmit(); await pause(); await pause();
          check(testSaves.length >= 1, 'Réunion non enregistrée');
          check(testSaves.at(-1).topics[0].title === 'Sujet ajouté en séance', 'Réorganisation perdue');
          check(testSaves.at(-1).topics[1].checked, 'Case perdue');
          check(!('preview' in testSaves.at(-1).topics[1].links[0]), 'Snapshot aperçu envoyé au serveur');
          check(testSaves.at(-1).topics[1].notes.includes('Décision'), 'Notes perdues');
          check(document.getElementById('meeting-history').textContent.includes('Comité technique'), 'Historique absent');
          document.getElementById('reload-meeting').click(); await pause(); await pause();
          if (innerWidth < 768) check(!document.querySelector('.meeting-history-panel').open, 'Historique mobile non compact');
          check([...document.querySelectorAll('details[data-topic]')].every(el => !el.open), 'Les sujets ne sont pas compacts par défaut');
          document.getElementById('expand-topics').click();
          check([...document.querySelectorAll('details[data-topic]')].every(el => el.open), 'Tout agrandir');
          document.getElementById('collapse-topics').click();
          check([...document.querySelectorAll('details[data-topic]')].every(el => !el.open), 'Tout réduire');
          document.querySelector('[data-topic="1"] summary').click(); await pause();
          check(document.querySelector('[data-topic="1"]').open, 'Agrandissement individuel');
          check(document.querySelector('[data-topic="1"] [data-field="checked"]').checked, 'Persistance case');
          input('[data-topic="1"] [data-field="notes"]', 'Mes notes en conflit');
          testConflict = true; document.getElementById('meeting-form').requestSubmit(); await pause(); await pause();
          check(document.getElementById('meeting-state').textContent.includes('collègue'), 'Conflit non signalé');
          check(document.querySelector('[data-topic="1"] textarea').value === 'Mes notes en conflit', 'Notes perdues au conflit');
          testConfirm = false; document.getElementById('back-meetings').click();
          check(document.querySelector('[data-topic="1"] textarea').value === 'Mes notes en conflit', 'Abandon non confirmé');
          testConflict = false; document.querySelector('[data-conflict="local"]').click();
          document.getElementById('meeting-form').requestSubmit(); await pause(); await pause();
          const liveNotes = document.querySelector('[data-topic="1"] textarea'); liveNotes.focus();
          input('[data-topic="1"] textarea', 'Notes automatiques'); liveNotes.setSelectionRange(7,7);
          await until(() => testSaves.at(-1)?.topics[1]?.notes === 'Notes automatiques' && document.getElementById('meeting-state').textContent.includes('Enregistré'), 'Sauvegarde automatique absente');
          check(liveNotes.isConnected && document.activeElement === liveNotes, 'La sauvegarde a interrompu la saisie');
          input('[data-topic="1"] textarea', 'Saisie locale conservée'); liveNotes.setSelectionRange(8,8);
          remoteEdit('title', 'Modification en direct', 0);
          await until(() => document.querySelector('[data-topic="0"] [data-topic-summary]').textContent === 'Modification en direct', 'Mise à jour distante absente');
          check(document.querySelector('[data-topic="1"] textarea').value === 'Saisie locale conservée', 'Fusion a perdu la saisie locale');
          check(document.activeElement.selectionStart === 8, 'Curseur déplacé par la synchronisation');
          await until(() => testSaves.at(-1)?.topics[1]?.notes === 'Saisie locale conservée', 'Fusion non sauvegardée');
          testOffline = true; input('[data-topic="1"] textarea', 'Notes pendant la coupure');
          await until(() => document.getElementById('meeting-state').textContent.includes('interrompue'), 'Coupure non signalée');
          check(document.querySelector('[data-topic="1"] textarea').value === 'Notes pendant la coupure', 'Notes perdues hors ligne');
          testOffline = false; window.dispatchEvent(new Event('online'));
          await until(() => testSaves.at(-1)?.topics[1]?.notes === 'Notes pendant la coupure' && document.getElementById('meeting-state').textContent.includes('Enregistré'), 'Reconnexion sans sauvegarde');
          check(document.documentElement.scrollWidth <= innerWidth + 1, 'Débordement horizontal');
          check([...document.querySelectorAll('#meeting-editor input, #meeting-editor textarea, #meeting-editor button')].every(el => el.getBoundingClientRect().right <= innerWidth + 1), 'Contrôle hors écran');
          document.getElementById('collapse-topics').click();
          makeDenseMeeting(); document.getElementById('reload-meeting').click(); await pause(); await pause(); window.scrollTo(0,0);
          const rows = [...document.querySelectorAll('.topic-card > summary')];
          const compactRowHeight = Math.max(...rows.map(el => el.getBoundingClientRect().height));
          check(compactRowHeight <= 48, 'Sujets insuffisamment compacts : ' + compactRowHeight);
          const agendaBottom = Math.min(innerHeight - 90, document.querySelector('.meeting-savebar').getBoundingClientRect().top);
          const visibleTopics = rows.filter(el => { const r=el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= agendaBottom; }).length;
          check(visibleTopics >= 8, 'Moins de 8 sujets visibles sans défiler : ' + visibleTopics);
          check(document.documentElement.scrollWidth <= innerWidth + 1, 'Débordement avec une longue liste');
          const fab = document.getElementById('meeting-fab'); const fabRect = fab.getBoundingClientRect();
          const overlapsFab = el => { const r=el.getBoundingClientRect(); return r.left < fabRect.right && r.right > fabRect.left && r.top < fabRect.bottom && r.bottom > fabRect.top; };
          check(fabRect.right <= innerWidth && fabRect.bottom <= innerHeight, 'Bouton + hors écran');
          check([...document.querySelectorAll('.meeting-savebar button')].every(el => !overlapsFab(el)), 'Bouton + masque les actions');
          if (innerWidth < 1024) check(!overlapsFab(document.getElementById('mobile-tabbar-bar')), 'Bouton + masque la navigation mobile');
          document.querySelector('.meeting-history-panel').open = true; await pause();
          check(fab.getAttribute('aria-label') === 'Créer une réunion', 'Bouton + ne change pas dans le menu des réunions');
          document.querySelector('.meeting-history-panel').open = false; await pause();
          check(fab.getAttribute('aria-label') === 'Ajouter un sujet', 'Bouton + ne revient pas à l’ajout de sujet');
          document.getElementById('back-meetings').click();
          check(!document.getElementById('meeting-form'), 'Retour à la liste des réunions');
          check(fab.getAttribute('aria-label') === 'Créer une réunion', 'Bouton + ne crée pas depuis la liste');
          fab.click(); check(document.querySelector('[name="title"]').value === '', 'Nouvelle réunion non créée depuis +');
          document.getElementById('back-meetings').click();
          document.querySelector('[data-meeting]').click(); await pause(); await pause();
          result.textContent = JSON.stringify({ok:true,width:innerWidth,role:${JSON.stringify(role)},compactRowHeight,visibleTopics,checks:['create','notes','checkbox','reorder','preview','XSS','mentions','mention-error-retry','mention-keyboard','mention-stale-search','mention-access-recheck','compact-default','expand-collapse','save','reload','conflict','unsaved-guard','responsive','dense-agenda','contextual-fab','autosave','live-merge','caret-preserved','offline-retry','conflict-resolution']});
        } catch(err) { result.textContent = JSON.stringify({ok:false,error:err.message,width:innerWidth}); }
        document.body.appendChild(result);
      }, 1500);
    </script>`;
    html = html.replace('</body>', verify + '</body>');
    const file = path.join(dir, 'smoke.html'); fs.writeFileSync(file, html);
    const result = await inspect(file, dir, width); console.log(JSON.stringify(result));
    if (!result.ok || result.width !== width) process.exitCode = 1;
  } finally {
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('mb-meetings-browser-')) throw new Error('Unsafe cleanup');
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch {}
  }
}
(async () => {
  for (const [width, role] of [[1280, 'ADMIN'], [390, 'TECH']]) await scenario(width, role);
})().catch(err => { console.error(err.message); process.exitCode = 1; });
