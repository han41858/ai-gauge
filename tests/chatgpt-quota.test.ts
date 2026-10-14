import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { parseChatGPT, parseChatGPTObservation } from '../src/providers/chatgpt-parser';
import { installChatGPTObserver, readChatGPTObservation, stopChatGPTObserver } from '../src/providers/chatgpt-observer';
import { validLimits } from '../src/storage/snapshots';

const reset = '2026-10-14T17:00:00+09:00';
const sample = (remaining = 25) => ({ limits_progress: [{ feature_name: 'deep_research', remaining, reset_after: reset }] });

test('ChatGPT published metadata shape yields feature count and absolute reset, never a percentage', () => {
  const limits = parseChatGPT(sample());
  assert(validLimits(limits));
  assert.equal(limits[0]?.remaining, 25);
  assert.equal(limits[0]?.resetsAt, '2026-10-14T08:00:00.000Z');
  assert.equal(limits[0]?.percent, null);
  assert.equal(limits[0]?.windowSeconds, null);
  assert.equal(limits[0]?.category, 'product');
  assert.equal(limits[0]?.unit, null);
  assert.equal(parseChatGPT(sample(0))[0]?.remaining, 0);
  assert.equal(parseChatGPT(sample(0))[0]?.percent, null);
});

test('ChatGPT does not substitute Codex rates, model availability, blocked features, or synthetic totals', () => {
  assert.throws(() => parseChatGPT({ rate_limit: { primary_window: { used_percent: 42 } } }));
  assert.deepEqual(parseChatGPT({ limits_progress: [], model_usage: { model: { available: false } }, blocked_features: [{ name: 'reason', limit: 50 }], model_limits: [{ limit: 50 }] }), []);
  assert.equal(parseChatGPT({ limits_progress: [{ feature_name: 'reason', remaining: 2, limit: 10, used_percent: 80 }] })[0]?.percent, null);
});

test('ChatGPT rejects missing contracts and invalid counts without coercion or time guessing', () => {
  for (const input of [null, {}, { limits_progress: {} }, { limits_progress: null }]) assert.throws(() => parseChatGPT(input));
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '25', null, undefined, NaN, Infinity]) {
    const limits = parseChatGPT({ limits_progress: [{ feature_name: 'reason', remaining: value, reset_after: reset }] });
    assert.equal(limits[0]?.remaining, null);
    assert.equal(limits[0]?.percent, null);
  }
  for (const value of ['2026-10-14T17:00:00', 1791964800, 'tomorrow', null]) {
    assert.equal(parseChatGPT({ limits_progress: [{ feature_name: 'reason', remaining: 2, reset_after: value }] })[0]?.resetsAt, null);
  }
});

test('ChatGPT drops ambiguous duplicate features and bounds feature metadata', () => {
  assert.deepEqual(parseChatGPT({ limits_progress: [{ feature_name: 'reason', remaining: 2 }, { feature_name: 'reason', remaining: 3 }] }), []);
  assert.deepEqual(parseChatGPT({ limits_progress: [{ feature_name: '<img>', remaining: 1 }, { feature_name: 'private@example.com', remaining: 1 }, { feature_name: 'x'.repeat(81), remaining: 1 }] }), []);
  assert.equal(parseChatGPT({ limits_progress: Array.from({ length: 60 }, (_, i) => ({ feature_name: `feature_${i}`, remaining: i })) }).length, 50);
});

test('ChatGPT cache preserves actual observation time and empty array clears old rows', () => {
  const now = 1_792_000_000_000, observedAt = now - 3_600_000;
  assert.equal(parseChatGPTObservation({ version: 1, observedAt, data: sample() }, now).observedAt, observedAt);
  assert.deepEqual(parseChatGPTObservation({ version: 1, observedAt: now, data: { limits_progress: [] } }, now).limits, []);
  for (const observation of [{ version: 2, observedAt: now, data: sample() }, { version: 1, observedAt: now + 60_001, data: sample() }, { version: 1, observedAt: 0, data: sample() }]) assert.throws(() => parseChatGPTObservation(observation, now));
});

