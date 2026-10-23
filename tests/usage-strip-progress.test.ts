import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { UsageStrip } from '../src/content/usage-strip';
import { usageParts } from '../src/content/usage-label';
import { badge } from '../src/background/badge';
import { defaults } from '../src/storage/settings';
import { emptySnapshot, FRESH_MS } from '../src/storage/snapshots';
import type { PageProvider, UsageLimit, View } from '../src/shared/types';

const PAGE_URLS = { chatgpt: 'https://chatgpt.com/', codex: 'https://chatgpt.com/codex', claude: 'https://claude.ai/new', gemini: 'https://gemini.google.com/app' };

function assertBadge(current: View, provider: PageProvider, percent: number | null, period?: string) {
  const value = badge(current, PAGE_URLS[provider]);
  const name = provider === 'claude' ? 'Claude' : provider === 'gemini' ? 'Gemini' : 'ChatGPT';
  assert.equal(value.text, percent === null ? '—' : `${Math.round(percent)}%`, provider);
  if (percent === null) {
    assert(value.title.startsWith(`AI Gauge · ${name} · `), provider);
    assert.doesNotMatch(value.title, /\d+%/, 'An unavailable badge cannot retain a previous usage percentage in its title');
  } else assert.equal(value.title, `AI Gauge · ${name} · ${period}: ${Math.round(percent)}%`, provider);
}

function view(percent: number | null = 17): View {
  const settings = defaults(); settings.enabled.chatgpt = true;
  const now = Date.now();
  return { settings, permissions: { chatgpt: true, gemini: true, claude: true }, snapshots: {
    gemini: emptySnapshot('gemini'), claude: emptySnapshot('claude'),
    chatgpt: { ...emptySnapshot('chatgpt'), state: 'ok', collectedAt: now, checkedAt: now, errorCode: null,
      limits: [{ id: 'shared:secondary_window', label: '7일', category: 'product', percent, resetsAt: new Date(now + 49 * 3_600_000).toISOString(),
        windowSeconds: 604800, remaining: null, unit: null, source: 'api' }] }
  } };
}

function fixture(provider: PageProvider = 'chatgpt') {
  const composer = provider === 'gemini'
    ? '<input-area-v2><rich-textarea><div contenteditable="true"></div></rich-textarea><button>Send</button></input-area-v2>'
    : '<form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form>';
  const dom = new JSDOM(`<main>${composer}</main>`, { url: PAGE_URLS[provider] });
  const roots = new Map<HTMLElement, ShadowRoot>();
  const original = dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow = function(this: HTMLElement, options: ShadowRootInit) {
    const root = original.call(this, options); roots.set(this, root); return root;
  };
  const doc = dom.window.document, strip = new UsageStrip(provider, doc);
  const elements = () => {
    const host = doc.getElementById('ai-gauge-usage-strip')!;
    const root = roots.get(host)!;
    return { host, root, progress: root.querySelector('progress')!, current: root.querySelector('.current > span')!, reset: root.querySelector('.reset')! };
  };
  return { dom, doc, strip, elements };
}

test('inline progress displays real zero, full usage and precise fractional values in a closed shadow root', () => {
  const { dom, strip, elements } = fixture();
  try {
    for (const value of [0, 100, 17.25]) {
      const snapshot = view(value);
      strip.update(snapshot);
      const { host, progress, current } = elements();
      assert.equal(host.shadowRoot, null);
      assert.equal(progress.hidden, false);
      assert.equal(progress.max, 100);
      assert.equal(progress.value, value);
      assert.equal(progress.getAttribute('value'), String(value));
      assert.equal(progress.getAttribute('aria-label'), '사용량');
      assert.equal(current.textContent, `사용량: ${Math.round(value)}%`);
      assertBadge(snapshot, 'chatgpt', value, '7일');
    }
  } finally { dom.window.close(); }
});

