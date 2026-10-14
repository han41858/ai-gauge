import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { authorized, parseMessage, type Reply } from '../src/shared/contracts';
import { ORIGINS, type Provider, type Settings, type Snapshot } from '../src/shared/types';
import { defaults } from '../src/storage/settings';

const backgroundBundle = buildSync({ entryPoints: ['src/background/index.ts'], bundle: true, write: false, format: 'iife', target: 'chrome120' }).outputFiles[0]!.text;
const popupBundle = buildSync({ entryPoints: ['src/popup/index.ts'], bundle: true, write: false, format: 'iife', target: 'chrome120' }).outputFiles[0]!.text;
const popupHtml = readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
const popupSender = { id: 'activation-fixture', url: 'chrome-extension://activation-fixture/popup.html' };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await pause(); }
  assert(condition(), 'Activation did not settle');
}
class Event<T extends unknown[]> {
  listeners: Array<(...args: T) => unknown> = [];
  addListener(listener: (...args: T) => unknown) { this.listeners.push(listener); }
  emit(...args: T) { for (const listener of this.listeners) listener(...args); }
}
function worker(initialOrigins: string[] = []) {
  const events = {
    message: new Event<[unknown, chrome.runtime.MessageSender, (reply: Reply) => void]>(),
    added: new Event<[chrome.permissions.Permissions]>(), removed: new Event<[chrome.permissions.Permissions]>(),
    installed: new Event<[]>(), startup: new Event<[]>(), alarm: new Event<[chrome.alarms.Alarm]>(),
    activated: new Event<[{ tabId: number }]>(), updated: new Event<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>(),
    focus: new Event<[number]>()
  };
  const stored: Record<string, unknown> = {}, permissions = new Set(initialOrigins);
  const registrations: chrome.scripting.RegisteredContentScript[] = [];
  const requests: Provider[] = [], messages: unknown[] = [];
  const tabs = [{ id: 1, url: 'https://chatgpt.com/', active: true }, { id: 2, url: 'https://claude.ai/new', active: false }] as chrome.tabs.Tab[];
  let badge = '', alarm: unknown = null, holdCollection: Promise<void> | null = null;
  const api = {
    runtime: { id: popupSender.id, getManifest: () => ({ version: '1.0.0' }), onMessage: events.message, onInstalled: events.installed, onStartup: events.startup },
    storage: { local: {
      get: async (key: string) => ({ [key]: structuredClone(stored[key]) }),
      set: async (value: Record<string, unknown>) => { Object.assign(stored, structuredClone(value)); }
    } },
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every(origin => permissions.has(origin)), onAdded: events.added, onRemoved: events.removed },
    alarms: { get: async () => alarm, create: async (_name: string, value: unknown) => { alarm = value; }, onAlarm: events.alarm },
    tabs: {
      query: async (query: { url?: string; active?: boolean }) => tabs.filter(tab => (!query.url || tab.url!.startsWith(query.url.slice(0, -1))) && (!query.active || tab.active)),
      get: async (id: number) => tabs.find(tab => tab.id === id), sendMessage: async () => undefined, onActivated: events.activated, onUpdated: events.updated
    },
    windows: { onFocusChanged: events.focus },
    action: { setBadgeText: async ({ text }: { text: string }) => { badge = text; }, setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined, setTitle: async () => undefined },
    scripting: {
      getRegisteredContentScripts: async () => structuredClone(registrations),
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => { registrations.push(...scripts); },
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => { for (const id of ids) { const at = registrations.findIndex(script => script.id === id); if (at >= 0) registrations.splice(at, 1); } },
      executeScript: async (details: { args?: Provider[] }) => {
        const provider = details.args?.[0];
        if (provider !== 'work_codex' && provider !== 'claude') return [];
        requests.push(provider); if (holdCollection) await holdCollection;
        return [{ result: { status: 200, code: null, retryAfter: null, data: provider === 'claude'
          ? { five_hour: { utilization: 23, resets_at: null } }
          : { rate_limit: { primary_window: { used_percent: 15, limit_window_seconds: 604800, reset_at: null } } } } }];
      }
    }
  };
  const send = (message: unknown, sender: chrome.runtime.MessageSender = popupSender): Promise<Reply> => {
    messages.push(message);
    return new Promise(resolve => events.message.listeners[0]!(message, sender, resolve));
  };
  runInNewContext(backgroundBundle, { chrome: api, URL, setTimeout, clearTimeout });
  return {
    api, events, permissions, registrations, requests, messages, send,
    ready: () => waitFor(() => !!stored.settings && badge !== ''),
    settings: () => structuredClone(stored.settings) as Settings,
    snapshot: (provider: 'work_codex' | 'claude') => structuredClone(stored[`snapshot:v2:${provider}`]) as Snapshot | undefined,
    grant(origins: string[]) { for (const origin of origins) permissions.add(origin); events.added.emit({ origins }); },
    revoke(origin: string) { permissions.delete(origin); events.removed.emit({ origins: [origin] }); },
    hold(promise: Promise<void>) { holdCollection = promise; }
  };
}
function popup(background: ReturnType<typeof worker>, grant: (permissions: chrome.permissions.Permissions) => Promise<boolean>) {
  const dom = new JSDOM(popupHtml, { runScripts: 'outside-only' });
  Object.assign(dom.window, { structuredClone, chrome: {
    runtime: { id: popupSender.id, getManifest: () => ({ version: '1.0.0' }), sendMessage: background.send },
    storage: { onChanged: { addListener() {} } },
    permissions: { request: grant }
  } });
  dom.window.eval(popupBundle);
  return dom;
}

