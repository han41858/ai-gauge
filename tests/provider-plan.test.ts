import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGPTPlan, parseClaudePlan } from '../src/providers/openai-claude-plan';
import { collectInPage } from '../src/providers/tab-transport';
import { collectChatGPT } from '../src/providers/chatgpt';
import { collectClaude } from '../src/providers/claude';
import { parseChatGPT, parseClaude } from '../src/providers/parsers';

const chatUsage = { rate_limit: { primary_window: { used_percent: 22, reset_at: 1792472727, limit_window_seconds: 604800 } } };
const claudeUsage = { five_hour: { utilization: 38, resets_at: '2026-10-15T12:00:00Z' } };
const claudePlan = (metadata: unknown) => parseClaudePlan({ plan_metadata: metadata });

test('OpenAI plan_type distinguishes documented plan identifiers without changing usage windows', () => {
  for (const [plan_type, expected] of [
    ['free', 'Free'], ['go', 'Go'], ['plus', 'Plus'], ['prolite', 'Pro 100'], ['pro', 'Pro 200'], ['promax', 'Pro 500'],
    ['team', 'Team'], ['business', 'Business'], ['enterprise', 'Enterprise'], ['education', 'Education'], ['k12', 'Education (K-12)']
  ]) {
    const response = { ...chatUsage, plan_type };
    assert.equal(parseChatGPTPlan(response), expected);
    assert.deepEqual(parseChatGPT(response), parseChatGPT(chatUsage));
  }
});

test('missing, unknown and unsafe OpenAI plan identifiers never imply Free or another paid plan', () => {
  for (const plan_type of [undefined, null, false, 200, {}, [], '', 'pro_100', 'pro_200', 'pro_500', 'new_enterprise',
    'constructor', '__proto__', 'PRIVATE@EXAMPLE.INVALID', '<img src=x onerror=alert(1)>', 'pro\u202e', 'x'.repeat(65)]) {
    assert.equal(parseChatGPTPlan({ ...chatUsage, plan_type }), null);
  }
  for (const input of [undefined, null, false, [], 'plus']) assert.equal(parseChatGPTPlan(input), null);
  assert.equal(parseChatGPTPlan({ plan_type: 'PLUS' }), 'Plus');
});

test('Claude exact organization evidence identifies personal and commercial plans', () => {
  const cases: Array<[unknown, string]> = [
    [{ capabilities: ['free'] }, 'Free'],
    [{ capabilities: ['chat', 'claude_pro'] }, 'Pro'],
    [{ capabilities: ['pro'] }, 'Pro'],
    [{ capabilities: ['chat', 'claude_max'] }, 'Max'],
    [{ capabilities: ['claude_max'], rate_limit_tier: 'default_claude_max_5x' }, 'Max 5x'],
    [{ capabilities: ['claude_max'], rate_limit_tier: 'default_claude_max_20x' }, 'Max 20x'],
    [{ rate_limit_tier: 'default_claude_max_20x' }, 'Max 20x'],
    [{ rate_limit_tier: 'claude_max' }, 'Max'],
    [{ rate_limit_tier: 'claude_pro' }, 'Pro'],
    [{ rate_limit_tier: 'claude_team' }, 'Team'],
    [{ rate_limit_tier: 'claude_enterprise' }, 'Enterprise'],
    [{ capabilities: ['raven', 'claude_max'], rate_limit_tier: 'default_claude_max_5x' }, 'Team'],
    [{ capabilities: ['raven_enterprise', 'claude_pro'] }, 'Enterprise'],
    [{ raven_type: 'team', capabilities: ['claude_pro'] }, 'Team'],
    [{ raven_type: 'enterprise', capabilities: ['claude_max'] }, 'Enterprise']
  ];
  for (const [metadata, expected] of cases) assert.equal(claudePlan(metadata), expected);
});

test('Claude unknown tiers, capability substrings and missing metadata do not create plan claims', () => {
  for (const metadata of [undefined, null, [], 'claude_pro', {}, { capabilities: ['chat'] },
    { rate_limit_tier: 'default_claude_ai' }, { rate_limit_tier: 'stripe_subscription' },
    { rate_limit_tier: 'unknown_default_claude_max_20x' }, { rate_limit_tier: 'claude_max_5x_extra' },
    { capabilities: ['projects', 'nonprofit_approved', 'labs_approved', 'not_claude_pro'] },
    { capabilities: 'claude_pro' }, { capabilities: [false, 5, {}] },
    { subscription: { plan_type: 'pro_monthly' }, billing_type: 'stripe_subscription' }]) {
    assert.equal(claudePlan(metadata), null);
  }
  for (const rate_limit_tier of [null, 20, {}, 'default_claude_max_50x', 'unexpected_max_20x']) {
    assert.equal(claudePlan({ capabilities: ['claude_max'], rate_limit_tier }), 'Max');
  }
  for (const input of [undefined, null, [], false]) assert.equal(parseClaudePlan(input), null);
});

