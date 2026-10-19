import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGaugeMatchesUsage } from './gauge-checks.mjs';

// Gemini placement, progress updates, failure state and permission revocation.
export async function runGeminiChecks({ cdp, session, evaluate, pause, waitForPlacement, content }) {
  // Gemini uses its own snapshot through the same content bundle. This DOM is
  // synthetic and does not validate the current authenticated service layout.
  await evaluate(`chrome.runtime.sendMessage=window.__fixtureSend;window.__fixtureHost='https://gemini.google.com';history.replaceState(null,'','/app');document.body.innerHTML='<main><div id="gemini-slot"><input-area-v2 id="gemini-composer" style="display:block;padding:12px;border:1px solid gray;border-radius:16px"><rich-textarea style="display:block"><div role="textbox" class="ql-editor textarea" contenteditable="true" style="min-height:48px">private Gemini prompt</div></rich-textarea><div id="gemini-toolbar" role="toolbar"><button type="button">Attach</button><button type="button" aria-label="Send message">Send</button></div></input-area-v2><p id="gemini-helper" hidden>Shortcut hints</p></div></main>';`);
  await evaluate(content);
  await waitForPlacement('gemini-composer');
  await evaluate(`window.__geminiStrip=document.getElementById('ai-gauge-usage-strip');window.__geminiProgress=window.__fixtureUsageRoot.querySelector('progress');`);
  await evaluate(content);
  assert(await evaluate(`document.querySelectorAll('#ai-gauge-usage-strip').length===1&&window.__geminiProgress.value===0&&document.querySelector('rich-textarea [contenteditable]').textContent==='private Gemini prompt'&&document.querySelectorAll('#gemini-toolbar button').length===2`), 'Gemini reuses one strip and earliest-reset common limit without changing its input or controls');
  assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.reset').textContent`), '🕒 초기화: 1시간 후', 'Gemini uses the same largest-unit Korean reset countdown');
  assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets')`), null, 'Gemini has no ticket link');
  const geminiDiagnostic = await evaluate(`new Promise(resolve=>{for(const fn of window.__runtimeListeners)fn({type:'display-diagnostics'},{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve)})`);
  assert.equal(geminiDiagnostic.provider, 'gemini'); assert.equal(geminiDiagnostic.targetFound, true);
  assert.equal(geminiDiagnostic.stripVisible, true); assert.equal(geminiDiagnostic.stripCount, 1);
  for (let i = 0; i < 12; i++) {
    await evaluate(`document.getElementById('gemini-helper').hidden=${i % 2 === 0};document.getElementById('gemini-composer').className='render-${i % 2}';`);
    await pause(350);
    await waitForPlacement('gemini-composer');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__geminiStrip&&window.__fixtureUsageRoot.querySelector('progress')===window.__geminiProgress`), 'Gemini helper changes retain the same strip and progress node');
  }
  await evaluate(`window.__fixture.snapshots.gemini.limits.find(limit=>limit.id==='gemini:1').percent=42.25;window.__fixture.snapshots.gemini.collectedAt=Date.now();for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__geminiProgress.value===42.25')) break; await pause(50); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__geminiProgress&&window.__geminiProgress.value===42.25&&window.__geminiStrip.getAttribute('aria-label').includes('사용량: 42%')`), 'Gemini fractional usage changes update the existing bar even with unchanged rounded text');
  await evaluate(`window.__fixture.snapshots.gemini.limits.find(limit=>limit.id==='gemini:1').percent=63;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__geminiProgress.value===63')) break; await pause(50); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__geminiProgress&&window.__geminiProgress.value===63&&window.__geminiStrip.getAttribute('aria-label').includes('사용량: 63%')`), 'Gemini runtime invalidation updates its own visible usage');
  await checkGaugeMatchesUsage(evaluate,pause);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`window.__geminiStrip.getBoundingClientRect().height===30&&getComputedStyle(window.__fixtureUsageRoot.querySelector('.reset')).display==='none'&&document.documentElement.scrollWidth<=document.documentElement.clientWidth`), 'Narrow Gemini strip retains the shared 30px height without overflow');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  const geminiScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-gemini-strip-fixture.png'), Buffer.from(geminiScreenshot.data, 'base64'));
  await evaluate(`window.__fixture.snapshots.gemini.state='error';window.__fixture.snapshots.gemini.errorCode='network';window.__fixture.snapshots.gemini.failures=2;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__geminiProgress.hidden')) break; await pause(50); }
  assert(await evaluate(`window.__geminiProgress.hidden&&window.__geminiStrip.getAttribute('aria-label').includes('확인 불가')&&!window.__geminiStrip.getAttribute('aria-label').includes('사용량: 0%')`), 'Gemini collection errors do not fabricate an unused quota');
  await evaluate(`window.__fixture.permissions.gemini=false;chrome.runtime.sendMessage=async()=>({ok:false});for(const fn of window.__runtimeListeners)fn({type:'permissions-revoked',origins:['https://gemini.google.com/*']},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length') === 0) break; await pause(50); }
  assert.equal(await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'), 0);
  assert.equal(await evaluate('window.__aiGaugeMounted'), false);
  assert.equal(await evaluate(`document.querySelector('rich-textarea [contenteditable]').textContent`), 'private Gemini prompt');
}
