import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGPTTicketSummary, parseChatGPTTicketDetail, parseClaudeTickets, parseCollectedTickets } from '../src/providers/reset-tickets';
import { collectFromTab } from '../src/providers/tab-transport';
import { collectInPage } from '../src/providers/openai-claude-transport';
import { parseChatGPT, parseClaude } from '../src/providers/parsers';
import { parseTicketInventory } from '../src/shared/tickets';

// Synthetic public-contract examples, not captured authenticated API responses.
const now = Date.parse('2030-01-01T00:00:00Z');
const expires = '2030-01-10T15:00:00Z';
const salt = 'a'.repeat(64);
const chatUsage = { account_id: 'private-account-a', user_id: 'private-user-a', plan_type: 'pro', rate_limit: { primary_window: { used_percent: 22, reset_at: 1905000000, limit_window_seconds: 604800 } }, rate_limit_reset_credits: { available_count: 2, applicable_available_count: 1 } };
const credit = (reset_type = 'codex_weekly', extra = {}) => ({ id: 'private-credit-id', reset_type, status: 'available', is_supported_by_plan: true, granted_at: '2029-12-01T00:00:00Z', expires_at: expires, ...extra });
const grant = (extra = {}) => ({ id: 'private-grant', resets_left: 2, starts_at: '2029-12-01T00:00:00Z', ends_at: expires, clears: ['five_hour', 'seven_day'], usable_now: true, use_requires_limit: true, blocking: [], ...extra });
const org = { uuid: '00000000-0000-0000-0000-000000000001', name: 'private-org', capabilities: ['claude_max'] };
const claudeUsage = { five_hour: { utilization: 38, resets_at: expires }, cedar_ember: { eligible: true, grants: [grant()], next_grant_id: 'private-grant' } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('ChatGPT summary distinguishes absent, zero and known count-only holdings', () => {
  for (const input of [null, {}, [], { available_count: -1 }, { available_count: 1.2 }, { available_count: '2' }, { available_count: Number.MAX_SAFE_INTEGER + 1 }]) assert.equal(parseChatGPTTicketSummary(input), null);
  assert.deepEqual(parseChatGPTTicketSummary({ available_count: 0, applicable_available_count: 0 })?.grants, []);
  const parsed = parseChatGPTTicketSummary({ available_count: 2, applicable_available_count: 1 })!;
  assert.equal(parsed.mode, 'summary'); assert.equal(parsed.grants[0]?.count, 2); assert.equal(parsed.grants[0]?.expiresAt, null); assert.equal(parsed.usableCount, 1);
  assert.equal(parseChatGPTTicketSummary({ available_count: 2, applicable_available_count: 3 })?.usableCount, null);
  assert.deepEqual(parseTicketInventory(parsed), parsed);
});

test('ChatGPT details retain supported kinds and distinct expiry/start times', () => {
  const summary = parseChatGPTTicketSummary({ available_count: 3, applicable_available_count: 2 })!;
  const detail = parseChatGPTTicketDetail({ available_count: 3, credits: [credit('codex_rate_limits'), credit('codex_five_hour', { expires_at: '2030-01-05T00:00:00+09:00' }), credit('codex_weekly', { granted_at: '2030-01-03T00:00:00Z' })] }, summary, now)!;
  assert.deepEqual(detail.grants.map(g => g.kind), ['full', 'five_hour', 'weekly']);
  assert.deepEqual(detail.grants[0]?.clears, ['five_hour', 'seven_day']);
  assert.equal(detail.grants[1]?.expiresAt, '2030-01-04T15:00:00.000Z'); assert.equal(detail.grants[2]?.startsAt, '2030-01-03T00:00:00.000Z');
  assert.equal(detail.usableCount, 2); assert.deepEqual(parseTicketInventory(detail), detail);
  assert(!JSON.stringify(detail).includes('private'));
});

test('ChatGPT removes expired, spent, unsupported, shadow and unknown credit kinds', () => {
  const credits = [credit(), credit('codex_weekly', { expires_at: '2029-01-01T00:00:00Z' }), credit('codex_weekly', { status: 'used' }), credit('codex_weekly', { is_supported_by_plan: false }), credit('codex_weekly_shadow'), credit('new_kind')];
  const parsed = parseChatGPTTicketDetail({ available_count: credits.length, credits }, parseChatGPTTicketSummary({ available_count: credits.length, applicable_available_count: 2 })!, now)!;
  assert.equal(parsed.grants.length, 1); assert.equal(parsed.usableCount, null);
});

test('ChatGPT rejects partial or contradictory detail without converting failure to zero', () => {
  const summary = parseChatGPTTicketSummary({ available_count: 2 })!;
  for (const detail of [null, {}, { available_count: 1, credits: [credit()] }, { available_count: 2, credits: [credit()] }, { available_count: 2, credits: [credit(), null] }, { available_count: 2, credits: [credit(), credit('codex_weekly', { expires_at: null })] }]) assert.equal(parseChatGPTTicketDetail(detail, summary, now), null);
  const output = parseCollectedTickets('chatgpt', { reset_tickets: { state: 'ok', scope: salt, summary: { available_count: 2 }, detail: { available_count: 1, credits: [credit()] } } }, now)!;
  assert.equal(output.state, 'error'); assert.equal(output.fallback?.grants[0]?.count, 2);
});

test('ticket timestamps reject missing timezone, invalid calendar dates and malformed provided start', () => {
  for (const value of ['2030-01-03T00:00:00', '2030-02-30T00:00:00Z', '2030-01-03T24:00:00Z', 'tomorrow', 1900000000]) {
    const summary = parseChatGPTTicketSummary({ available_count: 1 })!;
    assert.equal(parseChatGPTTicketDetail({ available_count: 1, credits: [credit('codex_weekly', { expires_at: value })] }, summary, now), null);
    assert.equal(parseClaudeTickets({ eligible: true, grants: [grant({ starts_at: value })] }, now), null);
  }
});

test('Claude aggregates count-preserving grant types and current eligibility conditions', () => {
  const result = parseClaudeTickets({ eligible: true, cooldown_until: '2030-01-01T03:00:00Z', grants: [
    grant({ selected: true }), grant({ resets_left: 1, clears: ['five_hour'], selected: false, blocking: ['another_limit'] }),
    grant({ resets_left: 3, clears: ['seven_day'], starts_at: '2030-01-03T00:00:00Z', usable_now: false })
  ] }, now)!;
  assert.deepEqual(result.grants.map(g => [g.kind, g.count]), [['full', 2], ['five_hour', 1], ['weekly', 3]]);
  assert.equal(result.grants[0]?.requiresLimit, true); assert.equal(result.grants[1]?.blocked, true); assert.equal(result.grants[1]?.selected, false);
  assert.equal(result.cooldownUntil, '2030-01-01T03:00:00.000Z'); assert.deepEqual(parseTicketInventory(result), result);
});

test('Claude excludes null-expiry, spent, expired and unclassified grants without inventing scopes', () => {
  const result = parseClaudeTickets({ eligible: true, grants: [grant({ ends_at: null }), grant({ resets_left: 0 }), grant({ ends_at: '2029-01-01T00:00:00Z' }), grant({ clears: ['five_hour', 'seven_day_special'] }), grant({ clears: ['unknown'] })] }, now)!;
  assert.deepEqual(result.grants, []);
  assert.deepEqual(parseClaudeTickets({ eligible: true, grants: [] }, now)?.grants, []);
});

test('Claude missing and malformed grants remain unknown rather than known zero', () => {
  for (const value of [null, {}, { eligible: false, grants: [] }, { eligible: true }, { eligible: true, grants: [null] }, { eligible: true, grants: [grant({ resets_left: '2' })] }, { eligible: true, grants: [grant({ ends_at: undefined })] }, { eligible: true, grants: [grant({ clears: null })] }, { eligible: true, grants: [grant()], cooldown_until: 'tomorrow' }]) assert.equal(parseClaudeTickets(value, now), null);
});

async function inPage(provider: 'chatgpt' | 'claude', responder: (url: string, index: number, init: RequestInit | undefined) => Response | Promise<Response>, run: (calls: string[]) => Promise<void>) {
  const oldFetch = globalThis.fetch, oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const calls: string[] = [];
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: provider === 'chatgpt' ? 'https://chatgpt.com' : 'https://claude.ai' } });
  globalThis.fetch = async (url, init) => {
    calls.push(String(url)); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    assert.equal(init?.credentials, 'include'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    return responder(String(url), calls.length, init);
  };
  try { await run(calls); }
  finally { globalThis.fetch = oldFetch; if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation); else Reflect.deleteProperty(globalThis, 'location'); }
}
const chatResponder = (url: string) => url.endsWith('/session') ? json({ accessToken: 'private-token' }) : url.endsWith('/rate-limit-reset-credits') ? json({ available_count: 2, credits: [credit(), credit('codex_five_hour')] }) : json(chatUsage);

