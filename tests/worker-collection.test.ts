import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectFromTab } from '../src/providers/tab-transport';
import { collectChatGPT } from '../src/providers/chatgpt';
import { collectClaude } from '../src/providers/claude';
import { collectGemini } from '../src/providers/gemini';
import { CollectionError } from '../src/shared/errors';
import { ORIGINS, type Provider } from '../src/shared/types';

const chatUsage = { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 15, reset_at: 1792472727, limit_window_seconds: 604800 } } };
const org = { uuid: '00000000-0000-0000-0000-000000000001', capabilities: ['claude_pro'] };
const claudeUsage = { five_hour: { utilization: 35, resets_at: '2026-10-20T05:05:27Z' } };
const geminiUsage = readFileSync(new URL('./fixtures/gemini-batchexecute-observed-redacted.txt', import.meta.url), 'utf8');
const bootstrap = '<!doctype html><script nonce="test">window.WIZ_global_data = {"SNlM0e":"synthetic-secret","unrelated":"do not return"};</script>';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const html = (value = bootstrap) => new Response(value, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const policy = ")]}'\n" + JSON.stringify([['wrb.fr', 'otAQ7b', JSON.stringify([['v3p2_pro_policy']]), null, null, null, 'generic']]);
type Call = { url: string; init: RequestInit };
type Options = { tabs?: chrome.tabs.Tab[]; permission?: boolean; injectionError?: boolean; response?: (url: string, init: RequestInit) => Response | Promise<Response> };
async function worker(provider: Provider, options: Options, run: (calls: Call[], injections: number[]) => Promise<void>) {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location'), previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls: Call[] = [], injections: number[] = [];
  const forbidden = new Proxy({}, { get() { throw new Error('Worker collection must not depend on a page'); } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: forbidden });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: forbidden });
  globalThis.chrome = {
    permissions: { contains: async ({ origins }: { origins: string[] }) => { assert.deepEqual(origins, [ORIGINS[provider]]); return options.permission ?? true; } },
    tabs: { query: async () => options.tabs ?? [] },
    scripting: { executeScript: async ({ target }: { target: { tabId: number } }) => { injections.push(target.tabId); if (options.injectionError) throw new Error('private detail'); return [{ result: { status: 401, code: null, retryAfter: null, data: null } }]; } }
  } as unknown as typeof chrome;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(new URL(String(url)).origin, new URL(ORIGINS[provider]).origin);
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    for (const name of ['Cookie', 'Origin', 'Referer']) assert.equal(headers.has(name), false);
    if (options.response) return options.response(String(url), init);
    if (provider === 'chatgpt') return json(String(url).endsWith('/session') ? { accessToken: 'synthetic-bearer' } : chatUsage);
    if (provider === 'claude') return json(String(url).endsWith('/organizations') ? [org] : claudeUsage);
    if (String(url).endsWith('/app')) return html();
    return new Response(String(url).includes('rpcids=otAQ7b') ? policy : geminiUsage, { headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(calls, injections); }
  finally {
    globalThis.chrome = previousChrome; globalThis.fetch = previousFetch;
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation); else Reflect.deleteProperty(globalThis, 'location');
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('ChatGPT worker fetch uses the existing session and normalized quota without a page or stored credentials', async () => worker('chatgpt', {}, async (calls, injections) => {
  const result = await collectChatGPT();
  assert.equal(result.limits[0]?.percent, 15); assert.equal(result.plan, 'Plus');
  assert.deepEqual(calls.map(call => call.url), ['https://chatgpt.com/api/auth/session', 'https://chatgpt.com/backend-api/wham/usage']);
  assert.equal(new Headers(calls[1]!.init.headers).get('Authorization'), 'Bearer synthetic-bearer');
  assert(calls.every(call => call.init.method === 'GET')); assert.deepEqual(injections, []);
  assert.doesNotMatch(JSON.stringify(result), /synthetic|bearer|accessToken/);
}));

test('Claude worker fetch keeps the existing organization and cedar usage contracts', async () => worker('claude', {}, async (calls, injections) => {
  const result = await collectClaude();
  assert.equal(result.limits[0]?.percent, 35); assert.equal(result.plan, 'Pro');
  assert.deepEqual(calls.map(call => call.url), ['https://claude.ai/api/organizations', `https://claude.ai/api/organizations/${org.uuid}/usage?cedar_ember=1`]);
  assert.deepEqual(injections, []); assert.doesNotMatch(JSON.stringify(result), /00000000|capabilities/);
}));

test('Gemini worker reads only the bootstrap contract and reuses usage/policy RPC parsing', async () => worker('gemini', {}, async (calls, injections) => {
  const result = await collectGemini();
  assert.equal(result.limits.length, 2); assert.equal(result.plan, 'AI Pro');
  assert.equal(calls[0]?.url, 'https://gemini.google.com/app'); assert.equal(calls.length, 4);
  assert.equal(calls[3]?.url, 'https://gemini.google.com/app');
  for (const call of calls.filter(call => call.url.includes('/batchexecute?'))) {
    assert.equal(call.init.method, 'POST'); assert.equal(new URL(call.url).searchParams.get('source-path'), '/usage');
    assert.equal(new URLSearchParams(String(call.init.body)).get('at'), 'synthetic-secret');
  }
  assert.deepEqual(injections, []); assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|SNlM0e|unrelated|do not return/);
}));

