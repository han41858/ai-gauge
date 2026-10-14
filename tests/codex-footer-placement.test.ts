import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findComposerTarget } from '../src/content/selectors';
import { UsageStrip } from '../src/content/usage-strip';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { View } from '../src/shared/types';

const documentFor = (html: string) => new JSDOM(html, { url: 'https://chatgpt.com/codex' }).window.document;
const footer = (id = 'footer', suffix = '_8IVRO') => `<div id="${id}" class="flex ComposerLayoutFooter-${suffix} gap-2"><button type="button">Attach</button><button type="button">Send</button></div>`;
const enabledView = (): View => {
  const settings = defaults();
  settings.enabled.chatgpt = true;
  return {
    settings,
    permissions: { chatgpt: true, claude: false, gemini: false },
    snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') }
  };
};

for (const suffix of ['_8IVRO', 'changed-build-hash-42']) {
  test(`Codex legacy footer keeps the strip outside its full composer (${suffix})`, () => {
    const doc = documentFor(`<main><form><textarea id="input"></textarea>${footer('footer', suffix)}</form></main>`);
    const target = findComposerTarget(doc, 'codex');
    assert.equal(target?.anchor, doc.querySelector('form'));
    assert.equal(target?.placement, 'after');
    assert.equal(target?.input?.id, 'input');
    assert.equal(target.anchor.contains(target.input), true);
  });
}

test('Codex explicit footer can be identified before an editor is available', () => {
  const doc = documentFor(`<main>${footer()}</main>`);
  const target = findComposerTarget(doc, 'codex');
  assert.equal(target?.anchor.id, 'footer');
  assert.equal(target?.placement, 'after');
  assert.equal(target?.input, null);
});

test('Codex editor may also be contained by the footer', () => {
  const doc = documentFor(`<main>${footer()}</main>`);
  const input = doc.createElement('textarea');
  input.id = 'input';
  doc.getElementById('footer')!.prepend(input);
  assert.equal(findComposerTarget(doc, 'codex')?.input, input);
});

test('Codex explicit footer takes priority over a generic composer elsewhere', () => {
  const doc = documentFor(`<main><form id="generic"><textarea></textarea><button>Send</button></form><section>${footer()}</section></main>`);
  assert.equal(findComposerTarget(doc, 'codex')?.anchor.id, 'footer');
});

test('Codex class matching uses an entire token prefix, not an incidental substring', () => {
  for (const classes of ['otherComposerLayoutFooter-_8IVRO', 'x-ComposerLayoutFooter-_8IVRO', 'ComposerLayoutFooter-', 'ComposerLayoutFooter']) {
    const doc = documentFor(`<main><div class="${classes}"><button>Other</button></div></main>`);
    assert.equal(findComposerTarget(doc, 'codex'), null, classes);
  }
});

for (const wrapper of ['<div hidden>', '<div inert>', '<div aria-hidden="true">', '<div style="opacity:0">', '<div role="dialog">', '<div role="search">', '<nav>', '<div data-message-author-role="user">', '<div id="ai-gauge-usage-strip">', '<div contenteditable="true">']) {
  test(`Codex footer is ignored inside excluded content: ${wrapper}`, () => {
    const end = wrapper === '<nav>' ? '</nav>' : '</div>';
    const doc = documentFor(`<main>${wrapper}${footer()}${end}</main>`);
    assert.equal(findComposerTarget(doc, 'codex'), null);
  });
}

test('Codex hidden footer cannot compete with a visible footer', () => {
  const doc = documentFor(`<main><div hidden>${footer('hidden')}</div>${footer()}</main>`);
  assert.equal(findComposerTarget(doc, 'codex')?.anchor.id, 'footer');
});

test('Codex unrelated or editable descendants do not make an application container a footer', () => {
  const doc = documentFor('<main><div class="ComposerLayoutFooter-other"><article>Conversation</article><button>Send</button></div></main>');
  assert.equal(findComposerTarget(doc, 'codex'), null);
});

test('Codex multiple visible footers remain hidden without a unique editor association or focus', () => {
  const doc = documentFor(`<main><form><textarea></textarea>${footer('one')}</form><form><textarea></textarea>${footer('two')}</form></main>`);
  assert.equal(findComposerTarget(doc, 'codex'), null);
});

