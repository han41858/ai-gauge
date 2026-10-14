import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highestUsageLimit } from '../src/shared/usage-selection';
import { badge, selectedLimit } from '../src/background/badge';
import { defaults } from '../src/storage/settings';
import { emptySnapshot, FRESH_MS } from '../src/storage/snapshots';
import type { Provider, Snapshot, UsageLimit, View } from '../src/shared/types';

const NOW = Date.parse('2026-10-14T10:00:00Z');
const limit = (id: string, percent: number | null, category: UsageLimit['category'] = 'window'): UsageLimit => ({
  id, label: id, category, percent, resetsAt: null, windowSeconds: null,
  remaining: null, unit: null, source: 'api'
});
const collected = (provider: Provider, limits: UsageLimit[]): Snapshot => ({
  ...emptySnapshot(provider), state: 'ok', limits, collectedAt: NOW, checkedAt: NOW, errorCode: null
});
const fixture = (): View => {
  const settings = defaults();
  settings.enabled.work_codex = true;
  settings.enabled.claude = true;
  return {
    settings, permissions: { chatgpt: true, work_codex: true, claude: true },
    snapshots: {
      chatgpt: emptySnapshot('chatgpt'),
      work_codex: collected('work_codex', [limit('플랜 기간', 15)]),
      claude: collected('claude', [limit('Claude 기간', 63)])
    }
  };
};

test('a saved weekly selection cannot hide a fully used shorter window', () => {
  const view = fixture();
  const short = limit('5시간', 100), weekly = limit('7일', 15);
  view.snapshots.work_codex.limits = [weekly, short];
  view.settings.selectedLimit.work_codex = weekly.id;
  const before = structuredClone(view);
  assert.equal(selectedLimit(view.snapshots.work_codex, view.settings), short);
  assert.equal(badge(view, 'https://chatgpt.com/codex', NOW).text, '100%');
  assert.match(badge(view, 'https://chatgpt.com/codex', NOW).title, /5시간: 100%/);
  assert.deepEqual(view, before, 'display selection must not mutate or aggregate the reported limits');
});

test('equal usage percentages retain the original response order', () => {
  const first = limit('먼저 반환된 기간', 80), second = limit('나중 기간', 80);
  assert.equal(highestUsageLimit([first, second]), first);
  assert.equal(highestUsageLimit([second, first]), second);
});

test('selection preserves real zero and ignores invalid percentages and remaining-only counts', () => {
  const zero = limit('미사용 기간', 0);
  const remaining = { ...limit('잔여 횟수', null), remaining: 999 };
  assert.equal(highestUsageLimit([remaining, limit('NaN', Number.NaN), limit('무한', Infinity), limit('음수', -1), limit('범위 초과', 101), zero]), zero);
});

test('no reported valid percentage yields no representative limit', () => {
  assert.equal(highestUsageLimit([]), null);
  assert.equal(highestUsageLimit([limit('확인 불가', null), limit('잘못된 수치', Number.NaN)]), null);
});

test('a model-specific maximum remains identified as that reported item without claiming every model is blocked', () => {
  const view = fixture(), model = limit('특정 모델', 100, 'model');
  view.snapshots.claude.limits = [limit('전체 기간', 20), model];
  assert.equal(selectedLimit(view.snapshots.claude, view.settings), model);
  const result = badge(view, 'https://claude.ai/new', NOW);
  assert.equal(result.text, '100%');
  assert.equal(result.title, 'AI Gauge · Claude · 특정 모델: 100%');
});

test('the general ChatGPT page automatically uses the plan source regardless of legacy badge preferences', () => {
  const view = fixture();
  view.settings.defaultProvider = 'chatgpt';
  view.settings.followTab = false;
  assert.equal(badge(view, 'https://chatgpt.com/', NOW).text, '15%');
  assert.equal(badge(view, 'https://chatgpt.com/c/example', NOW).text, '15%');
  assert.equal(badge(view, 'https://chatgpt.com/codex', NOW).text, '15%');
});

test('an enabled and authorized Claude tab takes priority over a legacy fixed plan preference', () => {
  const view = fixture();
  view.settings.defaultProvider = 'work_codex';
  view.settings.followTab = false;
  assert.equal(badge(view, 'https://claude.ai/new', NOW).text, '63%');
});

test('unrelated and URL-redacted tabs never receive a service badge', () => {
  const view = fixture();
  view.settings.defaultProvider = 'claude';
  assert.equal(badge(view, 'https://unrelated.invalid/', NOW).text, '');
  view.settings.enabled.work_codex = false;
  assert.equal(badge(view, 'https://unrelated.invalid/', NOW).text, '');
  view.settings.enabled.work_codex = true;
  view.permissions.work_codex = false;
  assert.equal(badge(view, undefined, NOW).text, '');
  assert.equal(badge(view, 'chrome://extensions/', NOW).title, 'AI Gauge');
});

test('disabled or unauthorized active sources do not expose their cached usage', () => {
  const view = fixture();
  view.settings.enabled.claude = false;
  assert.equal(badge(view, 'https://claude.ai/new', NOW).text, '—');
  view.settings.enabled.claude = true;
  view.permissions.claude = false;
  assert.equal(badge(view, 'https://claude.ai/new', NOW).text, '—');
  view.permissions.work_codex = false;
  const unavailable = badge(view, 'https://claude.ai/new', NOW);
  assert.equal(unavailable.text, '—');
  assert.match(unavailable.title, /권한 필요/);
  assert.doesNotMatch(unavailable.title, /최근 수집 성공/);
});

test('failed, stale or unknown data for an active source stays unavailable instead of switching to another successful service', () => {
  const view = fixture();
  view.snapshots.claude.state = 'error';
  view.snapshots.claude.errorCode = 'network';
  assert.equal(badge(view, 'https://claude.ai/new', NOW).text, '—');
  view.snapshots.claude = collected('claude', [limit('오래된 기간', 98)]);
  view.snapshots.claude.collectedAt = NOW - FRESH_MS;
  assert.equal(badge(view, 'https://claude.ai/new', NOW).text, '—');
  view.snapshots.claude = collected('claude', [limit('알 수 없는 기간', null)]);
  const unknown = badge(view, 'https://claude.ai/new', NOW);
  assert.equal(unknown.text, '—');
  assert.match(unknown.title, /사용률 확인 불가/);
});

test('lookalike domains and non-HTTPS URLs cannot select a site source', () => {
  const view = fixture();
  for (const url of ['https://claude.ai.evil.invalid/', 'http://claude.ai/new']) {
    assert.equal(badge(view, url, NOW).text, '');
  }
});