test('Gemini optional policy failure does not discard worker usage and bootstrap tokens are never reused across collections', async () => worker('gemini', {
  response: url => url.endsWith('/app') ? html() : url.includes('rpcids=otAQ7b') ? json({}, 403) : new Response(geminiUsage, { headers: { 'Content-Type': 'application/json' } })
}, async calls => {
  for (let i = 0; i < 2; i++) { const result = await collectGemini(); assert.equal(result.limits.length, 2); assert.equal(result.plan, null); }
  assert.equal(calls.length, 6); assert.equal(calls.filter(call => call.url.endsWith('/app')).length, 2);
}));

for (const provider of ['chatgpt', 'claude', 'gemini'] as const) {
  test(`${provider}: permission denial stops worker requests and tab access`, async () => worker(provider, { permission: false }, async (calls, injections) => {
    await assert.rejects(() => collectFromTab(provider), (error: unknown) => error instanceof CollectionError && error.code === 'permission_required');
    assert.equal(calls.length, 0); assert.deepEqual(injections, []);
  }));
  test(`${provider}: an existing frozen/discarded tab never falls through to a different default session`, async () => {
    for (const tab of [{ id: 1, frozen: true }, { id: 2, discarded: true }]) await worker(provider, { tabs: [tab as unknown as chrome.tabs.Tab] }, async (calls, injections) => {
      await assert.rejects(() => collectFromTab(provider), (error: unknown) => error instanceof CollectionError && error.code === 'open_tab');
      assert.equal(calls.length, 0); assert.deepEqual(injections, []);
    });
  });
  test(`${provider}: chosen tab errors never cause a second worker or account request`, async () => {
    for (const injectionError of [false, true]) await worker(provider, { tabs: [{ id: 7 } as chrome.tabs.Tab], injectionError }, async (calls, injections) => {
      await assert.rejects(() => collectFromTab(provider), (error: unknown) => error instanceof CollectionError && error.code === (injectionError ? 'tab_access_failed' : 'signed_out'));
      assert.equal(calls.length, 0); assert.deepEqual(injections, [7]);
    });
  });
  test(`${provider}: worker HTTP/authentication and network failures preserve fixed error codes`, async () => {
    for (const [status, code] of [[401, 'signed_out'], [403, 'access_denied'], [429, 'rate_limited'], [503, 'server']] as const) await worker(provider, { response: () => json({}, status) }, async calls => {
      await assert.rejects(() => collectFromTab(provider), (error: unknown) => error instanceof CollectionError && error.code === code);
      assert.equal(calls.length, 1);
    });
    await worker(provider, { response: () => { throw new Error('private error body'); } }, async () => {
      await assert.rejects(() => collectFromTab(provider), (error: unknown) => error instanceof CollectionError && error.code === 'network' && !error.message.includes('private'));
    });
  });
}

test('Claude worker never picks one of multiple organizations', async () => worker('claude', { response: () => json([org, { ...org, uuid: '00000000-0000-0000-0000-000000000002' }]) }, async calls => {
  await assert.rejects(collectClaude, (error: unknown) => error instanceof CollectionError && error.code === 'ambiguous_account');
  assert.equal(calls.length, 1);
}));

