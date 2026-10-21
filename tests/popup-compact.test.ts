import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleEntry } from './helpers/bundle';
import { JSDOM } from 'jsdom';
import { renderCards, type Actions } from '../src/popup/render';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import { failure, success } from '../src/background/scheduler';
import { CollectionError } from '../src/shared/errors';
import { badge } from '../src/background/badge';
import { usageParts } from '../src/content/usage-label';
import type { Provider, UsageLimit, View } from '../src/shared/types';

const now = 1_700_000_000_000;
const usage = (id: string, label: string, percent: number | null): UsageLimit => ({ id, label, percent,
  category: 'window', resetsAt: new Date(now + 3_600_000).toISOString(), windowSeconds: 604800,
  remaining: null, unit: null, source: 'api' });
const view = (): View => ({
  settings: { ...defaults(), enabled: { chatgpt: true, claude: true, gemini: true } },
  permissions: { chatgpt: true, claude: true, gemini: true },
  snapshots: {
    gemini: success(emptySnapshot('gemini'), [usage('gemini-week', '주간', 42)], now),
    chatgpt: success(emptySnapshot('chatgpt'), [usage('week', 'ChatGPT · 7일', 15)], now),
    claude: success(emptySnapshot('claude'), [usage('claude-week', '7일', 30)], now)
  }
});
const noop: Actions = { enable() {}, disable() {}, revoke() {}, select() {} };
const fixture = () => {
  const dom = new JSDOM('<main id="cards"></main>');
  return { dom, cards: dom.window.document.getElementById('cards')! };
};

test('compact popup shows exactly ChatGPT, Claude and Gemini without a separate Codex card', () => {
  const { dom, cards } = fixture(), v = view(), original = structuredClone(v);
  try {
    renderCards(cards, v, noop, now);
    assert.deepEqual([...cards.querySelectorAll<HTMLElement>('.card')].map(card => card.dataset.provider), ['chatgpt', 'claude', 'gemini']);
    const plan = cards.querySelector('[data-provider="chatgpt"]')!;
    assert.equal(plan.getAttribute('aria-label'), 'ChatGPT 사용량');
    assert.deepEqual([...cards.querySelectorAll('h2')].map(title => title.textContent), ['ChatGPT', 'Claude', 'Gemini']);
    assert.deepEqual([...cards.querySelectorAll<HTMLAnchorElement>('h2 a')].map(link => [link.textContent, link.href, link.target, link.rel, link.tabIndex]), [
      ['ChatGPT', 'https://chatgpt.com/', '_blank', 'noopener noreferrer', 0],
      ['Claude', 'https://claude.ai/', '_blank', 'noopener noreferrer', 0],
      ['Gemini', 'https://gemini.google.com/', '_blank', 'noopener noreferrer', 0]
    ]);
    assert.equal(cards.querySelector('.actions a'), null);
    assert.doesNotMatch(cards.textContent!, /새로고침|사이트 열기/);
    assert.equal(plan.querySelector('.limit-line')!.textContent, '7일사용량: 15%');
    assert(plan.querySelector('.reset')!.textContent!.length > 0);
    assert.doesNotMatch(cards.textContent!, /Work \/ Codex|공유 풀|최근 수집 성공/);
    assert.equal(cards.querySelector('.state'), null);
    assert.equal(cards.querySelector('.status'), null);
    assert.equal(cards.querySelector('details,select,.time'), null);
    assert.doesNotMatch(cards.textContent!, /상세|배지 항목|마지막 정상 수집|마지막 확인 시도|다음 갱신/);
    assert.deepEqual(v, original, 'rendering cards must not mutate collection settings or snapshots');
  } finally { dom.window.close(); }
});

