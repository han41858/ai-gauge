import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { Scheduler, success } from '../src/background/scheduler';
import { parseClaude } from '../src/providers/parsers';
import { hasStreamingControl } from '../src/content/selectors';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { Message } from '../src/shared/contracts';
import type { View } from '../src/shared/types';

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const base = Date.UTC(2026, 9, 14, 12);
const limits = (percent: number) => parseClaude({ five_hour: { utilization: percent, resets_at: '2026-10-15T12:00:00Z' } });

async function harness(provider: 'claude' | 'gemini' = 'claude') {
  const markup = provider === 'claude'
    ? '<form><div class="ProseMirror" contenteditable="true">private prompt</div><button id="send" aria-label="Send message">Send</button></form>'
    : '<input-area-v2><rich-textarea><div class="ql-editor" contenteditable="true">private prompt</div></rich-textarea><button id="send" aria-label="Send message">Send</button></input-area-v2>';
  const origin = provider === 'claude' ? 'https://claude.ai/*' : 'https://gemini.google.com/*';
  const dom = new JSDOM(`<main>${markup}</main>`, { url: origin.replace('*', 'new'), runScripts: 'outside-only' });
  const doc = dom.window.document, roots = new Map<HTMLElement, ShadowRoot>();
  const originalShadow = dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow = function(this: HTMLElement, options: ShadowRootInit) {
    const root = originalShadow.call(this, options); roots.set(this, root); return root;
  };
  const input = doc.querySelector('[contenteditable]')!;
  for (const name of ['textContent', 'innerText', 'innerHTML', 'value']) Object.defineProperty(input, name, { get() { throw new Error('Prompt accessed'); } });
  let now = base, timerId = 0, servedPercent = 63;
  const timers = new Map<number, { at: number; run: () => void }>();
  dom.window.Date.now = () => now;
  dom.window.setTimeout = (handler: TimerHandler, delay = 0, ...args: unknown[]) => {
    const id = ++timerId;
    assert.equal(typeof handler, 'function');
    timers.set(id, { at: now + delay, run: () => (handler as (...args: unknown[]) => void)(...args) });
    return id;
  };
  dom.window.clearTimeout = (id: number | undefined) => { if (id !== undefined) timers.delete(id); };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const pending = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending) break;
      now = pending[1].at; timers.delete(pending[0]); pending[1].run(); await flush();
    }
    now = until; await flush();
  };
  const collectedLimits = (percent: number) => provider === 'claude' ? limits(percent) : [{
    id: 'weekly', label: '주간', category: 'window' as const, percent,
    resetsAt: '2026-10-15T12:00:00.000Z', windowSeconds: 604800, remaining: 12096, unit: null, source: 'api' as const
  }];
  const settings = defaults(); settings.enabled[provider] = true;
  const view: View = { settings, permissions: { chatgpt: true, gemini: true, claude: true }, snapshots: {
    chatgpt: emptySnapshot('chatgpt'), gemini: emptySnapshot('gemini'), claude: emptySnapshot('claude'),
    [provider]: success(emptySnapshot(provider), collectedLimits(17), base - 10_000)
  } };
  const storageListeners = new Set<() => void>();
  const runtimeListeners = new Set<(message: unknown, sender: { id: string }) => void>();
  const requests: Array<{ at: number; message: Message }> = [], collections: number[] = [];
  const notifyStorage = () => { for (const fn of storageListeners) fn(); };
  const scheduler = new Scheduler({
    now: () => now, read: async provider => view.snapshots[provider],
    write: async snapshot => { view.snapshots[snapshot.provider] = snapshot; notifyStorage(); },
    enabled: async provider => view.settings.enabled[provider] && view.permissions[provider],
    collect: async requested => { assert.equal(requested, provider); collections.push(now); return collectedLimits(servedPercent); }
  });
  Object.assign(dom.window, { chrome: {
    runtime: { id: 'fixture', sendMessage: async (message: Message) => {
      requests.push({ at: now, message: structuredClone(message) });
      if (message.type === 'refresh') await scheduler.refresh(message.provider, message.trigger);
      return { ok: true, view: structuredClone(view) };
    }, onMessage: { addListener(fn: typeof runtimeListeners extends Set<infer T> ? T : never) { runtimeListeners.add(fn); }, removeListener(fn: typeof runtimeListeners extends Set<infer T> ? T : never) { runtimeListeners.delete(fn); } } },
    storage: { onChanged: { addListener(fn: () => void) { storageListeners.add(fn); }, removeListener(fn: () => void) { storageListeners.delete(fn); } } }
  } });
  const bundle = buildSync({ entryPoints: ['src/content/index.ts'], bundle: true, write: false, format: 'iife', target: 'chrome120' }).outputFiles[0]!.text;
  dom.window.eval(bundle); await flush();
  const host = () => doc.getElementById('ai-gauge-usage-strip')!;
  const progress = () => roots.get(host())!.querySelector('progress')!;
  const setButton = async (label: string) => { doc.getElementById('send')!.setAttribute('aria-label', label); await flush(); };
  const finishResponse = async () => {
    await setButton('Stop Response'); await advance(100); await setButton('Send message'); await advance(200);
  };
  const invalidate = () => { for (const fn of runtimeListeners) fn({ type: 'invalidate' }, { id: 'fixture' }); };
  return { dom, doc, view, host, progress, advance, finishResponse, notifyStorage, invalidate, collections, requests,
    setServedPercent(value: number) { servedPercent = value; },
    revoke(origins = [origin], id = 'fixture') { for (const fn of runtimeListeners) fn({ type: 'permissions-revoked', origins }, { id }); },
    close() {
      for (const fn of runtimeListeners) fn({ type: 'permissions-revoked', origins: [origin] }, { id: 'fixture' });
      timers.clear(); dom.window.close();
    }
  };
}

