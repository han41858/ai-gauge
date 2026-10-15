import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bundleEntry } from './helpers/bundle';
import { UsageStrip } from '../src/content/usage-strip';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { View } from '../src/shared/types';

const enabledView = (): View => {
  const settings = defaults();
  settings.enabled.chatgpt = true;
  return {
    settings,
    permissions: { chatgpt: true, claude: true, gemini: false },
    snapshots: {
      chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini')
    }
  };
};
const fixture = () => new JSDOM('<main><form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form><p>Footer</p></main>', { url: 'https://chatgpt.com/' });

test('repeated checks of an unchanged composer leave the same strip node in place', () => {
  const dom = fixture(), doc = dom.window.document;
  const strip = new UsageStrip('chatgpt', doc);
  strip.update(enabledView());
  const original = doc.getElementById('ai-gauge-usage-strip');
  assert(original);
  const observer = new dom.window.MutationObserver(() => undefined);
  observer.observe(doc, { childList: true, subtree: true });
  for (let i = 0; i < 20; i++) strip.mount();
  assert.equal(doc.getElementById('ai-gauge-usage-strip'), original);
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();
  dom.window.close();
});

test('independent content instances do not fight over duplicate strip placement', () => {
  // Separate unpacked extension installations have isolated JS worlds but share
  // this document. Each owns a separate class instance and mount guard.
  const dom = fixture(), doc = dom.window.document;
  const first = new UsageStrip('chatgpt', doc);
  const second = new UsageStrip('chatgpt', doc);
  first.update(enabledView());
  second.update(enabledView());
  const observer = new dom.window.MutationObserver(() => undefined);
  observer.observe(doc, { childList: true, subtree: true });
  for (let i = 0; i < 20; i++) { first.mount(); second.mount(); }
  const mutations = observer.takeRecords();
  observer.disconnect();
  assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1, 'only one instance owns the visible strip');
  assert.equal(mutations.length, 0, 'competing observers must not endlessly move their hosts ahead of one another');
  dom.window.close();
});

test('a non-owning instance cleanup leaves the visible owner intact and can take over after it leaves', () => {
  const dom = fixture(), doc = dom.window.document;
  try {
    const first = new UsageStrip('chatgpt', doc);
    const second = new UsageStrip('chatgpt', doc);
    first.update(enabledView());
    const ownerHost = doc.getElementById('ai-gauge-usage-strip');
    assert(ownerHost);
    second.update(enabledView());
    second.remove();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), ownerHost);
    first.remove();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null);
    second.mount();
    assert.equal(doc.querySelectorAll('#ai-gauge-usage-strip').length, 1);
  } finally { dom.window.close(); }
});

test('a temporary second editor does not remove the existing connected composer strip', () => {
  const dom = fixture(), doc = dom.window.document;
  try {
    const strip = new UsageStrip('chatgpt', doc);
    strip.update(enabledView());
    const original = doc.getElementById('ai-gauge-usage-strip');
    assert(original);
    const transient = doc.createElement('form');
    transient.setAttribute('data-chatgpt-composer', '');
    transient.innerHTML = '<div contenteditable="true"></div><button>Send</button>';
    doc.querySelector('main')!.append(transient);
    strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), original, 'an ambiguous discovery pass should not destroy a still-connected anchor');
    transient.remove();
    strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), original, 'settled discovery retains the same host');
    doc.querySelector('form')!.hidden = true;
    strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null, 'actually hiding the original composer still removes the strip');
  } finally { dom.window.close(); }
});