test('Codex focus selects the footer associated with its sibling input', () => {
  const doc = documentFor(`<main><form><textarea id="one-input"></textarea>${footer('one')}</form><form><textarea id="two-input"></textarea>${footer('two')}</form></main>`);
  doc.getElementById('two-input')!.focus();
  const target = findComposerTarget(doc, 'codex');
  assert.equal(target?.anchor, doc.getElementById('two')!.parentElement);
  assert.equal(target?.input?.id, 'two-input');
});

test('Codex focus within a footer can select it before its input appears', () => {
  const doc = documentFor(`<main><section>${footer('one')}</section><section>${footer('two')}</section></main>`);
  doc.querySelector<HTMLElement>('#two button')!.focus();
  assert.equal(findComposerTarget(doc, 'codex')?.anchor.id, 'two');
});

test('Codex a single unambiguous input association can choose among multiple footers', () => {
  const doc = documentFor(`<main><section>${footer('one')}</section><form><textarea id="input"></textarea>${footer('two')}</form></main>`);
  assert.equal(findComposerTarget(doc, 'codex')?.anchor, doc.getElementById('two')!.parentElement);
});

test('Codex footer composer target is stable after an outside strip is inserted and does not read input', () => {
  const doc = documentFor(`<main><form><textarea id="input">Private prompt</textarea>${footer()}</form></main>`);
  const input = doc.getElementById('input')!;
  for (const key of ['textContent', 'innerText', 'innerHTML', 'value']) {
    Object.defineProperty(input, key, { get() { throw new Error(`Prompt read: ${key}`); } });
  }
  const target = findComposerTarget(doc, 'codex')!;
  const markup = target.anchor.innerHTML;
  const row = doc.createElement('div');
  row.id = 'ai-gauge-usage-strip';
  target.anchor.after(row);
  assert.equal(row, target.anchor.nextElementSibling);
  assert.equal(target.anchor.innerHTML, markup);
  for (let n = 0; n < 20; n++) {
    const next = findComposerTarget(doc, 'codex');
    assert.equal(next?.anchor, target.anchor);
    assert.equal(next?.input, target.input);
    assert.equal(next?.placement, 'after');
  }
});

test('Codex-specific footer markers do not override Claude placement', () => {
  const doc = documentFor(`<main>${footer()}</main>`);
  assert.equal(findComposerTarget(doc, 'claude'), null);
});

test('Codex outside strip preserves footer flex layout and site controls', () => {
  const doc = documentFor(`<main><form><textarea id="input"></textarea>${footer()}</form></main>`);
  const anchor = doc.getElementById('footer')!;
  anchor.style.cssText = 'display:flex;flex-direction:row;flex-wrap:nowrap;gap:8px';
  const controls = [...anchor.children];
  const input = doc.getElementById('input')!;
  const inputParent = input.parentElement;
  let clicks = 0;
  controls[0]!.addEventListener('click', () => clicks++);
  const strip = new UsageStrip('codex', doc);
  strip.update(enabledView());
  const host = doc.getElementById('ai-gauge-usage-strip')!;
  assert.equal(doc.querySelector('form')!.nextElementSibling, host);
  assert.equal(host.style.flexBasis, '');
  assert.equal(anchor.style.flexWrap, 'nowrap');
  assert.equal(input.parentElement, inputParent);
  assert.deepEqual([...anchor.children], controls);
  (controls[0] as HTMLElement).click();
  assert.equal(clicks, 1);
  assert(host.getAttribute('aria-label')?.startsWith('사용량: '));
  const observer = new doc.defaultView!.MutationObserver(() => {});
  observer.observe(doc, { childList: true, attributes: true, subtree: true });
  for (let n = 0; n < 10; n++) strip.mount();
  assert.equal(doc.getElementById('ai-gauge-usage-strip'), host);
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();
});

test('Codex site children added later remain intact while the strip stays after its footer', () => {
  const doc = documentFor(`<main>${footer()}</main>`);
  const anchor = doc.getElementById('footer')!;
  const strip = new UsageStrip('codex', doc);
  strip.update(enabledView());
  const host = doc.getElementById('ai-gauge-usage-strip')!;
  const child = doc.createElement('button');
  child.textContent = 'New site action';
  anchor.append(child, doc.createTextNode(' '));
  strip.mount();
  assert.equal(anchor.nextElementSibling, host);
  assert.equal(child.parentElement, anchor);
  assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
});

