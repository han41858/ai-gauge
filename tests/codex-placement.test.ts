import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findComposer, findComposerTarget } from '../src/content/selectors';

const documentFor = (html: string) => new JSDOM(html, { url: 'https://chatgpt.com/codex/tasks/synthetic' }).window.document;
const rect = (left: number, top: number, width: number, height: number) => ({
  x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return {}; }
});
function rendered(doc: Document, boxes: Record<string, ReturnType<typeof rect> | null>) {
  Object.defineProperty(doc.documentElement, 'getClientRects', { value: () => [rect(0, 0, 1024, 768)] });
  for (const [id, box] of Object.entries(boxes)) {
    Object.defineProperty(doc.getElementById(id)!, 'getClientRects', { value: () => box ? [box] : [] });
  }
}

test('Codex task follow-up composer may live in an aside and section without private selector markers', () => {
  const doc = documentFor('<main><section>Task output</section><aside style="display:flex;flex-direction:column"><header>Task</header><section><div id="composer"><div><div id="input" contenteditable="plaintext-only"></div></div><div role="toolbar"><button type="submit">Send</button></div></div><p>Footer</p></section></aside></main>');
  const target = findComposerTarget(doc, 'work_codex');
  assert.equal(target?.input?.id, 'input');
  assert.equal(target?.anchor.id, 'composer');
  assert.equal(target?.anchor.closest('aside'), doc.querySelector('aside'));
});

for (const editable of ['contenteditable', 'contenteditable="true"', 'contenteditable="plaintext-only"', 'contenteditable="TRUE"']) {
  test(`Codex identifies an unlabelled editing host (${editable})`, () => {
    const doc = documentFor(`<main><section id="composer"><div id="input" ${editable}><span contenteditable="true"></span></div><div role="toolbar"><button>Send</button></div></section><p>Footer</p></main>`);
    assert.equal(findComposerTarget(doc, 'work_codex')?.input?.id, 'input');
    assert.equal(findComposer(doc, 'work_codex')?.id, 'composer');
  });
}

test('deep editor and layout wrappers preserve a bounded task composer', () => {
  const doc = documentFor(`<main><div id="outer">${'<div>'.repeat(12)}<div id="composer">${'<div>'.repeat(12)}<div contenteditable="true"></div>${'</div>'.repeat(12)}<div role="toolbar"><button>Send</button></div></div>${'</div>'.repeat(12)}</div><p>Footer</p></main>`);
  assert.equal(findComposer(doc, 'work_codex')?.id, 'composer');
});

for (const shell of ['display:flex', 'display:grid']) {
  test(`Codex task split pane preserves an inner insertion row when the outer shell uses ${shell}`, () => {
    const doc = documentFor(`<main style="${shell}"><aside>Other task</aside><section><div id="inner"><form><textarea></textarea><button>Send</button></form></div></section></main>`);
    const target = findComposerTarget(doc, 'work_codex');
    assert.equal(target?.anchor, doc.querySelector('form'));
    const strip = doc.createElement('div');
    strip.id = 'ai-gauge-usage-strip';
    target!.anchor.after(strip);
    assert.equal(strip.parentElement?.id, 'inner');
    assert.equal(findComposer(doc, 'work_codex'), target!.anchor);
  });
}

test('zero-size and offscreen resize mirrors do not suppress the actual follow-up editor', () => {
  for (const mirror of [null, rect(20, 20, 0, 0), rect(-2000, 20, 300, 100), rect(20, 2000, 300, 100)]) {
    const doc = documentFor('<main><form><textarea id="mirror"></textarea><div id="input" contenteditable="true"></div><button>Send</button></form></main>');
    rendered(doc, { mirror, input: rect(20, 500, 400, 100) });
    assert.equal(findComposerTarget(doc, 'work_codex')?.input?.id, 'input');
  }
});

test('transparent or content-visibility hidden editors do not compete with a real composer', () => {
  for (const style of ['opacity:0', 'content-visibility:hidden']) {
    const doc = documentFor(`<main><form style="${style}"><textarea></textarea></form><form id="composer"><textarea></textarea><button>Send</button></form></main>`);
    assert.equal(findComposer(doc, 'work_codex')?.id, 'composer');
  }
});

test('an unrelated unbounded editor cannot suppress a bounded Codex composer', () => {
  const doc = documentFor('<main><div contenteditable="true"></div><section><form id="composer"><textarea></textarea><button>Send</button></form><p>Footer</p></section></main>');
  assert.equal(findComposer(doc, 'work_codex')?.id, 'composer');
});

test('focused follow-up composer can be chosen when two actual composers share a task screen', () => {
  const doc = documentFor('<main><form><textarea id="first"></textarea></form><section><form id="composer"><div id="focused" contenteditable="true" tabindex="0"></div><button>Send</button></form><p>Footer</p></section></main>');
  assert.equal(findComposer(doc, 'work_codex'), null);
  doc.getElementById('focused')!.focus();
  assert.equal(findComposerTarget(doc, 'work_codex')?.input?.id, 'focused');
});

test('noneditable, search, modal, history and whole-document containers are rejected', () => {
  const fragments = [
    '<div contenteditable="false"></div><button>Send</button>',
    '<div contenteditable="invalid"></div><button>Send</button>',
    '<div role="search"><form><textarea></textarea><button>Send</button></form></div>',
    '<dialog open><form><textarea></textarea><button>Send</button></form></dialog>',
    '<div data-message-author-role="user"><form><textarea></textarea><button>Send</button></form></div>',
    '<div role="application"><div contenteditable></div><button>Send</button></div>',
    '<div><header>Application header</header><section>Task output</section><div contenteditable></div><button>Unrelated action</button></div>'
  ];
  for (const fragment of fragments) {
    const doc = documentFor(`<main>${fragment}</main>`);
    assert.equal(findComposer(doc, 'work_codex'), null, fragment);
  }
});

test('repeated composer detection stays identical after the extension inserts its own row', () => {
  const doc = documentFor('<main><aside><header>Task</header><section><div id="outer"><div><form><div id="input" contenteditable></div><button>Send</button></form></div></div><p>Footer</p></section></aside></main>');
  const before = findComposerTarget(doc, 'work_codex');
  assert(before);
  const strip = doc.createElement('div');
  strip.id = 'ai-gauge-usage-strip';
  // Even future controls in our own row must not become site composer controls.
  strip.innerHTML = '<div role="toolbar"><button>Refresh</button><textarea></textarea></div>';
  before.anchor.after(strip);
  for (let i = 0; i < 10; i++) {
    const after = findComposerTarget(doc, 'work_codex');
    assert.equal(after?.input, before.input);
    assert.equal(after?.anchor, before.anchor);
  }
});

test('detection does not access entered text or textarea values', () => {
  const doc = documentFor('<main><form id="composer"><textarea id="input"></textarea><button>Send</button></form></main>');
  const input = doc.getElementById('input')!;
  for (const key of ['textContent', 'innerText', 'innerHTML', 'value']) {
    Object.defineProperty(input, key, { get() { throw new Error(`Private input accessed: ${key}`); } });
  }
  assert.equal(findComposerTarget(doc, 'work_codex')?.input, input);
});
