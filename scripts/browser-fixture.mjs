import assert from 'node:assert/strict';
import { createFixture } from './browser-fixture/fixture-data.mjs';
import { runPopupChecks } from './browser-fixture/popup-checks.mjs';
import { runCodexChecks } from './browser-fixture/codex-checks.mjs';
import { runClaudeChecks } from './browser-fixture/claude-checks.mjs';
import { runChatGPTChecks } from './browser-fixture/chatgpt-checks.mjs';
import { runGeminiChecks } from './browser-fixture/gemini-checks.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  const fixture = createFixture();
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__fixture=${JSON.stringify(fixture)};window.__runtimeListeners=[];window.__storageListeners=[];window.chrome={runtime:{id:'fixture',getManifest:()=>(${JSON.stringify(builtManifest)}),sendMessage:async m=>{if(m.type==='settings')window.__fixture.settings=m.settings;if(m.type==='strips')window.__fixture.settings.strips=m.strips;if(m.type==='display-settings'){(window.__displaySettingsRequests??=[]).push(m);window.__fixture.settings.strips=m.strips;window.__fixture.settings.warning=m.warning;window.__fixture.settings.danger=m.danger;}if(m.type==='disable')window.__fixture.settings.enabled[m.provider]=false;if(m.type==='enable')window.__fixture.settings.enabled[m.provider]=true;if(m.type==='enable-many')for(const p of m.providers)window.__fixture.settings.enabled[p]=true;return {ok:true,view:structuredClone(window.__fixture)}},onMessage:{addListener(f){window.__runtimeListeners.push(f)},removeListener(f){window.__runtimeListeners=window.__runtimeListeners.filter(x=>x!==f)}}},storage:{onChanged:{addListener(f){window.__storageListeners.push(f)},removeListener(f){window.__storageListeners=window.__storageListeners.filter(x=>x!==f)}}},permissions:{request:async({origins})=>{(window.__permissionRequests??=[]).push(origins);for(const [p,origin] of Object.entries({chatgpt:'https://chatgpt.com/*',claude:'https://claude.ai/*',gemini:'https://gemini.google.com/*'}))if(origins.includes(origin))window.__fixture.permissions[p]=true;return true;},remove:async()=>true}};` }, session);
  await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Seoul' }, session);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  const context = { cdp, session, evaluate, pause, waitForPlacement, content: '', port, buildLabel, exceptions };
  const { compactHeight, screenshotPath } = await runPopupChecks(context);
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
  context.content = content;
  await runCodexChecks(context);
  await runClaudeChecks(context);
  await runChatGPTChecks(context);
  await runGeminiChecks(context);
  assert.deepEqual(exceptions, []);
  console.log(`PASS Chromium fixture UI: compact three-card 600px popup with first-run checkbox selection / one permission request and six-window/four-ticket height ${compactHeight}px, Gemini windows and compact known plan badges with unknown plans hidden, plan replacement and failed-plan usage preservation, unchanged popup ticket counts/dates and official native links, shared ChatGPT/Codex earliest-ticket countdown without quantities/dates, ticket-first responsive hiding, keyboard link activation and actual local-timer rollover without requests, failed/fully expired tickets hidden and no Gemini tickets, four display settings, build-minute display version, narrow overflow and fixed 30px strip checks, outside siblings after ChatGPT ComposerLayoutBody / Codex ComposerLayoutRoot / Claude ChatComposerChin, redirected Codex home/task and diagnostics, changing class suffixes and replaced anchors, preserved input/toolbar layout, largest-unit Korean countdown, shared ChatGPT/Codex usage, unchanged Gemini input-area-v2 placement, storage/runtime progress updates without replacing bars, valid cached usage past ten minutes and one temporary failure, reset/repeated/auth failure numeric clearing, stable strips over 76 timed checks, transient worker failure recovery, and OpenAI/Gemini denied-view revocation cleanup. Screenshots: ${screenshotPath}, ${join(tmpdir(), 'ai-gauge-tickets-strip-fixture.png')}. Synthetic DOM/Chrome APIs; no live installation/account verification.`);
} finally {
  ws?.close(); child.kill('SIGTERM');
  await new Promise(r => { if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 3000).unref(); } });
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); await new Promise(r => server.close(r));
}