for (const trigger of ['hidden', 'disabled', 'removed'] as const) {
  test(`Codex ${trigger} footer cleans up its outside row without changing inline wrap priority`, () => {
    const doc = documentFor(`<main>${footer()}</main>`);
    const anchor = doc.getElementById('footer')!;
    anchor.style.cssText = 'display:flex;flex-wrap:nowrap!important;color:red';
    const strip = new UsageStrip('codex', doc);
    const view = enabledView();
    strip.update(view);
    assert.equal(anchor.style.flexWrap, 'nowrap');
    if (trigger === 'hidden') anchor.hidden = true;
    if (trigger === 'removed') anchor.remove();
    if (trigger === 'disabled') view.settings.strips.codex = false;
    strip.update(view);
    assert.equal(doc.querySelector('#ai-gauge-usage-strip'), null);
    assert.equal(anchor.style.flexWrap, 'nowrap');
    assert.equal(anchor.style.getPropertyPriority('flex-wrap'), 'important');
    assert.equal(anchor.style.color, 'red');
  });
}

test('Codex outside strip never overrides nowrap coming from a stylesheet', () => {
  const doc = documentFor(`<style>.ComposerLayoutFooter-_8IVRO { display:flex;flex-wrap:nowrap }</style><main>${footer()}</main>`);
  const anchor = doc.getElementById('footer')!;
  const strip = new UsageStrip('codex', doc);
  strip.update(enabledView());
  assert.equal(anchor.style.flexWrap, '');
  strip.remove();
  assert.equal(anchor.style.getPropertyValue('flex-wrap'), '');
  assert.equal(doc.defaultView!.getComputedStyle(anchor).flexWrap, 'nowrap');
});

test('Codex target change places the row after the next footer and preserves both layouts', () => {
  const doc = documentFor(`<main>${footer('first')}<div hidden>${footer('second')}</div></main>`);
  const first = doc.getElementById('first')!, second = doc.getElementById('second')!;
  first.style.cssText = 'display:flex;flex-wrap:nowrap';
  second.style.cssText = 'display:flex;flex-wrap:nowrap';
  const strip = new UsageStrip('codex', doc);
  strip.update(enabledView());
  const host = doc.getElementById('ai-gauge-usage-strip')!;
  first.hidden = true;
  second.parentElement!.hidden = false;
  strip.mount();
  assert.equal(first.style.flexWrap, 'nowrap');
  assert.equal(second.style.flexWrap, 'nowrap');
  assert.equal(second.nextElementSibling, host);
  strip.remove();
  assert.equal(second.style.flexWrap, 'nowrap');
});

test('Codex preserves a later site wrap change during mounting and cleanup', () => {
  const doc = documentFor(`<main>${footer()}</main>`);
  const anchor = doc.getElementById('footer')!;
  anchor.style.cssText = 'display:flex;flex-wrap:nowrap';
  const strip = new UsageStrip('codex', doc);
  strip.update(enabledView());
  anchor.style.setProperty('flex-wrap', 'wrap-reverse', 'important');
  for (let n = 0; n < 3; n++) strip.mount();
  assert.equal(anchor.style.flexWrap, 'wrap-reverse');
  strip.remove();
  assert.equal(anchor.style.flexWrap, 'wrap-reverse');
  assert.equal(anchor.style.getPropertyPriority('flex-wrap'), 'important');
});

for (const style of ['display:flex;flex-direction:column;flex-wrap:nowrap', 'display:grid', 'display:flex;flex-wrap:wrap']) {
  test(`Codex leaves a footer layout unchanged when no wrap override is required (${style})`, () => {
    const doc = documentFor(`<main>${footer()}</main>`);
    const anchor = doc.getElementById('footer')!;
    anchor.style.cssText = style;
    const before = anchor.getAttribute('style');
    const strip = new UsageStrip('codex', doc);
    strip.update(enabledView());
    assert.equal(anchor.getAttribute('style'), before);
    assert.equal(anchor.nextElementSibling?.id, 'ai-gauge-usage-strip');
    strip.remove();
    assert.equal(anchor.getAttribute('style'), before);
  });
}
