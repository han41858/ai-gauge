import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleEntry } from './helpers/bundle';
import { JSDOM } from 'jsdom';
import { bindDiagnostics, createDiagnosticReport } from '../src/popup/diagnostics';
import { renderCards } from '../src/popup/render';
import { PROVIDERS, type View } from '../src/shared/types';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';

const popupHtml = readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
const view = (): View => ({
  settings: { ...defaults(), enabled: { chatgpt: true, claude: true, gemini: true } },
  permissions: { chatgpt: true, claude: true, gemini: true },
  snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') }
});
const actions = { enable() {}, disable() {}, revoke() {}, refresh() {}, select() {} };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('diagnostic report includes only version and allowlisted provider status fields', () => {
  const v = view();
  v.snapshots.claude.errorCode = 'tab_access_failed';
  v.snapshots.claude.checkedAt = 1700000000000;
  v.settings.strips.codex = false;
  v.snapshots.chatgpt.errorCode = 'open_tab';
  v.snapshots.claude.limits = [{ id: 'private-limit', label: 'private-label', category: 'model', percent: 17, remaining: 20, unit: 'private-unit', windowSeconds: null, resetsAt: null, source: 'api' }];
  Object.assign(v, { url: 'https://private.invalid/account', account: 'private-account', token: 'private-token', dom: 'private-prompt' });
  const report = createDiagnosticReport(v, '0.1.3');
  assert.deepEqual(Object.keys(report), ['extensionVersion', 'providers', 'strips']);
  assert.deepEqual(Object.keys(report.providers), [...PROVIDERS]);
  for (const p of PROVIDERS) assert.deepEqual(Object.keys(report.providers[p]).sort(), ['enabled', 'permission', 'state', 'errorCode', 'checkedAt', 'collectedAt', 'nextAttemptAt'].sort());
  assert.deepEqual(report.strips, { chatgpt: true, codex: false, claude: true, gemini: true });
  assert.equal(report.providers.claude.errorCode, 'tab_access_failed');
  assert.equal(report.providers.chatgpt.errorCode, 'open_tab');
  assert.equal(report.providers.claude.checkedAt, 1700000000000);
  assert.doesNotMatch(JSON.stringify(report), /private|limits|label|token|account|url|dom|percent|remaining/i);
});

test('popup preserves a collection error while timestamps remain available only in diagnostics', () => {
  const dom = new JSDOM('<div id="cards"></div>'), v = view(), at = 1700000000000;
  try {
    v.snapshots.claude.checkedAt = at;
    v.snapshots.claude.errorCode = 'tab_access_failed';
    renderCards(dom.window.document.getElementById('cards')!, v, actions, at + 1);
    const card = dom.window.document.querySelector('[data-provider="claude"]')!;
    assert(card.textContent!.includes('사이트 접근 설정 확인'));
    assert.equal(card.querySelector('details,select,.time'), null);
    assert.doesNotMatch(card.textContent!, /정상 수집 기록 없음|마지막 정상 수집:|최근 수집 성공|확인 시도|다음 갱신/);
    const report = createDiagnosticReport(v, 'fixture');
    assert.equal(report.providers.claude.checkedAt, at);
    assert.equal(report.providers.claude.collectedAt, null);
    assert.equal(report.providers.claude.errorCode, 'tab_access_failed');
  } finally { dom.window.close(); }
});

test('diagnostic details remain collapsed and generate fresh local status only on a button click', () => {
  const dom = new JSDOM(popupHtml), v = view(), doc = dom.window.document;
  try {
    bindDiagnostics(doc, () => v, '0.1.3');
    const output = doc.getElementById('diagnostics-output') as HTMLTextAreaElement;
    assert.equal((doc.getElementById('diagnostics') as HTMLDetailsElement).open, false);
    assert.equal(output.hidden, true); assert.equal(output.value, ''); assert.equal(output.readOnly, true);
    v.snapshots.claude.errorCode = 'tab_access_failed';
    doc.getElementById('diagnostics-show')!.click();
    assert.equal(output.hidden, false);
    assert.equal(JSON.parse(output.value).providers.claude.errorCode, 'tab_access_failed');
    v.snapshots.claude.errorCode = 'open_tab';
    doc.getElementById('diagnostics-show')!.click();
    assert.equal(JSON.parse(output.value).providers.claude.errorCode, 'open_tab');
  } finally { dom.window.close(); }
});

test('explicit diagnostic copy writes only the current allowlisted report', async () => {
  const dom = new JSDOM(popupHtml), v = view(), doc = dom.window.document;
  let copied = '';
  try {
    bindDiagnostics(doc, () => v, '0.1.3', async text => { copied = text; });
    doc.getElementById('diagnostics-copy')!.click();
    await flush();
    assert.deepEqual(JSON.parse(copied), createDiagnosticReport(v, '0.1.3'));
    assert.equal(doc.getElementById('diagnostics-feedback')!.textContent, '진단 정보를 복사했습니다.');
  } finally { dom.window.close(); }
});

test('clipboard failure selects the readonly diagnostic report for manual copying', async () => {
  const dom = new JSDOM(popupHtml), doc = dom.window.document;
  try {
    bindDiagnostics(doc, () => view(), '0.1.3', async () => { throw new Error('clipboard denied'); });
    doc.getElementById('diagnostics-copy')!.click();
    await flush();
    const output = doc.getElementById('diagnostics-output') as HTMLTextAreaElement;
    assert.equal(output.readOnly, true); assert.equal(output.hidden, false);
    assert.equal(doc.activeElement, output);
    assert.equal(output.selectionStart, 0); assert.equal(output.selectionEnd, output.value.length);
    assert.match(doc.getElementById('diagnostics-feedback')!.textContent!, /직접 복사/);
  } finally { dom.window.close(); }
});

test('diagnostic action without a worker view does not invent or copy a report', async () => {
  const dom = new JSDOM(popupHtml), doc = dom.window.document;
  let copied = false;
  try {
    bindDiagnostics(doc, () => null, '0.1.3', async () => { copied = true; });
    doc.getElementById('diagnostics-copy')!.click();
    await flush();
    assert.equal(copied, false);
    assert.equal((doc.getElementById('diagnostics-output') as HTMLTextAreaElement).hidden, true);
    assert.match(doc.getElementById('diagnostics-feedback')!.textContent!, /상태를 아직 읽지 못했습니다/);
  } finally { dom.window.close(); }
});

for (const manifest of [{ version: '9.8.7' }, { version: '2026.10.14.1805', version_name: '202610141805' }]) {
test(`popup bundle uses installed display version ${manifest.version_name ?? manifest.version} in its footer and diagnostics`, async () => {
  const dom = new JSDOM(popupHtml, { runScripts: 'outside-only' }), doc = dom.window.document;
  const installedVersion = manifest.version_name ?? manifest.version;
  try {
    Object.assign(dom.window, { chrome: {
      runtime: { getManifest: () => manifest, sendMessage: async () => ({ ok: true, view: view() }) },
      storage: { onChanged: { addListener() {} } }
    } });
    const bundle = bundleEntry('src/popup/index.ts');
    dom.window.eval(bundle);
    await flush();
    assert.equal(doc.getElementById('extension-version')!.textContent, `AI Gauge ${installedVersion}`);
    assert.equal(doc.querySelectorAll('.card').length, 3);
    doc.getElementById('diagnostics-show')!.click();
    assert.equal(JSON.parse((doc.getElementById('diagnostics-output') as HTMLTextAreaElement).value).extensionVersion, installedVersion);
  } finally { dom.window.close(); }
});
}
