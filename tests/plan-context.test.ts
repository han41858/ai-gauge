import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import { parseChatGPT } from '../src/providers/parsers';
import type { Provider, Snapshot } from '../src/shared/types';
import type { Reply } from '../src/shared/contracts';
import { ticketSummary } from '../src/shared/tickets';

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
function worker(ticketSeed = false) {
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
      plan: { label: labels[provider], checkedAt: now },
      ...(ticketSeed && provider !== 'gemini' ? { tickets: { checkedAt: now, failures: 0, inventory: {
        mode: 'summary' as const, grants: [{ kind: 'unspecified' as const, count: 2, startsAt: null, expiresAt: null,
          usableNow: null, clears: [], requiresLimit: null, blocked: null, selected: null }], usableCount: null, cooldownUntil: null
      } } } : {}) } satisfies Snapshot;
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

test('tab activation, initial content attachment and SPA routes preserve each fresh provider plan during cooldown', async () => {
  const w = worker();
  await waitFor(() => w.pushes() >= 4);
  const popup = await w.send({ type: 'view' });
  assert(popup.ok); assert.equal(popup.view.snapshots.chatgpt.plan?.label, 'Plus');
  assert.equal(w.requests(), 0, 'a cached popup read must retain the current plan');

  w.activate(2);
  const attached = await w.send({ type: 'context', provider: 'chatgpt' }, 2);
  assert(attached.ok); assert.equal(attached.view.snapshots.chatgpt.plan?.label, 'Plus');
  assert.equal(w.snapshot('chatgpt').limits[0]!.percent, 27);
  assert.equal(w.snapshot('claude').plan?.label, 'Pro');
  assert.equal(w.snapshot('gemini').plan?.label, 'AI Pro');
  assert.equal(w.requests(), 0, 'switching to Codex does not bypass the shared usage cooldown');

  for (const [provider, id] of [['chatgpt', 2], ['claude', 3], ['gemini', 4]] as const) {
    w.activate(id);
    const tab = w.tabs.find(value => value.id === id)!;
    const pushed = w.pushes();
    w.events.updated.emit(id, { url: tab.url! }, tab);
    await waitFor(() => w.pushes() > pushed);
    const route = await w.send({ type: 'context', provider }, id);
    assert(route.ok); assert.equal(route.view.snapshots[provider].plan?.label, labels[provider]);
    assert.equal(route.view.snapshots[provider].limits[0]!.percent, 27);
    assert.notEqual(route.view.snapshots[provider].planRefreshPending, true);
  }
  assert.equal(w.requests(), 0);
  assert.equal((await w.send({ type: 'context', provider: 'claude' }, 2)).ok, false, 'one site cannot invalidate another site plan');
  assert.equal((await w.send({ type: 'context', provider: 'chatgpt' })).ok, false, 'popup cannot pretend to be a site context');
  assert(!JSON.stringify(w.stored).includes('https://'), 'plan lifecycle never stores tab URLs or account identifiers');
});

test('returning to Chrome and opening the popup do not erase a freshly collected plan', async () => {
  const w = worker();
  await waitFor(() => w.pushes() >= 4);
  w.events.focus.emit(-1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(w.snapshot('chatgpt').plan?.label, 'Plus', 'losing Chrome focus does not invalidate');
  const returned = w.pushes(); w.events.focus.emit(1);
  await waitFor(() => w.pushes() > returned);
  const popup = await w.send({ type: 'view' });
  assert(popup.ok); assert.equal(popup.view.snapshots.chatgpt.plan?.label, 'Plus');
  assert.equal(w.snapshot('claude').plan?.label, 'Pro');
  w.seed('chatgpt'); w.activate(5);
  const pushed = w.pushes(); w.events.focus.emit(1);
  await waitFor(() => w.pushes() > pushed);
  assert.equal(w.snapshot('chatgpt').plan?.label, 'Plus');
  assert.equal(w.requests(), 0);
});

test('new-tab attachment, window focus and SPA navigation during one request do not discard its successful plan', async () => {
  const w = worker();
  await waitFor(() => w.pushes() >= 4);
  w.advance(); w.responsePlan('promax'); w.hold();
  w.activate(2);
  await waitFor(() => w.requests() === 1);
  const initial = w.send({ type: 'context', provider: 'chatgpt' }, 2);
  w.events.focus.emit(1);
  const codex = w.tabs[1]!;
  w.events.updated.emit(2, { url: codex.url! }, codex);
  const route = w.send({ type: 'context', provider: 'chatgpt' }, 2);
  w.release();
  const replies = await Promise.all([initial, route]);
  for (const reply of replies) {
    assert(reply.ok); assert.equal(reply.view.snapshots.chatgpt.plan?.label, 'Pro 500');
  }
  const popup = await w.send({ type: 'view' });
  assert(popup.ok); assert.equal(popup.view.snapshots.chatgpt.plan?.label, 'Pro 500');
  assert.equal(w.snapshot('chatgpt').planRefreshPending, false);
  assert.equal(w.requests(), 1, 'all lifecycle reads share one provider collection');
});

test('a real document load clears the potentially previous account plan and preserves quota and cooldowns', async () => {
  const w = worker();
  await waitFor(() => w.pushes() >= 4);
  for (const [provider, id] of [['chatgpt', 1], ['claude', 3], ['gemini', 4]] as const) {
    const tab = w.tabs.find(value => value.id === id)!;
    w.events.updated.emit(id, { status: 'loading' }, tab);
    await waitFor(() => w.snapshot(provider).plan === null);
    assert.equal(w.snapshot(provider).planRefreshPending, true);
    const attached = await w.send({ type: 'context', provider }, id);
    assert(attached.ok); assert.equal(attached.view.snapshots[provider].plan, null);
    assert.equal(attached.view.snapshots[provider].limits[0]!.percent, 27);
  }
  assert.equal(w.requests(), 0, 'document loading cannot bypass the existing retry deadline');
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

test('an immediate popup view waits for restart ticket quarantine without hiding valid usage or plans', async () => {
  const w = worker(true);
  const reply = await w.send({ type: 'view' });
  assert(reply.ok);
  for (const provider of ['chatgpt', 'claude'] as const) {
    const snapshot: Snapshot = reply.view.snapshots[provider];
    assert.equal(snapshot.ticketRefreshPending, true);
    assert.equal(ticketSummary(snapshot, 1_800_000_000_000), null);
    assert.equal(snapshot.tickets?.inventory.grants[0]?.count, 2, 'the cache remains stored without its expired worker trust');
    assert.equal(snapshot.limits[0]?.percent, 27);
    assert.equal(snapshot.plan?.label, labels[provider]);
  }
  assert.equal(w.requests(), 0, 'quarantine must respect the existing collection gate');
});