test('every composer progress fill matches its gauge at default and fractional threshold boundaries', () => {
  const cases = [
    { warning: 70, danger: 90, values: [[0, '#2DE5F4'], [30, '#2DE5F4'], [69.9, '#2DE5F4'],
      [70, '#FFAE32'], [89.9, '#FFAE32'], [90, '#FF454E'], [100, '#FF454E']] },
    { warning: 30.25, danger: 75.5, values: [[30.249, '#2DE5F4'], [30.25, '#FFAE32'],
      [75.499, '#FFAE32'], [75.5, '#FF454E']] }
  ] as const;
  for (const provider of ['chatgpt', 'codex', 'claude', 'gemini'] as const) {
    const { dom, strip, elements } = fixture(provider);
    try {
      for (const { warning, danger, values } of cases) {
        for (const [value, expected] of values) {
          const current = view(value), source = provider === 'codex' ? 'chatgpt' : provider;
          current.settings.enabled[source] = true;
          Object.assign(current.settings, { warning, danger });
          current.snapshots[source] = { ...current.snapshots.chatgpt, provider: source,
            limits: [{ ...current.snapshots.chatgpt.limits[0]!,
              id: source === 'chatgpt' ? 'shared:primary_window' : 'five_hour',
              category: source === 'chatgpt' ? 'product' : 'window' }] };
          strip.update(current);
          const { progress, root } = elements();
          assert.equal(progress.style.getPropertyValue('--usage-color'), expected, `${provider}: ${value}`);
          assert.equal(root.querySelector('.gauge-arc')!.getAttribute('stroke'), expected, `${provider}: ${value}`);
          assert.equal(progress.value, value, 'fractional fill is not rounded to the displayed text');
          assert.equal(progress.max, 100);
          assert.equal(progress.hidden, false);
          assertBadge(current, provider, value, '7일');
        }
      }
    } finally { dom.window.close(); }
  }
});

test('missing and invalid usage hide progress instead of clamping it or inventing zero', () => {
  const { dom, strip, elements } = fixture();
  try {
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
      const current = view(value); current.snapshots.chatgpt.limits[0]!.remaining = 45;
      strip.update(current);
      const { progress, current: label } = elements();
      assert.equal(progress.hidden, true);
      assert.equal(progress.hasAttribute('value'), false);
      assert.equal(label.textContent, '사용량: 확인 불가');
    }
    const current = view(); current.snapshots.chatgpt.limits = [];
    strip.update(current);
    assert.equal(elements().progress.hidden, true);
    assert.equal(elements().progress.hasAttribute('value'), false);
  } finally { dom.window.close(); }
});

test('unreliable snapshots hide progress, while normal cache age preserves the existing bar', () => {
  const { dom, strip, elements } = fixture();
  try {
    for (const state of ['error', 'stale', 'signed_out', 'rate_limited', 'unsupported'] as const) {
      strip.update(view(63));
      assert.equal(elements().progress.value, 63);
      const current = view(63); current.snapshots.chatgpt.state = state;
      current.snapshots.chatgpt.errorCode = 'network';
      current.snapshots.chatgpt.failures = 2;
      strip.update(current);
      assert.equal(elements().progress.hidden, true);
      assert.equal(elements().progress.hasAttribute('value'), false);
      assert.doesNotMatch(elements().host.getAttribute('aria-label')!, /63%/);
    }
    strip.update(view(63));
    const previous = elements();
    const aged = view(63); aged.snapshots.chatgpt.collectedAt = Date.now() - FRESH_MS;
    strip.update(aged);
    assert.equal(elements().progress, previous.progress);
    assert.equal(elements().progress.hidden, false);
    assert.equal(elements().progress.value, 63);
    assert.equal(elements().progress.style.getPropertyValue('--usage-color'), '#2DE5F4');
    assert.doesNotMatch(elements().host.getAttribute('aria-label')!, /오래된|갱신 필요/);
  } finally { dom.window.close(); }
});

test('usage and reset fit a 30px row that hides details before the current usage on narrow screens', () => {
  const { dom, strip, elements } = fixture();
  try {
    const current = view(17); strip.update(current);
    const { host, root, progress, current: label, reset } = elements();
    assert.equal(progress.previousElementSibling, label);
    assert.match(reset.textContent!, /^🕒 초기화:/);
    assert.equal(label.parentElement?.nextElementSibling, reset);
    const parts = usageParts(current.snapshots.chatgpt, current.snapshots.chatgpt.limits[0]);
    assert.equal(host.getAttribute('aria-label'), parts.label);
    assert.doesNotMatch(host.getAttribute('aria-label')!, /%, 초기화/);
    assert.equal(root.querySelector('[role="status"]')?.getAttribute('aria-live'), 'polite');
    assert.equal(root.querySelector('[role="status"]')?.getAttribute('aria-atomic'), 'true');
    const style = root.querySelector('style')!.textContent!;
    assert.match(style, /gap:14px/);
    assert.match(style, /:host\{[^}]*height:30px[^}]*font:12px/);
    assert.match(style, /\.usage\{[^}]*align-items:center[^}]*height:30px[^}]*padding:0 10px/);
    assert.match(style, /@container ai-gauge \(max-width:520px\)\{\.reset\{display:none/);
    assert.match(style, /@container ai-gauge \(max-width:280px\)\{progress\{display:none/);
    assert.match(style, /progress\{[^}]*width:80px[^}]*height:6px[^}]*border:0/);
  } finally { dom.window.close(); }
});

