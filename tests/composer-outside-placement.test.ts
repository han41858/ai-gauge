import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findComposerTarget } from '../src/content/selectors';
import { UsageStrip } from '../src/content/usage-strip';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { PageProvider, View } from '../src/shared/types';

type OutsideProvider = Extract<PageProvider, 'chatgpt' | 'codex' | 'claude'>;
const providers: OutsideProvider[] = ['chatgpt', 'codex', 'claude'];
const marker = (provider: OutsideProvider, suffix = 'newBuild42') => provider === 'claude'
  ? 'data-cds="ChatComposerChin"'
  : `class="relative ${provider === 'chatgpt' ? 'ComposerLayoutBody' : 'ComposerLayoutRoot'}-${suffix} w-full"`;
const composer = (provider: OutsideProvider, name = 'one', suffix?: string) => provider === 'claude'
  ? `<form id="${name}-scope"><div id="${name}-surface" class="bg-surface-3"><div class="relative w-full min-w-0"><textarea id="${name}-input">Private prompt</textarea></div></div><div id="${name}-anchor" ${marker(provider, suffix)}><button type="button">Send</button></div></form>`
  : `<form id="${name}-scope"><div id="${name}-anchor" ${marker(provider, suffix)}><textarea id="${name}-input">Private prompt</textarea><button type="button">Send</button>${provider === 'codex' ? '<div class="ComposerLayoutFooter-oldHash"><button type="button">Attach</button></div>' : ''}</div><div id="${name}-after">Site helper</div></form>`;
const docFor = (html: string) => new JSDOM(`<main>${html}</main>`, { url: 'https://chatgpt.com/' }).window.document;
const enabledView = (): View => {
  const settings = defaults();
  settings.enabled = { chatgpt: true, claude: true, gemini: true };
  return {
    settings,
    permissions: { chatgpt: true, claude: true, gemini: true },
    snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') }
  };
};

for (const provider of providers) {
  test(`${provider} uses the reported outside marker and preserves prompt, toolbar and stable mount`, () => {
    const doc = docFor(composer(provider));
    const input = doc.getElementById('one-input')!;
    const anchor = doc.getElementById('one-anchor')!;
    const control = anchor.querySelector('button')!;
    const markup = anchor.innerHTML;
    const originalParent = input.parentElement;
    let clicks = 0;
    control.addEventListener('click', () => clicks++);
    for (const key of ['value', 'textContent', 'innerText', 'innerHTML']) {
      Object.defineProperty(input, key, { get() { throw new Error(`Private prompt read: ${key}`); } });
    }
    const target = findComposerTarget(doc, provider);
    assert.equal(target?.anchor, anchor);
    assert.equal(target?.input, input);
    assert.equal(target?.placement, 'after');
    const strip = new UsageStrip(provider, doc);
    strip.update(enabledView());
    const host = doc.getElementById('ai-gauge-usage-strip')!;
    assert.equal(anchor.nextElementSibling, host);
    assert.equal(anchor.contains(host), false);
    assert.equal(host.closest('[contenteditable]'), null);
    assert.equal(anchor.innerHTML, markup);
    assert.equal(input.parentElement, originalParent);
    control.click();
    assert.equal(clicks, 1);
    const observer = new doc.defaultView!.MutationObserver(() => {});
    observer.observe(doc, { subtree: true, childList: true, attributes: true });
    for (let n = 0; n < 20; n++) strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), host);
    assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
    assert.equal(observer.takeRecords().length, 0);
    observer.disconnect();
  });

  test(`${provider} outside marker stays stable through site insertion and SPA composer replacement`, () => {
    const doc = docFor(composer(provider));
    const strip = new UsageStrip(provider, doc);
    strip.update(enabledView());
    const host = doc.getElementById('ai-gauge-usage-strip')!;
    const anchor = doc.getElementById('one-anchor')!;
    const helper = doc.createElement('div');
    anchor.after(helper);
    strip.mount();
    assert.equal(anchor.nextElementSibling, host);
    assert.equal(host.nextElementSibling, helper);
    doc.querySelector('main')!.innerHTML = composer(provider, 'next', 'nextRandomSuffix');
    strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), host);
    assert.equal(doc.getElementById('next-anchor')!.nextElementSibling, host);
    assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
    doc.getElementById('next-scope')!.hidden = true;
    strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
  });

  test(`${provider} multiple outside markers require a unique focused composer`, () => {
    const doc = docFor(composer(provider, 'one') + composer(provider, 'two'));
    assert.equal(findComposerTarget(doc, provider), null);
    doc.getElementById('two-input')!.focus();
    assert.equal(findComposerTarget(doc, provider)?.anchor.id, 'two-anchor');
    assert.equal(findComposerTarget(doc, provider)?.input?.id, 'two-input');
  });

  test(`${provider} outside marker can appear before its editor without reading page contents`, () => {
    const doc = docFor(`<div id="anchor" ${marker(provider)}><button>Send</button></div>`);
    const target = findComposerTarget(doc, provider);
    assert.equal(target?.anchor.id, 'anchor');
    assert.equal(target?.input, null);
    assert.equal(target?.placement, 'after');
  });

  test(`${provider} hides unsafe markers in hidden, modal, editable or conversation regions`, () => {
    for (const opening of [
      '<div hidden>', '<div inert>', '<div aria-hidden="true">', '<div style="display:none">',
      '<div style="opacity:0">', '<div role="dialog">', '<div role="search">',
      '<nav>', '<div data-message-author-role="user">', '<div data-testid="conversation-turn-5">',
      '<div contenteditable="true">'
    ]) {
      const end = opening === '<nav>' ? '</nav>' : '</div>';
      const doc = docFor(`${opening}${composer(provider)}${end}`);
      assert.equal(findComposerTarget(doc, provider), null, opening);
    }
  });

  test(`${provider} marker with multiple eligible editors does not select an arbitrary input`, () => {
    const doc = docFor(composer(provider));
    doc.getElementById('one-scope')!.append(doc.createElement('textarea'));
    if (provider !== 'claude') doc.getElementById('one-anchor')!.append(doc.createElement('textarea'));
    const target = findComposerTarget(doc, provider);
    assert.equal(target?.anchor.id, 'one-anchor');
    assert.equal(target?.input, null);
  });

  test(`${provider} removes the outside strip when the connected marker is no longer a composer`, () => {
    const doc = docFor(`<div id="anchor" ${marker(provider)}><button>Send</button></div>`);
    const strip = new UsageStrip(provider, doc);
    strip.update(enabledView());
    assert(doc.getElementById('ai-gauge-usage-strip'));
    const anchor = doc.getElementById('anchor')!;
    anchor.removeAttribute(provider === 'claude' ? 'data-cds' : 'class');
    strip.mount();
    assert.equal(anchor.isConnected, true);
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
  });
}