test('activation message accepts only a provider and remains restricted to the extension popup', () => {
  const message = parseMessage({ type: 'enable', provider: 'claude' });
  assert(message); assert(authorized(message, popupSender, popupSender.id));
  assert.equal(parseMessage({ type: 'enable', provider: 'unknown' }), null);
  assert.equal(parseMessage({ type: 'enable', provider: 'claude', force: true }), null);
  assert.equal(authorized(message, { ...popupSender, id: 'other' }, popupSender.id), false);
  assert.equal(authorized(message, { id: popupSender.id, url: 'https://claude.ai/new', frameId: 0, tab: { id: 2, url: 'https://claude.ai/new' } } as chrome.runtime.MessageSender, popupSender.id), false);
});

test('visibility and disable patches accept only their exact fields and cannot be sent by site content', () => {
  const content = { id: popupSender.id, url: 'https://claude.ai/new', frameId: 0, tab: { id: 2, url: 'https://claude.ai/new' } } as chrome.runtime.MessageSender;
  for (const raw of [{ type: 'disable', provider: 'claude' }, { type: 'strips', strips: defaults().strips }]) {
    const message = parseMessage(raw);
    assert(message); assert(authorized(message, popupSender, popupSender.id));
    assert.equal(authorized(message, content, popupSender.id), false);
  }
  for (const malformed of [
    { type: 'disable', provider: 'unknown' }, { type: 'disable', provider: 'claude', enabled: true },
    { type: 'strips', strips: { chatgpt: true } },
    { type: 'strips', strips: { ...defaults().strips, extra: false } },
    { type: 'strips', strips: { ...defaults().strips, claude: 'yes' } },
    { type: 'strips', strips: defaults().strips, settings: defaults() }
  ]) assert.equal(parseMessage(malformed), null);
});

test('a single permission click activates and collects in the worker even if the popup closes before its promise resolves', async () => {
  const background = worker(); await background.ready();
  let insideClick = false, requestedDuringClick = false;
  const dom = popup(background, permissions => {
    requestedDuringClick = insideClick;
    background.grant(permissions.origins!);
    return new Promise<boolean>(() => {});
  });
  await waitFor(() => dom.window.document.querySelectorAll('.grant').length === 2);
  insideClick = true;
  dom.window.document.querySelector<HTMLButtonElement>('[data-provider="work_codex"] .grant')!.click();
  insideClick = false; dom.window.close();
  await waitFor(() => background.snapshot('work_codex')?.state === 'ok');
  assert.equal(requestedDuringClick, true, 'permission request must retain the direct user gesture');
  assert.equal(background.settings().enabled.work_codex, true);
  assert.equal(background.settings().enabled.chatgpt, false);
  assert.deepEqual(background.requests, ['work_codex']);
  assert(!background.messages.some(message => (message as { type: string }).type === 'enable'), 'closed popup must not be needed to complete activation');
  assert(background.registrations.some(script => script.id === 'ai-gauge-openai'));
  assert(!background.registrations.some(script => script.id === 'ai-gauge-chatgpt-observer'));
  const reopened = popup(background, async () => true);
  try {
    await waitFor(() => reopened.window.document.querySelectorAll('.card').length === 2);
    assert.equal(reopened.window.document.querySelector('[data-provider="work_codex"] .grant'), null);
    assert.match(reopened.window.document.querySelector('[data-provider="work_codex"]')!.textContent!, /15%/);
  } finally { reopened.window.close(); }
});

test('denying a permission request leaves the provider off and performs no collection', async () => {
  const background = worker(); await background.ready();
  const dom = popup(background, async () => false);
  try {
    await waitFor(() => dom.window.document.querySelectorAll('.grant').length === 2);
    dom.window.document.querySelector<HTMLButtonElement>('[data-provider="claude"] .grant')!.click();
    await waitFor(() => dom.window.document.getElementById('feedback')!.textContent!.includes('취소'));
    assert.equal(background.settings().enabled.claude, false);
    assert.deepEqual(background.requests, []);
    assert(!background.messages.some(message => (message as { type: string }).type === 'enable'));
  } finally { dom.window.close(); }
});

