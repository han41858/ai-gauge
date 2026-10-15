import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Popup: cards, plan badges, tickets, settings, diagnostics and first-run selection.
export async function runPopupChecks({ cdp, session, evaluate, pause, port, buildLabel, exceptions }) {
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/popup.html` }, session);
  let state;
  for (let i = 0; i < 100; i++) { state = await evaluate('({cards:document.querySelectorAll(".card").length,text:document.body?.textContent??"",width:document.documentElement?.scrollWidth??0,clientWidth:document.documentElement?.clientWidth??0})'); if (state.cards === 3) break; await pause(100); }
  assert.equal(state.cards, 3, JSON.stringify({state,exceptions})); assert.match(state.text, /42%/); assert.match(state.text, /0%/); assert.doesNotMatch(state.text, /오래된 데이터|오래된 정보|입력창에는|최근 수집 성공|Work \/ Codex 공유/); assert(state.width <= state.clientWidth);
  assert.doesNotMatch(state.text, /새로고침|사이트 열기/);
  assert(await evaluate(`Array.from(document.querySelectorAll('.card h2')).every(title=>{const link=title.querySelector('a'),s=link&&getComputedStyle(link),h=getComputedStyle(title);return link&&s.color===h.color&&s.fontSize===h.fontSize&&s.fontWeight===h.fontWeight&&s.textDecorationLine==='none'&&s.cursor==='pointer'&&link.target==='_blank'&&link.rel==='noopener noreferrer';})`), 'Service title links keep the existing heading appearance and pointer cursor');
  for (const [provider, href] of Object.entries({ chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/' })) {
    await evaluate(`{const link=document.querySelector('[data-provider="${provider}"] h2 a');window.__providerActivated=null;link.addEventListener('click',event=>{event.preventDefault();window.__providerActivated=link.href;},{once:true});link.focus();}`);
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
    assert.equal(await evaluate('window.__providerActivated'), href, 'Service title keyboard activation opens the fixed official home URL (navigation prevented in fixture)');
  }
  await evaluate('document.activeElement.blur()');
  assert(await evaluate(`(()=>{const card=document.querySelector('[data-provider="claude"]');return card.querySelector('.percent').textContent==='사용량: 0%'&&card.querySelector('progress').value===0&&!card.querySelector('.status');})()`), 'Popup keeps a valid 15-minute-old cached value through one network failure without an age-only warning');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.card .plan-badge')].map(badge=>badge.textContent)`), ['Pro 200', 'AI Pro']);
  assert(await evaluate(`Array.from(document.querySelectorAll('.card-heading')).every(heading=>{const title=heading.querySelector('h2'),badge=heading.querySelector('.plan-badge');if(!badge)return title.nextElementSibling===null;const a=title.getBoundingClientRect(),b=badge.getBoundingClientRect();return title.nextElementSibling===badge&&b.left-a.right>=7&&Math.abs((a.top+a.height/2)-(b.top+b.height/2))<1&&b.height<=22;})`), 'Each compact plan badge sits beside its service title without moving the existing usage layout');
  assert.equal(await evaluate('document.getElementById("extension-version").textContent'), `AI Gauge ${buildLabel}`);
  assert.equal(await evaluate('Math.round(document.body.getBoundingClientRect().width)'), 600);
  assert(await evaluate(`document.body.getBoundingClientRect().height<=600`), 'The default three-service popup fits the Chrome popup height');
  await evaluate(`window.__savedLimits=structuredClone(Object.fromEntries(['chatgpt','claude'].map(p=>[p,window.__fixture.snapshots[p].limits])));for(const p of ['chatgpt','claude']){const s=window.__fixture.snapshots[p];s.limits.push({...s.limits[0],id:'extra-weekly',label:'주간',windowSeconds:604800,resetsAt:new Date(Date.now()+7*86400000).toISOString()});}for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('.card .limit').length===6`)) break; await pause(50); }
  const compactHeight = await evaluate('Math.ceil(document.body.getBoundingClientRect().height)');
  assert(compactHeight <= 600, `Six usage windows and four individual tickets need no popup scroll: ${compactHeight}px`);
  assert(await evaluate(`Array.from(document.querySelectorAll('.card-heading')).every(h=>{const name=h.querySelector('.provider-name').getBoundingClientRect(),actions=h.querySelector('.actions').getBoundingClientRect();return actions.left>=name.right&&Math.abs((name.top+name.height/2)-(actions.top+actions.height/2))<1;})`), 'Service controls share the title row in the wide popup');
  await evaluate(`for(const p of ['chatgpt','claude'])window.__fixture.snapshots[p].limits=window.__savedLimits[p];for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('.card .limit').length===4`)) break; await pause(50); }
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.ticket-info')].map(link=>({href:link.href,target:link.target,rel:link.rel,tabIndex:link.tabIndex,text:link.querySelector('.ticket-count').textContent}))`), [
    { href: 'https://chatgpt.com/settings/usage?tab=overview', target: '_blank', rel: 'noopener noreferrer', tabIndex: 0, text: '🎫 초기화 티켓 2개' },
    { href: 'https://claude.ai/new#settings/usage', target: '_blank', rel: 'noopener noreferrer', tabIndex: 0, text: '🎫 초기화 티켓 2개' }
  ], 'Compact popup exposes held tickets only for ChatGPT and Claude as official native links');
  assert.doesNotMatch(state.text, /지금 사용 가능/);
  assert(await evaluate(`['chatgpt','claude'].every(provider=>{const link=document.querySelector('[data-provider="'+provider+'"] .ticket-info'),rows=[...link.querySelectorAll('.ticket-expiry')];return rows.length===2&&rows.every((row,i)=>{const date=new Date(window.__fixture.snapshots[provider].tickets.inventory.grants[i].expiresAt),label=(date.getMonth()+1)+'/'+date.getDate()+'('+['일','월','화','수','목','금','토'][date.getDay()]+') '+String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0')+' 만료';return row.textContent===label&&link.getAttribute('aria-label').includes(label);});})`), 'Popup presents each local expiry with its weekday, without a redundant single-ticket count, including accessible labels');
  assert.equal(await evaluate(`document.querySelector('[data-provider="chatgpt"] .percent').textContent`), '사용량: 42%');
  assert.equal(await evaluate(`document.querySelector('[data-provider="chatgpt"] .limit-line > :first-child').textContent`), '7일', 'The ChatGPT card title is not repeated in the usage window label');
  assert.match(await evaluate(`document.querySelector('[data-provider="chatgpt"] .reset').textContent`), /^🕒 사용량 초기화: \d{1,2}\/\d{1,2}\([일월화수목금토]\) \d{2}:\d{2}, \d+h 남음$/);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-provider="gemini"] .limit-line')].map(row=>row.textContent)`), ['5시간사용량: 0%', '주간사용량: 42%']);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-provider="gemini"] h2'),'::before').backgroundColor`), 'rgb(53, 105, 200)');
  assert(await evaluate(`(()=>{const img=document.querySelector('header img');return img.complete&&img.naturalWidth===128&&img.getBoundingClientRect().width===28})()`), 'Popup displays the supplied PNG');
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Popup overflow at ${width}px`);
  }
  await evaluate(`window.__fixture.snapshots.gemini.plan=null;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelector('[data-provider="gemini"] .plan-badge')===null`)) break; await pause(50); }
  assert.equal(await evaluate(`document.querySelector('[data-provider="gemini"] .plan-badge')===null`), true, 'A missing policy result removes the previous Gemini plan badge');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-provider="gemini"] progress')].map(bar=>bar.value)`), [0, 42], 'Plan failure does not clear or change successful quota values');
  await evaluate(`{const s=window.__fixture.snapshots.gemini;s.collectedAt=s.checkedAt=Date.now();s.plan={label:'AI Ultra',checkedAt:s.collectedAt};for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');}`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelector('[data-provider="gemini"] .plan-badge')?.textContent`) === 'AI Ultra') break; await pause(50); }
  assert.equal(await evaluate(`document.querySelector('[data-provider="gemini"] .plan-badge')?.textContent`), 'AI Ultra', 'A newly collected plan replaces the old label without duplicate badges');
  assert.equal(await evaluate(`document.querySelectorAll('.plan-badge').length`), 2);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("preferences").open=true');
  assert.equal(await evaluate("document.querySelectorAll('#settings-form button').length"), 0, 'Preferences apply automatically without a save button');
  assert.deepEqual(await evaluate("[...document.getElementById('language').options].map(option=>[option.value,option.textContent])"), [['system','시스템 기본 언어'],['en','영어'],['ko','한국어']]);
  assert.equal(await evaluate("document.getElementById('language').value"), 'system');
  assert.deepEqual(await evaluate("[document.getElementById('gauge-warning').valueAsNumber,document.getElementById('gauge-danger').valueAsNumber]"), [70,90]);
  await evaluate("document.getElementById('gauge-warning').value='90';document.getElementById('gauge-danger').value='70';document.getElementById('gauge-warning').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gauge-warning').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await evaluate('(window.__displaySettingsRequests??[]).length'), 0, 'An inverted threshold pair is not saved');
  assert(await evaluate("document.querySelector('[aria-invalid=\"true\"]')!==null"), 'Invalid thresholds expose an accessible error');
  await evaluate('document.getElementById("gauge-warning").value="40";document.getElementById("gauge-danger").value="60";document.getElementById("gauge-danger").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("gauge-danger").dispatchEvent(new Event("change",{bubbles:true}))');
  for(let i=0;i<20;i++){if(await evaluate('window.__fixture.settings.warning===40&&window.__fixture.settings.danger===60'))break;await pause(50);}
  assert.deepEqual(await evaluate('[window.__fixture.settings.warning,window.__fixture.settings.danger]'),[40,60], 'Valid custom thresholds save on change without form submission');
  await evaluate('document.getElementById("strip-claude").click()');
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__fixture.settings.strips.claude') === false) break; await pause(100); }
  assert.equal(await evaluate('window.__fixture.settings.strips.claude'), false);
  assert.equal(await evaluate('window.__fixture.settings.warning'), 40, 'Saving display preferences includes the custom gauge warning threshold');
  await evaluate("document.getElementById('gauge-warning').focus();document.getElementById('gauge-warning').select()");
  await cdp('Input.insertText', { text: '62' }, session);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
  assert.equal(await evaluate('document.activeElement.id'), 'gauge-danger', 'An invalid pair does not trap keyboard focus during automatic validation');
  assert.deepEqual(await evaluate('[window.__fixture.settings.warning,window.__fixture.settings.danger]'), [40,60], 'An intermediate invalid value is not saved');
  await evaluate('document.activeElement.select()');
  await cdp('Input.insertText', { text: '65' }, session);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
  for(let i=0;i<20;i++){if(await evaluate('window.__fixture.settings.warning===62&&window.__fixture.settings.danger===65'))break;await pause(50);}
  assert.deepEqual(await evaluate('[window.__fixture.settings.warning,window.__fixture.settings.danger]'), [62,65], 'Tabbing through the second threshold saves the corrected pair');
  await evaluate("document.getElementById('gauge-warning').value='40';document.getElementById('gauge-warning').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gauge-danger').value='60';document.getElementById('gauge-danger').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gauge-danger').dispatchEvent(new Event('change',{bubbles:true}))");
  for(let i=0;i<20;i++){if(await evaluate('window.__fixture.settings.warning===40&&window.__fixture.settings.danger===60'))break;await pause(50);}
  await evaluate("document.getElementById('gauge-warning').value='41';document.getElementById('gauge-warning').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('gauge-warning').focus()");
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  for(let i=0;i<20;i++){if(await evaluate('window.__fixture.settings.warning===41'))break;await pause(50);}
  assert.equal(await evaluate('window.__fixture.settings.warning'), 41, 'Enter commits valid numeric input without a save button');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#strip-settings label")].map(node=>node.textContent)'), ['ChatGPT 입력창에 표시', 'Codex 입력창에 표시', 'Claude 입력창에 표시', 'Gemini 입력창에 표시']);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".card h2")].map(node=>node.textContent)'), ['ChatGPT', 'Claude', 'Gemini']);
  assert.equal(await evaluate('document.querySelectorAll(".card details,.card select,.card .time,#default-provider").length'), 0);
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Expanded settings overflow at ${width}px`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("preferences").open=false');
  await evaluate('document.getElementById("diagnostics").open=true;document.getElementById("diagnostics-show").click()');
  const diagnostics = await evaluate('JSON.parse(document.getElementById("diagnostics-output").value)');
  assert.equal(diagnostics.extensionVersion, buildLabel);
  assert.equal(diagnostics.providers.chatgpt.errorCode, null);
  assert.deepEqual(Object.keys(diagnostics.providers), ['chatgpt', 'claude', 'gemini']);
  assert.deepEqual(diagnostics.strips, { chatgpt: true, codex: true, claude: false, gemini: true });
  assert.deepEqual(Object.keys(diagnostics.providers.claude).sort(), ['enabled','permission','state','errorCode','checkedAt','collectedAt','nextAttemptAt'].sort());
  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `Diagnostics overflow at ${width}px`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.getElementById("diagnostics").open=false');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  const screenshotPath = join(tmpdir(), 'ai-gauge-popup-fixture.png'); await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, session);
  const darkPopup = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-popup-dark-fixture.png'), Buffer.from(darkPopup.data, 'base64'));
  await cdp('Emulation.setEmulatedMedia', { features: [] }, session);
  await evaluate(`for(const p of ['chatgpt','claude','gemini']){window.__fixture.settings.enabled[p]=false;window.__fixture.permissions[p]=false;}for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`!document.getElementById('onboarding').hidden&&!document.getElementById('onboarding-submit').disabled`)) break; await pause(50); }
  assert(await evaluate(`!document.getElementById('onboarding').hidden&&document.getElementById('cards').hidden&&document.querySelectorAll('#provider-choices input:checked').length===3`), 'First run offers three native service checkboxes before showing cards');
  const onboardingScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-onboarding-fixture.png'), Buffer.from(onboardingScreenshot.data, 'base64'));
  await evaluate(`document.getElementById('choose-claude').click();document.getElementById('onboarding-submit').click();`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.getElementById('onboarding').hidden`)) break; await pause(50); }
  assert.deepEqual(await evaluate('window.__permissionRequests'), [['https://chatgpt.com/*', 'https://gemini.google.com/*']], 'Only selected host permissions are requested, in one prompt');
  assert.deepEqual(await evaluate('window.__fixture.settings.enabled'), { chatgpt: true, claude: false, gemini: true });
  assert(await evaluate(`document.getElementById('onboarding').hidden&&!document.getElementById('cards').hidden`), 'One permission grant enables the selected services and leaves first run');
  return { compactHeight, screenshotPath };
}
