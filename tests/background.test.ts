import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
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
    storage: { local: { get: async (key: string) => ({ [key]: stored[key] }), set: async (value: Record<string, unknown>) => { Object.assign(stored, value); } } },
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
    assert.deepEqual(alarm, { periodInMinutes: 10 }); assert.equal(requests, 0);
    const settings = defaults(); settings.enabled.work_codex = true; settings.defaultProvider = 'work_codex';
    const saved = await send({ type: 'settings', settings }); assert(saved.ok); assert.equal(registrations[0]?.id, 'ai-gauge-openai');
    const pushesBefore = pushes;
    const cached = await send({ type: 'view' }, content); assert(cached.ok); assert.equal(pushes, pushesBefore, 'Reading cached content view must not cause invalidation loop');
    const results = await Promise.all([send({ type: 'refresh', provider: 'work_codex', trigger: 'event' }, content), send({ type: 'refresh', provider: 'work_codex', trigger: 'event' }, content), send({ type: 'refresh', provider: 'work_codex', trigger: 'event' }, content)]);
    assert(results.every(r => r.ok)); assert.equal(requests, 1); assert.equal(badge, '21%');
    const rejected = await send({ type: 'settings', settings }, content); assert.equal(rejected.ok, false);
    const beforeNavigation = pushes; tab.url = 'https://chatgpt.com/c/synthetic'; events.updated.emit(1, { url: tab.url }, tab);
    await waitFor(() => pushes > beforeNavigation && badge === '21%');
    permission = false; events.removed.emit({ origins: ['https://chatgpt.com/*'] });
    await waitFor(() => registrations.length === 0 && badge === '—');
    assert(pushedMessages.some(message => JSON.stringify(message) === JSON.stringify({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] })));
    const revoked = await send({ type: 'view' }); assert(revoked.ok); assert.equal(revoked.view.snapshots.work_codex.state, 'permission_required');
    await send({ type: 'refresh', provider: 'work_codex', trigger: 'manual' }); assert.equal(requests, 1);
    // Simulate a restarted worker reading only persisted settings/snapshot/attempt cooldown.
    const raw = stored['snapshot:v2:work_codex'] as ReturnType<typeof emptySnapshot>;
    assert.equal(raw.limits[0]?.percent, 21); assert(raw.nextAttemptAt > raw.checkedAt!);
    // A real browser tab event must recover from the old persisted missing-tab
    // backoff; opening the popup alone must not create a refresh/invalidation loop.
    permission = true; settings.enabled.claude = true; settings.enabled.work_codex = false;
    await send({ type: 'settings', settings });
    stored['snapshot:v2:claude'] = { ...emptySnapshot('claude'), errorCode: 'open_tab', checkedAt: Date.now(), nextAttemptAt: Date.now() + 3_600_000, failures: 8 };
    tab.url = 'https://claude.ai/new'; events.updated.emit(1, { status: 'complete' }, tab);
    await waitFor(() => (stored['snapshot:v2:claude'] as ReturnType<typeof emptySnapshot>)?.state === 'ok');
    assert.equal(requests, 2); assert.equal((stored['snapshot:v2:claude'] as ReturnType<typeof emptySnapshot>).limits[0]?.percent, 35);
  } finally { globalThis.chrome = previous; }
});
