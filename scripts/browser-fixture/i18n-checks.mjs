import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { i18nFixtureSource } from '../i18n-fixture.mjs';
import { checkPopupLanguagePreferences, checkStripLanguagePreferences } from './preference-checks.mjs';

const HOUR = 3_600_000, DAY = 24 * HOUR;

// Real catalogs and built bundles, with Chrome UI language mocked separately
// from both the page language and navigator preferences.
export async function runI18nChecks({ cdp, session, evaluate, pause, waitForPlacement, port, content }) {
  const waitFor = async (expression, message) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate(expression)) return;
      await pause(50);
    }
    assert.fail(message);
  };
  const notify = `for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`;
  for (const language of ['en', 'ko-KR', 'fr', 'ja']) {
    const korean = language === 'ko-KR', pageLanguage = korean ? 'en' : 'ko';
    const init = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
      chrome.i18n=${i18nFixtureSource(language)};
      Object.defineProperty(navigator,'language',{value:${JSON.stringify(pageLanguage)},configurable:true});
      Object.defineProperty(navigator,'languages',{value:[${JSON.stringify(pageLanguage)}],configurable:true});
      for(const snapshot of Object.values(window.__fixture.snapshots)){
        snapshot.state='ok';snapshot.errorCode=null;snapshot.failures=0;
        snapshot.collectedAt=snapshot.checkedAt=Date.now();
        for(const limit of snapshot.limits)limit.resetsAt=new Date(Date.now()+${4.5 * HOUR}).toISOString();
        if(snapshot.tickets){snapshot.tickets.checkedAt=Date.now();snapshot.tickets.inventory.grants.forEach((grant,i)=>{grant.expiresAt=new Date(Date.now()+${2.5 * DAY}+i*${DAY}).toISOString();});}
      }
    ` }, session);
    try {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
      await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/popup.html` }, session);
      await waitFor(`document.readyState==='complete'&&chrome.i18n.getUILanguage()===${JSON.stringify(language)}&&document.querySelectorAll('.card').length===3`, `Popup did not initialize for ${language}`);
      assert.equal(await evaluate('document.documentElement.lang'), korean ? 'ko' : 'en');
      assert.equal(await evaluate(`document.querySelector('[data-provider="chatgpt"] .percent').textContent`), korean ? '사용량: 42%' : 'Usage: 42%');
      assert.equal(await evaluate('navigator.language'), pageLanguage, 'Navigator preferences intentionally differ from the selected Chrome UI language');
      assert.equal(await evaluate(`document.querySelector('[data-provider="chatgpt"] .reset').textContent`), korean ? '🕒 초기화: 4시간 후' : '🕒 Resets in 4 hours', 'Popup uses the same localized countdown as the input strip');
      assert.equal(await evaluate(`document.querySelectorAll('[data-provider="chatgpt"] .ticket-expiry').length`), 2, 'The popup retains each ticket expiry');
      if (!korean) assert.doesNotMatch(await evaluate('document.body.innerText'), /[가-힣]/, `Visible ${language} popup text uses the English catalog, including cached window labels`);
      if (language === 'en' || korean) await checkPopupLanguagePreferences({ cdp, session, evaluate, waitFor, language });
      if (language === 'en') {
        await evaluate(`document.getElementById('preferences').open=true;document.getElementById('diagnostics').open=true;`);
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('#strip-settings label')].map(node=>node.textContent)`), ['Show below ChatGPT input', 'Show below Codex input', 'Show below Claude input', 'Show below Gemini input']);
        assert.doesNotMatch(await evaluate('document.body.innerText'), /[가-힣]/, 'Settings and diagnostics instructions are translated');
        for (const width of [600, 390, 320]) {
          await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
          assert(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'), `English settings overflow at ${width}px`);
        }
        await cdp('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
        await evaluate(`document.getElementById('preferences').open=false;document.getElementById('diagnostics').open=false;`);
        assert(await evaluate('document.body.getBoundingClientRect().height<=600'), 'English cards remain within the default popup height');
        const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
        await writeFile(join(tmpdir(), 'ai-gauge-popup-english-fixture.png'), Buffer.from(screenshot.data, 'base64'));
        await evaluate(`for(const p of ['chatgpt','claude','gemini']){window.__fixture.settings.enabled[p]=false;window.__fixture.permissions[p]=false;}${notify}`);
        await waitFor(`!document.getElementById('onboarding').hidden`, 'English onboarding did not render');
        assert.equal(await evaluate(`document.getElementById('onboarding-title').textContent`), 'Choose your services');
        assert.equal(await evaluate(`document.getElementById('onboarding-submit').textContent`), 'Grant access and start');
        assert.doesNotMatch(await evaluate('document.body.innerText'), /[가-힣]/, 'First-run instructions use English');
      }

      await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/content-fixture.html` }, session);
      await waitFor(`document.title==='Content fixture'&&document.readyState==='complete'&&chrome.i18n.getUILanguage()===${JSON.stringify(language)}`, `Fresh content document did not initialize for ${language}`);
      await evaluate(`document.documentElement.lang=${JSON.stringify(pageLanguage)};window.__fixtureHost='https://chatgpt.com';history.replaceState(null,'','/');document.body.innerHTML='<main><form><div id="i18n-composer" class="ComposerLayoutBody-fixture"><div id="prompt-textarea" contenteditable="true">private synthetic prompt</div><button>Send</button></div></form></main>';window.__fixtureAttachShadow=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=window.__fixtureAttachShadow.call(this,options);if(this.id==='ai-gauge-usage-strip')window.__fixtureUsageRoot=root;return root;};`);
      await evaluate(content);
      await waitForPlacement('i18n-composer');
      assert.equal(await evaluate(`document.getElementById('ai-gauge-usage-strip').lang`), korean ? 'ko' : 'en', 'The strip language follows Chrome, without changing the host page language');
      assert.equal(await evaluate('document.documentElement.lang'), pageLanguage);
      assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.reset').textContent`), korean ? '🕒 초기화: 4시간 후' : '🕒 Resets in 4 hours');
      assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').textContent`), korean ? '🎫 티켓 만료: 2일 후' : '🎫 Ticket expires in 2 days');
      assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('progress').getAttribute('aria-label')`), korean ? '사용량' : 'Usage');
      if (language === 'en' || korean) await checkStripLanguagePreferences({ evaluate, waitFor, language, pageLanguage });

      if (language === 'en') {
        await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
        assert(await evaluate(`(()=>{const root=window.__fixtureUsageRoot,host=document.getElementById('ai-gauge-usage-strip'),gauge=root.querySelector('.usage-gauge'),ticket=root.querySelector('.tickets');return host.getBoundingClientRect().height===30&&gauge.getBoundingClientRect().width===20&&gauge.getBoundingClientRect().height===20&&getComputedStyle(root.querySelector('.current')).fontSize==='12px'&&getComputedStyle(ticket).display!=='none'&&ticket.getBoundingClientRect().right<=host.getBoundingClientRect().right&&root.querySelector('progress').value===42;})()`), 'English text preserves the gauge, progress and 30px geometry');
        for (const width of [600, 390, 320]) {
          await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
          assert(await evaluate(`document.getElementById('ai-gauge-usage-strip').getBoundingClientRect().height===30&&document.documentElement.scrollWidth<=document.documentElement.clientWidth&&getComputedStyle(window.__fixtureUsageRoot.querySelector('.tickets')).display==='none'`), `English strip fits ${width}px and hides tickets first`);
        }
        for (const [remaining, text] of [[1.5 * HOUR, 'in 1 hour'], [90_000, 'in 1 minute'], [45_000, 'in less than a minute']]) {
          await evaluate(`window.__fixture.snapshots.chatgpt.limits[0].resetsAt=new Date(Date.now()+${remaining}).toISOString();window.__fixture.snapshots.chatgpt.tickets.inventory.grants[0].expiresAt=new Date(Date.now()+${remaining}).toISOString();${notify}`);
          await waitFor(`window.__fixtureUsageRoot.querySelector('.reset').textContent===${JSON.stringify(`🕒 Resets ${text}`)}`, `English reset countdown did not show ${text}`);
          assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets').textContent`), `🎫 Ticket expires ${text}`);
        }
        await evaluate(`window.__fixture.snapshots.chatgpt.limits[0].resetsAt=new Date(Date.now()+${4.5 * HOUR}).toISOString();window.__fixture.snapshots.chatgpt.tickets.inventory.grants[0].expiresAt=new Date(Date.now()+${2.5 * DAY}).toISOString();${notify}`);
        const cases = [
          ['https://chatgpt.com', '/codex/tasks/fixture', '<main><form data-testid="codex-composer" id="i18n-composer"><textarea>private synthetic prompt</textarea><button>Send</button></form></main>', true],
          ['https://claude.ai', '/new', '<main><form><div id="i18n-composer" data-cds="ChatComposerChin"><div class="ProseMirror" contenteditable="true">private synthetic prompt</div><button>Send</button></div></form></main>', true],
          ['https://gemini.google.com', '/app', '<main><input-area-v2 id="i18n-composer" style="display:block"><rich-textarea><div role="textbox" class="ql-editor textarea" contenteditable="true">private synthetic prompt</div></rich-textarea><button>Send</button></input-area-v2></main>', false]
        ];
        for (const [host, path, html, tickets] of cases) {
          await evaluate(`window.__fixtureHost=${JSON.stringify(host)};history.replaceState(null,'',${JSON.stringify(path)});document.body.innerHTML=${JSON.stringify(html)};window.dispatchEvent(new PopStateEvent('popstate'));`);
          await waitForPlacement('i18n-composer');
          assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.reset').textContent`), '🕒 Resets in 4 hours');
          assert.equal(await evaluate(`window.__fixtureUsageRoot.querySelector('.tickets')?.textContent??null`), tickets ? '🎫 Ticket expires in 2 days' : null);
          assert.equal(await evaluate(`document.querySelectorAll('#ai-gauge-usage-strip').length`), 1);
        }
      }
    } finally {
      await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: init.identifier }, session);
    }
  }
}