test('compact popup preserves real window and model distinctions while stripping only the known shared prefix', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.chatgpt.limits = [usage('week', 'Work / Codex 공유 · 7일', 15), { ...usage('model', 'Work / Codex 공유 · 모델 A · 1일', 45), windowSeconds: 86400 }];
    renderCards(cards, v, noop, now);
    const names = [...cards.querySelectorAll('[data-provider="chatgpt"] .limit-line > :first-child')].map(node => node.textContent);
    assert.deepEqual(names, ['모델 A · 1일', '7일']);
    assert.equal(cards.querySelectorAll('[data-provider="chatgpt"] progress').length, 2);
  } finally { dom.window.close(); }
});

test('all popup limits use their own percentage for default and fractional threshold colors', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    const cases = [
      { warning: 70, danger: 90, values: [[0, '#2DE5F4'], [30, '#2DE5F4'], [69.9, '#2DE5F4'],
        [70, '#FFAE32'], [89.9, '#FFAE32'], [90, '#FF454E'], [100, '#FF454E']] },
      { warning: 30.25, danger: 75.5, values: [[30.249, '#2DE5F4'], [30.25, '#FFAE32'],
        [75.499, '#FFAE32'], [75.5, '#FF454E']] }
    ] as const;
    for (const { warning, danger, values } of cases) {
      Object.assign(v.settings, { warning, danger });
      for (const provider of ['chatgpt', 'claude', 'gemini'] as const) {
        v.snapshots[provider].limits = values.map(([value], i) => ({
          ...usage(`${provider}:${i}`, `Limit ${i}`, value),
          category: (['window', 'product', 'model'] as const)[i % 3]!,
          windowSeconds: i === 0 ? 18000 : 604800
        }));
      }
      const before = structuredClone(v);
      renderCards(cards, v, noop, now);
      for (const provider of ['chatgpt', 'claude', 'gemini'] as const) {
        const bars = [...cards.querySelectorAll<HTMLProgressElement>(`[data-provider="${provider}"] progress`)];
        assert.deepEqual(bars.map(bar => [bar.value, bar.style.getPropertyValue('--usage-color')]), values, provider);
        assert(bars.every(bar => bar.max === 100));
      }
      assert.deepEqual(v, before, 'presentation does not change collection data, ordering or settings');
    }
  } finally { dom.window.close(); }
});

test('popup and input strip share validated usage and identical reset countdown text', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    for (const percent of [0, 17.25, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 101]) {
      for (const resetsAt of [new Date(now + 49 * 3_600_000).toISOString(), new Date(now + 2 * 3_600_000).toISOString(), null, '2026-10-14T18:00:00']) {
        const item = { ...usage('week', 'Work / Codex 공유 · 7일', percent), resetsAt };
        v.snapshots.chatgpt.limits = [item];
        renderCards(cards, v, noop, now);
        const card = cards.querySelector('[data-provider="chatgpt"]')!;
        const parts = usageParts(v.snapshots.chatgpt, item, now);
        assert.equal(card.querySelector('.percent')!.textContent, parts.current);
        assert.equal(card.querySelector('.reset')!.textContent, parts.reset);
        assert.equal(card.querySelectorAll('progress').length, parts.percent === null ? 0 : 1);
        assert.doesNotMatch(card.textContent!, /현재 사용량/);
      }
    }
  } finally { dom.window.close(); }
});

test('cached quota rerenders keep card titles and updated values without restoring removed detail controls', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    renderCards(cards, v, noop, now);
    v.snapshots.chatgpt.limits[0]!.percent = 16;
    renderCards(cards, v, noop, now + 1);
    assert.equal(cards.querySelector('details,select,.time'), null);
    assert.deepEqual([...cards.querySelectorAll('h2')].map(title => title.textContent), ['ChatGPT', 'Claude', 'Gemini']);
    assert.equal(cards.querySelector('[data-provider="chatgpt"] .percent')!.textContent, '사용량: 16%');
  } finally { dom.window.close(); }
});

