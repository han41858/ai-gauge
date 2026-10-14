import { ORIGINS, PROVIDERS, SITE_GROUPS, providerFromUrl, type Provider, type Settings, type View } from '../shared/types';
import { authorized, parseMessage, type Reply } from '../shared/contracts';
import { readSettings, writeSettings, migrateStorage, readSnapshot, writeSnapshot, readView } from '../storage/snapshots';
import { parseSettings } from '../storage/settings';
import { collect } from '../providers';
import { Scheduler, type Trigger } from './scheduler';
import { updateBadge } from './badge';
import { reconcileContent } from './content-registration';
import { displayProvider } from '../shared/display-policy';

const scheduler = new Scheduler({ read: readSnapshot, write: writeSnapshot, collect, now: Date.now, enabled: async p => (await readSettings()).enabled[p] && await chrome.permissions.contains({ origins: [ORIGINS[p]] }) });
const ALARM = 'ai-gauge-refresh';
let setupFlight: Promise<void> | null = null;
let setupDirty = false;
function reconcile(): Promise<void> {
  setupDirty = true;
  if (setupFlight) return setupFlight;
  setupFlight = (async () => {
    while (setupDirty) { setupDirty = false; await reconcileContent(await readView()); }
  })().finally(() => { setupFlight = null; });
  return setupFlight;
}
async function publish(): Promise<View> {
  const view = await readView();
  await updateBadge(view);
  // Push only an invalidation signal, not usage payloads into tabs.
  await Promise.all(SITE_GROUPS.map(async site => {
    if (!site.providers.some(p => view.permissions[displayProvider(p)])) return;
    const tabs = await chrome.tabs.query({ url: site.origin });
    await Promise.all(tabs.filter(t => typeof t.id === 'number' && !t.discarded).map(t => chrome.tabs.sendMessage(t.id!, { type: 'invalidate' }).catch(() => undefined)));
  }));
  return view;
}
async function refresh(p: Provider, trigger: Trigger) { await scheduler.refresh(p, trigger); }
async function refreshAll(trigger: Trigger) { await Promise.all(PROVIDERS.map(p => refresh(p, trigger))); await publish(); }
let settingsWrites = Promise.resolve();
function queueSettingsWrite(write: () => Promise<void>): Promise<void> {
  const task = settingsWrites.then(write);
  settingsWrites = task.catch(() => undefined);
  return task;
}
function changeSettings(change: (settings: Settings) => void | Promise<void>): Promise<void> {
  return queueSettingsWrite(async () => {
    const settings = await readSettings();
    await change(settings);
    await writeSettings(parseSettings(settings));
  });
}
async function enableProvider(provider: Provider) {
  let granted = false;
  await changeSettings(async settings => {
    granted = await chrome.permissions.contains({ origins: [ORIGINS[provider]] });
    if (granted) settings.enabled[provider] = true;
  });
  if (!granted) return;
  await reconcile();
  await refresh(provider, 'manual');
}
async function initialize() {
  // Check retry/reset deadlines each minute; the scheduler keeps normal
  // collection at ten minutes and enforces persisted cooldowns across workers.
  if ((await chrome.alarms.get(ALARM))?.periodInMinutes !== 1) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  await queueSettingsWrite(async () => {
    await migrateStorage();
  });
  await reconcile();
  await publish();
  await refreshAll('periodic');
}
chrome.runtime.onMessage.addListener((input: unknown, sender, sendResponse: (reply: Reply) => void) => {
  const message = parseMessage(input);
  if (!message || !authorized(message, sender, chrome.runtime.id)) { sendResponse({ ok: false }); return false; }
  void (async () => {
    if (sender.tab) {
      const p = providerFromUrl(sender.url)!;
      if (!await chrome.permissions.contains({ origins: [ORIGINS[displayProvider(p)]] })) return { ok: false } as Reply;
    }
    if (message.type === 'settings' || message.type === 'strips' || message.type === 'disable') {
      await changeSettings(settings => {
        if (message.type === 'strips') settings.strips = { ...message.strips };
        else if (message.type === 'disable') settings.enabled[message.provider] = false;
        else Object.assign(settings, parseSettings(message.settings));
      });
      await reconcile();
    }
    if (message.type === 'enable') await enableProvider(message.provider);
    if (message.type === 'refresh') await refresh(message.provider, message.trigger);
    if (message.type === 'view' && !sender.tab) void refreshAll('event').catch(() => undefined);
    const view = message.type === 'view' ? await readView() : await publish();
    return { ok: true, view } as Reply;
  })().then(sendResponse).catch(() => sendResponse({ ok: false }));
  return true;
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) void refreshAll('periodic').catch(() => undefined); });
chrome.runtime.onInstalled.addListener(() => { void initialize().catch(() => undefined); });
chrome.runtime.onStartup.addListener(() => { void initialize().catch(() => undefined); });
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then(async tab => { const p = providerFromUrl(tab.url); if (p) await refresh(displayProvider(p), 'tab'); await publish(); }).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.status === 'complete' || change.url) void (async () => { const p = providerFromUrl(tab.url); if (p && tab.active) await refresh(displayProvider(p), 'tab'); await publish(); })().catch(() => undefined);
});
chrome.windows.onFocusChanged.addListener(() => { void updateBadgeFromFocus().catch(() => undefined); });
async function updateBadgeFromFocus() { const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); const p = providerFromUrl(tabs[0]?.url); if (p) await refresh(displayProvider(p), 'tab'); await publish(); }
chrome.permissions.onAdded.addListener(added => {
  // Chrome may close the popup while showing its permission dialog. Complete
  // the granted site's activation in the worker instead of relying on that UI.
  const providers = PROVIDERS.filter(provider => added.origins?.includes(ORIGINS[provider]));
  void (async () => {
    await Promise.all(providers.map(enableProvider));
    await reconcile();
    await publish();
  })().catch(() => undefined);
});
chrome.permissions.onRemoved.addListener(removed => {
  // A revoked host no longer exposes its tab URL. Notify tab IDs without reading URLs/history.
  const origins = (removed?.origins ?? []).filter(origin => SITE_GROUPS.some(site => site.origin === origin));
  void chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(t => typeof t.id === 'number').map(t => chrome.tabs.sendMessage(t.id!, { type: 'permissions-revoked', origins }).catch(() => undefined)))).catch(() => undefined);
  void reconcile().then(publish).catch(() => undefined);
});
// Top-level repair handles worker restart too, rather than relying only on onStartup.
void initialize().catch(() => undefined);
