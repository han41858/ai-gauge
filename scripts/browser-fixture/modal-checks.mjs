import assert from 'node:assert/strict';

// Exercise accessibility isolation with real layout and the built observer.
export async function checkModalIsolation({ evaluate, pause, waitForPlacement }, provider, anchorId) {
  await evaluate(`window.__modalState={
    host:document.getElementById('ai-gauge-usage-strip'),root:window.__fixtureUsageRoot,
    gauge:window.__fixtureUsageRoot.querySelector('.usage-gauge'),progress:window.__fixtureUsageRoot.querySelector('progress'),
    anchor:document.getElementById(${JSON.stringify(anchorId)}),app:document.getElementById(${JSON.stringify(anchorId)}).closest('main'),url:location.href,
    send:chrome.runtime.sendMessage,requests:[]
  };chrome.runtime.sendMessage=async message=>{window.__modalState.requests.push(message.type);return window.__modalState.send(message)};`);
  try {
    for (const attribute of ['aria-hidden', 'inert']) {
      await evaluate(`(()=>{
        const dialog=document.createElement('div');dialog.id='rename-fixture';dialog.setAttribute('role','dialog');
        dialog.setAttribute('aria-modal','true');dialog.style.cssText='position:fixed;right:0;bottom:0;padding:12px;background:white';
        dialog.innerHTML='<label>Rename conversation<input aria-label="Conversation name"></label><button>Save</button>';
        document.body.append(dialog);dialog.querySelector('input').focus();
        window.__modalState.app.setAttribute(${JSON.stringify(attribute)},${JSON.stringify(attribute === 'aria-hidden' ? 'true' : '')});
      })()`);
      await pause(400);
      assert(await evaluate(`(()=>{const s=window.__modalState;return document.getElementById('ai-gauge-usage-strip')===s.host
        && window.__fixtureUsageRoot===s.root && s.root.querySelector('.usage-gauge')===s.gauge
        && s.root.querySelector('progress')===s.progress && s.host.getBoundingClientRect().height===30
        && s.anchor.nextElementSibling===s.host
        && s.app.hasAttribute(${JSON.stringify(attribute)}) && location.href===s.url
        && !document.getElementById('rename-fixture').contains(s.host);})()`), `${provider}: ${attribute} modal retains the visible original strip and site isolation`);
      const diagnostic = await evaluate(`new Promise(resolve=>{for(const fn of window.__runtimeListeners)
        fn({type:'display-diagnostics'},{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve)})`);
      assert.equal(diagnostic.provider, provider, 'A modal cannot switch redirected Codex to ChatGPT');
      assert.equal(diagnostic.stripVisible, true, 'Accessibility isolation is not visual hiding');
      await evaluate(`window.__modalState.app.removeAttribute(${JSON.stringify(attribute)});document.getElementById('rename-fixture').remove();`);
      await pause(400);
      assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')===window.__modalState.host
        && document.querySelectorAll('#ai-gauge-usage-strip').length===1`), `${provider}: closing the modal keeps the same single strip`);
    }
    assert.deepEqual(await evaluate('window.__modalState.requests'), [], 'Opening/closing a modal requires no worker read, context change or usage refresh');
    // A removal control proves the observer actually re-evaluates modal changes.
    await evaluate(`(()=>{const dialog=document.createElement('div');dialog.id='rename-fixture';dialog.setAttribute('role','dialog');
      dialog.textContent='Rename';document.body.append(dialog);window.__modalState.app.setAttribute('aria-hidden','true');
      window.__modalState.app.hidden=true;})()`);
    for (let attempt = 0; attempt < 20 && await evaluate(`!!document.getElementById('ai-gauge-usage-strip')`); attempt++) await pause(100);
    assert(await evaluate(`!document.getElementById('ai-gauge-usage-strip')`), `${provider}: actual hiding during a modal removes the strip through the observer`);
    await evaluate(`window.__modalState.app.hidden=false;window.__modalState.app.removeAttribute('aria-hidden');document.getElementById('rename-fixture').remove();`);
    await waitForPlacement(anchorId);
    assert(await evaluate(`document.getElementById('ai-gauge-usage-strip')!==window.__modalState.host
      && document.querySelectorAll('#ai-gauge-usage-strip').length===1`), `${provider}: a restored composer receives one new strip`);
  } finally {
    await evaluate(`chrome.runtime.sendMessage=window.__modalState.send;window.__modalState.app.removeAttribute('aria-hidden');
      window.__modalState.app.removeAttribute('inert');window.__modalState.app.hidden=false;document.getElementById('rename-fixture')?.remove();delete window.__modalState;`);
  }
}
