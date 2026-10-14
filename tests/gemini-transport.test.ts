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
const adjacentFrames = (frames: unknown[], newline: string, includeSeparator: boolean) => frames.map(frame => {
  const json = JSON.stringify(frame);
  return `${json.length + (includeSeparator ? newline.length : 0)}${newline}${json}`;
}).join('');
const compiled = transformSync(readFileSync(new URL('../src/providers/gemini-transport.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'chrome120' }).code;
const module = { exports: {} as { collectGeminiInPage: () => Promise<TransportResult> } };
runInNewContext(compiled, { module });
const serialized = module.exports.collectGeminiInPage.toString();
const quota = (value: TransportResult) => (value.data as { usage: unknown }).usage;
interface Options { body?: string; status?: number; contentType?: string; retryAfter?: string; url?: string; token?: unknown; error?: boolean; timeout?: boolean; invalidUtf8?: boolean; noBody?: boolean }
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
      return new Response(options.noBody ? null : options.invalidUtf8 ? new Uint8Array([0xc3, 0x28]) : options.body ?? readFileSync(new URL('./fixtures/gemini-batchexecute.txt', import.meta.url), 'utf8'), { status: options.status ?? 200,
        headers: { 'Content-Type': options.contentType ?? 'application/json; charset=UTF-8', ...(options.retryAfter ? { 'Retry-After': options.retryAfter } : {}) } });
    }
  };
  // This is the same serialization boundary as chrome.scripting.executeScript.
  const value = await runInNewContext(`(${serialized})()`, sandbox) as TransportResult;
  return { value: JSON.parse(JSON.stringify(value)) as TransportResult, calls };
}

test('Gemini MAIN-world function works without imports, reads only bootstrap token and returns only quota and plan signals', async () => {
  const { value, calls } = await run();
  assert.equal(value.status, 200); assert.equal(value.code, null); assert.equal(calls.length, 2);
  const call = calls[0]!;
  assert.equal(call.url, 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=jSf9Qc&source-path=%2Fusage&rt=c');
  assert.equal(new URL(call.url, 'https://foreign-base.invalid/').origin, 'https://gemini.google.com', 'document base changes cannot change the request origin');
  assert.equal(call.options.method, 'POST'); assert.equal(call.options.credentials, 'include');
  assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.redirect, 'error');
  assert(call.options.signal instanceof AbortSignal);
  const body = new URLSearchParams(call.options.body as string);
  assert.equal(body.get('at'), 'synthetic-private-token');
  assert.deepEqual(JSON.parse(body.get('f.req')!), [[['jSf9Qc', '[]', null, 'generic']]]);
  assert.deepEqual(quota(value), [null, [[null, 0, 2, [[1792472727, 343404000]]], [null, 0, 1, [[1791983127, 343263000]]]]]);
  assert.equal(parseGemini(quota(value)).length, 2);
  assert.equal((value.data as { plan: unknown }).plan, null, 'an unrelated policy response cannot infer a plan');
  assert.doesNotMatch(JSON.stringify(value), /synthetic-private-token|12096|planId|account|email/);
});

test('Gemini handles optional XSSI, UTF-16 length frames and unrelated RPC/status records without parsing their bodies', async () => {
  const frames = [[['wrb.fr', 'unrelated', 'not JSON 🔒', null, null, [1060]]], [row(), ['di', 42], ['af.httprm', 1]]];
  for (const body of [framed(...frames), framed(...frames).slice(6), JSON.stringify([row()]), ")]}'\n" + JSON.stringify([row()])]) {
    const { value } = await run({ body });
    assert.equal(value.code, null); assert.equal(parseGemini(quota(value)).length, 2);
  }
});

test('Gemini accepts lengths including the separator newline, multiple frames and EOF without a final newline', async () => {
  const frames = [[['wrb.fr', 'unrelated', 'not JSON 🔒', null, null, null]], [row()], [['di', 42], ['af.httprm', 1]]];
  const expected = parseGemini(quota((await run()).value));
  for (const newline of ['\n', '\r\n']) {
    const includingSeparator = frames.map(frame => { const json = JSON.stringify(frame); return `${json.length + newline.length}${newline}${json}`; }).join(newline);
    for (const body of [includingSeparator, includingSeparator + newline, ")]}'\n\n" + includingSeparator]) {
      const { value } = await run({ body });
      assert.equal(value.code, null); assert.deepEqual(parseGemini(quota(value)), expected);
    }
  }
});