test('known usage still has a valid progress bar when only the reset timestamp is missing', () => {
  const { dom, strip, elements } = fixture();
  try {
    const current = view(45); current.snapshots.chatgpt.limits[0]!.resetsAt = null;
    strip.update(current);
    assert.equal(elements().progress.hidden, false);
    assert.equal(elements().progress.value, 45);
    assert.equal(elements().reset.textContent, '🕒 초기화: 확인 불가');
  } finally { dom.window.close(); }
});

test('repeated mounts preserve the progress nodes without mutations and updates reuse the same elements', () => {
  const { dom, strip, elements } = fixture();
  try {
    const current = view(17); strip.update(current);
    const before = elements(), observer = new dom.window.MutationObserver(() => undefined);
    observer.observe(before.root, { attributes: true, childList: true, characterData: true, subtree: true });
    observer.observe(before.host, { attributes: true });
    for (let i = 0; i < 20; i++) strip.mount();
    assert.equal(observer.takeRecords().length, 0);
    current.snapshots.chatgpt.limits[0]!.percent = 42;
    strip.update(current);
    assert.equal(elements().progress, before.progress);
    assert.equal(elements().current, before.current);
    assert.equal(elements().reset, before.reset);
    assert.equal(elements().progress.value, 42);
    observer.takeRecords();
    strip.mount();
    assert.equal(observer.takeRecords().length, 0);
    observer.disconnect();
  } finally { dom.window.close(); }
});

test('strip cleanup removes the progress host and re-enabling creates one fresh closed component', () => {
  const { dom, doc, strip, elements } = fixture();
  try {
    const current = view(17); strip.update(current);
    const before = elements();
    current.settings.strips.chatgpt = false;
    strip.update(current);
    assert.equal(doc.querySelector('#ai-gauge-usage-strip'), null);
    assert.equal(before.host.isConnected, false);
    current.settings.strips.chatgpt = true;
    strip.update(current);
    assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
    assert.notEqual(elements().progress, before.progress);
    assert.equal(elements().progress.value, 17);
    assert.equal(elements().host.shadowRoot, null);
    strip.remove();
    assert.equal(doc.querySelector('#ai-gauge-usage-strip'), null);
  } finally { dom.window.close(); }
});

test('the inline gauge shares the text and progress selection and changes color without rotating for settings changes', () => {
  const { dom, strip, elements } = fixture();
  try {
    const current = view(17);
    current.snapshots.chatgpt.limits.push({ ...current.snapshots.chatgpt.limits[0]!, id: 'shared:primary_window', percent: 84, resetsAt: new Date(Date.now() + 3_600_000).toISOString() });
    strip.update(current);
    const before = elements(), gauge = before.root.querySelector('.usage-gauge')!;
    const needle = gauge.querySelector<SVGGElement>('.gauge-needle')!, arc = gauge.querySelector('.gauge-arc')!;
    assert.equal(before.root.querySelector('img.brand-icon'), null);
    assert.equal(before.root.querySelectorAll('svg.brand-icon').length, 1);
    assert.equal(before.current.previousElementSibling, gauge);
    assert.equal(before.current.textContent, '사용량: 84%');
    assert.equal(before.progress.value, 84);
    assert.equal(before.progress.style.getPropertyValue('--usage-color'), '#FFAE32');
    assert.equal(needle.style.transform, `rotate(${-90 + 84 * 1.8}deg)`);
    assert.equal(arc.getAttribute('stroke'), '#FFAE32');
    assert.equal(gauge.getAttribute('aria-hidden'), 'true');
    assert.equal(gauge.querySelector('title,[role="status"]'), null);
    const observer = new dom.window.MutationObserver(() => undefined);
    observer.observe(gauge, { attributes: true, childList: true, characterData: true, subtree: true });
    current.settings.warning = 50; current.settings.danger = 80;
    strip.update(current);
    const records = observer.takeRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0]!.target, arc);
    assert.equal(records[0]!.attributeName, 'stroke');
    assert.equal(arc.getAttribute('stroke'), '#FF454E');
    assert.equal(before.progress.style.getPropertyValue('--usage-color'), '#FF454E');
    assert.equal(needle.style.transform, `rotate(${-90 + 84 * 1.8}deg)`);
    assert.equal(elements().progress, before.progress);
    for (let i = 0; i < 20; i++) strip.mount();
    assert.equal(observer.takeRecords().length, 0, 'time-only redraws leave an unchanged gauge untouched');
    assert.equal(elements().root.querySelector('.usage-gauge'), gauge);
    observer.disconnect();
  } finally { dom.window.close(); }
});

