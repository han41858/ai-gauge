import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { parseGeminiPlan } from '../src/providers/gemini-plan';
import { parseGemini } from '../src/providers/gemini-parser';
import { collectGemini } from '../src/providers/gemini';
import type { TransportResult } from '../src/providers/tab-transport';

const observed = JSON.parse(readFileSync(new URL('./fixtures/gemini-observed.json', import.meta.url), 'utf8')) as unknown[];
const envelope = (rpc: string, payload: unknown) => ")]}'\n\n" + JSON.stringify([['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic']]);
const compiled = transformSync(readFileSync(new URL('../src/providers/gemini-transport.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'chrome120' }).code;
const module = { exports: {} as { collectGeminiInPage: () => Promise<TransportResult> } };
runInNewContext(compiled, { module });
const serialized = module.exports.collectGeminiInPage.toString();
interface Options {
  policies?: unknown; policyBody?: string; policyStatus?: number; policyContentType?: string;
  policyNetwork?: boolean; policyTimeout?: boolean; quotaStatus?: number; planId?: unknown;
  changedToken?: boolean; changedLocation?: boolean;
}
async function collectPage(options: Options = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [], timers: number[] = [];
  const location = new URL('https://gemini.google.com/app');
  const window = { WIZ_global_data: { SNlM0e: 'private-bootstrap-token' } };
  const sandbox = {
    URL, URLSearchParams, AbortController, TextDecoder, location, window, clearTimeout,
    setTimeout(callback: () => void, milliseconds: number) {
      timers.push(milliseconds);
      return setTimeout(callback, options.policyTimeout && milliseconds === 3_000 ? 0 : milliseconds);
    },
    document: new Proxy({}, { get() { throw new Error('No conversation or profile DOM access'); } }),
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      const rpc = new URL(url).searchParams.get('rpcids');
      if (rpc === 'jSf9Qc') return new Response(envelope('jSf9Qc', [Object.hasOwn(options, 'planId') ? options.planId : observed[0], observed[1]]),
        { status: options.quotaStatus ?? 200, headers: { 'Content-Type': 'application/json' } });
      assert.equal(rpc, 'otAQ7b', 'only the two allowed RPCs may be used');
      if (options.policyNetwork) throw new Error('private-network-details');
      if (options.policyTimeout) return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
      if (options.changedToken) window.WIZ_global_data.SNlM0e = 'new-private-bootstrap-token';
      if (options.changedLocation) location.pathname = '/u/1/app';
      return new Response(options.policyBody ?? envelope('otAQ7b', Object.hasOwn(options, 'policies') ? options.policies : [[['plus_policy']]]),
        { status: options.policyStatus ?? 200, headers: { 'Content-Type': options.policyContentType ?? 'application/json' } });
    }
  };
  const value = JSON.parse(JSON.stringify(await runInNewContext(`(${serialized})()`, sandbox))) as TransportResult;
  return { value, calls, timers, data: value.data as { usage: unknown; plan: unknown } };
}

test('Gemini uses only documented exact policies and never treats planId as a subscription mapping', () => {
  const mappings: Array<[string, string]> = [
    ['v3p2_free_policy', 'Free'], ['v3p2_basic_policy', 'Free'], ['basic_policy', 'Free'], ['brownfield_basic_policy', 'Free'],
    ['v3p2_plus_policy', 'AI Plus'], ['brownfield_paid_policy', 'AI Plus'],
    ['v3p2_pro_policy', 'AI Pro'], ['plus_policy', 'AI Pro'],
    ['v3p2_ultra_policy', 'AI Ultra'], ['neon_policy', 'AI Ultra'], ['v3p2_business_policy', 'Workspace']
  ];
  for (const [policy, expected] of mappings) for (const planId of [null, 1, 2, 4, 6, 999]) {
    assert.equal(parseGeminiPlan({ planId, policies: [policy] }), expected);
  }
  for (const planId of [null, 1, 2, 3, 4, 5, 6, 'Business', 'Ultra']) {
    assert.equal(parseGeminiPlan({ planId, policies: [] }), null);
    assert.equal(parseGeminiPlan({ planId }), null);
  }
});

test('Gemini unknown, missing, malformed or conflicting policy signals remain unknown', () => {
  for (const input of [null, [], {}, { policies: null }, { policies: ['v3p2_future_policy'] },
    { policies: ['default_policy', 'lite_two_thinking_levels_policy'] }, { policies: ['PLUS_POLICY'] },
    { policies: ['prefix_v3p2_pro_policy'] }, { policies: ['plus_policy ', '<script>'] },
    { policies: ['plus_policy', 'neon_policy'] }, { policies: [null] }, { policies: ['x'.repeat(81)] },
    { policies: Array(21).fill('plus_policy') }]) assert.equal(parseGeminiPlan(input), null);
  assert.equal(parseGeminiPlan({ policies: ['unclassified_policy', 'v3p2_pro_policy', 'plus_policy'] }), 'AI Pro');
});

test('Gemini policy RPC reuses the collection session and exposes only bounded allowlisted signals', async () => {
  const { value, data, calls, timers } = await collectPage({ planId: 2,
    policies: [[['private@example.invalid', 'private-model-name', 'plus_policy']], ['unclassified_policy'], { profile: 'private-name', policy: 'neon_policy' }] });
  assert.equal(value.status, 200); assert.equal(value.code, null); assert.equal(calls.length, 2);
  assert.deepEqual(data.plan, { planId: 2, policies: ['plus_policy'] });
  assert.equal(parseGeminiPlan(data.plan), 'AI Pro'); assert.deepEqual(parseGemini(data.usage), parseGemini(observed));
  assert.deepEqual(timers, [15_000, 3_000]);
  const policy = calls[1]!;
  assert.equal(policy.url, 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=otAQ7b&source-path=%2Fusage&rt=c');
  assert.equal(policy.init.method, 'POST'); assert.equal(policy.init.credentials, 'include');
  assert.equal(policy.init.redirect, 'error'); assert.equal(policy.init.cache, 'no-store');
  const body = new URLSearchParams(policy.init.body as string);
  assert.equal(body.get('at'), 'private-bootstrap-token');
  assert.deepEqual(JSON.parse(body.get('f.req')!), [[['otAQ7b', '[]', null, 'generic']]]);
  assert(calls.every(call => call.init.signal?.aborted));
  assert.doesNotMatch(JSON.stringify(value), /private|unclassified|profile|generic|at:|remaining/);
});

test('Gemini optional policy failures never discard successful quota or infer a numeric-ID plan', async () => {
  const failures: Options[] = [
    ...[401, 403, 429, 500].map(policyStatus => ({ policyStatus })),
    { policyNetwork: true }, { policyTimeout: true }, { policyContentType: 'text/html', policyBody: '<html>Private login</html>' },
    { policyBody: 'malformed-private-response' }, { policyBody: envelope('otherRpc', [['plus_policy']]) },
    { policies: null }, { policies: {} }, { policies: [] }, { policies: [['unknown_policy']] },
    { policyBody: JSON.stringify([['wrb.fr', 'otAQ7b', null, null, null, [1060]]]) }
  ];
  for (const failure of failures) {
    const { value, data } = await collectPage({ ...failure, planId: 6 });
    assert.equal(value.code, null); assert.equal(value.status, 200);
    assert.deepEqual(parseGemini(data.usage), parseGemini(observed));
    assert.equal(parseGeminiPlan(data.plan), null);
    assert.doesNotMatch(JSON.stringify(value), /Private|private-response|network-details/);
  }
});

test('Gemini validates policy traversal bounds without turning an optional response change into a usage failure', async () => {
  let deep: unknown = 'plus_policy';
  for (let i = 0; i < 21; i++) deep = [deep];
  for (const policies of [deep, Array(1001).fill('plus_policy'), Array(5).fill(Array(1000).fill('plus_policy'))]) {
    const { value, data } = await collectPage({ policies });
    assert.equal(value.code, null); assert.equal(parseGeminiPlan(data.plan), null);
    assert.deepEqual(parseGemini(data.usage), parseGemini(observed));
  }
});

test('Gemini rejects plan association after a page/account change and does not fetch policies after quota failure', async () => {
  for (const change of [{ changedToken: true }, { changedLocation: true }]) {
    const { value, data } = await collectPage(change);
    assert.equal(value.code, null); assert.equal(data.plan, null); assert.equal(parseGemini(data.usage).length, 2);
  }
  const { value, calls } = await collectPage({ quotaStatus: 401 });
  assert.equal(value.status, 401); assert.equal(value.data, null); assert.equal(calls.length, 1);
});

test('Gemini collector returns fresh plans independently from quota and never keeps a previous subscription', async () => {
  const previous = globalThis.chrome;
  let current: TransportResult, injections = 0;
  globalThis.chrome = {
    permissions: { contains: async () => true }, tabs: { query: async () => [{ id: 1, active: true }] },
    scripting: { executeScript: async () => { injections++; return [{ result: current }]; } }
  } as unknown as typeof chrome;
  try {
    for (const [policies, expected] of [
      [[['plus_policy']], 'AI Pro'], [[['neon_policy']], 'AI Ultra'], [[], null]
    ] as Array<[unknown, string | null]>) {
      current = (await collectPage({ policies })).value;
      const result = await collectGemini();
      assert.equal(result.plan, expected); assert.deepEqual(result.limits, parseGemini(observed));
    }
    current = (await collectPage({ policyStatus: 403 })).value;
    const failedPolicy = await collectGemini();
    assert.equal(failedPolicy.plan, null); assert.equal(failedPolicy.limits.length, 2);
    assert.equal(injections, 4, 'one page collection per scheduled provider collection');
  } finally { globalThis.chrome = previous; }
});
