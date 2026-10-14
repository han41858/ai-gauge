import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findComposerTarget } from '../src/content/selectors';
import { UsageStrip } from '../src/content/usage-strip';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { PageProvider, View } from '../src/shared/types';

const enabledView = (): View => {
  const settings = defaults();
  settings.enabled = { chatgpt: true, claude: true, gemini: false };
  return { settings, permissions: { chatgpt: true, claude: true, gemini: false }, snapshots: {
    chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini')
  } };
};
const fixture = (html: string) => new JSDOM(html, { url: 'https://chatgpt.com/codex' });

for (const provider of ['chatgpt', 'codex', 'claude'] satisfies PageProvider[]) {
  test(`${provider} keeps its row next to the composer inside a centered full-height page`, () => {
    const dom = fixture('<main><div id="stage" style="min-height:100vh;display:flex;flex-direction:column;justify-content:center;transition:height 150ms"><div id="slot"><form id="composer"><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form></div></div></main>');
    try {
      const doc = dom.window.document;
      const target = findComposerTarget(doc, provider);
      assert.equal(target?.anchor.id, 'composer', 'the page wrapper is not the composer exterior');
      const strip = new UsageStrip(provider, doc);
      strip.update(enabledView());
      assert.equal(doc.getElementById('composer')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
      assert.equal(doc.getElementById('ai-gauge-usage-strip')!.parentElement?.id, 'slot');
    } finally { dom.window.close(); }
  });
}

test('a home composer stays put while helper siblings appear and disappear', () => {
  const dom = fixture('<main><div id="stage" style="min-height:100vh"><div id="slot"><form id="composer"><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form><p id="helper" hidden>Shortcut hints</p></div></div></main>');
  try {
    const doc = dom.window.document, strip = new UsageStrip('chatgpt', doc);
    strip.update(enabledView());
    const host = doc.getElementById('ai-gauge-usage-strip');
    assert(host);
    const observer = new dom.window.MutationObserver(() => undefined);
    observer.observe(doc, { childList: true, subtree: true });
    for (let i = 0; i < 30; i++) {
      doc.getElementById('helper')!.hidden = i % 2 === 0;
      strip.mount();
      assert.equal(doc.getElementById('composer')!.nextElementSibling, host);
    }
    assert.equal(observer.takeRecords().length, 0, 'site helper visibility must not reparent the strip');
    observer.disconnect();
  } finally { dom.window.close(); }
});

test('Claude exits a painted composer shell but never its full-height surrounding layout', () => {
  const dom = fixture('<main><div id="stage" style="min-height:100vh"><div id="centered" style="display:flex;flex-direction:column;justify-content:center"><div id="visual-box" style="border:1px solid gray;border-radius:16px"><div id="composer"><div class="ProseMirror" contenteditable="true"></div><div role="toolbar"><button>Attach</button><button>Send</button></div></div></div></div></div></main>');
  try {
    const doc = dom.window.document;
    assert.equal(findComposerTarget(doc, 'claude')?.anchor.id, 'visual-box');
    const strip = new UsageStrip('claude', doc);
    strip.update(enabledView());
    assert.equal(doc.getElementById('visual-box')!.nextElementSibling?.id, 'ai-gauge-usage-strip');
    assert.equal(doc.getElementById('ai-gauge-usage-strip')!.parentElement?.id, 'centered');
    assert.equal(doc.querySelector('#visual-box #ai-gauge-usage-strip'), null);
  } finally { dom.window.close(); }
});

test('a full-height decorated panel is not mistaken for a compact composer shell', () => {
  const dom = fixture('<main><div id="panel" style="border:1px solid gray"><div id="composer"><div id="input" contenteditable="true"></div><div role="toolbar"><button>Send</button></div></div></div></main>');
  try {
    const doc = dom.window.document;
    const box = (top: number, height: number) => ({ left: 0, right: 600, top, bottom: top + height, width: 600, height, x: 0, y: top, toJSON: () => ({}) });
    Object.defineProperty(doc.documentElement, 'getClientRects', { value: () => [box(0, 768)] });
    Object.defineProperty(doc.getElementById('input')!, 'getClientRects', { value: () => [box(300, 50)] });
    Object.defineProperty(doc.getElementById('composer')!, 'getBoundingClientRect', { value: () => box(300, 100) });
    Object.defineProperty(doc.getElementById('panel')!, 'getBoundingClientRect', { value: () => box(0, 768) });
    assert.equal(findComposerTarget(doc, 'claude')?.anchor.id, 'composer');
  } finally { dom.window.close(); }
});

test('Codex home role-less editor stays next to its toolbar inside centered wrappers', () => {
  const dom = fixture('<main style="display:grid;min-height:100vh"><section style="display:flex;flex-direction:column;justify-content:center"><div id="slot"><div id="composer"><div><div contenteditable="plaintext-only"></div></div><div><button type="button">Choose environment</button><button type="submit">Send</button></div></div></div></section></main>');
  try {
    const target = findComposerTarget(dom.window.document, 'codex');
    assert.equal(target?.anchor.id, 'composer');
    assert(target?.anchor.querySelector('button[type="submit"]'));
  } finally { dom.window.close(); }
});

test('an explicit Codex composer inside a broad form is recognized before unrelated editors', () => {
  const dom = fixture('<main><form><textarea readonly></textarea><div data-testid="codex-composer" id="composer"><div contenteditable="plaintext-only"></div></div><section><textarea></textarea></section></form></main>');
  try {
    assert.equal(findComposerTarget(dom.window.document, 'codex')?.anchor.id, 'composer');
  } finally { dom.window.close(); }
});