test('the inline gauge follows the existing cache and unknown-state policy without inventing angles', () => {
  const { dom, strip, elements } = fixture();
  try {
    const current = view(63);
    current.snapshots.chatgpt.collectedAt = Date.now() - FRESH_MS;
    current.snapshots.chatgpt.state = 'error';
    current.snapshots.chatgpt.errorCode = 'network';
    current.snapshots.chatgpt.failures = 1;
    strip.update(current);
    const gauge = elements().root.querySelector('.usage-gauge')!;
    const needle = gauge.querySelector<SVGGElement>('.gauge-needle')!;
    assert.equal(gauge.getAttribute('data-usage-state'), 'known');
    assert.equal(needle.style.transform, `rotate(${-90 + 63 * 1.8}deg)`);
    assert.equal(elements().progress.value, 63);
    assertBadge(current, 'chatgpt', 63, '7일');
    current.snapshots.chatgpt.failures = 2;
    strip.update(current);
    assert.equal(gauge.getAttribute('data-usage-state'), 'unknown');
    assert.equal(needle.getAttribute('visibility'), 'hidden');
    assert.equal(gauge.querySelector('.gauge-arc')!.getAttribute('stroke'), '#8893A0');
    assert.equal(elements().progress.hidden, true);
    assert.equal(elements().current.textContent, '사용량: 확인 불가');
    assertBadge(current, 'chatgpt', null);
    const restored = view(0); strip.update(restored);
    assert.equal(elements().root.querySelector('.usage-gauge'), gauge);
    assert.equal(needle.getAttribute('visibility'), 'visible');
    assert.equal(needle.style.transform, 'rotate(-90deg)');
    assert.equal(needle.style.transition, 'none');
    assert.equal(elements().current.textContent, '사용량: 0%');
    assertBadge(restored, 'chatgpt', 0, '7일');
    restored.snapshots.chatgpt.limits[0]!.resetsAt = new Date(Date.now() - 1000).toISOString();
    strip.update(restored);
    assert.equal(gauge.getAttribute('data-usage-state'), 'unknown');
    assert.equal(needle.getAttribute('visibility'), 'hidden');
    assertBadge(restored, 'chatgpt', null);
    strip.remove();
    assert.equal(gauge.isConnected, false);
  } finally { dom.window.close(); }
});

