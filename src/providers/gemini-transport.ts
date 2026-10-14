import type { TransportResult } from './tab-transport';

// Chrome serializes this entire function into MAIN world: helpers must stay inside it.
// Only quota fields leave the page; the CSRF token and RPC envelope never do.
export async function collectGeminiInPage(): Promise<TransportResult> {
  const result = (status: number, code: string | null = null, wait: string | null = null, data: unknown = null): TransportResult =>
    ({ status, code, retryAfter: wait, data });
  if (location.origin !== 'https://gemini.google.com') return result(0, 'open_tab');
  const page = new URL(location.href);
  const account = /^\/u\/([^/]+)(?:\/|$)/.exec(page.pathname)?.[1];
  // A non-default account must not silently query the browser's default Google account.
  if ((account !== undefined && account !== '0') || page.searchParams.getAll('authuser').some(value => value !== '0')) return result(200, 'unsupported');
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
  const fail = (): never => { throw new Error('invalid_response'); };
  const sanitize = (payload: unknown): unknown => {
    if (!Array.isArray(payload) || !Array.isArray(payload[1]) || payload[1].length > 20) return fail();
    const windows: unknown[] = [], seen = new Set<number>();
    for (const row of payload[1]) {
      if (!Array.isArray(row) || !Number.isInteger(row[2])) return fail();
      const type = row[2] as number;
      if (type !== 1 && type !== 2) continue;
      if (seen.has(type)) return fail();
      seen.add(type);
      const ratio: unknown = row[1];
      if (ratio != null && (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1)) return fail();
      let reset: unknown = null;
      if (row[3] != null) {
        const outer: unknown = row[3];
        if (!Array.isArray(outer) || outer.length !== 1 || !Array.isArray(outer[0])) return fail();
        const stamp = outer[0] as unknown[], seconds = stamp[0], nanos = stamp.length === 1 ? 0 : stamp[1];
        if (stamp.length < 1 || stamp.length > 2 || typeof seconds !== 'number' || !Number.isSafeInteger(seconds)
          || seconds <= 0 || seconds >= 4_102_444_800 || typeof nanos !== 'number' || !Number.isInteger(nanos)
          || nanos < 0 || nanos >= 1_000_000_000) return fail();
        reset = [[seconds, nanos]];
      }
      windows.push([null, ratio ?? null, type, reset]);
    }
    if (!windows.length) return fail();
    return [null, windows];
  };
  const decode = (body: string): unknown => {
    if (!body || body.length > 1_048_576) return fail();
    let text = body.trimStart();
    if (text.startsWith(")]}'")) text = text.slice(4).trimStart();
    const frames: unknown[] = [];
    if (text.startsWith('[')) frames.push(JSON.parse(text));
    else {
      let cursor = 0;
      while (cursor < text.length) {
        while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
        if (cursor === text.length) break;
        const prefix = /^(\d{1,7})\r?\n/.exec(text.slice(cursor));
        if (!prefix) return fail();
        const length = Number(prefix[1]);
        cursor += prefix[0].length;
        if (length <= 0 || length > 1_048_576 || cursor + length > text.length) return fail();
        // Google's documented frame length uses JavaScript UTF-16 code units.
        frames.push(JSON.parse(text.slice(cursor, cursor + length)));
        cursor += length;
        if (cursor < text.length && !/\s/.test(text[cursor]!)) return fail();
        if (frames.length > 100) return fail();
      }
    }
    let answer: unknown = undefined, count = 0;
    for (const frame of frames) {
      if (!Array.isArray(frame) || frame.length > 100) return fail();
      for (const row of frame) {
        if (!Array.isArray(row) || typeof row[0] !== 'string') return fail();
        if (row[0] !== 'wrb.fr' || (row[1] !== 'jSf9Qc' && row[1] !== null)) continue;
        const status: unknown = row[5];
        if (status != null) {
          if (Array.isArray(status) && (status[0] === 1037 || status[0] === 1060)) throw new Error('rate_limited');
          throw new Error('unsupported');
        }
        if (row[1] !== 'jSf9Qc') continue;
        if (++count !== 1 || typeof row[2] !== 'string' || !row[2]) return fail();
        answer = JSON.parse(row[2]);
      }
    }
    if (count !== 1) return fail();
    return sanitize(answer);
  };
  try {
    const token = (window as unknown as { WIZ_global_data?: { SNlM0e?: unknown } }).WIZ_global_data?.SNlM0e;
    if (typeof token !== 'string' || !token || token.length > 16_384) return result(200, 'unsupported');
    const body = new URLSearchParams({ 'f.req': JSON.stringify([[['jSf9Qc', '[]', null, 'generic']]]), at: token });
    const response = await fetch('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=jSf9Qc&source-path=%2Fusage&rt=c', {
      method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' }, body: body.toString()
    });
    if (!response.ok) {
      const wait = response.headers.get('Retry-After');
      return result(response.status, null, wait !== null && wait.length <= 100 ? wait : null);
    }
    if (!/^(?:application\/json|text\/plain)(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')) return result(200, 'invalid_response');
    const reader = response.body?.getReader();
    if (!reader) return result(200, 'invalid_response');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let raw = '', bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1_048_576) {
          await reader.cancel().catch(() => undefined);
          return result(200, 'invalid_response');
        }
        try { raw += decoder.decode(chunk.value, { stream: true }); }
        catch { return result(200, 'invalid_response'); }
      }
      try { raw += decoder.decode(); }
      catch { return result(200, 'invalid_response'); }
    } finally { reader.releaseLock(); }
    try { return result(200, null, null, decode(raw)); }
    catch (error) {
      if (error instanceof Error && error.message === 'rate_limited') return result(429);
      return result(200, error instanceof Error && error.message === 'unsupported' ? 'unsupported' : 'invalid_response');
    }
  } catch { return result(0, 'network'); }
  finally { controller.abort(); clearTimeout(timeout); }
}
