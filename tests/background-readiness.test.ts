import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { bundleEntry } from './helpers/bundle';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import { success } from '../src/background/scheduler';
import { parseClaude } from '../src/providers/parsers';

class Signal<Args extends unknown[] = []> {
  private listeners: Array<(...args: Args) => void> = [];
  addListener(listener: (...args: Args) => void) { this.listeners.push(listener); }
  emit(...args: Args) { for (const listener of this.listeners) listener(...args); }
}

const bundle = bundleEntry('src/background/index.ts');
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function waitFor(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await pause();
  }
  assert(condition(), message);
}

function worker(options: { holdContent?: boolean; registrationError?: boolean; failAllTabsQuery?: boolean } = {}) {
  let now = 1_790_000_000_000;
  const settings = defaults(); settings.enabled.claude = true;
  const payload = (percent: number) => ({ seven_day: { utilization: percent, resets_at: new Date(now + 5 * 86_400_000).toISOString() } });
  const stored: Record<string, unknown> = {
    'migration:shared-chatgpt:v2': true,
    'settings:v2': settings,
    'snapshot:v2:claude': success(emptySnapshot('claude'), parseClaude(payload(56)), now)
  };
  const tab = { id: 1, url: 'https://claude.ai/chat/existing', active: true } as chrome.tabs.Tab;
  const events = {
    installed: new Signal(), startup: new Signal(), message: new Signal(), alarm: new Signal<[{ name: string }]>(),
    activated: new Signal<[{ tabId: number }]>(),
    updated: new Signal<[number, { status: string }, chrome.tabs.Tab]>(),
    focus: new Signal<[number]>(), added: new Signal(), removed: new Signal()
  };
  let releaseContent!: () => void, releaseCollection!: () => void;
  const contentGate = new Promise<void>(resolve => { releaseContent = resolve; });
  const collectionGate = new Promise<void>(resolve => { releaseCollection = resolve; });
  let contentCalls = 0, collections = 0, globalBadge = '';
  let failAllTabsQuery = options.failAllTabsQuery === true, allTabsQueries = 0;
  const texts = new Map<number, string>();
  const api = {
    runtime: { id: 'readiness', onMessage: events.message, onInstalled: events.installed, onStartup: events.startup },
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])),
        set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }
      },
      session: { get: async (key: string) => ({ [key]: true }), set: async () => undefined }
    },
    permissions: {
      contains: async ({ origins }: { origins: string[] }) => origins.every(origin => origin === 'https://claude.ai/*'),
      onAdded: events.added, onRemoved: events.removed
    },
    alarms: { get: async () => ({ periodInMinutes: 1 }), create: async () => undefined, onAlarm: events.alarm },
    tabs: {
      query: async (query: { url?: string }) => {
        if (Object.keys(query).length === 0) {
          allTabsQueries++;
          if (failAllTabsQuery) throw new Error('Tab list temporarily unavailable');
        }
        return !query.url || tab.url!.startsWith(query.url.slice(0, -1)) ? [{ ...tab }] : [];
      },
      get: async () => ({ ...tab }), sendMessage: async () => undefined,
      onActivated: events.activated, onUpdated: events.updated
    },
    windows: { onFocusChanged: events.focus },
    action: {
      getBadgeText: async ({ tabId }: { tabId?: number }) => tabId === undefined ? globalBadge : texts.get(tabId) ?? globalBadge,
      setBadgeText: async ({ tabId, text }: { tabId?: number; text: string }) => {
        if (tabId === undefined) globalBadge = text; else texts.set(tabId, text);
      },
      setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined, setTitle: async () => undefined
    },
    scripting: {
      getRegisteredContentScripts: async () => {
        if (options.registrationError) throw new Error('Registration temporarily unavailable');
        return [{ id: 'ai-gauge-claude', runAt: 'document_start' }];
      },
      registerContentScripts: async () => undefined, unregisterContentScripts: async () => undefined,
      executeScript: async (details: { files?: string[] }) => {
        if (details.files) {
          contentCalls++;
          if (options.holdContent) await contentGate;
          return [];
        }
        collections++;
        await collectionGate;
        return [{ result: { status: 200, code: null, retryAfter: null, data: payload(57) } }];
      }
    }
  };
  class Clock extends Date { static now() { return now; } }
  runInNewContext(bundle, { chrome: api, URL, Date: Clock, setTimeout, clearTimeout });
  return {
    tab, events, texts,
    badge: () => texts.get(tab.id!) ?? globalBadge,
    contentCalls: () => contentCalls, collections: () => collections,
    allTabsQueries: () => allTabsQueries, allowAllTabsQuery: () => { failAllTabsQuery = false; },
    snapshot: () => structuredClone(stored['snapshot:v2:claude']),
    advance: () => { now += 60_001; },
    releaseContent, releaseCollection
  };
}

