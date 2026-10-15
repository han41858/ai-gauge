import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { bundleEntry } from './helpers/bundle';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { Message } from '../src/shared/contracts';
import type { Settings, View } from '../src/shared/types';

const { createI18n } = await import(new URL('../scripts/i18n-fixture.mjs', import.meta.url).href) as {
  createI18n(language: string): unknown;
};
const bundle = bundleEntry('src/popup/index.ts');
const html = readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function settled() { await tick(); await tick(); }
function popup(ui = 'ko-KR', settings: Settings = defaults()) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' }), doc = dom.window.document;
  const state: View = { settings: { ...structuredClone(settings), enabled: { chatgpt: true, claude: false, gemini: false } },
    permissions: { chatgpt: true, claude: false, gemini: false },
    snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') } };
  state.snapshots.chatgpt = { ...state.snapshots.chatgpt, state: 'ok', checkedAt: Date.now(), collectedAt: Date.now(),
    limits: [{ id: 'week', label: '7일', percent: 42, category: 'window', windowSeconds: 604800,
      resetsAt: new Date(Date.now() + 10 * 86400_000).toISOString(), remaining: null, unit: null, source: 'api' }] };
  const messages: Message[] = [];
  let changed: (...args: unknown[]) => void = () => {}, save: (() => Promise<void>) | null = null;
  Object.assign(dom.window, { structuredClone, chrome: {
    i18n: createI18n(ui),
    runtime: { getManifest: () => ({ version: '1.0.0' }), sendMessage: async (message: Message) => {
      messages.push(structuredClone(message));
      if (message.type === 'display-settings') {
        await save?.();
        Object.assign(state.settings, { strips: structuredClone(message.strips), language: message.language,
          warning: message.warning, danger: message.danger });
      }
      return { ok: true, view: structuredClone(state) };
    } }, storage: { onChanged: { addListener(listener: () => void) { changed = listener; } } }
  } });
  dom.window.eval(bundle);
  const field = (id: string) => doc.getElementById(id) as HTMLInputElement;
  const input = (id: string, value: string) => { field(id).value = value; field(id).dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const change = (id: string, value?: string) => {
    if (value !== undefined) input(id, value);
    field(id).dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  const saves = () => messages.filter((m): m is Extract<Message, { type: 'display-settings' }> => m.type === 'display-settings');
  return { dom, doc, state, messages, field, input, change, saves,
    notify: () => changed({ 'settings:v2': {} }, 'local'), saveWith: (fn: () => Promise<void>) => { save = fn; } };
}

test('language changes autosave and relocalize static text, cards, accessibility and existing controls in place', async () => {
  const p = popup();
  try {
    await settled();
    const language = p.doc.getElementById('language') as HTMLSelectElement;
    assert.equal(p.doc.querySelector('#settings-form button'), null);
    assert.equal(language.value, 'system');
    assert.deepEqual([...language.options].map(option => [option.value, option.text]), [
      ['system', '시스템 기본 언어'], ['en', '영어'], ['ko', '한국어']
    ]);
    assert.equal(p.doc.documentElement.lang, 'ko');
    const checkbox = p.field('strip-chatgpt');
    p.doc.getElementById('diagnostics-feedback')!.textContent = '이전 복사 안내';
    p.change('language', 'en'); await settled();
    assert.equal(p.state.settings.language, 'en');
    assert.equal(p.doc.documentElement.lang, 'en');
    assert.equal(p.doc.querySelector('#preferences summary')!.textContent, 'Settings');
    assert.equal(p.doc.querySelector('[data-provider="chatgpt"] .percent')!.textContent, 'Usage: 42%');
    assert.equal(p.doc.querySelector('[data-provider="chatgpt"]')!.getAttribute('aria-label'), 'ChatGPT usage');
    assert.equal(p.field('strip-chatgpt'), checkbox, 'translation must retain the original checkbox and focus');
    assert.equal(checkbox.parentElement!.textContent, 'Show below ChatGPT input');
    assert.equal(p.doc.getElementById('settings-feedback')!.textContent, 'Settings saved.');
    assert.equal(p.doc.getElementById('diagnostics-feedback')!.textContent, '');
    assert.deepEqual([...language.options].map(option => option.text), ['System default', 'English', 'Korean']);
    p.change('language', 'ko'); await settled();
    assert.equal(p.doc.documentElement.lang, 'ko');
    assert.equal(p.doc.getElementById('settings-feedback')!.textContent, '설정을 저장했습니다.');
    p.change('language', 'system'); await settled();
    assert.equal(p.state.settings.language, 'system'); assert.equal(p.doc.documentElement.lang, 'ko');
    assert.equal(p.saves().length, 3);
  } finally { p.dom.window.close(); }
});

test('saved preference survives popup reopening and System default follows Chrome UI rather than the previous override', async () => {
  const p = popup('en-US', { ...defaults(), language: 'ko' });
  let stored: Settings;
  try {
    await settled();
    assert.equal(p.field('language').value, 'ko'); assert.equal(p.doc.documentElement.lang, 'ko');
    p.change('language', 'system'); await settled();
    assert.equal(p.doc.documentElement.lang, 'en');
    p.change('language', 'ko'); await settled(); stored = structuredClone(p.state.settings);
  } finally { p.dom.window.close(); }
  const reopened = popup('de-DE', stored!);
  try {
    await settled();
    assert.equal(reopened.doc.documentElement.lang, 'ko'); assert.equal(reopened.field('language').value, 'ko');
    assert.equal(reopened.saves().length, 0, 'opening a popup must not resave preferences');
  } finally { reopened.dom.window.close(); }
});

test('failed language autosave keeps the saved language and draft selection for a later retry', async () => {
  const p = popup();
  try {
    await settled();
    p.saveWith(async () => { throw new Error('worker disconnected'); });
    p.change('language', 'en'); await settled();
    assert.equal(p.state.settings.language, 'system'); assert.equal(p.doc.documentElement.lang, 'ko');
    assert.equal(p.field('language').value, 'en');
    assert.match(p.doc.getElementById('feedback')!.textContent!, /통신할 수 없습니다/);
    p.notify(); await settled();
    assert.equal(p.field('language').value, 'en'); assert.equal(p.doc.documentElement.lang, 'ko');
    p.saveWith(async () => {}); p.change('language'); await settled();
    assert.equal(p.doc.documentElement.lang, 'en'); assert.equal(p.state.settings.language, 'en');
  } finally { p.dom.window.close(); }
});

test('rapid changes during an in-flight save coalesce to the latest selection without overwriting new drafts', async () => {
  const p = popup(); let release: (() => void) | undefined;
  try {
    await settled();
    p.saveWith(() => new Promise(resolve => { release = resolve; }));
    p.change('language', 'en'); await settled(); assert(release);
    p.change('language', 'ko'); p.change('language', 'system');
    p.field('strip-claude').checked = false; p.change('strip-claude');
    p.input('gauge-warning', '65');
    p.notify(); p.saveWith(async () => {}); release(); await settled(); await settled();
    assert.deepEqual(p.saves().map(message => message.language), ['en', 'system']);
    assert.equal(p.state.settings.language, 'system'); assert.equal(p.doc.documentElement.lang, 'ko');
    assert.equal(p.state.settings.strips.claude, false);
    assert.equal(p.field('language').value, 'system');
    assert.equal(p.field('gauge-warning').value, '65', 'an uncommitted numeric draft survives the earlier save reply');
    assert.equal(p.state.settings.warning, 70);
    p.change('gauge-warning'); await settled(); assert.equal(p.state.settings.warning, 65);
  } finally { release?.(); p.dom.window.close(); }
});

test('invalid threshold drafts do not block independent language and checkbox autosaves or persist invalid numbers', async () => {
  const p = popup();
  try {
    await settled();
    p.input('gauge-warning', '101'); p.change('gauge-warning'); await settled();
    assert.equal(p.saves().length, 0); assert.equal(p.field('gauge-warning').getAttribute('aria-invalid'), 'true');
    p.change('language', 'en'); await settled();
    assert.equal(p.doc.documentElement.lang, 'en');
    assert.equal(p.state.settings.warning, 70); assert.equal(p.field('gauge-warning').value, '101');
    assert.equal(p.field('gauge-warning').getAttribute('aria-invalid'), 'true');
    assert.match(p.doc.getElementById('settings-feedback')!.textContent!, /0.*100/);
    p.field('strip-codex').checked = false; p.change('strip-codex'); await settled();
    assert.equal(p.state.settings.strips.codex, false); assert.equal(p.state.settings.warning, 70);
    assert.equal(p.saves().length, 2);
    p.change('gauge-warning', '60'); await settled();
    assert.equal(p.state.settings.warning, 60); assert.equal(p.field('gauge-warning').getAttribute('aria-invalid'), null);
  } finally { p.dom.window.close(); }
});

test('threshold input waits for a valid committed change or Enter, while checkboxes save immediately', async () => {
  const p = popup();
  try {
    await settled();
    p.input('gauge-warning', '55'); await settled(); assert.equal(p.saves().length, 0);
    const enter = new p.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    p.field('gauge-warning').dispatchEvent(enter); await settled();
    assert.equal(enter.defaultPrevented, true); assert.equal(p.saves().length, 1); assert.equal(p.state.settings.warning, 55);
    p.input('gauge-danger', '40');
    p.field('gauge-danger').dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settled(); assert.equal(p.saves().length, 1); assert.equal(p.state.settings.danger, 90);
    assert.equal(p.doc.activeElement, p.field('gauge-warning'), 'explicit Enter validation can focus the first invalid threshold');
    p.change('gauge-danger', '80'); await settled(); assert.equal(p.state.settings.danger, 80);
    p.field('strip-chatgpt').checked = false; p.change('strip-chatgpt'); await settled();
    assert.equal(p.state.settings.strips.chatgpt, false); assert.equal(p.saves().length, 3);
  } finally { p.dom.window.close(); }
});

test('a numeric draft preserves only edited fields while external settings stay synchronized and survive the next autosave', async () => {
  const p = popup();
  try {
    await settled();
    p.input('gauge-warning', '');
    p.state.settings.language = 'en';
    p.state.settings.strips.codex = false;
    p.state.settings.warning = 60; p.state.settings.danger = 85;
    p.notify(); await settled();
    assert.equal(p.field('gauge-warning').value, '', 'keep the locally edited numeric draft');
    assert.equal(p.field('gauge-danger').value, '85', 'an untouched threshold follows the latest saved setting');
    assert.equal(p.doc.documentElement.lang, 'en'); assert.equal(p.field('language').value, 'en');
    assert.equal(p.field('strip-codex').checked, false);
    p.field('strip-claude').checked = false; p.change('strip-claude'); await settled();
    assert.equal(p.saves().at(-1)!.language, 'en');
    assert.equal(p.saves().at(-1)!.strips.codex, false);
    assert.equal(p.state.settings.warning, 60); assert.equal(p.state.settings.danger, 85);
    assert.equal(p.field('gauge-warning').value, '');
    p.change('language', 'ko'); await settled();
    assert.equal(p.doc.documentElement.lang, 'ko');
    p.state.settings.language = 'en'; p.state.settings.strips.gemini = false;
    p.notify(); await settled();
    assert.equal(p.field('language').value, 'en', 'a saved field stops being dirty even while the invalid numeric draft remains');
    assert.equal(p.field('strip-gemini').checked, false);
    p.field('strip-chatgpt').checked = false; p.change('strip-chatgpt'); await settled();
    assert.equal(p.state.settings.language, 'en');
    assert.equal(p.state.settings.strips.gemini, false);
  } finally { p.dom.window.close(); }
});