test('missing and failed quota stays visible without a fabricated zero or successful timestamp', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.chatgpt = { ...emptySnapshot('chatgpt'), errorCode: 'tab_access_failed', checkedAt: now };
    renderCards(cards, v, noop, now);
    const card = cards.querySelector('[data-provider="chatgpt"]')!;
    assert.equal(card.querySelector('.status')!.textContent, '사용량 다시 확인 중');
    assert.equal(card.querySelector('.status')!.closest('details'), null);
    assert.equal(card.querySelector('progress'), null);
    assert.doesNotMatch(card.textContent!, /0%|최근 수집 성공/);
    assert.doesNotMatch(card.textContent!, /정상 수집 기록 없음|마지막 확인 시도|다음 갱신/);
    v.snapshots.chatgpt.state = 'ok'; v.snapshots.chatgpt.collectedAt = now; v.snapshots.chatgpt.errorCode = null;
    renderCards(cards, v, noop, now);
    assert.equal(cards.querySelector('[data-provider="chatgpt"] .status')!.textContent, '사용량 확인 불가');
  } finally { dom.window.close(); }
});

test('popup and all supported page badges retain cached usage after repeated tab execution failures', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    for (const provider of ['chatgpt', 'claude', 'gemini'] as const) {
      let snapshot = v.snapshots[provider];
      for (let i = 0; i < 3; i++) snapshot = failure(snapshot, new CollectionError('tab_access_failed'), now + i * 60_000);
      v.snapshots[provider] = snapshot;
    }
    renderCards(cards, v, noop, now + 180_000);
    assert.equal(cards.querySelector('.status,.old'), null);
    assert.deepEqual([...cards.querySelectorAll('progress')].map(progress => progress.value), [15, 30, 42]);
    assert.deepEqual([...cards.querySelectorAll('progress')].map(progress => progress.style.getPropertyValue('--usage-color')),
      ['#2DE5F4', '#2DE5F4', '#2DE5F4']);
    for (const [url, expected] of [['https://chatgpt.com/', '15%'], ['https://chatgpt.com/codex/cloud', '15%'],
      ['https://claude.ai/', '30%'], ['https://gemini.google.com/', '42%']]) {
      assert.equal(badge(v, url, now + 180_000).text, expected);
    }
    assert.doesNotMatch(cards.textContent!, /확인 불가|사이트 접근 설정 확인|다시 확인 중|이전 수집값/);
  } finally { dom.window.close(); }
});

test('age alone preserves threshold colors while unreliable previous values retain their separate presentation', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.chatgpt.limits[0]!.percent = 95;
    v.snapshots.chatgpt.collectedAt = now - 3_600_000;
    v.snapshots.chatgpt.state = 'stale';
    renderCards(cards, v, noop, now);
    let card = cards.querySelector('[data-provider="chatgpt"]')!;
    assert.equal(card.querySelector('.old'), null);
    assert.equal(card.querySelector('progress')!.style.getPropertyValue('--usage-color'), '#FF454E');
    for (const state of ['error', 'signed_out', 'rate_limited', 'unsupported'] as const) {
      Object.assign(v.snapshots.chatgpt, { state, errorCode: 'network', failures: 2 });
      renderCards(cards, v, noop, now);
      card = cards.querySelector('[data-provider="chatgpt"]')!;
      const bar = card.querySelector('.old progress') as HTMLProgressElement;
      assert(bar, 'a retained previous value must use the existing muted old-state styling');
      assert.equal(bar.value, 95);
      assert.match(bar.getAttribute('aria-label')!, /이전 값/);
      assert.match(card.textContent!, /이전 수집값/);
    }
  } finally { dom.window.close(); }
});

test('quota retained after an explicit collection failure is marked as a previous value and preserves an actual zero', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.claude.limits[0]!.percent = 0;
    v.snapshots.claude.state = 'error';
    v.snapshots.claude.errorCode = 'network';
    renderCards(cards, v, noop, now);
    const card = cards.querySelector('[data-provider="claude"]')!;
    const statuses = [...card.querySelectorAll('.status')];
    assert(statuses.some(node => node.textContent === '이전 수집값' && !node.closest('details')));
    assert(statuses.some(node => node.textContent === '연결 확인 중' && !node.closest('details')));
    assert.doesNotMatch(card.textContent!, /오래된 데이터/);
    assert.equal(card.querySelector('.old .percent')!.textContent, '사용량: 0%');
    assert.match(card.querySelector('progress')!.getAttribute('aria-label')!, /이전 값/);
  } finally { dom.window.close(); }
});

