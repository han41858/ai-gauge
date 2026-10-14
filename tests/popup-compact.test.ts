import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { renderCards, type Actions } from '../src/popup/render';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import { success } from '../src/background/scheduler';
import { ERROR_TEXT } from '../src/shared/errors';
import { usageParts } from '../src/content/usage-label';
import type { Provider, UsageLimit, View } from '../src/shared/types';

const now = 1_700_000_000_000;
const usage = (id: string, label: string, percent: number | null): UsageLimit => ({ id, label, percent,
  category: 'window', resetsAt: new Date(now + 3_600_000).toISOString(), windowSeconds: 604800,
  remaining: null, unit: null, source: 'api' });
const view = (): View => ({
  settings: { ...defaults(), enabled: { chatgpt: true, work_codex: true, claude: true } },
  permissions: { chatgpt: true, work_codex: true, claude: true },
  snapshots: {
    chatgpt: emptySnapshot('chatgpt'),
    work_codex: success(emptySnapshot('work_codex'), [usage('week', 'Work / Codex 공유 · 7일', 15)], now),
    claude: success(emptySnapshot('claude'), [usage('claude-week', '7일', 30)], now)
  }
});
const noop: Actions = { enable() {}, disable() {}, revoke() {}, refresh() {}, select() {} };
const fixture = () => {
  const dom = new JSDOM('<main id="cards"></main>');
  return { dom, cards: dom.window.document.getElementById('cards')! };
};

test('compact popup labels its plan and Claude cards without exposing the experimental ChatGPT snapshot', () => {
  const { dom, cards } = fixture(), v = view(), original = structuredClone(v);
  try {
    renderCards(cards, v, noop, now);
    assert.deepEqual([...cards.querySelectorAll<HTMLElement>('.card')].map(card => card.dataset.provider), ['work_codex', 'claude']);
    const plan = cards.querySelector('[data-provider="work_codex"]')!;
    assert.equal(plan.getAttribute('aria-label'), 'ChatGPT 사용량');
    assert.deepEqual([...cards.querySelectorAll('h2')].map(title => title.textContent), ['ChatGPT', 'Claude']);
    assert.equal(plan.querySelector('.limit-line')!.textContent, '7일사용량: 15%');
    assert(plan.querySelector('.reset')!.textContent!.length > 0);
    assert.doesNotMatch(cards.textContent!, /Work \/ Codex|공유 풀|최근 수집 성공/);
    assert.equal(cards.querySelector('.state'), null);
    assert.equal(cards.querySelector('.status'), null);
    assert.equal(cards.querySelector('details,select,.time'), null);
    assert.doesNotMatch(cards.textContent!, /상세|배지 항목|마지막 정상 수집|마지막 확인 시도|다음 갱신/);
    assert.deepEqual(v, original, 'hiding a card must not mutate collection settings or snapshots');
  } finally { dom.window.close(); }
});

test('compact popup preserves real window and model distinctions while stripping only the known shared prefix', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.work_codex.limits = [usage('week', 'Work / Codex 공유 · 7일', 15), usage('model', 'Work / Codex 공유 · 모델 A · 1일', 45)];
    renderCards(cards, v, noop, now);
    const names = [...cards.querySelectorAll('[data-provider="work_codex"] .limit-line > :first-child')].map(node => node.textContent);
    assert.deepEqual(names, ['7일', '모델 A · 1일']);
    assert.equal(cards.querySelectorAll('[data-provider="work_codex"] progress').length, 2);
  } finally { dom.window.close(); }
});

test('popup and input strip use the same validated usage and local reset text for each reported limit', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    for (const percent of [0, 17.25, null, Number.NaN, -1, 101]) {
      for (const resetsAt of [new Date(now + 49 * 3_600_000).toISOString(), new Date(now + 2 * 3_600_000).toISOString(), null, '2026-10-14T18:00:00']) {
        const item = { ...usage('week', 'Work / Codex 공유 · 7일', percent), resetsAt };
        v.snapshots.work_codex.limits = [item];
        renderCards(cards, v, noop, now);
        const card = cards.querySelector('[data-provider="work_codex"]')!;
        const parts = usageParts(v.snapshots.work_codex, item, now);
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
    v.snapshots.work_codex.limits[0]!.percent = 16;
    renderCards(cards, v, noop, now + 1);
    assert.equal(cards.querySelector('details,select,.time'), null);
    assert.deepEqual([...cards.querySelectorAll('h2')].map(title => title.textContent), ['ChatGPT', 'Claude']);
    assert.equal(cards.querySelector('[data-provider="work_codex"] .percent')!.textContent, '사용량: 16%');
  } finally { dom.window.close(); }
});

test('missing and failed quota stays visible without a fabricated zero or successful timestamp', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.work_codex = { ...emptySnapshot('work_codex'), errorCode: 'tab_access_failed', checkedAt: now };
    renderCards(cards, v, noop, now);
    const card = cards.querySelector('[data-provider="work_codex"]')!;
    assert.equal(card.querySelector('.status')!.textContent, ERROR_TEXT.tab_access_failed);
    assert.equal(card.querySelector('.status')!.closest('details'), null);
    assert.equal(card.querySelector('progress'), null);
    assert.doesNotMatch(card.textContent!, /0%|최근 수집 성공/);
    assert.doesNotMatch(card.textContent!, /정상 수집 기록 없음|마지막 확인 시도|다음 갱신/);
    v.snapshots.work_codex.state = 'ok'; v.snapshots.work_codex.collectedAt = now; v.snapshots.work_codex.errorCode = null;
    renderCards(cards, v, noop, now);
    assert.equal(cards.querySelector('[data-provider="work_codex"] .status')!.textContent, '사용량 확인 불가');
  } finally { dom.window.close(); }
});

