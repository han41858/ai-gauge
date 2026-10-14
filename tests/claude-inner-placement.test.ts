import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findComposerTarget } from '../src/content/selectors';
import { UsageStrip } from '../src/content/usage-strip';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { View } from '../src/shared/types';

const documentFor = (html: string) => new JSDOM(html, { url: 'https://claude.ai/new' }).window.document;
const view = (): View => {
  const settings = defaults();
  settings.enabled.claude = true;
  return {
    settings,
    permissions: { chatgpt: false, claude: true, gemini: false },
    snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') }
  };
};
const composer = (classes = 'min-w-0') => `<div id="surface" class="bg-surface-3" style="border:1px solid gray;border-radius:16px"><div id="input-wrapper" class="relative w-full ${classes}"><div id="input" class="ProseMirror" contenteditable="true">Private prompt</div></div><div id="toolbar" role="toolbar"><button>Attach</button><button id="send">Send</button></div></div>`;

for (const classes of ['min-w-0', 'mni-w-0']) {
  test(`Claude uses the reported inner wrapper (${classes}) inside its surface`, () => {
    const doc = documentFor(`<main><form>${composer(classes)}</form><p>Disclaimer</p></main>`);
    const input = doc.getElementById('input')!;
    const toolbar = doc.getElementById('toolbar')!;
    const toolbarMarkup = toolbar.innerHTML;
    const button = doc.getElementById('send')!;
    let clicks = 0;
    button.addEventListener('click', event => { event.preventDefault(); clicks++; });
    for (const key of ['textContent', 'innerText', 'innerHTML']) {
      Object.defineProperty(input, key, { get() { throw new Error(`Prompt read: ${key}`); } });
    }
    const strip = new UsageStrip('claude', doc);
    strip.update(view());
    const host = doc.getElementById('ai-gauge-usage-strip')!;
    assert.equal(host.parentElement?.id, 'surface');
    assert.equal(host.previousElementSibling?.id, 'input-wrapper');
    assert.equal(host.nextElementSibling, toolbar);
    assert.equal(host.closest('[contenteditable]'), null);
    assert.equal(toolbar.innerHTML, toolbarMarkup);
    button.click();
    assert.equal(clicks, 1);
    for (let n = 0; n < 20; n++) {
      strip.mount();
      assert.equal(doc.getElementById('ai-gauge-usage-strip'), host);
      assert.equal(host.previousElementSibling?.id, 'input-wrapper');
    }
    assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
  });
}

test('Claude keeps internal placement when toolbar lives inside the reported wrapper', () => {
  const doc = documentFor(`<main>${composer()}</main>`);
  doc.getElementById('input-wrapper')!.append(doc.getElementById('toolbar')!);
  const target = findComposerTarget(doc, 'claude');
  assert.equal(target?.anchor.id, 'input-wrapper');
  const strip = new UsageStrip('claude', doc);
  strip.update(view());
  assert.equal(doc.getElementById('ai-gauge-usage-strip')!.parentElement?.id, 'surface');
  assert.equal(doc.getElementById('toolbar')!.parentElement?.id, 'input-wrapper');
});

test('Claude column surface permits a full-width internal row', () => {
  const doc = documentFor(`<main>${composer()}</main>`);
  doc.getElementById('surface')!.style.cssText = 'display:flex;flex-direction:column';
  assert.equal(findComposerTarget(doc, 'claude')?.anchor.id, 'input-wrapper');
});

test('Claude class markers do not apply to a different provider', () => {
  const doc = documentFor(`<main><form>${composer()}</form></main>`);
  assert.equal(findComposerTarget(doc, 'codex')?.anchor, doc.querySelector('form'));
});

test('Claude skips class matches unrelated to the selected editor', () => {
  const doc = documentFor(`<main><div class="bg-surface-3"><div id="unrelated" class="relative w-full min-w-0">Other area</div></div>${composer()}</main>`);
  assert.equal(findComposerTarget(doc, 'claude')?.anchor.id, 'input-wrapper');
});

for (const opening of ['<div hidden>', '<div role="search">', '<div data-message-author-role="user">', '<div role="dialog">']) {
  test(`Claude ignores reported classes inside excluded content: ${opening}`, () => {
    const doc = documentFor(`<main>${opening}${composer()}</div></main>`);
    assert.equal(findComposerTarget(doc, 'claude'), null);
  });
}

test('Claude never inserts inside a contenteditable marker wrapper', () => {
  const doc = documentFor('<main><div class="bg-surface-3"><div id="input" class="relative w-full min-w-0" contenteditable="true"></div><button>Send</button></div></main>');
  const target = findComposerTarget(doc, 'claude');
  assert(target);
  assert.notEqual(target.anchor.id, 'input');
  assert.equal(target.anchor.closest('[contenteditable]'), null);
});

for (const style of ['display:flex;flex-direction:row', 'display:grid', 'display:contents']) {
  test(`Claude falls back from an unsafe inner insertion layout (${style})`, () => {
    const doc = documentFor(`<main>${composer()}</main>`);
    doc.getElementById('surface')!.style.cssText = style;
    const target = findComposerTarget(doc, 'claude');
    assert(target);
    assert.notEqual(target.anchor.id, 'input-wrapper');
  });
}

test('Claude ambiguous surfaces are not chosen arbitrarily', () => {
  const doc = documentFor(`<main>${composer()}${composer()}</main>`);
  assert.equal(findComposerTarget(doc, 'claude'), null);
});

test('Claude surface with a second eligible editor does not qualify as a single composer', () => {
  const doc = documentFor(`<main>${composer()}</main>`);
  const extra = doc.createElement('textarea');
  doc.getElementById('surface')!.append(extra);
  assert.equal(findComposerTarget(doc, 'claude'), null);
});