test('stored usage and runtime invalidations update the same native progress element with unrounded values', async () => {
  const page = await harness();
  try {
    const host = page.host(), progress = page.progress();
    assert.equal(progress.value, 17);
    page.view.snapshots.claude = success(emptySnapshot('claude'), limits(17.25), base);
    page.notifyStorage(); await flush();
    assert.equal(page.progress(), progress); assert.equal(page.progress().value, 17.25);
    assert.match(page.host().getAttribute('aria-label')!, /사용량: 17%/);
    page.view.snapshots.claude = success(emptySnapshot('claude'), limits(63), base);
    page.invalidate(); await flush();
    assert.equal(page.host(), host); assert.equal(page.progress(), progress); assert.equal(progress.value, 63);
    assert.match(page.host().getAttribute('aria-label')!, /사용량: 63%/);
    assert.equal(page.collections.length, 0, 'displaying a stored snapshot must not itself collect usage');
  } finally { page.close(); }
});

test('Gemini completion uses its own source, respects scheduler cooldown and updates its existing progress', async () => {
  const page = await harness('gemini');
  try {
    const host = page.host(), progress = page.progress();
    assert.equal(progress.value, 17);
    await page.finishResponse();
    assert.equal(page.collections.length, 0);
    page.revoke(['https://claude.ai/*']); page.revoke(undefined, 'other-extension');
    assert.equal(page.host(), host);
    await page.advance(49_801);
    assert.deepEqual(page.collections, [base + 50_100]);
    const requests = page.requests.filter(item => item.message.type === 'refresh');
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, { type: 'refresh', provider: 'gemini', trigger: 'event' });
    assert.equal(page.host(), host); assert.equal(page.progress(), progress); assert.equal(progress.value, 63);
    await page.finishResponse(); page.revoke(); await page.advance(120_000);
    assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), null);
    assert.equal(page.collections.length, 1);
  } finally { page.close(); }
});

test('a short Claude response finishing during cooldown is collected once after the real scheduler permits it', async () => {
  const page = await harness();
  try {
    const progress = page.progress();
    await page.finishResponse();
    assert.equal(page.collections.length, 0);
    assert.equal(page.requests.filter(request => request.message.type === 'refresh').length, 0);
    await page.advance(49_699);
    assert.equal(page.collections.length, 0);
    await page.advance(102);
    assert.deepEqual(page.collections, [base + 50_100]);
    assert.equal(page.progress(), progress); assert.equal(progress.value, 63);
    assert.equal(page.view.snapshots.claude.collectedAt, base + 50_100);
  } finally { page.close(); }
});

test('completion bursts merge and a later completion within one minute remains scheduled', async () => {
  const page = await harness();
  try {
    await page.finishResponse(); await page.finishResponse(); await page.advance(49_501);
    assert.equal(page.collections.length, 1);
    page.setServedPercent(75);
    await page.finishResponse();
    assert.equal(page.collections.length, 1);
    await page.advance(60_000);
    assert.equal(page.collections.length, 2);
    assert(page.collections[1]! - page.collections[0]! >= 60_000);
    assert.equal(page.progress().value, 75);
  } finally { page.close(); }
});

test('pending completion respects a later Retry-After/backoff deadline received through storage', async () => {
  const page = await harness();
  try {
    await page.finishResponse();
    page.view.snapshots.claude = { ...page.view.snapshots.claude, state: 'rate_limited', errorCode: 'rate_limited', nextAttemptAt: base + 180_000 };
    page.notifyStorage(); await flush();
    await page.advance(179_700);
    assert.equal(page.collections.length, 0);
    await page.advance(101);
    assert.deepEqual(page.collections, [base + 180_100]);
  } finally { page.close(); }
});

for (const condition of ['disabled', 'revoked', 'navigated', 'unsupported', 'signed_out'] as const) {
  test(`${condition} clears a pending completion refresh`, async () => {
    const page = await harness();
    try {
      await page.finishResponse();
      if (condition === 'disabled') { page.view.settings.enabled.claude = false; page.notifyStorage(); }
      else if (condition === 'revoked') page.revoke();
      else if (condition === 'navigated') { page.dom.window.history.pushState(null, '', '/chat/synthetic'); page.dom.window.dispatchEvent(new page.dom.window.PopStateEvent('popstate')); }
      else { page.view.snapshots.claude = { ...page.view.snapshots.claude, state: condition, errorCode: condition }; page.notifyStorage(); }
      await flush(); await page.advance(180_000);
      assert.equal(page.collections.length, 0);
    } finally { page.close(); }
  });
}

test('Claude recognizes visible stop control attributes without reading button or response text', () => {
  const dom = new JSDOM('<main><form><div contenteditable="true"></div><button aria-label="Stop Response"></button></form></main>');
  try {
    const doc = dom.window.document, button = doc.querySelector('button')!;
    Object.defineProperty(button, 'textContent', { get() { throw new Error('Button text read'); } });
    for (const label of ['Stop Response', 'Stop response', 'STOP GENERATING', '생성 중지']) {
      button.setAttribute('aria-label', label);
      assert.equal(hasStreamingControl(doc, 'claude'), true);
    }
    button.hidden = true;
    assert.equal(hasStreamingControl(doc, 'claude'), false);
    button.hidden = false; button.setAttribute('aria-label', 'Send message');
    assert.equal(hasStreamingControl(doc, 'claude'), false);
    button.setAttribute('data-testid', 'stop-response-button');
    assert.equal(hasStreamingControl(doc, 'claude'), true);
  } finally { dom.window.close(); }
});
