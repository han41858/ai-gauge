import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { collectChatGPT } from '../src/providers/chatgpt';
import { collectChatGPTFromTab } from '../src/providers/tab-transport';
import { readChatGPTObservation } from '../src/providers/chatgpt-observer';
import { parseChatGPT } from '../src/providers/chatgpt-parser';
import { Scheduler, success } from '../src/background/scheduler';
import { badge } from '../src/background/badge';
import { renderCards } from '../src/popup/render';
import { CollectionError } from '../src/shared/errors';
import { emptySnapshot, FRESH_MS } from '../src/storage/snapshots';
import { defaults } from '../src/storage/settings';
import type { CollectionResult, Provider, View } from '../src/shared/types';

const observedAt = 1_000_000;
const metadata = { limits_progress: [{ feature_name: 'synthetic-feature', remaining: 0, reset_after: '2026-10-15T00:00:00Z' }] };
const observation = { version: 1, observedAt, data: metadata };
const limits = () => parseChatGPT(metadata);
type Tab = { id: number; url: string; active?: boolean; discarded?: boolean; frozen?: boolean };
type Injection = { target: { tabId: number }; world: string; func: unknown };

async function withTransport(
  options: { permission?: boolean; tabs?: Tab[]; observation?: unknown },
  run: (calls: { queries: number; fetches: number; injections: Injection[] }) => Promise<void>,
) {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  const calls = { queries: 0, fetches: 0, injections: [] as Injection[] };
  globalThis.chrome = {
    permissions: { contains: async () => options.permission ?? true },
    tabs: { query: async () => { calls.queries++; return options.tabs ?? [{ id: 1, url: 'https://chatgpt.com/' }]; } },
    scripting: { executeScript: async (injection: Injection) => { calls.injections.push(injection); return [{ result: options.observation ?? null }]; } },
  } as unknown as typeof chrome;
  globalThis.fetch = async () => { calls.fetches++; throw new Error('ChatGPT collection must not initiate a request'); };
  try { await run(calls); }
  finally { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; }
}

test('ChatGPT adapter reads passive metadata and preserves remaining zero without requesting an API', async () => {
  await withTransport({ observation }, async calls => {
    const result = await collectChatGPT();
    assert.equal(result.observedAt, observedAt);
    assert.equal(result.limits[0]?.remaining, 0);
    assert.equal(result.limits[0]?.percent, null);
    assert.equal(result.limits[0]?.resetsAt, '2026-10-15T00:00:00.000Z');
    assert.equal(calls.fetches, 0);
    assert.equal(calls.injections.length, 1);
    assert.equal(calls.injections[0]?.func, readChatGPTObservation);
    assert.equal(calls.injections[0]?.world, 'MAIN');
  });
});

test('ChatGPT adapter treats an unobserved response as pending rather than zero usage', async () => {
  await withTransport({}, async calls => {
    await assert.rejects(collectChatGPT, (error: unknown) => error instanceof CollectionError && error.code === 'chatgpt_usage_pending');
    assert.equal(calls.fetches, 0);
  });
});

test('ChatGPT transport skips active Codex and inactive or unavailable ordinary tabs', async () => {
  await withTransport({ observation, tabs: [
    { id: 9, url: 'https://chatgpt.com/codex', active: true },
    { id: 8, url: 'https://chatgpt.com/work', active: true },
    { id: 7, url: 'https://chatgpt.com/c/discarded', active: true, discarded: true },
    { id: 6, url: 'https://chatgpt.com/c/frozen', active: true, frozen: true },
    { id: 5, url: 'https://chatgpt.com/c/inactive', active: false },
    { id: 4, url: 'https://chatgpt.com/c/active', active: true },
  ] }, async calls => {
    assert.deepEqual(await collectChatGPTFromTab(), observation);
    assert.equal(calls.injections.length, 1);
    assert.equal(calls.injections[0]?.target.tabId, 4);
  });
});

test('ChatGPT transport refuses a Codex-only session without injecting into its shared pool', async () => {
  await withTransport({ tabs: [{ id: 9, url: 'https://chatgpt.com/codex/tasks/synthetic', active: true }] }, async calls => {
    await assert.rejects(collectChatGPTFromTab, (error: unknown) => error instanceof CollectionError && error.code === 'open_tab');
    assert.equal(calls.injections.length, 0);
  });
});

test('ChatGPT collection without permission never queries tabs or injects into a page', async () => {
  await withTransport({ permission: false }, async calls => {
    await assert.rejects(collectChatGPT, (error: unknown) => error instanceof CollectionError && error.state === 'permission_required');
    assert.equal(calls.queries, 0);
    assert.equal(calls.injections.length, 0);
    assert.equal(calls.fetches, 0);
  });
});

