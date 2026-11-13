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
    for (let attempt = 0; attempt < 150; attempt++) {
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
    const setup = `<script>
      window.testSaves = []; window.testConflict = false; window.testConfirm = true;
      window.confirm = () => testConfirm;
      let saved = null;
      const meetingId = '11111111-1111-4111-8111-111111111111';
      const orderId = '22222222-2222-4222-8222-222222222222';
      const originalReplaceState = history.replaceState.bind(history);
      history.replaceState = (...args) => { try { originalReplaceState(...args); } catch {} };
      window.fetch = async (url, options = {}) => {
        const u = String(url); let body = {}; let status = 200;
        if (u.includes('/auth/me')) body = { id: 'user', name: 'Test', role: ${JSON.stringify(role)} };
        else if (u.includes('/meetings/link-preview')) body = { type: 'orders', id: orderId, preview: { title: '<img src=x onerror=alert(1)>', status: 'ORDERED', reference: 'BC-2026-222222', totalAmount: 270, currency: 'EUR', url: '/orders.html?id=' + orderId } };
        else if (u.includes('/meetings') && options.method) {
          const payload = JSON.parse(options.body); testSaves.push(payload);
          if (testConflict) { status = 409; body = { error: 'Cette réunion a été modifiée par un collègue. Copiez vos notes avant de recharger.', code: 'MEETING_CONFLICT' }; }
          else { saved = { ...payload, id: meetingId, version: (payload.version || 0) + 1 }; body = saved; }
        } else if (u.includes('/meetings/')) body = saved;
        else if (u.includes('/meetings')) body = { data: saved ? [saved] : [], pagination: { totalPages: 1 } };
        else if (u.includes('/messages/unread-count')) body = {total:0};
        else if (u.includes('/version')) body = {version:'meetings-test'};
        return new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
      };
    </script>`;
    html = html.replace('<script src=', setup + '<script src=');
    const verify = `<script>
      const pause = () => new Promise(r => setTimeout(r, 80));
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
          document.getElementById('new-meeting').click();
          input('[name="title"]', 'Comité technique');
          input('[name="status"]', 'IN_PROGRESS');
          document.getElementById('add-topic').click();
          input('[data-topic="0"] [data-field="title"]', 'Premier sujet');
          input('[data-topic="0"] [data-field="notes"]', 'Décision <script> dangereuse</' + 'script>');
          input('[data-topic="0"] [data-field="checked"]', true);
          input('[data-topic="0"] [data-link-url]', '/orders.html?id=22222222-2222-4222-8222-222222222222');
          document.querySelector('[data-action="link"]').click(); await pause(); await pause();
          check(document.querySelector('.meeting-preview').textContent.includes('270'), 'Total absent');
          check(!document.querySelector('#meeting-editor img'), 'Aperçu non échappé');
          check(document.querySelector('.meeting-preview a') === null, 'Structure aperçu inattendue');
          document.getElementById('add-topic').click();
          input('[data-topic="1"] [data-field="title"]', 'Sujet ajouté en séance');
          document.querySelector('[data-topic="1"] [data-action="up"]').click();
          document.getElementById('meeting-form').requestSubmit(); await pause(); await pause();
          check(testSaves.length === 1, 'Réunion non enregistrée');
          check(testSaves[0].topics[0].title === 'Sujet ajouté en séance', 'Réorganisation perdue');
          check(testSaves[0].topics[1].checked, 'Case perdue');
          check(!('preview' in testSaves[0].topics[1].links[0]), 'Snapshot aperçu envoyé au serveur');
          check(testSaves[0].topics[1].notes.includes('Décision'), 'Notes perdues');
          check(document.getElementById('meeting-history').textContent.includes('Comité technique'), 'Historique absent');
          document.getElementById('reload-meeting').click(); await pause(); await pause();
          check(document.querySelector('[data-topic="1"] [data-field="checked"]').checked, 'Persistance case');
          input('[data-topic="1"] [data-field="notes"]', 'Mes notes en conflit');
          testConflict = true; document.getElementById('meeting-form').requestSubmit(); await pause(); await pause();
          check(document.getElementById('meeting-state').textContent.includes('collègue'), 'Conflit non signalé');
          check(document.querySelector('[data-topic="1"] textarea').value === 'Mes notes en conflit', 'Notes perdues au conflit');
          testConfirm = false; document.getElementById('new-meeting').click();
          check(document.querySelector('[data-topic="1"] textarea').value === 'Mes notes en conflit', 'Abandon non confirmé');
          testConflict = false; document.getElementById('meeting-form').requestSubmit(); await pause(); await pause();
          check(document.documentElement.scrollWidth <= innerWidth + 1, 'Débordement horizontal');
          check([...document.querySelectorAll('#meeting-editor input, #meeting-editor textarea, #meeting-editor button')].every(el => el.getBoundingClientRect().right <= innerWidth + 1), 'Contrôle hors écran');
          result.textContent = JSON.stringify({ok:true,width:innerWidth,role:${JSON.stringify(role)},checks:['create','notes','checkbox','reorder','preview','XSS','save','reload','conflict','unsaved-guard','responsive']});
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