test('first and repeated tab execution failures retain cached text, progress, gauge and reset without replaying motion', () => {
  const { dom, strip, elements } = fixture();
  try {
    const current = view(63);
    current.snapshots.chatgpt.collectedAt = Date.now() - FRESH_MS;
    strip.update(current);
    const before = elements(), gauge = before.root.querySelector('.usage-gauge')!;
    const needle = gauge.querySelector<SVGGElement>('.gauge-needle')!;
    const resetLabel = before.reset.textContent;
    const observer = new dom.window.MutationObserver(() => undefined);
    observer.observe(gauge, { attributes: true, childList: true, characterData: true, subtree: true });
    for (const failures of [1, 2, 12]) {
      current.snapshots.chatgpt.state = 'error';
      current.snapshots.chatgpt.errorCode = 'tab_access_failed';
      current.snapshots.chatgpt.failures = failures;
      strip.update(current);
      const next = elements();
      assert.equal(next.host, before.host);
      assert.equal(next.progress, before.progress);
      assert.equal(next.progress.hidden, false);
      assert.equal(next.progress.value, 63);
      assert.equal(next.progress.style.getPropertyValue('--usage-color'), '#2DE5F4');
      assert.equal(next.current.textContent, '사용량: 63%');
      assertBadge(current, 'chatgpt', 63, '7일');
      assert.equal(next.reset, before.reset);
      assert.equal(next.reset.textContent, resetLabel);
      assert.equal(next.root.querySelector<HTMLElement>('.status')!.hidden, true);
      assert.equal(next.root.querySelector('.usage-gauge'), gauge);
      assert.equal(gauge.getAttribute('data-usage-state'), 'known');
      assert.equal(needle.getAttribute('visibility'), 'visible');
      assert.equal(needle.style.transform, `rotate(${-90 + 63 * 1.8}deg)`);
      assert.doesNotMatch(next.host.getAttribute('aria-label')!, /확인 불가|사이트 접근 설정|다시 확인/);
      assert.equal(observer.takeRecords().length, 0, 'An unchanged cached value must not restart gauge animation');
    }
    const collected = view(71.5); strip.update(collected);
    assert.equal(elements().host, before.host);
    assert.equal(elements().progress, before.progress);
    assert.equal(elements().progress.value, 71.5);
    assert.equal(elements().current.textContent, '사용량: 72%');
    assertBadge(collected, 'chatgpt', 71.5, '7일');
    assert.equal(elements().root.querySelector('.usage-gauge'), gauge);
    assert.equal(needle.style.transform, `rotate(${-90 + 71.5 * 1.8}deg)`);
    assert.equal(gauge.querySelector('.gauge-arc')!.getAttribute('stroke'), '#FFAE32');
    observer.disconnect();
  } finally { dom.window.close(); }
});

test('a cached tab execution failure stops displaying usage once the known reset has elapsed', () => {
  const { dom, strip, elements } = fixture();
  try {
    const current = view(63);
    current.snapshots.chatgpt.state = 'error';
    current.snapshots.chatgpt.errorCode = 'tab_access_failed';
    current.snapshots.chatgpt.failures = 3;
    strip.update(current);
    const before = elements(), gauge = before.root.querySelector('.usage-gauge')!;
    assert.equal(before.progress.hidden, false);
    current.snapshots.chatgpt.limits[0]!.resetsAt = new Date(Date.now() - 1000).toISOString();
    strip.mount();
    assert.equal(elements().progress, before.progress);
    assert.equal(elements().progress.hidden, true);
    assert.equal(elements().progress.hasAttribute('value'), false);
    assert.equal(elements().current.textContent, '사용량: 확인 불가');
    assert.equal(elements().root.querySelector('.status')!.textContent, '초기화 후 확인 중');
    assert.equal(gauge.getAttribute('data-usage-state'), 'unknown');
    assert.equal(gauge.querySelector('.gauge-needle')!.getAttribute('visibility'), 'hidden');
  } finally { dom.window.close(); }
});

test('a tab execution failure without a successful cache stays neutral and does not blame site permissions', () => {
  const { dom, strip, elements } = fixture();
  try {
    const current = view();
    current.snapshots.chatgpt = { ...emptySnapshot('chatgpt'), state: 'error', errorCode: 'tab_access_failed', failures: 1 };
    strip.update(current);
    const { host, root, progress, current: label } = elements();
    assert.equal(label.textContent, '사용량: 확인 불가');
    assert.equal(progress.hidden, true);
    assert.equal(progress.hasAttribute('value'), false);
    assert.equal(root.querySelector('.status')!.textContent, '사용량 다시 확인 중');
    assert.equal(root.querySelector('.usage-gauge')!.getAttribute('data-usage-state'), 'unknown');
    assert.equal(root.querySelector('.gauge-needle')!.getAttribute('visibility'), 'hidden');
    assert.doesNotMatch(host.getAttribute('aria-label')!, /사이트 접근 설정|사용량: 0%/);
  } finally { dom.window.close(); }
});

