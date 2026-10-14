import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { UsageStrip } from '../src/content/usage-strip';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { UsageLimit, View } from '../src/shared/types';

const limit = (id: string, label: string, percent: number): UsageLimit => ({
  id, label, category: 'window', percent, resetsAt: null, windowSeconds: 604800,
  remaining: null, unit: null, source: 'api'
});
const enabledView = (): View => {
  const settings = defaults();
  settings.enabled.chatgpt = true;
  const now = Date.now();
  return {
    settings,
    permissions: { chatgpt: true, claude: true, gemini: true },
    snapshots: {
      chatgpt: {
        ...emptySnapshot('chatgpt'), state: 'ok', collectedAt: now, checkedAt: now,
        errorCode: null, limits: [limit('weekly', '7일', 15)]
      },
      claude: emptySnapshot('claude'),
      gemini: emptySnapshot('gemini')
    }
  };
};
const fixture = (path = '/') => new JSDOM(
  '<main><form id="composer"><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form><p>Footer</p></main>',
  { url: `https://chatgpt.com${path}` }
);
const stripLabel = (doc: Document) => doc.getElementById('ai-gauge-usage-strip')?.getAttribute('aria-label') ?? '';

test('ChatGPT composer shows the plan pool with only the requested usage title and used percentage', () => {
  const dom = fixture();
  try {
    const doc = dom.window.document;
    new UsageStrip('chatgpt', doc).update(enabledView());
    const host = doc.getElementById('ai-gauge-usage-strip');
    assert(host, 'the plan pool is visible in the general chat composer');
    assert.equal(doc.getElementById('composer')!.nextElementSibling, host);
    const text = stripLabel(doc);
    assert.match(text, /^사용량: 15%  🕒 사용량 초기화:/);
    assert.doesNotMatch(text, /Chat|GPT|Work|Codex|공유|AI Gauge|15% 남음/);
  } finally { dom.window.close(); }
});

test('disabling other providers does not hide the enabled ChatGPT usage', () => {
  const dom = fixture();
  try {
    const view = enabledView();
    view.settings.enabled.claude = true;
    view.settings.enabled.gemini = true;
    const strip = new UsageStrip('chatgpt', dom.window.document);
    strip.update(view);
    const host = dom.window.document.getElementById('ai-gauge-usage-strip');
    assert(host);
    view.settings.enabled.claude = false;
    view.settings.enabled.gemini = false;
    strip.update(view);
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), host);
    assert.match(stripLabel(dom.window.document), /사용량: 15%/);
  } finally { dom.window.close(); }
});

test('disabling the ChatGPT collector removes both ChatGPT and Codex strips', () => {
  const chat = fixture(), codex = fixture('/codex');
  try {
    const view = enabledView();
    const strips = [new UsageStrip('chatgpt', chat.window.document), new UsageStrip('codex', codex.window.document)];
    for (const strip of strips) strip.update(view);
    for (const dom of [chat, codex]) assert(dom.window.document.getElementById('ai-gauge-usage-strip'));
    view.settings.enabled.chatgpt = false;
    for (const strip of strips) strip.update(view);
    for (const dom of [chat, codex]) assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
  } finally { chat.window.close(); codex.window.close(); }
});

test('general chat placement obeys its own strip preference independently of the Codex placement', () => {
  const dom = fixture();
  try {
    const view = enabledView(), strip = new UsageStrip('chatgpt', dom.window.document);
    view.settings.strips.chatgpt = false;
    strip.update(view);
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    view.settings.strips.chatgpt = true;
    view.settings.strips.codex = false;
    strip.update(view);
    assert.match(stripLabel(dom.window.document), /사용량: 15%/);
  } finally { dom.window.close(); }
});

test('the general chat strip uses the highest actual usage even if an old preference selected another limit', () => {
  const dom = fixture();
  try {
    const view = enabledView();
    view.snapshots.chatgpt.limits.push(limit('other-window', '다른 기간', 32));
    view.settings.selectedLimit.chatgpt = 'weekly';
    new UsageStrip('chatgpt', dom.window.document).update(view);
    assert.match(stripLabel(dom.window.document), /사용량: 32%/);
    assert.doesNotMatch(stripLabel(dom.window.document), /15%/);
  } finally { dom.window.close(); }
});

test('showing one plan snapshot in ChatGPT and Codex neither changes nor adds the usage data', () => {
  const chat = fixture(), codex = fixture('/codex');
  try {
    const view = enabledView(), original = structuredClone(view);
    const chatStrip = new UsageStrip('chatgpt', chat.window.document);
    const codexStrip = new UsageStrip('codex', codex.window.document);
    chatStrip.update(view);
    codexStrip.update(view);
    for (let i = 0; i < 3; i++) { chatStrip.mount(); codexStrip.mount(); }
    assert.match(stripLabel(chat.window.document), /사용량: 15%/);
    assert.equal(stripLabel(chat.window.document), stripLabel(codex.window.document));
    assert.doesNotMatch(stripLabel(chat.window.document), /30%/);
    assert.deepEqual(view, original, 'displaying the same ChatGPT snapshot must not rewrite or duplicate stored usage');
  } finally { chat.window.close(); codex.window.close(); }
});

test('a missing ChatGPT snapshot cannot be replaced with another provider or fabricated zero', () => {
  const dom = fixture();
  try {
    const view = enabledView();
    view.snapshots.claude = { ...view.snapshots.chatgpt, provider: 'claude' };
    view.snapshots.gemini = { ...view.snapshots.chatgpt, provider: 'gemini' };
    view.snapshots.chatgpt = emptySnapshot('chatgpt');
    new UsageStrip('chatgpt', dom.window.document).update(view);
    assert(dom.window.document.getElementById('ai-gauge-usage-strip'));
    assert.match(stripLabel(dom.window.document), /^사용량: 확인 불가  🕒 사용량 초기화: 확인 불가/);
    assert.doesNotMatch(stripLabel(dom.window.document), /15%|0%|최근 수집 성공/);
  } finally { dom.window.close(); }
});

test('removing the plan data permission removes the general chat display', () => {
  const dom = fixture();
  try {
    const view = enabledView(), strip = new UsageStrip('chatgpt', dom.window.document);
    strip.update(view);
    assert(dom.window.document.getElementById('ai-gauge-usage-strip'));
    view.permissions.chatgpt = false;
    strip.update(view);
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
  } finally { dom.window.close(); }
});
