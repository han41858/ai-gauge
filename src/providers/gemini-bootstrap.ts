import { collectGeminiInPage } from './gemini-transport';
import type { TransportResult } from './tab-transport';

// Public bootstrap contract: /app contains a WIZ_global_data script object whose
// SNlM0e value authorizes the same-origin read-only RPCs. No HTML or token is cached.
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SCRIPT = 256 * 1024;
const APP_URL = 'https://gemini.google.com/app';

function bootstrapToken(script: string): string | null | undefined {
  const assignment = /^\s*(?:window\.)?WIZ_global_data\s*=\s*/.exec(script);
  if (!assignment) return undefined;
  const source = script.slice(assignment[0].length);
  if (!source.startsWith('{')) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      if (--depth !== 0) continue;
      try {
        const rest = source.slice(index + 1).trimStart();
        if (rest && !rest.startsWith(';')) return null;
        const value: unknown = JSON.parse(source.slice(0, index + 1));
        const token = value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>).SNlM0e : null;
        return typeof token === 'string' && token.length > 0 && token.length <= 16_384 && !/[\u0000-\u001f\u007f]/.test(token) ? token : null;
      } catch { return null; }
    }
  }
  return undefined;
}

// Read complete tags, including quoted attributes, before looking for script
// elements. Searching globally for "<script" would also match inert user text.
function tagEnd(source: string): number {
  let quote = '';
  for (let index = 1; index < source.length; index++) {
    const char = source[index]!;
    if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  return -1;
}
function executableScript(attributes: string): boolean {
  const values = new Map<string, string>();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of attributes.matchAll(pattern)) {
    const name = match[1]!.toLowerCase();
    // Duplicate attributes and entity-encoded type values are not part of the
    // verified bootstrap shape; rejecting them is safer than HTML interpretation.
    if (values.has(name)) return false;
    values.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  if (values.has('src') || values.has('nomodule')) return false;
  const type = values.get('type')?.trim().toLowerCase();
  const language = values.get('language')?.trim().toLowerCase();
  return (type === undefined || type === '' || type === 'text/javascript' || type === 'application/javascript')
    && (language === undefined || language === '' || language === 'javascript');
}

async function readBootstrap(response: Response): Promise<string | null> {
  if (!/^text\/html(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', bytes = 0;
  let raw: { name: string; candidate: boolean } | null = null;
  const inert: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return null;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) return null;
      buffer += decoder.decode(chunk.value, { stream: true });
      while (buffer) {
        if (raw) {
          const closing = new RegExp(`</${raw.name}(?=[\\t\\n\\f\\r />])`, 'i').exec(buffer);
          const body = closing ? buffer.slice(0, closing.index) : buffer;
          if (raw.candidate) {
            if (body.length > MAX_SCRIPT) return null;
            const token = bootstrapToken(body);
            if (token !== undefined) return token;
          }
          if (!closing) break;
          const tail = buffer.slice(closing.index), end = tagEnd(tail);
          if (end < 0) break;
          buffer = tail.slice(end + 1); raw = null; continue;
        }
        const start = buffer.indexOf('<');
        if (start < 0) { buffer = ''; break; }
        buffer = buffer.slice(start);
        if ('<!--'.startsWith(buffer)) break;
        if (buffer.startsWith('<!--')) {
          const end = buffer.indexOf('-->');
          if (end < 0) break;
          buffer = buffer.slice(end + 3); continue;
        }
        const end = tagEnd(buffer);
        if (end < 0) break;
        const tag = buffer.slice(0, end + 1);
        buffer = buffer.slice(end + 1);
        const parsed = /^<(\/?)([a-z][a-z0-9:-]*)(?=[\s/>])/i.exec(tag);
        if (!parsed) continue;
        const name = parsed[2]!.toLowerCase(), closing = parsed[1] === '/';
        if (closing) {
          if (inert.at(-1) === name) inert.pop();
          continue;
        }
        if (name === 'template' || name === 'svg' || name === 'math') { inert.push(name); continue; }
        if (name === 'plaintext') return null;
        if (['script', 'textarea', 'title', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'].includes(name)) {
          raw = { name, candidate: name === 'script' && inert.length === 0 && executableScript(tag.slice(parsed[0].length, -1)) };
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function validBootstrap(response: Response): boolean {
  // redirect:error also enforces this in Chrome. Retain an explicit guard so
  // mocks and unexpected response wrappers cannot supply a foreign login token.
  return response.ok && !response.redirected && (!response.url || response.url === APP_URL);
}
function bootstrapRequest(signal: AbortSignal): Promise<Response> {
  return fetch(APP_URL, { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', signal, headers: { Accept: 'text/html' } });
}

export async function collectGeminiInWorker(): Promise<TransportResult> {
  const result = (status: number, code: string | null = null, retryAfter: string | null = null): TransportResult => ({ status, code, retryAfter, data: null });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await bootstrapRequest(controller.signal);
    if (!response.ok) return result(response.status, null, response.headers.get('Retry-After'));
    if (!validBootstrap(response)) return result(0, 'open_tab');
    const token = await readBootstrap(response);
    if (!token) return result(0, 'open_tab');
    const collected = await collectGeminiInPage(token, controller.signal);
    const data = collected.data && typeof collected.data === 'object' && !Array.isArray(collected.data)
      ? collected.data as Record<string, unknown> : null;
    if (!data?.plan) return collected;
    // With no page available, compare the transient bootstrap again before
    // joining policy to usage. A changed/missing token hides only the plan.
    const verify = new AbortController(), verifyTimer = setTimeout(() => verify.abort(), 3_000);
    try {
      const again = await bootstrapRequest(AbortSignal.any([controller.signal, verify.signal]));
      if (validBootstrap(again) && await readBootstrap(again) === token) return collected;
    } catch { /* A policy context check must not discard valid usage. */ }
    finally { verify.abort(); clearTimeout(verifyTimer); }
    return { ...collected, data: { ...data, plan: null } };
  } catch { return result(0, 'network'); }
  finally { controller.abort(); clearTimeout(timer); }
}
