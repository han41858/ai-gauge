import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findComposerTarget, hasStreamingControl } from '../src/content/selectors';
import { resolvePageProvider } from '../src/content/page-provider';
import { UsageStrip } from '../src/content/usage-strip';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { View } from '../src/shared/types';

const composer = '<input-area-v2 id="composer"><rich-textarea><div class="ql-editor" role="textbox" contenteditable="true">private prompt</div></rich-textarea><button aria-label="Send message">Send</button></input-area-v2>';

function fixture(markup = composer) {
  const dom = new JSDOM(`<main>${markup}</main>`, { url: 'https://gemini.google.com/app' });
  const doc = dom.window.document, roots = new Map<HTMLElement, ShadowRoot>();
  const attach = dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow = function(this: HTMLElement, options: ShadowRootInit) {
    const root = attach.call(this, options); roots.set(this, root); return root;
  };
  for (const element of doc.querySelectorAll('[contenteditable],textarea,user-query,model-response')) {
    for (const field of ['value', 'textContent', 'innerText', 'innerHTML']) Object.defineProperty(element, field, {
      get() { throw new Error('Conversation or prompt read'); }
    });
  }
  return { dom, doc, roots };
}

function view(): View {
  const settings = defaults(); settings.enabled.gemini = true;
  return { settings, permissions: { chatgpt: true, claude: true, gemini: true }, snapshots: {
    chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'),
    gemini: { ...emptySnapshot('gemini'), state: 'ok', errorCode: null, collectedAt: Date.now(), checkedAt: Date.now(), limits: [
      { id: 'weekly', label: '주간', category: 'window', percent: 12.5, resetsAt: new Date(Date.now() + 86_400_000).toISOString(),
        windowSeconds: 604800, remaining: 12096, unit: null, source: 'api' }
    ] }
  } };
}

test('Gemini structural candidates place the shared strip after the bounded composer without reading text', () => {
  for (const markup of [composer, composer.replaceAll('input-area-v2', 'div').replace('id="composer"', 'id="composer" class="input-area"')]) {
    const { dom, doc } = fixture(`<model-response><div contenteditable="true">private answer</div></model-response>${markup}`);
    try {
      const target = findComposerTarget(doc, 'gemini');
      assert.equal(target?.anchor, doc.getElementById('composer'));
      assert.equal(target?.input, doc.querySelector('rich-textarea [contenteditable]'));
      const strip = new UsageStrip('gemini', doc); strip.update(view());
      assert.equal(doc.getElementById('composer')?.nextElementSibling?.id, 'ai-gauge-usage-strip');
      assert.equal(doc.querySelector('rich-textarea #ai-gauge-usage-strip'), null);
      assert.match(doc.getElementById('ai-gauge-usage-strip')!.getAttribute('aria-label')!, /사용량: 13%/);
      assert.doesNotMatch(doc.getElementById('ai-gauge-usage-strip')!.getAttribute('aria-label')!, /12096|메시지|private/);
      strip.remove();
    } finally { dom.window.close(); }
  }
});

test('unknown, hidden, message, ambiguous and editable Gemini wrappers stay untouched', () => {
  const cases = [
    '<form><textarea></textarea><button>Send</button></form>',
    '<rich-textarea><div contenteditable="true"></div></rich-textarea>',
    `<div hidden>${composer}</div>`, `<div style="display:none">${composer}</div>`, `<dialog open>${composer}</dialog>`,
    `<user-query>${composer}</user-query>`, `<model-response>${composer}</model-response>`,
    `<div contenteditable="true">${composer}</div>`,
    composer.replace('</input-area-v2>', '<textarea></textarea></input-area-v2>'),
    composer.replace('contenteditable="true"', 'contenteditable="false"'),
    composer.replace('contenteditable="true"', 'contenteditable="true" aria-readonly="true"'),
    composer.replace('</input-area-v2>', '<model-response>answer</model-response></input-area-v2>')
  ];
  for (const markup of cases) {
    const { dom, doc } = fixture(markup);
    try {
      assert.equal(findComposerTarget(doc, 'gemini'), null);
      const strip = new UsageStrip('gemini', doc); strip.update(view());
      assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
    } finally { dom.window.close(); }
  }
});

