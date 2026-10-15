import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { UsageStrip } from '../src/content/usage-strip';
import { usageParts } from '../src/content/usage-label';
import { defaults } from '../src/storage/settings';
import { emptySnapshot, FRESH_MS } from '../src/storage/snapshots';
import type { View } from '../src/shared/types';

function view(percent: number | null = 17): View {
  const settings = defaults(); settings.enabled.chatgpt = true;
  const now = Date.now();
  return { settings, permissions: { chatgpt: true, gemini: true, claude: true }, snapshots: {
    gemini: emptySnapshot('gemini'), claude: emptySnapshot('claude'),
    chatgpt: { ...emptySnapshot('chatgpt'), state: 'ok', collectedAt: now, checkedAt: now, errorCode: null,
      limits: [{ id: 'weekly', label: '7일', category: 'window', percent, resetsAt: new Date(now + 49 * 3_600_000).toISOString(),
        windowSeconds: 604800, remaining: null, unit: null, source: 'api' }] }
  } };
}

function fixture() {
  const dom = new JSDOM('<main><form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form></main>', { url: 'https://chatgpt.com/' });
  const roots = new Map<HTMLElement, ShadowRoot>();
  const original = dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow = function(this: HTMLElement, options: ShadowRootInit) {
    const root = original.call(this, options); roots.set(this, root); return root;
  };
  const doc = dom.window.document, strip = new UsageStrip('chatgpt', doc);
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
      strip.update(view(value));
      const { host, progress, current } = elements();
      assert.equal(host.shadowRoot, null);
      assert.equal(progress.hidden, false);
      assert.equal(progress.max, 100);
      assert.equal(progress.value, value);
      assert.equal(progress.getAttribute('value'), String(value));
      assert.equal(progress.getAttribute('aria-label'), '사용량');
      assert.equal(current.textContent, `사용량: ${Math.round(value)}%`);
    }
  } finally { dom.window.close(); }
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
    current.snapshots.chatgpt.limits.push({ ...current.snapshots.chatgpt.limits[0]!, id: 'five-hour', percent: 84 });
    strip.update(current);
    const before = elements(), gauge = before.root.querySelector('.usage-gauge')!;
    const needle = gauge.querySelector<SVGGElement>('.gauge-needle')!, arc = gauge.querySelector('.gauge-arc')!;
    assert.equal(before.root.querySelector('img.brand-icon'), null);
    assert.equal(before.root.querySelectorAll('svg.brand-icon').length, 1);
    assert.equal(before.current.previousElementSibling, gauge);
    assert.equal(before.current.textContent, '사용량: 84%');
    assert.equal(before.progress.value, 84);
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
    current.snapshots.chatgpt.failures = 2;
    strip.update(current);
    assert.equal(gauge.getAttribute('data-usage-state'), 'unknown');
    assert.equal(needle.getAttribute('visibility'), 'hidden');
    assert.equal(gauge.querySelector('.gauge-arc')!.getAttribute('stroke'), '#8893A0');
    assert.equal(elements().progress.hidden, true);
    assert.equal(elements().current.textContent, '사용량: 확인 불가');
    const restored = view(0); strip.update(restored);
    assert.equal(elements().root.querySelector('.usage-gauge'), gauge);
    assert.equal(needle.getAttribute('visibility'), 'visible');
    assert.equal(needle.style.transform, 'rotate(-90deg)');
    assert.equal(needle.style.transition, 'none');
    assert.equal(elements().current.textContent, '사용량: 0%');
    restored.snapshots.chatgpt.limits[0]!.resetsAt = new Date(Date.now() - 1000).toISOString();
    strip.update(restored);
    assert.equal(gauge.getAttribute('data-usage-state'), 'unknown');
    assert.equal(needle.getAttribute('visibility'), 'hidden');
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
      assert.equal(next.current.textContent, '사용량: 63%');
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