test('Gemini bootstrap rejects keys outside the actual script object, executable expressions and unknown shapes', async () => {
  for (const value of [
    '<div>"SNlM0e":"synthetic-secret"</div>', '<script>const text = \'"SNlM0e":"synthetic-secret"\';</script>',
    '<!--' + bootstrap + '-->', '<script>window.WIZ_global_data = {"other":{"SNlM0e":"wrong"}};</script>',
    '<script>window.WIZ_global_data = {SNlM0e:"not JSON"};</script>',
    '<script>window.WIZ_global_data = {"SNlM0e": (() => "do not execute")()};</script>',
    '<script>window.WIZ_global_data = {"SNlM0e":null};</script>',
    '<script>window.WIZ_global_data = {"SNlM0e":""};</script>',
    '<script>window.WIZ_global_data = {"SNlM0e":"bad\\nvalue"};</script>',
    '<script>window.WIZ_global_data = {"SNlM0e":' + JSON.stringify('a'.repeat(16_385)) + '};</script>',
    '<script>window.WIZ_global_data = {"SNlM0e":"truncated"'
  ]) await worker('gemini', { response: () => html(value) }, async calls => {
    await assert.rejects(collectGemini, (error: unknown) => error instanceof CollectionError && error.code === 'open_tab');
    assert.equal(calls.length, 1);
  });
});

test('Gemini bootstrap handles split chunks and JSON escapes, and cancels the stream immediately after the object', async () => {
  let cancelled = false, index = 0, bootstrapCalls = 0;
  const pieces = ['<html><scr', 'ipt nonce="quoted > marker">window.WIZ_', 'global_data = {"SNlM0e":"synthetic-\\u0073ecret"}'];
  await worker('gemini', { response: url => {
    if (!url.endsWith('/app')) return new Response(url.includes('rpcids=otAQ7b') ? policy : geminiUsage, { headers: { 'Content-Type': 'application/json' } });
    if (bootstrapCalls++ > 0) return html();
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) { if (index < pieces.length) controller.enqueue(new TextEncoder().encode(pieces[index++])); },
      cancel() { cancelled = true; }
    }), { headers: { 'Content-Type': 'text/html' } });
  } }, async calls => {
    assert.equal((await collectGemini()).limits.length, 2); assert.equal(cancelled, true);
    assert.equal(new URLSearchParams(String(calls[1]?.init.body)).get('at'), 'synthetic-secret');
  });
});

test('Gemini bootstrap is bounded and rejects foreign/redirected responses or wrong MIME before any RPC', async () => {
  const responses = [
    () => html('x'.repeat(4 * 1024 * 1024 + 1)),
    () => html('<script>window.WIZ_global_data = ' + ' '.repeat(256 * 1024) + '{"SNlM0e":"late"};</script>'),
    () => json({ SNlM0e: 'wrong mime' }),
    () => { const r = html(); Object.defineProperty(r, 'url', { value: 'https://accounts.google.com/login' }); return r; },
    () => { const r = html(); Object.defineProperty(r, 'redirected', { value: true }); return r; }
  ];
  for (const response of responses) await worker('gemini', { response }, async calls => {
    await assert.rejects(collectGemini, (error: unknown) => error instanceof CollectionError && error.code === 'open_tab');
    assert.equal(calls.length, 1);
  });
});

test('Gemini bootstrap timeout aborts its fetch without querying an RPC or exposing the failure body', async () => {
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void) => originalTimeout(callback, 0)) as typeof setTimeout;
  try {
    await worker('gemini', { response: (_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('private timeout detail')), { once: true });
    }) }, async calls => {
      await assert.rejects(collectGemini, (error: unknown) => error instanceof CollectionError && error.code === 'network' && !error.message.includes('private'));
      assert.equal(calls.length, 1);
    });
  } finally { globalThis.setTimeout = originalTimeout; }
});

test('ChatGPT worker does not send a usage request if the cookie session has expired', async () => worker('chatgpt', { response: () => json({}) }, async calls => {
  await assert.rejects(collectChatGPT, (error: unknown) => error instanceof CollectionError && error.code === 'signed_out');
  assert.equal(calls.length, 1);
}));

