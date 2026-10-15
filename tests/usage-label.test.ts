import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageLabel, usageParts } from '../src/content/usage-label';
import { relativeTime, resetLabel } from '../src/shared/format';
import { emptySnapshot } from '../src/storage/snapshots';
import type { Snapshot, UsageLimit } from '../src/shared/types';

const snapshot = (): Snapshot => ({ ...emptySnapshot('chatgpt'), state: 'ok', errorCode: null });
const limit = (overrides: Partial<UsageLimit> = {}): UsageLimit => ({
  id: 'weekly', label: '7일', category: 'window', percent: 15,
  resetsAt: new Date(2026, 9, 16, 9, 5).toISOString(), windowSeconds: 604800,
  remaining: null, unit: null, source: 'api', ...overrides
});

test('input usage label keeps the largest countdown unit while popup keeps date and detailed duration', () => {
  const reset = new Date(2026, 9, 16, 9, 5).getTime();
  const now = reset - 119 * 3_600_000;
  assert.equal(usageLabel(snapshot(), limit(), now), '사용량: 15%  🕒 초기화: 4일 후');
  assert.equal(resetLabel(limit().resetsAt, now), '🕒 사용량 초기화: 10/16(금) 09:05, 4d 23h 남음');
});

test('a real zero usage remains zero while a sub-hour countdown uses minutes', () => {
  const item = limit({ percent: 0 }), reset = Date.parse(item.resetsAt!);
  assert.equal(usageLabel(snapshot(), item, reset - 59 * 60_000),
    '사용량: 0%  🕒 초기화: 59분 후');
});

test('countdown changes units at the day, hour and minute boundaries without rounding up', () => {
  const item = limit(), reset = Date.parse(item.resetsAt!);
  for (const [remaining, expected] of [
    [86_400_001, '1일 후'], [86_400_000, '1일 후'], [86_399_999, '23시간 후'],
    [3_600_001, '1시간 후'], [3_600_000, '1시간 후'], [3_599_999, '59분 후'],
    [60_001, '1분 후'], [60_000, '1분 후'], [59_999, '1분 미만'], [1, '1분 미만']
  ] as const) {
    assert.equal(usageLabel(snapshot(), item, reset - remaining),
      `사용량: 15%  🕒 초기화: ${expected}`, `${remaining}ms remaining`);
  }
});

test('input countdown uses one Korean unit for the requested day, hour and minute examples', () => {
  const item = limit(), reset = Date.parse(item.resetsAt!);
  for (const [remaining, expected] of [
    [5 * 86_400_000, '5일 후'],
    [86_400_000 + 60_000, '1일 후'],
    [23 * 3_600_000 + 59 * 60_000, '23시간 후'],
    [3_600_000, '1시간 후'],
    [59 * 60_000 + 59_000, '59분 후'],
    [60_000, '1분 후'],
    [59_000, '1분 미만']
  ] as const) {
    assert.equal(usageParts(snapshot(), item, reset - remaining).reset,
      `🕒 초기화: ${expected}`, `${remaining}ms remaining`);
  }
});

test('shared relative time formatter rejects invalid and nonfuture durations', () => {
  for (const remaining of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, -86_400_000]) {
    assert.equal(relativeTime(remaining), null, `${remaining}ms remaining`);
  }
});

test('unknown or invalid percentages never convert remaining counts into percentage usage', () => {
  for (const percent of [null, Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
    const item = limit({ percent, remaining: 73 }), reset = Date.parse(item.resetsAt!);
    assert.equal(usageLabel(snapshot(), item, reset - 3_600_000),
      '사용량: 확인 불가  🕒 초기화: 1시간 후');
  }
  assert.equal(usageLabel(snapshot(), undefined), '사용량: 확인 불가  🕒 초기화: 확인 불가');
});

test('missing, malformed, impossible and timezone-free reset dates do not invent countdowns', () => {
  for (const resetsAt of [null, '', 'invalid', '2026-02-30T00:00:00Z', '2026-10-16T09:05:00']) {
    assert.equal(usageLabel(snapshot(), limit({ resetsAt })), '사용량: 15%  🕒 초기화: 확인 불가');
  }
});

test('an elapsed reset keeps the pending status without a date in the input strip', () => {
  const item = limit(), reset = Date.parse(item.resetsAt!);
  for (const now of [reset, reset + 1, reset + 86_400_000]) {
    assert.equal(usageLabel(snapshot(), item, now),
      '사용량: 15%  🕒 초기화: 초기화 후 확인 중');
    assert.equal(resetLabel(item.resetsAt, now), '🕒 사용량 초기화: 10/16(금) 09:05, 초기화 후 확인 중');
  }
});

test('month and year boundaries preserve popup date details and the input countdown', () => {
  const reset = new Date(2027, 0, 1, 0, 0).getTime();
  const item = limit({ resetsAt: new Date(reset).toISOString() }), now = reset - 25 * 3_600_000;
  assert.equal(usageLabel(snapshot(), item, now), '사용량: 15%  🕒 초기화: 1일 후');
  assert.equal(resetLabel(item.resetsAt, now), '🕒 사용량 초기화: 1/1(금) 00:00, 1d 1h 남음');
});

test('popup reset date follows the browser timezone while input countdown is timezone-independent', () => {
  const original = process.env.TZ;
  const item = limit({ resetsAt: '2026-10-14T23:05:00Z' });
  const now = Date.parse(item.resetsAt!) - 26 * 3_600_000;
  try {
    for (const [timezone, stamp] of [
      ['UTC', '10/14(수) 23:05'], ['Asia/Seoul', '10/15(목) 08:05'], ['America/Los_Angeles', '10/14(수) 16:05']
    ]) {
      process.env.TZ = timezone;
      assert.equal(usageLabel(snapshot(), item, now), '사용량: 15%  🕒 초기화: 1일 후');
      assert.equal(resetLabel(item.resetsAt, now), `🕒 사용량 초기화: ${stamp}, 1d 2h 남음`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('failed and stale snapshots do not present cached values as current usage', () => {
  const item = limit();
  assert.equal(usageLabel({ ...snapshot(), state: 'stale' }, item),
    '사용량: 확인 불가  🕒 초기화: 확인 불가  사용량 확인 중');
  assert.equal(usageLabel({ ...snapshot(), state: 'error', errorCode: 'network' }, item),
    '사용량: 확인 불가  🕒 초기화: 확인 불가  연결 확인 중');
  assert.equal(usageLabel({ ...snapshot(), state: 'permission_required', errorCode: 'permission_required' }, item),
    '사용량: 확인 불가  🕒 초기화: 확인 불가  사이트 권한 필요');
});

test('usage parts share one validated percentage and accessibility label with the visible text', () => {
  const item = limit({ percent: 17.25 }), reset = Date.parse(item.resetsAt!);
  const parts = usageParts(snapshot(), item, reset - 3_600_000);
  assert.equal(parts.percent, 17.25);
  assert.equal(parts.current, '사용량: 17%');
  assert.match(parts.reset, /^🕒 초기화:/);
  assert.equal(parts.status, null);
  assert.equal(parts.label, `${parts.current}  ${parts.reset}`);
  assert.equal(usageLabel(snapshot(), item, reset - 3_600_000), parts.label);
  assert.equal(usageParts({ ...snapshot(), state: 'stale' }, item).percent, null);
});