for (const provider of ['chatgpt', 'codex'] as const) {
  test(`${provider} exact class-token prefix accepts changed suffixes and rejects incidental substrings`, () => {
    const prefix = provider === 'chatgpt' ? 'ComposerLayoutBody-' : 'ComposerLayoutRoot-';
    for (const suffix of ['uBBf1A', 'XCKS7O', 'next_random-42']) {
      assert.equal(findComposerTarget(docFor(composer(provider, 'one', suffix)), provider)?.anchor.id, 'one-anchor');
    }
    for (const token of [`other${prefix}hash`, `x-${prefix}hash`, prefix, prefix.slice(0, -1)]) {
      const doc = docFor(`<form id="fallback" data-chatgpt-composer><div id="false-marker" class="${token}"><textarea></textarea><button>Send</button></div></form>`);
      assert.equal(findComposerTarget(doc, provider)?.anchor.id, 'fallback', token);
    }
  });
}

test('Claude requires the exact ChatComposerChin attribute value', () => {
  for (const value of ['OtherChatComposerChin', 'ChatComposerChin-other', 'chatcomposerchin', '']) {
    const doc = docFor(`<form id="fallback"><textarea></textarea><div data-cds="${value}"><button>Send</button></div></form>`);
    assert.equal(findComposerTarget(doc, 'claude')?.anchor.id, 'fallback', value);
  }
});

test('Claude sibling editor temporarily becoming readonly does not unmount its known outside strip', () => {
  const doc = docFor(composer('claude'));
  const strip = new UsageStrip('claude', doc);
  strip.update(enabledView());
  const host = doc.getElementById('ai-gauge-usage-strip')!;
  doc.getElementById('one-input')!.setAttribute('readonly', '');
  strip.mount();
  assert.equal(doc.getElementById('ai-gauge-usage-strip'), host);
  assert.equal(doc.getElementById('one-anchor')!.nextElementSibling, host);
});

test('ChatGPT uses Body while Codex uses Root when the layout contains both generated markers', () => {
  const doc = docFor('<div id="root" class="ComposerLayoutRoot-XCKS7O"><div id="body" class="ComposerLayoutBody-uBBf1A"><textarea></textarea></div><div class="ComposerLayoutFooter-random"><button>Send</button></div></div>');
  assert.equal(findComposerTarget(doc, 'chatgpt')?.anchor.id, 'body');
  assert.equal(findComposerTarget(doc, 'codex')?.anchor.id, 'root');
});

test('Claude also places the strip outside a Chin containing its complete composer', () => {
  const doc = docFor('<div id="chin" data-cds="ChatComposerChin"><div class="bg-surface-3"><div class="relative w-full min-w-0"><div contenteditable="true"></div></div><button>Send</button></div></div>');
  const strip = new UsageStrip('claude', doc);
  strip.update(enabledView());
  assert.equal(doc.getElementById('chin')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
  assert.equal(doc.getElementById('chin')!.querySelector('#ai-gauge-usage-strip'), null);
});

test('new ChatGPT, Codex and Claude markers leave Gemini placement unchanged', () => {
  const doc = docFor(`${composer('chatgpt')}${composer('codex', 'two')}${composer('claude', 'three')}<input-area-v2 id="gemini"><rich-textarea><div contenteditable="true" role="textbox" aria-label="Enter a prompt here"></div></rich-textarea><button>Send</button></input-area-v2>`);
  assert.equal(findComposerTarget(doc, 'gemini')?.anchor.id, 'gemini');
});
