// Optional real-browser smoke test, without TCP sockets or extra dependencies.
// Usage (Windows): node tests/pc-review-browser.cjs [path-to-chrome]
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
    for (let attempt = 0; attempt < 150; attempt++) {
      const response = await send('Runtime.evaluate', { expression: 'document.getElementById("smoke-result")?.textContent', returnByValue: true }, sessionId);
      if (response.result?.value) return JSON.parse(response.result.value);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Le navigateur ne fournit pas de résultat.');
  } finally { child.kill(); }
}

async function scenario(width, role) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-review-browser-'));
  try {
    let html = fs.readFileSync(path.resolve('public/pc-review.html'), 'utf8');
    html = html.replace(/src="(\/js\/[^" ]+)"/g, (_, url) => `src="${pathToFileURL(path.resolve('public' + url)).href}"`);
    const setup = `<script>
      window.testCalls = []; window.testPatches = []; window.testConflict = false;
      const room = { id:'r1', name:'Salle actuelle', building:'Campus' };
      const suggested = { id:'r2', name:'Salle 105 avec un nom suffisamment long pour tester le mobile', number:'105' };
      const machine = { id:'pc', name:'Nom <métier> ' + 'long'.repeat(25), agentHostname:'PC-105', serialNumber:'SERIAL-1', roomId:'r1', room,
        hostnameChangeId:'v1', hostnameChangeOld:'PC-101', hostnameChangeNew:'PC-105', hostnameChangedAt:'2026-11-10T10:00:00Z', suggestion:{roomId:'r2'}, lastSeenAt:'2026-08-01T12:00:00Z', inactivityDays:100 };
      let records = [machine];
      window.fetch = async (url, options = {}) => {
        const u = String(url); testCalls.push(u);
        let body = {};
        let status = 200;
        if (u.includes('/auth/me')) body = { id:'user', name:'Test', role:${JSON.stringify(role)} };
        else if (u.includes('/pc-review/pc')) {
          testPatches.push(JSON.parse(options.body));
          if (testConflict) { status = 409; body = {error:'Ce changement a évolué ou a déjà été traité. Actualisez la liste avant de recommencer.', code:'HOSTNAME_REVIEW_CONFLICT'}; records = [{...machine,hostnameChangeId:'v2',hostnameChangeNew:'PC-106'}]; }
          else { records = []; body = {ok:true}; }
        } else if (u.includes('/pc-review')) body = { days:60, rooms:[room,suggested], renamed:records, inactive:[machine], neverConnected:[{...machine,id:'never',name:'Jamais connecté',lastSeenAt:null}] };
        else if (u.includes('/messages/unread-count')) body = {total:0};
        else if (u.includes('/version')) body = {version:'review-test'};
        return new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
      };
    </script>`;
    html = html.replace('<script src=', setup + '<script src=');
    const verify = `<script>
      const pause = () => new Promise(r => setTimeout(r, 100));
      function check(value, message) { if (!value) throw new Error(message); }
      setTimeout(async () => {
        const result = document.createElement('pre'); result.id = 'smoke-result';
        try {
          for (let i=0; i<20 && !document.querySelector('[data-review-index]'); i++) await pause();
          const form = document.querySelector('[data-review-index]');
          check(form, 'Formulaire absent');
          check(document.querySelectorAll('#inactive-cards article').length === 1, 'PC inactif absent');
          check(document.querySelectorAll('#never-cards article').length === 1, 'PC jamais connecté absent');
          check(!document.querySelector('#renamed-cards img'), 'Nom non échappé');
          check(document.documentElement.scrollWidth <= innerWidth + 1, 'Débordement horizontal');
          check([...form.querySelectorAll('input,select,button')].every(el => el.getBoundingClientRect().right <= innerWidth + 1), 'Contrôle hors écran');
          if (${JSON.stringify(role)} === 'ADMIN') {
            form.querySelector('[data-use-hostname]').click(); check(form.elements.name.value === 'PC-105', 'Reprise hostname');
          } else { check(!form.elements.name, 'Nom éditable par un technicien'); }
          check(form.elements.roomId.value === '__keep', 'La salle est changée par défaut');
          form.querySelector('[data-use-room]').click(); check(form.elements.roomId.value === 'r2', 'Suggestion non sélectionnée');
          document.getElementById('days').value = '0'; check(!document.getElementById('days').checkValidity(), 'Seuil zéro accepté');
          document.getElementById('days').value = '30'; document.getElementById('days-form').requestSubmit(); await pause();
          check(testCalls.some(u => u.includes('days=30')), 'Seuil personnalisé non transmis');
          const refreshed = document.querySelector('[data-review-index]');
          testConflict = true; refreshed.requestSubmit(); await pause(); await pause();
          check(document.getElementById('review-state').textContent.includes('actualisée'), 'Conflit non signalé');
          check(document.getElementById('renamed-cards').textContent.includes('PC-106'), 'Version récente absente');
          testConflict = false; document.querySelector('[data-review-index] [data-ignore]').click(); await pause();
          check(testPatches.at(-1).action === 'ignore', 'Rejet non transmis');
          check(!document.querySelector('[data-review-index]'), 'Alerte traitée encore visible');
          if (${JSON.stringify(role)} === 'TECH') check(!('name' in testPatches[0]), 'Nom envoyé par technicien');
          result.textContent = JSON.stringify({ok:true,width:innerWidth,role:${JSON.stringify(role)},horizontalOverflow:false});
        } catch(err) { result.textContent = JSON.stringify({ok:false,error:err.message,width:innerWidth,role:${JSON.stringify(role)}}); }
        document.body.appendChild(result);
      }, 4000);
    </script>`;
    html = html.replace('</body>', verify + '</body>');
    const file = path.join(dir, 'smoke.html');
    fs.writeFileSync(file, html);
    const result = await inspect(file, dir, width);
    if (result.width !== width) throw new Error(`Largeur incorrecte : ${result.width}, attendu ${width}`);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } finally {
    // Chrome can briefly retain profile locks after exit. Cleanup is best effort.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

(async () => {
  for (const [width, role] of [[1280, 'ADMIN'], [390, 'ADMIN'], [390, 'TECH']]) await scenario(width, role);
})().catch(err => { console.error(err.message); process.exitCode = 1; });