test('worker restores an existing Claude badge while content injection is still pending', async () => {
  const browser = worker({ holdContent: true });
  try {
    await waitFor(() => browser.contentCalls() > 0, 'Content injection did not begin');
    await waitFor(() => browser.badge() === '56%', 'Cached badge must be visible before content injection finishes');
    assert.equal(browser.collections(), 0, 'A current cache needs no extra collection');
  } finally { browser.releaseContent(); browser.releaseCollection(); await pause(); }
});

test('worker restores an existing Claude badge even if content registration fails', async () => {
  const browser = worker({ registrationError: true });
  try {
    await waitFor(() => browser.badge() === '56%', 'Content registration failure must not prevent cached badge restoration');
    assert.equal(browser.collections(), 0);
  } finally { browser.releaseContent(); browser.releaseCollection(); await pause(); }
});

test('an alarm retries cached Claude badge publication after a temporary tab-list failure', async () => {
  const browser = worker({ failAllTabsQuery: true });
  try {
    await waitFor(() => browser.allTabsQueries() > 0, 'Initial publication did not try to enumerate tabs');
    await waitFor(() => browser.contentCalls() > 0, 'Badge publication failure must not block content setup');
    const failedAttempts = browser.allTabsQueries();
    await pause();
    assert.equal(browser.allTabsQueries(), failedAttempts, 'Failed startup attempts have settled before the alarm');
    assert.equal(browser.badge(), '');
    const snapshot = browser.snapshot();
    browser.allowAllTabsQuery();
    browser.events.alarm.emit({ name: 'ai-gauge-refresh' });
    await waitFor(() => browser.badge() === '56%', 'An unchanged view must be retried after failed publication');
    assert(browser.allTabsQueries() > failedAttempts, 'The alarm retries publication after the failed startup attempts');
    assert.equal(browser.collections(), 0, 'Badge recovery must not require a new usage response');
    assert.deepEqual(browser.snapshot(), snapshot, 'The retry uses the same cached usage and timestamps');
  } finally { browser.releaseContent(); browser.releaseCollection(); await pause(); }
});

for (const event of ['installed', 'startup'] as const) {
  test(`a forced ${event} initialization restores a cleared badge in an existing worker`, async () => {
    const browser = worker();
    try {
      await waitFor(() => browser.badge() === '56%', 'Worker did not publish its initial cache');
      const snapshot = browser.snapshot();
      browser.texts.delete(browser.tab.id!);
      assert.equal(browser.badge(), '', 'The current action text differs from the remembered write');
      browser.events[event].emit();
      await waitFor(() => browser.badge() === '56%', 'Forced initialization must restore the actual badge, even with an unchanged cache');
      assert.equal(browser.collections(), 0, 'Forced restoration reuses the current usage cache');
      assert.deepEqual(browser.snapshot(), snapshot);
    } finally { browser.releaseContent(); browser.releaseCollection(); await pause(); }
  });
}

for (const event of ['activation', 'focus', 'complete'] as const) {
  test(`Claude ${event} restores a cleared badge before awaiting usage collection`, async () => {
    const browser = worker();
    try {
      await waitFor(() => browser.badge() === '56%', 'Worker did not publish its initial cache');
      assert.equal(browser.collections(), 0);
      browser.texts.delete(browser.tab.id!);
      assert.equal(browser.badge(), '', 'Chrome has cleared the tab-specific action text');
      browser.advance();
      if (event === 'activation') browser.events.activated.emit({ tabId: browser.tab.id! });
      else if (event === 'focus') browser.events.focus.emit(1);
      else browser.events.updated.emit(browser.tab.id!, { status: 'complete' }, browser.tab);
      await waitFor(() => browser.collections() === 1, 'Tab event did not start the due collection');
      await waitFor(() => browser.badge() === '56%', 'Cached badge must be restored while the collection remains pending');
      browser.releaseCollection();
      await waitFor(() => browser.badge() === '57%', 'Completed collection must update the restored badge');
    } finally { browser.releaseContent(); browser.releaseCollection(); await pause(); }
  });
}