type FetchCall = { input: RequestInfo | URL; init: RequestInit | undefined };
async function pageFixture(run: (context: { calls: FetchCall[]; document: EventTarget; setReply: (value: unknown, status?: number, type?: string) => void; location: { origin: string; pathname: string; href: string }; originalFetch: typeof fetch }) => Promise<void>): Promise<void> {
  const fetchBefore = globalThis.fetch;
  const locationBefore = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = new EventTarget();
  const location = { origin: 'https://chatgpt.com', pathname: '/', href: 'https://chatgpt.com/' };
  const calls: FetchCall[] = [];
  let reply: unknown = sample(), status = 200, type = 'application/json';
  const originalFetch: typeof fetch = (input, init) => { calls.push({ input, init }); return Promise.resolve(new Response(JSON.stringify(reply), { status, headers: { 'content-type': type } })); };
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: location, configurable: true });
  globalThis.fetch = originalFetch;
  const host = globalThis as typeof globalThis & Record<string, unknown>;
  try { await run({ calls, document, location, originalFetch, setReply: (value, nextStatus = 200, nextType = 'application/json') => { reply = value; status = nextStatus; type = nextType; } }); }
  finally {
    stopChatGPTObserver();
    delete host.__AI_GAUGE_CHATGPT_OBSERVER_V1__;
    delete host.__AI_GAUGE_CHATGPT_QUOTA_V1__;
    globalThis.fetch = fetchBefore;
    if (locationBefore) Object.defineProperty(globalThis, 'location', locationBefore); else Reflect.deleteProperty(globalThis, 'location');
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore); else Reflect.deleteProperty(globalThis, 'document');
  }
}
const published = (document: EventTarget) => new Promise<void>(resolve => document.addEventListener('ai-gauge-chatgpt-quota', () => resolve(), { once: true }));
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('ChatGPT observer issues no requests and leaves original request body/headers and response intact', async () => pageFixture(async ({ calls, document, setReply }) => {
  installChatGPTObserver();
  const wrapper = globalThis.fetch;
  installChatGPTObserver();
  assert.equal(globalThis.fetch, wrapper);
  assert.equal(calls.length, 0);
  setReply({ ...sample(), email: 'private@example.com', accessToken: 'private-token', conversation_id: 'private-id' });
  const init: RequestInit = { method: 'POST', get body(): string { throw new Error('Do not read a prompt'); }, get headers(): HeadersInit { throw new Error('Do not read credentials'); } };
  const event = published(document);
  const response = await fetch('/backend-api/conversation/init', init);
  await event;
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init, init);
  assert.equal(response.bodyUsed, false);
  assert.equal((await response.json()).accessToken, 'private-token');
  const observation = readChatGPTObservation();
  assert.equal(parseChatGPTObservation(observation).limits[0]?.remaining, 25);
  assert(!JSON.stringify(observation).includes('private'));
  const timestamp = observation?.observedAt;
  assert.equal(readChatGPTObservation()?.observedAt, timestamp);
}));

test('ChatGPT observer ignores conversations, SSE, cross-origin endpoints, and Codex/Work routes', async () => pageFixture(async ({ calls, location, setReply }) => {
  installChatGPTObserver();
  for (const url of ['/backend-api/conversation', '/backend-api/f/conversation', '/backend-api/conversations', '/backend-api/wham/usage', 'https://elsewhere.invalid/backend-api/conversation/init', '/backend-api/conversation/init/']) await fetch(url);
  await settle();
  assert.equal(readChatGPTObservation(), null);
  setReply(sample(), 200, 'text/event-stream');
  await fetch('/backend-api/conversation/init');
  await settle();
  assert.equal(readChatGPTObservation(), null);
  setReply(sample());
  for (const path of ['/codex', '/codex/tasks', '/work']) {
    location.pathname = path;
    await fetch('/backend-api/conversation/init');
    await settle();
  }
  location.pathname = '/';
  assert.equal(readChatGPTObservation(), null);
  assert.equal(calls.length, 10);
}));

test('ChatGPT observer replaces old quotas with empty or unavailable init metadata', async () => pageFixture(async ({ document, setReply }) => {
  installChatGPTObserver();
  let event = published(document);
  await fetch(new URL('https://chatgpt.com/backend-api/conversation/init'));
  await event;
  assert.equal(readChatGPTObservation()?.data.limits_progress?.length, 1);
  setReply({ limits_progress: [] });
  event = published(document);
  await fetch(new Request('https://chatgpt.com/backend-api/conversation/init'));
  await event;
  assert.deepEqual(parseChatGPTObservation(readChatGPTObservation()).limits, []);
  setReply({ message: 'private-error' }, 401);
  event = published(document);
  await fetch('/backend-api/conversation/init');
  await event;
  assert.equal(readChatGPTObservation()?.data.limits_progress, null);
  assert(!JSON.stringify(readChatGPTObservation()).includes('private-error'));
}));

