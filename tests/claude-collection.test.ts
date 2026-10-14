import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectClaude } from '../src/providers/claude';
import { collectFromTab } from '../src/providers/tab-transport';
import { Scheduler } from '../src/background/scheduler';
import { emptySnapshot } from '../src/storage/snapshots';
import { CollectionError } from '../src/shared/errors';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import type { TransportResult } from '../src/providers/tab-transport';

test('Claude tab arrival triggers the real collector path after a no-tab attempt, with usage and reset normalized', async () => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch, previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  let open = false, now = 100_000, snapshot = emptySnapshot('claude');
  const urls: string[] = [], tabIds: number[] = [];
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://claude.ai' }, configurable: true });
  globalThis.fetch = async (url, init) => {
    urls.push(String(url)); assert.equal(init?.method, 'GET'); assert.equal(init?.credentials, 'include');
    const payload = urls.length === 1 ? [{ uuid: '00000000-0000-0000-0000-000000000001', name: 'private-org' }] : { five_hour: { utilization: 35, resets_at: '2026-10-14T12:00:00+09:00' }, email: 'private@example.invalid' };
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  };
  globalThis.chrome = {
    permissions: { contains: async () => true },
    tabs: { query: async () => open ? [{ id: 0, active: true, url: 'https://claude.ai/' }] : [] },
    scripting: { executeScript: async (details: { target: { tabId: number }; func: (provider: 'claude') => Promise<unknown> }) => { tabIds.push(details.target.tabId); return [{ result: await details.func('claude') }]; } }
  } as unknown as typeof chrome;
  const scheduler = new Scheduler({ read: async () => snapshot, write: async next => { snapshot = next; }, enabled: async () => true, collect: collectClaude, now: () => now });
  try {
    await scheduler.refresh('claude', 'event');
    assert.equal(snapshot.errorCode, 'open_tab'); assert.equal(urls.length, 0); assert.equal(snapshot.collectedAt, null);
    open = true; now++;
    await scheduler.refresh('claude', 'tab');
    assert.equal(snapshot.state, 'ok'); assert.equal(snapshot.collectedAt, now); assert.equal(snapshot.limits[0]?.percent, 35);
    assert.equal(snapshot.limits[0]?.resetsAt, '2026-10-14T03:00:00.000Z');
    assert.deepEqual(urls, ['https://claude.ai/api/organizations', 'https://claude.ai/api/organizations/00000000-0000-0000-0000-000000000001/usage']);
    assert.deepEqual(tabIds, [0]); assert(!JSON.stringify(snapshot).includes('private')); assert(!JSON.stringify(snapshot).includes('00000000'));
    await scheduler.refresh('claude', 'tab'); assert.equal(urls.length, 2);
  } finally {
    globalThis.chrome = previousChrome; globalThis.fetch = previousFetch;
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation); else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('an injection failure does not try another account tab or claim no HTTP request was attempted', async () => {
  const previous = globalThis.chrome; let attempts = 0;
  globalThis.chrome = {
    permissions: { contains: async () => true },
    tabs: { query: async () => [{ id: 3, active: true }, { id: 4, active: false }] },
    scripting: { executeScript: async () => { attempts++; throw new Error('private browser detail'); } }
  } as unknown as typeof chrome;
  try {
    await assert.rejects(() => collectFromTab('claude'), (error: unknown) => error instanceof CollectionError && error.code === 'tab_access_failed' && !error.message.includes('private'));
    assert.equal(attempts, 1);
  } finally { globalThis.chrome = previous; }
});

test('multiple active Claude tabs prefer the last focused window without trying another tab after HTTP failure', async () => {
  const previous = globalThis.chrome, ids: number[] = [];
  const tabs = [{ id: 30, active: true, windowId: 1 }, { id: 31, active: true, windowId: 2 }, { id: 32, active: false, windowId: 2 }];
  globalThis.chrome = {
    permissions: { contains: async () => true },
    tabs: { query: async (query: { lastFocusedWindow?: boolean; url?: string }) => { assert.equal(query.url, 'https://claude.ai/*'); return query.lastFocusedWindow ? [tabs[1]] : tabs; } },
    scripting: { executeScript: async (details: { target: { tabId: number } }) => { ids.push(details.target.tabId); return [{ result: { status: 401, code: null, retryAfter: null, data: null } }]; } }
  } as unknown as typeof chrome;
  try {
    await assert.rejects(() => collectFromTab('claude'), (error: unknown) => error instanceof CollectionError && error.state === 'signed_out');
    assert.deepEqual(ids, [31]);
  } finally { globalThis.chrome = previous; }
});

test('serialized MAIN collectors keep requests on their fixed origin despite a foreign document base URI', async () => {
  const compiled = await build({ entryPoints: ['src/providers/tab-transport.ts'], bundle: true, write: false, format: 'cjs', target: 'chrome120', legalComments: 'none' });
  const module = { exports: {} as { collectInPage: (provider: 'claude' | 'chatgpt') => Promise<TransportResult> } };
  runInNewContext(compiled.outputFiles[0]!.text, { module });
  for (const provider of ['claude', 'chatgpt'] as const) {
    let calls = 0;
    const origin = provider === 'claude' ? 'https://claude.ai' : 'https://chatgpt.com';
    const document = { baseURI: 'https://untrusted.invalid/changed-base/' };
    const usage = JSON.parse(readFileSync(new URL(`./fixtures/${provider === 'claude' ? 'claude' : 'chatgpt'}.json`, import.meta.url), 'utf8'));
    const isolatedPage = {
      location: { origin }, document,
      AbortController, setTimeout, clearTimeout,
      fetch: async (url: string, init: RequestInit) => {
        // Browser fetch resolves relative strings against document.baseURI.
        assert.equal(new URL(url, document.baseURI).origin, origin);
        assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'include');
        calls++; return new Response(JSON.stringify(calls === 1 ? provider === 'claude' ? [{ uuid: '00000000-0000-0000-0000-000000000001' }] : { accessToken: 'synthetic-private-token' } : usage), { headers: { 'content-type': 'application/json' } });
      }
    };
    // No module helpers/imports are available in this new page context.
    const result = await runInNewContext(`(${module.exports.collectInPage.toString()})('${provider}')`, isolatedPage) as TransportResult;
    assert.equal(result.status, 200); assert.equal(result.code, null); assert.equal(calls, 2);
    assert(!JSON.stringify(result).includes('synthetic-private-token'));
    assert(!JSON.stringify(result).includes('00000000'));
  }
});