test('Gemini accepts adjacent length frames without whitespace between JSON and the next length marker', async () => {
  const frames = [[['wrb.fr', 'unrelated', 'not JSON 🔒', null, null, null]], [row()], [['di', 42], ['af.httprm', 1]]];
  const expected = parseGemini(quota((await run()).value));
  for (const newline of ['\n', '\r\n']) for (const includeSeparator of [false, true]) {
    const content = adjacentFrames(frames, newline, includeSeparator);
    assert.match(content, /\]\]\d+\r?\n\[/, 'fixture must have no whitespace between frame content and the next length');
    for (const prefix of ['', ")]}'\n\n"]) for (const suffix of ['', newline]) {
      const { value } = await run({ body: prefix + content + suffix });
      assert.equal(value.code, null);
      assert.deepEqual(parseGemini(quota(value)), expected);
    }
  }
});

test('Gemini parses the user-observed redacted response with separator lengths and a copied final newline omitted', async () => {
  const specimen = readFileSync(new URL('./fixtures/gemini-batchexecute-observed-redacted.txt', import.meta.url), 'utf8');
  const lines = specimen.trimEnd().split('\n');
  assert.equal(lines[2], '207'); assert.equal(lines[3]!.length, 205);
  assert.equal(lines[4], '25'); assert.equal(lines[5]!.length, 23);
  for (const body of [specimen, specimen.trimEnd()]) {
    const { value } = await run({ body });
    assert.equal(value.code, null);
    assert.deepEqual(quota(value), [null, [[null, 4.305e-4, 2, [[1792472727, 343404000]]], [null, 0.01, 1, [[1791983127, 343263000]]]]]);
    const limits = parseGemini(quota(value));
    assert.deepEqual(limits.map(limit => limit.percent), [0.04305, 1]);
    assert.deepEqual(limits.map(limit => limit.resetsAt), ['2026-10-20T05:05:27.343Z', '2026-10-14T13:05:27.343Z']);
    assert(limits.every(limit => limit.remaining === null && limit.unit === null));
    assert.doesNotMatch(JSON.stringify(value), /af\.httprm|0000000000000000000|12090|594|generic/);
  }
});

test('the final-newline exception does not accept truncated JSON or larger missing frame lengths', async () => {
  const specimen = readFileSync(new URL('./fixtures/gemini-batchexecute-observed-redacted.txt', import.meta.url), 'utf8').trimEnd();
  for (const body of [specimen.slice(0, -1), specimen.slice(0, -1) + '\n', specimen.replace('\n25\n', '\n26\n'), specimen.replace('\n25\n', '\n27\n')]) {
    const { value } = await run({ body });
    assert.deepEqual(value, { status: 200, code: 'gemini_frame_invalid', retryAfter: null, data: null });
  }
});

test('Gemini parses every adjacent frame so later in-band errors override an earlier valid quota', async () => {
  for (const newline of ['\n', '\r\n']) for (const includeSeparator of [false, true]) {
    for (const rpc of ['jSf9Qc', null]) for (const status of [1037, 1060, 1097]) {
      const body = ")]}'\n\n" + adjacentFrames([[row()], [['wrb.fr', rpc, null, null, null, [status]]]], newline, includeSeparator);
      const { value } = await run({ body });
      assert.deepEqual(value, status === 1097
        ? { status: 200, code: 'unsupported', retryAfter: null, data: null }
        : { status: 429, code: null, retryAfter: null, data: null });
    }
  }
});

test('Gemini adjacent framing still rejects malformed tails and duplicate quota records', async () => {
  for (const newline of ['\n', '\r\n']) for (const includeSeparator of [false, true]) {
    const content = adjacentFrames([[row()], [['di', 42]]], newline, includeSeparator);
    for (const suffix of ['private-invalid-tail', '2junk\n[]', '999\n[]', '2\n[]private-invalid-tail']) {
      const { value } = await run({ body: content + suffix });
      assert.deepEqual(value, { status: 200, code: 'gemini_frame_invalid', retryAfter: null, data: null });
      assert.doesNotMatch(JSON.stringify(value), /private-invalid-tail/);
    }
    const duplicate = await run({ body: adjacentFrames([[row()], [row()]], newline, includeSeparator) });
    assert.deepEqual(duplicate.value, { status: 200, code: 'gemini_rpc_invalid', retryAfter: null, data: null });
  }
});