test('reading a cached ChatGPT response does not refresh its observation time or prevent staleness', async () => {
  let now = observedAt + 60_000, snapshot = emptySnapshot('chatgpt');
  const scheduler = new Scheduler({
    read: async () => snapshot,
    write: async value => { snapshot = value; },
    collect: async (): Promise<CollectionResult> => ({ limits: limits(), observedAt }),
    enabled: async () => true,
    now: () => now,
  });
  await scheduler.refresh('chatgpt', 'manual');
  assert.equal(snapshot.state, 'ok');
  assert.equal(snapshot.collectedAt, observedAt);
  assert.equal(snapshot.checkedAt, now);
  now = observedAt + FRESH_MS;
  await scheduler.refresh('chatgpt', 'manual');
  assert.equal(snapshot.state, 'stale');
  assert.equal(snapshot.collectedAt, observedAt);
  assert.equal(snapshot.checkedAt, now);
  assert.equal(snapshot.limits[0]?.remaining, 0);
});

test('an explicit empty ChatGPT response clears old quotas without reporting zero usage', async () => {
  const now = observedAt + FRESH_MS;
  let snapshot = success(emptySnapshot('chatgpt'), limits(), observedAt);
  const scheduler = new Scheduler({
    read: async () => snapshot,
    write: async value => { snapshot = value; },
    collect: async () => ({ limits: [], observedAt: now - 1_000 }),
    enabled: async () => true,
    now: () => now,
  });
  await scheduler.refresh('chatgpt', 'manual');
  assert.deepEqual(snapshot.limits, []);
  assert.equal(snapshot.state, 'error');
  assert.equal(snapshot.errorCode, 'chatgpt_quota_absent');
  assert.equal(snapshot.collectedAt, observedAt, 'an empty observation does not become the last successful usage collection');
  assert.equal(snapshot.failures, 0);
});

test('a first empty ChatGPT observation does not create a successful collection timestamp', async () => {
  let snapshot = emptySnapshot('chatgpt');
  await new Scheduler({ read: async () => snapshot, write: async value => { snapshot = value; }, collect: async () => ({ limits: [], observedAt }), enabled: async () => true, now: () => observedAt + 1000 }).refresh('chatgpt', 'manual');
  assert.equal(snapshot.errorCode, 'chatgpt_quota_absent'); assert.equal(snapshot.collectedAt, null);
  assert.equal(snapshot.checkedAt, observedAt + 1000); assert.deepEqual(snapshot.limits, []);
});

test('waiting for passive ChatGPT metadata uses a fixed minute retry even after repeated failures', async () => {
  let now = observedAt, snapshot = { ...emptySnapshot('chatgpt'), failures: 8 }, collections = 0;
  const scheduler = new Scheduler({
    read: async () => snapshot,
    write: async value => { snapshot = value; },
    collect: async () => { collections++; throw new CollectionError('chatgpt_usage_pending'); },
    enabled: async () => true,
    now: () => now,
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await scheduler.refresh('chatgpt', 'manual');
    assert.equal(collections, attempt);
    assert.equal(snapshot.errorCode, 'chatgpt_usage_pending');
    assert.equal(snapshot.failures, 0);
    assert.equal(snapshot.nextAttemptAt, now + 60_000);
    await scheduler.refresh('chatgpt', 'event');
    assert.equal(collections, attempt);
    now += 60_000;
  }
});

function popupView(now: number): View {
  const settings = defaults();
  settings.enabled.chatgpt = true;
  settings.defaultProvider = 'chatgpt';
  return {
    settings,
    permissions: { chatgpt: true, work_codex: true, claude: true },
    snapshots: { chatgpt: success(emptySnapshot('chatgpt'), limits(), now), work_codex: emptySnapshot('work_codex'), claude: emptySnapshot('claude') },
  };
}

test('experimental ChatGPT quotas are omitted from the compact popup and retain a neutral badge', () => {
  const now = observedAt, view = popupView(now);
  const dom = new JSDOM('<main id="cards"></main>'), document = dom.window.document;
  try {
    renderCards(document.getElementById('cards')!, view, { enable() {}, disable() {}, revoke() {}, refresh() {}, select() {} }, now);
    assert.equal(document.querySelector('[data-provider="chatgpt"]'), null);
    assert.equal(document.querySelectorAll('.card').length, 2);
    assert.doesNotMatch(document.body.textContent!, /0 남음|0%/);
    assert.equal(badge(view, 'https://chatgpt.com/', now).text, '—');
  } finally { dom.window.close(); }
});

test('the visible plan popup refresh respects its own permission and cooldown', () => {
  const now = observedAt, view = popupView(now), refreshed: Provider[] = [];
  view.settings.enabled.work_codex = true;
  view.snapshots.work_codex = success(emptySnapshot('work_codex'), [], now);
  const dom = new JSDOM('<main id="cards"></main>'), document = dom.window.document;
  const render = () => {
    renderCards(document.getElementById('cards')!, view, { enable() {}, disable() {}, revoke() {}, refresh(provider) { refreshed.push(provider); }, select() {} }, now);
    const refresh = [...document.querySelectorAll<HTMLButtonElement>('.card:first-child button')].find(button => button.textContent === '새로고침');
    assert(refresh);
    return refresh;
  };
  try {
    assert.equal(render().disabled, true);
    view.snapshots.work_codex.nextAttemptAt = now;
    const refresh = render();
    assert.equal(refresh.disabled, false);
    refresh.click();
    assert.deepEqual(refreshed, ['work_codex']);
    view.permissions.work_codex = false;
    assert.equal(render().disabled, true);
  } finally { dom.window.close(); }
});
