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
  settings.enabled.work_codex = true;
  const now = Date.now();
  return {
    settings,
    permissions: { chatgpt: true, work_codex: true, claude: true },
    snapshots: {
      chatgpt: {
        ...emptySnapshot('chatgpt'), state: 'ok', collectedAt: now, checkedAt: now,
        errorCode: null, limits: [{ ...limit('chat-feature', '채팅 기능', 0), percent: null, remaining: 78 }]
      },
      work_codex: {
        ...emptySnapshot('work_codex'), state: 'ok', collectedAt: now, checkedAt: now,
        errorCode: null, limits: [limit('weekly', '7일', 15)]
      },
      claude: emptySnapshot('claude')
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
    assert.doesNotMatch(text, /Chat|GPT|Work|Codex|공유|AI Gauge|78 남음|15% 남음/);
  } finally { dom.window.close(); }
});

test('disabling the experimental ChatGPT collector does not hide an enabled plan pool', () => {
  const dom = fixture();
  try {
    const view = enabledView();
    view.settings.enabled.chatgpt = false;
    new UsageStrip('chatgpt', dom.window.document).update(view);
    assert.match(stripLabel(dom.window.document), /사용량: 15%/);
  } finally { dom.window.close(); }
});

test('disabling the plan collector removes the general chat strip without falling back to chat quotas', () => {
  const dom = fixture();
  try {
    const view = enabledView(), strip = new UsageStrip('chatgpt', dom.window.document);
    strip.update(view);
    assert(dom.window.document.getElementById('ai-gauge-usage-strip'));
    view.settings.enabled.work_codex = false;
    strip.update(view);
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
  } finally { dom.window.close(); }
});

test('general chat placement obeys its own strip preference independently of the Codex placement', () => {
  const dom = fixture();
  try {
    const view = enabledView(), strip = new UsageStrip('chatgpt', dom.window.document);
    view.settings.strips.chatgpt = false;
    strip.update(view);
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    view.settings.strips.chatgpt = true;
    view.settings.strips.work_codex = false;
    strip.update(view);
    assert.match(stripLabel(dom.window.document), /사용량: 15%/);
  } finally { dom.window.close(); }
});

test('the general chat strip uses the highest actual usage even if an old preference selected another limit', () => {
  const dom = fixture();
  try {
    const view = enabledView();
    view.snapshots.work_codex.limits.push(limit('other-window', '다른 기간', 32));
    view.settings.selectedLimit.work_codex = 'weekly';
    view.settings.selectedLimit.chatgpt = 'chat-feature';
    new UsageStrip('chatgpt', dom.window.document).update(view);
    assert.match(stripLabel(dom.window.document), /사용량: 32%/);
    assert.doesNotMatch(stripLabel(dom.window.document), /15%|78 남음/);
  } finally { dom.window.close(); }
});

test('showing one plan snapshot in ChatGPT and Codex neither changes nor adds the usage data', () => {
  const chat = fixture(), codex = fixture('/codex');
  try {
    const view = enabledView(), original = structuredClone(view);
    const chatStrip = new UsageStrip('chatgpt', chat.window.document);
    const codexStrip = new UsageStrip('work_codex', codex.window.document);
    chatStrip.update(view);
    codexStrip.update(view);
    for (let i = 0; i < 3; i++) { chatStrip.mount(); codexStrip.mount(); }
    assert.match(stripLabel(chat.window.document), /사용량: 15%/);
    assert.equal(stripLabel(chat.window.document), stripLabel(codex.window.document));
    assert.doesNotMatch(stripLabel(chat.window.document), /30%|78 남음|93%/);
    assert.deepEqual(view, original, 'displaying the shared snapshot must not rewrite either stored dataset');
  } finally { chat.window.close(); codex.window.close(); }
});

test('a missing plan snapshot cannot be replaced with a successful chat quota or fabricated zero', () => {
  const dom = fixture();
  try {
    const view = enabledView();
    view.snapshots.work_codex = emptySnapshot('work_codex');
    new UsageStrip('chatgpt', dom.window.document).update(view);
    assert(dom.window.document.getElementById('ai-gauge-usage-strip'));
    assert.match(stripLabel(dom.window.document), /^사용량: 확인 불가  🕒 사용량 초기화: 확인 불가/);
    assert.doesNotMatch(stripLabel(dom.window.document), /78 남음|0%|최근 수집 성공/);
  } finally { dom.window.close(); }
});

test('removing the plan data permission removes the general chat display', () => {
  const dom = fixture();
  try {
    const view = enabledView(), strip = new UsageStrip('chatgpt', dom.window.document);
    strip.update(view);
    assert(dom.window.document.getElementById('ai-gauge-usage-strip'));
    view.permissions.work_codex = false;
    strip.update(view);
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
  } finally { dom.window.close(); }
});
