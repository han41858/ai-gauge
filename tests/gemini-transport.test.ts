import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { parseGemini } from '../src/providers/gemini-parser';
import type { TransportResult } from '../src/providers/tab-transport';

const observed = () => JSON.parse(readFileSync(new URL('./fixtures/gemini-observed.json', import.meta.url), 'utf8'));
const row = (payload: unknown = observed(), rpc: unknown = 'jSf9Qc') => ['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic'];
const framed = (...frames: unknown[]) => ")]}'\n\n" + frames.map(frame => { const json = JSON.stringify(frame); return `${json.length}\n${json}\n`; }).join('');
const compiled = transformSync(readFileSync(new URL('../src/providers/gemini-transport.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'chrome120' }).code;
const module = { exports: {} as { collectGeminiInPage: () => Promise<TransportResult> } };
runInNewContext(compiled, { module });
const serialized = module.exports.collectGeminiInPage.toString();
interface Options { body?: string; status?: number; contentType?: string; retryAfter?: string; url?: string; token?: unknown; error?: boolean; timeout?: boolean; invalidUtf8?: boolean }
async function run(options: Options = {}) {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const sandbox = {
    URL, URLSearchParams, AbortController, TextDecoder, setTimeout: options.timeout ? (callback: () => void) => setTimeout(callback, 0) : setTimeout, clearTimeout,
    location: new URL(options.url ?? 'https://gemini.google.com/app'),
    window: { WIZ_global_data: { SNlM0e: Object.hasOwn(options, 'token') ? options.token : 'synthetic-private-token' } },
    document: new Proxy({}, { get() { throw new Error('DOM must not be read'); } }),
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, options: init });
      if (options.error) throw new Error('private response and credentials must not escape');
      if (options.timeout) return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
      return new Response(options.invalidUtf8 ? new Uint8Array([0xc3, 0x28]) : options.body ?? readFileSync(new URL('./fixtures/gemini-batchexecute.txt', import.meta.url), 'utf8'), { status: options.status ?? 200,
        headers: { 'Content-Type': options.contentType ?? 'application/json; charset=UTF-8', ...(options.retryAfter ? { 'Retry-After': options.retryAfter } : {}) } });
    }
  };
  // This is the same serialization boundary as chrome.scripting.executeScript.
  const value = await runInNewContext(`(${serialized})()`, sandbox) as TransportResult;
  return { value: JSON.parse(JSON.stringify(value)) as TransportResult, calls };
}

test('Gemini MAIN-world function works without imports, reads only bootstrap token and returns only quota fields', async () => {
  const { value, calls } = await run();
  assert.equal(value.status, 200); assert.equal(value.code, null); assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=jSf9Qc&source-path=%2Fusage&rt=c');
  assert.equal(new URL(call.url, 'https://foreign-base.invalid/').origin, 'https://gemini.google.com', 'document base changes cannot change the request origin');
  assert.equal(call.options.method, 'POST'); assert.equal(call.options.credentials, 'include');
  assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.redirect, 'error');
  assert(call.options.signal instanceof AbortSignal);
  const body = new URLSearchParams(call.options.body as string);
  assert.equal(body.get('at'), 'synthetic-private-token');
  assert.deepEqual(JSON.parse(body.get('f.req')!), [[['jSf9Qc', '[]', null, 'generic']]]);
  assert.deepEqual(value.data, [null, [[null, 0, 2, [[1792472727, 343404000]]], [null, 0, 1, [[1791983127, 343263000]]]]]);
  assert.equal(parseGemini(value.data).length, 2);
  assert.doesNotMatch(JSON.stringify(value), /synthetic-private-token|12096|planId|account|email/);
});

test('Gemini handles optional XSSI, UTF-16 length frames and unrelated RPC/status records without parsing their bodies', async () => {
  const frames = [[['wrb.fr', 'unrelated', 'not JSON 🔒', null, null, [1060]]], [row(), ['di', 42], ['af.httprm', 1]]];
  for (const body of [framed(...frames), framed(...frames).slice(6), JSON.stringify([row()]), ")]}'\n" + JSON.stringify([row()])]) {
    const { value } = await run({ body });
    assert.equal(value.code, null); assert.equal(parseGemini(value.data).length, 2);
  }
});

