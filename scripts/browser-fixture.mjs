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
  const waitForPlacement = async anchor => {
    let placement;
    for (let i = 0; i < 30; i++) {
      placement = await evaluate(`(()=>{const anchor=document.getElementById(${JSON.stringify(anchor)}),strip=document.getElementById('ai-gauge-usage-strip'),gap=strip&&anchor?strip.getBoundingClientRect().top-anchor.getBoundingClientRect().bottom:null;return {sibling:!!strip&&anchor?.nextElementSibling===strip,gap,count:document.querySelectorAll('#ai-gauge-usage-strip').length,height:strip?.getBoundingClientRect().height};})()`);
      if (placement.sibling && placement.gap >= 0 && placement.gap <= 12 && placement.count === 1 && placement.height === 30) return;
      await pause(100);
    }
    assert.fail(`Composer placement ${anchor}: ${JSON.stringify(placement)}`);
  };
  const fixture = {
    settings: { enabled: { chatgpt: true, claude: true, gemini: true }, strips: { chatgpt: true, codex: true, claude: true, gemini: true }, defaultProvider: 'chatgpt', selectedLimit: { chatgpt: null, claude: null, gemini: null }, followTab: false, warning: 70, danger: 90 },
    permissions: { chatgpt: true, claude: true, gemini: true },
    snapshots: {
      chatgpt: { provider: 'chatgpt', state: 'ok', limits: [{ id: 'shared:primary_window', label: 'ChatGPT · 7일', category: 'product', percent: 42, resetsAt: new Date(Date.now() + 3600000).toISOString(), windowSeconds: 604800, remaining: null, unit: null, source: 'api' }], collectedAt: Date.now(), checkedAt: Date.now(), nextAttemptAt: 0, failures: 0, errorCode: null },
      claude: { provider: 'claude', state: 'error', limits: [{ id: 'five_hour', label: '5시간', category: 'window', percent: 0, resetsAt: null, windowSeconds: 18000, remaining: null, unit: null, source: 'api' }], collectedAt: Date.now() - 900000, checkedAt: Date.now(), nextAttemptAt: Date.now() + 120000, failures: 1, errorCode: 'network' },
      gemini: { provider: 'gemini', state: 'ok', limits: [
        { id: 'gemini:2', label: '주간', category: 'window', percent: 42, resetsAt: new Date(Date.now() + 172800000).toISOString(), windowSeconds: 604800, remaining: 12096, unit: null, source: 'api' },
        { id: 'gemini:1', label: '5시간', category: 'window', percent: 0, resetsAt: new Date(Date.now() + 7200000).toISOString(), windowSeconds: 18000, remaining: 600, unit: null, source: 'api' }
      ], collectedAt: Date.now(), checkedAt: Date.now(), nextAttemptAt: 0, failures: 0, errorCode: null }
    }
  };
  for (const [provider, label] of Object.entries({ chatgpt: 'Pro 200', claude: 'Max 20x', gemini: 'AI Pro' })) {
    const snapshot = fixture.snapshots[provider];
    snapshot.plan = { label, checkedAt: snapshot.collectedAt };
    if (snapshot.state === 'ok') snapshot.checkedAt = snapshot.collectedAt;
  }
  for (const provider of ['chatgpt', 'claude']) fixture.snapshots[provider].tickets = {
    checkedAt: Date.now(), failures: 0, inventory: { mode: 'detail', usableCount: null, cooldownUntil: null,
      grants: [86400000, 172800000].map(offset => ({ kind: 'full', count: 1, startsAt: null, expiresAt: new Date(Date.now() + offset).toISOString(),
        usableNow: true, clears: ['five_hour', 'seven_day'], requiresLimit: false, blocked: false, selected: null })) }
  };
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__fixture=${JSON.stringify(fixture)};window.__runtimeListeners=[];window.__storageListeners=[];window.chrome={runtime:{id:'fixture',getManifest:()=>(${JSON.stringify(builtManifest)}),sendMessage:async m=>{if(m.type==='settings')window.__fixture.settings=m.settings;if(m.type==='strips')window.__fixture.settings.strips=m.strips;if(m.type==='disable')window.__fixture.settings.enabled[m.provider]=false;if(m.type==='enable')window.__fixture.settings.enabled[m.provider]=true;if(m.type==='enable-many')for(const p of m.providers)window.__fixture.settings.enabled[p]=true;return {ok:true,view:structuredClone(window.__fixture)}},onMessage:{addListener(f){window.__runtimeListeners.push(f)},removeListener(f){window.__runtimeListeners=window.__runtimeListeners.filter(x=>x!==f)}}},storage:{onChanged:{addListener(f){window.__storageListeners.push(f)},removeListener(f){window.__storageListeners=window.__storageListeners.filter(x=>x!==f)}}},permissions:{request:async({origins})=>{(window.__permissionRequests??=[]).push(origins);for(const [p,origin] of Object.entries({chatgpt:'https://chatgpt.com/*',claude:'https://claude.ai/*',gemini:'https://gemini.google.com/*'}))if(origins.includes(origin))window.__fixture.permissions[p]=true;return true;},remove:async()=>true}};` }, session);
  await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Seoul' }, session);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/popup.html` }, session);
  let state;
  for (let i = 0; i < 100; i++) { state = await evaluate('({cards:document.querySelectorAll(".card").length,text:document.body?.textContent??"",width:document.documentElement?.scrollWidth??0,clientWidth:document.documentElement?.clientWidth??0})'); if (state.cards === 3) break; await pause(100); }
  assert.equal(state.cards, 3, JSON.stringify({state,exceptions})); assert.match(state.text, /42%/); assert.match(state.text, /0%/); assert.doesNotMatch(state.text, /오래된 데이터|오래된 정보|입력창에는|최근 수집 성공|Work \/ Codex 공유/); assert(state.width <= state.clientWidth);
  assert(await evaluate(`(()=>{const card=document.querySelector('[data-provider="claude"]');return card.querySelector('.percent').textContent==='사용량: 0%'&&card.querySelector('progress').value===0&&!card.querySelector('.status');})()`), 'Popup keeps a valid 15-minute-old cached value through one network failure without an age-only warning');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.card .plan-badge')].map(badge=>badge.textContent)`), ['Pro 200', 'AI Pro']);
  assert(await evaluate(`Array.from(document.querySelectorAll('.card-heading')).every(heading=>{const title=heading.querySelector('h2'),badge=heading.querySelector('.plan-badge');if(!badge)return title.nextElementSibling===null;const a=title.getBoundingClientRect(),b=badge.getBoundingClientRect();return title.nextElementSibling===badge&&b.left-a.right>=7&&Math.abs((a.top+a.height/2)-(b.top+b.height/2))<1&&b.height<=22;})`), 'Each compact plan badge sits beside its service title without moving the existing usage layout');
  assert.equal(await evaluate('document.getElementById("extension-version").textContent'), `AI Gauge ${buildLabel}`);
  assert.equal(await evaluate('Math.round(document.body.getBoundingClientRect().width)'), 600);
  assert(await evaluate(`document.body.getBoundingClientRect().height<=600`), 'The default three-service popup fits the Chrome popup height');
  await evaluate(`window.__savedLimits=structuredClone(Object.fromEntries(['chatgpt','claude'].map(p=>[p,window.__fixture.snapshots[p].limits])));for(const p of ['chatgpt','claude']){const s=window.__fixture.snapshots[p];s.limits.push({...s.limits[0],id:'extra-weekly',label:'주간',windowSeconds:604800,resetsAt:new Date(Date.now()+7*86400000).toISOString()});}for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('.card .limit').length===6`)) break; await pause(50); }
  const compactHeight = await evaluate('Math.ceil(document.body.getBoundingClientRect().height)');
  assert(compactHeight <= 600, `Six usage windows and four individual tickets need no popup scroll: ${compactHeight}px`);
  assert(await evaluate(`Array.from(document.querySelectorAll('.card-heading')).every(h=>{const name=h.querySelector('.provider-name').getBoundingClientRect(),actions=h.querySelector('.actions').getBoundingClientRect();return actions.left>=name.right&&Math.abs((name.top+name.height/2)-(actions.top+actions.height/2))<1;})`), 'Service controls share the title row in the wide popup');
  await evaluate(`for(const p of ['chatgpt','claude'])window.__fixture.snapshots[p].limits=window.__savedLimits[p];for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('.card .limit').length===4`)) break; await pause(50); }
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.ticket-info')].map(link=>({href:link.href,target:link.target,rel:link.rel,tabIndex:link.tabIndex,text:link.querySelector('.ticket-count').textContent}))`), [
    { href: 'https://chatgpt.com/settings/usage?tab=overview', target: '_blank', rel: 'noopener noreferrer', tabIndex: 0, text: '🎫 초기화 티켓 2개' },
    { href: 'https://claude.ai/new#settings/usage', target: '_blank', rel: 'noopener noreferrer', tabIndex: 0, text: '🎫 초기화 티켓 2개' }
  ], 'Compact popup exposes held tickets only for ChatGPT and Claude as official native links');
  assert.doesNotMatch(state.text, /지금 사용 가능/);
  assert(await evaluate(`['chatgpt','claude'].every(provider=>{const link=document.querySelector('[data-provider="'+provider+'"] .ticket-info'),rows=[...link.querySelectorAll('.ticket-expiry')];return rows.length===2&&rows.every((row,i)=>{const date=new Date(window.__fixture.snapshots[provider].tickets.inventory.grants[i].expiresAt),label='1개 · '+(date.getMonth()+1)+'/'+date.getDate()+' '+String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0')+' 만료';return row.textContent===label&&link.getAttribute('aria-label').includes(label);});})`), 'Popup presents each ticket expiry separately in local time and accessible labels');
  assert.equal(await evaluate(`document.querySelector('[data-provider="chatgpt"] .percent').textContent`), '사용량: 42%');
  assert.equal(await evaluate(`document.querySelector('[data-provider="chatgpt"] .limit-line > :first-child').textContent`), '7일', 'The ChatGPT card title is not repeated in the usage window label');
  assert.match(await evaluate(`document.querySelector('[data-provider="chatgpt"] .reset').textContent`), /^🕒 사용량 초기화: \d{1,2}\/\d{1,2}\([일월화수목금토]\) \d{2}:\d{2}, \d+h 남음$/);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-provider="gemini"] .limit-line')].map(row=>row.textContent)`), ['5시간사용량: 0%', '주간사용량: 42%']);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-provider="gemini"] h2'),'::before').backgroundColor`), 'rgb(53, 105, 200)');
  assert(await evaluate(`(()=>{const img=document.querySelector('header img');return img.complete&&img.naturalWidth===128&&img.getBoundingClientRect().width===28})()`), 'Popup displays the supplied PNG');
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Popup overflow at ${width}px`);
  }
  await evaluate(`window.__fixture.snapshots.gemini.plan=null;for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelector('[data-provider="gemini"] .plan-badge')===null`)) break; await pause(50); }
  assert.equal(await evaluate(`document.querySelector('[data-provider="gemini"] .plan-badge')===null`), true, 'A missing policy result removes the previous Gemini plan badge');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-provider="gemini"] progress')].map(bar=>bar.value)`), [0, 42], 'Plan failure does not clear or change successful quota values');
  await evaluate(`{const s=window.__fixture.snapshots.gemini;s.collectedAt=s.checkedAt=Date.now();s.plan={label:'AI Ultra',checkedAt:s.collectedAt};for(const fn of window.__storageListeners)fn({},'local');}`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelector('[data-provider="gemini"] .plan-badge')?.textContent`) === 'AI Ultra') break; await pause(50); }
  assert.equal(await evaluate(`document.querySelector('[data-provider="gemini"] .plan-badge')?.textContent`), 'AI Ultra', 'A newly collected plan replaces the old label without duplicate badges');
  assert.equal(await evaluate(`document.querySelectorAll('.plan-badge').length`), 2);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("preferences").open=true;document.getElementById("strip-claude").checked=false;document.getElementById("settings-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__fixture.settings.strips.claude') === false) break; await pause(100); }
  assert.equal(await evaluate('window.__fixture.settings.strips.claude'), false);
  assert.equal(await evaluate('window.__fixture.settings.warning'), 70, 'Saving display preferences leaves internal threshold settings intact');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#strip-settings label")].map(node=>node.textContent)'), ['ChatGPT 입력창에 표시', 'Codex 입력창에 표시', 'Claude 입력창에 표시', 'Gemini 입력창에 표시']);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".card h2")].map(node=>node.textContent)'), ['ChatGPT', 'Claude', 'Gemini']);
  assert.equal(await evaluate('document.querySelectorAll(".card details,.card select,.card .time,#default-provider").length'), 0);
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Expanded settings overflow at ${width}px`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("preferences").open=false');
  await evaluate('document.getElementById("diagnostics").open=true;document.getElementById("diagnostics-show").click()');
  const diagnostics = await evaluate('JSON.parse(document.getElementById("diagnostics-output").value)');
  assert.equal(diagnostics.extensionVersion, buildLabel);
  assert.equal(diagnostics.providers.chatgpt.errorCode, null);
  assert.deepEqual(Object.keys(diagnostics.providers), ['chatgpt', 'claude', 'gemini']);
  assert.deepEqual(diagnostics.strips, { chatgpt: true, codex: true, claude: false, gemini: true });
  assert.deepEqual(Object.keys(diagnostics.providers.claude).sort(), ['enabled','permission','state','errorCode','checkedAt','collectedAt','nextAttemptAt'].sort());
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Diagnostics overflow at ${width}px`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("diagnostics").open=false');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  const screenshotPath = join(tmpdir(), 'ai-gauge-popup-fixture.png'); await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, session);
  const darkPopup = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-popup-dark-fixture.png'), Buffer.from(darkPopup.data, 'base64'));
  await cdp('Emulation.setEmulatedMedia', { features: [] }, session);
  await evaluate(`for(const p of ['chatgpt','claude','gemini']){window.__fixture.settings.enabled[p]=false;window.__fixture.permissions[p]=false;}for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`!document.getElementById('onboarding').hidden&&!document.getElementById('onboarding-submit').disabled`)) break; await pause(50); }
  assert(await evaluate(`!document.getElementById('onboarding').hidden&&document.getElementById('cards').hidden&&document.querySelectorAll('#provider-choices input:checked').length===3`), 'First run offers three native service checkboxes before showing cards');
  const onboardingScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-onboarding-fixture.png'), Buffer.from(onboardingScreenshot.data, 'base64'));
  await evaluate(`document.getElementById('choose-claude').click();document.getElementById('onboarding-submit').click();`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.getElementById('onboarding').hidden`)) break; await pause(50); }
  assert.deepEqual(await evaluate('window.__permissionRequests'), [['https://chatgpt.com/*', 'https://gemini.google.com/*']], 'Only selected host permissions are requested, in one prompt');
  assert.deepEqual(await evaluate('window.__fixture.settings.enabled'), { chatgpt: true, claude: false, gemini: true });
  assert(await evaluate(`document.getElementById('onboarding').hidden&&!document.getElementById('cards').hidden`), 'One permission grant enables the selected services and leaves first run');
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
  assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').href`), 'https://chatgpt.com/settings/usage?tab=overview', 'Codex uses the same ChatGPT ticket link');
  assert.equal(await evaluate('document.querySelector("textarea").value'), 'private synthetic prompt');
  await evaluate(content); assert.equal(await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'), 1);
  await evaluate(`history.replaceState(null,'','/');document.body.innerHTML='<main><section><div id="codex-root" class="layout ComposerLayoutRoot-XCKS7O" style="padding:12px;border:1px solid gray;border-radius:16px"><textarea style="min-height:48px">private Codex prompt</textarea><div id="codex-footer" class="ComposerLayoutFooter-_8IVRO" style="display:flex;align-items:center;gap:8px"><button type="button">Environment</button><button type="button">Send</button></div></div><p>Shortcut hints</p></section></main>';window.__codexFooterStyle=document.getElementById('codex-footer').getAttribute('style');window.__codexControls=[...document.querySelectorAll('#codex-footer button')];window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('codex-root');
  assert(await evaluate(`(()=>{const root=document.getElementById('codex-root'),footer=document.getElementById('codex-footer'),strip=document.getElementById('ai-gauge-usage-strip');return !root.contains(strip)&&footer.getAttribute('style')===window.__codexFooterStyle&&window.__codexControls.every((button,i)=>footer.children[i]===button)&&strip.getAttribute('aria-label').startsWith('사용량: 42%');})()`), 'Redirected Codex home places shared usage after the root without altering its footer controls or layout');
  await evaluate(`window.__rootStrip=document.getElementById('ai-gauge-usage-strip');document.getElementById('codex-root').className='layout ComposerLayoutRoot-newHash';document.getElementById('codex-footer').className='ComposerLayoutFooter-newHash';const hint=document.createElement('span');hint.id='late-footer-hint';hint.textContent='Shortcut';document.getElementById('codex-footer').append(hint);`);
  await pause(400);
  await waitForPlacement('codex-root');
  assert(await evaluate(`document.getElementById('codex-root').nextElementSibling===window.__rootStrip&&document.getElementById('codex-footer').lastElementChild.id==='late-footer-hint'&&document.getElementById('codex-footer').getAttribute('style')===window.__codexFooterStyle`), 'Dynamic class suffix and late footer controls preserve the same outside usage row without changing controls');
  const displayDiagnostic = await evaluate(`new Promise(resolve=>{for(const fn of window.__runtimeListeners)fn({type:'display-diagnostics'},{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve)})`);
  assert.equal(displayDiagnostic.provider, 'codex');
  assert.equal(displayDiagnostic.targetFound, true);
  assert.equal(displayDiagnostic.stripVisible, true);
  assert.equal(displayDiagnostic.stripCount, 1);
  assert.equal(await evaluate('location.pathname'), '/', 'Codex remains recognized after redirect to the site root');
  // A task view can replace the home composer while retaining the redirected URL.
  await evaluate(`document.body.innerHTML='<main style="display:flex;gap:12px"><section style="flex:1">Task result</section><aside style="width:330px;display:flex;flex-direction:column"><section><div id="task-root" class="ComposerLayoutRoot-taskHash" style="padding:12px;border:1px solid gray"><div contenteditable="true" style="min-height:48px">private follow-up prompt</div><div id="task-footer" class="ComposerLayoutFooter-taskHash" style="display:flex"><button>Attach</button><button>Send</button></div></div><p>Task footer</p></section></aside></main>';`);
  await waitForPlacement('task-root');
  assert(await evaluate(`!document.getElementById('task-root').contains(document.getElementById('ai-gauge-usage-strip'))&&document.querySelector('[contenteditable]').textContent==='private follow-up prompt'&&document.querySelectorAll('#task-footer button').length===2`), 'Redirected Codex task uses its replacement root while preserving the prompt and controls');
  await evaluate(`history.replaceState(null,'','/codex/tasks/fixture');window.dispatchEvent(new PopStateEvent('popstate'));`);
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
  await evaluate(`document.body.innerHTML='<main style="display:flex;gap:12px"><section style="flex:1;min-width:0">Task result</section><aside style="width:330px;display:flex;flex-direction:column"><section><div id="follow-up" class="ComposerLayoutRoot-followUp" style="padding:12px;border:1px solid gray"><div><div contenteditable="plaintext-only" style="min-height:32px">private follow-up prompt</div></div><div role="toolbar"><button>Attach</button><button aria-label="Send follow-up">Send</button></div></div><p>Task footer</p></section></aside><textarea style="position:fixed;left:-10000px;width:0;height:0;opacity:0"></textarea></main>';`);
  await waitForPlacement('follow-up');
  await evaluate(`window.__stableCodexStrip=document.getElementById('ai-gauge-usage-strip');window.__stableCodexMoves=0;window.__stabilityObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===window.__stableCodexStrip)window.__stableCodexMoves++;});window.__stabilityObserver.observe(document,{childList:true,subtree:true});`);
  for (let i = 0; i < 20; i++) {
    await evaluate(`document.getElementById('follow-up').className='ComposerLayoutRoot-render${i % 2}';${i === 10 ? "{const old=document.getElementById('follow-up');old.replaceWith(old.cloneNode(true));}" : ''}`);
    await pause(80);
    await waitForPlacement('follow-up');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__stableCodexStrip && document.querySelectorAll('#ai-gauge-usage-strip').length===1`), 'Codex follow-up strip stays mounted during task re-renders');
  }
  assert.equal(await evaluate('window.__stableCodexMoves'), 0);
  await evaluate('window.__stabilityObserver.disconnect()');
  await evaluate(`window.__fixtureHost='https://claude.ai';history.replaceState(null,'','/new');document.body.innerHTML='<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><div id="claude-slot"><div id="visual-box" style="padding:12px;border:1px solid gray"><div style="display:flex;flex-direction:column;gap:12px"><div class="ProseMirror" contenteditable="true">private Claude prompt</div><div id="toolbar"><button>Attach</button><button>Send</button></div></div></div></div></div><p>Disclaimer</p></main>';window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('visual-box');
  assert.equal(await evaluate('document.querySelector(".ProseMirror").textContent'), 'private Claude prompt');
  assert.equal(await evaluate('document.querySelectorAll("#toolbar button").length'), 2);
  for (const containsEditor of [true, false]) {
    const editor = '<div id="claude-inner" class="relative w-full min-w-0" style="min-width:0;width:100%;position:relative"><div contenteditable="true" class="ProseMirror" style="min-height:48px">private Claude prompt</div></div>';
    await evaluate(`history.replaceState(null,'',${JSON.stringify(containsEditor ? '/new' : '/chat/fixture')});document.body.innerHTML=${JSON.stringify(`<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><form><div id="claude-surface" class="bg-surface-3" style="padding:12px;background:#e7ebef;border-radius:16px">${containsEditor ? '' : editor}<div id="claude-chin" data-cds="ChatComposerChin" style="padding:8px;background:#d4dbe3;border-radius:12px">${containsEditor ? editor : ''}<div id="claude-toolbar" role="toolbar"><button type="button">Attach</button><button type="button">Send</button></div></div></div></form></div></main>`)};window.__claudeControls=[...document.querySelectorAll('#claude-toolbar button')];window.__claudeChinStyle=document.getElementById('claude-chin').getAttribute('style');window.dispatchEvent(new PopStateEvent('popstate'));`);
    await waitForPlacement('claude-chin');
    assert(await evaluate(`(()=>{const chin=document.getElementById('claude-chin'),host=document.getElementById('ai-gauge-usage-strip'),toolbar=document.getElementById('claude-toolbar');return !chin.contains(host)&&!document.getElementById('claude-inner').contains(host)&&chin.getAttribute('style')===window.__claudeChinStyle&&window.__claudeControls.every((button,i)=>toolbar.children[i]===button);})()`), 'Claude strip follows ChatComposerChin for containing and sibling editors without changing the toolbar');
    assert.equal(await evaluate('document.querySelector(".ProseMirror").textContent'), 'private Claude prompt');
    assert.equal(await evaluate('document.querySelectorAll("#claude-toolbar button").length'), 2);
    await evaluate(`window.__stableClaudeStrip=document.getElementById('ai-gauge-usage-strip');window.__stableClaudeMoves=0;window.__claudeObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===window.__stableClaudeStrip)window.__stableClaudeMoves++;});window.__claudeObserver.observe(document,{childList:true,subtree:true});`);
    for (let i = 0; i < 6; i++) {
      await evaluate(`document.getElementById('claude-chin').className='render-${i % 2}';${i === 3 ? "{const old=document.getElementById('claude-chin');old.replaceWith(old.cloneNode(true));}" : ''}`);
      await pause(100);
      await waitForPlacement('claude-chin');
      assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__stableClaudeStrip`), 'Claude keeps the same outside strip when its Chin is re-rendered or replaced');
    }
    assert.equal(await evaluate('window.__stableClaudeMoves'), 0);
    await evaluate('window.__claudeObserver.disconnect()');
  }
  // Storage and worker invalidation must update the existing Claude bar, even
  // for a fraction that leaves the rounded percentage label unchanged.
  await evaluate(`window.__claudeProgress=window.__fixtureUsageRoot.querySelector('progress');window.__fixture.snapshots.claude={...window.__fixture.snapshots.claude,state:'ok',collectedAt:Date.now(),checkedAt:Date.now(),nextAttemptAt:0,errorCode:null,failures:0,limits:[{...window.__fixture.snapshots.claude.limits[0],percent:17,resetsAt:new Date(Date.now()+7200000).toISOString()}]};for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) {
    if (await evaluate(`!window.__claudeProgress.hidden&&window.__claudeProgress.value===17`)) break;
    await pause(50);
  }
  assert(await evaluate(`!window.__claudeProgress.hidden&&window.__claudeProgress.value===17&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 17%')`), 'Claude successful collection updates its previously cached usage');
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
  // Cache age alone is a collection schedule, not evidence that the value is
  // wrong. A reset or repeated/hard collection failure does change reliability.
  await evaluate(`window.__fixture.snapshots.claude.collectedAt=Date.now()-15*60_000;for(const fn of window.__storageListeners)fn({},'local');`);
  await pause(400);
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&!window.__claudeProgress.hidden&&window.__claudeProgress.value===63&&window.__fixtureUsageRoot.querySelector('.status').hidden&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 63%')`), 'A normal cache older than ten minutes keeps the same visible progress node without a warning');
  await evaluate(`window.__fixture.snapshots.claude.state='error';window.__fixture.snapshots.claude.errorCode='network';window.__fixture.snapshots.claude.failures=1;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  await pause(400);
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&!window.__claudeProgress.hidden&&window.__claudeProgress.value===63&&window.__fixtureUsageRoot.querySelector('.status').hidden`), 'One temporary network failure retains the same reliable cached progress');
  await evaluate(`window.__fixture.snapshots.claude.failures=2;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__claudeProgress.hidden')) break; await pause(50); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.hidden&&!window.__claudeProgress.hasAttribute('value')&&!window.__fixtureUsageRoot.querySelector('.status').hidden&&!/사용량: (63|0)%/.test(document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label'))`), 'Repeated collection failures clear the numeric value without replacing its progress node or inventing zero usage');
  await evaluate(`window.__fixture.snapshots.claude.state='ok';window.__fixture.snapshots.claude.errorCode=null;window.__fixture.snapshots.claude.failures=0;window.__fixture.snapshots.claude.limits[0].resetsAt=new Date(Date.now()+1000).toISOString();for(const grant of window.__fixture.snapshots.claude.tickets.inventory.grants)grant.expiresAt=new Date(Date.now()+1000).toISOString();for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate('!window.__claudeProgress.hidden')) break; await pause(25); }
  assert(await evaluate(`!window.__claudeProgress.hidden&&window.__claudeProgress.value===63`), 'A reliable result restores the existing progress before its reset');
  await evaluate(`window.__fixtureBeforeResetSend=chrome.runtime.sendMessage;window.__resetDisplayRequests=0;chrome.runtime.sendMessage=async message=>{window.__resetDisplayRequests++;return window.__fixtureBeforeResetSend(message)};`);
  // Exercise the real display timer without a DOM mutation, worker message or
  // clock substitution; a render tick must not turn into another API request.
  for (let i = 0; i < 170; i++) { if (await evaluate('window.__claudeProgress.hidden')) break; await pause(100); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.hidden&&!window.__claudeProgress.hasAttribute('value')&&window.__fixtureUsageRoot.querySelector('.status').textContent==='초기화 후 확인 중'&&!/사용량: (63|0)%/.test(document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label'))`), 'The display timer clears usage after reset without an incoming event, replacing the node, or guessing zero');
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').hidden&&!window.__fixtureUsageRoot.querySelector('.tickets').hasAttribute('href')`), 'The existing local clock also removes expired ticket links without an API request');
  assert.equal(await evaluate('window.__resetDisplayRequests'), 0, 'Time-only display updates do not request another view or API refresh');
  await evaluate('chrome.runtime.sendMessage=window.__fixtureBeforeResetSend');
  await evaluate(`window.__fixture.snapshots.claude.state='signed_out';window.__fixture.snapshots.claude.errorCode='signed_out';window.__fixture.snapshots.claude.failures=1;window.__fixture.snapshots.claude.limits[0].resetsAt=new Date(Date.now()+7200000).toISOString();for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  await pause(400);
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.hidden&&!window.__claudeProgress.hasAttribute('value')&&!window.__fixtureUsageRoot.querySelector('.status').hidden`), 'Authentication failure invalidates cached usage immediately without replacing the strip');
  await evaluate(`window.__fixtureHost='https://chatgpt.com';`);
  await evaluate(`history.replaceState(null,'','/');document.body.innerHTML='<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><div id="chatgpt-slot"><form id="chatgpt-home"><div id="chatgpt-body" class="layout ComposerLayoutBody-uBBf1A" style="padding:12px;border:1px solid gray;border-radius:16px"><div id="prompt-textarea" contenteditable="true" style="min-height:48px">private ChatGPT prompt</div><button>Send</button></div></form><p id="chatgpt-helper" hidden>Shortcut hints</p></div></div></main>';window.__chatgptControls=[...document.querySelectorAll('#chatgpt-body button')];window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('chatgpt-body');
  assert(await evaluate(`!document.getElementById('chatgpt-body').contains(document.getElementById('ai-gauge-usage-strip'))&&document.getElementById('prompt-textarea').textContent==='private ChatGPT prompt'&&window.__chatgptControls.every(button=>button.isConnected)`), 'ChatGPT home strip is the immediate sibling after ComposerLayoutBody, outside the input surface');
  let ordinary;
  for (let i = 0; i < 20; i++) { ordinary = await evaluate('document.querySelector("#ai-gauge-usage-strip")?.getAttribute("aria-label")??""'); if (ordinary.includes('사용량: 42%')) break; await pause(100); }
  assert.match(ordinary, /^사용량: 42%  🕒 사용량 초기화: \d{1,2}\/\d{1,2}\([일월화수목금토]\) \d{2}:\d{2}, \d+h 남음$/); assert.doesNotMatch(ordinary, /0d|Chat|Work|Codex|공유|모델별|AI Gauge/);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,link=root.querySelector('.tickets'),reset=root.querySelector('.reset'),host=document.getElementById('ai-gauge-usage-strip');return !link.hidden&&getComputedStyle(link).display!=='none'&&link.getBoundingClientRect().left>reset.getBoundingClientRect().right&&link.getBoundingClientRect().right<=host.getBoundingClientRect().right&&host.getBoundingClientRect().height===30&&root.querySelector('.brand-icon').getBoundingClientRect().width===20&&getComputedStyle(link).fontSize==='12px';})()`), 'Wide composer adds the ticket link without changing usage, reset, icon, 12px text or 30px strip geometry');
  const ticketStripScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-tickets-strip-fixture.png'), Buffer.from(ticketStripScreenshot.data, 'base64'));
  await evaluate(`{const link=window.__fixtureUsageRoot.querySelector('.tickets');link.addEventListener('click',event=>{event.preventDefault();window.__ticketActivated=link.href;},{once:true});link.focus();}`);
  assert(await evaluate(`window.__fixtureUsageRoot.activeElement===window.__fixtureUsageRoot.querySelector('.tickets')`), 'Ticket link accepts keyboard focus inside the closed shadow component');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  assert.equal(await evaluate('window.__ticketActivated'), 'https://chatgpt.com/settings/usage?tab=overview', 'Keyboard activation resolves to the fixed official usage page (navigation prevented in fixture)');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`getComputedStyle(window.__fixtureUsageRoot.querySelector('.tickets')).display==='none'&&getComputedStyle(window.__fixtureUsageRoot.querySelector('.reset')).display!=='none'`), 'Tickets hide before reset details when the composer narrows');
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
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,host=document.getElementById('ai-gauge-usage-strip');return getComputedStyle(root.querySelector('.reset')).display==='none'&&host.getBoundingClientRect().height===30&&root.querySelector('.usage').getBoundingClientRect().height===30&&document.documentElement.scrollWidth<=document.documentElement.clientWidth;})()`), 'Small composer hides reset details and preserves its 30px height without horizontal overflow');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate(`window.__stableChatGPTStrip=document.getElementById('ai-gauge-usage-strip');window.__stableChatGPTMoves=0;window.__chatgptObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===window.__stableChatGPTStrip)window.__stableChatGPTMoves++;});window.__chatgptObserver.observe(document,{childList:true,subtree:true});window.__fixtureSend=chrome.runtime.sendMessage;window.__fixtureRejectNext=true;chrome.runtime.sendMessage=async message=>{if(window.__fixtureRejectNext){window.__fixtureRejectNext=false;throw new Error('temporary worker restart');}return window.__fixtureSend(message)};for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) {
    await evaluate(`document.getElementById('chatgpt-body').className='ComposerLayoutBody-render${i % 2}';document.getElementById('chatgpt-helper').hidden=${i % 2 === 0};${i === 10 ? "history.replaceState(null,'','/c/fixture');{const old=document.getElementById('chatgpt-body');old.replaceWith(old.cloneNode(true));}window.dispatchEvent(new PopStateEvent('popstate'));" : ''}`);
    await pause(350);
    await waitForPlacement('chatgpt-body');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__stableChatGPTStrip && window.__aiGaugeMounted===true`), 'Plan usage stays outside home/chat composers through hash and anchor changes, worker failures and helper changes');
  }
  assert.equal(await evaluate('window.__stableChatGPTMoves'), 0);
  await evaluate('window.__chatgptObserver.disconnect()');
  await evaluate(`window.__fixture.permissions.chatgpt=false;chrome.runtime.sendMessage=async()=>({ok:false});for(const fn of window.__runtimeListeners)fn({type:'permissions-revoked',origins:['https://chatgpt.com/*']},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length') === 0) break; await pause(100); }
  assert.equal(await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'), 0);
  assert.equal(await evaluate('window.__aiGaugeMounted'), false);

  // Gemini uses its own snapshot through the same content bundle. This DOM is
  // synthetic and does not validate the current authenticated service layout.
  await evaluate(`chrome.runtime.sendMessage=window.__fixtureSend;window.__fixtureHost='https://gemini.google.com';history.replaceState(null,'','/app');document.body.innerHTML='<main><div id="gemini-slot"><input-area-v2 id="gemini-composer" style="display:block;padding:12px;border:1px solid gray;border-radius:16px"><rich-textarea style="display:block"><div role="textbox" class="ql-editor textarea" contenteditable="true" style="min-height:48px">private Gemini prompt</div></rich-textarea><div id="gemini-toolbar" role="toolbar"><button type="button">Attach</button><button type="button" aria-label="Send message">Send</button></div></input-area-v2><p id="gemini-helper" hidden>Shortcut hints</p></div></main>';`);
  await evaluate(content);
  await waitForPlacement('gemini-composer');
  await evaluate(`window.__geminiStrip=document.getElementById('ai-gauge-usage-strip');window.__geminiProgress=window.__fixtureUsageRoot.querySelector('progress');`);
  await evaluate(content);
  assert(await evaluate(`document.querySelectorAll('#ai-gauge-usage-strip').length===1&&window.__geminiProgress.value===42&&document.querySelector('rich-textarea [contenteditable]').textContent==='private Gemini prompt'&&document.querySelectorAll('#gemini-toolbar button').length===2`), 'Gemini reuses one strip and highest reported limit without changing its input or controls');
  const geminiDiagnostic = await evaluate(`new Promise(resolve=>{for(const fn of window.__runtimeListeners)fn({type:'display-diagnostics'},{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve)})`);
  assert.equal(geminiDiagnostic.provider, 'gemini'); assert.equal(geminiDiagnostic.targetFound, true);
  assert.equal(geminiDiagnostic.stripVisible, true); assert.equal(geminiDiagnostic.stripCount, 1);
  for (let i = 0; i < 12; i++) {
    await evaluate(`document.getElementById('gemini-helper').hidden=${i % 2 === 0};document.getElementById('gemini-composer').className='render-${i % 2}';`);
    await pause(350);
    await waitForPlacement('gemini-composer');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__geminiStrip&&window.__fixtureUsageRoot.querySelector('progress')===window.__geminiProgress`), 'Gemini helper changes retain the same strip and progress node');
  }
  await evaluate(`window.__fixture.snapshots.gemini.limits.find(limit=>limit.id==='gemini:2').percent=42.25;window.__fixture.snapshots.gemini.collectedAt=Date.now();for(const fn of window.__storageListeners)fn({},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__geminiProgress.value===42.25')) break; await pause(50); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__geminiProgress&&window.__geminiProgress.value===42.25&&window.__geminiStrip.getAttribute('aria-label').includes('사용량: 42%')`), 'Gemini fractional usage changes update the existing bar even with unchanged rounded text');
  await evaluate(`window.__fixture.snapshots.gemini.limits.find(limit=>limit.id==='gemini:2').percent=63;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__geminiProgress.value===63')) break; await pause(50); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__geminiProgress&&window.__geminiProgress.value===63&&window.__geminiStrip.getAttribute('aria-label').includes('사용량: 63%')`), 'Gemini runtime invalidation updates its own visible usage');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`window.__geminiStrip.getBoundingClientRect().height===30&&getComputedStyle(window.__fixtureUsageRoot.querySelector('.reset')).display==='none'&&document.documentElement.scrollWidth<=document.documentElement.clientWidth`), 'Narrow Gemini strip retains the shared 30px height without overflow');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  const geminiScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-gemini-strip-fixture.png'), Buffer.from(geminiScreenshot.data, 'base64'));
  await evaluate(`window.__fixture.snapshots.gemini.state='error';window.__fixture.snapshots.gemini.errorCode='network';window.__fixture.snapshots.gemini.failures=2;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__geminiProgress.hidden')) break; await pause(50); }
  assert(await evaluate(`window.__geminiProgress.hidden&&window.__geminiStrip.getAttribute('aria-label').includes('확인 불가')&&!window.__geminiStrip.getAttribute('aria-label').includes('사용량: 0%')`), 'Gemini collection errors do not fabricate an unused quota');
  await evaluate(`window.__fixture.permissions.gemini=false;chrome.runtime.sendMessage=async()=>({ok:false});for(const fn of window.__runtimeListeners)fn({type:'permissions-revoked',origins:['https://gemini.google.com/*']},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length') === 0) break; await pause(50); }
  assert.equal(await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'), 0);
  assert.equal(await evaluate('window.__aiGaugeMounted'), false);
  assert.equal(await evaluate(`document.querySelector('rich-textarea [contenteditable]').textContent`), 'private Gemini prompt');
  assert.deepEqual(exceptions, []);
  console.log(`PASS Chromium fixture UI: compact three-card 600px popup with first-run checkbox selection / one permission request and six-window/four-ticket height ${compactHeight}px, Gemini windows and compact known plan badges with unknown plans hidden, plan replacement and failed-plan usage preservation, ChatGPT/Claude ticket counts and official native links, shared ChatGPT/Codex tickets, ticket-first responsive hiding, keyboard link activation and actual local-timer expiry without requests, four display settings, build-minute display version, narrow overflow and fixed 30px strip checks, outside siblings after ChatGPT ComposerLayoutBody / Codex ComposerLayoutRoot / Claude ChatComposerChin, redirected Codex home/task and diagnostics, changing class suffixes and replaced anchors, preserved input/toolbar layout, countdown without 0d, shared ChatGPT/Codex usage, unchanged Gemini input-area-v2 placement, storage/runtime progress updates without replacing bars, valid cached usage past ten minutes and one temporary failure, reset/repeated/auth failure numeric clearing, stable strips over 76 timed checks, transient worker failure recovery, and OpenAI/Gemini denied-view revocation cleanup. Screenshots: ${screenshotPath}, ${join(tmpdir(), 'ai-gauge-tickets-strip-fixture.png')}. Synthetic DOM/Chrome APIs; no live installation/account verification.`);
} finally {
  ws?.close(); child.kill('SIGTERM');
  await new Promise(r => { if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 3000).unref(); } });
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); await new Promise(r => server.close(r));
}
