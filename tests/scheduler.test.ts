import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, due, backoff, success, failure } from '../src/background/scheduler';
import { emptySnapshot, effectiveSnapshot, parseSnapshot, FRESH_MS } from '../src/storage/snapshots';
import { parseClaude } from '../src/providers/parsers';
import { CollectionError } from '../src/shared/errors';
const limits = parseClaude({ five_hour: { utilization: 0, resets_at: null } });
test('single flight merges three simultaneous tab updates before async prerequisites', async () => {
  let s = emptySnapshot('claude'), calls = 0;
  const io = { read: async () => s, write: async (next: typeof s) => { s = next; }, collect: async () => { calls++; return limits; }, enabled: async () => true, now: () => 100000 };
  const scheduler = new Scheduler(io);
  const results = await Promise.all([scheduler.refresh('claude', 'event'), scheduler.refresh('claude', 'event'), scheduler.refresh('claude', 'event')]);
  assert.equal(calls, 1); assert.equal(results[0], results[1]); assert.equal(s.state, 'ok'); assert.equal(s.limits[0]?.percent, 0);
});
test('persisted cooldown and rate limit survive a new worker/scheduler', async () => {
  let s = failure(emptySnapshot('claude'), new CollectionError('rate_limited', 'rate_limited', 600000), 100000), calls = 0;
  const io = { read: async () => s, write: async (v: typeof s) => { s = v; }, enabled: async () => true, now: () => 200000, collect: async () => { calls++; return limits; } };
  await new Scheduler(io).refresh('claude', 'manual'); assert.equal(calls, 0); assert.equal(s.state, 'rate_limited');
});
test('last success persists after failure; fresh status is not retained', () => {
  const before = success(emptySnapshot('claude'), limits, 1000), next = failure(before, new CollectionError('network'), 2000);
  assert.equal(next.collectedAt, 1000); assert.equal(next.limits, limits); assert.equal(next.state, 'error'); assert.equal(next.checkedAt, 2000);
});
test('auth, permission and unsupported states suspend automatic retries', () => {
  for (const state of ['signed_out', 'permission_required', 'unsupported'] as const) { const s = { ...emptySnapshot('claude'), state }; assert(!due(s, 'periodic', 1e8)); assert(!due(s, 'event', 1e8)); assert(due(s, 'manual', 1e8)); }
});
test('manual requests respect minimum spacing, event refresh uses 60 seconds', () => {
  const s = success(emptySnapshot('claude'), limits, 1000);
  assert(!due(s, 'manual', 60000)); assert(due(s, 'event', 61000)); assert(!due(s, 'periodic', 61000)); assert(due(s, 'periodic', 601000));
});
test('disabled provider never collects', async () => {
  let calls = 0;
  const s = emptySnapshot('claude'); await new Scheduler({ read: async () => s, write: async () => undefined, enabled: async () => false, now: () => 1e8, collect: async () => { calls++; return limits; } }).refresh('claude', 'manual'); assert.equal(calls, 0);
});
test('permission revoked or service disabled in flight cannot publish success', async () => {
  let s = emptySnapshot('claude'), enabled = true;
  await new Scheduler({ read: async () => s, write: async v => { s = v; }, enabled: async () => enabled, now: () => 1000, collect: async () => { enabled = false; return limits; } }).refresh('claude', 'manual');
  assert.notEqual(s.state, 'ok'); assert.equal(s.collectedAt, null);
});
test('lease persists before fetch and prevents immediate retry on worker termination', async () => {
  let s = emptySnapshot('claude');
  await new Scheduler({ read: async () => s, write: async v => { s = v; }, enabled: async () => true, now: () => 1000, collect: async () => { assert.equal(s.checkedAt, 1000); assert.equal(s.nextAttemptAt, 61000); return limits; } }).refresh('claude', 'manual');
});
test('exponential backoff is bounded but Retry-After can be longer', () => { assert.equal(backoff(1), 60000); assert.equal(backoff(2), 120000); assert.equal(backoff(1000), 3600000); assert.equal(failure(emptySnapshot('claude'), new CollectionError('rate_limited', 'rate_limited', 7200000), 1000).nextAttemptAt, 7201000); });
test('restored snapshots validate and expire after ten minutes', () => { const s = success(emptySnapshot('claude'), limits, 1000); assert.deepEqual(parseSnapshot(s, 'claude'), s); assert.equal(effectiveSnapshot(s, 1000 + FRESH_MS).state, 'stale'); assert.equal(parseSnapshot({ ...s, limits: [{ percent: 999 }] }, 'claude').collectedAt, null); assert.equal(parseSnapshot(s, 'chatgpt').collectedAt, null); });
test('missing tabs do not accumulate server-failure backoff, but ordinary popup events remain spaced', () => {
  let s = emptySnapshot('claude');
  for (let i = 1; i <= 8; i++) {
    s = failure(s, new CollectionError('open_tab'), i * 60_000);
    assert.equal(s.failures, 0);
    assert.equal(s.nextAttemptAt, i * 60_000 + 60_000);
    assert(!due(s, 'event', i * 60_000 + 1), 'popup view/storage updates must not create a retry loop');
  }
});
test('opening a site tab recovers from a persisted missing-tab backoff without refreshing successful data early', async () => {
  let s: ReturnType<typeof emptySnapshot> = { ...emptySnapshot('claude'), errorCode: 'open_tab', checkedAt: 100_000, nextAttemptAt: 3_700_000, failures: 8 }, calls = 0;
  const scheduler = new Scheduler({ read: async () => s, write: async next => { s = next; }, collect: async () => { calls++; return limits; }, enabled: async () => true, now: () => 100_001 });
  await scheduler.refresh('claude', 'event'); assert.equal(calls, 0);
  await scheduler.refresh('claude', 'tab'); assert.equal(calls, 1); assert.equal(s.state, 'ok'); assert.equal(s.collectedAt, 100_001);
  await scheduler.refresh('claude', 'tab'); assert.equal(calls, 1, 'a successful API request still has a minimum interval');
});
test('tab activation cannot bypass network, HTTP rate-limit, or authentication suspension', async () => {
  for (const error of [new CollectionError('network'), new CollectionError('tab_access_failed'), new CollectionError('rate_limited', 'rate_limited', 600_000), new CollectionError('signed_out', 'signed_out')]) {
    let s = failure(emptySnapshot('claude'), error, 100_000), calls = 0, now = 100_001;
    const scheduler = new Scheduler({ read: async () => s, write: async next => { s = next; }, collect: async () => { calls++; return limits; }, enabled: async () => true, now: () => now });
    await scheduler.refresh('claude', 'tab'); assert.equal(calls, 0, error.code);
    if (error.code === 'signed_out') { now = 10_000_000; await scheduler.refresh('claude', 'tab'); assert.equal(calls, 0); }
  }
});
test('a missing-tab recovery persists a real attempt lease before collection, including across worker restart', async () => {
  let s = failure(emptySnapshot('claude'), new CollectionError('open_tab'), 100_000);
  await new Scheduler({ read: async () => s, write: async next => { s = next; }, collect: async () => {
    assert.notEqual(s.errorCode, 'open_tab'); assert.equal(s.checkedAt, 100_001);
    assert(!due(s, 'tab', 100_002), 'a restarted worker must respect the in-progress attempt lease');
    return limits;
  }, enabled: async () => true, now: () => 100_001 }).refresh('claude', 'tab');
  assert.equal(s.state, 'ok');
});
