import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageLabel, usageParts } from '../src/content/usage-label';
import { emptySnapshot } from '../src/storage/snapshots';
import type { Snapshot, UsageLimit } from '../src/shared/types';

const snapshot = (): Snapshot => ({ ...emptySnapshot('chatgpt'), state: 'ok', errorCode: null });
const limit = (overrides: Partial<UsageLimit> = {}): UsageLimit => ({
  id: 'weekly', label: '7일', category: 'window', percent: 15,
  resetsAt: new Date(2026, 9, 16, 9, 5).toISOString(), windowSeconds: 604800,
  remaining: null, unit: null, source: 'api', ...overrides
});

test('usage label follows the exact requested current-usage and local-reset format', () => {
  const reset = new Date(2026, 9, 16, 9, 5).getTime();
  assert.equal(usageLabel(snapshot(), limit(), reset - 49 * 3_600_000),
    '사용량: 15%  🕒 사용량 초기화: 10/16(금) 09:05, 2d 1h 남음');
});

test('a real zero usage remains zero while a sub-hour remainder omits zero days', () => {
  const item = limit({ percent: 0 }), reset = Date.parse(item.resetsAt!);
  assert.equal(usageLabel(snapshot(), item, reset - 59 * 60_000),
    '사용량: 0%  🕒 사용량 초기화: 10/16(금) 09:05, 0h 남음');
});

test('zero days are omitted below one day and retained from exactly one day onward', () => {
  const item = limit(), reset = Date.parse(item.resetsAt!);
  assert.match(usageLabel(snapshot(), item, reset - 23.9 * 3_600_000), /, 23h 남음$/);
  assert.doesNotMatch(usageLabel(snapshot(), item, reset - 23.9 * 3_600_000), /0d/);
  assert.match(usageLabel(snapshot(), item, reset - 24 * 3_600_000), /, 1d 0h 남음$/);
});

test('unknown or invalid percentages never convert remaining counts into percentage usage', () => {
  for (const percent of [null, Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
    const item = limit({ percent, remaining: 73 }), reset = Date.parse(item.resetsAt!);
    assert.equal(usageLabel(snapshot(), item, reset - 3_600_000),
      '사용량: 확인 불가  🕒 사용량 초기화: 10/16(금) 09:05, 1h 남음');
  }
  assert.equal(usageLabel(snapshot(), undefined), '사용량: 확인 불가  🕒 사용량 초기화: 확인 불가');
});

test('missing, malformed, impossible and timezone-free reset dates do not invent countdowns', () => {
  for (const resetsAt of [null, '', 'invalid', '2026-02-30T00:00:00Z', '2026-10-16T09:05:00']) {
    assert.equal(usageLabel(snapshot(), limit({ resetsAt })), '사용량: 15%  🕒 사용량 초기화: 확인 불가');
  }
});

test('an elapsed or exactly reached reset keeps its actual timestamp and requests refresh', () => {
  const item = limit(), reset = Date.parse(item.resetsAt!);
  for (const now of [reset, reset + 1, reset + 86_400_000]) {
    assert.equal(usageLabel(snapshot(), item, now),
      '사용량: 15%  🕒 사용량 초기화: 10/16(금) 09:05, 초기화 시각 지남 · 갱신 필요');
  }
});

test('month and year boundaries preserve the local weekday and midnight padding', () => {
  const reset = new Date(2027, 0, 1, 0, 0).getTime();
  assert.equal(usageLabel(snapshot(), limit({ resetsAt: new Date(reset).toISOString() }), reset - 25 * 3_600_000),
    '사용량: 15%  🕒 사용량 초기화: 1/1(금) 00:00, 1d 1h 남음');
});

test('reset date and weekday use the browser timezone while countdown uses elapsed hours', () => {
  const original = process.env.TZ;
  const item = limit({ resetsAt: '2026-10-14T23:05:00Z' });
  const now = Date.parse(item.resetsAt!) - 26 * 3_600_000;
  try {
    process.env.TZ = 'UTC';
    assert.equal(usageLabel(snapshot(), item, now),
      '사용량: 15%  🕒 사용량 초기화: 10/14(수) 23:05, 1d 2h 남음');
    process.env.TZ = 'Asia/Seoul';
    assert.equal(usageLabel(snapshot(), item, now),
      '사용량: 15%  🕒 사용량 초기화: 10/15(목) 08:05, 1d 2h 남음');
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(usageLabel(snapshot(), item, now),
      '사용량: 15%  🕒 사용량 초기화: 10/14(수) 16:05, 1d 2h 남음');
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('failed and stale snapshots do not present cached values as current usage', () => {
  const item = limit();
  assert.equal(usageLabel({ ...snapshot(), state: 'stale' }, item),
    '사용량: 확인 불가  🕒 사용량 초기화: 확인 불가  오래된 정보 · 갱신 필요');
  assert.equal(usageLabel({ ...snapshot(), state: 'error', errorCode: 'network' }, item),
    '사용량: 확인 불가  🕒 사용량 초기화: 확인 불가  연결 또는 요청 시간이 초과되었습니다.');
  assert.equal(usageLabel({ ...snapshot(), state: 'permission_required', errorCode: 'permission_required' }, item),
    '사용량: 확인 불가  🕒 사용량 초기화: 확인 불가  이 서비스의 사이트 접근 권한이 필요합니다.');
});

test('usage parts share one validated percentage and accessibility label with the visible text', () => {
  const item = limit({ percent: 17.25 }), reset = Date.parse(item.resetsAt!);
  const parts = usageParts(snapshot(), item, reset - 3_600_000);
  assert.equal(parts.percent, 17.25);
  assert.equal(parts.current, '사용량: 17%');
  assert.match(parts.reset, /^🕒 사용량 초기화:/);
  assert.equal(parts.status, null);
  assert.equal(parts.label, `${parts.current}  ${parts.reset}`);
  assert.equal(usageLabel(snapshot(), item, reset - 3_600_000), parts.label);
  assert.equal(usageParts({ ...snapshot(), state: 'stale' }, item).percent, null);
});