test('old quota remains explicitly marked and an actual zero is retained', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.snapshots.claude.limits[0]!.percent = 0;
    v.snapshots.claude.state = 'error';
    v.snapshots.claude.errorCode = 'network';
    renderCards(cards, v, noop, now);
    const card = cards.querySelector('[data-provider="claude"]')!;
    const statuses = [...card.querySelectorAll('.status')];
    assert(statuses.some(node => node.textContent?.includes('오래된 데이터') && !node.closest('details')));
    assert(statuses.some(node => node.textContent === ERROR_TEXT.network && !node.closest('details')));
    assert.equal(card.querySelector('.old .percent')!.textContent, '사용량: 0%');
    assert.match(card.querySelector('progress')!.getAttribute('aria-label')!, /이전 값/);
  } finally { dom.window.close(); }
});

test('compact controls retain enabling, refreshing, disabling, and permission revocation without badge selection', () => {
  const { dom, cards } = fixture(), v = view(), calls: Array<[string, Provider, (string | null)?]> = [];
  const actions: Actions = {
    enable: p => { calls.push(['enable', p]); }, disable: p => { calls.push(['disable', p]); },
    revoke: p => { calls.push(['revoke', p]); }, refresh: p => { calls.push(['refresh', p]); },
    select: (p, id) => { calls.push(['select', p, id]); }
  };
  try {
    v.settings.enabled.work_codex = false; v.permissions.work_codex = false;
    renderCards(cards, v, actions, now);
    cards.querySelector<HTMLButtonElement>('[data-provider="work_codex"] .grant')!.click();
    v.settings.enabled.work_codex = true; v.permissions.work_codex = true;
    v.snapshots.work_codex.nextAttemptAt = 0;
    renderCards(cards, v, actions, now);
    const card = cards.querySelector('[data-provider="work_codex"]')!;
    for (const label of ['새로고침', '끄기', '권한 철회']) [...card.querySelectorAll('button')].find(button => button.textContent === label)!.click();
    assert.equal(card.querySelector('select'), null);
    assert.deepEqual(calls, [['enable', 'work_codex'], ['refresh', 'work_codex'], ['disable', 'work_codex'], ['revoke', 'work_codex']]);
    assert.equal(card.querySelector('a')!.href, 'https://chatgpt.com/');
  } finally { dom.window.close(); }
});

test('rate-limit error remains visible and blocks premature requests without showing retry timestamps', () => {
  const { dom, cards } = fixture(), v = view();
  let requests = 0;
  try {
    v.snapshots.work_codex.state = 'rate_limited'; v.snapshots.work_codex.errorCode = 'rate_limited';
    v.snapshots.work_codex.nextAttemptAt = now + 60_000;
    renderCards(cards, v, { ...noop, refresh() { requests++; } }, now);
    const card = cards.querySelector('[data-provider="work_codex"]')!;
    const refresh = [...card.querySelectorAll('button')].find(button => button.textContent === '새로고침')!;
    assert.equal(refresh.disabled, true); refresh.click(); assert.equal(requests, 0);
    assert(card.textContent!.includes(ERROR_TEXT.rate_limited));
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
  } finally { dom.window.close(); }
});

test('display-only settings expose the exact three labels and preserve all stored badge preferences on save', async () => {
  const dom = new JSDOM(readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' });
  const doc = dom.window.document, v = view();
  v.settings.defaultProvider = 'claude'; v.settings.followTab = true;
  v.settings.warning = 41; v.settings.danger = 82; v.settings.selectedLimit.work_codex = 'week';
  const before = structuredClone(v.settings);
  let saved: View['settings'] | null = null;
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    Object.assign(dom.window, { structuredClone, chrome: {
      runtime: { getManifest: () => ({ version: '1.2.3' }), sendMessage: async (message: { type: string; strips?: View['settings']['strips'] }) => {
        assert.notEqual(message.type, 'settings', 'display-only changes must not submit an old whole-settings object');
        if (message.type === 'strips') { v.settings.strips = structuredClone(message.strips!); saved = structuredClone(v.settings); }
        return { ok: true, view: structuredClone(v) };
      } },
      storage: { onChanged: { addListener() {} } }
    } });
    const bundle = buildSync({ entryPoints: ['src/popup/index.ts'], bundle: true, write: false, format: 'iife', target: 'chrome120' }).outputFiles[0]!.text;
    dom.window.eval(bundle); await flush();
    assert.deepEqual([...doc.querySelectorAll('#strip-settings label')].map(label => label.textContent), ['ChatGPT 입력창에 표시', 'Codex 입력창에 표시', 'Claude 입력창에 표시']);
    assert.equal(doc.querySelector('#default-provider,#follow-tab,#warning,#danger'), null);
    const checkbox = doc.getElementById('strip-chatgpt') as HTMLInputElement;
    checkbox.checked = false; checkbox.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    doc.getElementById('settings-form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flush(); await flush();
    assert.deepEqual(saved, { ...before, strips: { ...before.strips, chatgpt: false } });
  } finally { dom.window.close(); }
});