async function inPage(provider: 'chatgpt' | 'claude', response: (url: string) => unknown, run: (calls: string[]) => Promise<void>) {
  const previousFetch = globalThis.fetch, previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const calls: string[] = [];
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: provider === 'chatgpt' ? 'https://chatgpt.com' : 'https://claude.ai' } });
  globalThis.fetch = async (url, init) => {
    const path = String(url); calls.push(path);
    assert.equal(init?.method, 'GET'); assert.equal(init?.credentials, 'include'); assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify(response(path)), { headers: { 'content-type': 'application/json' } });
  };
  try { await run(calls); }
  finally {
    globalThis.fetch = previousFetch;
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation); else Reflect.deleteProperty(globalThis, 'location');
  }
}

test('OpenAI transport returns only bounded plan metadata with existing two same-origin reads', async () => {
  for (const plan_type of ['prolite', null, { email: 'private@example.invalid' }, 'pro<script>', 'x'.repeat(65)]) {
    await inPage('chatgpt', url => url.endsWith('/session') ? { accessToken: 'private-token', user: { email: 'private@example.invalid' } } : { ...chatUsage, plan_type, account_id: 'private-account' }, async calls => {
      const result = await collectInPage('chatgpt');
      assert.equal(result.status, 200); assert.equal(result.code, null);
      assert.deepEqual(parseChatGPT(result.data), parseChatGPT(chatUsage));
      assert.equal(parseChatGPTPlan(result.data), plan_type === 'prolite' ? 'Pro 100' : null);
      assert.deepEqual(calls, ['https://chatgpt.com/api/auth/session', 'https://chatgpt.com/backend-api/wham/usage']);
      assert(!JSON.stringify(result).includes('private')); assert(!JSON.stringify(result).includes('<script>'));
    });
  }
});

test('Claude uses current organization metadata without a new subscription or billing request', async () => {
  let organization = { uuid: '00000000-0000-0000-0000-000000000001', capabilities: ['claude_max'], rate_limit_tier: 'default_claude_max_20x', name: 'private-org', owner: { email: 'private@example.invalid' } };
  await inPage('claude', url => url.endsWith('/organizations') ? [organization] : claudeUsage, async calls => {
    const initial = await collectInPage('claude');
    assert.equal(parseClaudePlan(initial.data), 'Max 20x'); assert.deepEqual(parseClaude(initial.data), parseClaude(claudeUsage));
    organization = { ...organization, uuid: '00000000-0000-0000-0000-000000000002', capabilities: ['claude_pro'], rate_limit_tier: 'default_claude_ai' };
    const switched = await collectInPage('claude');
    assert.equal(parseClaudePlan(switched.data), 'Pro');
    organization = { ...organization, capabilities: [], rate_limit_tier: 'unknown_new_tier' };
    const missing = await collectInPage('claude');
    assert.equal(parseClaudePlan(missing.data), null); assert.deepEqual(parseClaude(missing.data), parseClaude(claudeUsage));
    assert.deepEqual(calls, [
      'https://claude.ai/api/organizations', 'https://claude.ai/api/organizations/00000000-0000-0000-0000-000000000001/usage?cedar_ember=1',
      'https://claude.ai/api/organizations', 'https://claude.ai/api/organizations/00000000-0000-0000-0000-000000000002/usage?cedar_ember=1',
      'https://claude.ai/api/organizations', 'https://claude.ai/api/organizations/00000000-0000-0000-0000-000000000002/usage?cedar_ember=1'
    ]);
    for (const result of [initial, switched, missing]) {
      assert(!JSON.stringify(result).includes('private')); assert(!JSON.stringify(result).includes('00000000'));
    }
  });
});

test('malformed optional Claude metadata is isolated from successfully parsed usage', async () => {
  await inPage('claude', url => url.endsWith('/organizations') ? [{
    uuid: '00000000-0000-0000-0000-000000000001', capabilities: { name: 'private-capability' },
    rate_limit_tier: ['private-tier'], raven_type: { name: 'private-raven' }
  }] : claudeUsage, async calls => {
    const result = await collectInPage('claude');
    assert.equal(result.code, null); assert.equal(parseClaudePlan(result.data), null);
    assert.deepEqual(parseClaude(result.data), parseClaude(claudeUsage));
    assert.equal(calls.length, 2); assert(!JSON.stringify(result).includes('private'));
  });
});

test('collectors replace optional plan results on each collection without retaining a previous account label', async () => {
  const previous = globalThis.chrome;
  let payload: unknown;
  globalThis.chrome = {
    permissions: { contains: async () => true },
    tabs: { query: async () => [{ id: 1 }] },
    scripting: { executeScript: async () => [{ result: { status: 200, code: null, retryAfter: null, data: payload } }] }
  } as unknown as typeof chrome;
  try {
    for (const [plan_type, expected] of [['prolite', 'Pro 100'], ['promax', 'Pro 500'], ['future_plan', null], [undefined, null]]) {
      payload = { ...chatUsage, plan_type };
      assert.deepEqual(await collectChatGPT(), { limits: parseChatGPT(chatUsage), plan: expected });
    }
    for (const [metadata, expected] of [[{ capabilities: ['claude_max'] }, 'Max'], [{ capabilities: ['claude_pro'] }, 'Pro'], [null, null]] as const) {
      payload = { ...claudeUsage, plan_metadata: metadata };
      assert.deepEqual(await collectClaude(), { limits: parseClaude(claudeUsage), plan: expected });
    }
  } finally { globalThis.chrome = previous; }
});
