import assert from 'node:assert/strict';
import { checkStripProgressColors } from './progress-checks.mjs';
import { checkGaugeMatchesUsage } from './gauge-checks.mjs';
import { checkModalIsolation } from './modal-checks.mjs';

// Codex composer placement, root-URL recognition and strip stability.
export async function runCodexChecks({ cdp, session, evaluate, pause, waitForPlacement, content }) {
  let count = 0;
  for (let i = 0; i < 20; i++) { count = await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'); if (count === 1) break; await pause(100); }
  assert.equal(count, 1); assert.equal(await evaluate('document.querySelector("form").nextElementSibling.id'), 'ai-gauge-usage-strip');
  await checkStripProgressColors({ cdp, session, evaluate, pause }, 'codex');
  await checkGaugeMatchesUsage(evaluate,pause);
  assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').href`), 'https://chatgpt.com/settings/usage?tab=overview', 'Codex uses the same ChatGPT ticket link');
  assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').textContent`), '🎫 티켓 만료: 23시간 후', 'Codex uses the same earliest ChatGPT ticket expiry and Korean countdown');
  assert.equal(await evaluate('document.querySelector("textarea").value'), 'private synthetic prompt');
  await evaluate(content); assert.equal(await evaluate('document.querySelectorAll("#ai-gauge-usage-strip").length'), 1);
  await evaluate(`history.replaceState(null,'','/');document.body.innerHTML='<main><section><div id="codex-root" class="layout ComposerLayoutRoot-XCKS7O" style="padding:12px;border:1px solid gray;border-radius:16px"><textarea style="min-height:48px">private Codex prompt</textarea><div id="codex-footer" class="ComposerLayoutFooter-_8IVRO" style="display:flex;align-items:center;gap:8px"><button type="button">Environment</button><button type="button">Send</button></div></div><p>Shortcut hints</p></section></main>';window.__codexFooterStyle=document.getElementById('codex-footer').getAttribute('style');window.__codexControls=[...document.querySelectorAll('#codex-footer button')];window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('codex-root');
  await checkModalIsolation({ evaluate, pause, waitForPlacement }, 'codex', 'codex-root');
  assert(await evaluate(`(()=>{const root=document.getElementById('codex-root'),footer=document.getElementById('codex-footer'),strip=document.getElementById('ai-gauge-usage-strip');return !root.contains(strip)&&footer.getAttribute('style')===window.__codexFooterStyle&&window.__codexControls.every((button,i)=>footer.children[i]===button)&&strip.getAttribute('aria-label').startsWith('사용량: 42%');})()`), 'Redirected Codex home places shared usage after the root without altering its footer controls or layout');
  await evaluate(`window.__rootStrip=document.getElementById('ai-gauge-usage-strip');document.getElementById('codex-root').className='layout ComposerLayoutRoot-newHash';document.getElementById('codex-footer').className='ComposerLayoutFooter-newHash';const hint=document.createElement('span');hint.id='late-footer-hint';hint.textContent='Shortcut';document.getElementById('codex-footer').append(hint);`);
  await pause(400);
  await waitForPlacement('codex-root');
  assert(await evaluate(`document.getElementById('codex-root').nextElementSibling===window.__rootStrip&&document.getElementById('codex-footer').lastElementChild.id==='late-footer-hint'&&document.getElementById('codex-footer').getAttribute('style')===window.__codexFooterStyle`), 'Dynamic class suffix and late footer controls preserve the same outside usage row without changing controls');
  const displayDiagnostic = await evaluate(`new Promise(resolve=>{for(const fn of window.__runtimeListeners)fn({type:'display-diagnostics'},{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve)})`);
  assert.equal(displayDiagnostic.provider, 'codex');
  assert.equal(displayDiagnostic.targetFound, true);
  assert.equal(displayDiagnostic.stripVisible, true);
  assert.equal(displayDiagnostic.stripCount, 1);
  assert.equal(await evaluate('location.pathname'), '/', 'Codex remains recognized after redirect to the site root');
  // A task view can replace the home composer while retaining the redirected URL.
  await evaluate(`document.body.innerHTML='<main style="display:flex;gap:12px"><section style="flex:1">Task result</section><aside style="width:330px;display:flex;flex-direction:column"><section><div id="task-root" class="ComposerLayoutRoot-taskHash" style="padding:12px;border:1px solid gray"><div contenteditable="true" style="min-height:48px">private follow-up prompt</div><div id="task-footer" class="ComposerLayoutFooter-taskHash" style="display:flex"><button>Attach</button><button>Send</button></div></div><p>Task footer</p></section></aside></main>';`);
  await waitForPlacement('task-root');
  assert(await evaluate(`!document.getElementById('task-root').contains(document.getElementById('ai-gauge-usage-strip'))&&document.querySelector('[contenteditable]').textContent==='private follow-up prompt'&&document.querySelectorAll('#task-footer button').length===2`), 'Redirected Codex task uses its replacement root while preserving the prompt and controls');
  await evaluate(`history.replaceState(null,'','/codex/tasks/fixture');window.dispatchEvent(new PopStateEvent('popstate'));`);
  await evaluate(`document.body.innerHTML='<main><div id="composer" style="padding:12px;border:1px solid gray"><div><div data-lexical-editor="true" contenteditable="true">private Codex prompt</div></div><div id="toolbar"><button aria-label="Submit">Send</button></div></div><p>Footer</p></main>';`);
  await waitForPlacement('composer');
  assert.equal(await evaluate('document.querySelector("[contenteditable]").textContent'), 'private Codex prompt');
  await evaluate(`history.replaceState(null,'','/codex');document.body.innerHTML='<main style="display:grid;min-height:700px"><section style="display:flex;flex-direction:column;justify-content:center"><div id="home-slot"><div id="codex-home"><div contenteditable="plaintext-only" style="min-height:48px"></div><div role="toolbar"><button>Environment</button><button type="submit">Send</button></div></div><p id="home-helper" hidden>Shortcut hints</p></div></section></main>';window.dispatchEvent(new PopStateEvent('popstate'));`);
  await waitForPlacement('codex-home');
  await evaluate(`window.__homeStrip=document.getElementById('ai-gauge-usage-strip');`);
  for (let i = 0; i < 12; i++) {
    await evaluate(`document.getElementById('home-helper').hidden=${i % 2 === 0};`);
    await pause(350);
    await waitForPlacement('codex-home');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__homeStrip && document.getElementById('ai-gauge-usage-strip').parentElement.id==='home-slot'`), 'Codex home stays in its composer slot when helpers toggle');
  }
  await evaluate(`document.body.innerHTML='<main style="display:flex;gap:12px"><section style="flex:1;min-width:0">Task result</section><aside style="width:330px;display:flex;flex-direction:column"><section><div id="follow-up" class="ComposerLayoutRoot-followUp" style="padding:12px;border:1px solid gray"><div><div contenteditable="plaintext-only" style="min-height:32px">private follow-up prompt</div></div><div role="toolbar"><button>Attach</button><button aria-label="Send follow-up">Send</button></div></div><p>Task footer</p></section></aside><textarea style="position:fixed;left:-10000px;width:0;height:0;opacity:0"></textarea></main>';`);
  await waitForPlacement('follow-up');
  await evaluate(`window.__stableCodexStrip=document.getElementById('ai-gauge-usage-strip');window.__stableCodexMoves=0;window.__stabilityObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===window.__stableCodexStrip)window.__stableCodexMoves++;});window.__stabilityObserver.observe(document,{childList:true,subtree:true});`);
  for (let i = 0; i < 20; i++) {
    await evaluate(`document.getElementById('follow-up').className='ComposerLayoutRoot-render${i % 2}';${i === 10 ? "{const old=document.getElementById('follow-up');old.replaceWith(old.cloneNode(true));}" : ''}`);
    await pause(80);
    await waitForPlacement('follow-up');
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__stableCodexStrip && document.querySelectorAll('#ai-gauge-usage-strip').length===1`), 'Codex follow-up strip stays mounted during task re-renders');
  }
  assert.equal(await evaluate('window.__stableCodexMoves'), 0);
  await evaluate('window.__stabilityObserver.disconnect()');
}
