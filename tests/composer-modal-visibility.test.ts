import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { UsageStrip } from '../src/content/usage-strip';
import { findComposerTarget, hasStreamingControl } from '../src/content/selectors';
import { resolvePageProvider } from '../src/content/page-provider';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import { PAGE_PROVIDERS, type PageProvider, type View } from '../src/shared/types';

const urls: Record<PageProvider, string> = {
  chatgpt: 'https://chatgpt.com/c/example', codex: 'https://chatgpt.com/codex',
  claude: 'https://claude.ai/chat/example', gemini: 'https://gemini.google.com/app/example'
};
const marker = (provider: Exclude<PageProvider, 'gemini'>) => provider === 'claude'
  ? 'data-cds="ChatComposerChin"'
  : `class="${provider === 'chatgpt' ? 'ComposerLayoutBody' : 'ComposerLayoutRoot'}-currentBuild"`;
const composer = (provider: PageProvider, prefix: string) => provider === 'gemini'
  ? `<input-area-v2 id="${prefix}-anchor"><rich-textarea><div id="${prefix}-input" contenteditable="true"></div></rich-textarea><button>Send</button></input-area-v2>`
  : provider === 'claude'
    ? `<form><textarea id="${prefix}-input"></textarea><div id="${prefix}-anchor" ${marker(provider)}><button>Send</button></div></form>`
    : `<form><div id="${prefix}-anchor" ${marker(provider)}><textarea id="${prefix}-input"></textarea><button>Send</button></div></form>`;

function fixture(provider: PageProvider) {
  const dom = new JSDOM(`<div id="app"><main>${composer(provider, 'original')}</main></div>`, { url: urls[provider] });
  const doc = dom.window.document, roots = new Map<HTMLElement, ShadowRoot>();
  const originalShadow = dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow = function(this: HTMLElement, options: ShadowRootInit) {
    const root = originalShadow.call(this, options); roots.set(this, root); return root;
  };
  const settings = defaults(); settings.enabled = { chatgpt: true, claude: true, gemini: true };
  const view: View = { settings, permissions: { chatgpt: true, claude: true, gemini: true }, snapshots: {
    chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini')
  } };
  const strip = new UsageStrip(provider, doc);
  strip.update(view);
  const host = doc.getElementById('ai-gauge-usage-strip');
  assert(host, `${provider}: fixture must begin with a mounted strip`);
  const root = roots.get(host)!;
  const app = doc.getElementById('app')!, anchor = doc.getElementById('original-anchor')!;
  const openDialog = () => {
    const dialog = doc.createElement('div');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `<label>Rename conversation<input aria-label="Conversation name"></label>${composer(provider, 'fake')}`;
    doc.body.append(dialog);
    dialog.querySelector<HTMLElement>('#fake-input')!.focus();
    return dialog;
  };
  return { dom, doc, app, anchor, strip, host, root, view, openDialog };
}

test('opacity and content-visibility still remove physically hidden composers behind a modal', () => {
  for (const provider of ['chatgpt', 'gemini'] as const) for (const style of ['opacity:0', 'content-visibility:hidden']) {
    const page = fixture(provider);
    try {
      page.openDialog(); page.app.setAttribute('aria-hidden', 'true');
      page.app.style.cssText = style;
      page.strip.mount();
      assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), null, `${provider}: ${style}`);
      assert.equal(page.host.isConnected, false);
    } finally { page.dom.window.close(); }
  }
});

test('a new strip cannot discover an isolated background composer while a modal is already open', () => {
  for (const provider of ['chatgpt', 'gemini'] as const) {
    const page = fixture(provider);
    try {
      page.strip.remove();
      page.openDialog(); page.app.setAttribute('inert', '');
      const fresh = new UsageStrip(provider, page.doc);
      fresh.update(page.view);
      assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), null, provider);
      assert.equal(findComposerTarget(page.doc, provider), null);
    } finally { page.dom.window.close(); }
  }
});

