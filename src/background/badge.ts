import { NAMES, providerFromUrl, type Provider, type View } from '../shared/types';
import { displayProvider } from '../shared/display-policy';
import { highestUsageLimit } from '../shared/usage-selection';
import { effectiveSnapshot } from '../storage/snapshots';
import { usageText, statusText } from '../shared/format';
import { setLanguagePreference, t } from '../shared/i18n';
const SERVICE_COLORS: Record<Provider, string> = { chatgpt: '#0D8669', claude: '#B16046', gemini: '#3569C8' };
type BadgeValue = { text: string; color: string; textColor: string; title: string };
const EMPTY: BadgeValue = { text: '', color: '#697386', textColor: '#FFFFFF', title: 'AI Gauge' };
export function badge(view: View, activeUrl?: string, now = Date.now()): BadgeValue {
  setLanguagePreference(view.settings.language);
  const page = providerFromUrl(activeUrl);
  if (!page) return EMPTY;
  const p = displayProvider(page);
  const s = effectiveSnapshot(view.snapshots[p], now), limit = highestUsageLimit(s.limits);
  if (!view.settings.enabled[p] || !view.permissions[p] || s.state !== 'ok' || !limit || limit.percent === null) {
    const reason = !view.settings.enabled[p] ? t('badge_disabled') : !view.permissions[p] ? t('badge_permission_required') : s.state !== 'ok' ? statusText(s) : t('badge_usage_unknown');
    return { text: '—', color: '#697386', textColor: '#FFFFFF', title: `AI Gauge · ${NAMES[p]} · ${reason}` };
  }
  return { text: `${Math.round(limit.percent)}%`, color: SERVICE_COLORS[p], textColor: '#FFFFFF', title: `AI Gauge · ${NAMES[p]} · ${usageText(limit)}` };
}
// Last values written per tab in this worker. A restarted worker starts empty and
// rewrites everything once; afterwards unchanged tabs skip redundant writes.
const written = new Map<number, string>();
let globalCleared = false;
async function writeTab(view: View, id: number, verify: boolean): Promise<void> {
  let tab: chrome.tabs.Tab;
  try { tab = await chrome.tabs.get(id); }
  catch { written.delete(id); return; } // A tab may close between query and get.
  let value = badge(view, tab.url), key = JSON.stringify(value);
  if (written.get(id) === key) {
    if (!verify) return;
    // A remembered write does not guarantee that Chrome still shows it.
    let actual: string | undefined;
    try { actual = await chrome.action.getBadgeText({ tabId: id }); }
    catch { /* Try restoring the action if its current text could not be read. */ }
    // The tab may navigate while Chrome returns the current badge text.
    try { tab = await chrome.tabs.get(id); }
    catch { written.delete(id); return; }
    value = badge(view, tab.url); key = JSON.stringify(value);
    if (written.get(id) === key && actual === value.text) return;
  }
  // Navigation or closing after get may reject any individual action call.
  const results = await Promise.allSettled([
    chrome.action.setBadgeText({ tabId: id, text: value.text }),
    chrome.action.setBadgeBackgroundColor({ tabId: id, color: value.color }),
    chrome.action.setBadgeTextColor({ tabId: id, color: value.textColor }),
    chrome.action.setTitle({ tabId: id, title: value.title })
  ]);
  if (results.every(result => result.status === 'fulfilled')) written.set(id, key); else written.delete(id);
}
async function renderBadges(view: View, only: Set<number> | null, verify: Set<number> | null): Promise<void> {
  if (!globalCleared) {
    // Remove the former global badge so new, unsupported and URL-redacted tabs
    // never inherit a number. Supported pages receive their own tab-scoped value.
    await Promise.allSettled([
      chrome.action.setBadgeText({ text: '' }),
      chrome.action.setBadgeBackgroundColor({ color: EMPTY.color }),
      chrome.action.setBadgeTextColor({ color: EMPTY.textColor }),
      chrome.action.setTitle({ title: EMPTY.title })
    ]);
    globalCleared = true;
  }
  let ids: number[];
  if (only) ids = [...only];
  else {
    ids = (await chrome.tabs.query({})).flatMap(tab => typeof tab.id === 'number' ? [tab.id] : []);
    const open = new Set(ids);
    for (const id of written.keys()) if (!open.has(id)) written.delete(id);
  }
  await Promise.all(ids.map(id => writeTab(view, id, verify === null || verify.has(id))));
}
let pending: { view: View; only: Set<number> | null; verify: Set<number> | null } | null = null;
let badgeFlight: Promise<void> | null = null;
async function flushBadges(): Promise<void> {
  try {
    while (pending) {
      const { view, only, verify } = pending;
      pending = null;
      await renderBadges(view, only, verify);
    }
  } finally { badgeFlight = null; }
}
/** Updates all tabs or verifies named tabs. Serialized writes cannot leave an older queued value last. */
export function updateBadge(view: View, tabIds?: number[], verifyAll = false): Promise<void> {
  const only = tabIds ? new Set(tabIds) : null;
  // The newest view applies to every queued target; a full render absorbs tab-only requests.
  const merged = !pending ? only : !pending.only || !only ? null : new Set([...pending.only, ...only]);
  const verify = verifyAll || pending?.verify === null ? null : new Set([...(pending?.verify ?? []), ...(tabIds ?? [])]);
  pending = { view, only: merged, verify };
  badgeFlight ??= flushBadges();
  return badgeFlight;
}
/** Test hook: forget written values, as a restarted worker would. */
export function resetBadgeCache(): void { written.clear(); globalCleared = false; }