test('Gemini accepts complete JSON or strict line-delimited frames without changing quota interpretation', async () => {
  const frames = [[row()], [['di', 42], ['af.httprm', 1]]];
  const expected = parseGemini(quota((await run()).value));
  for (const body of [JSON.stringify([row()], null, 2), frames.map(frame => JSON.stringify(frame)).join('\n'),
    ")]}'\n\n" + frames.map(frame => JSON.stringify(frame)).join('\r\n\r\n') + '\r\n']) {
    const { value } = await run({ body });
    assert.equal(value.code, null); assert.deepEqual(parseGemini(quota(value)), expected);
  }
});

test('Gemini rejects damaged frames without skipping bad lines or exposing their text', async () => {
  for (const body of ['', ")]}'\n\n", '1\n[]\n', '999\n[]\n', '[]trailing', framed([row()]).replace(/^\)\]\}'\n\n\d+/, ")]}'\n\n1"),
    framed([row(), null]), framed([row()]) + 'garbage', JSON.stringify([row()]) + '\nprivate broken frame',
    JSON.stringify([row()]) + '\n{}', JSON.stringify([row()]) + '\n2\n[]', Array(101).fill('[]').join('\n'),
    framed(...Array(101).fill([])), framed([row()]).replace(/\n\n\d+\n/, '\n\n1048577\n')]) {
    const { value } = await run({ body });
    assert.equal(value.code, 'gemini_frame_invalid', body.slice(0, 80)); assert.equal(value.data, null);
    assert.doesNotMatch(JSON.stringify(value), /private broken frame/);
  }
});

test('Gemini distinguishes missing RPC, invalid RPC and invalid quota using only fixed codes', async () => {
  const cases: Array<[string, string]> = [
    ['gemini_rpc_missing', framed([row(observed(), 'different')])],
    ['gemini_rpc_missing', '[]'],
    ['gemini_rpc_invalid', framed([row()], [row()])],
    ['gemini_rpc_invalid', [JSON.stringify([row()]), JSON.stringify([row()])].join('\n')],
    ['gemini_rpc_invalid', framed([['wrb.fr', 'jSf9Qc', '{private malformed JSON']])],
    ['gemini_rpc_invalid', framed([['wrb.fr', 'jSf9Qc', null]])],
    ['gemini_quota_invalid', framed([row([1, []])])]
  ];
  for (const [code, body] of cases) {
    const { value } = await run({ body });
    assert.deepEqual(value, { status: 200, code, retryAfter: null, data: null });
  }
});

test('Gemini page validation rejects duplicate windows and invalid ratios/timestamps before the worker boundary', async () => {
  for (const input of [[1, [[1, 1.1, 1, null]]], [1, [[1, '0', 1, null]]], [1, [[1, 0, 1, [[1791983127, 1e9]]]]],
    [1, [[1, 0, 1, null], [2, 0.2, 1, null]]]]) {
    const { value } = await run({ body: framed([row(input)]) });
    assert.equal(value.code, 'gemini_quota_invalid'); assert.equal(value.data, null);
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
  assert.equal(value.code, 'gemini_response_type'); assert.equal(value.data, null);
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
  assert.equal((await run({ body: 'x'.repeat(1048577) })).value.code, 'gemini_response_read');
  assert.equal((await run({ noBody: true })).value.code, 'gemini_response_read');
  const { value } = await run({ error: true });
  assert.deepEqual(value, { status: 0, code: 'network', retryAfter: null, data: null });
  const timed = await run({ timeout: true });
  assert.equal(timed.value.code, 'network'); assert(timed.calls[0]!.options.signal?.aborted);
  const invalidUtf8 = await run({ invalidUtf8: true });
  assert.equal(invalidUtf8.value.code, 'gemini_response_read'); assert(invalidUtf8.calls[0]!.options.signal?.aborted);
});
