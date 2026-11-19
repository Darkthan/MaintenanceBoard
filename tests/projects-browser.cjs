// Optional real-browser smoke test, without TCP sockets or extra dependencies.
// Usage (Windows): node tests/projects-browser.cjs [path-to-chrome]
// Real page DOM/events with an isolated in-memory API; database coverage is in projects.test.js.
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
    if (width < 768) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sessionId);
    await send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
    for (let attempt = 0; attempt < 350; attempt++) {
      const touch = await send('Runtime.evaluate', { expression: 'window.touchDragRequest || null', returnByValue: true }, sessionId);
      if (touch.result?.value) {
        const { from, to } = touch.result.value;
        await send('Runtime.evaluate', { expression: 'window.touchDragRequest = null' }, sessionId);
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] }, sessionId);
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x, y: to.y, id: 1 }] }, sessionId);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
        await send('Runtime.evaluate', { expression: 'window.touchDragDone = true' }, sessionId);
      }
      const response = await send('Runtime.evaluate', { expression: 'document.getElementById("smoke-result")?.textContent', returnByValue: true }, sessionId);
      if (response.result?.value) {
        await send('Runtime.evaluate', { expression: 'document.getElementById("smoke-result").hidden = true; window.scrollTo(0,0)' }, sessionId);
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        fs.mkdirSync(path.resolve('tests/.tmp/projects'), { recursive: true });
        fs.writeFileSync(path.resolve(`tests/.tmp/projects/${width}.png`), Buffer.from(screenshot.data, 'base64'));
        return JSON.parse(response.result.value);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Le navigateur ne fournit pas de résultat.');
  } finally { child.kill(); }
}

