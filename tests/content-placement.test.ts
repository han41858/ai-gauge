import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findComposer } from '../src/content/selectors';
import { UsageStrip } from '../src/content/usage-strip';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { Provider, View } from '../src/shared/types';

const enabledView = (): View => {
  const settings = defaults();
  settings.enabled = { chatgpt: true, work_codex: true, claude: true };
  return {
    settings, permissions: { chatgpt: true, work_codex: true, claude: true },
    snapshots: { chatgpt: emptySnapshot('chatgpt'), work_codex: emptySnapshot('work_codex'), claude: emptySnapshot('claude') }
  };
};
const documentFor = (html: string) => new JSDOM(html, { url: 'https://chatgpt.com/codex' }).window.document;
const mount = (doc: Document, provider: Provider) => {
  const strip = new UsageStrip(provider, doc);
  strip.update(enabledView());
  return strip;
};

test('Codex no-form Lexical editor mounts below the complete composer and preserves controls', () => {
  const doc = documentFor('<main><div id="composer"><div><div data-lexical-editor="true" contenteditable="true">private</div></div><div id="toolbar"><button aria-label="Submit">Send</button></div></div><p>Footer</p></main>');
  const input = doc.querySelector<HTMLElement>('[contenteditable]')!;
  const button = doc.querySelector('button')!;
  const initialMarkup = doc.getElementById('composer')!.innerHTML;
  let clicks = 0;
  button.addEventListener('click', () => clicks++);
  // Detection and mounting must never inspect the entered prompt.
  Object.defineProperty(input, 'textContent', { get() { throw new Error('Prompt read'); } });
  Object.defineProperty(input, 'innerText', { get() { throw new Error('Prompt read'); } });
  const strip = mount(doc, 'work_codex');
  strip.mount();
  assert.equal(doc.getElementById('composer')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
  assert.equal(doc.getElementById('composer')!.innerHTML, initialMarkup);
  assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
  button.click();
  assert.equal(clicks, 1);
});

test('Codex no-form textarea and sibling toolbar are treated as one composer', () => {
  const doc = documentFor('<main><div id="composer"><div><textarea>private</textarea></div><div role="toolbar"><button>Attach</button><button>Send</button></div></div></main>');
  const input = doc.querySelector('textarea')!;
  Object.defineProperty(input, 'value', { get() { throw new Error('Prompt read'); } });
  mount(doc, 'work_codex');
  assert.equal(doc.getElementById('composer')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
  assert.equal(doc.querySelector('textarea'), input);
});

test('Claude ProseMirror without role or form mounts outside its visual wrapper below toolbar', () => {
  const doc = documentFor('<main><div id="visual-box" style="border:1px solid gray;border-radius:16px"><div class="flex flex-col gap-3"><div class="ProseMirror" contenteditable="true">private</div><div id="toolbar"><button>Attach</button><button>Send</button></div></div></div><p>Disclaimer</p></main>');
  mount(doc, 'claude');
  const host = doc.getElementById('ai-gauge-usage-strip')!;
  assert.equal(host.previousElementSibling?.id, 'visual-box');
  assert.equal(doc.querySelector('#visual-box #ai-gauge-usage-strip'), null);
  assert.equal(doc.getElementById('toolbar')!.children.length, 2);
});

test('Claude fieldset boundary includes toolbar and strip stays outside the editor', () => {
  const doc = documentFor('<main><fieldset id="composer"><div role="textbox" contenteditable="true"></div><div><button>Send</button></div></fieldset></main>');
  mount(doc, 'claude');
  assert.equal(doc.getElementById('composer')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
  assert.equal(doc.querySelector('[contenteditable] #ai-gauge-usage-strip'), null);
});

test('fieldset inside a form does not place the strip before the form submit controls', () => {
  const doc = documentFor('<main><form id="composer"><fieldset><div class="ProseMirror" contenteditable="true"></div></fieldset><div id="toolbar"><button>Send</button></div></form></main>');
  mount(doc, 'claude');
  assert.equal(doc.getElementById('composer')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
  assert.equal(doc.querySelector('form #ai-gauge-usage-strip'), null);
});

for (const style of ['display:flex;flex-direction:row', 'display:grid', 'overflow:hidden']) {
  test(`composer inside constrained wrapper (${style}) mounts below whole layout`, () => {
    const doc = documentFor(`<main><div id="layout" style="${style}"><form><textarea></textarea><button>Send</button></form><button id="attachment">Attach</button></div><p>Footer</p></main>`);
    mount(doc, 'work_codex');
    assert.equal(doc.getElementById('layout')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
    assert.equal(doc.querySelector('#layout #ai-gauge-usage-strip'), null);
    assert.equal(doc.getElementById('attachment')!.parentElement?.id, 'layout');
  });
}

test('display contents wrapper resolves outside pinned composer layout without moving children', () => {
  const doc = documentFor('<main><div id="layout" style="overflow:clip"><div style="display:contents"><form data-chatgpt-composer><div class="ProseMirror" contenteditable="true"></div><button>Send</button></form></div><div id="shortcuts"><button>Files</button></div></div></main>');
  mount(doc, 'chatgpt');
  assert.equal(doc.getElementById('layout')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
  assert.equal(doc.getElementById('shortcuts')!.parentElement?.id, 'layout');
});

test('current ChatGPT form markers work without the legacy prompt-textarea id', () => {
  for (const marker of ['data-chatgpt-composer', 'data-type="unified-composer"']) {
    const doc = documentFor(`<main><form ${marker}><div class="ProseMirror" contenteditable="true"></div><button>Send</button></form></main>`);
    mount(doc, 'chatgpt');
    assert.equal(doc.querySelector('form')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
  }
});

test('hidden, inert, search, dialog and conversation editors cannot steal the composer', () => {
  const excluded = [
    '<div hidden>', '<div inert>', '<div aria-hidden="true">', '<div style="display:none">', '<div style="visibility:hidden">',
    '<div role="search">', '<div role="dialog">', '<nav>', '<aside>', '<div data-message-author-role="user">', '<div data-testid="conversation-turn-2">'
  ];
  for (const opening of excluded) {
    const closing = opening.startsWith('<nav') ? '</nav>' : opening.startsWith('<aside') ? '</aside>' : '</div>';
    const doc = documentFor(`<main>${opening}<div role="textbox" contenteditable="true"></div><button>Other</button>${closing}<div id="composer"><div data-lexical-editor="true" contenteditable="true"></div><button>Send</button></div></main>`);
    assert.equal(findComposer(doc, 'work_codex')?.id, 'composer', opening);
  }
});

test('multiple visible candidate composers fail quietly instead of choosing the first', () => {
  const doc = documentFor('<main><div><div role="textbox" contenteditable="true"></div><button>Send</button></div><div><div role="textbox" contenteditable="true"></div><button>Send</button></div></main>');
  for (const provider of ['work_codex', 'claude'] as const) {
    mount(doc, provider);
    assert.equal(doc.querySelector('#ai-gauge-usage-strip'), null);
  }
});

test('editor alone, document shell and deep unknown wrappers fail quietly', () => {
  for (const html of [
    '<main><div role="textbox" contenteditable="true"></div><button>Unrelated</button></main>',
    '<main><div><div role="textbox" contenteditable="true"></div></div></main>',
    '<div role="textbox" contenteditable="true"></div><button>Unrelated</button>',
    `<main>${'<div>'.repeat(10)}<div role="textbox" contenteditable="true"></div>${'</div>'.repeat(10)}<button>Unrelated</button></main>`
  ]) {
    const doc = documentFor(html);
    assert.equal(findComposer(doc, 'work_codex'), null);
    assert.equal(findComposer(doc, 'claude'), null);
  }
});

test('a horizontal document shell is not used as an insertion row', () => {
  const doc = documentFor('<main style="display:flex"><form><textarea></textarea><button>Send</button></form><section>Other application area</section></main>');
  assert.equal(findComposer(doc, 'work_codex'), null);
});

test('strip remounts after SPA replacement, moves with layout and cleans up hidden composer', () => {
  const doc = documentFor('<main><div id="first"><div data-lexical-editor="true" contenteditable="true"></div><button>Send</button></div></main>');
  const strip = mount(doc, 'work_codex');
  doc.getElementById('first')!.remove();
  strip.mount();
  assert.equal(doc.querySelector('#ai-gauge-usage-strip'), null);
  const composer = doc.createElement('div');
  composer.id = 'second';
  composer.innerHTML = '<div data-lexical-editor="true" contenteditable="true"></div><button>Send</button>';
  doc.querySelector('main')!.append(composer);
  strip.mount();
  strip.mount();
  assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
  assert.equal(composer.nextElementSibling?.id, 'ai-gauge-usage-strip');
  composer.hidden = true;
  strip.mount();
  assert.equal(doc.querySelector('#ai-gauge-usage-strip'), null);
  composer.hidden = false;
  strip.mount();
  assert.equal(composer.nextElementSibling?.id, 'ai-gauge-usage-strip');
  strip.remove();
  assert.equal(doc.querySelector('#ai-gauge-usage-strip'), null);
});
