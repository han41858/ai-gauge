import { ORIGINS, PROVIDERS, SITE_GROUPS, providerFromUrl, type Provider, type Settings, type View } from '../shared/types';
import { authorized, parseMessage, type Reply } from '../shared/contracts';
import { readSettings, writeSettings, migrateStorage, readSnapshot, writeSnapshot, readView as storedView } from '../storage/snapshots';
import { parseSettings } from '../storage/settings';
import { collect } from '../providers';
import { Scheduler, type Trigger } from './scheduler';
import { updateBadge } from './badge';
import { reconcileContent } from './content-registration';
import { displayProvider } from '../shared/display-policy';
import { readTicketTrust, writeTicketTrust } from '../storage/ticket-trust';

const scheduler = new Scheduler({ read: readSnapshot, write: writeSnapshot, collect, readTicketTrust, writeTicketTrust,
  now: Date.now, enabled: async p => (await readSettings()).enabled[p] && await chrome.permissions.contains({ origins: [ORIGINS[p]] }) });
const ticketReadiness = scheduler.prepareTickets();
async function readView(): Promise<View> { await ticketReadiness; return storedView(); }
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
let publishedKey: string | null = null;
/** Pushes badges and a tab invalidation only when the readable view changed (or when forced). */
async function publish(force = false): Promise<View> {
  const view = await readView(), key = JSON.stringify(view);
  if (!force && key === publishedKey) return view;
  publishedKey = key;
  await updateBadge(view);
  // Push only an invalidation signal, not usage payloads into tabs.
  await Promise.all(SITE_GROUPS.map(async site => {
    if (!site.providers.some(p => view.permissions[displayProvider(p)])) return;
    const tabs = await chrome.tabs.query({ url: site.origin });
    await Promise.all(tabs.filter(t => typeof t.id === 'number' && !t.discarded).map(t => chrome.tabs.sendMessage(t.id!, { type: 'invalidate' }).catch(() => undefined)));
  }));
  return view;
}
/** A navigated or activated tab needs its own badge even when the shared view is unchanged. */
async function publishTab(tabId: number): Promise<void> {
  const view = await publish();
  await updateBadge(view, [tabId]);
}
async function refresh(p: Provider, trigger: Trigger) { await ticketReadiness; await scheduler.refresh(p, trigger); }
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
async function enableProviders(providers: Provider[]) {
  const granted: Provider[] = [];
  await changeSettings(async settings => {
    for (const provider of providers) {
      if (await chrome.permissions.contains({ origins: [ORIGINS[provider]] })) {
        settings.enabled[provider] = true;
        granted.push(provider);
      }
    }
  });
  if (!granted.length) return;
  await reconcile();
  await Promise.all(granted.map(provider => refresh(provider, 'manual')));
}
async function initialize() {
  // Check retry/reset deadlines each minute; the scheduler keeps normal
  // collection at ten minutes and enforces persisted cooldowns across workers.
  if ((await chrome.alarms.get(ALARM))?.periodInMinutes !== 1) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  await queueSettingsWrite(async () => {
    await migrateStorage();
  });
  await reconcile();
  await publish(true);
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
    if (message.type === 'display-settings' || message.type === 'disable') {
      await changeSettings(settings => {
        if (message.type === 'display-settings') { settings.strips = { ...message.strips }; settings.language = message.language; settings.warning = message.warning; settings.danger = message.danger; }
        else settings.enabled[message.provider] = false;
      });
      const settings = await readSettings();
      await Promise.all(PROVIDERS.filter(provider => !settings.enabled[provider]).map(provider => scheduler.invalidateTickets(provider)));
      await reconcile();
    }
    if (message.type === 'enable') await enableProviders([message.provider]);
    if (message.type === 'enable-many') await enableProviders(message.providers);
    if (message.type === 'context') await refresh(message.provider, 'event');
    if (message.type === 'refresh') await refresh(message.provider, message.trigger);
    if (message.type === 'view' && !sender.tab) void refreshAll('event').catch(() => undefined);
    const view = message.type === 'view' || message.type === 'read' ? await readView() : await publish();
    return { ok: true, view } as Reply;
  })().then(sendResponse).catch(() => sendResponse({ ok: false }));
  return true;
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) void refreshAll('periodic').catch(() => undefined); });
chrome.runtime.onInstalled.addListener(() => { void initialize().catch(() => undefined); });
chrome.runtime.onStartup.addListener(() => { void initialize().catch(() => undefined); });
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then(async tab => { const p = providerFromUrl(tab.url); if (p) await refresh(displayProvider(p), 'tab'); await publishTab(tabId); }).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading' || change.status === 'complete' || change.url) void (async () => {
    const p = providerFromUrl(change.url ?? tab.url);
    if (p) {
      // A new document may follow an account switch. Focus, content attachment
      // and SPA conversation routes alone do not prove the account changed.
      if (change.status === 'loading') await scheduler.invalidatePlan(displayProvider(p));
      if (tab.active && change.status !== 'loading') await refresh(displayProvider(p), 'tab');
    }
    await publishTab(tabId);
  })().catch(() => undefined);
});
chrome.windows.onFocusChanged.addListener(windowId => { if (windowId !== -1) void updateBadgeFromFocus().catch(() => undefined); });
async function updateBadgeFromFocus() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const p = providerFromUrl(tab?.url);
  if (p) await refresh(displayProvider(p), 'tab');
  if (typeof tab?.id === 'number') await publishTab(tab.id); else await publish();
}
chrome.permissions.onAdded.addListener(added => {
  // Chrome may close the popup while showing its permission dialog. Complete
  // the granted site's activation in the worker instead of relying on that UI.
  const providers = PROVIDERS.filter(provider => added.origins?.includes(ORIGINS[provider]));
  void (async () => {
    await enableProviders(providers);
    await reconcile();
    await publish(true);
  })().catch(() => undefined);
});
chrome.permissions.onRemoved.addListener(removed => {
  // A revoked host no longer exposes its tab URL. Notify tab IDs without reading URLs/history.
  const origins = (removed?.origins ?? []).filter(origin => SITE_GROUPS.some(site => site.origin === origin));
  const notice = { type: 'permissions-revoked', origins };
  void chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(t => typeof t.id === 'number')
    .map(t => chrome.tabs.sendMessage(t.id!, notice).catch(() => undefined)))).catch(() => undefined);
  void Promise.all(PROVIDERS.filter(provider => origins.includes(ORIGINS[provider])).map(provider => scheduler.invalidateTickets(provider)))
    .then(reconcile).then(() => publish(true)).catch(() => undefined);
});
// Top-level repair handles worker restart too, rather than relying only on onStartup.
void initialize().catch(() => undefined);