async function scenario(width) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-projects-browser-'));
  try {
    let html = fs.readFileSync(path.resolve('public/projects.html'), 'utf8').replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*><\/script>/g, '');
    const fixture = `<script>
      const clone = data => JSON.parse(JSON.stringify(data));
      const store = [{id:'p1',title:'Projet test',color:'#3b82f6',isActive:true,columns:
        ['a','b','c'].map((id,position)=>({id,title:id.toUpperCase(),position,color:'#64748b',cards:[]}))},
        {id:'p2',title:'Autre projet',color:'#64748b',isActive:false,columns:[]}];
      store[0].columns[0].cards.push({id:'card1',columnId:'a',title:'Carte',priority:'NORMAL',position:0});
      let failNext = false, cardMoves = 0;
      window.requireLogin = async () => ({id:'user',role:'ADMIN'});
      window.renderNav = () => {};
      window.api = {
        get: async url => clone(url === '/users' ? [] : url === '/projects' ? store : store.find(p=>url==='/projects/'+p.id)),
        patch: async (url,body) => { const p=store.find(p=>url==='/projects/'+p.id); Object.assign(p,body); return clone(p); },
        post: async (url,body) => {
          if(failNext) {failNext=false;throw new Error('Échec simulé');}
          const p=store.find(p=>url.startsWith('/projects/'+p.id+'/'));
          if(url.endsWith('/columns/reorder')) body.columnIds.forEach((id,position)=>p.columns.find(c=>c.id===id).position=position);
          else if(url.endsWith('/cards/move')) {
            cardMoves++;
            const card=p.columns.flatMap(c=>c.cards).find(c=>c.id===body.cardId);
            p.columns.forEach(c=>c.cards=c.cards.filter(c=>c.id!==card.id));
            card.columnId=body.toColumnId; p.columns.find(c=>c.id===body.toColumnId).cards.push(card);
          }
          return {};
        }
      };
    </script>`;
    // Basic local layout keeps hitboxes meaningful without fetching the Tailwind CDN.
    html = html.replace('</head>', '<style>#board{display:flex;gap:16px;overflow-x:auto}.kanban-column{flex-shrink:0;width:288px}.cards-area{min-height:80px}.hidden{display:none}</style>' + fixture + '</head>');
    const verify = `<script>
      setTimeout(async () => {
        const result=document.createElement('pre');result.id='smoke-result';
        const check=(ok,message)=>{if(!ok)throw new Error(message);};
        const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
        const order=()=>[...document.querySelectorAll('.kanban-column')].map(c=>c.dataset.colId).join(',');
        const drag=async(source,target,after)=>{
          const handle=document.querySelector('[data-col-id="'+source+'"] .column-handle');
          const col=document.querySelector('.kanban-column[data-col-id="'+target+'"]');
          const area=col.querySelector('.cards-area'),rect=col.getBoundingClientRect();
          const dataTransfer=new DataTransfer();
          handle.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));
          const clientX=rect.left+(after?rect.width-10:10);
          area.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer,clientX}));
          area.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientX}));
          handle.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
          await pause();
        };
        try {
          check(order()==='a,b,c','Ordre initial');
          check(document.getElementById('project-status').textContent==='Actif','Badge actif');
          await drag('c','a',false);
          check(order()==='c,a,b','Glisser dernière colonne en premier');
          check(cardMoves===0,'Le drag colonne ne déplace pas de carte');
          await selectProject('p1');check(order()==='c,a,b','Ordre après rechargement');
          await drag('c','b',true);check(order()==='a,b,c','Glisser après dernière colonne');
          const handle=document.querySelector('.column-handle');
          handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await pause();
          check(order()==='b,a,c','Déplacement clavier');
          check(document.activeElement.closest('.kanban-column').dataset.colId==='a','Focus clavier conservé');
          document.querySelector('.kanban-column[data-col-id="a"] button[title="Options colonne"]').click();
          document.querySelector('.col-context-menu button').click();await pause();
          check(order()==='a,b,c','Déplacement via menu');
          failNext=true;await drag('c','a',false);
          check(order()==='a,b,c','Ordre intact en cas erreur API');
          check(!document.querySelector('.column-dragging,.column-drop-before,.column-drop-after'),'Nettoyage indicateurs');
          const card=document.querySelector('.kanban-card'),area=document.querySelector('.cards-area[data-col-id="b"]');
          const dataTransfer=new DataTransfer();
          card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));
          area.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientY:0}));
          card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));await pause();
          check(cardMoves===1 && document.querySelector('.kanban-card').dataset.colId==='b','Drag cartes conservé');
          openEditProjectModal();check(document.getElementById('project-active').value==='true','Statut édition initial');
          document.getElementById('project-active').value='false';await saveProject();
          check(document.getElementById('project-status').textContent==='Inactif','Badge inactif après sauvegarde');
          check(document.querySelectorAll('.kanban-column').length===3,'Inactif conserve ses colonnes');
          renderProjectDropdown();check(document.querySelectorAll('#project-dropdown button').length===3,'Tous projets visibles');
          await selectProject('p2');await selectProject('p1');
          check(document.getElementById('project-status').textContent==='Inactif','Persistance statut après changement de projet');
          openEditProjectModal();check(document.getElementById('project-active').value==='false','Statut inactif en édition');
          document.getElementById('project-active').value='true';await saveProject();
          check(document.getElementById('project-status').textContent==='Actif','Réactivation');
          openProjectModal();check(document.getElementById('project-active').value==='true','Nouveau projet actif par défaut');closeProjectModal();
          const get=api.get;let release;
          api.get=url=>url==='/projects/p1'?new Promise(resolve=>{release=resolve;}):get(url);
          const pending=selectProject('p1');await selectProject('p2');release(await get('/projects/p1'));await pending;
          check(currentProject.id==='p2','Une ancienne réponse ne remplace pas la sélection récente');
          api.get=get;await selectProject('p1');
          result.textContent=JSON.stringify({ok:true,width:innerWidth,checks:['column-drag-before-after','reload','keyboard-focus','menu-move','save-failure','card-drag','edit-status','badges','inactive-visible','reactivation','default-active','project-switch-race']});
        } catch(err) {result.textContent=JSON.stringify({ok:false,width:innerWidth,error:err.message});}
        document.body.appendChild(result);
      },500);
    </script>`;
    html=html.replace('</body>',verify+'</body>');
    const file=path.join(dir,'smoke.html');fs.writeFileSync(file,html);
    const result=await inspect(file,dir,width);console.log(JSON.stringify(result));
    if(!result.ok || result.width!==width)process.exitCode=1;
  } finally {
    const resolved=path.resolve(dir);
    if(path.dirname(resolved)!==path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('mb-projects-browser-'))throw new Error('Unsafe cleanup');
    try {fs.rmSync(resolved,{recursive:true,force:true});}catch{}
  }
}
(async()=>{for(const width of [1280,390])await scenario(width);})().catch(err=>{console.error(err.message);process.exitCode=1;});