const contentBundle = () => bundleEntry('src/content/index.ts');
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test('bundled content keeps its strip through a transient runtime failure and later updates', async () => {
  const dom = new JSDOM('<main><form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form><p>Footer</p></main>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const view = enabledView();
  const runtimeListeners = new Set<(message: unknown, sender: { id: string }) => void>();
  const storageListeners = new Set<() => void>();
  let rejectNext = false, calls = 0;
  const mockedChrome = {
    runtime: {
      id: 'fixture', getManifest: () => ({ version: '0.1.2' }),
      sendMessage: async () => {
        calls++;
        if (rejectNext) { rejectNext = false; throw new Error('Could not establish connection. Receiving end does not exist.'); }
        return { ok: true, view: structuredClone(view) };
      },
      onMessage: { addListener: (f: (message: unknown, sender: { id: string }) => void) => runtimeListeners.add(f), removeListener: (f: (message: unknown, sender: { id: string }) => void) => runtimeListeners.delete(f) }
    },
    storage: { onChanged: { addListener: (f: () => void) => storageListeners.add(f), removeListener: (f: () => void) => storageListeners.delete(f) } }
  };
  Object.assign(dom.window, { chrome: mockedChrome });
  const invalidate = () => { for (const listener of runtimeListeners) listener({ type: 'invalidate' }, { id: 'fixture' }); };
  try {
    dom.window.eval(contentBundle());
    await flush();
    const original = dom.window.document.getElementById('ai-gauge-usage-strip');
    assert(original);
    assert.match(original.getAttribute('aria-label')!, /사용량 확인 중/);
    rejectNext = true;
    invalidate();
    await flush();
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), original, 'temporary messaging errors preserve the last useful display');
    assert.equal(dom.window.__aiGaugeMounted, true, 'the event bridge remains available for recovery');
    assert.equal(runtimeListeners.size, 1);
    assert.equal(storageListeners.size, 1);
    const callsAfterFailure = calls;
    view.snapshots.chatgpt = { ...emptySnapshot('chatgpt'), errorCode: 'network' };
    invalidate();
    await flush();
    assert(calls > callsAfterFailure, 'subsequent invalidation requests a current view');
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), original);
    assert.match(original.getAttribute('aria-label')!, /연결 확인 중/);

    view.settings.strips.chatgpt = false;
    invalidate();
    await flush();
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null, 'explicitly disabled display is still removed');

    view.settings.strips.chatgpt = true;
    invalidate();
    await flush();
    assert(dom.window.document.getElementById('ai-gauge-usage-strip'));
    view.permissions.chatgpt = false;
    invalidate();
    await flush();
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null, 'revoked permission still removes the display');
    assert.equal(dom.window.__aiGaugeMounted, false);
    assert.equal(runtimeListeners.size, 0);
    assert.equal(storageListeners.size, 0);
  } finally {
    for (const listener of [...runtimeListeners]) listener({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] }, { id: 'fixture' });
    dom.window.close();
  }
});

test('trusted host revocation stops bundled content even when further view requests are denied', async () => {
  const dom = new JSDOM('<main><form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form></main>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const runtimeListeners = new Set<(message: unknown, sender: { id: string }) => void>();
  const storageListeners = new Set<() => void>();
  let denyViews = false, calls = 0;
  Object.assign(dom.window, { chrome: {
    runtime: {
      id: 'fixture', getManifest: () => ({ version: '0.1.2' }),
      sendMessage: async () => {
        calls++;
        return denyViews ? { ok: false } : { ok: true, view: enabledView() };
      },
      onMessage: { addListener: (f: (message: unknown, sender: { id: string }) => void) => runtimeListeners.add(f), removeListener: (f: (message: unknown, sender: { id: string }) => void) => runtimeListeners.delete(f) }
    },
    storage: { onChanged: { addListener: (f: () => void) => storageListeners.add(f), removeListener: (f: () => void) => storageListeners.delete(f) } }
  } });
  const notify = (message: unknown, senderId = 'fixture') => {
    for (const listener of runtimeListeners) listener(message, { id: senderId });
  };
  try {
    dom.window.eval(contentBundle());
    await flush();
    const original = dom.window.document.getElementById('ai-gauge-usage-strip');
    assert(original);
    // Background denies content view requests after the host grant disappears;
    // cleanup cannot depend on receiving a new View with permissions=false.
    denyViews = true;
    notify({ type: 'invalidate' });
    await flush();
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), original);
    notify({ type: 'permissions-revoked', origins: ['https://claude.ai/*'] });
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), original, 'revoking Claude does not remove an OpenAI strip');
    notify({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] }, 'untrusted-extension');
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), original, 'an unrelated extension cannot shut down this bridge');
    const callsBeforeRevocation = calls;
    notify({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] });
    await flush();
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    assert.equal(dom.window.__aiGaugeMounted, false);
    assert.equal(runtimeListeners.size, 0);
    assert.equal(storageListeners.size, 0);
    assert.equal(calls, callsBeforeRevocation, 'cleanup does not require another denied view request');
  } finally {
    for (const listener of [...runtimeListeners]) listener({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] }, { id: 'fixture' });
    dom.window.close();
  }
});

