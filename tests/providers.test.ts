import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChatGPT, parseClaude } from '../src/providers/parsers';
import { unwrapTransport } from '../src/providers/tab-transport';
import { collectInPage } from '../src/providers/openai-claude-transport';
import { collectChatGPT } from '../src/providers/chatgpt';
import { CollectionError, httpError, retryAfter } from '../src/shared/errors';
import { resetTime } from '../src/shared/validation';
import { validLimits } from '../src/storage/snapshots';
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
test('Claude synthetic fixture preserves zero, timezone, model limits and strips unrelated fields', () => {
  const items = parseClaude(fixture('claude'));
  assert.equal(items.length, 4); assert.equal(items[0]?.percent, 0); assert.equal(items[0]?.resetsAt, '2026-10-14T01:00:00.000Z');
  assert.equal(items[2]?.percent, null); assert.equal(items[3]?.category, 'model'); assert(validLimits(items)); assert(!JSON.stringify(items).includes('email'));
});
test('Work / Codex fixture labels shared pool, respects actual window length, retains product and zero', () => {
  const items = parseChatGPT(fixture('chatgpt'));
  assert.equal(items.length, 3); assert.match(items[0]!.label, /ChatGPT/); assert.equal(items[2]?.windowSeconds, 2592000); assert.equal(items[2]?.percent, 0); assert(validLimits(items));
});
for (const [name, parser, input] of [
  ['Claude', parseClaude, { five_hour: { utilization: 101, resets_at: '2026-10-14T12:00:00' } }],
  ['Work / Codex', parseChatGPT, { rate_limit: { primary_window: { used_percent: -1, reset_at: '1791964800' } } }],
] as const) {
  test(`${name}: invalid values become unknown, never clamped or inferred`, () => { const l = parser(input)[0]!; assert.equal(l.percent, null); assert.equal(l.resetsAt, null); });
  test(`${name}: missing/unrecognized structure rejects`, () => { for (const v of [null, {}, 'bad', 0]) assert.throws(() => parser(v)); });
}
test('duplicate buckets have stable unique IDs', () => { const v = fixture('claude') as Record<string, unknown>; v.limits = [...v.limits as unknown[], ...v.limits as unknown[]]; assert(validLimits(parseClaude(v))); });
test('timezone-free and invalid dates are not interpreted locally', () => { assert.equal(resetTime('2026-10-14T10:00:00'), null); assert.equal(resetTime('hello'), null); assert.equal(resetTime('2026-10-14T10:00:00+09:00'), '2026-10-14T01:00:00.000Z'); });
test('HTTP status separates unauthorized, denied, rate limit and server failure', () => { assert.equal(httpError(401).state, 'signed_out'); assert.equal(httpError(403).code, 'access_denied'); assert.equal(httpError(429, 90000).retryAfterMs, 90000); assert.equal(httpError(503).code, 'server'); });
test('Retry-After supports seconds and HTTP dates', () => { assert.equal(retryAfter('120', 0), 120000); assert.equal(retryAfter('Wed, 14 Oct 2026 08:00:00 GMT', Date.parse('2026-10-14T07:58:00Z')), 120000); assert.equal(retryAfter('bad'), 0); });
test('transport does not trust error text or malformed status', () => { assert.throws(() => unwrapTransport({ status: 200, code: 'arbitrary-private-text', data: {} })); assert.throws(() => unwrapTransport({ status: '401' })); assert.throws(() => unwrapTransport({ status: 401, code: null }), (e: unknown) => e instanceof CollectionError && e.state === 'signed_out'); });
test('MAIN-world Work / Codex fetch is same-origin GET and credentials never cross the return boundary', async () => {
  const oldFetch = globalThis.fetch, oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://chatgpt.com' }, configurable: true });
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(calls.length === 1 ? { accessToken: 'synthetic-token', email: 'private' } : fixture('chatgpt')), { headers: { 'content-type': 'application/json' } }); };
  try {
    const result = await collectInPage('chatgpt'); assert.equal(result.status, 200); assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://chatgpt.com/api/auth/session');
    assert.equal(calls[1]?.url, 'https://chatgpt.com/backend-api/wham/usage'); assert.equal(calls[1]?.init?.method, 'GET'); assert.equal(calls[1]?.init?.credentials, 'include');
    assert(!JSON.stringify(result).includes('synthetic-token')); assert(!JSON.stringify(result).includes('email')); assert(validLimits(parseChatGPT(result.data)));
  } finally { globalThis.fetch = oldFetch; if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation); else Reflect.deleteProperty(globalThis, 'location'); }
});
test('MAIN-world Claude refuses ambiguous organizations without requesting usage', async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://claude.ai' }, configurable: true });
  globalThis.fetch = async () => { calls++; return new Response('[{"uuid":"one"},{"uuid":"two"}]', { headers: { 'content-type': 'application/json' } }); };
  try { const r = await collectInPage('claude'); assert.equal(r.code, 'ambiguous_account'); assert.equal(calls, 1); }
  finally { globalThis.fetch = oldFetch; Reflect.deleteProperty(globalThis, 'location'); }
});
test('transport maps network failure without leaking exception details', async () => {
  const oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://claude.ai' }, configurable: true }); globalThis.fetch = async () => { throw new Error('private@example.invalid'); };
  try { const r = await collectInPage('claude'); assert.equal(r.code, 'network'); assert(!JSON.stringify(r).includes('private')); }
  finally { globalThis.fetch = oldFetch; Reflect.deleteProperty(globalThis, 'location'); }
});
test('ChatGPT uses one shared pool collector from an ordinary chat tab', async () => {
  const oldChrome = globalThis.chrome;
  globalThis.chrome = { permissions: { contains: async () => true }, tabs: { query: async () => [{ id: 1, url: 'https://chatgpt.com/' }] }, scripting: { executeScript: async (details: { args: string[] }) => { assert.equal(details.args[0], 'chatgpt'); assert.match(details.args[1]!, /^[a-f0-9]{64}$/); return [{ result: { status: 200, code: null, retryAfter: null, data: fixture('chatgpt') } }]; } } } as unknown as typeof chrome;
  try { assert.deepEqual(await collectChatGPT(), { limits: parseChatGPT(fixture('chatgpt')), plan: null }); }
  finally { globalThis.chrome = oldChrome; }
});
test('Pro plan names do not create or suppress hardcoded usage windows', () => {
  for (const plan_type of ['prolite', 'pro', 'promax', 'unknown_future_plan']) {
    const items = parseChatGPT({ plan_type, rate_limit: { primary_window: { used_percent: 45, limit_window_seconds: 604800, reset_at: 1792483200 } } });
    assert.equal(items.length, 1); assert.equal(items[0]?.windowSeconds, 604800); assert(!items.some(i => i.windowSeconds === 18000)); assert.match(items[0]!.label, /7일/);
  }
});
test('availability and credit-unlock flags are never converted into ordinary-chat usage percentages', () => {
  assert.throws(() => parseChatGPT({ model_usage: { 'synthetic-model': { available: true, available_at: null, credits_would_enable: false } } }));
});
test('MAIN-world Claude normalizes a single-organization usage response without account data', async () => {
  const old = globalThis.fetch; let count = 0;
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://claude.ai' }, configurable: true });
  globalThis.fetch = async (url) => { count++; if (count === 2) assert.equal(String(url), 'https://claude.ai/api/organizations/00000000-0000-0000-0000-000000000001/usage?cedar_ember=1'); return new Response(JSON.stringify(count === 1 ? [{ uuid: '00000000-0000-0000-0000-000000000001', name: 'private-org' }] : fixture('claude')), { headers: { 'content-type': 'application/json' } }); };
  try { const r = await collectInPage('claude'); assert.equal(r.status, 200); assert(validLimits(parseClaude(r.data))); assert(!JSON.stringify(r).includes('private-org')); assert(!JSON.stringify(r).includes('email')); }
  finally { globalThis.fetch = old; Reflect.deleteProperty(globalThis, 'location'); }
});
test('MAIN-world HTTP failures preserve 429 Retry-After and missing session maps to signed out', async () => {
  const old = globalThis.fetch; Object.defineProperty(globalThis, 'location', { value: { origin: 'https://chatgpt.com' }, configurable: true });
  try {
    globalThis.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '180' } });
    const r = await collectInPage('chatgpt'); assert.equal(r.status, 429); assert.equal(r.retryAfter, '180'); assert.throws(() => unwrapTransport(r), (e: unknown) => e instanceof CollectionError && e.state === 'rate_limited' && e.retryAfterMs === 180000);
    globalThis.fetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
    assert.equal((await collectInPage('chatgpt')).status, 401);
  } finally { globalThis.fetch = old; Reflect.deleteProperty(globalThis, 'location'); }
});
test('invalid calendar dates and overflowing Retry-After values stay unknown', () => {
  assert.equal(resetTime('2026-02-30T12:00:00Z'), null); assert.equal(resetTime('2026-10-14T24:00:00Z'), null); assert.equal(retryAfter('9'.repeat(1000)), 0);
});
