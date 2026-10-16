import assert from 'node:assert/strict';

const notify = `for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`;
const labels = {
  en: { usage: 'Usage: 42%', strip: 'Show below ChatGPT input', error: 'Sign in required', threshold: 'The caution threshold must be lower than the warning threshold.', action: 'Open official usage settings (new tab)', reset: '🕒 Resets in 4 hours', ticket: '🎫 Ticket expires in 2 days', progress: 'Usage' },
  ko: { usage: '사용량: 42%', strip: 'ChatGPT 입력창에 표시', error: '로그인 필요', threshold: '주의 시작 사용률은 경고 시작 사용률보다 작아야 합니다.', action: '공식 사용량 관리 화면 열기 (새 탭)', reset: '🕒 초기화: 4시간 후', ticket: '🎫 티켓 만료: 2일 후', progress: '사용량' }
};

export async function checkPopupLanguagePreferences({ cdp, session, evaluate, waitFor, language }) {
  const system = language.startsWith('ko') ? 'ko' : 'en';
  const select = async preference => {
    const expected = preference === 'system' ? system : preference;
    await evaluate(`{const field=document.getElementById('language');field.value=${JSON.stringify(preference)};field.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await waitFor(`window.__fixture.settings.language===${JSON.stringify(preference)}&&document.documentElement.lang===${JSON.stringify(expected)}`, `Language ${preference} did not apply immediately on ${language} Chrome UI`);
  };
  await evaluate(`document.getElementById('preferences').open=true;window.__savedClaudeForLanguage=structuredClone(window.__fixture.snapshots.claude);Object.assign(window.__fixture.snapshots.claude,{state:'error',errorCode:'signed_out',failures:2});${notify}`);
  await waitFor(`!!document.querySelector('[data-provider="claude"] .status')`, 'The popup authentication error did not render');
  await evaluate(`document.getElementById('gauge-warning').value='90';document.getElementById('gauge-warning').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gauge-danger').value='70';document.getElementById('gauge-danger').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gauge-warning').dispatchEvent(new Event('change',{bubbles:true}));`);
  assert.equal(await evaluate('(window.__displaySettingsRequests??[]).length'), 0, 'Invalid thresholds are not persisted');
  for (const preference of ['ko', 'en', 'system']) {
    const expected = preference === 'system' ? system : preference, text = labels[expected];
    await select(preference);
    assert.equal(await evaluate(`document.querySelector('[data-provider="chatgpt"] .percent').textContent`), text.usage);
    assert.equal(await evaluate(`document.querySelector('#strip-settings label').textContent`), text.strip);
    assert.equal(await evaluate(`document.querySelector('[data-provider="claude"] .status').textContent`), text.error);
    assert.equal(await evaluate(`document.getElementById('settings-feedback').textContent`), text.threshold, 'An existing validation error follows the new display language');
    assert(await evaluate(`document.querySelector('[data-provider="chatgpt"] .ticket-info').getAttribute('aria-label').includes(${JSON.stringify(text.action)})`), 'The popup ticket action is translated accessibly');
    assert.deepEqual(await evaluate('[window.__fixture.settings.warning,window.__fixture.settings.danger]'), [70,90], 'A language choice persists without saving an invalid numeric draft');
    assert.deepEqual(await evaluate("[document.getElementById('gauge-warning').valueAsNumber,document.getElementById('gauge-danger').valueAsNumber]"), [90,70], 'Invalid draft values remain visible for correction');
    assert.equal(await evaluate(`document.querySelectorAll('#settings-form button').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('[data-provider="chatgpt"] .ticket-expiry').length`), 2, 'Switching language preserves individual ticket expiry entries');
    for (const width of [600,390,320]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
      assert(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'), `Selected ${expected} preferences overflow at ${width}px`);
    }
    if (expected === 'en') assert.doesNotMatch(await evaluate('document.body.innerText'), /[가-힣]/, 'An explicit English choice overrides Korean Chrome catalogs everywhere');
  }
  await evaluate(`document.getElementById('gauge-warning').value='70';document.getElementById('gauge-warning').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gauge-danger').value='90';document.getElementById('gauge-danger').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gauge-danger').dispatchEvent(new Event('change',{bubbles:true}));window.__fixture.snapshots.claude=window.__savedClaudeForLanguage;${notify}`);
  await waitFor(`!document.querySelector('[aria-invalid="true"]')&&!document.querySelector('[data-provider="claude"] .status')`, 'Corrected thresholds and restored usage did not render');
  const override = system === 'ko' ? 'en' : 'ko';
  await select(override);
  // Reopening a popup receives persisted settings from the mocked worker, not
  // the previous popup's in-memory translation state.
  const saved = await evaluate('window.__fixture.settings');
  const restore = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__fixture.settings=${JSON.stringify(saved)};window.__languageReopened=true;` }, session);
  try {
    await cdp('Page.reload', {}, session);
    await waitFor(`window.__languageReopened&&document.readyState==='complete'&&document.querySelectorAll('.card').length===3&&document.documentElement.lang===${JSON.stringify(override)}&&document.getElementById('language').value===${JSON.stringify(override)}`, 'A reopened popup did not use the saved explicit language');
    assert.equal(await evaluate('chrome.i18n.getUILanguage()'), language, 'The saved preference overrides the unchanged Chrome UI language');
    await select('system');
  } finally {
    await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: restore.identifier }, session);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate(`document.getElementById('preferences').open=false;`);
}