test('Gemini card displays cached windows shortest first without changing source order or inventing units', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.gemini.limits = [
      { ...usage('gemini-week', '주간', 62.5), remaining: 12096 },
      { ...usage('gemini-unknown', '알 수 없는 기간', null), remaining: 12, windowSeconds: null },
      { ...usage('gemini-short', '5시간', 0), remaining: 600, windowSeconds: 18000 }
    ];
    const original = structuredClone(v.snapshots.gemini.limits);
    renderCards(cards, v, noop, now);
    assert.deepEqual(v.snapshots.gemini.limits, original);
    const card = cards.querySelector('[data-provider="gemini"]')!;
    assert.deepEqual([...card.querySelectorAll('.limit-line')].map(row => row.textContent), [
      '5시간사용량: 0%', '주간사용량: 63%', '알 수 없는 기간사용량: 확인 불가'
    ]);
    assert.equal(card.querySelectorAll('progress').length, 2);
    assert.equal(card.querySelectorAll('.reset').length, 3);
    assert.doesNotMatch(card.textContent!, /600|12096|메시지|회 남음|마지막 수집/);
    assert.equal(card.querySelector('a')!.href, 'https://gemini.google.com/');
    v.snapshots.gemini.state = 'error'; v.snapshots.gemini.errorCode = 'network';
    renderCards(cards, v, noop, now);
    const failed = cards.querySelector('[data-provider="gemini"]')!;
    assert.match(failed.textContent!, /이전 수집값/);
    assert(failed.textContent!.includes('연결 확인 중'));
    assert.doesNotMatch(failed.textContent!, /오래된 데이터/);
    assert.equal(failed.querySelectorAll('.old').length, 3);
  } finally { dom.window.close(); }
});

test('Gemini card controls affect only Gemini and a disabled card hides its cached percentages', () => {
  const { dom, cards } = fixture(), v = view(), calls: string[] = [];
  try {
    const actions: Actions = { ...noop, enable: p => { calls.push(`enable:${p}`); }, disable: p => { calls.push(`disable:${p}`); }, revoke: p => { calls.push(`revoke:${p}`); } };
    v.settings.enabled.gemini = false; v.permissions.gemini = false;
    renderCards(cards, v, actions, now);
    const disabled = cards.querySelector('[data-provider="gemini"]')!;
    assert.equal(disabled.querySelector('progress'), null);
    disabled.querySelector<HTMLButtonElement>('.grant')!.click();
    v.settings.enabled.gemini = true; v.permissions.gemini = true;
    v.snapshots.gemini.nextAttemptAt = 0;
    renderCards(cards, v, actions, now);
    const active = cards.querySelector('[data-provider="gemini"]')!;
    for (const label of ['끄기', '권한 철회']) [...active.querySelectorAll('button')].find(button => button.textContent === label)!.click();
    assert.deepEqual(calls, ['enable:gemini', 'disable:gemini', 'revoke:gemini']);
  } finally { dom.window.close(); }
});

test('compact controls retain enabling, disabling, and permission revocation with site navigation in the title', () => {
  const { dom, cards } = fixture(), v = view(), calls: Array<[string, Provider, (string | null)?]> = [];
  const actions: Actions = {
    enable: p => { calls.push(['enable', p]); }, disable: p => { calls.push(['disable', p]); },
    revoke: p => { calls.push(['revoke', p]); },
    select: (p, id) => { calls.push(['select', p, id]); }
  };
  try {
    v.settings.enabled.chatgpt = false; v.permissions.chatgpt = false;
    renderCards(cards, v, actions, now);
    cards.querySelector<HTMLButtonElement>('[data-provider="chatgpt"] .grant')!.click();
    v.settings.enabled.chatgpt = true; v.permissions.chatgpt = true;
    v.snapshots.chatgpt.nextAttemptAt = 0;
    renderCards(cards, v, actions, now);
    const card = cards.querySelector('[data-provider="chatgpt"]')!;
    for (const label of ['끄기', '권한 철회']) [...card.querySelectorAll('button')].find(button => button.textContent === label)!.click();
    assert.equal(card.querySelector('select'), null);
    assert.deepEqual(calls, [['enable', 'chatgpt'], ['disable', 'chatgpt'], ['revoke', 'chatgpt']]);
    assert.equal(card.querySelector<HTMLAnchorElement>('h2 a')!.href, 'https://chatgpt.com/');
  } finally { dom.window.close(); }
});

