import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderCards, type Actions } from '../src/popup/render';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import { success } from '../src/background/scheduler';
import { PROVIDERS, type Provider, type View } from '../src/shared/types';

const now = 1_800_000_000_000;
const labels = { chatgpt: 'Pro 200', claude: 'Max 20x', gemini: 'AI Pro' };
const view = (): View => ({
  settings: { ...defaults(), enabled: { chatgpt: true, claude: true, gemini: true } },
  permissions: { chatgpt: true, claude: true, gemini: true },
  snapshots: Object.fromEntries(PROVIDERS.map(provider => [provider, {
    ...success(emptySnapshot(provider), [{ id: 'week', label: '7일', category: 'window', percent: 25,
      resetsAt: new Date(now + 7 * 86_400_000).toISOString(), windowSeconds: 604800,
      remaining: null, unit: null, source: 'api' }], now),
    plan: { label: labels[provider], checkedAt: now }
  }])) as View['snapshots']
});
const noop: Actions = { enable() {}, disable() {}, revoke() {} };
const fixture = () => {
  const dom = new JSDOM('<main id="cards"></main>');
  return { dom, cards: dom.window.document.getElementById('cards')! };
};
const planText = (cards: HTMLElement, provider: Provider) => cards.querySelector(`[data-provider="${provider}"] .plan-badge`)?.textContent;

test('popup adds one compact plan badge next to each service title without creating a Codex card', () => {
  const { dom, cards } = fixture(), v = view(), original = structuredClone(v);
  try {
    renderCards(cards, v, noop, now);
    assert.deepEqual([...cards.querySelectorAll('h2')].map(title => title.textContent), ['ChatGPT', 'Claude', 'Gemini']);
    assert.equal(cards.querySelectorAll('.card-heading').length, 3);
    assert.equal(cards.querySelectorAll('.plan-badge').length, 3);
    for (const provider of PROVIDERS) {
      const card = cards.querySelector(`[data-provider="${provider}"]`)!;
      assert.equal(card.querySelector('h2')?.nextElementSibling?.textContent, labels[provider]);
      assert.equal(planText(cards, provider), labels[provider]);
      assert.match(card.querySelector('.plan-badge')!.getAttribute('aria-label')!, /요금제:/);
      assert.equal(card.querySelector('progress')?.value, 25);
      assert.equal(card.querySelectorAll('.actions button').length, 2);
    }
    assert.equal(cards.querySelector('[data-provider="codex"]'), null);
    assert.deepEqual(v, original);
  } finally { dom.window.close(); }
});

test('missing or unsupported plan metadata renders no badge while successful usage stays visible', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    delete v.snapshots.chatgpt.plan;
    v.snapshots.claude.plan = null;
    v.snapshots.gemini.plan = { label: 'unverified_plan_9', checkedAt: now };
    renderCards(cards, v, noop, now);
    for (const provider of PROVIDERS) {
      assert.equal(planText(cards, provider), undefined);
      assert.equal(cards.querySelector(`[data-provider="${provider}"] progress`)?.getAttribute('value'), '25');
      assert.equal(cards.querySelector(`[data-provider="${provider}"] .status`), null);
    }
    assert.equal(cards.querySelectorAll('.plan-badge').length, 0);
    assert.doesNotMatch(cards.textContent!, /확인 불가|unverified_plan_9/);
    assert.deepEqual([...cards.querySelectorAll('h2')].map(title => title.textContent), ['ChatGPT', 'Claude', 'Gemini']);
  } finally { dom.window.close(); }
});

test('subscription changes replace the plan badge and a subsequent missing result clears the old label', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    renderCards(cards, v, noop, now);
    for (const provider of PROVIDERS) {
      v.snapshots[provider] = { ...v.snapshots[provider], collectedAt: now + 60_000, checkedAt: now + 60_000,
        plan: { label: 'Free', checkedAt: now + 60_000 } };
    }
    renderCards(cards, v, noop, now + 60_000);
    assert.deepEqual(PROVIDERS.map(provider => planText(cards, provider)), ['Free', 'Free', 'Free']);
    for (const provider of PROVIDERS) v.snapshots[provider].plan = null;
    renderCards(cards, v, noop, now + 60_000);
    assert.deepEqual(PROVIDERS.map(provider => planText(cards, provider)), [undefined, undefined, undefined]);
    assert.equal(cards.querySelectorAll('.plan-badge').length, 0);
    assert.equal(cards.querySelectorAll('progress').length, 3);
  } finally { dom.window.close(); }
});

test('stale or mismatched plan checks clear badges without treating normally aged usage as stale', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    renderCards(cards, v, noop, now + 601_000);
    assert.deepEqual(PROVIDERS.map(provider => planText(cards, provider)), [undefined, undefined, undefined]);
    assert.equal(cards.querySelector('.status'), null);
    assert.equal(cards.querySelectorAll('progress').length, 3);
    for (const provider of PROVIDERS) v.snapshots[provider].plan!.checkedAt = now - 60_000;
    renderCards(cards, v, noop, now);
    assert.deepEqual(PROVIDERS.map(provider => planText(cards, provider)), [undefined, undefined, undefined]);
  } finally { dom.window.close(); }
});

test('disabled, revoked and signed-out services never display a previously cached plan', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    v.settings.enabled.chatgpt = false;
    v.permissions.claude = false;
    v.snapshots.gemini.state = 'signed_out';
    v.snapshots.gemini.errorCode = 'signed_out';
    renderCards(cards, v, noop, now);
    assert.deepEqual(PROVIDERS.map(provider => planText(cards, provider)), [undefined, undefined, undefined]);
  } finally { dom.window.close(); }
});

test('untrusted plan text cannot create markup or executable attributes in popup cards', () => {
  const { dom, cards } = fixture(), v = view();
  try {
    for (const provider of PROVIDERS) v.snapshots[provider].plan!.label = '<img src=x onerror="alert(1)">';
    renderCards(cards, v, noop, now);
    assert.deepEqual(PROVIDERS.map(provider => planText(cards, provider)), [undefined, undefined, undefined]);
    assert.equal(cards.querySelector('img,script,[onerror],[onclick]'), null);
    assert.equal(cards.querySelectorAll('progress').length, 3);
  } finally { dom.window.close(); }
});
