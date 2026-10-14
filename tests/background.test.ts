import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { defaults } from '../src/storage/settings';
import { emptySnapshot, FRESH_MS } from '../src/storage/snapshots';
import { success } from '../src/background/scheduler';
import { parseChatGPT } from '../src/providers/parsers';
import type { Reply } from '../src/shared/contracts';

class Event<T extends (...args: never[]) => unknown = (...args: never[]) => unknown> {
  listeners: T[] = [];
  addListener(fn: T) { this.listeners.push(fn); }
  emit(...args: Parameters<T>) { for (const fn of this.listeners) fn(...args); }
}
test('real background wiring: initialization, merged content refreshes, permission revocation, view without invalidation loop', async () => {
  const events = {
    message: new Event<(input: unknown, sender: chrome.runtime.MessageSender, reply: (r: Reply) => void) => boolean>(),
    installed: new Event<() => void>(), startup: new Event<() => void>(), alarm: new Event<(a: { name: string }) => void>(),
    activated: new Event<(a: { tabId: number }) => void>(), updated: new Event<(id: number, change: { status?: string; url?: string }, tab: chrome.tabs.Tab) => void>(),
    focus: new Event<() => void>(), added: new Event<() => void>(), removed: new Event<(permissions: { origins: string[] }) => void>()
  };
  const stored: Record<string, unknown> = {}, registrations: Array<{ id: string }> = [];
  const tab = { id: 1, url: 'https://chatgpt.com/codex', active: true } as chrome.tabs.Tab;
  let permission = true, requests = 0, pushes = 0, badge = '', alarm: unknown = null;
  const pushedMessages: unknown[] = [];
  const mock = {
    runtime: { id: 'ext', onMessage: events.message, onInstalled: events.installed, onStartup: events.startup },
    storage: { local: { get: async (key: string | string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map(name => [name, stored[name]])), set: async (value: Record<string, unknown>) => { Object.assign(stored, value); } } },
    permissions: { contains: async () => permission, onAdded: events.added, onRemoved: events.removed },
    alarms: { get: async () => alarm, create: async (_name: string, a: unknown) => { alarm = a; }, onAlarm: events.alarm },
    tabs: { query: async (q: { url?: string }) => !q.url || tab.url!.startsWith(q.url.slice(0, -1)) ? [tab] : [], get: async () => tab, sendMessage: async (_id: number, message: unknown) => { pushes++; pushedMessages.push(message); }, onActivated: events.activated, onUpdated: events.updated },
    windows: { onFocusChanged: events.focus },
    action: { setBadgeText: async (v: { text: string }) => { badge = v.text; }, setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined, setTitle: async () => undefined },
    scripting: {
      getRegisteredContentScripts: async () => [...registrations],
      registerContentScripts: async (v: Array<{ id: string }>) => { registrations.push(...v); },
      unregisterContentScripts: async (v: { ids: string[] }) => { for (const id of v.ids) { const i = registrations.findIndex(r => r.id === id); if (i >= 0) registrations.splice(i, 1); } },
      executeScript: async (details: { func?: unknown; args?: string[] }) => {
        if (!details.func) return [];
        requests++;
        return [{ result: { status: 200, code: null, retryAfter: null, data: details.args?.[0] === 'claude' ? { five_hour: { utilization: 35, resets_at: null } } : { rate_limit: { primary_window: { used_percent: 21, limit_window_seconds: 18000, reset_at: null } } } } }];
      }
    }
  };
  const previous = globalThis.chrome;
  globalThis.chrome = mock as unknown as typeof chrome;
  const waitFor = async (condition: () => boolean) => { for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 5)); } assert(condition(), 'Background operation did not complete'); };
  const popup = { id: 'ext', url: 'chrome-extension://ext/popup.html' };
  const content = { id: 'ext', url: tab.url!, tab, frameId: 0 };
  const send = (message: unknown, sender: chrome.runtime.MessageSender = popup): Promise<Reply> => new Promise(r => { assert.equal(events.message.listeners.length, 1); events.message.listeners[0]!(message, sender, r); });
  try {
    await import('../src/background/index');
    await waitFor(() => alarm !== null && badge === '—');
    assert.deepEqual(alarm, { periodInMinutes: 1 }); assert.equal(requests, 0);
    const settings = defaults(); settings.enabled.chatgpt = true; settings.defaultProvider = 'chatgpt';
    const saved = await send({ type: 'settings', settings }); assert(saved.ok); assert.equal(registrations[0]?.id, 'ai-gauge-openai');
    const pushesBefore = pushes;
    const cached = await send({ type: 'view' }, content); assert(cached.ok); assert.equal(pushes, pushesBefore, 'Reading cached content view must not cause invalidation loop');
    const results = await Promise.all([send({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, content), send({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, content), send({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, content)]);
    assert(results.every(r => r.ok)); assert.equal(requests, 1); assert.equal(badge, '21%');
    const rejected = await send({ type: 'settings', settings }, content); assert.equal(rejected.ok, false);
    const beforeNavigation = pushes; tab.url = 'https://chatgpt.com/c/synthetic'; events.updated.emit(1, { url: tab.url }, tab);
    await waitFor(() => pushes > beforeNavigation && badge === '21%');
    permission = false; events.removed.emit({ origins: ['https://chatgpt.com/*'] });
    await waitFor(() => registrations.length === 0 && badge === '—');
    assert(pushedMessages.some(message => JSON.stringify(message) === JSON.stringify({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] })));
    const revoked = await send({ type: 'view' }); assert(revoked.ok); assert.equal(revoked.view.snapshots.chatgpt.state, 'permission_required');
    await send({ type: 'refresh', provider: 'chatgpt', trigger: 'manual' }); assert.equal(requests, 1);
    // Simulate a restarted worker reading only persisted settings/snapshot/attempt cooldown.
    const raw = stored['snapshot:v4:chatgpt'] as ReturnType<typeof emptySnapshot>;
    assert.equal(raw.limits[0]?.percent, 21); assert(raw.nextAttemptAt > raw.checkedAt!);
    // A real browser tab event must recover from the old persisted missing-tab
    // backoff; opening the popup alone must not create a refresh/invalidation loop.
    permission = true; settings.enabled.claude = true; settings.enabled.chatgpt = false;
    await send({ type: 'settings', settings });
    stored['snapshot:v2:claude'] = { ...emptySnapshot('claude'), errorCode: 'open_tab', checkedAt: Date.now(), nextAttemptAt: Date.now() + 3_600_000, failures: 8 };
    tab.url = 'https://claude.ai/new'; events.updated.emit(1, { status: 'complete' }, tab);
    await waitFor(() => (stored['snapshot:v2:claude'] as ReturnType<typeof emptySnapshot>)?.state === 'ok');
    assert.equal(requests, 2); assert.equal((stored['snapshot:v2:claude'] as ReturnType<typeof emptySnapshot>).limits[0]?.percent, 35);
  } finally { globalThis.chrome = previous; }
});

