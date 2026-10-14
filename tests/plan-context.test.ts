import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import { parseChatGPT } from '../src/providers/parsers';
import type { Provider, Snapshot } from '../src/shared/types';
import type { Reply } from '../src/shared/contracts';

class Event<T extends (...args: never[]) => unknown = (...args: never[]) => unknown> {
  listeners: T[] = [];
  addListener(fn: T) { this.listeners.push(fn); }
  emit(...args: Parameters<T>) { for (const listener of this.listeners) listener(...args); }
}
const keys: Record<Provider, string> = { chatgpt: 'snapshot:v4:chatgpt', claude: 'snapshot:v2:claude', gemini: 'snapshot:v1:gemini' };
const labels: Record<Provider, string> = { chatgpt: 'Plus', claude: 'Pro', gemini: 'AI Pro' };
const payload = (plan = 'plus') => ({ plan_type: plan, rate_limit: { primary_window: { used_percent: 27, limit_window_seconds: 18000, reset_at: null } } });
const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert(condition(), 'Plan lifecycle operation did not settle');
};
function worker() {
  let now = 1_800_000_000_000, requests = 0, responsePlan = 'plus';
  let hold: Promise<void> | null = null, release: (() => void) | null = null;
  const tabs = [
    { id: 1, url: 'https://chatgpt.com/', active: true },
    { id: 2, url: 'https://chatgpt.com/codex/cloud', active: false },
    { id: 3, url: 'https://claude.ai/new', active: false },
    { id: 4, url: 'https://gemini.google.com/app', active: false },
    { id: 5, url: 'https://example.com/', active: false }
  ] as chrome.tabs.Tab[];
  const settings = defaults();
  settings.enabled = { chatgpt: true, claude: true, gemini: true };
  const stored: Record<string, unknown> = { 'settings:v2': settings, 'migration:shared-chatgpt:v2': true };
  const seed = (provider: Provider) => {
    stored[keys[provider]] = { ...emptySnapshot(provider), state: 'ok', errorCode: null,
      limits: parseChatGPT(payload()), checkedAt: now, collectedAt: now, nextAttemptAt: now + 60_000,
      plan: { label: labels[provider], checkedAt: now } } satisfies Snapshot;
  };
  for (const provider of ['chatgpt', 'claude', 'gemini'] as const) seed(provider);
  const snapshot = (provider: Provider) => stored[keys[provider]] as Snapshot;
  const events = {
    message: new Event<(input: unknown, sender: chrome.runtime.MessageSender, reply: (r: Reply) => void) => boolean>(),
    installed: new Event<() => void>(), startup: new Event<() => void>(), alarm: new Event<(a: { name: string }) => void>(),
    activated: new Event<(a: { tabId: number }) => void>(),
    updated: new Event<(id: number, change: { status?: string; url?: string }, tab: chrome.tabs.Tab) => void>(),
    focus: new Event<(windowId: number) => void>(), added: new Event<() => void>(), removed: new Event<() => void>()
  };
  let pushes = 0;
  const registrations: Array<{ id: string }> = [];
  const api = {
    runtime: { id: 'plan-context', onMessage: events.message, onInstalled: events.installed, onStartup: events.startup },
    storage: { local: {
      get: async (names: string | string[]) => Object.fromEntries((Array.isArray(names) ? names : [names]).map(name => [name, structuredClone(stored[name])])),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }
    } },
    permissions: { contains: async () => true, onAdded: events.added, onRemoved: events.removed },
    alarms: { get: async () => ({ periodInMinutes: 1 }), create: async () => undefined, onAlarm: events.alarm },
    tabs: {
      query: async (query: { url?: string; active?: boolean }) => tabs.filter(tab => (!query.url || tab.url!.startsWith(query.url.slice(0, -1))) && (!query.active || tab.active)),
      get: async (id: number) => tabs.find(tab => tab.id === id), onActivated: events.activated, onUpdated: events.updated,
      sendMessage: async () => { pushes++; }
    },
    windows: { onFocusChanged: events.focus },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined, setTitle: async () => undefined },
    scripting: {
      getRegisteredContentScripts: async () => registrations,
      registerContentScripts: async (values: Array<{ id: string }>) => { registrations.push(...values); },
      unregisterContentScripts: async () => undefined,
      executeScript: async (details: { func?: unknown }) => {
        if (!details.func) return [];
        requests++;
        const plan = responsePlan;
        if (hold) await hold;
        return [{ result: { status: 200, code: null, retryAfter: null, data: payload(plan) } }];
      }
    }
  };
  class Clock extends Date { static now() { return now; } }
  const bundle = buildSync({ entryPoints: ['src/background/index.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' }).outputFiles[0]!.text;
  runInNewContext(bundle, { chrome: api, URL, Date: Clock, setTimeout, clearTimeout });
  const send = (message: unknown, tabId?: number): Promise<Reply> => {
    const tab = tabs.find(value => value.id === tabId);
    const sender = tab ? { id: 'plan-context', url: tab.url!, tab, frameId: 0 } : { id: 'plan-context', url: 'chrome-extension://plan-context/popup.html' };
    return new Promise(resolve => events.message.listeners[0]!(message, sender, resolve));
  };
  return { tabs, events, stored, seed, snapshot, send, requests: () => requests, pushes: () => pushes,
    advance: () => { now += 60_001; }, responsePlan: (plan: string) => { responsePlan = plan; },
    hold: () => { hold = new Promise(resolve => { release = resolve; }); },
    release: () => { release?.(); hold = null; },
    activate: (id: number) => { for (const tab of tabs) tab.active = tab.id === id; events.activated.emit({ tabId: id }); }
  };
}

