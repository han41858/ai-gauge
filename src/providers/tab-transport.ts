import { GEMINI_RESPONSE_ERRORS, ORIGINS, type Provider } from '../shared/types';
import { CollectionError, httpError, retryAfter } from '../shared/errors';
import { record } from '../shared/validation';
import { collectGeminiInPage } from './gemini-transport';
export interface TransportResult { status: number; code: string | null; retryAfter: string | null; data: unknown }

// Chrome serializes this function. It must contain its helpers and must never return credentials,
// account identifiers, error bodies, arbitrary API fields, or the raw session response.
export async function collectInPage(provider: 'chatgpt' | 'claude'): Promise<TransportResult> {
  const origin = provider === 'chatgpt' ? 'https://chatgpt.com' : 'https://claude.ai';
  if (location.origin !== origin) return { status: 0, code: 'open_tab', retryAfter: null, data: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const result = (status: number, code: string | null = null, wait: string | null = null, data: unknown = null): TransportResult => ({ status, code, retryAfter: wait, data });
  const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const text = (v: unknown): string | null => typeof v === 'string' && v.length <= 120 ? v : null;
  const planCode = (v: unknown): string | null => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/i.test(v) ? v.toLowerCase() : null;
  // Absolute URLs prevent a page's <base> from redirecting credentialed reads.
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${origin}${path}`, { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
  const errorResult = (r: Response) => result(r.status, null, r.headers.get('Retry-After'));
  const read = async (r: Response): Promise<unknown> => {
    if (!r.headers.get('content-type')?.includes('application/json')) throw new Error('invalid_response');
    return r.json();
  };
  const chatRate = (value: unknown) => {
    const raw = object(value), out: Record<string, unknown> = {};
    for (const key of ['primary_window', 'secondary_window']) {
      const w = object(raw?.[key]);
      if (w && ('used_percent' in w || 'reset_at' in w)) out[key] = { used_percent: numeric(w.used_percent), reset_at: numeric(w.reset_at), limit_window_seconds: numeric(w.limit_window_seconds) };
    }
    return out;
  };
  try {
    if (provider === 'chatgpt') {
      const sessionResp = await get('/api/auth/session');
      if (!sessionResp.ok) return errorResult(sessionResp);
      const session = object(await read(sessionResp));
      if (typeof session?.accessToken !== 'string' || !session.accessToken || session.accessToken.length > 16384) return result(401);
      const usageResp = await get('/backend-api/wham/usage', { Authorization: `Bearer ${session.accessToken}` });
      if (!usageResp.ok) return errorResult(usageResp);
      const raw = object(await read(usageResp));
      if (!raw) return result(200, 'invalid_response');
      return result(200, null, null, { plan_type: planCode(raw.plan_type), rate_limit: chatRate(raw.rate_limit), additional_rate_limits: Array.isArray(raw.additional_rate_limits) ? raw.additional_rate_limits.slice(0, 50).map(v => { const r = object(v); return { limit_name: text(r?.limit_name), metered_feature: text(r?.metered_feature), rate_limit: chatRate(r?.rate_limit) }; }) : [] });
    }
    const orgResp = await get('/api/organizations');
    if (!orgResp.ok) return errorResult(orgResp);
    const orgs = await read(orgResp);
    if (!Array.isArray(orgs)) return result(200, 'invalid_response');
    if (!orgs.length) return result(200, 'invalid_response');
    if (orgs.length !== 1) return result(200, 'ambiguous_account');
    const org = object(orgs[0]), uuid = org?.uuid;
    if (typeof uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return result(200, 'invalid_response');
    const usageResp = await get(`/api/organizations/${uuid}/usage`);
    if (!usageResp.ok) return errorResult(usageResp);
    const raw = object(await read(usageResp)), out: Record<string, unknown> = {};
    if (!raw) return result(200, 'invalid_response');
    for (const [key, value] of Object.entries(raw).slice(0, 100)) {
      if (!/^(five_hour|seven_day(?:_[a-z0-9_]+)?)$/.test(key)) continue;
      const w = object(value);
      if (w && ('utilization' in w || 'resets_at' in w)) out[key] = { utilization: numeric(w.utilization), resets_at: text(w.resets_at) };
    }
    out.limits = Array.isArray(raw.limits) ? raw.limits.slice(0, 50).map(v => { const w = object(v); return { kind: text(w?.kind), percent: numeric(w?.percent), resets_at: text(w?.resets_at), scope: { model: { display_name: text(object(object(w?.scope)?.model)?.display_name) } } }; }) : [];
    out.plan_metadata = {
      capabilities: Array.isArray(org?.capabilities) ? org.capabilities.slice(0, 100).filter(v => ['chat', 'claude_pro', 'claude_max', 'pro', 'free', 'raven', 'raven_enterprise'].includes(v)) : [],
      rate_limit_tier: planCode(org?.rate_limit_tier),
      raven_type: org?.raven_type === 'team' || org?.raven_type === 'enterprise' ? org.raven_type : null
    };
    return result(200, null, null, out);
  } catch (e) {
    return result(0, e instanceof Error && e.message === 'invalid_response' ? 'invalid_response' : 'network');
  } finally { clearTimeout(timeout); }
}
export function unwrapTransport(value: unknown): unknown {
  const r = record(value);
  if (!r || typeof r.status !== 'number' || !Number.isInteger(r.status) || r.status < 0 || r.status > 599) throw new CollectionError('invalid_response');
  if (r.code !== null) {
    const geminiError = GEMINI_RESPONSE_ERRORS.find(code => code === r.code);
    if (geminiError) throw new CollectionError(geminiError);
    if (r.code === 'unsupported') throw new CollectionError('unsupported', 'unsupported');
    if (r.code === 'network' || r.code === 'invalid_response' || r.code === 'open_tab' || r.code === 'ambiguous_account') throw new CollectionError(r.code);
    throw new CollectionError('invalid_response');
  }
  if (r.status !== 200) throw httpError(r.status, retryAfter(typeof r.retryAfter === 'string' && r.retryAfter.length <= 100 ? r.retryAfter : null));
  return r.data;
}
async function collectionTab(provider: Provider): Promise<chrome.tabs.Tab | undefined> {
  const eligible = (await chrome.tabs.query({ url: ORIGINS[provider] })).filter(tab =>
    !tab.discarded && !tab.frozen && typeof tab.id === 'number');
  if (eligible.length <= 1) return eligible[0];
  // Every window can have an active tab. Prefer the tab the user is actually
  // looking at, and select only once rather than trying another account on error.
  const focused = await chrome.tabs.query({ url: ORIGINS[provider], active: true, lastFocusedWindow: true });
  return eligible.find(tab => focused.some(candidate => candidate.id === tab.id && candidate.active))
    ?? eligible.sort((a, b) => Number(b.active) - Number(a.active))[0];
}
export async function collectFromTab(provider: Provider): Promise<unknown> {
  if (!await chrome.permissions.contains({ origins: [ORIGINS[provider]] })) throw new CollectionError('permission_required', 'permission_required');
  const tab = await collectionTab(provider);
  if (typeof tab?.id !== 'number') throw new CollectionError('open_tab');
  let results: chrome.scripting.InjectionResult<TransportResult>[];
  try { results = provider === 'gemini'
    ? await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectGeminiInPage })
    : await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectInPage, args: [provider] }); }
  catch { throw new CollectionError('tab_access_failed'); }
  return unwrapTransport(results[0]?.result);
}