test('worker startup and periodic renewal publish one shared cache to ChatGPT and Codex tabs without activation', async () => {
  const bundle = buildSync({ entryPoints: ['src/background/index.ts'], bundle: true, write: false, format: 'iife', target: 'chrome120' }).outputFiles[0]!.text;
  let now = 1_790_000_000_000, requests = 0, usedPercent = 37;
  const settings = defaults(); settings.enabled.chatgpt = true;
  const payload = (percent: number) => ({ rate_limit: { primary_window: { used_percent: percent, limit_window_seconds: 604800, reset_at: null } } });
  const stored: Record<string, unknown> = {
    'migration:shared-chatgpt:v2': true,
    'settings:v2': settings,
    'snapshot:v4:chatgpt': success(emptySnapshot('chatgpt'), parseChatGPT(payload(21)), now - 2 * FRESH_MS)
  };
  const tabs = [
    { id: 1, url: 'https://chatgpt.com/c/synthetic', active: false },
    { id: 2, url: 'https://chatgpt.com/codex/cloud', active: false },
    { id: 3, url: 'https://example.com/', active: true }
  ] as chrome.tabs.Tab[];
  let alarm: { periodInMinutes: number } = { periodInMinutes: 10 };
  let release!: () => void;
  let held: Promise<void> | null = new Promise(resolve => { release = resolve; });
  const waitFor = async (condition: () => boolean) => {
    for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert(condition(), 'Shared cache worker operation did not settle');
  };
  const snapshot = () => stored['snapshot:v4:chatgpt'] as ReturnType<typeof emptySnapshot>;
  function startWorker() {
    const events = {
      message: new Event<(input: unknown, sender: chrome.runtime.MessageSender, reply: (r: Reply) => void) => boolean>(),
      installed: new Event<() => void>(), startup: new Event<() => void>(), alarm: new Event<(a: { name: string }) => void>(),
      activated: new Event<(a: { tabId: number }) => void>(), updated: new Event<() => void>(),
      focus: new Event<() => void>(), added: new Event<() => void>(), removed: new Event<() => void>()
    };
    const invalidations: number[] = [], badges: Array<{ tabId?: number; text: string }> = [];
    const registrations: Array<{ id: string }> = [];
    const api = {
      runtime: { id: 'shared-cache', onMessage: events.message, onInstalled: events.installed, onStartup: events.startup },
      storage: { local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])),
        set: async (value: Record<string, unknown>) => { Object.assign(stored, structuredClone(value)); }
      } },
      permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every(origin => origin === 'https://chatgpt.com/*'), onAdded: events.added, onRemoved: events.removed },
      alarms: { get: async () => alarm, create: async (_name: string, value: typeof alarm) => { alarm = structuredClone(value); }, onAlarm: events.alarm },
      tabs: {
        query: async (query: { url?: string; active?: boolean }) => tabs.filter(tab => (!query.url || tab.url!.startsWith(query.url.slice(0, -1))) && (!query.active || tab.active)),
        get: async (id: number) => tabs.find(tab => tab.id === id), onActivated: events.activated, onUpdated: events.updated,
        sendMessage: async (id: number, message: { type: string }) => { if (message.type === 'invalidate') invalidations.push(id); }
      },
      windows: { onFocusChanged: events.focus },
      action: { setBadgeText: async (value: { tabId?: number; text: string }) => { badges.push(structuredClone(value)); }, setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined, setTitle: async () => undefined },
      scripting: {
        getRegisteredContentScripts: async () => registrations,
        registerContentScripts: async (value: Array<{ id: string }>) => { registrations.push(...value); },
        unregisterContentScripts: async () => undefined,
        executeScript: async (details: { func?: unknown }) => {
          if (!details.func) return [];
          requests++;
          if (held) await held;
          return [{ result: { status: 200, code: null, retryAfter: null, data: payload(usedPercent) } }];
        }
      }
    };
    class Clock extends Date { static now() { return now; } }
    runInNewContext(bundle, { chrome: api, URL, Date: Clock, setTimeout, clearTimeout });
    const send = (tabId: number, message: unknown = { type: 'view' }): Promise<Reply> => {
      const tab = tabs.find(value => value.id === tabId)!;
      return new Promise(resolve => events.message.listeners[0]!(message, { id: 'shared-cache', url: tab.url!, frameId: 0, tab }, resolve));
    };
    return { events, invalidations, badges, send };
  }
  const worker = startWorker();
  await waitFor(() => requests === 1);
  assert.deepEqual(alarm, { periodInMinutes: 1 }, 'an existing ten-minute alarm must migrate to due checks');
  for (const id of [1, 2]) {
    assert(worker.invalidations.includes(id));
    assert(worker.badges.some(value => value.tabId === id && value.text === '21%'), 'publish cached usage before awaiting the API');
    const reply = await worker.send(id); assert(reply.ok);
    assert.equal(reply.view.snapshots.chatgpt.state, 'ok');
    assert.equal(reply.view.snapshots.chatgpt.limits[0]!.percent, 21);
  }
  const concurrent = [worker.send(1, { type: 'refresh', provider: 'chatgpt', trigger: 'event' }), worker.send(2, { type: 'refresh', provider: 'chatgpt', trigger: 'event' })];
  worker.events.alarm.emit({ name: 'ai-gauge-refresh' });
  release(); held = null;
  assert((await Promise.all(concurrent)).every(reply => reply.ok));
  await waitFor(() => snapshot().collectedAt === now && worker.badges.some(value => value.tabId === 2 && value.text === '37%'));
  assert.equal(requests, 1, 'startup, two tabs and a simultaneous alarm share one request');
  const first = await worker.send(1), second = await worker.send(2);
  assert(first.ok && second.ok);
  assert.deepEqual(first.view.snapshots.chatgpt, second.view.snapshots.chatgpt);
  assert.equal(first.view.snapshots.chatgpt.limits[0]!.percent, 37);
  assert(worker.badges.some(value => value.tabId === 3 && value.text === ''));

  now += FRESH_MS; usedPercent = 48;
  const previousInvalidations = worker.invalidations.length;
  worker.events.alarm.emit({ name: 'ai-gauge-refresh' });
  worker.events.alarm.emit({ name: 'ai-gauge-refresh' });
  await waitFor(() => snapshot().limits[0]!.percent === 48 && worker.invalidations.length >= previousInvalidations + 2);
  assert.equal(requests, 2, 'background tabs are renewed once without a tab activation event');
  assert.deepEqual(new Set(worker.invalidations.slice(previousInvalidations)), new Set([1, 2]));

  const restarted = startWorker();
  await waitFor(() => restarted.invalidations.length >= 2);
  const restored = await restarted.send(2); assert(restored.ok);
  assert.equal(restored.view.snapshots.chatgpt.limits[0]!.percent, 48);
  assert.equal(requests, 2, 'a new worker reuses a recent success instead of recollecting it');
  now += FRESH_MS; usedPercent = 59;
  const overdueRestart = startWorker();
  await waitFor(() => snapshot().limits[0]!.percent === 59 && overdueRestart.badges.some(value => value.tabId === 2 && value.text === '59%'));
  assert.equal(requests, 3, 'a new worker renews a due persisted cache without waiting for a tab event');
});
