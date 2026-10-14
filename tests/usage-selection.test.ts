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
  settings.enabled.chatgpt = true;
  settings.enabled.claude = true;
  return {
    settings, permissions: { chatgpt: true, claude: true, gemini: true },
    snapshots: {
      gemini: emptySnapshot('gemini'),
      chatgpt: collected('chatgpt', [limit('플랜 기간', 15)]),
      claude: collected('claude', [limit('Claude 기간', 63)])
    }
  };
};

test('a saved weekly selection cannot hide a fully used shorter window', () => {
  const view = fixture();
  const short = limit('5시간', 100), weekly = limit('7일', 15);
  view.snapshots.chatgpt.limits = [weekly, short];
  view.settings.selectedLimit.chatgpt = weekly.id;
  const before = structuredClone(view);
  assert.equal(selectedLimit(view.snapshots.chatgpt, view.settings), short);
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
  view.settings.defaultProvider = 'chatgpt';
  view.settings.followTab = false;
  assert.equal(badge(view, 'https://claude.ai/new', NOW).text, '63%');
});

test('unrelated and URL-redacted tabs never receive a service badge', () => {
  const view = fixture();
  view.settings.defaultProvider = 'claude';
  assert.equal(badge(view, 'https://unrelated.invalid/', NOW).text, '');
  view.settings.enabled.chatgpt = false;
  assert.equal(badge(view, 'https://unrelated.invalid/', NOW).text, '');
  view.settings.enabled.chatgpt = true;
  view.permissions.chatgpt = false;
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
  view.permissions.chatgpt = false;
  const unavailable = badge(view, 'https://claude.ai/new', NOW);
  assert.equal(unavailable.text, '—');
  assert.match(unavailable.title, /권한 필요/);
  assert.doesNotMatch(unavailable.title, /최근 수집 성공/);
});

test('unreliable or unknown active data never switches providers, while age alone preserves the badge', () => {
  const view = fixture();
  view.snapshots.claude.state = 'error';
  view.snapshots.claude.errorCode = 'network';
  assert.equal(badge(view, 'https://claude.ai/new', NOW).text, '—');
  view.snapshots.claude = collected('claude', [limit('오래된 기간', 98)]);
  view.snapshots.claude.collectedAt = NOW - FRESH_MS;
  assert.equal(badge(view, 'https://claude.ai/new', NOW).text, '98%');
  view.snapshots.claude = collected('claude', [limit('알 수 없는 기간', null)]);
  const unknown = badge(view, 'https://claude.ai/new', NOW);
  assert.equal(unknown.text, '—');
  assert.match(unknown.title, /사용률 확인 불가/);
});

test('lookalike domains and non-HTTPS URLs cannot select a site source', () => {
  const view = fixture();
  for (const url of ['https://claude.ai.evil.invalid/', 'http://claude.ai/new', 'https://gemini.google.com.evil.invalid/', 'http://gemini.google.com/app', 'https://google.com/gemini']) {
    assert.equal(badge(view, url, NOW).text, '');
  }
});

test('Gemini badge selects its highest actual usage with legible blue and white colors', () => {
  const view = fixture();
  view.settings.enabled.gemini = true;
  view.snapshots.gemini = collected('gemini', [limit('5시간', 0), limit('주간', 42)]);
  const result = badge(view, 'https://gemini.google.com/app', NOW);
  assert.equal(result.text, '42%'); assert.equal(result.title, 'AI Gauge · Gemini · 주간: 42%');
  assert.equal(result.color, '#3569C8'); assert.equal(result.textColor, '#FFFFFF');
  const channels = result.color.slice(1).match(/../g)!.map(hex => {
    const value = parseInt(hex, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  assert(1.05 / (luminance + 0.05) >= 4.5, 'white badge numbers need at least 4.5:1 contrast');
  view.snapshots.gemini = collected('gemini', [limit('5시간', 0)]);
  assert.equal(badge(view, 'https://gemini.google.com/app', NOW).text, '0%');
  view.snapshots.gemini.limits[0]!.percent = null;
  assert.equal(badge(view, 'https://gemini.google.com/app', NOW).text, '—');
});
