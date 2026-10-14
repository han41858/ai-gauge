import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const profile = await mkdtemp(join(tmpdir(), 'ai-gauge-browser-'));
const extension = resolve('dist');
const child = spawn(process.env.CHROME_BIN || '/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--host-resolver-rules=MAP * ~NOTFOUND', '--remote-debugging-port=0', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = ''; child.stderr.on('data', b => { stderr += b; });
const pause = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let endpoint;
  for (let i = 0; i < 100; i++) {
    try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); endpoint = `ws://127.0.0.1:${port}${path}`; break; } catch {}
    if (child.exitCode !== null) throw new Error(`Chromium exited ${child.exitCode}: ${stderr.slice(-3000)}`);
    await pause(100);
  }
  assert(endpoint, 'Chromium debugging endpoint did not start');
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const pending = new Map(); const exceptions = [];
  ws.addEventListener('message', e => {
    const data = JSON.parse(String(e.data));
    if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text);
    const p = pending.get(data.id);
    if (p) { pending.delete(data.id); clearTimeout(p.timer); if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result); }
  });
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const targets = async () => (await cdp('Target.getTargets')).targetInfos;
  // New Chromium versions restrict command-line loading; use the supported debugging command.
  const installed = await cdp('Extensions.loadUnpacked', { path: extension });
  let worker;
  for (let i = 0; i < 100; i++) { worker = (await targets()).find(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')); if (worker) break; await pause(100); }
  assert(worker, `Extension worker missing: ${stderr.slice(-2000)}`);
  const extensionId = new URL(worker.url).hostname;
  assert.equal(extensionId, installed.id);
  const attach = async id => (await cdp('Target.attachToTarget', { targetId: id, flatten: true })).sessionId;
  const session = await attach(worker.targetId); await cdp('Runtime.enable', {}, session);
  const evaluate = async (expression, sessionId = session) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    assert(!r.exceptionDetails, `Browser evaluation threw: ${JSON.stringify(r.exceptionDetails)}`); return r.result.value;
  };
  let ready;
  for (let i = 0; i < 50; i++) { ready = await evaluate('(async()=>({alarms:await chrome.alarms.getAll(),stored:await chrome.storage.local.get("settings")}))()'); if (ready.alarms.length && ready.stored.settings) break; await pause(100); }
  assert.equal(ready.alarms[0].periodInMinutes, 10); assert.equal(ready.stored.settings.enabled.chatgpt, false);
  const manifest = await evaluate('chrome.runtime.getManifest()');
  assert.equal(manifest.manifest_version, 3); assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'scripting']); assert.equal(manifest.optional_host_permissions.length, 2);
  const { targetId } = await cdp('Target.createTarget', { url: `chrome-extension://${extensionId}/popup.html` });
  const popup = await attach(targetId); await cdp('Runtime.enable', {}, popup);
  let state;
  for (let i = 0; i < 100; i++) { state = await evaluate('({cards:document.querySelectorAll(".card").length,text:document.body?.textContent??"",feedback:document.getElementById("feedback")?.textContent})', popup); if (state.cards === 2) break; await pause(100); }
  assert.equal(state.cards, 2); assert.match(state.text, /Claude/); assert.doesNotMatch(state.text, /Gemini|입력창에는|최근 수집 성공|Work \/ Codex 공유/); assert.doesNotMatch(state.feedback, /통신할 수 없습니다/);
  const contract = await evaluate('(async()=>({bad:await chrome.runtime.sendMessage({type:"fetch",url:"https://invalid"}),good:await chrome.runtime.sendMessage({type:"view"})}))()', popup);
  assert.equal(contract.bad.ok, false); assert.equal(contract.good.ok, true); assert.equal(contract.good.view.permissions.claude, false);
  const settings = await evaluate('(async()=>{const r=await chrome.runtime.sendMessage({type:"view"});r.view.settings.followTab=true;r.view.settings.warning=65;r.view.settings.danger=85;return chrome.runtime.sendMessage({type:"settings",settings:r.view.settings})})()', popup);
  assert.equal(settings.ok, true); assert.equal(settings.view.settings.warning, 65);
  const badge = await evaluate('(async()=>({text:await chrome.action.getBadgeText({}),title:await chrome.action.getTitle({})}))()');
  assert.equal(badge.text, '—'); assert.match(badge.title, /비활성/);
  // Stop only this test's worker and ask the popup to wake a replacement. State must survive.
  await cdp('Target.closeTarget', { targetId: worker.targetId });
  const restored = await evaluate('(async()=>{const r=await chrome.runtime.sendMessage({type:"view"});return {ok:r.ok,warning:r.view.settings.warning,followTab:r.view.settings.followTab}})()', popup);
  assert.deepEqual(restored, { ok: true, warning: 65, followTab: true });
  assert.deepEqual(exceptions, []);
  console.log('PASS Chromium unpacked MV3: worker, 10-minute alarm, compact two-card popup, denied permissions, message contract, settings, badge, worker restart. No provider account requests performed.');
} finally {
  ws?.close(); child.kill('SIGTERM');
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref(); } });
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