test('normal init without optional quota metadata clears old quotas without inventing an invalid response', async () => pageFixture(async ({ document, setReply }) => {
  installChatGPTObserver();
  for (const reply of [{ blocked_features: [], model_limits: [] }, { limits_progress: null }]) {
    setReply(sample());
    let event = published(document);
    await fetch('/backend-api/conversation/init');
    await event;
    assert.equal(parseChatGPTObservation(readChatGPTObservation()).limits.length, 1);
    setReply(reply);
    event = published(document);
    await fetch('/backend-api/conversation/init');
    await event;
    assert.deepEqual(parseChatGPTObservation(readChatGPTObservation()).limits, []);
  }
}));

test('malformed init metadata is still rejected instead of becoming absent quota or zero usage', async () => pageFixture(async ({ document, setReply }) => {
  installChatGPTObserver();
  for (const reply of [null, [], { limits_progress: {} }, { limits_progress: 'none' }]) {
    setReply(reply);
    const event = published(document);
    await fetch('/backend-api/conversation/init');
    await event;
    assert.throws(() => parseChatGPTObservation(readChatGPTObservation()));
  }
}));

test('ChatGPT reader re-allowlists page cache and never returns arbitrary page fields', async () => pageFixture(async () => {
  const host = globalThis as typeof globalThis & Record<string, unknown>;
  host.__AI_GAUGE_CHATGPT_QUOTA_V1__ = { version: 1, observedAt: Date.now(), private: 'private-token', data: { limits_progress: [{ feature_name: 'reason', remaining: 0, reset_after: reset, raw: 'private-message' }], accessToken: 'private-token' } };
  const observation = readChatGPTObservation();
  assert(!JSON.stringify(observation).includes('private'));
  assert.equal(observation?.data.limits_progress?.[0]?.remaining, 0);
}));

test('ChatGPT stop event clears cache, restores its fetch wrapper and permits reinstall', async () => pageFixture(async ({ originalFetch, document }) => {
  installChatGPTObserver();
  const event = published(document);
  await fetch('/backend-api/conversation/init');
  await event;
  document.dispatchEvent(new Event('ai-gauge-chatgpt-stop'));
  assert.equal(globalThis.fetch, originalFetch);
  assert.equal(readChatGPTObservation(), null);
  installChatGPTObserver();
  assert.notEqual(globalThis.fetch, originalFetch);
  const otherWrapper: typeof fetch = (...args) => originalFetch(...args);
  globalThis.fetch = otherWrapper;
  stopChatGPTObserver();
  assert.equal(globalThis.fetch, otherWrapper);
}));

test('ChatGPT observation ordering and stop reject late responses without changing page promises', async () => pageFixture(async ({ document }) => {
  const pending: Array<(response: Response) => void> = [];
  const promises: Promise<Response>[] = [];
  globalThis.fetch = () => {
    const promise = new Promise<Response>(resolve => pending.push(resolve));
    promises.push(promise);
    return promise;
  };
  installChatGPTObserver();
  const first = fetch('/backend-api/conversation/init');
  const second = fetch('/backend-api/conversation/init');
  assert.equal(first, promises[0]);
  assert.equal(second, promises[1]);
  const event = published(document);
  pending[1]!(new Response('{"limits_progress":[]}', { headers: { 'content-type': 'application/json' } }));
  await event;
  pending[0]!(new Response(JSON.stringify(sample()), { headers: { 'content-type': 'application/json' } }));
  await first;
  await settle();
  assert.deepEqual(readChatGPTObservation()?.data.limits_progress, []);
  const third = fetch('/backend-api/conversation/init');
  stopChatGPTObserver();
  pending[2]!(new Response(JSON.stringify(sample()), { headers: { 'content-type': 'application/json' } }));
  await third;
  await settle();
  assert.equal(readChatGPTObservation(), null);
}));

test('production-transformed ChatGPT observer functions run after independent Chrome-style serialization', async () => pageFixture(async ({ document }) => {
  const source = readFileSync(new URL('../src/providers/chatgpt-observer.ts', import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'ts', format: 'esm', target: 'chrome120' }).code;
  const compiled = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as {
    installChatGPTObserver: typeof installChatGPTObserver;
    readChatGPTObservation: typeof readChatGPTObservation;
    stopChatGPTObserver: typeof stopChatGPTObserver;
  };
  const serialize = <T extends (...args: never[]) => unknown>(fn: T): T => new Function(`return (${fn.toString()})`)() as T;
  const install = serialize(compiled.installChatGPTObserver);
  const read = serialize(compiled.readChatGPTObservation);
  const stop = serialize(compiled.stopChatGPTObserver);
  install();
  const event = published(document);
  await fetch('/backend-api/conversation/init');
  await event;
  assert.equal(read()?.data.limits_progress?.[0]?.remaining, 25);
  stop();
  assert.equal(read(), null);
}));