test('composer and badge selection keep text, title, reset, progress, needle and color on the same common bucket', () => {
  const { dom, strip, elements } = fixture();
  const now = Date.now();
  const originalNow = Date.now; Date.now = () => now;
  try {
    for (const [shortUsed, shortHours, weeklyUsed, weeklyHours, expected, hours, period] of [
      [20, 2, 85, 96, 20, 2, '5시간'], [100, 2, 70, 96, 100, 2, '5시간'], [20, 2, 100, 96, 100, 96, '7일'],
      [100, 2, 100, 96, 100, 96, '7일'], [50, null, 80, 96, 80, 96, '7일'], [90, null, 60, null, 90, null, '5시간'],
      [100, null, 100, 96, 100, null, '5시간']
    ] as const) {
      const current = view();
      const base = current.snapshots.chatgpt.limits[0]!;
      current.snapshots.chatgpt.limits = [
        { ...base, id: 'shared:primary_window', label: '5시간', windowSeconds: 18000, percent: shortUsed, resetsAt: shortHours === null ? null : new Date(now + shortHours * 3_600_000).toISOString() },
        { ...base, percent: weeklyUsed, resetsAt: weeklyHours === null ? null : new Date(now + weeklyHours * 3_600_000).toISOString() },
        { ...base, id: 'product:review:primary_window', percent: 100 }
      ];
      strip.update(current);
      const { root, progress, current: text, reset } = elements();
      assert.equal(text.textContent, `사용량: ${expected}%`);
      assertBadge(current, 'chatgpt', expected, period);
      assert.equal(progress.value, expected);
      assert.equal(progress.style.getPropertyValue('--usage-color'), expected >= 90 ? '#FF454E' : expected >= 70 ? '#FFAE32' : '#2DE5F4');
      assert.equal(reset.textContent, hours === null ? '🕒 초기화: 확인 불가' : hours === 96 ? '🕒 초기화: 4일 후' : '🕒 초기화: 2시간 후');
      assert.equal(root.querySelector<SVGGElement>('.gauge-needle')!.style.transform, `rotate(${-90 + expected * 1.8}deg)`);
      assert.equal(root.querySelector('.gauge-arc')!.getAttribute('stroke'), expected >= 90 ? '#FF454E' : expected >= 70 ? '#FFAE32' : '#2DE5F4');
      current.snapshots.chatgpt.usageInvalidated = true;
      strip.update(current);
      assert.equal(elements().progress.hidden, true);
      assert.equal(root.querySelector('.gauge-needle')!.getAttribute('visibility'), 'hidden');
      assertBadge(current, 'chatgpt', null);
    }
    const scopedOnly = view(100);
    scopedOnly.snapshots.chatgpt.limits[0]!.id = 'product:review:primary_window';
    strip.update(scopedOnly);
    assert.equal(elements().progress.hidden, true);
    assert.equal(elements().reset.textContent, '🕒 초기화: 확인 불가');
    assertBadge(scopedOnly, 'chatgpt', null);
  } finally { Date.now = originalNow; dom.window.close(); }
});