test('rate-limit error remains visible without manual refresh controls or retry timestamps', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.chatgpt.state = 'rate_limited'; v.snapshots.chatgpt.errorCode = 'rate_limited';
    v.snapshots.chatgpt.nextAttemptAt = now + 60_000;
    renderCards(cards, v, noop, now);
    const card = cards.querySelector('[data-provider="chatgpt"]')!;
    assert.doesNotMatch(card.textContent!, /새로고침/);
    assert(card.textContent!.includes('잠시 후 다시 확인'));
    assert.equal(card.querySelector('.time'), null);
    assert.doesNotMatch(card.textContent!, /다음 갱신/);
  } finally { dom.window.close(); }
});

test('popup keeps settings and diagnostics collapsed while removing persistent explanatory copy', () => {
  const dom = new JSDOM(readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8'));
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector<HTMLDetailsElement>('#preferences')!.open, false);
    assert.equal(doc.querySelector<HTMLDetailsElement>('#diagnostics')!.open, false);
    assert.equal(doc.querySelector('.notice'), null);
    assert.doesNotMatch(doc.body.textContent!, /입력창에는|일반 ChatGPT 입력창|AI 사용량을 한눈에|배지 기준|주의 \(%\)|위험 \(%\)/);
    assert.equal(doc.querySelector('#default-provider,#follow-tab,#warning,#danger'), null);
    assert(doc.getElementById('extension-version'));
    assert(doc.getElementById('settings-form'));
    assert.equal(doc.querySelector('#settings-form button[type="submit"]'), null);
  } finally { dom.window.close(); }
});

test('display-only settings expose page labels and preserve unrelated preferences on save', async () => {
  const dom = new JSDOM(readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' });
  const doc = dom.window.document, v = view();
  v.settings.warning = 41; v.settings.danger = 82;
  const before = structuredClone(v.settings);
  let saved: View['settings'] | null = null;
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    Object.assign(dom.window, { structuredClone, chrome: {
      runtime: { getManifest: () => ({ version: '1.2.3' }), sendMessage: async (message: { type: string; strips?: View['settings']['strips']; language?: View['settings']['language']; warning?: number; danger?: number }) => {
        assert.notEqual(message.type, 'settings', 'display-only changes must not submit an old whole-settings object');
        if (message.type === 'display-settings') { v.settings.strips = structuredClone(message.strips!); v.settings.language = message.language!; v.settings.warning = message.warning!; v.settings.danger = message.danger!; saved = structuredClone(v.settings); }
        return { ok: true, view: structuredClone(v) };
      } },
      storage: { onChanged: { addListener() {} } }
    } });
    const bundle = bundleEntry('src/popup/index.ts');
    dom.window.eval(bundle); await flush();
    assert.deepEqual([...doc.querySelectorAll('#strip-settings label')].map(label => label.textContent), ['ChatGPT 입력창에 표시', 'Codex 입력창에 표시', 'Claude 입력창에 표시', 'Gemini 입력창에 표시']);
    assert.equal(doc.querySelector('#default-provider,#follow-tab,#warning,#danger'), null);
    const checkbox = doc.getElementById('strip-chatgpt') as HTMLInputElement;
    checkbox.checked = false; checkbox.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flush(); await flush();
    assert.deepEqual(saved, { ...before, strips: { ...before.strips, chatgpt: false } });
  } finally { dom.window.close(); }
});