test('visible role dialogs without aria-modal and open native dialogs retain an existing strip', () => {
  for (const provider of ['chatgpt', 'gemini'] as const) for (const kind of ['role', 'native']) {
    const page = fixture(provider);
    try {
      const dialog = page.doc.createElement(kind === 'native' ? 'dialog' : 'div');
      if (kind === 'native') dialog.setAttribute('open', '');
      else dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<input aria-label="Conversation name">';
      page.doc.body.append(dialog); page.app.setAttribute('aria-hidden', 'true');
      page.strip.mount();
      assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), page.host, `${provider}: ${kind}`);
      assert.equal(page.anchor.nextElementSibling, page.host);
      page.app.removeAttribute('aria-hidden'); dialog.remove();
      page.strip.mount();
      assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), page.host);
    } finally { page.dom.window.close(); }
  }
});

test('closed native dialogs and dialogs hidden by CSS or accessibility attributes do not retain a strip', () => {
  for (const kind of ['closed native', 'display:none', 'aria-hidden', 'inert'] as const) {
    const page = fixture('chatgpt');
    try {
      const dialog = kind === 'closed native' ? page.doc.createElement('dialog') : page.openDialog();
      if (kind === 'closed native') page.doc.body.append(dialog);
      else if (kind === 'display:none') dialog.style.display = 'none';
      else dialog.setAttribute(kind, kind === 'aria-hidden' ? 'true' : '');
      page.app.setAttribute('inert', '');
      page.strip.mount();
      assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), null, kind);
    } finally { page.dom.window.close(); }
  }
});

test('moving a retained composer into a dialog removes its old strip', () => {
  for (const provider of ['chatgpt', 'gemini'] as const) {
    const page = fixture(provider);
    try {
      const dialog = page.openDialog(); page.app.setAttribute('inert', '');
      dialog.append(page.anchor);
      page.strip.mount();
      assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), null, provider);
      assert.equal(page.host.isConnected, false);
      assert.equal(findComposerTarget(page.doc, provider), null);
    } finally { page.dom.window.close(); }
  }
});

test('a redirected Codex page keeps its footer context at chatgpt.com while the application is isolated', () => {
  const page = fixture('codex');
  try {
    page.dom.reconfigure({ url: 'https://chatgpt.com/' });
    const footer = page.doc.createElement('div'); footer.className = 'ComposerLayoutFooter-currentBuild';
    page.anchor.append(footer);
    assert.equal(resolvePageProvider(page.doc, page.dom.window.location.href), 'codex');
    const dialog = page.openDialog(); page.app.setAttribute('aria-hidden', 'true');
    assert.equal(resolvePageProvider(page.doc, page.dom.window.location.href), 'codex');
    page.strip.mount();
    assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), page.host);
    assert.equal(page.dom.window.location.href, 'https://chatgpt.com/');
    dialog.append(footer);
    assert.equal(resolvePageProvider(page.doc, page.dom.window.location.href), 'chatgpt', 'a footer inside the dialog cannot establish Codex context');
  } finally { page.dom.window.close(); }
});

test('a modal does not turn a background stop control into a false response completion', () => {
  for (const provider of ['chatgpt', 'gemini'] as const) {
    const page = fixture(provider);
    try {
      const stop = page.anchor.querySelector('button')!;
      const attribute = provider === 'gemini' ? 'data-test-id' : 'data-testid';
      stop.setAttribute(attribute, 'stop-button');
      assert.equal(hasStreamingControl(page.doc, provider), true);
      const dialog = page.openDialog(); page.app.setAttribute('inert', '');
      assert.equal(hasStreamingControl(page.doc, provider), true, provider);
      dialog.querySelector('button')!.setAttribute(attribute, 'stop-button');
      stop.removeAttribute(attribute);
      assert.equal(hasStreamingControl(page.doc, provider), false, 'a fake stop button inside the dialog does not count');
      stop.setAttribute(attribute, 'stop-button');
      page.app.removeAttribute('inert'); dialog.remove();
      assert.equal(hasStreamingControl(page.doc, provider), true);
      page.app.setAttribute('inert', '');
      assert.equal(hasStreamingControl(page.doc, provider), false, 'ordinary hidden controls remain excluded without a modal');
    } finally { page.dom.window.close(); }
  }
});

