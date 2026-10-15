import assert from 'node:assert/strict';
import { checkGaugeMatchesUsage } from './gauge-checks.mjs';

// Claude chin placement, progress updates and cache reliability states.
export async function runClaudeChecks({ evaluate, pause, waitForPlacement, content }) {
  await evaluate(`window.__fixtureHost='https://claude.ai';history.replaceState(null,'','/new');document.body.innerHTML='<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><div id="claude-slot"><div id="visual-box" style="padding:12px;border:1px solid gray"><div style="display:flex;flex-direction:column;gap:12px"><div class="ProseMirror" contenteditable="true">private Claude prompt</div><div id="toolbar"><button>Attach</button><button>Send</button></div></div></div></div></div><p>Disclaimer</p></main>';window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('visual-box');
  assert.equal(await evaluate('document.querySelector(".ProseMirror").textContent'), 'private Claude prompt');
  assert.equal(await evaluate('document.querySelectorAll("#toolbar button").length'), 2);
  for (const containsEditor of [true, false]) {
    const editor = '<div id="claude-inner" class="relative w-full min-w-0" style="min-width:0;width:100%;position:relative"><div contenteditable="true" class="ProseMirror" style="min-height:48px">private Claude prompt</div></div>';
    await evaluate(`history.replaceState(null,'',${JSON.stringify(containsEditor ? '/new' : '/chat/fixture')});document.body.innerHTML=${JSON.stringify(`<main><div style="min-height:700px;display:flex;flex-direction:column;justify-content:center"><form><div id="claude-surface" class="bg-surface-3" style="padding:12px;background:#e7ebef;border-radius:16px">${containsEditor ? '' : editor}<div id="claude-chin" data-cds="ChatComposerChin" style="padding:8px;background:#d4dbe3;border-radius:12px">${containsEditor ? editor : ''}<div id="claude-toolbar" role="toolbar"><button type="button">Attach</button><button type="button">Send</button></div></div></div></form></div></main>`)};window.__claudeControls=[...document.querySelectorAll('#claude-toolbar button')];window.__claudeChinStyle=document.getElementById('claude-chin').getAttribute('style');window.dispatchEvent(new PopStateEvent('popstate'));`);
    await waitForPlacement('claude-chin');
    assert(await evaluate(`(()=>{const chin=document.getElementById('claude-chin'),host=document.getElementById('ai-gauge-usage-strip'),toolbar=document.getElementById('claude-toolbar');return !chin.contains(host)&&!document.getElementById('claude-inner').contains(host)&&chin.getAttribute('style')===window.__claudeChinStyle&&window.__claudeControls.every((button,i)=>toolbar.children[i]===button);})()`), 'Claude strip follows ChatComposerChin for containing and sibling editors without changing the toolbar');
    assert.equal(await evaluate('document.querySelector(".ProseMirror").textContent'), 'private Claude prompt');
    assert.equal(await evaluate('document.querySelectorAll("#claude-toolbar button").length'), 2);
    await evaluate(`window.__stableClaudeStrip=document.getElementById('ai-gauge-usage-strip');window.__stableClaudeMoves=0;window.__claudeObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===window.__stableClaudeStrip)window.__stableClaudeMoves++;});window.__claudeObserver.observe(document,{childList:true,subtree:true});`);
    for (let i = 0; i < 6; i++) {
      await evaluate(`document.getElementById('claude-chin').className='render-${i % 2}';${i === 3 ? "{const old=document.getElementById('claude-chin');old.replaceWith(old.cloneNode(true));}" : ''}`);
      await pause(100);
      await waitForPlacement('claude-chin');
      assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__stableClaudeStrip`), 'Claude keeps the same outside strip when its Chin is re-rendered or replaced');
    }
    assert.equal(await evaluate('window.__stableClaudeMoves'), 0);
    await evaluate('window.__claudeObserver.disconnect()');
  }
  // Storage and worker invalidation must update the existing Claude bar, even
  // for a fraction that leaves the rounded percentage label unchanged.
  await evaluate(`window.__claudeProgress=window.__fixtureUsageRoot.querySelector('progress');window.__fixture.snapshots.claude={...window.__fixture.snapshots.claude,state:'ok',collectedAt:Date.now(),checkedAt:Date.now(),nextAttemptAt:0,errorCode:null,failures:0,limits:[{...window.__fixture.snapshots.claude.limits[0],percent:17,resetsAt:new Date(Date.now()+7200000).toISOString()}]};for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) {
    if (await evaluate(`!window.__claudeProgress.hidden&&window.__claudeProgress.value===17`)) break;
    await pause(50);
  }
  assert(await evaluate(`!window.__claudeProgress.hidden&&window.__claudeProgress.value===17&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 17%')`), 'Claude successful collection updates its previously cached usage');
  await evaluate(`window.__fixture.snapshots.claude.limits[0].percent=17.25;window.__fixture.snapshots.claude.collectedAt=Date.now();for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) {
    if (await evaluate('window.__claudeProgress.value===17.25')) break;
    await pause(50);
  }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.value===17.25&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 17%')`), 'Fractional usage updates the existing progress even when its rounded percentage is unchanged');
  await evaluate(`window.__fixture.snapshots.claude.limits[0].percent=63;window.__fixture.snapshots.claude.collectedAt=Date.now();for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) {
    if (await evaluate('window.__claudeProgress.value===63')) break;
    await pause(50);
  }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.value===63&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 63%')`), 'Runtime invalidation updates both the existing bar and its usage label');
  // Cache age alone is a collection schedule, not evidence that the value is
  // wrong. A reset or repeated/hard collection failure does change reliability.
  await evaluate(`window.__fixture.snapshots.claude.collectedAt=Date.now()-15*60_000;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  await pause(400);
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&!window.__claudeProgress.hidden&&window.__claudeProgress.value===63&&window.__fixtureUsageRoot.querySelector('.status').hidden&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 63%')`), 'A normal cache older than ten minutes keeps the same visible progress node without a warning');
  await evaluate(`window.__claudeGauge=window.__fixtureUsageRoot.querySelector('.usage-gauge');window.__claudeReset=window.__fixtureUsageRoot.querySelector('.reset');window.__claudeResetLabel=window.__claudeReset.textContent;window.__claudeGaugeChanges=0;window.__claudeGaugeObserver=new MutationObserver(records=>{window.__claudeGaugeChanges+=records.length});window.__claudeGaugeObserver.observe(window.__claudeGauge,{attributes:true,childList:true,characterData:true,subtree:true});`);
  for (const failures of [1, 2, 5]) {
    await evaluate(`window.__fixture.snapshots.claude.state='error';window.__fixture.snapshots.claude.errorCode='tab_access_failed';window.__fixture.snapshots.claude.failures=${failures};for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
    await pause(400);
    assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&!window.__claudeProgress.hidden&&window.__claudeProgress.value===63&&window.__fixtureUsageRoot.querySelector('.status').hidden&&window.__fixtureUsageRoot.querySelector('.reset')===window.__claudeReset&&window.__claudeReset.textContent===window.__claudeResetLabel&&window.__fixtureUsageRoot.querySelector('.usage-gauge')===window.__claudeGauge&&window.__claudeGauge.dataset.usageState==='known'&&getComputedStyle(window.__claudeGauge.querySelector('.gauge-needle')).visibility==='visible'&&!/확인 불가|사이트 접근 설정|다시 확인/.test(document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label'))`), `Tab execution failure ${failures} keeps the last valid usage, reset and gauge without replacing any nodes`);
  }
  assert.equal(await evaluate('window.__claudeGaugeChanges'), 0, 'Repeated tab execution failures do not mutate or reanimate an unchanged gauge');
  await evaluate('window.__claudeGaugeObserver.disconnect()');
  await checkGaugeMatchesUsage(evaluate,pause);
  await evaluate(`window.__fixture.snapshots.claude.state='ok';window.__fixture.snapshots.claude.errorCode=null;window.__fixture.snapshots.claude.failures=0;window.__fixture.snapshots.claude.collectedAt=Date.now();window.__fixture.snapshots.claude.limits[0].percent=64.25;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__claudeProgress.value===64.25')) break; await pause(50); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.value===64.25&&window.__fixtureUsageRoot.querySelector('.usage-gauge')===window.__claudeGauge&&document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label').includes('사용량: 64%')`), 'A successful result after repeated tab execution failures updates the existing bar, text and gauge');
  await checkGaugeMatchesUsage(evaluate,pause);
  await evaluate(`window.__fixture.snapshots.claude.limits[0].percent=63;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__claudeProgress.value===63')) break; await pause(50); }
  await evaluate(`window.__fixture.snapshots.claude.state='error';window.__fixture.snapshots.claude.errorCode='network';window.__fixture.snapshots.claude.failures=1;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  await pause(400);
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&!window.__claudeProgress.hidden&&window.__claudeProgress.value===63&&window.__fixtureUsageRoot.querySelector('.status').hidden`), 'One temporary network failure retains the same reliable cached progress');
  await checkGaugeMatchesUsage(evaluate,pause);
  await evaluate(`window.__fixture.snapshots.claude.failures=2;for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  for (let i = 0; i < 20; i++) { if (await evaluate('window.__claudeProgress.hidden')) break; await pause(50); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.hidden&&!window.__claudeProgress.hasAttribute('value')&&!window.__fixtureUsageRoot.querySelector('.status').hidden&&!/사용량: (63|0)%/.test(document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label'))`), 'Repeated collection failures clear the numeric value without replacing its progress node or inventing zero usage');
  assert(await evaluate(`getComputedStyle(window.__fixtureUsageRoot.querySelector('.gauge-needle')).visibility==='hidden'&&window.__fixtureUsageRoot.querySelector('.usage-gauge').dataset.usageState==='unknown'`), 'Unreliable data shows a neutral gauge with no visible needle');
  await evaluate(`window.__fixture.snapshots.claude.state='ok';window.__fixture.snapshots.claude.errorCode=null;window.__fixture.snapshots.claude.failures=0;window.__fixture.snapshots.claude.limits[0].resetsAt=new Date(Date.now()+1000).toISOString();for(const grant of window.__fixture.snapshots.claude.tickets.inventory.grants)grant.expiresAt=new Date(Date.now()+1000).toISOString();for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 20; i++) { if (await evaluate('!window.__claudeProgress.hidden')) break; await pause(25); }
  assert(await evaluate(`!window.__claudeProgress.hidden&&window.__claudeProgress.value===63`), 'A reliable result restores the existing progress before its reset');
  await evaluate(`window.__fixtureBeforeResetSend=chrome.runtime.sendMessage;window.__resetDisplayRequests=0;chrome.runtime.sendMessage=async message=>{window.__resetDisplayRequests++;return window.__fixtureBeforeResetSend(message)};`);
  // Exercise the real display timer without a DOM mutation, worker message or
  // clock substitution; a render tick must not turn into another API request.
  for (let i = 0; i < 170; i++) { if (await evaluate('window.__claudeProgress.hidden')) break; await pause(100); }
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.hidden&&!window.__claudeProgress.hasAttribute('value')&&window.__fixtureUsageRoot.querySelector('.status').textContent==='초기화 후 확인 중'&&!/사용량: (63|0)%/.test(document.getElementById('ai-gauge-usage-strip').getAttribute('aria-label'))`), 'The display timer clears usage after reset without an incoming event, replacing the node, or guessing zero');
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').hidden&&!window.__fixtureUsageRoot.querySelector('.tickets').hasAttribute('href')`), 'The existing local clock also removes expired ticket links without an API request');
  assert.equal(await evaluate('window.__resetDisplayRequests'), 0, 'Time-only display updates do not request another view or API refresh');
  await evaluate('chrome.runtime.sendMessage=window.__fixtureBeforeResetSend');
  await evaluate(`window.__fixture.snapshots.claude.state='signed_out';window.__fixture.snapshots.claude.errorCode='signed_out';window.__fixture.snapshots.claude.failures=1;window.__fixture.snapshots.claude.limits[0].resetsAt=new Date(Date.now()+7200000).toISOString();for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  await pause(400);
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('progress')===window.__claudeProgress&&window.__claudeProgress.hidden&&!window.__claudeProgress.hasAttribute('value')&&!window.__fixtureUsageRoot.querySelector('.status').hidden`), 'Authentication failure invalidates cached usage immediately without replacing the strip');
}