test('all four composers and badges share their provider selection, zero usage and invalidation', () => {
  const pages = { chatgpt: fixture('chatgpt'), codex: fixture('codex'), claude: fixture('claude'), gemini: fixture('gemini') };
  const now = Date.now(), originalNow = Date.now; Date.now = () => now;
  try {
    const current = view();
    current.settings.enabled = { chatgpt: true, claude: true, gemini: true };
    const base = current.snapshots.chatgpt.limits[0]!;
    const bucket = (id: string, percent: number, milliseconds: number | null, category: UsageLimit['category']): UsageLimit => ({
      ...base, id, percent, category,
      label: id === 'shared:primary_window' || id === 'five_hour' ? '5시간' : '7일',
      windowSeconds: id === 'shared:primary_window' || id === 'five_hour' ? 18000 : 604800,
      resetsAt: milliseconds === null ? null : new Date(now + milliseconds).toISOString()
    });
    current.snapshots.chatgpt.limits = [
      bucket('shared:primary_window', 20, 3 * 3_600_000, 'product'),
      bucket('shared:secondary_window', 85, 4 * 86_400_000, 'product'),
      bucket('product:review:primary_window', 100, null, 'product')
    ];
    current.snapshots.claude = { ...current.snapshots.chatgpt, provider: 'claude', limits: [
      bucket('five_hour', 80, 5 * 60_000, 'window'),
      bucket('seven_day', 100, 4 * 86_400_000, 'window'),
      bucket('seven_day_sonnet', 100, null, 'model')
    ] };
    current.snapshots.gemini = { ...current.snapshots.chatgpt, provider: 'gemini', limits: [
      bucket('five_hour', 60, 45_000, 'window'), bucket('seven_day', 90, 4 * 86_400_000, 'window')
    ] };
    const update = () => { for (const page of Object.values(pages)) page.strip.update(current); };
    const shown = (provider: PageProvider, percent: number, countdown: string, period: string) => {
      const { root, progress, current: label, reset } = pages[provider].elements();
      assert.equal(label.textContent, `사용량: ${percent}%`, provider);
      assert.equal(progress.hidden, false, provider);
      assert.equal(progress.value, percent, provider);
      assert.equal(reset.textContent, `🕒 초기화: ${countdown}`, provider);
      assert.equal(root.querySelector<SVGGElement>('.gauge-needle')!.style.transform, `rotate(${-90 + percent * 1.8}deg)`, provider);
      assert.equal(root.querySelector('.gauge-arc')!.getAttribute('stroke'), percent >= 90 ? '#FF454E' : percent >= 70 ? '#FFAE32' : '#2DE5F4', provider);
      assertBadge(current, provider, percent, period);
    };
    update();
    shown('chatgpt', 20, '3시간 후', '5시간'); shown('codex', 20, '3시간 후', '5시간');
    shown('claude', 100, '4일 후', '7일'); shown('gemini', 60, '1분 미만', '5시간');
    current.snapshots.chatgpt.limits[0]!.percent = 0;
    current.snapshots.claude.limits[1]!.percent = 70;
    update();
    shown('chatgpt', 0, '3시간 후', '5시간'); shown('codex', 0, '3시간 후', '5시간');
    shown('claude', 80, '5분 후', '5시간'); shown('gemini', 60, '1분 미만', '5시간');
    current.snapshots.claude.limits[0]!.percent = 0;
    update();
    shown('claude', 0, '5분 후', '5시간');
    current.snapshots.claude.limits[0]!.resetsAt = null;
    update();
    shown('claude', 70, '4일 후', '7일');
    Object.assign(current.snapshots.chatgpt, { usageInvalidated: true, state: 'error', errorCode: 'tab_access_failed', failures: 3 });
    update();
    for (const provider of ['chatgpt', 'codex'] as const) {
      const { root, progress, current: label, reset } = pages[provider].elements();
      assert.equal(label.textContent, '사용량: 확인 불가');
      assert.equal(progress.hidden, true);
      assert.equal(progress.hasAttribute('value'), false);
      assert.equal(reset.textContent, '🕒 초기화: 확인 불가');
      assert.equal(root.querySelector('.gauge-needle')!.getAttribute('visibility'), 'hidden');
      assert.equal(root.querySelector('.gauge-arc')!.getAttribute('stroke'), '#8893A0');
      assertBadge(current, provider, null);
    }
    shown('claude', 70, '4일 후', '7일'); shown('gemini', 60, '1분 미만', '5시간');
  } finally { Date.now = originalNow; for (const page of Object.values(pages)) page.dom.window.close(); }
});

test('an elapsed excluded feature or model reset still invalidates the complete cached snapshot', () => {
  for (const provider of ['chatgpt', 'claude'] as const) {
    const { dom, strip, elements } = fixture(provider);
    try {
      const current = view(20), base = current.snapshots.chatgpt.limits[0]!;
      current.settings.enabled[provider] = true;
      current.snapshots[provider] = { ...current.snapshots.chatgpt, provider, limits: [
        { ...base, id: provider === 'chatgpt' ? 'shared:primary_window' : 'five_hour', category: provider === 'chatgpt' ? 'product' : 'window' },
        { ...base, id: provider === 'chatgpt' ? 'product:review:primary_window' : 'seven_day_sonnet',
          category: provider === 'chatgpt' ? 'product' : 'model', percent: 100 }
      ] };
      strip.update(current);
      assert.equal(elements().progress.value, 20);
      assertBadge(current, provider, 20, '7일');
      current.snapshots[provider].limits[1]!.resetsAt = new Date(Date.now() - 1000).toISOString();
      strip.update(current);
      const { root, progress, current: label, reset } = elements();
      assert.equal(label.textContent, '사용량: 확인 불가');
      assert.equal(progress.hidden, true);
      assert.equal(reset.textContent, '🕒 초기화: 확인 불가');
      assert.equal(root.querySelector('.status')!.textContent, '초기화 후 확인 중');
      assert.equal(root.querySelector('.gauge-needle')!.getAttribute('visibility'), 'hidden');
      assertBadge(current, provider, null);
    } finally { dom.window.close(); }
  }
});