test('ChatGPT MAIN detail is read-only, same-account guarded and excludes private data', async () => {
  await inPage('chatgpt', chatResponder, async calls => {
    const response = await collectInPage('chatgpt', salt), result = parseCollectedTickets('chatgpt', response.data, now)!;
    assert.equal(response.status, 200); assert.deepEqual(parseChatGPT(response.data), parseChatGPT(chatUsage));
    assert.equal(result.state, 'ok'); assert.equal(result.inventory?.mode, 'detail'); assert.equal(result.inventory?.grants.length, 2);
    assert.match(result.scope!, /^[a-f0-9]{64}$/); assert(!JSON.stringify(response).includes('private'));
    assert.deepEqual(calls.map(url => new URL(url).pathname), ['/api/auth/session', '/backend-api/wham/usage', '/backend-api/wham/rate-limit-reset-credits', '/backend-api/wham/usage']);
  });
});

test('ChatGPT skips detail for zero/missing summary or missing account proof', async () => {
  for (const usage of [{ ...chatUsage, rate_limit_reset_credits: { available_count: 0 } }, { ...chatUsage, rate_limit_reset_credits: undefined }, { ...chatUsage, account_id: undefined, user_id: undefined }]) {
    await inPage('chatgpt', url => url.endsWith('/session') ? json({ accessToken: 'private-token' }) : json(usage), async calls => {
      const response = await collectInPage('chatgpt', salt); assert.equal(response.status, 200); assert.equal(calls.length, 2);
      assert.deepEqual(parseChatGPT(response.data), parseChatGPT(chatUsage));
      if (usage.account_id === undefined) { const parsed = parseCollectedTickets('chatgpt', response.data, now)!; assert.equal(parsed.scope, null); assert.equal(parsed.inventory?.mode, 'summary'); }
    });
  }
});

