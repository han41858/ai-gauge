import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectChatGPT } from '../src/providers/chatgpt';
import { collectFromTab } from '../src/providers/tab-transport';
import { collectInPage } from '../src/providers/openai-claude-transport';
import { parseChatGPT } from '../src/providers/parsers';
import { Scheduler, success } from '../src/background/scheduler';
import { CollectionError } from '../src/shared/errors';
import { emptySnapshot } from '../src/storage/snapshots';
import { displayProvider } from '../src/shared/display-policy';
import { authorized, parseMessage } from '../src/shared/contracts';
import { ORIGINS, PROVIDERS, providerFromUrl, type CollectionResult } from '../src/shared/types';

const raw = { rate_limit: { primary_window: { used_percent: 15, reset_at: 1792472727, limit_window_seconds: 604800 } } };
const result = { status: 200, code: null, retryAfter: null, data: raw };
type Tab = { id: number; url: string; active?: boolean; discarded?: boolean; frozen?: boolean };
type Injection = { target: { tabId: number }; world: string; func: unknown; args?: string[] };
async function transport(options: { permission?: boolean; tabs?: Tab[]; result?: unknown; reject?: boolean }, run: (calls: { queries: number; injections: Injection[] }) => Promise<void>) {
  const previous = globalThis.chrome, previousFetch = globalThis.fetch, calls = { queries: 0, injections: [] as Injection[] };
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('/session') ? { accessToken: 'synthetic-token' } : raw), { headers: { 'Content-Type': 'application/json' } });
  globalThis.chrome = {
    permissions: { contains: async () => options.permission ?? true },
    tabs: { query: async () => { calls.queries++; return options.tabs ?? [{ id: 1, url: 'https://chatgpt.com/' }]; } },
    scripting: { executeScript: async (injection: Injection) => { calls.injections.push(injection); if (options.reject) throw new Error('private tab details'); return [{ result: options.result ?? result }]; } }
  } as unknown as typeof chrome;
  try { await run(calls); } finally { globalThis.chrome = previous; globalThis.fetch = previousFetch; }
}
for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/codex', 'https://chatgpt.com/codex/tasks/synthetic']) {
  test(`the same shared ChatGPT collection runs from ${new URL(url).pathname}`, async () => transport({ tabs: [{ id: 7, url }] }, async calls => {
    assert.deepEqual(await collectChatGPT(), { limits: parseChatGPT(raw), plan: null });
    assert.equal(calls.injections.length, 1); assert.equal(calls.injections[0]?.target.tabId, 7);
    assert.equal(calls.injections[0]?.world, 'MAIN'); assert.equal(calls.injections[0]?.func, collectInPage);
    assert.equal(calls.injections[0]?.args?.[0], 'chatgpt');
    assert.match(calls.injections[0]?.args?.[1] ?? '', /^[a-f0-9]{64}$/, 'only a random worker salt accompanies the provider, never credentials');
    assert.equal(calls.injections[0]?.args?.length, 2);
  }));
}
test('unavailable tabs are skipped and collection never tries another tab after failure', async () => transport({ tabs: [
  { id: 1, url: 'https://chatgpt.com/', discarded: true, active: true },
  { id: 2, url: 'https://chatgpt.com/codex', frozen: true, active: true },
  { id: 3, url: 'https://chatgpt.com/codex', active: true },
  { id: 4, url: 'https://chatgpt.com/' }
], reject: true }, async calls => {
  await assert.rejects(collectChatGPT, (error: unknown) => error instanceof CollectionError && error.code === 'tab_access_failed' && !error.message.includes('private'));
  assert.deepEqual(calls.injections.map(value => value.target.tabId), [3]);
}));
test('no permission stops before tab access; an absent service tab uses the worker session', async () => {
  await transport({ permission: false }, async calls => {
    await assert.rejects(collectChatGPT, (error: unknown) => error instanceof CollectionError && error.code === 'permission_required');
    assert.equal(calls.queries, 0); assert.equal(calls.injections.length, 0);
  });
  await transport({ tabs: [] }, async calls => {
    assert.deepEqual((await collectChatGPT()).limits, parseChatGPT(raw));
    assert.equal(calls.injections.length, 0);
  });
});
test('retired experimental observations are not accepted as shared usage responses', async () => transport({ result: { version: 1, observedAt: 1_000_000, data: { limits_progress: [] } } }, async () => {
  await assert.rejects(collectChatGPT, (error: unknown) => error instanceof CollectionError && error.code === 'invalid_response');
}));
test('simultaneous ordinary-chat and Codex refreshes merge into a single ChatGPT collection', async () => {
  let snapshot = emptySnapshot('chatgpt'), calls = 0;
  const scheduler = new Scheduler({ read: async () => snapshot, write: async value => { snapshot = value; }, collect: async () => { calls++; return { limits: parseChatGPT(raw), plan: null }; }, enabled: async () => true, now: () => 1_000_000 });
  const pages = ['https://chatgpt.com/', 'https://chatgpt.com/codex', 'https://chatgpt.com/work'];
  await Promise.all(pages.map(url => {
    const source = displayProvider(providerFromUrl(url)!);
    const message = parseMessage({ type: 'refresh', provider: source, trigger: 'event' })!;
    assert(authorized(message, { id: 'ext', url, frameId: 0, tab: { id: 1, url } } as chrome.runtime.MessageSender, 'ext'));
    return scheduler.refresh(source, 'event');
  }));
  assert.equal(calls, 1); assert.equal(snapshot.provider, 'chatgpt'); assert.equal(snapshot.limits[0]?.percent, 15);
  assert.deepEqual(PROVIDERS, ['chatgpt', 'claude', 'gemini']);
});
test('empty or malformed collection results preserve the prior successful snapshot', async () => {
  for (const invalid of [{ limits: [], plan: null }, { limits: [{ percent: 999 }], plan: null }, [], null]) {
    let snapshot = success(emptySnapshot('chatgpt'), parseChatGPT(raw), 1_000_000);
    await new Scheduler({ read: async () => snapshot, write: async value => { snapshot = value; }, collect: async () => invalid as CollectionResult, enabled: async () => true, now: () => 1_100_000 }).refresh('chatgpt', 'manual');
    assert.equal(snapshot.errorCode, 'invalid_response'); assert.equal(snapshot.collectedAt, 1_000_000);
    assert.equal(snapshot.limits[0]?.percent, 15); assert.equal(snapshot.checkedAt, 1_100_000);
  }
});
test('Gemini host access is independent and cannot use a ChatGPT permission', async () => {
  const previous = globalThis.chrome; let queries = 0;
  globalThis.chrome = { permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every(origin => origin === ORIGINS.chatgpt) }, tabs: { query: async () => { queries++; return []; } } } as unknown as typeof chrome;
  try { await assert.rejects(() => collectFromTab('gemini'), (error: unknown) => error instanceof CollectionError && error.state === 'permission_required'); assert.equal(queries, 0); }
  finally { globalThis.chrome = previous; }
});
