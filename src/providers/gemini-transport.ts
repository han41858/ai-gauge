import type { TransportResult } from './tab-transport';

// Chrome serializes this entire function into MAIN world: helpers must stay inside it.
// Only quota and allowlisted policy signals leave the page; tokens and RPC envelopes never do.
export async function collectGeminiInPage(): Promise<TransportResult> {
  const result = (status: number, code: string | null = null, wait: string | null = null, data: unknown = null): TransportResult =>
    ({ status, code, retryAfter: wait, data });
  if (location.origin !== 'https://gemini.google.com') return result(0, 'open_tab');
  const page = new URL(location.href);
  const account = /^\/u\/([^/]+)(?:\/|$)/.exec(page.pathname)?.[1];
  // A non-default account must not silently query the browser's default Google account.
  if ((account !== undefined && account !== '0') || page.searchParams.getAll('authuser').some(value => value !== '0')) return result(200, 'unsupported');
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
  const fail = (code = 'gemini_frame_invalid'): never => { throw new Error(code); };
  const sanitize = (payload: unknown): unknown => {
    const invalid = (): never => fail('gemini_quota_invalid');
    if (!Array.isArray(payload) || !Array.isArray(payload[1]) || payload[1].length > 20) return invalid();
    const windows: unknown[] = [], seen = new Set<number>();
    for (const row of payload[1]) {
      if (!Array.isArray(row) || !Number.isInteger(row[2])) return invalid();
      const type = row[2] as number;
      if (type !== 1 && type !== 2) continue;
      if (seen.has(type)) return invalid();
      seen.add(type);
      const ratio: unknown = row[1];
      if (ratio != null && (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1)) return invalid();
      let reset: unknown = null;
      if (row[3] != null) {
        const outer: unknown = row[3];
        if (!Array.isArray(outer) || outer.length !== 1 || !Array.isArray(outer[0])) return invalid();
        const stamp = outer[0] as unknown[], seconds = stamp[0], nanos = stamp.length === 1 ? 0 : stamp[1];
        if (stamp.length < 1 || stamp.length > 2 || typeof seconds !== 'number' || !Number.isSafeInteger(seconds)
          || seconds <= 0 || seconds >= 4_102_444_800 || typeof nanos !== 'number' || !Number.isInteger(nanos)
          || nanos < 0 || nanos >= 1_000_000_000) return invalid();
        reset = [[seconds, nanos]];
      }
      windows.push([null, ratio ?? null, type, reset]);
    }
    if (!windows.length) return invalid();
    return [null, windows];
  };
  const decode = (body: string, rpc: 'jSf9Qc' | 'otAQ7b'): unknown => {
    if (!body || body.length > 1_048_576) return fail();
    let text = body.trimStart();
    if (text.startsWith(")]}'")) text = text.slice(4).trimStart();
    if (!text) return fail();
    const frames: unknown[] = [];
    if (text.startsWith('[')) {
      try { frames.push(JSON.parse(text)); }
      catch {
        // Some batchexecute responses contain a complete JSON frame on each line.
        // Every nonempty line must parse; never skip damaged or unknown text.
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (lines.length > 100) return fail();
        for (const line of lines) {
          try { frames.push(JSON.parse(line)); }
          catch { return fail(); }
        }
      }
    } else {
      let cursor = 0;
      while (cursor < text.length) {
        while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
        if (cursor === text.length) break;
        const prefix = /^(\d{1,7})\r?\n/.exec(text.slice(cursor));
        if (!prefix) return fail();
        const length = Number(prefix[1]);
        if (length <= 0 || length > 1_048_576) return fail();
        // Observed lengths include both the separator and terminating newline;
        // also accept frames whose length counts only the JSON (UTF-16 units).
        let end = -1;
        for (const start of [cursor + prefix[1]!.length, cursor + prefix[0].length]) {
          const declaredEnd = start + length;
          // The final terminator may be absent at EOF. Only that single LF may
          // be missing, and the complete remaining JSON must still parse.
          const missingFinalLF = start === cursor + prefix[1]!.length && declaredEnd === text.length + 1;
          const candidateEnd = missingFinalLF ? text.length : declaredEnd;
          // A following frame may start immediately after this JSON. The next
          // iteration validates its length marker; an extra newline is optional.
          if (candidateEnd > text.length) continue;
          try {
            const frame: unknown = JSON.parse(text.slice(start, candidateEnd));
            if (!Array.isArray(frame)) continue;
            frames.push(frame);
            end = candidateEnd;
            break;
          } catch { /* Try the other supported separator convention. */ }
        }
        if (end < 0) return fail();
        cursor = end;
        if (frames.length > 100) return fail();
      }
    }
    let answer: unknown = undefined, count = 0;
    for (const frame of frames) {
      if (!Array.isArray(frame) || frame.length > 100) return fail();
      for (const row of frame) {
        if (!Array.isArray(row) || typeof row[0] !== 'string') return fail();
        if (row[0] !== 'wrb.fr' || (row[1] !== rpc && row[1] !== null)) continue;
        const status: unknown = row[5];
        if (status != null) {
          if (Array.isArray(status) && (status[0] === 1037 || status[0] === 1060)) throw new Error('rate_limited');
          throw new Error('unsupported');
        }
        if (row[1] !== rpc) continue;
        if (++count !== 1 || typeof row[2] !== 'string' || !row[2]) return fail('gemini_rpc_invalid');
        try { answer = JSON.parse(row[2]); }
        catch { return fail('gemini_rpc_invalid'); }
      }
    }
    if (count !== 1) return fail('gemini_rpc_missing');
    return answer;
  };
  const read = async (response: Response): Promise<string> => {
    if (!/^(?:application\/json|text\/plain)(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')) return fail('gemini_response_type');
    const reader = response.body?.getReader();
    if (!reader) return fail('gemini_response_read');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let raw = '', bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read().catch(() => fail('network'));
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1_048_576) {
          await reader.cancel().catch(() => undefined);
          return fail('gemini_response_read');
        }
        try { raw += decoder.decode(chunk.value, { stream: true }); }
        catch { return fail('gemini_response_read'); }
      }
      try { raw += decoder.decode(); }
      catch { return fail('gemini_response_read'); }
      return raw;
    } finally { reader.releaseLock(); }
  };
  const policySignals = (payload: unknown): string[] | null => {
    if (!Array.isArray(payload)) return null;
    // This allowlist also prevents model-picker strings or profile fields crossing the page boundary.
    const known = new Set(['v3p2_free_policy', 'v3p2_basic_policy', 'v3p2_plus_policy', 'v3p2_pro_policy',
      'v3p2_ultra_policy', 'v3p2_business_policy', 'basic_policy', 'brownfield_basic_policy',
      'brownfield_paid_policy', 'plus_policy', 'neon_policy']);
    const policies = new Set<string>(), pending: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];
    let visited = 0;
    while (pending.length) {
      const { value, depth } = pending.pop()!;
      if (++visited > 4_000 || depth > 20) return null;
      if (typeof value === 'string' && known.has(value)) policies.add(value);
      else if (Array.isArray(value)) {
        if (value.length > 1_000 || pending.length + value.length > 4_000) return null;
        for (const child of value) pending.push({ value: child, depth: depth + 1 });
      }
    }
    return [...policies];
  };
  try {
    const token = (window as unknown as { WIZ_global_data?: { SNlM0e?: unknown } }).WIZ_global_data?.SNlM0e;
    if (typeof token !== 'string' || !token || token.length > 16_384) return result(200, 'unsupported');
    const request = (rpc: 'jSf9Qc' | 'otAQ7b', signal: AbortSignal) => fetch(`https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=${rpc}&source-path=%2Fusage&rt=c`, {
      method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
      body: new URLSearchParams({ 'f.req': JSON.stringify([[[rpc, '[]', null, 'generic']]]), at: token }).toString()
    });
    const response = await request('jSf9Qc', controller.signal);
    if (!response.ok) {
      const wait = response.headers.get('Retry-After');
      return result(response.status, null, wait !== null && wait.length <= 100 ? wait : null);
    }
    try {
      const raw = decode(await read(response), 'jSf9Qc'), usage = sanitize(raw);
      let plan: { planId: number | null; policies: string[] } | null = null;
      const planController = new AbortController(), planTimeout = setTimeout(() => planController.abort(), 3_000);
      try {
        const policyResponse = await request('otAQ7b', planController.signal);
        if (policyResponse.ok) {
          const policies = policySignals(decode(await read(policyResponse), 'otAQ7b'));
          const planId: unknown = Array.isArray(raw) ? raw[0] : null;
          if (policies && location.href === page.href
            && (window as unknown as { WIZ_global_data?: { SNlM0e?: unknown } }).WIZ_global_data?.SNlM0e === token) {
            plan = { planId: typeof planId === 'number' && Number.isSafeInteger(planId) && planId >= 0 ? planId : null, policies };
          }
        }
      } catch { /* Optional policy failure must not discard a valid usage response. */ }
      finally { planController.abort(); clearTimeout(planTimeout); }
      return result(200, null, null, { usage, plan });
    }
    catch (error) {
      if (error instanceof Error && error.message === 'rate_limited') return result(429);
      // Fixed codes only; never send exception text or response contents to the worker.
      const codes = ['unsupported', 'network', 'gemini_response_type', 'gemini_response_read', 'gemini_frame_invalid', 'gemini_rpc_missing', 'gemini_rpc_invalid', 'gemini_quota_invalid'];
      return result(200, error instanceof Error && codes.includes(error.message) ? error.message : 'invalid_response');
    }
  } catch { return result(0, 'network'); }
  finally { controller.abort(); clearTimeout(timeout); }
}