test('ChatGPT optional status and network failures retain successful quota and fresh count fallback', async () => {
  for (const status of [401, 403, 429, 500, 503, 0]) {
    await inPage('chatgpt', url => { if (!url.endsWith('/rate-limit-reset-credits')) return chatResponder(url); if (!status) throw new Error('private-error'); return json({}, status); }, async () => {
      const response = await collectInPage('chatgpt', salt), parsed = parseCollectedTickets('chatgpt', response.data, now)!;
      assert.equal(response.status, 200); assert.deepEqual(parseChatGPT(response.data), parseChatGPT(chatUsage));
      assert.equal(parsed.state, status === 401 || status === 403 ? 'auth' : 'error');
      if (parsed.state === 'error') assert.equal(parsed.fallback?.grants[0]?.count, 2);
      assert(!JSON.stringify(response).includes('private'));
    });
  }
});

test('ChatGPT rejects same-count account switches between usage and detail', async () => {
  await inPage('chatgpt', (url, index) => index === 4 ? json({ ...chatUsage, account_id: 'private-account-b' }) : chatResponder(url), async () => {
    const response = await collectInPage('chatgpt', salt), parsed = parseCollectedTickets('chatgpt', response.data, now)!;
    assert.deepEqual(parseChatGPT(response.data), parseChatGPT(chatUsage)); assert.equal(parsed.state, 'context_changed'); assert.equal(parsed.scope, null); assert.equal(parsed.fallback, undefined);
  });
});

