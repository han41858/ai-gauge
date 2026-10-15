import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleEntry } from './helpers/bundle';
import { JSDOM } from 'jsdom';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { Message } from '../src/shared/contracts';
import type { Snapshot, View } from '../src/shared/types';

const base = Date.UTC(2026, 9, 14, 12);
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const bundle = bundleEntry('src/content/index.ts');

function collected(percent: number, collectedAt: number, resetsAt: number): Snapshot {
  return {
    ...emptySnapshot('chatgpt'), state: 'ok', collectedAt, checkedAt: collectedAt, errorCode: null,
    limits: [{ id: 'weekly', label: '주간', category: 'window', percent,
      resetsAt: new Date(resetsAt).toISOString(), windowSeconds: 604800, remaining: null, unit: null, source: 'api' }]
  };
}

function sharedView(snapshot: Snapshot): View {
  const settings = defaults(); settings.enabled.chatgpt = true;
  return { settings, permissions: { chatgpt: true, claude: false, gemini: false }, snapshots: {
    chatgpt: snapshot, claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini')
  } };
}

async function page(view: View, path = '/') {
  const dom = new JSDOM('<main><form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form></main>', {
    url: `https://chatgpt.com${path}`, runScripts: 'outside-only'
  });
  const doc = dom.window.document, roots = new Map<HTMLElement, ShadowRoot>();
  const originalShadow = dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow = function(this: HTMLElement, options: ShadowRootInit) {
    const root = originalShadow.call(this, options); roots.set(this, root); return root;
  };
  let now = base, nextTimer = 0, fetches = 0;
  const intervals = new Map<number, { delay: number; run: () => void }>(), cleared: number[] = [];
  const timeouts = new Map<number, { delay: number; run: () => void }>(), clearedTimeouts: number[] = [];
  dom.window.Date.now = () => now;
  dom.window.setTimeout = (handler: TimerHandler, delay = 0, ...args: unknown[]) => {
    assert.equal(typeof handler, 'function');
    const id = ++nextTimer;
    timeouts.set(id, { delay, run: () => (handler as (...args: unknown[]) => void)(...args) });
    return id;
  };
  dom.window.clearTimeout = (id: number | undefined) => {
    if (id !== undefined) { clearedTimeouts.push(id); timeouts.delete(id); }
  };
  dom.window.setInterval = (handler: TimerHandler, delay = 0, ...args: unknown[]) => {
    assert.equal(typeof handler, 'function');
    const id = ++nextTimer;
    intervals.set(id, { delay, run: () => (handler as (...args: unknown[]) => void)(...args) });
    return id;
  };
  dom.window.clearInterval = (id: number | undefined) => {
    if (id !== undefined) { cleared.push(id); intervals.delete(id); }
  };
  const requests: Message[] = [];
  const runtimeListeners = new Set<(message: unknown, sender: { id: string }) => void>();
  const storageListeners = new Set<(...args: unknown[]) => void>();
  Object.assign(dom.window, { fetch: async () => { fetches++; throw new Error('Content clock must not collect usage'); }, chrome: {
    runtime: { id: 'fixture', sendMessage: async (message: Message) => {
      requests.push(structuredClone(message)); return { ok: true, view: structuredClone(view) };
    }, onMessage: {
      addListener(fn: (message: unknown, sender: { id: string }) => void) { runtimeListeners.add(fn); },
      removeListener(fn: (message: unknown, sender: { id: string }) => void) { runtimeListeners.delete(fn); }
    } },
    storage: { onChanged: { addListener(fn: () => void) { storageListeners.add(fn); }, removeListener(fn: () => void) { storageListeners.delete(fn); } } }
  } });
  dom.window.eval(bundle); await flush();
  const host = () => doc.getElementById('ai-gauge-usage-strip');
  const progress = () => roots.get(host()!)!.querySelector('progress')!;
  const revoke = (origins = ['https://chatgpt.com/*'], id = 'fixture') => {
    for (const fn of runtimeListeners) fn({ type: 'permissions-revoked', origins }, { id });
  };
  return { dom, host, progress, intervals, cleared, timeouts, clearedTimeouts, requests, runtimeListeners, storageListeners,
    fetches: () => fetches,
    async tick(at: number) { now = at; for (const timer of [...intervals.values()]) timer.run(); await flush(); },
    async storageChanged() { for (const fn of storageListeners) fn({ 'snapshot:v4:chatgpt': {} }, 'local'); await flush(); },
    revoke,
    close() { revoke(); dom.window.close(); }
  };
}

test('initial and same-document navigation notify context once without adding periodic requests', async () => {
  const tab = await page(sharedView(collected(37, base, base + 3_600_000)));
  try {
    assert.deepEqual(tab.requests, [{ type: 'context', provider: 'chatgpt' }]);
    tab.dom.window.history.pushState({}, '', '/c/another-synthetic-context');
    await tab.tick(base + 15_000);
    assert.deepEqual(tab.requests, [
      { type: 'context', provider: 'chatgpt' }, { type: 'context', provider: 'chatgpt' }
    ]);
    await tab.tick(base + 30_000);
    assert.equal(tab.requests.length, 2);
    assert.equal(tab.fetches(), 0);
  } finally { tab.close(); }
});

