import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleEntry } from './helpers/bundle';
import { JSDOM } from 'jsdom';
import { checkUsageThresholds, defaults, isSettings, parseSettings, parseUsageThresholds } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { Message } from '../src/shared/contracts';
import type { View } from '../src/shared/types';

const bundle = bundleEntry('src/popup/index.ts');
const html = readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function settled() { await flush(); await flush(); }
function popup() {
  const dom = new JSDOM(html, { runScripts: 'outside-only' }), doc = dom.window.document;
  const state: View = { settings: { ...defaults(), enabled: { chatgpt: true, claude: false, gemini: false } },
    permissions: { chatgpt: true, claude: false, gemini: false },
    snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') } };
  const messages: Message[] = [];
  let changed: (...args: unknown[]) => void = () => {}, save: (() => Promise<void>) | null = null;
  Object.assign(dom.window, { structuredClone, chrome: {
    runtime: { getManifest: () => ({ version: '1.0.0' }), sendMessage: async (message: Message) => {
      messages.push(structuredClone(message));
      assert.notEqual(message.type, 'settings', 'popup must send only display fields');
      if (message.type === 'display-settings') {
        await save?.();
        Object.assign(state.settings, { strips: structuredClone(message.strips), language: message.language, warning: message.warning, danger: message.danger });
      }
      return { ok: true, view: structuredClone(state) };
    } }, storage: { onChanged: { addListener(listener: () => void) { changed = listener; } } }
  } });
  dom.window.eval(bundle);
  const input = (id: string) => doc.getElementById(id) as HTMLInputElement;
  const edit = (id: string, value: string) => { input(id).value = value; input(id).dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const submit = () => input('gauge-danger').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  return { dom, doc, state, messages, input, edit, submit, notify: () => changed({ 'settings:v2': {} }, 'local'), saveWith: (fn: () => Promise<void>) => { save = fn; } };
}

test('gauge thresholds accept ordered percentages from 0 to 100, including fractions, and recover corrupt stored pairs together', () => {
  for (const [warning, danger] of [[0, 100], [0, 0.5], [1, 99], [70, 90], [70.5, 90.25], [99.9, 100]]) {
    assert.deepEqual(parseUsageThresholds(warning, danger), { warning, danger });
    assert(isSettings({ ...defaults(), warning, danger }));
    assert.equal(parseSettings({ ...defaults(), warning, danger }).warning, warning);
  }
  for (const [warning, danger] of [[-1, 90], [70, 100.5], [-0.01, 90], [90, 90], [91, 90], [NaN, 90], [70, Infinity],
    ['70', 90], [70, null], [undefined, 90]]) {
    assert.equal(parseUsageThresholds(warning, danger), null);
    const source = { ...defaults(), enabled: { chatgpt: true, claude: false, gemini: true }, warning, danger };
    assert.equal(isSettings(source), false);
    const migrated = parseSettings(source);
    assert.equal(migrated.warning, 70); assert.equal(migrated.danger, 90);
    assert.deepEqual(migrated.enabled, source.enabled, 'repair must not change collector activation');
  }
});

test('threshold checks report the failing fields and whether the cause is range or order', () => {
  assert.deepEqual(checkUsageThresholds(-1, 90), { ok: false, reason: 'range', fields: ['warning'] });
  assert.deepEqual(checkUsageThresholds(70, 101), { ok: false, reason: 'range', fields: ['danger'] });
  assert.deepEqual(checkUsageThresholds(NaN, '90'), { ok: false, reason: 'range', fields: ['warning', 'danger'] });
  assert.deepEqual(checkUsageThresholds(90, 90), { ok: false, reason: 'order', fields: ['warning', 'danger'] });
  assert.deepEqual(checkUsageThresholds(70.5, 90), { ok: true, value: { warning: 70.5, danger: 90 } });
});

test('invalid gauge autosaves explain the error without stealing focus or saving visibility or thresholds', async () => {
  const p = popup();
  try {
    await settled();
    assert.equal(p.input('gauge-warning').value, '70'); assert.equal(p.input('gauge-danger').value, '90');
    for (const [warning, danger, focused] of [['-1', '90', 'gauge-warning'], ['70', '101', 'gauge-danger'],
      ['70', '100.5', 'gauge-danger'], ['', '90', 'gauge-warning'], ['90', '90', 'gauge-warning'], ['91', '90', 'gauge-warning']]) {
      p.edit('gauge-warning', warning!); p.edit('gauge-danger', danger!);
      p.input('strip-chatgpt').checked = false;
      p.input('gauge-danger').focus();
      p.submit(); await settled();
      assert.match(p.doc.getElementById('settings-feedback')!.textContent!, /0~100.*숫자|작아야 합니다/);
      assert.equal(p.doc.getElementById('settings-feedback')!.getAttribute('role'), 'alert');
      assert.equal(p.input(focused!).getAttribute('aria-invalid'), 'true');
      assert.equal(p.input(focused!).getAttribute('aria-describedby'), 'settings-feedback');
      assert.equal(p.doc.activeElement, p.input('gauge-danger'), 'validation on change must allow focus to move to the next field');
      assert.equal(p.messages.filter(message => message.type === 'display-settings').length, 0);
      assert.equal(p.state.settings.strips.chatgpt, true);
      assert.equal(p.state.settings.warning, 70); assert.equal(p.state.settings.danger, 90);
    }
  } finally { p.dom.window.close(); }
});

test('a valid display save submits visibility and both thresholds together while leaving unrelated settings alone', async () => {
  const p = popup();
  try {
    await settled();
    const before = structuredClone(p.state.settings);
    p.edit('gauge-warning', '55.5'); p.edit('gauge-danger', '85');
    p.input('strip-codex').checked = false;
    p.submit(); await settled();
    const expected = { type: 'display-settings', strips: { ...before.strips, codex: false }, language: 'system', warning: 55.5, danger: 85 };
    assert.deepEqual(p.messages.filter(message => message.type === 'display-settings'), [expected]);
    assert.deepEqual(p.state.settings, { ...before, strips: expected.strips, warning: 55.5, danger: 85 });
    assert.equal(p.input('gauge-warning').getAttribute('aria-invalid'), null);
    assert.equal(p.doc.getElementById('settings-feedback')!.textContent, '설정을 저장했습니다.');
  } finally { p.dom.window.close(); }
});

test('popup progress recolors immediately after autosave and external threshold changes without collecting usage', async () => {
  const p = popup();
  try {
    await settled();
    const now = Date.now();
    Object.assign(p.state.snapshots.chatgpt, { state: 'ok', errorCode: null, collectedAt: now, checkedAt: now,
      limits: [{ id: 'shared:primary_window', label: '5시간', category: 'product', percent: 17.25,
        windowSeconds: 18000, resetsAt: new Date(now + 3_600_000).toISOString(), remaining: null, unit: null, source: 'api' }] });
    const color = () => p.doc.querySelector('progress')!.style.getPropertyValue('--usage-color');
    p.notify(); await settled();
    assert.equal(color(), '#2DE5F4');
    const initialMessages = p.messages.length;
    p.edit('gauge-warning', '17.25'); p.submit(); await settled();
    assert.equal(color(), '#FFAE32');
    p.edit('gauge-warning', '10.5'); p.edit('gauge-danger', '17.25'); p.submit(); await settled();
    assert.equal(color(), '#FF454E');
    p.state.settings.warning = 70; p.state.settings.danger = 90;
    p.notify(); await settled();
    assert.equal(color(), '#2DE5F4');
    assert.equal(p.doc.querySelector('progress')!.value, 17.25);
    assert.deepEqual(p.messages.slice(initialMessages).map(message => message.type), ['display-settings', 'display-settings', 'read']);
  } finally { p.dom.window.close(); }
});

test('failed saves and incoming cache updates retain unsaved gauge input for correction or retry', async () => {
  const p = popup();
  try {
    await settled();
    p.saveWith(async () => { throw new Error('worker disconnected'); });
    p.edit('gauge-warning', '60'); p.edit('gauge-danger', '80');
    p.submit(); await settled();
    assert.match(p.doc.getElementById('feedback')!.textContent!, /통신할 수 없습니다/);
    assert.equal(p.state.settings.warning, 70);
    p.notify(); await settled();
    assert.equal(p.input('gauge-warning').value, '60'); assert.equal(p.input('gauge-danger').value, '80');
    p.saveWith(async () => {}); p.submit(); await settled();
    assert.equal(p.state.settings.warning, 60); assert.equal(p.state.settings.danger, 80);
  } finally { p.dom.window.close(); }
});

test('editing again while a display save is pending retains the newer draft after storage invalidation', async () => {
  const p = popup(); let release: (() => void) | undefined;
  try {
    await settled();
    p.saveWith(() => new Promise(resolve => { release = resolve; }));
    p.edit('gauge-warning', '60'); p.edit('gauge-danger', '85'); p.submit();
    await settled(); assert(release);
    p.edit('gauge-warning', '65'); p.notify(); release(); await settled(); await settled();
    assert.equal(p.state.settings.warning, 60);
    assert.equal(p.input('gauge-warning').value, '65', 'older save reply must not replace a newer user edit');
    assert.equal(p.input('gauge-danger').value, '85');
    assert.equal(p.doc.getElementById('settings-feedback')!.textContent, '');
    p.saveWith(async () => {}); p.submit(); await settled();
    assert.equal(p.state.settings.warning, 65);
  } finally { release?.(); p.dom.window.close(); }
});
