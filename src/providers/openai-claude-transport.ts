import type { TransportResult } from './tab-transport';

// Chrome serializes this function. It must contain its helpers and must never return credentials,
// account identifiers, error bodies, arbitrary API fields, or the raw session response.
export async function collectInPage(provider: 'chatgpt' | 'claude', scopeSalt = '', mode: 'page' | 'worker' = 'page'): Promise<TransportResult> {
  const origin = provider === 'chatgpt' ? 'https://chatgpt.com' : 'https://claude.ai';
  if (mode === 'page' && location.origin !== origin) return { status: 0, code: 'open_tab', retryAfter: null, data: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const result = (status: number, code: string | null = null, wait: string | null = null, data: unknown = null): TransportResult => ({ status, code, retryAfter: wait, data });
  const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const text = (v: unknown): string | null => typeof v === 'string' && v.length <= 120 ? v : null;
  const planCode = (v: unknown): string | null => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/i.test(v) ? v.toLowerCase() : null;
  const count = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const timestamp = (v: unknown): string | null => {
    if (typeof v !== 'string' || v.length > 64) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(v);
    if (!match) return null;
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return null;
    const ms = Date.parse(v);
    return Number.isFinite(ms) && ms > 0 && ms < 4102444800000 ? new Date(ms).toISOString() : null;
  };
  const boolean = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
  const identity = (v: unknown): string | null => typeof v === 'string' && v.length > 0 && v.length <= 512 ? v : null;
  const scope = async (id: string | null): Promise<string | null> => {
    if (!id || !/^[a-f0-9]{64}$/.test(scopeSalt)) return null;
    try { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scopeSalt}\0${provider}\0${id}`))), n => n.toString(16).padStart(2, '0')).join(''); }
    catch { return null; }
  };
  const summary = (v: unknown) => { const r = object(v); return r ? { available_count: count(r.available_count), applicable_available_count: count(r.applicable_available_count) } : null; };
  // Absolute URLs prevent a page's <base> from redirecting credentialed reads.
  const request = (path: string, signal: AbortSignal, headers: Record<string, string> = {}) => fetch(`${origin}${path}`,
    { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', signal, headers: { Accept: 'application/json', ...headers } });
  const get = (path: string, headers: Record<string, string> = {}) => request(path, controller.signal, headers);
  const errorResult = (r: Response) => result(r.status, null, r.headers.get('Retry-After'));
  // Same 1 MiB ceiling as the Gemini transport; usage and organization payloads are far smaller.
  const read = async (r: Response): Promise<unknown> => {
    if (!r.headers.get('content-type')?.includes('application/json')) throw new Error('invalid_response');
    if (Number(r.headers.get('content-length')) > 1_048_576) throw new Error('invalid_response');
    const body = await r.text();
    if (body.length > 1_048_576) throw new Error('invalid_response');
    return JSON.parse(body);
  };
  // Optional ticket metadata has its own deadline and cannot fail valid usage.
  const optional = async (run: (signal: AbortSignal) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> => {
    const optionalController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Record<string, unknown>>(resolve => {
      timer = setTimeout(() => { optionalController.abort(); resolve({ state: 'error' }); }, 3000);
    });
    try { return await Promise.race([run(optionalController.signal).catch(() => ({ state: 'error' })), deadline]); }
    finally { if (timer) clearTimeout(timer); }
  };
  const optionalFailure = (r: Response) => ({ state: r.status === 401 || r.status === 403 ? 'auth' : 'error' });
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
      const account = identity(raw.account_id) ?? identity(raw.user_id);
      const user = identity(raw.user_id) ?? (account?.startsWith('user-') ? account : null);
      const proof = await scope(user ? JSON.stringify([account, user]) : null), held = summary(raw.rate_limit_reset_credits);
      let tickets: Record<string, unknown> = { state: held ? 'ok' : 'unavailable', scope: proof, summary: held };
      if (held && held.available_count !== null && held.available_count > 0 && account) {
        const detail = await optional(async signal => {
          const detailResponse = await request('/backend-api/wham/rate-limit-reset-credits', signal, { Authorization: `Bearer ${session.accessToken}` });
          if (!detailResponse.ok) return optionalFailure(detailResponse);
          const details = object(await read(detailResponse));
          if (!details || !Array.isArray(details.credits) || details.credits.length > 100) return { state: 'error' };
          const againResponse = await request('/backend-api/wham/usage', signal, { Authorization: `Bearer ${session.accessToken}` });
          if (!againResponse.ok) return optionalFailure(againResponse);
          const again = object(await read(againResponse));
          if (!again) return { state: 'error' };
          const againAccount = identity(again.account_id) ?? identity(again.user_id);
          const againUser = identity(again.user_id) ?? (againAccount?.startsWith('user-') ? againAccount : null);
          if (againAccount !== account || againUser !== user) return { state: 'context_changed', scope: null };
          const current = summary(again.rate_limit_reset_credits);
          if (!current || current.available_count !== held.available_count || count(details.available_count) !== current.available_count
            || details.credits.length < current.available_count!) return { state: 'error', summary: current };
          return { state: 'ok', summary: current, detail: {
            available_count: count(details.available_count),
            credits: details.credits.map(value => { const c = object(value); return c ? {
              reset_type: typeof c.reset_type === 'string' ? (['codex_rate_limits', 'codex_five_hour', 'codex_weekly'].includes(c.reset_type) ? c.reset_type : 'unknown') : null,
              status: typeof c.status === 'string' ? (c.status === 'available' ? 'available' : 'other') : null,
              is_supported_by_plan: boolean(c.is_supported_by_plan), granted_at: c.granted_at == null ? null : timestamp(c.granted_at) ?? 'invalid', expires_at: timestamp(c.expires_at)
            } : null; })
          } };
        });
        tickets = { ...tickets, ...detail };
      }
      const additional = Array.isArray(raw.additional_rate_limits) ? raw.additional_rate_limits.slice(0, 50).map(v => {
        const r = object(v);
        return { limit_name: text(r?.limit_name), metered_feature: text(r?.metered_feature), rate_limit: chatRate(r?.rate_limit) };
      }) : [];
      return result(200, null, null, { reset_tickets: tickets, plan_type: planCode(raw.plan_type), rate_limit: chatRate(raw.rate_limit), additional_rate_limits: additional });
    }
    const orgResp = await get('/api/organizations');
    if (!orgResp.ok) return errorResult(orgResp);
    const orgs = await read(orgResp);
    if (!Array.isArray(orgs)) return result(200, 'invalid_response');
    if (!orgs.length) return result(200, 'invalid_response');
    if (orgs.length !== 1) return result(200, 'ambiguous_account');
    const org = object(orgs[0]), uuid = org?.uuid;
    if (typeof uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return result(200, 'invalid_response');
    const usagePath = `/api/organizations/${uuid}/usage`;
    let featureFailed = false, usageResp: Response, usageData: unknown;
    const queried = await optional(async signal => {
      const response = await request(`${usagePath}?cedar_ember=1`, signal);
      return { response, ...(response.ok ? { data: await read(response) } : {}) };
    });
    if (queried.response instanceof Response && (queried.response.ok || (![400, 403, 404, 422].includes(queried.response.status) && queried.response.status < 500))) {
      usageResp = queried.response;
      if (!usageResp.ok) return errorResult(usageResp);
      usageData = queried.data;
    } else {
      featureFailed = true;
      usageResp = await get(usagePath);
      if (!usageResp.ok) return errorResult(usageResp);
      usageData = await read(usageResp);
    }
    const raw = object(usageData), out: Record<string, unknown> = {};
    if (!raw) return result(200, 'invalid_response');
    for (const [key, value] of Object.entries(raw).slice(0, 100)) {
      if (!/^(five_hour|seven_day(?:_[a-z0-9_]+)?)$/.test(key)) continue;
      const w = object(value);
      if (w && ('utilization' in w || 'resets_at' in w)) out[key] = { utilization: numeric(w.utilization), resets_at: text(w.resets_at) };
    }
    out.limits = Array.isArray(raw.limits) ? raw.limits.slice(0, 50).map(v => {
      const w = object(v);
      return { kind: text(w?.kind), percent: numeric(w?.percent), resets_at: text(w?.resets_at),
        scope: { model: { display_name: text(object(object(w?.scope)?.model)?.display_name) } } };
    }) : [];
    out.plan_metadata = {
      capabilities: Array.isArray(org?.capabilities) ? org.capabilities.slice(0, 100).filter(v => ['chat', 'claude_pro', 'claude_max', 'pro', 'free', 'raven', 'raven_enterprise'].includes(v)) : [],
      rate_limit_tier: planCode(org?.rate_limit_tier),
      raven_type: org?.raven_type === 'team' || org?.raven_type === 'enterprise' ? org.raven_type : null
    };
    // An organization UUID can be shared by different users; it is not proof for cache reuse.
    // The existing response has no verified per-user ID, so optional failures must hide old tickets.
    const cedar = object(raw.cedar_ember);
    let tickets: Record<string, unknown> = { state: featureFailed ? 'error' : 'unavailable', scope: null };
    if (cedar) {
      const detail = await optional(async signal => {
        const againResponse = await request('/api/organizations', signal);
        if (!againResponse.ok) return optionalFailure(againResponse);
        const again = await read(againResponse);
        if (!Array.isArray(again) || again.length !== 1 || object(again[0])?.uuid !== uuid) return { state: 'context_changed', scope: null };
        if (cedar.eligible !== true) return { state: 'unavailable' };
        if (!Array.isArray(cedar.grants) || cedar.grants.length > 100) return { state: 'error' };
        const next = identity(cedar.next_grant_id);
        return { state: 'ok', detail: {
          eligible: true, cooldown_until: cedar.cooldown_until == null ? null : timestamp(cedar.cooldown_until) ?? 'invalid',
          grants: cedar.grants.map(value => {
            const g = object(value);
            if (!g) return null;
            return { resets_left: count(g.resets_left), starts_at: g.starts_at == null ? null : timestamp(g.starts_at) ?? 'invalid',
              // Missing/invalid expiry remains invalid; only an explicit null has the site's no-grant meaning.
              ends_at: g.ends_at === null ? null : timestamp(g.ends_at) ?? 'invalid',
              clears: Array.isArray(g.clears) && g.clears.length <= 64 && g.clears.every(v => typeof v === 'string')
                ? g.clears.map(v => /^(five_hour|seven_day(?:_[a-z0-9_]+)?)$/.test(v) && v.length <= 64 ? v : 'unknown') : null,
              usable_now: boolean(g.usable_now), use_requires_limit: boolean(g.use_requires_limit),
              blocked: Array.isArray(g.blocking) ? g.blocking.length > 0 : null,
              selected: next === null ? null : identity(g.id) === next
            };
          })
        } };
      });
      tickets = { ...tickets, ...detail };
    }
    out.reset_tickets = tickets;
    return result(200, null, null, out);
  } catch (e) {
    return result(0, e instanceof Error && e.message === 'invalid_response' ? 'invalid_response' : 'network');
  } finally { clearTimeout(timeout); }
}