test('ChatGPT rejects another user inside the same workspace and never proves user identity from workspace alone', async () => {
  await inPage('chatgpt', (url, index) => index === 4 ? json({ ...chatUsage, user_id: 'private-user-b' }) : chatResponder(url), async () => {
    assert.equal(parseCollectedTickets('chatgpt', (await collectInPage('chatgpt', salt)).data, now)?.state, 'context_changed');
  });
  await inPage('chatgpt', url => url.endsWith('/session') ? json({ accessToken: 'private-token' }) : url.endsWith('/rate-limit-reset-credits') ? chatResponder(url) : json({ ...chatUsage, user_id: undefined }), async () => {
    const parsed = parseCollectedTickets('chatgpt', (await collectInPage('chatgpt', salt)).data, now)!;
    assert.equal(parsed.state, 'ok'); assert.equal(parsed.scope, null); assert.equal(parsed.inventory?.mode, 'detail');
  });
});

test('ChatGPT changed summary invalidates detail and exposes only the fresh summary fallback', async () => {
  await inPage('chatgpt', (url, index) => index === 4 ? json({ ...chatUsage, rate_limit_reset_credits: { available_count: 0, applicable_available_count: 0 } }) : chatResponder(url), async () => {
    const parsed = parseCollectedTickets('chatgpt', (await collectInPage('chatgpt', salt)).data, now)!;
    assert.equal(parsed.state, 'error'); assert.deepEqual(parsed.fallback?.grants, []);
  });
});

test('ephemeral ticket scopes change for changed identities or worker salts', async () => {
  const scopes: Array<string | null | undefined> = [];
  for (const [account_id, workerSalt] of [['private-a', salt], ['private-b', salt], ['private-a', 'b'.repeat(64)]]) {
    await inPage('chatgpt', url => url.endsWith('/session') ? json({ accessToken: 'private-token' }) : json({ ...chatUsage, account_id, rate_limit_reset_credits: { available_count: 0 } }), async () => { scopes.push(parseCollectedTickets('chatgpt', (await collectInPage('chatgpt', workerSalt)).data, now)?.scope); });
  }
  assert.equal(new Set(scopes).size, 3); assert(scopes.every(value => /^[a-f0-9]{64}$/.test(value!)));
});

test('Claude cedar query and organization recheck retain conditions without IDs or labels', async () => {
  await inPage('claude', url => url.endsWith('/organizations') ? json([org]) : json(claudeUsage), async calls => {
    const response = await collectInPage('claude', salt), parsed = parseCollectedTickets('claude', response.data, now)!;
    assert.deepEqual(parseClaude(response.data), parseClaude(claudeUsage)); assert.equal(parsed.state, 'ok'); assert.equal(parsed.inventory?.grants[0]?.selected, true);
    assert.equal(parsed.inventory?.grants[0]?.blocked, false); assert.equal(calls.length, 3); assert.match(calls[1]!, /usage\?cedar_ember=1$/);
    assert.equal(parsed.scope, null, 'an org shared by several members is not a current-user proof');
    assert(!JSON.stringify(response).includes('private')); assert(!JSON.stringify(response).includes(org.uuid));
  });
});

test('optional detail timeout returns current ChatGPT quota and summary within its independent budget', async () => {
  await inPage('chatgpt', url => url.endsWith('/rate-limit-reset-credits') ? new Promise<Response>(() => {}) : chatResponder(url), async () => {
    const started = Date.now(), response = await collectInPage('chatgpt');
    assert(Date.now() - started < 5000); assert.equal(response.status, 200);
    assert.deepEqual(parseChatGPT(response.data), parseChatGPT(chatUsage));
    const parsed = parseCollectedTickets('chatgpt', response.data, now)!; assert.equal(parsed.state, 'error'); assert.equal(parsed.fallback?.grants[0]?.count, 2);
  });
});

