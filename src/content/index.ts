import { SITE_GROUPS, type PageProvider, type Provider, type View } from '../shared/types';
import { request } from '../shared/contracts';
import { UsageStrip } from './usage-strip';
import { hasStreamingControl } from './selectors';
import { canRefreshFromPage, displayProvider, needsContent } from '../shared/display-policy';
import { authorizedDisplayRequest, createDisplayDiagnostic } from './display-diagnostics';
import { resolvePageProvider } from './page-provider';
import { DEVELOPMENT } from '../shared/build-mode';
import { affectsView } from '../storage/snapshots';

declare global { interface Window { __aiGaugeMounted?: boolean } }
if (resolvePageProvider(document, location.href) && !window.__aiGaugeMounted) {
  window.__aiGaugeMounted = true;
  let provider: PageProvider | null = null, strip: UsageStrip | null = null, view: View | null = null;
  let stopped = false, timer: ReturnType<typeof setTimeout> | null = null, wasStreaming = false, lastSignal = 0, pending = false, loadAgain = false;
  const refreshQueue = new Set<Provider>();
  let viewRetryTimer: ReturnType<typeof setTimeout> | null = null, viewFailures = 0;
  let completionTimer: ReturnType<typeof setTimeout> | null = null, completionProvider: Provider | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let routeUrl: string | null = null;
  let contextPending = false;
  const clearCompletion = () => {
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = null; completionProvider = null;
  };
  const route = () => {
    const next = resolvePageProvider(document, location.href);
    const navigated = routeUrl !== null && routeUrl !== location.href;
    if (navigated || next !== provider) contextPending = true;
    routeUrl = location.href;
    if (navigated || next !== provider) clearCompletion();
    if (next === provider) {
      if (navigated) wasStreaming = next ? hasStreamingControl(document, next) : false;
      return navigated;
    }
    strip?.remove(); provider = next; strip = next ? new UsageStrip(next, document) : null;
    wasStreaming = next ? hasStreamingControl(document, next) : false;
    if (view) strip?.update(view);
    return true;
  };
  const stop = () => {
    stopped = true; window.__aiGaugeMounted = false; strip?.remove(); observer.disconnect(); if (timer) clearTimeout(timer);
    if (viewRetryTimer) clearTimeout(viewRetryTimer);
    if (clockTimer) clearInterval(clockTimer);
    clearCompletion();
    document.removeEventListener('focusin', scheduleCheck);
    document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('popstate', onRoute);
    chrome.runtime.onMessage.removeListener(onMessage); chrome.storage.onChanged.removeListener(onStorage);
  };
  const scheduleCompletion = () => {
    if (stopped || !completionProvider || !view) return;
    const source = completionProvider, snapshot = view.snapshots[source];
    if (!view.settings.enabled[source] || !view.permissions[source]
      || ['signed_out', 'permission_required', 'unsupported'].includes(snapshot.state)) { clearCompletion(); return; }
    // A response completed during the worker's cooldown must remain pending.
    // Stored retry/backoff deadlines are authoritative; this never forces a fetch.
    const earliest = Math.max(snapshot.nextAttemptAt, snapshot.checkedAt === null ? 0 : snapshot.checkedAt + 60_000, lastSignal + 60_000);
    const delay = earliest - Date.now();
    if (completionTimer) { clearTimeout(completionTimer); completionTimer = null; }
    if (delay > 0) completionTimer = setTimeout(() => { completionTimer = null; scheduleCompletion(); }, Math.min(delay + 100, 2_147_483_647));
    else { completionProvider = null; lastSignal = Date.now(); void load(source); }
  };
  const load = async (refresh?: Provider) => {
    if (stopped) return;
    if (pending) { loadAgain = true; if (refresh) refreshQueue.add(refresh); return; }
    route(); if (!provider) return;
    const current = provider;
    pending = true;
    const context = contextPending;
    contextPending = false;
    try {
      const nextView = await request(context ? { type: 'context', provider: displayProvider(current) }
        : refresh && canRefreshFromPage(current, refresh) ? { type: 'refresh', provider: refresh, trigger: 'event' } : { type: 'view' });
      if (stopped) return;
      view = nextView;
      viewFailures = 0; if (viewRetryTimer) { clearTimeout(viewRetryTimer); viewRetryTimer = null; }
      route(); if (contextPending) loadAgain = true;
      strip?.update(view);
      const group = SITE_GROUPS.find(g => g.providers.includes(current));
      if (!view.permissions[displayProvider(current)] || !group || !needsContent(view, group.providers)) stop();
      else scheduleCompletion();
    } catch {
      if (stopped) return;
      if (context) contextPending = true;
      let live = false;
      try { live = Boolean(chrome.runtime.id); } catch { /* Extension was unloaded. */ }
      if (!live) stop();
      else {
        // A sleeping/restarting worker or rejected transient reply is not a
        // permission revocation. Keep the last view and retry the local read.
        strip?.mount();
        viewFailures++;
        if (!viewRetryTimer) viewRetryTimer = setTimeout(() => { viewRetryTimer = null; void load(); }, Math.min(30_000, 1_000 * 2 ** Math.min(viewFailures - 1, 5)));
      }
    } finally {
      pending = false;
      if (!stopped && (loadAgain || refreshQueue.size)) {
        loadAgain = false;
        const next = refreshQueue.values().next().value;
        if (next) refreshQueue.delete(next);
        void load(next);
      }
    }
  };
  const check = () => {
    if (timer) clearTimeout(timer);
    timer = null; if (stopped) return;
    const changed = route(); strip?.mount(); if (!provider) return;
    if (changed || contextPending) void load(displayProvider(provider));
    const streaming = hasStreamingControl(document, provider);
    if (wasStreaming && !streaming) { completionProvider = displayProvider(provider); scheduleCompletion(); }
    wasStreaming = streaming;
  };
  const scheduleCheck = () => { if (!timer && !stopped) timer = setTimeout(check, 300); };
  const ownNode = (node: Node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    return !!element?.closest('#ai-gauge-usage-strip');
  };
  const observer = new MutationObserver(records => {
    if (stopped) return;
    const externalChange = records.some(record => {
      if (ownNode(record.target)) return false;
      const changed = [...record.addedNodes, ...record.removedNodes];
      // Insertions/reordering made by either installation must not schedule
      // another mount. A site removing our node alone does require recovery.
      return record.type !== 'childList' || changed.length === 0 || changed.some(node => !ownNode(node)) || [...record.removedNodes].some(node => !node.isConnected);
    });
    if (externalChange) {
      // Observe the appearance immediately so short responses are not lost
      // between the debounced placement checks. Only control attributes are read.
      if (provider && hasStreamingControl(document, provider)) wasStreaming = true;
      scheduleCheck();
    }
  });
  observer.observe(document, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['hidden', 'aria-hidden', 'inert', 'style', 'class', 'contenteditable', 'aria-label', 'data-testid', 'data-test-id', 'data-cds']
  });
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse?: (response: unknown) => void) => {
    if (DEVELOPMENT && authorizedDisplayRequest(message, sender, chrome.runtime.id)) {
      const current = resolvePageProvider(document, location.href);
      if (!stopped && current) sendResponse?.(createDisplayDiagnostic(document, current));
      return;
    }
    if (sender.id !== chrome.runtime.id || typeof message !== 'object' || message === null || !('type' in message)) return;
    if (message.type === 'permissions-revoked' && 'origins' in message && Array.isArray(message.origins)) {
      const origin = SITE_GROUPS.find(site => provider && site.providers.includes(provider))?.origin;
      // Once the host is revoked, the worker correctly denies further view reads.
      // This trusted signal must clean up without relying on a successful reply.
      if (origin && message.origins.includes(origin)) stop();
    } else if (message.type === 'invalidate') void load();
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => { if (affectsView(changes, areaName)) void load(); };
  const onVisible = () => { if (document.visibilityState === 'visible') { check(); void load(provider ? displayProvider(provider) : undefined); } };
  const onRoute = () => { check(); };
  chrome.runtime.onMessage.addListener(onMessage); chrome.storage.onChanged.addListener(onStorage);
  document.addEventListener('focusin', scheduleCheck);
  document.addEventListener('visibilitychange', onVisible); window.addEventListener('popstate', onRoute);
  // Re-evaluate countdowns and elapsed resets even on a quiet page. Collection
  // stays in the shared worker; each open tab only renders its local view here.
  clockTimer = setInterval(check, 15_000);
  void load();
}
