import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseMessage, authorized, isReply } from '../src/shared/contracts';
import { defaults, parseSettings } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import { badge } from '../src/background/badge';
import { parseClaude } from '../src/providers/parsers';
import { success } from '../src/background/scheduler';
import { providerFromUrl, type View } from '../src/shared/types';
import { UsageStrip } from '../src/content/usage-strip';
import { renderCards } from '../src/popup/render';
const view = (): View => ({ settings: defaults(), permissions: { chatgpt: true, claude: true, gemini: true }, snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') } });
test('settings default to opt-in and sanitize invalid thresholds and providers', () => { const s = parseSettings({ warning: 90, danger: 70, defaultProvider: 'invalid', enabled: { claude: 'yes' } }) as unknown; assert.deepEqual(s, defaults()); });
test('message contracts reject malformed payloads, unexpected keys and invalid settings', () => { assert(parseMessage({ type: 'view' })); for (const v of [{ type: 'fetch', url: 'evil' }, { type: 'view', url: 'evil' }, { type: 'refresh', provider: 'claude', trigger: 'force' }, { type: 'settings', settings: {} }, { type: 'strips', strips: defaults().strips }]) assert.equal(parseMessage(v), null); });
test('sender validation blocks spoofed origin, frame, cross-site/manual refresh and settings from content', () => {
  const sender = { id: 'ext', frameId: 0, url: 'https://claude.ai/new', tab: { id: 1, url: 'https://claude.ai/new' } } as chrome.runtime.MessageSender;
  assert(authorized({ type: 'refresh', provider: 'claude', trigger: 'event' }, sender, 'ext'));
  assert(!authorized({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, sender, 'ext'));
  assert(!authorized({ type: 'refresh', provider: 'claude', trigger: 'manual' }, sender, 'ext'));
  assert(!authorized({ type: 'display-settings', strips: defaults().strips, warning: 70, danger: 90 }, sender, 'ext'));
  assert(!authorized({ type: 'read' }, sender, 'ext'));
  assert(!authorized({ type: 'view' }, { ...sender, frameId: 1 }, 'ext'));
  assert(!authorized({ type: 'view' }, { ...sender, id: 'other' }, 'ext'));
  assert(!authorized({ type: 'view' }, { ...sender, url: 'https://claude.ai.evil/new' }, 'ext'));
  assert(authorized({ type: 'display-settings', strips: defaults().strips, warning: 70, danger: 90 }, { id: 'ext', url: 'chrome-extension://ext/popup.html' }, 'ext'));
  assert(authorized({ type: 'read' }, { id: 'ext', url: 'chrome-extension://ext/popup.html' }, 'ext'));
});
test('ordinary ChatGPT content may refresh the shared display pool without gaining manual or cross-site access', () => {
  const ordinary = { id: 'ext', frameId: 0, url: 'https://chatgpt.com/c/synthetic', tab: { id: 1, url: 'https://chatgpt.com/c/synthetic' } } as chrome.runtime.MessageSender;
  assert(authorized({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, ordinary, 'ext'));
  assert(!authorized({ type: 'refresh', provider: 'chatgpt', trigger: 'manual' }, ordinary, 'ext'));
  assert(!authorized({ type: 'refresh', provider: 'claude', trigger: 'event' }, ordinary, 'ext'));
  assert(!authorized({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, { ...ordinary, frameId: 1 }, 'ext'));
  assert(!authorized({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, { ...ordinary, id: 'other' }, 'ext'));
  const codex = { ...ordinary, url: 'https://chatgpt.com/codex', tab: { id: 1, url: 'https://chatgpt.com/codex' } } as chrome.runtime.MessageSender;
  assert(authorized({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, codex, 'ext'));
  assert(!authorized({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, { ...ordinary, tab: codex.tab! }, 'ext'));
});
test('worker reply is validated before use', () => { assert(isReply({ ok: true, view: view() })); assert(!isReply({ ok: true, view: {} })); assert(!isReply({ ok: false })); });
test('worker replies accept equivalent field order while rejecting unknown snapshot data', () => {
  const v = view();
  v.snapshots.gemini = success(emptySnapshot('gemini'), [{ percent: 0, id: 'short', label: '5시간',
    category: 'window', source: 'api', remaining: 600, unit: null, resetsAt: null, windowSeconds: 18000 }], 1000);
  assert(isReply({ ok: true, view: v }));
  Object.assign(v.snapshots.gemini.limits[0]!, { token: 'should-not-pass' });
  assert(!isReply({ ok: true, view: v }));
});
test('service detection only accepts exact HTTPS origins', () => { assert.equal(providerFromUrl('https://chatgpt.com/new'), 'chatgpt'); assert.equal(providerFromUrl('http://chatgpt.com'), null); assert.equal(providerFromUrl('https://chatgpt.com.evil'), null); });
test('badge shows zero as zero and clears on unrelated tabs without borrowing another service', () => {
  const v = view(); v.settings.enabled.claude = true; v.snapshots.claude = success(emptySnapshot('claude'), parseClaude({ five_hour: { utilization: 0 } }), 1000);
  assert.equal(badge(v, 'https://claude.ai/', 1001).text, '0%');
  for (const used of [0, 70, 90, 100]) {
    v.snapshots.claude.limits[0]!.percent = used;
    assert.equal(badge(v, 'https://claude.ai/', 1001).color, '#B16046');
    assert.equal(badge(v, 'https://claude.ai/', 1001).textColor, '#FFFFFF');
  }
  assert.equal(badge(v, 'https://chatgpt.com', 1001).text, '—'); assert.equal(badge(v, 'https://unrelated.invalid', 1001).text, '');
});
test('badge keeps valid cached usage by age while suppressing failed or denied data', () => {
  const v = view(); v.settings.enabled.claude = true; v.snapshots.claude = success(emptySnapshot('claude'), parseClaude({ five_hour: { utilization: 55 } }), 1000);
  assert.equal(badge(v, 'https://claude.ai/', 601000).text, '55%'); v.snapshots.claude.state = 'error'; assert.equal(badge(v, 'https://claude.ai/', 1001).text, '—');
  v.snapshots.claude.state = 'ok'; v.permissions.claude = false; assert.equal(badge(v, 'https://claude.ai/', 1001).text, '—');
});
test('site badge uses the actual reported weekly limit without inventing a five-hour quota', () => { const v = view(); v.settings.enabled.claude = true; v.snapshots.claude = success(emptySnapshot('claude'), parseClaude({ seven_day: { utilization: 50 } }), 1000); assert.equal(badge(v, 'https://claude.ai/', 1001).text, '50%'); });
test('usage strip mounts once below form, preserves input, handles SPA recreation and cleanup', () => {
  const d = new JSDOM('<main><form><div role="textbox" contenteditable="true">private prompt</div><button>Send</button></form></main>').window.document;
  const v = view(); v.settings.enabled.claude = true; const strip = new UsageStrip('claude', d); strip.update(v); strip.mount();
  assert.equal(d.querySelectorAll('#ai-gauge-usage-strip').length, 1); assert.equal(d.querySelector('form')?.nextElementSibling?.id, 'ai-gauge-usage-strip'); assert.equal(d.querySelector('[contenteditable]')?.textContent, 'private prompt');
  d.querySelector('form')!.remove(); strip.mount(); assert.equal(d.querySelector('#ai-gauge-usage-strip'), null);
  const form = d.createElement('form'); const input = d.createElement('div'); input.setAttribute('contenteditable', 'true'); input.setAttribute('role', 'textbox'); form.append(input); d.querySelector('main')!.append(form); strip.mount(); assert.equal(d.querySelectorAll('#ai-gauge-usage-strip').length, 1);
  v.permissions.claude = false; strip.update(v); assert.equal(d.querySelector('#ai-gauge-usage-strip'), null);
});
test('unknown input selector fails quietly with the shared display source enabled', () => { const d = new JSDOM('<main></main>').window.document, v = view(); v.settings.enabled.chatgpt = true; const strip = new UsageStrip('chatgpt', d); strip.update(v); assert.equal(d.querySelector('#ai-gauge-usage-strip'), null); });
test('popup renders zero, unknown, previous-value marker and untrusted labels as text, without XSS', () => {
  const d = new JSDOM('<div id="cards"></div>').window.document, v = view(); v.settings.enabled.claude = true;
  v.snapshots.claude = success(emptySnapshot('claude'), parseClaude({ five_hour: { utilization: 0 }, seven_day: { utilization: null }, limits: [{ kind: 'weekly_scoped', percent: 12, scope: { model: { display_name: '<img src=x onerror=alert(1)>' } } }] }), 1000); v.snapshots.claude.state = 'error';
  renderCards(d.getElementById('cards')!, v, { enable() {}, disable() {}, revoke() {}, select() {} }, 1001);
  assert.match(d.body.textContent!, /0%/); assert.match(d.body.textContent!, /확인 불가/); assert.match(d.body.textContent!, /이전 수집값/); assert.doesNotMatch(d.body.textContent!, /오래된 데이터|갱신 필요/); assert.equal(d.querySelector('img'), null);
});
test('Codex web textarea composer gets one strip below it without reading or changing the input', () => {
  const d = new JSDOM('<main><form data-testid="codex-composer"><textarea>private Codex prompt</textarea><button>Send</button></form></main>', { url: 'https://chatgpt.com/codex/tasks/synthetic' }).window.document;
  const v = view(); v.settings.enabled.chatgpt = true; const strip = new UsageStrip('codex', d); strip.update(v); strip.mount();
  assert.equal(d.querySelectorAll('#ai-gauge-usage-strip').length, 1);
  assert.equal(d.querySelector('form')?.nextElementSibling?.id, 'ai-gauge-usage-strip');
  assert.equal(d.querySelector('textarea')?.value, 'private Codex prompt');
  v.settings.strips.codex = false; strip.update(v); assert.equal(d.querySelector('#ai-gauge-usage-strip'), null);
});
test('Codex contenteditable composer without form gets strip outside the whole composer', () => {
  const d = new JSDOM('<main><div data-testid="composer"><div role="textbox" contenteditable="true">private</div><button>Send</button></div></main>', { url: 'https://chatgpt.com/codex' }).window.document;
  const v = view(); v.settings.enabled.chatgpt = true; const strip = new UsageStrip('codex', d); strip.update(v);
  assert.equal(d.querySelector('[data-testid="composer"]')?.nextElementSibling?.id, 'ai-gauge-usage-strip');
  assert.equal(d.querySelector('[data-testid="composer"] #ai-gauge-usage-strip'), null);
});
test('OpenAI routes distinguish composer pages while both use the ChatGPT provider', () => {
  assert.equal(providerFromUrl('https://chatgpt.com/c/synthetic'), 'chatgpt');
  assert.equal(providerFromUrl('https://chatgpt.com/codex/tasks/synthetic'), 'codex');
  assert.equal(providerFromUrl('https://chatgpt.com/work'), 'codex');
  assert.equal(providerFromUrl('https://chatgpt.com/codex-other'), 'chatgpt');
});
test('ordinary ChatGPT strip displays its single collected quota snapshot without mutating it', () => {
  const d = new JSDOM('<main><form><div id="prompt-textarea" contenteditable="true"></div></form></main>', { url: 'https://chatgpt.com/c/synthetic' }).window.document;
  const v = view(); v.settings.enabled.chatgpt = true;
  v.snapshots.chatgpt = success(emptySnapshot('chatgpt'), [{ id: 'shared:primary_window', label: 'Work / Codex 공유 · 7일', category: 'product', percent: 88, resetsAt: null, windowSeconds: 604800, remaining: null, unit: null, source: 'api' }], Date.now());
  const before = structuredClone(v.snapshots);
  const strip = new UsageStrip('chatgpt', d); strip.update(v);
  const text = d.querySelector('#ai-gauge-usage-strip')!.getAttribute('aria-label')!;
  assert.match(text, /^사용량: 88%  🕒 사용량 초기화: 확인 불가/);
  assert.doesNotMatch(text, /모델별 사용량은 확인 불가|AI Gauge/);
  assert.deepEqual(v.snapshots, before);
  assert.equal(v.snapshots.chatgpt.limits[0]!.percent, 88);
});
test('popup shows ChatGPT, Claude and Gemini without a separate Codex card', () => {
  const d = new JSDOM('<div id="cards"></div>').window.document;
  renderCards(d.getElementById('cards')!, view(), { enable() {}, disable() {}, revoke() {}, select() {} });
  assert.deepEqual([...d.querySelectorAll('h2')].map(h => h.textContent), ['ChatGPT', 'Claude', 'Gemini']);
  assert.deepEqual([...d.querySelectorAll('.card')].map(card => card.getAttribute('data-provider')), ['chatgpt', 'claude', 'gemini']);
  assert.doesNotMatch(d.body.textContent!, /최근 수집 성공|Work \/ Codex 공유/);
});
test('shared OpenAI host replaces legacy content registrations with one display script', async () => {
  const { reconcileContent } = await import('../src/background/content-registration');
  const v = view(); v.settings.enabled.chatgpt = true;
  const original = globalThis.chrome; const registered: Array<{ id: string }> = [], removed: string[] = [];
  globalThis.chrome = { scripting: { getRegisteredContentScripts: async () => [{ id: 'ai-gauge-chatgpt' }], unregisterContentScripts: async (r: { ids: string[] }) => { removed.push(...r.ids); }, registerContentScripts: async (r: Array<{ id: string }>) => { registered.push(...r); } }, tabs: { query: async () => [] } } as unknown as typeof chrome;
  try { await reconcileContent(v); assert.deepEqual(registered.map(r => r.id), ['ai-gauge-openai']); assert.deepEqual(removed, ['ai-gauge-chatgpt']); }
  finally { globalThis.chrome = original; }
});
test('display registration follows either OpenAI composer toggle and stops when both are hidden', async () => {
  const { reconcileContent } = await import('../src/background/content-registration');
  const v = view(); v.settings.enabled.chatgpt = true; v.settings.strips.chatgpt = false; v.settings.strips.codex = true;
  const old = globalThis.chrome;
  const registered: chrome.scripting.RegisteredContentScript[] = [{ id: 'ai-gauge-openai', js: ['content.js'], runAt: 'document_idle' }];
  globalThis.chrome = {
    scripting: {
      getRegisteredContentScripts: async () => registered.map(r => ({ ...r })),
      registerContentScripts: async (items: chrome.scripting.RegisteredContentScript[]) => { registered.push(...items); },
      updateContentScripts: async (items: chrome.scripting.RegisteredContentScript[]) => { for (const item of items) Object.assign(registered.find(r => r.id === item.id)!, item); },
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => { for (const id of ids) { const i = registered.findIndex(r => r.id === id); if (i >= 0) registered.splice(i, 1); } },
      executeScript: async () => []
    }, tabs: { query: async () => [{ id: 1 }] }
  } as unknown as typeof chrome;
  try {
    await reconcileContent(v);
    assert.equal(registered.find(r => r.id === 'ai-gauge-openai')?.runAt, 'document_start');
    assert.deepEqual(registered.map(r => r.id), ['ai-gauge-openai']);
    v.settings.strips.chatgpt = true; v.settings.strips.codex = false;
    await reconcileContent(v);
    assert.deepEqual(registered.map(r => r.id), ['ai-gauge-openai']);
    v.settings.strips.chatgpt = false;
    await reconcileContent(v);
    assert.deepEqual(registered, [], 'the shared collector alone does not retain an unused display bridge');
  } finally { globalThis.chrome = old; }
});