test('a late successful view cannot remount content after its host permission was revoked', async () => {
  const dom = new JSDOM('<main><form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form></main>', {
    url: 'https://chatgpt.com/', runScripts: 'outside-only'
  });
  const runtimeListeners = new Set<(message: unknown, sender: { id: string }) => void>();
  const deferred: { resolve?: (value: unknown) => void } = {};
  let holdReply = false;
  Object.assign(dom.window, { chrome: {
    runtime: {
      id: 'fixture', getManifest: () => ({ version: '0.1.2' }),
      sendMessage: () => holdReply
        ? new Promise(resolve => { deferred.resolve = resolve; })
        : Promise.resolve({ ok: true, view: enabledView() }),
      onMessage: { addListener: (f: (message: unknown, sender: { id: string }) => void) => runtimeListeners.add(f), removeListener: (f: (message: unknown, sender: { id: string }) => void) => runtimeListeners.delete(f) }
    },
    storage: { onChanged: { addListener: () => undefined, removeListener: () => undefined } }
  } });
  const notify = (message: unknown) => { for (const listener of runtimeListeners) listener(message, { id: 'fixture' }); };
  try {
    dom.window.eval(contentBundle());
    await flush();
    assert(dom.window.document.getElementById('ai-gauge-usage-strip'));
    holdReply = true;
    notify({ type: 'invalidate' });
    await flush();
    assert(deferred.resolve);
    notify({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] });
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    deferred.resolve({ ok: true, view: enabledView() });
    await flush();
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null, 'the old authorized reply cannot resurrect a stopped content instance');
    assert.equal(dom.window.__aiGaugeMounted, false);
    assert.equal(runtimeListeners.size, 0);
  } finally {
    for (const listener of [...runtimeListeners]) listener({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] }, { id: 'fixture' });
    dom.window.close();
  }
});

test('bundled content follows a focused Codex composer without unrelated DOM changes', async () => {
  const dom = new JSDOM('<main><div id="first"><textarea></textarea><button>Send</button></div><div id="second"><textarea></textarea><button>Send</button></div></main>', {
    url: 'https://chatgpt.com/codex', runScripts: 'outside-only'
  });
  const view = enabledView();
  view.settings.enabled.chatgpt = true;
  const runtimeListeners = new Set<(message: unknown, sender: { id: string }) => void>();
  let calls = 0;
  Object.assign(dom.window, { chrome: {
    runtime: {
      id: 'fixture', getManifest: () => ({ version: '0.1.2' }),
      sendMessage: async () => { calls++; return { ok: true, view }; },
      onMessage: { addListener: (f: (message: unknown, sender: { id: string }) => void) => runtimeListeners.add(f), removeListener: (f: (message: unknown, sender: { id: string }) => void) => runtimeListeners.delete(f) }
    },
    storage: { onChanged: { addListener: () => undefined, removeListener: () => undefined } }
  } });
  try {
    dom.window.eval(contentBundle());
    await flush();
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    const first = dom.window.document.getElementById('first')!;
    const second = dom.window.document.getElementById('second')!;
    second.querySelector('textarea')!.focus();
    await new Promise(resolve => setTimeout(resolve, 350));
    const host = dom.window.document.getElementById('ai-gauge-usage-strip');
    assert(host, 'focus alone triggers discovery when multiple editors are present');
    assert.equal(second.nextElementSibling, host);
    first.querySelector('textarea')!.focus();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(first.nextElementSibling, host, 'the same host follows the newly focused composer');
    assert.equal(dom.window.document.querySelectorAll('#ai-gauge-usage-strip').length, 1);
    for (const listener of runtimeListeners) listener({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] }, { id: 'fixture' });
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    const callsWhenStopped = calls;
    second.querySelector('textarea')!.focus();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null, 'focusing after cleanup cannot revive the strip');
    assert.equal(calls, callsWhenStopped);
  } finally {
    for (const listener of [...runtimeListeners]) listener({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] }, { id: 'fixture' });
    dom.window.close();
  }
});

test('a strip is removed when its former composer no longer contains the input', () => {
  const dom = fixture(), doc = dom.window.document;
  try {
    const strip = new UsageStrip('chatgpt', doc);
    strip.update(enabledView());
    assert(doc.getElementById('ai-gauge-usage-strip'));
    const previousComposer = doc.querySelector('form')!;
    const input = doc.getElementById('prompt-textarea')!;
    doc.querySelector('main')!.append(input);
    assert(previousComposer.isConnected && input.isConnected);
    strip.mount();
    assert.equal(doc.getElementById('ai-gauge-usage-strip'), null, 'the stale empty composer is not retained as an insertion anchor');
    previousComposer.prepend(input);
    strip.mount();
    assert.equal(previousComposer.nextElementSibling?.id, 'ai-gauge-usage-strip', 'returning the input to a valid composer restores the strip');
  } finally { dom.window.close(); }
});
