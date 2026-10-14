import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
const root = resolve('dist');
const builtManifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const buildLabel = builtManifest.version_name ?? builtManifest.version;
const server = createServer(async (req, res) => {
  if (req.url === '/content-fixture.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>Content fixture</title></head><body></body></html>');
    return;
  }
  const file = ({ '/popup.html': 'popup.html', '/popup.js': 'popup.js', '/popup.css': 'popup.css', '/assets/icon128.png': 'assets/icon128.png' })[req.url];
  if (!file) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
  res.end(await readFile(join(root, file)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const profile = await mkdtemp(join(tmpdir(), 'ai-gauge-fixture-'));
const child = spawn(process.env.CHROME_BIN || '/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = ''; child.stderr.on('data', b => { stderr += b; });
const pause = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let endpoint;
  for (let i = 0; i < 100; i++) { try { const [p, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); endpoint = `ws://127.0.0.1:${p}${path}`; break; } catch {} if (child.exitCode !== null) throw new Error(stderr.slice(-1500)); await pause(100); }
  assert(endpoint); ws = new WebSocket(endpoint);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let seq = 0; const pending = new Map(), exceptions = [];
  ws.addEventListener('message', e => { const d = JSON.parse(String(e.data)); if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text); const p = pending.get(d.id); if (p) { pending.delete(d.id); clearTimeout(p.timer); d.error ? p.j(new Error(JSON.stringify(d.error))) : p.r(d.result); } });
  const cdp = (method, params = {}, sessionId) => new Promise((r, j) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); j(new Error(method)); }, 10000); pending.set(id, { r, j, timer }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const target = (await cdp('Target.getTargets')).targetInfos.find(t => t.type === 'page');
  const session = (await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  await cdp('Runtime.enable', {}, session); await cdp('Page.enable', {}, session);
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session); assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const fixture = {
    settings: { enabled: { chatgpt: true, work_codex: true, claude: true }, strips: { chatgpt: true, work_codex: true, claude: true }, defaultProvider: 'chatgpt', selectedLimit: { chatgpt: null, work_codex: null, claude: null }, followTab: false, warning: 70, danger: 90 },
    permissions: { chatgpt: true, work_codex: true, claude: true },
    snapshots: {
      chatgpt: { provider: 'chatgpt', state: 'error', limits: [], collectedAt: null, checkedAt: null, nextAttemptAt: 0, failures: 0, errorCode: 'chatgpt_usage_pending' },
      work_codex: { provider: 'work_codex', state: 'ok', limits: [{ id: 'shared:primary_window', label: 'Work / Codex 공유 · 7일', category: 'product', percent: 42, resetsAt: new Date(Date.now() + 3600000).toISOString(), windowSeconds: 604800, remaining: null, unit: null, source: 'api' }], collectedAt: Date.now(), checkedAt: Date.now(), nextAttemptAt: 0, failures: 0, errorCode: null },
      claude: { provider: 'claude', state: 'error', limits: [{ id: 'five_hour', label: '5시간', category: 'window', percent: 0, resetsAt: null, windowSeconds: 18000, remaining: null, unit: null, source: 'api' }], collectedAt: Date.now() - 900000, checkedAt: Date.now(), nextAttemptAt: Date.now() + 120000, failures: 1, errorCode: 'network' }
    }
  };
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__fixture=${JSON.stringify(fixture)};window.__runtimeListeners=[];window.__storageListeners=[];window.chrome={runtime:{id:'fixture',getManifest:()=>(${JSON.stringify(builtManifest)}),sendMessage:async m=>{if(m.type==='settings')window.__fixture.settings=m.settings;if(m.type==='strips')window.__fixture.settings.strips=m.strips;if(m.type==='disable')window.__fixture.settings.enabled[m.provider]=false;if(m.type==='enable')window.__fixture.settings.enabled[m.provider]=true;return {ok:true,view:structuredClone(window.__fixture)}},onMessage:{addListener(f){window.__runtimeListeners.push(f)},removeListener(f){window.__runtimeListeners=window.__runtimeListeners.filter(x=>x!==f)}}},storage:{onChanged:{addListener(f){window.__storageListeners.push(f)},removeListener(f){window.__storageListeners=window.__storageListeners.filter(x=>x!==f)}}},permissions:{request:async()=>true,remove:async()=>true}};` }, session);
  await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Seoul' }, session);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/popup.html` }, session);
  let state;
  for (let i = 0; i < 100; i++) { state = await evaluate('({cards:document.querySelectorAll(".card").length,text:document.body?.textContent??"",width:document.documentElement?.scrollWidth??0,clientWidth:document.documentElement?.clientWidth??0})'); if (state.cards === 2) break; await pause(100); }
  assert.equal(state.cards, 2, JSON.stringify({state,exceptions})); assert.match(state.text, /42%/); assert.match(state.text, /0%/); assert.match(state.text, /오래된 데이터/); assert.doesNotMatch(state.text, /Gemini|입력창에는|최근 수집 성공|Work \/ Codex 공유/); assert(state.width <= state.clientWidth);
  assert.equal(await evaluate('document.getElementById("extension-version").textContent'), `AI Gauge ${buildLabel}`);
  assert.equal(await evaluate('Math.round(document.body.getBoundingClientRect().width)'), 520);
  assert.equal(await evaluate(`document.querySelector('[data-provider="work_codex"] .percent').textContent`), '사용량: 42%');
  assert.match(await evaluate(`document.querySelector('[data-provider="work_codex"] .reset').textContent`), /^🕒 사용량 초기화: \d{1,2}\/\d{1,2}\([일월화수목금토]\) \d{2}:\d{2}, \d+h 남음$/);
  assert(await evaluate(`(()=>{const img=document.querySelector('header img');return img.complete&&img.naturalWidth===128&&img.getBoundingClientRect().width===28})()`), 'Popup displays the supplied PNG');
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Popup overflow at ${width}px`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 520, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("preferences").open=true;document.getElementById("strip-claude").checked=false;document.getElementById("settings-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__fixture.settings.strips.claude') === false) break; await pause(100); }
  assert.equal(await evaluate('window.__fixture.settings.strips.claude'), false);
  assert.equal(await evaluate('window.__fixture.settings.warning'), 70, 'Saving display preferences leaves internal threshold settings intact');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#strip-settings label")].map(node=>node.textContent)'), ['ChatGPT 입력창에 표시', 'Codex 입력창에 표시', 'Claude 입력창에 표시']);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".card h2")].map(node=>node.textContent)'), ['ChatGPT', 'Claude']);
  assert.equal(await evaluate('document.querySelectorAll(".card details,.card select,.card .time,#default-provider").length'), 0);
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Expanded settings overflow at ${width}px`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 520, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("preferences").open=false');
  await evaluate('document.getElementById("diagnostics").open=true;document.getElementById("diagnostics-show").click()');
  const diagnostics = await evaluate('JSON.parse(document.getElementById("diagnostics-output").value)');
  assert.equal(diagnostics.extensionVersion, buildLabel);
  assert.equal(diagnostics.providers.chatgpt.errorCode, 'chatgpt_usage_pending');
  assert.deepEqual(Object.keys(diagnostics.providers.claude).sort(), ['enabled','permission','strip','state','errorCode','checkedAt','collectedAt','nextAttemptAt'].sort());
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Diagnostics overflow at ${width}px`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 520, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("diagnostics").open=false');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  const screenshotPath = join(tmpdir(), 'ai-gauge-popup-fixture.png'); await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, session);
  const darkPopup = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-popup-dark-fixture.png'), Buffer.from(darkPopup.data, 'base64'));
  await cdp('Emulation.setEmulatedMedia', { features: [] }, session);
  // Run the built content bundle on a synthetic Codex page; real Chrome extension APIs remain mocked.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'__codexFixture',{value:true});` }, session);
  // A real popup closes independently of a service page. Navigate to a fresh
  // document so its periodic renderer does not run against the synthetic site.
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/content-fixture.html` }, session);
  let contentReady = false;
  for (let i = 0; i < 100; i++) {
    contentReady = await evaluate(`location.pathname==='/content-fixture.html'&&document.readyState==='complete'&&!!window.__fixture`);
    if (contentReady) break;
    await pause(50);
  }
  assert(contentReady, 'Synthetic service document is ready with its own mocked extension APIs');
  await evaluate(`document.body.innerHTML='<main><form data-testid="codex-composer"><textarea>private synthetic prompt</textarea><button>Send</button></form></main>';history.replaceState(null,'','/codex/tasks/fixture');`);
  let content = await readFile(join(root, 'content.js'), 'utf8');
  // The only substituted part is the origin classifier, since this fixture lives on localhost.
  content = content.replaceAll('providerFromUrl(location.href)', 'providerFromUrl((window.__fixtureHost || "https://chatgpt.com")+location.pathname)');
  content = content.replaceAll('resolvePageProvider(document, location.href)', 'resolvePageProvider(document, (window.__fixtureHost || "https://chatgpt.com")+location.pathname)');
  // Capture only the synthetic extension host's closed root for layout checks.
  await evaluate(`window.__fixtureAttachShadow=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=window.__fixtureAttachShadow.call(this,options);if(this.id==='ai-gauge-usage-strip')window.__fixtureUsageRoot=root;return root};`);
  await evaluate(content);
  let count = 0;
  for (let i = 0; i < 20; i++) { count = await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'); if (count === 1) break; await pause(100); }
  assert.equal(count, 1); assert.equal(await evaluate('document.querySelector("form").nextElementSibling.id'), 'ai-gauge-usage-strip');
  assert.equal(await evaluate('document.querySelector("textarea").value'), 'private synthetic prompt');
  await evaluate(content); assert.equal(await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'), 1);
  await evaluate(`history.replaceState(null,'','/');document.body.innerHTML='<main><section><textarea style="min-height:48px">private Codex prompt</textarea><div id="codex-footer" class="ComposerLayoutFooter-_8IVRO" style="display:flex;align-items:center;gap:8px"><button type="button">Environment</button><button type="button">Send</button></div></section></main>';window.dispatchEvent(new PopStateEvent('popstate'));`);
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`document.getElementById('codex-footer').lastElementChild?.id==='ai-gauge-usage-strip'`)) break;
    await pause(100);
  }
  assert(await evaluate(`(()=>{const footer=document.getElementById('codex-footer'),strip=document.getElementById('ai-gauge-usage-strip'),buttons=[...footer.querySelectorAll('button')];return footer.lastElementChild===strip&&strip.getBoundingClientRect().top>=Math.max(...buttons.map(b=>b.getBoundingClientRect().bottom))&&strip.getBoundingClientRect().right<=footer.getBoundingClientRect().right+1;})()`), 'Codex requested footer contains the final full-width usage row below its controls');
  await evaluate(`window.__footerStrip=document.getElementById('ai-gauge-usage-strip');document.getElementById('codex-footer').className='ComposerLayoutFooter-newHash';const hint=document.createElement('span');hint.id='late-footer-hint';hint.textContent='Shortcut';document.getElementById('codex-footer').append(hint);`);
  await pause(400);
  assert(await evaluate(`document.getElementById('codex-footer').lastElementChild===window.__footerStrip&&document.querySelectorAll('#ai-gauge-usage-strip').length===1`), 'Dynamic suffix and late footer controls preserve one final usage row');
  const displayDiagnostic = await evaluate(`new Promise(resolve=>{for(const fn of window.__runtimeListeners)fn({type:'display-diagnostics'},{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve)})`);
  assert.equal(displayDiagnostic.provider, 'work_codex');
  assert.equal(displayDiagnostic.targetFound, true);
  assert.equal(displayDiagnostic.stripVisible, true);
  assert.equal(displayDiagnostic.stripCount, 1);
  assert.equal(await evaluate('location.pathname'), '/', 'Codex remains recognized after redirect to the site root');
  // A task view can replace the home composer while retaining the redirected URL.
  await evaluate(`document.body.innerHTML='<main style="display:flex;gap:12px"><section style="flex:1">Task result</section><aside style="width:330px;display:flex;flex-direction:column"><section><div contenteditable="true" style="min-height:48px"></div><div id="task-footer" class="ComposerLayoutFooter-taskHash" style="display:flex"><button>Attach</button><button>Send</button></div></section></aside></main>';`);
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`document.getElementById('task-footer').lastElementChild?.id==='ai-gauge-usage-strip'`)) break;
    await pause(100);
  }
  assert(await evaluate(`document.getElementById('task-footer').lastElementChild?.id==='ai-gauge-usage-strip'&&document.querySelectorAll('#ai-gauge-usage-strip').length===1`), 'Redirected Codex task uses its replacement footer');
  await evaluate(`history.replaceState(null,'','/codex/tasks/fixture');window.dispatchEvent(new PopStateEvent('popstate'));`);
  const waitForPlacement = async anchor => {
    let placement;
    for (let i = 0; i < 30; i++) {
      placement = await evaluate(`(()=>{const anchor=document.getElementById(${JSON.stringify(anchor)}),strip=document.getElementById('ai-gauge-usage-strip'),gap=strip?strip.getBoundingClientRect().top-anchor.getBoundingClientRect().bottom:null;return {sibling:anchor?.nextElementSibling===strip,gap,count:document.querySelectorAll('#ai-gauge-usage-strip').length};})()`);
      if (placement.sibling && placement.gap >= 0 && placement.gap <= 12 && placement.count === 1) return;
      await pause(100);
    }
    assert.fail(`Composer placement ${anchor}: ${JSON.stringify(placement)}`);
  };
  await evaluate(`document.body.innerHTML='<main><div id="composer" style="padding:12px;border:1px solid gray"><div><div data-lexical-editor="true" contenteditable="true">private Codex prompt</div></div><div id="toolbar"><button aria-label="Submit">Send</button></div></div><p>Footer</p></main>';`);
  await waitForPlacement('composer');
  assert.equal(await evaluate('document.querySelector("[contenteditable]").textContent'), 'private Codex prompt');
  await evaluate(`history.replaceState(null,'','/codex');document.body.innerHTML='<main style="display:grid;min-height:700px"><section style="display:flex;flex-direction:column;justify-content:center"><div id="home-slot"><div id="codex-home"><div contenteditable="plaintext-only" style="min-height:48px"></div><div role="toolbar"><button>Environment</button><button type="submit">Send</button></div></div><p id="home-helper" hidden>Shortcut hints</p></div></section></main>';window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('codex-home');
  await evaluate(`window.__homeStrip=document.getElementById('ai-gauge-usage-strip');`);
  for (let i = 0; i < 12; i++) {
    await evaluate(`document.getElementById('home-helper').hidden=${i % 2 === 0};`);
    await pause(350);
    await waitForPlacement('codex-home');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__homeStrip && document.getElementById('ai-gauge-usage-strip').parentElement.id==='home-slot'`), 'Codex home stays in its composer slot when helpers toggle');
  }
  await evaluate(`document.body.innerHTML='<main style="display:flex;gap:12px"><section style="flex:1;min-width:0">Task result</section><aside style="width:330px;display:flex;flex-direction:column"><section id="follow-up"><div><div contenteditable="plaintext-only" style="min-height:32px">private follow-up prompt</div></div><div role="toolbar"><button>Attach</button><button aria-label="Send follow-up">Send</button></div></section><p>Task footer</p></aside><textarea style="position:fixed;left:-10000px;width:0;height:0;opacity:0"></textarea></main>';`);
  await waitForPlacement('follow-up');
  await evaluate(`window.__stableCodexStrip=document.getElementById('ai-gauge-usage-strip');window.__stableCodexMoves=0;window.__stabilityObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===window.__stableCodexStrip)window.__stableCodexMoves++;});window.__stabilityObserver.observe(document,{childList:true,subtree:true});`);
  for (let i = 0; i < 20; i++) {
    await evaluate(`document.getElementById('follow-up').className='render-${i % 2}';`);
    await pause(80);
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__stableCodexStrip && document.querySelectorAll('#ai-gauge-usage-strip').length===1`), 'Codex follow-up strip stays mounted during task re-renders');
  }
  assert.equal(await evaluate('window.__stableCodexMoves'), 0);
  await evaluate('window.__stabilityObserver.disconnect()');
  await evaluate(`window.__fixtureHost='https://claude.ai';history.replaceState(null,'','/new');document.body.innerHTML='<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><div id="claude-slot"><div id="visual-box" style="padding:12px;border:1px solid gray"><div style="display:flex;flex-direction:column;gap:12px"><div class="ProseMirror" contenteditable="true">private Claude prompt</div><div id="toolbar"><button>Attach</button><button>Send</button></div></div></div></div></div><p>Disclaimer</p></main>';window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('visual-box');
  assert.equal(await evaluate('document.querySelector(".ProseMirror").textContent'), 'private Claude prompt');
  assert.equal(await evaluate('document.querySelectorAll("#toolbar button").length'), 2);
  for (const className of ['min-w-0', 'mni-w-0']) {
    await evaluate(`document.body.innerHTML='<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><form><div id="claude-surface" class="bg-surface-3" style="padding:12px;background:#e7ebef;border-radius:16px"><div id="claude-inner" class="relative w-full ${className}" style="min-width:0;width:100%;position:relative"><div contenteditable="true" class="ProseMirror" style="min-height:48px">private Claude prompt</div></div><div id="claude-toolbar" role="toolbar"><button type="button">Attach</button><button type="button">Send</button></div></div></form></div></main>';`);
    await waitForPlacement('claude-inner');
    assert(await evaluate(`(()=>{const surface=document.getElementById('claude-surface'),host=document.getElementById('ai-gauge-usage-strip'),toolbar=document.getElementById('claude-toolbar');return host.parentElement===surface&&host.nextElementSibling===toolbar&&host.getBoundingClientRect().bottom<=surface.getBoundingClientRect().bottom&&toolbar.getBoundingClientRect().top>=host.getBoundingClientRect().bottom;})()`), 'Claude strip is inside its surface after the requested wrapper and does not overlap its toolbar');
    assert.equal(await evaluate('document.querySelector(".ProseMirror").textContent'), 'private Claude prompt');
    assert.equal(await evaluate('document.querySelectorAll("#claude-toolbar button").length'), 2);
  }
  // Storage and worker invalidation must update the existing Claude bar, even
  // for a fraction that leaves the rounded percentage label unchanged.
  await evaluate(`window.__claudeProgress=window.__fixtureUsageRoot.querySelector('progress');window.__fixture.snapshots.claude={...window.__fixture.snapshots.claude,state:'ok',collectedAt:Date.now(),checkedAt:Date.now(),nextAttemptAt:0,errorCode:null,failures:0,limits:[{...window.__fixture.snapshots.claude.limits[0],percent:17,resetsAt:new Date(Date.now()+7200000).toISOString()}]};for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) {
    if (await evaluate(`!window.__claudeProgress.hidden&&window.__claudeProgress.value===17`)) break;
    await pause(50);
  }
  assert(await evaluate(`!window.__claudeProgress.hidden&&window.__claudeProgress.value===17&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 17%')`), 'Claude successful collection replaces its unavailable state');
  await evaluate(`window.__fixture.snapshots.claude.limits[0].percent=17.25;window.__fixture.snapshots.claude.collectedAt=Date.now();for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) {
    if (await evaluate('window.__claudeProgress.value===17.25')) break;
    await pause(50);
  }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.value===17.25&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 17%')`), 'Fractional usage updates the existing progress even when its rounded percentage is unchanged');
  await evaluate(`window.__fixture.snapshots.claude.limits[0].percent=63;window.__fixture.snapshots.claude.collectedAt=Date.now();for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) {
    if (await evaluate('window.__claudeProgress.value===63')) break;
    await pause(50);
  }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.value===63&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 63%')`), 'Runtime invalidation updates both the existing bar and its usage label');
  await evaluate(`window.__fixtureHost='https://chatgpt.com';`);
  await evaluate(`history.replaceState(null,'','/');document.body.innerHTML='<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><div id="chatgpt-slot"><form id="chatgpt-home"><div id="prompt-textarea" contenteditable="true" style="min-height:48px"></div><button>Send</button></form><p id="chatgpt-helper" hidden>Shortcut hints</p></div></div></main>';window.dispatchEvent(new PopStateEvent('popstate'));`);
  let ordinary;
  for (let i = 0; i < 20; i++) { ordinary = await evaluate('document.querySelector("#ai-gauge-usage-strip")?.getAttribute("aria-label")??""'); if (ordinary.includes('사용량: 42%')) break; await pause(100); }
  assert.match(ordinary, /^사용량: 42%  🕒 사용량 초기화: \d{1,2}\/\d{1,2}\([일월화수목금토]\) \d{2}:\d{2}, \d+h 남음$/); assert.doesNotMatch(ordinary, /0d|Chat|Work|Codex|공유|모델별|AI Gauge/);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,img=root.querySelector('.brand-icon'),text=root.querySelector('.current span');return img.complete&&img.naturalWidth===20&&img.getBoundingClientRect().width===20&&img.getBoundingClientRect().right<text.getBoundingClientRect().left})()`), 'Supplied icon loads at the start of the usage strip without a remote image request');
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,bar=root.querySelector('progress'),current=root.querySelector('.current').getBoundingClientRect(),reset=root.querySelector('.reset').getBoundingClientRect();return document.getElementById('ai-gauge-usage-strip').shadowRoot===null&&!bar.hidden&&bar.value===42&&bar.max===100&&bar.getBoundingClientRect().width===80&&bar.getBoundingClientRect().height===6&&reset.left-current.right>=13&&Math.abs(current.top-reset.top)<2;})()`), 'Small real-value progress and spacing replace the comma on a wide composer');
  const stripScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-strip-fixture.png'), Buffer.from(stripScreenshot.data, 'base64'));
  await evaluate(`window.__fixtureBodyStyle=document.body.style.cssText;document.body.style.background='#202020';document.body.style.color='#ececec';`);
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,text=root.querySelector('.current>span'),reset=root.querySelector('.reset'),icon=root.querySelector('.brand-icon');return getComputedStyle(text).color==='rgb(236, 236, 236)'&&getComputedStyle(reset).color==='rgb(236, 236, 236)'&&getComputedStyle(text).opacity==='0.8'&&getComputedStyle(icon).opacity==='1'&&getComputedStyle(root.querySelector('.current')).opacity==='1'})()`), 'Switching site theme updates text color without dimming the logo or parent row');
  const darkStrip = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-strip-dark-fixture.png'), Buffer.from(darkStrip.data, 'base64'));
  await evaluate('document.body.style.cssText=window.__fixtureBodyStyle');
  assert.equal(await evaluate(`getComputedStyle(window.__fixtureUsageRoot.querySelector('.current>span')).color`), 'rgb(0, 0, 0)', 'Text also returns to the light-site foreground');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,current=root.querySelector('.current').getBoundingClientRect(),reset=root.querySelector('.reset').getBoundingClientRect();return reset.top>=current.bottom&&document.documentElement.scrollWidth<=document.documentElement.clientWidth;})()`), 'Small composer wraps the reset group without horizontal overflow');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 520, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate(`window.__stableChatGPTStrip=document.getElementById('ai-gauge-usage-strip');window.__fixtureSend=chrome.runtime.sendMessage;window.__fixtureRejectNext=true;chrome.runtime.sendMessage=async message=>{if(window.__fixtureRejectNext){window.__fixtureRejectNext=false;throw new Error('temporary worker restart');}return window.__fixtureSend(message)};for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) {
    await evaluate(`document.querySelector('form').className='render-${i % 2}';document.getElementById('chatgpt-helper').hidden=${i % 2 === 0};`);
    await pause(350);
    await waitForPlacement('chatgpt-home');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__stableChatGPTStrip && window.__aiGaugeMounted===true`), 'Plan usage stays next to the home composer despite worker failures and helper changes');
  }
  // Exercise the built MAIN observer + isolated bridge contract with a synthetic
  // init response. Origin strings alone are remapped to the local fixture server.
  await evaluate(`window.__underlyingFixtureFetch=async()=>new Response(JSON.stringify({limits_progress:[{feature_name:'synthetic_feature',remaining:7,reset_after:'2026-12-01T00:00:00Z'}],email:'must-not-cross-boundary'}),{headers:{'content-type':'application/json'}});window.fetch=window.__underlyingFixtureFetch;`);
  const observedBundle = (await readFile(join(root, 'chatgpt-observer.js'), 'utf8')).replaceAll('https://chatgpt.com', `http://127.0.0.1:${port}`);
  await evaluate(observedBundle);
  await evaluate(`fetch('/backend-api/conversation/init',{method:'POST'}).then(()=>undefined)`);
  let observed;
  for (let i = 0; i < 20; i++) {
    observed = await evaluate('window.__AI_GAUGE_CHATGPT_QUOTA_V1__ ?? null');
    if (observed) break;
    await pause(50);
  }
  assert.equal(observed?.data.limits_progress[0]?.remaining, 7);
  assert(!JSON.stringify(observed).includes('must-not-cross-boundary'));
  await evaluate(`window.__fixture.settings.strips.chatgpt=false;window.__fixture.settings.strips.work_codex=false;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length') === 0) break; await pause(50); }
  assert.equal(await evaluate('window.__aiGaugeMounted'), true, 'Quota cleanup bridge survives hidden strips');
  assert.equal(await evaluate('window.fetch===window.__underlyingFixtureFetch'), false, 'Observer remains opt-in while only display is disabled');
  await evaluate(`window.__fixture.permissions.chatgpt=false;window.__fixture.permissions.work_codex=false;chrome.runtime.sendMessage=async()=>({ok:false});for(const fn of window.__runtimeListeners)fn({type:'permissions-revoked',origins:['https://chatgpt.com/*']},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length') === 0) break; await pause(100); }
  assert.equal(await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'), 0);
  assert.equal(await evaluate('window.__aiGaugeMounted'), false);
  assert.equal(await evaluate('window.fetch===window.__underlyingFixtureFetch'), true, 'Revoked permission restores fetch through the document event bridge');
  assert.equal(await evaluate('window.__AI_GAUGE_CHATGPT_QUOTA_V1__ === undefined'), true);
  assert.deepEqual(exceptions, []);
  console.log(`PASS Chromium fixture UI: compact two-card 520px popup, build-minute display version, narrow overflow checks, redirected root-URL Codex home/task footers and diagnostics, hash changes/row wrapping, countdown without 0d, shared plan usage on ChatGPT, Claude inner surfaces (min-w-0/mni-w-0), storage/runtime progress updates 17→17.25→63 without replacing the bar, stable strips over 52 timed checks, transient worker failure recovery, quota observation, denied-view revocation cleanup. Screenshot: ${screenshotPath}. Synthetic DOM/Chrome APIs; no live installation/account verification.`);
} finally {
  ws?.close(); child.kill('SIGTERM');
  await new Promise(r => { if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 3000).unref(); } });
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); await new Promise(r => server.close(r));
}