test('optional Claude feature timeout leaves time to fetch ordinary usage', async () => {
  await inPage('claude', url => url.endsWith('/organizations') ? json([org]) : url.endsWith('?cedar_ember=1') ? new Promise<Response>(() => {}) : json({ five_hour: claudeUsage.five_hour }), async calls => {
    const started = Date.now(), response = await collectInPage('claude');
    assert(Date.now() - started < 5000); assert.equal(response.status, 200); assert.equal(calls.length, 3);
    assert.deepEqual(parseClaude(response.data), parseClaude(claudeUsage)); assert.equal(parseCollectedTickets('claude', response.data, now)?.state, 'error');
  });
});

test('malformed optional JSON and provided dates never erase valid usage or enter ticket display', async () => {
  for (const reply of [new Response('not-json', { headers: { 'content-type': 'application/json' } }), json({ available_count: 2, credits: [credit('codex_weekly', { expires_at: '2030-02-30T00:00:00Z' }), credit()] })]) {
    await inPage('chatgpt', url => url.endsWith('/rate-limit-reset-credits') ? reply : chatResponder(url), async () => {
      const response = await collectInPage('chatgpt', salt); assert.deepEqual(parseChatGPT(response.data), parseChatGPT(chatUsage)); assert.equal(parseCollectedTickets('chatgpt', response.data, now)?.state, 'error');
    });
  }
});

test('Claude optional feature failures fall back to ordinary usage without failing quota', async () => {
  for (const status of [400, 403, 404, 422, 500, 503, 0]) {
    await inPage('claude', url => {
      if (url.endsWith('/organizations')) return json([org]);
      if (url.endsWith('?cedar_ember=1')) { if (!status) throw new Error('private-error'); return json({}, status); }
      return json({ five_hour: claudeUsage.five_hour });
    }, async calls => {
      const response = await collectInPage('claude', salt); assert.equal(response.status, 200); assert.deepEqual(parseClaude(response.data), parseClaude(claudeUsage));
      assert.equal(parseCollectedTickets('claude', response.data, now)?.state, 'error'); assert.equal(calls.length, 3); assert(calls[2]?.endsWith('/usage'));
    });
  }
});

test('Claude does not retry authentication or 429 failures through another path', async () => {
  for (const status of [401, 429]) await inPage('claude', url => url.endsWith('/organizations') ? json([org]) : json({}, status), async calls => { assert.equal((await collectInPage('claude', salt)).status, status); assert.equal(calls.length, 2); });
});

test('Claude organization switches invalidate tickets while optional verification failures preserve quota', async () => {
  for (const result of [json([{ ...org, uuid: '00000000-0000-0000-0000-000000000002' }]), json({}, 401), json({}, 429)]) {
    await inPage('claude', (url, index) => index === 3 ? result : url.endsWith('/organizations') ? json([org]) : json(claudeUsage), async () => {
      const response = await collectInPage('claude', salt), parsed = parseCollectedTickets('claude', response.data, now)!;
      assert.equal(response.status, 200); assert.deepEqual(parseClaude(response.data), parseClaude(claudeUsage)); assert(['context_changed', 'auth', 'error'].includes(parsed.state));
    });
  }
});

test('unavailable crypto cannot turn an optional scope proof into a quota failure', async () => {
  const oldChrome = globalThis.chrome, oldCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  globalThis.chrome = { permissions: { contains: async () => true }, tabs: { query: async () => [{ id: 1 }] }, scripting: { executeScript: async (input: { args: [string, string] }) => { assert.equal(input.args[1], ''); return [{ result: { status: 200, code: null, retryAfter: null, data: chatUsage } }]; } } } as unknown as typeof chrome;
  try { assert.deepEqual(parseChatGPT(await collectFromTab('chatgpt')), parseChatGPT(chatUsage)); }
  finally { globalThis.chrome = oldChrome; if (oldCrypto) Object.defineProperty(globalThis, 'crypto', oldCrypto); }
});
