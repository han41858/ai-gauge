import { NAMES, providerFromUrl, type Provider, type Settings, type Snapshot, type UsageLimit, type View } from '../shared/types';
import { displayProvider } from '../shared/display-policy';
import { highestUsageLimit } from '../shared/usage-selection';
import { effectiveSnapshot } from '../storage/snapshots';
import { usageText, statusText } from '../shared/format';
const SERVICE_COLORS: Record<Provider, string> = { chatgpt: '#0D8669', claude: '#B16046', gemini: '#3569C8' };
export function selectedLimit(snapshot: Snapshot, _settings: Settings): UsageLimit | null {
  // Keep the settings argument for existing callers, but never let a saved
  // choice hide another reported limit that is closer to exhaustion.
  return highestUsageLimit(snapshot.limits);
}
export function badge(view: View, activeUrl?: string, now = Date.now()) {
  const page = providerFromUrl(activeUrl);
  if (!page) return { text: '', color: '#697386', textColor: '#FFFFFF', title: 'AI Gauge' };
  const p = displayProvider(page);
  const s = effectiveSnapshot(view.snapshots[p], now), limit = selectedLimit(s, view.settings);
  if (!view.settings.enabled[p] || !view.permissions[p] || s.state !== 'ok' || !limit || limit.percent === null) {
    const reason = !view.settings.enabled[p] ? '비활성' : !view.permissions[p] ? '권한 필요' : s.state !== 'ok' ? statusText(s) : '사용률 확인 불가';
    return { text: '—', color: '#697386', textColor: '#FFFFFF', title: `AI Gauge · ${NAMES[p]} · ${reason}` };
  }
  return { text: `${Math.round(limit.percent)}%`, color: SERVICE_COLORS[p], textColor: '#FFFFFF', title: `AI Gauge · ${NAMES[p]} · ${usageText(limit)}` };
}
async function renderBadges(view: View): Promise<void> {
  // Remove the former global badge so new, unsupported and URL-redacted tabs
  // never inherit a number. Supported pages receive their own tab-scoped value.
  await Promise.allSettled([
    chrome.action.setBadgeText({ text: '' }),
    chrome.action.setBadgeBackgroundColor({ color: '#697386' }),
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' }),
    chrome.action.setTitle({ title: 'AI Gauge' })
  ]);
  let tabs: chrome.tabs.Tab[];
  try { tabs = await chrome.tabs.query({}); }
  catch { return; }
  await Promise.all(tabs.filter(tab => typeof tab.id === 'number').map(async ({ id }) => {
    let tab: chrome.tabs.Tab;
    try { tab = await chrome.tabs.get(id!); }
    catch { return; } // A tab may close between query and get.
    const value = badge(view, tab.url);
    // Navigation or closing after get may reject any individual action call.
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: id!, text: value.text }),
      chrome.action.setBadgeBackgroundColor({ tabId: id!, color: value.color }),
      chrome.action.setBadgeTextColor({ tabId: id!, color: value.textColor }),
      chrome.action.setTitle({ tabId: id!, title: value.title })
    ]);
  }));
}
let pendingView: View | null = null;
let badgeFlight: Promise<void> | null = null;
async function flushBadges(): Promise<void> {
  try {
    while (pendingView) {
      const view = pendingView;
      pendingView = null;
      await renderBadges(view);
    }
  } finally { badgeFlight = null; }
}
export function updateBadge(view: View): Promise<void> {
  pendingView = view;
  // Finish old writes before applying a newer navigation/permission snapshot.
  // Otherwise a delayed old setBadgeText can overwrite a subsequent clear.
  badgeFlight ??= flushBadges();
  return badgeFlight;
}