test('already-granted permission still needs explicit activation, and one enable click is enough', async () => {
  const background = worker([ORIGINS.claude]); await background.ready();
  assert.equal(background.settings().enabled.claude, false, 'worker initialization must not enable a previously disabled provider');
  const dom = popup(background, async () => true);
  try {
    await waitFor(() => dom.window.document.querySelectorAll('.card').length === 2);
    const button = dom.window.document.querySelector<HTMLButtonElement>('[data-provider="claude"] .grant')!;
    assert.equal(button.textContent, '켜기'); button.click();
    await waitFor(() => background.snapshot('claude')?.state === 'ok');
    await waitFor(() => dom.window.document.querySelector('[data-provider="claude"] .grant') === null);
    assert.equal(background.settings().enabled.claude, true);
    assert.equal(background.messages.filter(message => (message as { type: string }).type === 'enable').length, 1);
    assert.deepEqual(background.requests, ['claude']);
    const settings = background.settings(); settings.enabled.claude = false;
    await background.send({ type: 'settings', settings }); background.events.startup.emit();
    await pause(); await pause();
    assert.equal(background.settings().enabled.claude, false, 'startup repair must preserve an explicit off setting');
  } finally { dom.window.close(); }
});

test('concurrent grants preserve both enabled sources without enabling the experimental observer', async () => {
  const background = worker(); await background.ready();
  background.grant([ORIGINS.work_codex]); background.grant([ORIGINS.claude]);
  await waitFor(() => background.snapshot('work_codex')?.state === 'ok' && background.snapshot('claude')?.state === 'ok');
  assert.deepEqual(background.settings().enabled, { chatgpt: false, work_codex: true, claude: true });
  assert.equal(background.requests.filter(provider => provider === 'work_codex').length, 1);
  assert.equal(background.requests.filter(provider => provider === 'claude').length, 1);
});

test('a grant event without the actual host permission cannot activate or collect', async () => {
  const background = worker(); await background.ready();
  background.events.added.emit({ origins: [ORIGINS.claude, 'https://unrelated.invalid/*'] });
  const reply = await background.send({ type: 'enable', provider: 'claude' });
  assert(reply.ok); assert.equal(reply.view.settings.enabled.claude, false);
  assert.deepEqual(background.requests, []);
  assert.deepEqual(background.settings(), defaults());
});

for (const interruption of ['disable', 'revoke'] as const) {
  test(`late activation collection cannot publish after ${interruption}`, async () => {
    const background = worker([ORIGINS.work_codex]); await background.ready();
    let finish!: () => void;
    background.hold(new Promise<void>(resolve => { finish = resolve; }));
    const pending = background.send({ type: 'enable', provider: 'work_codex' });
    await waitFor(() => background.requests.length === 1);
    if (interruption === 'disable') {
      const saved = await background.send({ type: 'disable', provider: 'work_codex' }); assert(saved.ok);
    } else background.revoke(ORIGINS.work_codex);
    finish(); const reply = await pending; assert(reply.ok);
    assert.equal(background.snapshot('work_codex')?.collectedAt, null);
    assert.deepEqual(background.snapshot('work_codex')?.limits, []);
    await waitFor(() => !background.registrations.some(script => script.id === 'ai-gauge-openai'));
    if (interruption === 'disable') assert.equal(reply.view.settings.enabled.work_codex, false);
    else assert.equal(reply.view.permissions.work_codex, false);
  });
}

for (const operation of ['strips', 'disable'] as const) {
  test(`popup ${operation} changes preserve a concurrent activation instead of overwriting its enabled state`, async () => {
    const background = worker([ORIGINS.claude]); await background.ready();
    if (operation === 'disable') await background.send({ type: 'enable', provider: 'claude' });
    const send = background.send;
    let holdNext = false, release: (() => void) | undefined;
    background.send = async (message, sender) => {
      const type = (message as { type: string }).type;
      if (holdNext && (type === 'view' || type === operation)) {
        holdNext = false;
        // The old popup read a whole view and later sent stale settings. Keep
        // that reply for the regression; the new patch is delayed before send.
        const oldView = type === 'view' ? await send(message, sender) : null;
        await new Promise<void>(resolve => { release = resolve; });
        return oldView ?? send(message, sender);
      }
      return send(message, sender);
    };
    const dom = popup(background, async () => false);
    try {
      await waitFor(() => dom.window.document.querySelectorAll('.card').length === 2);
      const before = background.settings();
      holdNext = true;
      if (operation === 'strips') {
        const checkbox = dom.window.document.getElementById('strip-chatgpt') as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        dom.window.document.getElementById('settings-form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      } else {
        [...dom.window.document.querySelectorAll<HTMLButtonElement>('[data-provider="claude"] button')]
          .find(button => button.textContent === '끄기')!.click();
      }
      await waitFor(() => !!release);
      background.grant([ORIGINS.work_codex]);
      await waitFor(() => background.snapshot('work_codex')?.state === 'ok');
      assert.equal(background.settings().enabled.work_codex, true);
      release!();
      await waitFor(() => operation === 'strips' ? background.settings().strips.chatgpt === false : !background.settings().enabled.claude);
      const current = background.settings();
      assert.equal(current.enabled.work_codex, true, 'changing another setting must preserve the newly activated provider');
      assert.equal(current.enabled.chatgpt, before.enabled.chatgpt);
      if (operation === 'strips') assert.equal(current.enabled.claude, before.enabled.claude);
      else assert.deepEqual(current.strips, before.strips);
      assert(!background.messages.some(message => (message as { type: string }).type === 'settings'), 'popup edits must use narrow patches');
    } finally { release?.(); dom.window.close(); }
  });
}