test('Gemini refreshes reuse the same closed component and follow composer replacement without duplication', () => {
  const { dom, doc, roots } = fixture();
  try {
    const strip = new UsageStrip('gemini', doc), current = view(); strip.update(current);
    const host = doc.getElementById('ai-gauge-usage-strip')!, root = roots.get(host)!, progress = root.querySelector('progress')!;
    assert.equal(host.shadowRoot, null); assert.equal(progress.value, 12.5);
    const mutations = new dom.window.MutationObserver(() => undefined);
    mutations.observe(doc.body, { childList: true, subtree: true, attributes: true });
    mutations.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    for (let i = 0; i < 10; i++) strip.mount();
    assert.equal(mutations.takeRecords().length, 0);
    current.snapshots.gemini.limits[0]!.percent = 62.75; strip.update(current);
    assert.equal(root.querySelector('progress'), progress); assert.equal(progress.value, 62.75);
    doc.body.className = 'dark-theme'; strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), host);
    doc.getElementById('composer')!.remove(); strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
    doc.querySelector('main')!.insertAdjacentHTML('beforeend', composer); strip.mount();
    assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
    assert.equal(doc.getElementById('composer')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
    mutations.disconnect(); strip.remove();
  } finally { dom.window.close(); }
});

test('Gemini unknown and failed usage never turn remaining units into progress, and settings clean up the strip', () => {
  const { dom, doc, roots } = fixture();
  try {
    const current = view(), strip = new UsageStrip('gemini', doc); strip.update(current);
    const progress = roots.get(doc.getElementById('ai-gauge-usage-strip')!)!.querySelector('progress')!;
    current.snapshots.gemini.limits[0]!.percent = null; strip.update(current);
    assert.equal(progress.hidden, true); assert.equal(progress.hasAttribute('value'), false);
    current.snapshots.gemini.state = 'signed_out'; strip.update(current);
    assert.equal(progress.hidden, true);
    current.permissions.gemini = false; strip.update(current);
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
    current.permissions.gemini = true; current.settings.enabled.gemini = false; strip.update(current);
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
    current.settings.enabled.gemini = true; current.settings.strips.gemini = false; strip.update(current);
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
  } finally { dom.window.close(); }
});

test('Gemini stream signals require visible control metadata inside a recognized composer', () => {
  const { dom, doc } = fixture();
  try {
    const button = doc.querySelector('button')!;
    for (const name of ['textContent', 'innerText', 'innerHTML']) Object.defineProperty(button, name, { get() { throw new Error('Button text read'); } });
    assert.equal(hasStreamingControl(doc, 'gemini'), false);
    button.setAttribute('aria-label', 'Stop response'); assert.equal(hasStreamingControl(doc, 'gemini'), true);
    button.hidden = true; assert.equal(hasStreamingControl(doc, 'gemini'), false);
    button.hidden = false; button.setAttribute('aria-label', 'Send message'); button.setAttribute('data-test-id', 'stop-button');
    assert.equal(hasStreamingControl(doc, 'gemini'), true);
    doc.querySelector('main')!.append(button); assert.equal(hasStreamingControl(doc, 'gemini'), false);
    doc.querySelector('[contenteditable]')!.append(button); assert.equal(hasStreamingControl(doc, 'gemini'), false);
  } finally { dom.window.close(); }
});

test('Gemini markers cannot change a different site into Gemini', () => {
  const { dom, doc } = fixture();
  try {
    assert.equal(resolvePageProvider(doc, 'https://gemini.google.com/app'), 'gemini');
    for (const url of ['http://gemini.google.com/app', 'https://gemini.google.com.example/app', 'https://accounts.google.com/']) {
      assert.equal(resolvePageProvider(doc, url), null);
    }
    assert.equal(resolvePageProvider(doc, 'https://chatgpt.com/'), 'chatgpt');
    assert.equal(resolvePageProvider(doc, 'https://claude.ai/new'), 'claude');
  } finally { dom.window.close(); }
});