test('Gemini rejects damaged length frames, duplicate RPCs, wrong RPCs, empty data and malformed nested JSON', async () => {
  for (const body of ['', ")]}'\n\n", '1\n[]\n', '999\n[]\n', '[]trailing', framed([row()]).replace(/^\)\]\}'\n\n\d+/, ")]}'\n\n1"),
    framed([row()], [row()]), framed([row(observed(), 'different')]), framed([['wrb.fr', 'jSf9Qc', '{broken']]),
    framed([['wrb.fr', 'jSf9Qc', null]]), framed([row(), null]), framed([row()]) + 'garbage', framed([row([1, []])])]) {
    const { value } = await run({ body });
    assert.equal(value.code, 'invalid_response', body.slice(0, 80)); assert.equal(value.data, null);
  }
});

test('Gemini page validation rejects duplicate windows and invalid ratios/timestamps before the worker boundary', async () => {
  for (const input of [[1, [[1, 1.1, 1, null]]], [1, [[1, '0', 1, null]]], [1, [[1, 0, 1, [[1791983127, 1e9]]]]],
    [1, [[1, 0, 1, null], [2, 0.2, 1, null]]]]) {
    const { value } = await run({ body: framed([row(input)]) });
    assert.equal(value.code, 'invalid_response'); assert.equal(value.data, null);
  }
});

test('Gemini HTTP failures preserve only status and bounded retry-after without exposing error bodies', async () => {
  for (const status of [401, 403, 429, 500]) {
    const { value, calls } = await run({ status, body: 'private authentication error', retryAfter: '120' });
    assert.deepEqual(value, { status, code: null, retryAfter: '120', data: null });
    assert(calls[0]!.options.signal?.aborted, 'unread error bodies must be cancelled when collection ends');
  }
  const { value } = await run({ status: 429, retryAfter: 'x'.repeat(101) });
  assert.equal(value.retryAfter, null);
});

test('Gemini login HTML is not a successful quota response and missing bootstrap is unsupported', async () => {
  for (const token of [undefined, null, '', 123, 'x'.repeat(16385)]) {
    const { value, calls } = await run({ token });
    assert.equal(value.code, 'unsupported'); assert.equal(calls.length, 0);
  }
  const { value, calls } = await run({ contentType: 'text/html', body: '<html>Sign in</html>' });
  assert.equal(value.code, 'invalid_response'); assert.equal(value.data, null);
  assert(calls[0]!.options.signal?.aborted, 'unread HTML bodies must not outlive the request timeout');
});

test('Gemini rejects foreign origins and unverified non-default account selectors without fetching', async () => {
  for (const url of ['https://gemini.google.com.evil/app', 'http://gemini.google.com/app', 'https://gemini.google.com/u/1/app',
    'https://gemini.google.com/app?authuser=1', 'https://gemini.google.com/u/0/app?authuser=1', 'https://gemini.google.com/app?authuser=0&authuser=1']) {
    const { value, calls } = await run({ url });
    assert.notEqual(value.code, null); assert.equal(calls.length, 0);
  }
  for (const url of ['https://gemini.google.com/u/0/app', 'https://gemini.google.com/app?authuser=0']) assert.equal((await run({ url })).value.code, null);
});

test('Gemini in-band errors override any payload while unrelated RPC errors do not', async () => {
  for (const rpc of ['jSf9Qc', null]) {
    const rate = await run({ body: framed([row(), ['wrb.fr', rpc, null, null, null, [1060]]]) });
    assert.equal(rate.value.status, 429); assert.equal(rate.value.data, null);
    const other = await run({ body: framed([['wrb.fr', rpc, null, null, null, [1097]]]) });
    assert.equal(other.value.code, 'unsupported'); assert.equal(other.value.data, null);
  }
});

test('Gemini rejects oversized bodies and returns fixed network errors without private exception text', async () => {
  assert.equal((await run({ body: 'x'.repeat(1048577) })).value.code, 'invalid_response');
  const { value } = await run({ error: true });
  assert.deepEqual(value, { status: 0, code: 'network', retryAfter: null, data: null });
  const timed = await run({ timeout: true });
  assert.equal(timed.value.code, 'network'); assert(timed.calls[0]!.options.signal?.aborted);
  const invalidUtf8 = await run({ invalidUtf8: true });
  assert.equal(invalidUtf8.value.code, 'invalid_response'); assert(invalidUtf8.calls[0]!.options.signal?.aborted);
});