test('a quiet content clock keeps successful cache older than ten minutes without requesting a refresh', async () => {
  const view = sharedView(collected(37, base - 20 * 60_000, base + 60 * 60_000));
  const tab = await page(view);
  try {
    const host = tab.host(); assert(host);
    assert.match(host.getAttribute('aria-label')!, /사용량: 37%/);
    assert.equal(tab.progress().value, 37); assert.equal(tab.progress().hidden, false);
    assert.deepEqual([...tab.intervals.values()].map(timer => timer.delay), [15_000]);
    const before = structuredClone(tab.requests);
    await tab.tick(base + 15_000);
    await tab.tick(base + 30_000);
    assert.equal(tab.host(), host);
    assert.match(host.getAttribute('aria-label')!, /사용량: 37%/);
    assert.equal(tab.progress().value, 37);
    assert.deepEqual(tab.requests, before, 'clock ticks render cached state without even requesting another worker view');
    assert.equal(tab.fetches(), 0);
  } finally { tab.close(); }
});

test('quiet ChatGPT and Codex tabs hide elapsed usage and restore the shared snapshot through storage without per-tab collection', async () => {
  const view = sharedView(collected(37, base - 1_000, base + 10_000));
  const chat = await page(view), codex = await page(view, '/codex');
  const tabs = [chat, codex];
  try {
    const hosts = tabs.map(tab => tab.host()), progresses = tabs.map(tab => tab.progress());
    for (const tab of tabs) {
      assert(tab.host()); assert.equal(tab.progress().value, 37);
      const before = tab.requests.length;
      await tab.tick(base + 15_000);
      assert.match(tab.host()!.getAttribute('aria-label')!, /사용량: 확인 불가/);
      assert.doesNotMatch(tab.host()!.getAttribute('aria-label')!, /37%/);
      assert.equal(tab.progress().hidden, true);
      assert.equal(tab.progress().hasAttribute('value'), false, 'elapsed reset cannot leave a current percentage in the progress element');
      assert.equal(tab.requests.length, before, 'crossing the reset does not collect separately for each open tab');
    }
    assert.equal(view.snapshots.chatgpt.state, 'ok', 'local rendering does not overwrite the shared stored snapshot');
    assert.equal(view.snapshots.chatgpt.limits[0]!.percent, 37);
    view.snapshots.chatgpt = collected(2.5, base + 15_000, base + 24 * 60 * 60_000);
    for (const [index, tab] of tabs.entries()) {
      await tab.storageChanged();
      assert.equal(tab.host(), hosts[index]); assert.equal(tab.progress(), progresses[index]);
      assert.equal(tab.progress().hidden, false); assert.equal(tab.progress().value, 2.5);
      assert.doesNotMatch(tab.host()!.getAttribute('aria-label')!, /확인 불가/);
      assert.equal(tab.requests.filter(message => message.type === 'refresh').length, 0);
      assert.equal(tab.fetches(), 0);
    }
  } finally { for (const tab of tabs) tab.close(); }
});

test('trusted host revocation clears the content clock and a queued callback cannot remount or refresh', async () => {
  const tab = await page(sharedView(collected(37, base - 1_000, base + 60_000)));
  try {
    const [clockId, clock] = [...tab.intervals][0]!;
    tab.revoke(['https://claude.ai/*']); tab.revoke(undefined, 'untrusted-extension');
    assert(tab.host()); assert.equal(tab.intervals.size, 1); assert.deepEqual(tab.cleared, []);
    const before = structuredClone(tab.requests);
    tab.revoke();
    assert.deepEqual(tab.cleared, [clockId]); assert.equal(tab.intervals.size, 0);
    assert.equal(tab.host(), null); assert.equal(tab.dom.window.__aiGaugeMounted, false);
    assert.equal(tab.runtimeListeners.size, 0); assert.equal(tab.storageListeners.size, 0);
    clock.run(); await flush();
    assert.equal(tab.host(), null);
    assert.deepEqual(tab.requests, before);
    assert.equal(tab.fetches(), 0);
  } finally { tab.close(); }
});

test('a clock tick does not orphan a pending DOM debounce when permission is revoked', async () => {
  const tab = await page(sharedView(collected(37, base - 1_000, base + 60_000)));
  try {
    const form = tab.dom.window.document.querySelector('form')!;
    form.classList.add('first-mutation'); await flush();
    assert.equal(tab.timeouts.size, 1);
    const [firstId, firstTimer] = [...tab.timeouts][0]!;
    assert.equal(firstTimer.delay, 300);
    const before = structuredClone(tab.requests);
    await tab.tick(base + 15_000);
    assert.equal(tab.timeouts.size, 0, 'the clock cancels the already pending placement check before dropping its timer ID');
    assert(tab.clearedTimeouts.includes(firstId));
    form.classList.add('second-mutation'); await flush();
    assert.equal(tab.timeouts.size, 1);
    const secondId = [...tab.timeouts.keys()][0]!;
    tab.revoke();
    assert.equal(tab.timeouts.size, 0); assert(tab.clearedTimeouts.includes(secondId));
    assert.equal(tab.intervals.size, 0);
    firstTimer.run(); await flush();
    assert.equal(tab.host(), null); assert.deepEqual(tab.requests, before);
  } finally { tab.close(); }
});