test('context changes clear only that provider plan, preserve usage and honor cooldowns', async () => {
  const w = worker();
  await waitFor(() => w.pushes() >= 4);
  const popup = await w.send({ type: 'view' });
  assert(popup.ok); assert.equal(popup.view.snapshots.chatgpt.plan?.label, 'Plus');
  assert.equal(w.requests(), 0, 'a cached popup read must retain the current plan');

  w.activate(2);
  await waitFor(() => w.snapshot('chatgpt').plan === null);
  assert.equal(w.snapshot('chatgpt').limits[0]!.percent, 27);
  assert.equal(w.snapshot('claude').plan?.label, 'Pro');
  assert.equal(w.snapshot('gemini').plan?.label, 'AI Pro');
  assert.equal(w.requests(), 0, 'switching to Codex does not bypass the shared usage cooldown');

  const gemini = w.tabs[3]!;
  w.events.updated.emit(gemini.id!, { status: 'loading' }, gemini);
  await waitFor(() => w.snapshot('gemini').plan === null);
  assert.equal(w.snapshot('gemini').limits[0]!.percent, 27, 'background navigation keeps usage');
  const claude = w.tabs[2]!;
  w.events.updated.emit(claude.id!, { url: claude.url! }, claude);
  await waitFor(() => w.snapshot('claude').plan === null);
  assert.equal(w.requests(), 0, 'background navigation does not fetch');

  w.seed('chatgpt');
  const switched = await w.send({ type: 'context', provider: 'chatgpt' }, 2);
  assert(switched.ok); assert.equal(switched.view.snapshots.chatgpt.plan, null);
  assert.equal(switched.view.snapshots.chatgpt.limits[0]!.percent, 27);
  assert.equal(w.requests(), 0);
  assert.equal((await w.send({ type: 'context', provider: 'claude' }, 2)).ok, false, 'one site cannot invalidate another site plan');
  assert.equal((await w.send({ type: 'context', provider: 'chatgpt' })).ok, false, 'popup cannot pretend to be a site context');
  assert(!JSON.stringify(w.stored).includes('https://'), 'plan lifecycle never stores tab URLs or account identifiers');
});

test('window return invalidates the active service plan without touching unrelated sites', async () => {
  const w = worker();
  await waitFor(() => w.pushes() >= 4);
  w.events.focus.emit(-1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(w.snapshot('chatgpt').plan?.label, 'Plus', 'losing Chrome focus does not invalidate');
  w.events.focus.emit(1);
  await waitFor(() => w.snapshot('chatgpt').plan === null);
  assert.equal(w.snapshot('claude').plan?.label, 'Pro');
  w.seed('chatgpt'); w.activate(5);
  const pushed = w.pushes(); w.events.focus.emit(1);
  await waitFor(() => w.pushes() > pushed);
  assert.equal(w.snapshot('chatgpt').plan?.label, 'Plus');
  assert.equal(w.requests(), 0);
});

test('new collection updates subscription but a late pre-navigation plan cannot reappear', async () => {
  const w = worker();
  await waitFor(() => w.pushes() >= 4);
  w.advance(); w.responsePlan('go');
  const changed = await w.send({ type: 'context', provider: 'chatgpt' }, 1);
  assert(changed.ok); assert.equal(changed.view.snapshots.chatgpt.plan?.label, 'Go');
  assert.equal(changed.view.snapshots.chatgpt.limits[0]!.percent, 27);
  assert.equal(w.requests(), 1);

  w.advance(); w.responsePlan('plus'); w.hold();
  const pending = w.send({ type: 'refresh', provider: 'chatgpt', trigger: 'event' }, 1);
  await waitFor(() => w.requests() === 2);
  const pushed = w.pushes();
  w.events.updated.emit(1, { status: 'loading' }, w.tabs[0]!);
  await waitFor(() => w.pushes() > pushed);
  w.release();
  const old = await pending;
  assert(old.ok); assert.equal(old.view.snapshots.chatgpt.plan, null, 'old account plan is dropped after navigation');
  assert.equal(old.view.snapshots.chatgpt.state, 'ok');
  assert.equal(old.view.snapshots.chatgpt.limits[0]!.percent, 27, 'plan invalidation does not fail usage');
  assert.equal(w.snapshot('chatgpt').plan, null);
  assert.equal(w.requests(), 2, 'the lifecycle signal does not create an extra provider request');
});
