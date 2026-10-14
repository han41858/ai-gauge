import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failure, success } from '../src/background/scheduler';
import { CollectionError, ERROR_TEXT } from '../src/shared/errors';
import { resetLabel, statusText } from '../src/shared/format';
import { GEMINI_RESPONSE_ERRORS, type ErrorCode, type Snapshot, type UsageLimit } from '../src/shared/types';
import { defaults } from '../src/storage/settings';
import { effectiveSnapshot, emptySnapshot, FRESH_MS, hasElapsedReset, parseSnapshot, readSnapshot, readView, writeSnapshot } from '../src/storage/snapshots';

const NOW = Date.parse('2026-10-14T14:00:00Z');
const limit = (overrides: Partial<UsageLimit> = {}): UsageLimit => ({ id: 'five_hour', label: '5시간', category: 'window',
  percent: 0, resetsAt: null, windowSeconds: 18000, remaining: null, unit: null, source: 'api', ...overrides });
const collected = (limits = [limit()]) => success(emptySnapshot('claude'), limits, NOW - 15 * 60_000);

test('cache age alone keeps actual zero and unknown usage distinct without adding a warning', () => {
  const snapshot = collected([limit(), limit({ id: 'weekly', percent: null })]);
  for (const now of [NOW, NOW + FRESH_MS, NOW + 7 * 86400_000]) {
    const visible = effectiveSnapshot(snapshot, now);
    assert.equal(visible.state, 'ok');
    assert.equal(visible.limits[0]!.percent, 0);
    assert.equal(visible.limits[1]!.percent, null);
    assert.equal(visible.collectedAt, snapshot.collectedAt);
    assert.doesNotMatch(statusText(visible), /오래된|갱신 필요/);
  }
});

test('legacy age-only stale markers recover, while explicit stale failures remain unreliable', () => {
  const old = { ...collected(), state: 'stale' as const };
  assert.equal(effectiveSnapshot(old, NOW).state, 'ok');
  assert.equal(old.state, 'stale');
  for (const explicit of [{ ...old, errorCode: 'network' as const }, { ...old, failures: 1 }]) {
    assert.equal(effectiveSnapshot(explicit, NOW), explicit);
  }
});

test('one transient failure preserves valid cached usage and retries, a second failure becomes visible, and success clears both', () => {
  for (const code of ['network', 'server'] as const) {
    const before = collected([limit({ percent: 43.7, resetsAt: new Date(NOW + 3600_000).toISOString() })]);
    const once = failure(before, new CollectionError(code), NOW);
    const preserved = structuredClone(once);
    const visible = effectiveSnapshot(once, NOW + 1);
    assert.equal(visible.state, 'ok');
    assert.equal(visible.limits[0]!.percent, 43.7);
    assert.equal(visible.errorCode, code);
    assert.equal(visible.failures, 1);
    assert.equal(visible.nextAttemptAt, once.nextAttemptAt);
    assert.equal(visible.checkedAt, NOW);
    assert.deepEqual(once, preserved, 'presentation must not write success back into retry state');
    assert.deepEqual(effectiveSnapshot(visible, NOW + 1), visible, 'shared views may be normalized again');
    const twice = failure(once, new CollectionError(code), once.nextAttemptAt);
    assert.equal(effectiveSnapshot(twice, twice.checkedAt!).state, 'error');
    assert.equal(statusText(twice), code === 'network' ? '연결 확인 중' : '서비스 응답 대기');
    const recovered = success(twice, [limit({ percent: 44 })], twice.nextAttemptAt);
    assert.equal(effectiveSnapshot(recovered, recovered.checkedAt!).state, 'ok');
    assert.equal(recovered.errorCode, null);
    assert.equal(recovered.failures, 0);
    assert.equal(recovered.limits[0]!.percent, 44);
  }
});

test('first transient failure without usable cache remains a failure without invented usage', () => {
  for (const code of ['network', 'server'] as const) {
    const first = failure(emptySnapshot('claude'), new CollectionError(code), NOW);
    assert.equal(effectiveSnapshot(first, NOW), first);
    assert.equal(first.limits.length, 0);
    assert.equal(first.collectedAt, null);
    const impossible = failure({ ...collected(), collectedAt: NOW + 60_001 }, new CollectionError(code), NOW);
    assert.equal(effectiveSnapshot(impossible, NOW), impossible);
  }
});

test('future or invalid collection timestamps and invalid quota data never become current', () => {
  const malformed: Snapshot[] = [
    ...[null, 0, -1, NaN, Infinity, NOW + 60_001].map(collectedAt => ({ ...collected(), collectedAt })),
    collected([]), collected([limit({ percent: 101 })])
  ];
  for (const snapshot of malformed) {
    const visible = effectiveSnapshot(snapshot, NOW);
    assert.equal(visible.state, 'error');
    assert.equal(visible.errorCode, 'invalid_response');
    assert.deepEqual(effectiveSnapshot(visible, NOW), visible);
  }
  assert.equal(effectiveSnapshot({ ...collected(), collectedAt: NOW + 60_000 }, NOW).state, 'ok');
});

