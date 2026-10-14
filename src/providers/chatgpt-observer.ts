export interface ChatGPTObservation {
  version: 1;
  observedAt: number;
  data: { limits_progress: Array<{ feature_name: string | null; remaining: number | null; reset_after: string | null }> | null };
}

// These functions are independently serializable by chrome.scripting.executeScript.
// Observe only the metadata response to the site's own init request. Never inspect
// request bodies/headers, conversation/history responses, or an SSE stream.
export function installChatGPTObserver(): void {
  if (location.origin !== 'https://chatgpt.com') return;
  const host = globalThis as typeof globalThis & Record<string, unknown>;
  const stateKey = '__AI_GAUGE_CHATGPT_OBSERVER_V1__';
  const cacheKey = '__AI_GAUGE_CHATGPT_QUOTA_V1__';
  if (host[stateKey]) return;
  const state = {};
  host[stateKey] = state;
  const originalFetch = globalThis.fetch;
  let active = true, requestOrder = 0, publishedOrder = 0;
  const allowedPage = () => location.origin === 'https://chatgpt.com' && !/^\/(?:codex|work)(?:\/|$)/.test(location.pathname);
  const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const shortText = (value: unknown): string | null => typeof value === 'string' && value.length <= 120 ? value : null;
  const endpoint = (value: string) => {
    try { const url = new URL(value, location.href); return url.origin === 'https://chatgpt.com' && url.pathname === '/backend-api/conversation/init'; }
    catch { return false; }
  };
  const publish = (order: number, value: unknown) => {
    if (!active || !allowedPage() || order < publishedOrder) return;
    const raw = object(value);
    // A successful init may omit optional quotas. Do not preserve old counts or
    // report a schema failure merely because the service has no quota to expose.
    const rows = Array.isArray(raw?.limits_progress) ? raw.limits_progress.slice(0, 50).map(value => {
      const row = object(value);
      return { feature_name: shortText(row?.feature_name), remaining: typeof row?.remaining === 'number' && Number.isSafeInteger(row.remaining) && row.remaining >= 0 ? row.remaining : null, reset_after: shortText(row?.reset_after) };
    }) : raw && (raw.limits_progress === undefined || raw.limits_progress === null) ? [] : null;
    publishedOrder = order;
    host[cacheKey] = { version: 1, observedAt: Date.now(), data: { limits_progress: rows } } satisfies ChatGPTObservation;
    document.dispatchEvent(new Event('ai-gauge-chatgpt-quota'));
  };
  const wrappedFetch = function (this: unknown, ...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    let matches = false;
    try {
      const input = args[0];
      matches = active && allowedPage() && endpoint(typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : '');
    } catch { /* Observability must never block a page request. */ }
    const responsePromise = Reflect.apply(originalFetch, this, args) as ReturnType<typeof fetch>;
    if (matches) {
      const order = ++requestOrder;
      void responsePromise.then(async response => {
        if (!active || !allowedPage()) return;
        if (!response.ok) { publish(order, null); return; }
        if (response.url && !endpoint(response.url)) return;
        if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) return;
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > 262_144) return;
        const clone = response.clone();
        publish(order, await clone.json());
      }).catch(() => { /* No raw error or response logging. */ });
    }
    return responsePromise;
  };
  const stop = () => {
    active = false;
    if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
    if (host[stateKey] === state) { delete host[stateKey]; delete host[cacheKey]; }
    document.removeEventListener('ai-gauge-chatgpt-stop', stop);
  };
  document.addEventListener('ai-gauge-chatgpt-stop', stop);
  globalThis.fetch = wrappedFetch;
}

export function readChatGPTObservation(): ChatGPTObservation | null {
  if (location.origin !== 'https://chatgpt.com' || /^\/(?:codex|work)(?:\/|$)/.test(location.pathname)) return null;
  const host = globalThis as typeof globalThis & Record<string, unknown>;
  const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const shortText = (value: unknown): string | null => typeof value === 'string' && value.length <= 120 ? value : null;
  const observation = object(host.__AI_GAUGE_CHATGPT_QUOTA_V1__);
  if (!observation || observation.version !== 1 || typeof observation.observedAt !== 'number' || !Number.isSafeInteger(observation.observedAt) || observation.observedAt <= 0) return null;
  const raw = object(observation.data);
  const rows = Array.isArray(raw?.limits_progress) ? raw.limits_progress.slice(0, 50).map(value => {
    const row = object(value);
    return { feature_name: shortText(row?.feature_name), remaining: typeof row?.remaining === 'number' && Number.isSafeInteger(row.remaining) && row.remaining >= 0 ? row.remaining : null, reset_after: shortText(row?.reset_after) };
  }) : null;
  return { version: 1, observedAt: observation.observedAt, data: { limits_progress: rows } };
}

export function stopChatGPTObserver(): void {
  if (location.origin !== 'https://chatgpt.com') return;
  document.dispatchEvent(new Event('ai-gauge-chatgpt-stop'));
}
