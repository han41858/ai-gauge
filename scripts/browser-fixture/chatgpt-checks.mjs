import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGaugeMotion } from './gauge-checks.mjs';

// ChatGPT placement, gauge motion, ticket link, layout widths and permission revocation.
export async function runChatGPTChecks({ cdp, session, evaluate, pause, waitForPlacement, content }) {
  await evaluate(`window.__fixtureHost='https://chatgpt.com';`);
  await evaluate(`history.replaceState(null,'','/');document.body.innerHTML='<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><div id="chatgpt-slot"><form id="chatgpt-home"><div id="chatgpt-body" class="layout ComposerLayoutBody-uBBf1A" style="padding:12px;border:1px solid gray;border-radius:16px"><div id="prompt-textarea" contenteditable="true" style="min-height:48px">private ChatGPT prompt</div><button>Send</button></div></form><p id="chatgpt-helper" hidden>Shortcut hints</p></div></div></main>';window.__chatgptControls=[...document.querySelectorAll('#chatgpt-body button')];window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('chatgpt-body');
  assert(await evaluate(`!document.getElementById('chatgpt-body').contains(document.getElementById('ai-gauge-usage-strip'))&&document.getElementById('prompt-textarea').textContent==='private ChatGPT prompt'&&window.__chatgptControls.every(button=>button.isConnected)`), 'ChatGPT home strip is the immediate sibling after ComposerLayoutBody, outside the input surface');
  let ordinary;
  for (let i = 0; i < 20; i++) { ordinary = await evaluate('document.querySelector("#ai-gauge-usage-strip")?.getAttribute("aria-label")??""'); if (ordinary.includes('사용량: 42%')) break; await pause(100); }
  assert.match(ordinary, /^사용량: 42%  🕒 초기화: \d+분 후$/); assert.doesNotMatch(ordinary, /0d|남음|Chat|Work|Codex|공유|모델별|AI Gauge/);
  assert(await evaluate(`(()=>{const link=window.__fixtureUsageRoot.querySelector('.tickets');return !link.hidden&&link.textContent==='🎫 티켓 만료: 23시간 후'&&link.getAttribute('aria-label').includes(link.textContent)&&!/[×]|개|[0-9]+\\/[0-9]+/.test([link.textContent,link.getAttribute('aria-label'),link.title,link.getAttribute('aria-description')].join(' '));})()`), 'ChatGPT shows only the earliest confirmed ticket countdown, without quantities or dates in visual or accessible text');
  await checkGaugeMotion({ cdp, session, evaluate, pause });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,link=root.querySelector('.tickets'),reset=root.querySelector('.reset'),host=document.getElementById('ai-gauge-usage-strip');return !link.hidden&&getComputedStyle(link).display!=='none'&&link.getBoundingClientRect().left>reset.getBoundingClientRect().right&&link.getBoundingClientRect().right<=host.getBoundingClientRect().right&&host.getBoundingClientRect().height===30&&root.querySelector('.brand-icon').getBoundingClientRect().width===20&&getComputedStyle(link).fontSize==='12px';})()`), 'Wide composer adds the ticket link without changing usage, reset, icon, 12px text or 30px strip geometry');
  const ticketStripScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-tickets-strip-fixture.png'), Buffer.from(ticketStripScreenshot.data, 'base64'));
  await evaluate(`{const link=window.__fixtureUsageRoot.querySelector('.tickets');link.addEventListener('click',event=>{event.preventDefault();window.__ticketActivated=link.href;},{once:true});link.focus();}`);
  assert(await evaluate(`window.__fixtureUsageRoot.activeElement===window.__fixtureUsageRoot.querySelector('.tickets')`), 'Ticket link accepts keyboard focus inside the closed shadow component');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  assert.equal(await evaluate('window.__ticketActivated'), 'https://chatgpt.com/settings/usage?tab=overview', 'Keyboard activation resolves to the fixed official usage page (navigation prevented in fixture)');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`getComputedStyle(window.__fixtureUsageRoot.querySelector('.tickets')).display==='none'&&getComputedStyle(window.__fixtureUsageRoot.querySelector('.reset')).display!=='none'`), 'Tickets hide before reset details when the composer narrows');
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,gauge=root.querySelector('svg.usage-gauge'),text=root.querySelector('.current span');return gauge.getAttribute('viewBox')==='0 0 64 64'&&gauge.getBoundingClientRect().width===20&&gauge.getBoundingClientRect().height===20&&gauge.getBoundingClientRect().right<text.getBoundingClientRect().left&&!gauge.querySelector('image,script,foreignObject')})()`), 'Local inline gauge occupies 20px at the start of the usage strip without an image request');
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,bar=root.querySelector('progress'),current=root.querySelector('.current').getBoundingClientRect(),reset=root.querySelector('.reset').getBoundingClientRect();return document.getElementById('ai-gauge-usage-strip').shadowRoot===null&&!bar.hidden&&bar.value===42&&bar.max===100&&bar.getBoundingClientRect().width===80&&bar.getBoundingClientRect().height===6&&reset.left-current.right>=13&&Math.abs(current.top-reset.top)<2;})()`), 'Small real-value progress and spacing replace the comma on a wide composer');
  const stripScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-strip-fixture.png'), Buffer.from(stripScreenshot.data, 'base64'));
  await evaluate(`window.__fixtureBodyStyle=document.body.style.cssText;document.body.style.background='#202020';document.body.style.color='#ececec';`);
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,text=root.querySelector('.current>span'),reset=root.querySelector('.reset'),icon=root.querySelector('.brand-icon');return getComputedStyle(text).color==='rgb(236, 236, 236)'&&getComputedStyle(reset).color==='rgb(236, 236, 236)'&&getComputedStyle(text).opacity==='0.8'&&getComputedStyle(icon).opacity==='1'&&getComputedStyle(root.querySelector('.current')).opacity==='1'})()`), 'Switching site theme updates text color without dimming the logo or parent row');
  const darkStrip = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(tmpdir(), 'ai-gauge-strip-dark-fixture.png'), Buffer.from(darkStrip.data, 'base64'));
  await evaluate('document.body.style.cssText=window.__fixtureBodyStyle');
  assert.equal(await evaluate(`getComputedStyle(window.__fixtureUsageRoot.querySelector('.current>span')).color`), 'rgb(0, 0, 0)', 'Text also returns to the light-site foreground');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,host=document.getElementById('ai-gauge-usage-strip');return getComputedStyle(root.querySelector('.reset')).display==='none'&&host.getBoundingClientRect().height===30&&root.querySelector('.usage').getBoundingClientRect().height===30&&document.documentElement.scrollWidth<=document.documentElement.clientWidth;})()`), 'Small composer hides reset details and preserves its 30px height without horizontal overflow');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate(`window.__stableChatGPTStrip=document.getElementById('ai-gauge-usage-strip');window.__stableChatGPTMoves=0;window.__chatgptObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===window.__stableChatGPTStrip)window.__stableChatGPTMoves++;});window.__chatgptObserver.observe(document,{childList:true,subtree:true});window.__fixtureSend=chrome.runtime.sendMessage;window.__fixtureRejectNext=true;chrome.runtime.sendMessage=async message=>{if(window.__fixtureRejectNext){window.__fixtureRejectNext=false;throw new Error('temporary worker restart');}return window.__fixtureSend(message)};for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) {
    await evaluate(`document.getElementById('chatgpt-body').className='ComposerLayoutBody-render${i % 2}';document.getElementById('chatgpt-helper').hidden=${i % 2 === 0};${i === 10 ? "history.replaceState(null,'','/c/fixture');{const old=document.getElementById('chatgpt-body');old.replaceWith(old.cloneNode(true));}window.dispatchEvent(new PopStateEvent('popstate'));" : ''}`);
    await pause(350);
    await waitForPlacement('chatgpt-body');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__stableChatGPTStrip && window.__aiGaugeMounted===true`), 'Plan usage stays outside home/chat composers through hash and anchor changes, worker failures and helper changes');
  }
  assert.equal(await evaluate('window.__stableChatGPTMoves'), 0);
  await evaluate('window.__chatgptObserver.disconnect()');
  await evaluate(`window.__fixture.permissions.chatgpt=false;chrome.runtime.sendMessage=async()=>({ok:false});for(const fn of window.__runtimeListeners)fn({type:'permissions-revoked',origins:['https://chatgpt.com/*']},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length') === 0) break; await pause(100); }
  assert.equal(await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'), 0);
  assert.equal(await evaluate('window.__aiGaugeMounted'), false);
}