test('any reported reset invalidates cached usage at its boundary without inventing a new value or reset', () => {
  const snapshot = collected([
    limit({ percent: 89, resetsAt: new Date(NOW + 86400_000).toISOString() }),
    limit({ id: 'other', percent: 13, resetsAt: new Date(NOW).toISOString() })
  ]);
  assert.equal(hasElapsedReset(snapshot, NOW - 1), false);
  assert.equal(effectiveSnapshot(snapshot, NOW - 1).state, 'ok');
  assert.equal(hasElapsedReset(snapshot, NOW), true);
  const visible = effectiveSnapshot(snapshot, NOW);
  assert.equal(visible.state, 'error');
  assert.equal(visible.errorCode, 'reset_pending');
  assert.equal(statusText(visible), '초기화 후 확인 중');
  assert.deepEqual(visible.limits, snapshot.limits);
  assert.equal(visible.collectedAt, snapshot.collectedAt);
  assert.deepEqual(effectiveSnapshot(visible, NOW), visible);
  assert.deepEqual(parseSnapshot(visible, 'claude'), visible, 'the derived state crosses existing view contracts');
  const transient = failure(snapshot, new CollectionError('network'), NOW);
  assert.equal(effectiveSnapshot(transient, NOW).errorCode, 'reset_pending');
  assert.equal(transient.errorCode, 'network');
  assert.match(resetLabel(snapshot.limits[1]!.resetsAt, NOW), /초기화 후 확인 중$/);
  assert.doesNotMatch(resetLabel(snapshot.limits[1]!.resetsAt, NOW), /갱신 필요/);
});

test('missing and malformed reset times are not guessed from window duration or display labels', () => {
  for (const resetsAt of [null, '', 'not-a-date', '2026-10-14T00:00:00', '2026-02-30T00:00:00Z']) {
    assert.equal(hasElapsedReset(collected([limit({ resetsAt })]), NOW), false);
  }
  assert.equal(hasElapsedReset(collected([limit({ resetsAt: '2026-10-14T23:00:00+09:00' })]), NOW), true);
});

test('authentication, access, rate and response failures remain explicit even on the first failure with cached usage', () => {
  const codes: ErrorCode[] = ['signed_out', 'access_denied', 'permission_required', 'rate_limited', 'unsupported', 'invalid_response',
    'open_tab', 'tab_access_failed', 'ambiguous_account', ...GEMINI_RESPONSE_ERRORS];
  const snapshot = collected([limit({ percent: 77, resetsAt: new Date(NOW - 1).toISOString() })]);
  for (const code of codes) {
    const failed = failure(snapshot, new CollectionError(code), NOW);
    assert.equal(effectiveSnapshot(failed, NOW), failed, 'an elapsed reset must not replace the actionable failure');
    assert.equal(failed.state, 'error');
    assert.equal(failed.errorCode, code);
    assert.doesNotMatch(statusText(failed), /오래된|갱신 필요|gemini_/);
  }
  for (const code of GEMINI_RESPONSE_ERRORS) {
    assert.equal(ERROR_TEXT[code], ERROR_TEXT.invalid_response);
    assert.equal(statusText(failure(snapshot, new CollectionError(code), NOW)), statusText(failure(snapshot, new CollectionError('invalid_response'), NOW)));
  }
});

test('shared view grace survives storage reads without clearing the raw failure counter or persisted retry cooldown', async () => {
  const previous = globalThis.chrome;
  const settings = defaults(); settings.enabled.claude = true;
  const stored: Record<string, unknown> = { 'migration:shared-chatgpt:v2': true, 'settings:v2': settings };
  globalThis.chrome = { permissions: { contains: async () => true }, storage: { local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(stored, key)).map(key => [key, structuredClone(stored[key])])),
    set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }
  } } } as unknown as typeof chrome;
  try {
    const failed = failure(success(emptySnapshot('claude'), [limit({ percent: 17 })], Date.now() - FRESH_MS), new CollectionError('network'), Date.now());
    await writeSnapshot(failed);
    const first = await readView(), next = await readView();
    assert.equal(first.snapshots.claude.state, 'ok');
    assert.deepEqual(next.snapshots.claude, first.snapshots.claude);
    assert.equal(first.snapshots.claude.errorCode, 'network');
    assert.equal(first.snapshots.claude.failures, 1);
    assert.deepEqual(await readSnapshot('claude'), failed);
    assert.deepEqual(stored['snapshot:v2:claude'], failed);
  } finally { globalThis.chrome = previous; }
});