export async function checkStripLanguagePreferences({ evaluate, waitFor, language, pageLanguage }) {
  const system = language.startsWith('ko') ? 'ko' : 'en';
  await evaluate(`window.__languageNodes={host:document.getElementById('ai-gauge-usage-strip'),gauge:window.__fixtureUsageRoot.querySelector('.usage-gauge'),progress:window.__fixtureUsageRoot.querySelector('progress'),ticket:window.__fixtureUsageRoot.querySelector('.tickets')};window.__languageSnapshots=JSON.stringify(window.__fixture.snapshots);window.__languageGaugeMutations=0;window.__languageGaugeObserver=new MutationObserver(records=>window.__languageGaugeMutations+=records.length);window.__languageGaugeObserver.observe(window.__languageNodes.gauge,{attributes:true,subtree:true,childList:true});`);
  try {
    for (const preference of ['ko','en','system']) {
      const expected = preference === 'system' ? system : preference, text = labels[expected];
      await evaluate(`window.__fixture.settings.language=${JSON.stringify(preference)};${notify}`);
      await waitFor(`document.getElementById('ai-gauge-usage-strip').lang===${JSON.stringify(expected)}`, `The existing strip did not apply saved ${preference}`);
      assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.current>span').textContent`), text.usage);
      assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.reset').textContent`), text.reset);
      assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').textContent`), text.ticket);
      assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('progress').getAttribute('aria-label')`), text.progress);
      assert(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').getAttribute('aria-label').includes(${JSON.stringify(text.action)})`), 'The ticket link accessibility text changes with its visible label');
      assert(await evaluate(`document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes(${JSON.stringify(text.reset)})`), 'The strip live-region label follows the selected language');
      assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__languageNodes.host&&window.__fixtureUsageRoot.querySelector('.usage-gauge')===window.__languageNodes.gauge&&window.__fixtureUsageRoot.querySelector('progress')===window.__languageNodes.progress&&window.__fixtureUsageRoot.querySelector('.tickets')===window.__languageNodes.ticket`), 'Language updates retain the existing strip, gauge, progress and ticket nodes');
      assert.equal(await evaluate('window.__languageGaugeMutations'), 0, 'A language-only update does not mutate or restart the SVG needle/arc');
      assert.equal(await evaluate('document.documentElement.lang'), pageLanguage, 'The host page language remains untouched');
      assert(await evaluate(`JSON.stringify(window.__fixture.snapshots)===window.__languageSnapshots`), 'Usage, plan and ticket snapshots are unchanged by language selection');
    }
  } finally {
    await evaluate('window.__languageGaugeObserver.disconnect()');
  }
}
