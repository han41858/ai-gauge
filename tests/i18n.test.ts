import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import type * as I18n from '../src/shared/i18n';
const { createI18n } = await import(new URL('../scripts/i18n-fixture.mjs', import.meta.url).href) as {
  createI18n(language?: string): { getUILanguage(): string; getMessage(key: string, substitutions?: string | string[]): string };
};
const source = buildSync({ entryPoints: ['src/shared/i18n.ts'], bundle: true, write: false, format: 'cjs', target: 'chrome120' }).outputFiles![0]!.text;
function load(api?: ReturnType<typeof createI18n>): typeof I18n {
  const module = { exports: {} };
  runInNewContext(source, { module, exports: module.exports, ...(api ? { chrome: { i18n: api } } : {}),
    navigator: { language: 'ko-KR', languages: ['ko-KR'] } });
  return module.exports as typeof I18n;
}

test('only Korean Chrome UI locales select Korean regardless of navigator or page language', () => {
  for (const [language, expected] of [['ko', 'ko'], ['ko-KR', 'ko'], ['KO-kr', 'ko'],
    ['en-US', 'en'], ['ja', 'en'], ['fr-CA', 'en'], ['', 'en'], ['kok', 'en']] as const) {
    const i18n = load(createI18n(language));
    assert.equal(i18n.uiLanguage(), expected);
    assert.equal(i18n.t('popup_settings'), expected === 'ko' ? '설정' : 'Settings');
  }
});

test('English defaults and unavailable message fallbacks still substitute values safely', () => {
  const noAPI = load();
  assert.equal(noAPI.uiLanguage(), 'en');
  assert.equal(noAPI.t('popup_settings'), 'Settings');
  const emptyMessage = load({ getUILanguage: () => 'en', getMessage: () => '' });
  assert.equal(emptyMessage.t('format_usage', '42%'), 'Usage: 42%');
  assert.equal(emptyMessage.t('popup_provider_plan', ['<img>$2', '$1']), '<img>$2 plan: $1');
  assert.equal(load(createI18n('ko')).t('popup_provider_plan', ['ChatGPT', 'Pro 100']), 'ChatGPT 요금제: Pro 100');
});

test('saved language overrides Chrome UI and switching back to system restores its language', () => {
  for (const chromeLanguage of ['ko-KR', 'en-US', 'fr']) {
    const api = createI18n(chromeLanguage), i18n = load(api);
    const systemLanguage = chromeLanguage === 'ko-KR' ? 'ko' : 'en';
    assert.equal(i18n.uiLanguage(), systemLanguage);
    i18n.setLanguagePreference('en');
    assert.equal(i18n.uiLanguage(), 'en');
    assert.equal(i18n.t('popup_settings'), 'Settings');
    i18n.setLanguagePreference('ko');
    assert.equal(i18n.uiLanguage(), 'ko');
    assert.equal(i18n.t('popup_settings'), '설정');
    assert.equal(i18n.t('popup_provider_plan', ['<model>$2', '$1']), '<model>$2 요금제: $1');
    assert.equal(api.getUILanguage(), chromeLanguage, 'the extension never changes Chrome UI language');
    i18n.setLanguagePreference('system');
    assert.equal(i18n.uiLanguage(), systemLanguage);
    assert.equal(i18n.t('popup_settings'), systemLanguage === 'ko' ? '설정' : 'Settings');
  }
});

test('document localization preserves controls and treats all translations as text', () => {
  const dom = new JSDOM('<html lang="ja"><body><label><span data-i18n="popup_warning_threshold"></span><input id="threshold"></label><textarea data-i18n-aria-label="diagnostics_output_label"></textarea><div data-i18n="missing_key">Keep</div></body></html>');
  try {
    const doc = dom.window.document, control = doc.getElementById('threshold');
    load(createI18n('ko')).localizeDocument(doc);
    assert.equal(doc.documentElement.lang, 'ko');
    assert.equal(doc.querySelector('label span')!.textContent, '주의 시작 사용률');
    assert.equal(doc.getElementById('threshold'), control);
    assert.equal(doc.querySelector('textarea')!.getAttribute('aria-label'), '로컬 진단 정보');
    assert.equal(doc.querySelector('div')!.textContent, 'Keep');
    load({ getUILanguage: () => 'en', getMessage: () => '<img src=x onerror=alert(1)>' }).localizeDocument(doc);
    assert.equal(doc.querySelector('label span')!.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(doc.querySelector('img'), null);
    assert.equal(doc.getElementById('threshold'), control);
  } finally { dom.window.close(); }
});
