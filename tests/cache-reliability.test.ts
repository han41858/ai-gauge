import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failure, success } from '../src/background/scheduler';
import { CollectionError, ERROR_TEXT } from '../src/shared/errors';
import { resetLabel, statusText } from '../src/shared/format';
import { GEMINI_RESPONSE_ERRORS, PROVIDERS, type ErrorCode, type Snapshot, type UsageLimit } from '../src/shared/types';
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
  for (const code of ['network', 'server', 'tab_access_failed'] as const) {
    const first = failure(emptySnapshot('claude'), new CollectionError(code), NOW);
    assert.equal(effectiveSnapshot(first, NOW), first);
    assert.equal(first.limits.length, 0);
    assert.equal(first.collectedAt, null);
    const impossible = failure({ ...collected(), collectedAt: NOW + 60_001 }, new CollectionError(code), NOW);
    assert.equal(effectiveSnapshot(impossible, NOW), impossible);
  }
});

test('repeated tab execution failures preserve the last valid shared usage and the original retry state', () => {
  for (const provider of PROVIDERS) {
    const before = success(emptySnapshot(provider), [limit({ percent: 43.7, resetsAt: new Date(NOW + 86400_000).toISOString() })], NOW - FRESH_MS);
    let cached = before;
    for (let attempt = 1; attempt <= 5; attempt++) {
      cached = failure(cached, new CollectionError('tab_access_failed'), NOW + attempt * 60_000);
      const persisted = parseSnapshot(cached, provider), visible = effectiveSnapshot(persisted, cached.checkedAt!);
      assert.equal(visible.state, 'ok');
      assert.deepEqual(visible.limits, before.limits);
      assert.equal(visible.collectedAt, before.collectedAt);
      assert.equal(visible.errorCode, 'tab_access_failed');
      assert.equal(visible.failures, attempt);
      assert.equal(visible.nextAttemptAt, cached.nextAttemptAt);
      assert.deepEqual(persisted, cached);
      assert.equal(cached.state, 'error');
      assert.deepEqual(effectiveSnapshot(visible, cached.checkedAt!), visible);
      assert.doesNotMatch(statusText(visible), /사이트 접근 설정 확인/);
    }
    const expired = effectiveSnapshot(cached, NOW + 86400_000);
    assert.equal(expired.state, 'error');
    assert.equal(expired.errorCode, 'reset_pending');
    const recovered = success(cached, [limit({ percent: 0 })], cached.nextAttemptAt);
    assert.equal(effectiveSnapshot(recovered, recovered.checkedAt!).limits[0]!.percent, 0);
    assert.equal(recovered.failures, 0);
    assert.equal(recovered.errorCode, null);
  }
});

test('tab execution failures do not imply a missing permission or invent unknown percentages', () => {
  const missing = failure(emptySnapshot('chatgpt'), new CollectionError('tab_access_failed'), NOW);
  assert.equal(statusText(effectiveSnapshot(missing, NOW)), '사용량 다시 확인 중');
  const unknown = failure(collected([limit({ percent: null })]), new CollectionError('tab_access_failed'), NOW);
  assert.equal(effectiveSnapshot(unknown, NOW).limits[0]!.percent, null);
});

test('known account and permission failures cannot be revived by subsequent tab failures or a storage reload', () => {
  for (const code of ['signed_out', 'access_denied', 'permission_required', 'ambiguous_account', 'unsupported'] as const) {
    const before = collected([limit({ percent: 77 })]);
    const denied = failure(before, new CollectionError(code), NOW);
    assert.equal(denied.usageInvalidated, true);
    assert.deepEqual(denied.limits, before.limits, 'the popup can still identify previous values');
    const legacy = { ...denied }; delete legacy.usageInvalidated;
    for (const stored of [denied, legacy]) {
      let retry = failure(parseSnapshot(stored, 'claude'), new CollectionError('open_tab'), NOW + 60_000);
      retry = failure(parseSnapshot(retry, 'claude'), new CollectionError('tab_access_failed'), NOW + 120_000);
      assert.equal(retry.usageInvalidated, true);
      assert.equal(effectiveSnapshot(retry, retry.checkedAt!).state, 'error');
      const network = failure({ ...retry, failures: 0 }, new CollectionError('network'), NOW + 180_000);
      assert.equal(effectiveSnapshot(network, network.checkedAt!).state, 'error');
      const inconsistent = effectiveSnapshot({ ...retry, state: 'ok' }, retry.checkedAt!);
      assert.equal(inconsistent.state, 'error');
      assert.deepEqual(effectiveSnapshot(inconsistent, retry.checkedAt!), inconsistent);
      const restored = success(retry, [limit({ percent: 12 })], NOW + 240_000);
      assert.equal(restored.usageInvalidated, undefined);
      assert.equal(effectiveSnapshot(restored, restored.checkedAt!).state, 'ok');
      assert.deepEqual(parseSnapshot(restored, 'claude'), restored);
    }
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
    'open_tab', 'ambiguous_account', ...GEMINI_RESPONSE_ERRORS];
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
  let granted = true;
  globalThis.chrome = { permissions: { contains: async () => granted }, storage: { local: {
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
    const tabFailed = failure(failed, new CollectionError('tab_access_failed'), Date.now());
    await writeSnapshot(tabFailed);
    assert.equal((await readView()).snapshots.claude.state, 'ok');
    assert.deepEqual(await readSnapshot('claude'), tabFailed);
    granted = false;
    assert.equal((await readView()).snapshots.claude.state, 'permission_required');
    assert.deepEqual(await readSnapshot('claude'), tabFailed);
  } finally { globalThis.chrome = previous; }
});