for (const provider of PAGE_PROVIDERS) {
  for (const attribute of ['aria-hidden', 'inert'] as const) {
    test(`${provider} preserves its mounted strip while a sibling modal applies ${attribute} to the application`, () => {
      const page = fixture(provider);
      const { dom, doc, app, anchor, strip, host, root } = page;
      try {
        const progress = root.querySelector('progress'), gauge = root.querySelector('.usage-gauge');
        const url = dom.window.location.href;
        const dialog = page.openDialog();
        app.setAttribute(attribute, attribute === 'aria-hidden' ? 'true' : '');
        for (let i = 0; i < 3; i++) strip.mount();
        assert.equal(doc.getElementById('ai-gauge-usage-strip'), host, 'modal opening must retain the original strip node');
        assert.equal(anchor.nextElementSibling, host);
        assert.equal(root.querySelector('progress'), progress);
        assert.equal(root.querySelector('.usage-gauge'), gauge);
        assert.equal(dialog.querySelector('#ai-gauge-usage-strip'), null, 'a rename dialog cannot acquire a usage strip');
        const selected = findComposerTarget(doc, provider);
        assert(!selected || !dialog.contains(selected.anchor), 'a fake dialog composer cannot become the target');
        assert.equal(app.getAttribute(attribute), attribute === 'aria-hidden' ? 'true' : '', 'site accessibility isolation must stay intact');
        assert.equal(dom.window.location.href, url, 'the reproduction does not navigate');
        app.removeAttribute(attribute); dialog.remove();
        strip.mount();
        assert.equal(doc.getElementById('ai-gauge-usage-strip'), host, 'closing the modal must reuse the same strip');
        assert.equal(anchor.nextElementSibling, host);
        assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
      } finally { dom.window.close(); }
    });

    test(`${provider} still removes a strip under ${attribute} without an active modal`, () => {
      const { dom, doc, app, strip, host } = fixture(provider);
      try {
        app.setAttribute(attribute, attribute === 'aria-hidden' ? 'true' : '');
        strip.mount();
        assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
        assert.equal(host.isConnected, false);
      } finally { dom.window.close(); }
    });
  }

  test(`${provider} keeps a visible original composer outside a dialog with a competing fake composer`, () => {
    const page = fixture(provider);
    try {
      const dialog = page.openDialog();
      page.strip.mount();
      assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), page.host);
      assert.equal(page.anchor.nextElementSibling, page.host);
      assert.equal(dialog.querySelector('#ai-gauge-usage-strip'), null);
      assert.equal(findComposerTarget(page.doc, provider)?.anchor, page.anchor);
    } finally { page.dom.window.close(); }
  });

  for (const change of ['display:none', 'visibility:hidden', 'hidden', 'anchor removed', 'input removed'] as const) {
    test(`${provider} removes the old strip for ${change} even while a modal is open`, () => {
      const page = fixture(provider);
      try {
        page.openDialog(); page.app.setAttribute('inert', '');
        if (change === 'display:none') page.app.style.display = 'none';
        else if (change === 'visibility:hidden') page.app.style.visibility = 'hidden';
        else if (change === 'hidden') page.app.hidden = true;
        else if (change === 'anchor removed') page.anchor.remove();
        else page.doc.getElementById('original-input')!.remove();
        page.strip.mount();
        assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), null);
        assert.equal(page.host.isConnected, false);
      } finally { page.dom.window.close(); }
    });
  }

  test(`${provider} does not treat a hidden dialog as an active modal`, () => {
    const page = fixture(provider);
    try {
      const dialog = page.openDialog(); dialog.hidden = true;
      page.app.setAttribute('aria-hidden', 'true');
      page.strip.mount();
      assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), null);
    } finally { page.dom.window.close(); }
  });

  if (provider !== 'gemini') {
    test(`${provider} removes the old strip when its marker changes during a modal`, () => {
      const page = fixture(provider);
      try {
        page.openDialog(); page.app.setAttribute('aria-hidden', 'true');
        if (provider === 'claude') page.anchor.setAttribute('data-cds', 'OtherChin');
        else page.anchor.className = 'UnrelatedLayout-currentBuild';
        page.strip.mount();
        assert.equal(page.doc.getElementById('ai-gauge-usage-strip'), null);
        assert.equal(page.host.isConnected, false);
      } finally { page.dom.window.close(); }
    });
  }
}