const tokenScript = '<script>window.WIZ_global_data={"SNlM0e":"inert-token"};</script>';
const inertBootstrap = [
  `<div data-content='${tokenScript}'></div>`,
  ...['textarea', 'title', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template', 'svg', 'math', 'plaintext']
    .map(name => `<${name}>${tokenScript}</${name}>`),
  '<script type="application/json">window.WIZ_global_data={"SNlM0e":"inert-token"};</script>',
  '<script src="/external.js">window.WIZ_global_data={"SNlM0e":"inert-token"};</script>',
  '<script nomodule>window.WIZ_global_data={"SNlM0e":"inert-token"};</script>',
  '<script language="vbscript">window.WIZ_global_data={"SNlM0e":"inert-token"};</script>',
  '<script>window.WIZ_global_data={"SNlM0e":"inert-token"}+"not an object";</script>'
];
test('Gemini bootstrap ignores quoted attributes, raw text, templates, and non-executing script elements', async () => {
  for (const value of inertBootstrap) await worker('gemini', { response: () => html(value) }, async calls => {
    await assert.rejects(collectGemini, (error: unknown) => error instanceof CollectionError && error.code === 'open_tab');
    assert.equal(calls.length, 1, 'inert contents must never authorize a quota RPC');
  });
});

test('Gemini bootstrap can find a real script after inert contexts and split tag attributes', async () => {
  const prefix = inertBootstrap.filter(value => !value.startsWith('<plaintext>') && !value.includes('+"not an object"')).join('');
  await worker('gemini', { response: url => {
    if (!url.endsWith('/app')) return new Response(url.includes('rpcids=otAQ7b') ? policy : geminiUsage, { headers: { 'Content-Type': 'application/json' } });
    const bytes = new TextEncoder().encode(prefix + bootstrap);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    } }), { headers: { 'Content-Type': 'text/html' } });
  } }, async calls => {
    assert.equal((await collectGemini()).plan, 'AI Pro');
    for (const call of calls.filter(call => call.url.includes('/batchexecute?')))
      assert.equal(new URLSearchParams(String(call.init.body)).get('at'), 'synthetic-secret');
  });
});

test('Gemini worker policy context failures hide only the plan and preserve successful usage', async () => {
  for (const mode of ['changed', 'signed_out', 'missing', 'network'] as const) {
    let bootstrapCalls = 0;
    await worker('gemini', { response: url => {
      if (url.endsWith('/app')) {
        if (bootstrapCalls++ === 0) return html();
        if (mode === 'changed') return html(bootstrap.replace('synthetic-secret', 'new-account-token'));
        if (mode === 'signed_out') return json({}, 401);
        if (mode === 'missing') return html('<html>Sign in</html>');
        throw new Error('private verification failure');
      }
      return new Response(url.includes('rpcids=otAQ7b') ? policy : geminiUsage, { headers: { 'Content-Type': 'application/json' } });
    } }, async calls => {
      const result = await collectGemini();
      assert.equal(result.limits.length, 2); assert.equal(result.plan, null); assert.equal(calls.length, 4);
      assert.doesNotMatch(JSON.stringify(result), /new-account|synthetic-secret|private verification/);
    });
  }
});

test('Gemini total deadline cancels the active RPC after bootstrap, instead of starting a new full budget', async () => {
  const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers: Array<{ callback: () => void; milliseconds: number }> = [];
  globalThis.setTimeout = ((callback: () => void, milliseconds: number) => {
    const item = { callback, milliseconds }; timers.push(item); return item;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  try {
    await worker('gemini', { response: (url, init) => {
      if (url.endsWith('/app')) return html();
      return new Promise<Response>((_resolve, reject) => {
        assert.equal(timers[0]?.milliseconds, 15_000);
        init.signal?.addEventListener('abort', () => reject(new Error('synthetic deadline')), { once: true });
        timers[0]!.callback();
        assert.equal(init.signal?.aborted, true, 'the original bootstrap deadline must abort the active quota RPC');
      });
    } }, async calls => {
      await assert.rejects(collectGemini, (error: unknown) => error instanceof CollectionError && error.code === 'network');
      assert.equal(calls.length, 2);
    });
  } finally { globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
});

test('Gemini total deadline also cancels optional policy verification while preserving collected usage', async () => {
  const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  for (const blocked of ['policy', 'verification'] as const) {
    const timers: Array<() => void> = [];
    globalThis.setTimeout = ((callback: () => void) => { timers.push(callback); return callback; }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
    let bootstraps = 0;
    try {
      await worker('gemini', { response: (url, init) => {
        const isBootstrap = url.endsWith('/app');
        if (isBootstrap && bootstraps++ === 0) return html();
        if ((blocked === 'policy' && url.includes('rpcids=otAQ7b')) || (blocked === 'verification' && isBootstrap)) {
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('synthetic optional deadline')), { once: true });
            timers[0]!();
            assert.equal(init.signal?.aborted, true, 'optional fetches share the original collection deadline');
          });
        }
        return new Response(url.includes('rpcids=otAQ7b') ? policy : geminiUsage, { headers: { 'Content-Type': 'application/json' } });
      } }, async () => {
        const result = await collectGemini(); assert.equal(result.limits.length, 2); assert.equal(result.plan, null);
      });
    } finally { globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
  }
});
