import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';
import { resolvePageProvider } from '../src/content/page-provider';
import { providerFromUrl, type View } from '../src/shared/types';
import { authorized, type Message } from '../src/shared/contracts';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { ReadyDisplayDiagnostic } from '../src/content/display-diagnostics';

const rootUrl = 'https://chatgpt.com/';
const footer = '<div id="codex-footer" class="flex ComposerLayoutFooter-_8IVRO gap-2"><button>Send</button></div>';
const codex = `<main><form><textarea></textarea>${footer}</form></main>`;
const ordinary = '<main><form id="chat-composer"><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form></main>';
const popup = { id: 'fixture', url: 'chrome-extension://fixture/popup.html' };
const view = (): View => {
  const settings = defaults(); settings.enabled.chatgpt = true;
  return { settings, permissions: { chatgpt: true, claude: true, gemini: false }, snapshots: {
    chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini')
  } };
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 60; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert(condition(), 'The expected display context was not reached');
};

test('Codex cloud redirected to the ChatGPT root uses its explicit footer while URL authorization stays unchanged', () => {
  const dom = new JSDOM(codex, { url: rootUrl });
  try {
    assert.equal(providerFromUrl(rootUrl), 'chatgpt');
    assert.equal(resolvePageProvider(dom.window.document, rootUrl), 'codex');
    dom.window.document.getElementById('codex-footer')!.className = 'ComposerLayoutFooter-nextHash';
    assert.equal(resolvePageProvider(dom.window.document, rootUrl), 'codex');
    dom.window.document.getElementById('codex-footer')!.remove();
    assert.equal(resolvePageProvider(dom.window.document, rootUrl), 'chatgpt');
    assert.equal(resolvePageProvider(dom.window.document, 'https://chatgpt.com/codex/cloud'), 'codex');
  } finally { dom.window.close(); }
});

test('Codex DOM markers never grant support for another origin or change the Claude provider', () => {
  const dom = new JSDOM(codex);
  try {
    for (const url of ['https://chatgpt.com.evil/', 'http://chatgpt.com/', 'https://example.com/', 'not a URL']) {
      assert.equal(resolvePageProvider(dom.window.document, url), null, url);
    }
    assert.equal(resolvePageProvider(dom.window.document, 'https://claude.ai/new'), 'claude');
  } finally { dom.window.close(); }
});

test('ordinary ChatGPT is not reclassified by absent, partial, hidden, editable or message-contained footer markers', () => {
  const fragments = [
    '', '<div class="ComposerLayoutFooter-"></div>', '<div class="otherComposerLayoutFooter-hash"></div>',
    `<div hidden>${footer}</div>`, `<div style="opacity:0">${footer}</div>`, `<div role="dialog">${footer}</div>`,
    `<div contenteditable="true">${footer}</div>`, `<div data-message-author-role="user">${footer}</div>`,
    `<div data-testid="conversation-turn-4">${footer}</div>`, `<nav>${footer}</nav>`
  ];
  for (const fragment of fragments) {
    const dom = new JSDOM(`${ordinary}${fragment}`, { url: rootUrl });
    try { assert.equal(resolvePageProvider(dom.window.document, rootUrl), 'chatgpt', fragment); }
    finally { dom.window.close(); }
  }
});

test('page context detection reads no prompt value or text and does not cross iframe or shadow boundaries', () => {
  const dom = new JSDOM(codex, { url: rootUrl });
  try {
    const doc = dom.window.document, input = doc.querySelector('textarea')!;
    for (const key of ['value', 'textContent', 'innerText', 'innerHTML']) {
      Object.defineProperty(input, key, { get() { throw new Error(`Private input accessed: ${key}`); } });
    }
    assert.equal(resolvePageProvider(doc, rootUrl), 'codex');
    doc.getElementById('codex-footer')!.remove();
    const frame = doc.createElement('iframe'); doc.body.append(frame);
    frame.contentDocument!.body.innerHTML = footer;
    const host = doc.createElement('div'); doc.body.append(host);
    host.attachShadow({ mode: 'open' }).innerHTML = footer;
    assert.equal(resolvePageProvider(doc, rootUrl), 'chatgpt');
  } finally { dom.window.close(); }
});

function runningContent(html: string, currentView: View) {
  const dom = new JSDOM(html, { url: rootUrl, runScripts: 'outside-only' });
  type Listener = (message: unknown, sender: chrome.runtime.MessageSender, reply?: (value: unknown) => void) => void;
  const listeners: Listener[] = [], storageListeners: Array<() => void> = [], requests: Message[] = [];
  Object.assign(dom.window, { chrome: {
    runtime: { id: 'fixture', sendMessage: async (message: Message) => { requests.push(message); return { ok: true, view: structuredClone(currentView) }; },
      onMessage: { addListener(fn: Listener) { listeners.push(fn); }, removeListener(fn: Listener) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } } },
    storage: { onChanged: { addListener(fn: () => void) { storageListeners.push(fn); }, removeListener() {} } }
  } });
  const bundle = buildSync({ entryPoints: ['src/content/index.ts'], bundle: true, write: false, format: 'iife', target: 'chrome120' }).outputFiles[0]!.text;
  dom.window.eval(bundle);
  const diagnostic = () => {
    let result: ReadyDisplayDiagnostic | undefined;
    for (const listener of listeners) listener({ type: 'display-diagnostics' }, popup, reply => { result = reply as ReadyDisplayDiagnostic; });
    return result;
  };
  return {
    dom, requests, diagnostic,
    invalidate() { for (const listener of storageListeners) listener(); },
    close() {
      for (const listener of [...listeners]) listener({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] }, { id: 'fixture' });
      dom.window.close();
    }
  };
}

test('production content recognizes a late Codex footer and return to ordinary chat without any URL change', async () => {
  const running = runningContent('<main></main>', view()), { dom, diagnostic, requests } = running;
  try {
    await flush();
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    assert.equal(diagnostic()?.provider, 'chatgpt');
    dom.window.document.body.innerHTML = codex;
    await waitFor(() => dom.window.document.getElementById('codex-footer')?.lastElementChild?.id === 'ai-gauge-usage-strip');
    assert.equal(dom.window.location.href, rootUrl);
    assert.equal(diagnostic()?.provider, 'codex');
    assert.equal(diagnostic()?.targetFound, true);
    assert(requests.some(message => message.type === 'refresh' && message.provider === 'chatgpt'));
    dom.window.document.body.innerHTML = ordinary;
    await waitFor(() => dom.window.document.getElementById('chat-composer')?.nextElementSibling?.id === 'ai-gauge-usage-strip');
    assert.equal(diagnostic()?.provider, 'chatgpt');
    assert.equal(dom.window.document.querySelectorAll('#ai-gauge-usage-strip').length, 1);
    assert.equal(dom.window.location.href, rootUrl);
  } finally { running.close(); }
});

test('root-URL Codex and ordinary chat obey their own strip toggles while sharing the same enabled collector', async () => {
  const current = view(); current.settings.strips.chatgpt = false;
  const running = runningContent(codex, current), { dom } = running;
  try {
    await waitFor(() => dom.window.document.getElementById('codex-footer')?.lastElementChild?.id === 'ai-gauge-usage-strip');
    dom.window.document.body.innerHTML = ordinary;
    await waitFor(() => running.diagnostic()?.provider === 'chatgpt');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    current.settings.strips.chatgpt = true; current.settings.strips.codex = false;
    running.invalidate();
    await waitFor(() => dom.window.document.getElementById('chat-composer')?.nextElementSibling?.id === 'ai-gauge-usage-strip');
    dom.window.document.body.innerHTML = codex;
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(running.diagnostic()?.provider, 'codex');
    assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), null);
    assert.equal(current.settings.enabled.chatgpt, true);
  } finally { running.close(); }
});

test('root-URL Codex refresh retains URL host, frame and sender restrictions', () => {
  const sender = { id: 'fixture', frameId: 0, url: rootUrl, tab: { id: 1, url: rootUrl } } as chrome.runtime.MessageSender;
  const sharedRefresh = { type: 'refresh', provider: 'chatgpt', trigger: 'event' } as const;
  assert(authorized(sharedRefresh, sender, 'fixture'));
  assert(!authorized(sharedRefresh, { ...sender, id: 'other' }, 'fixture'));
  assert(!authorized(sharedRefresh, { ...sender, frameId: 1 }, 'fixture'));
  assert(!authorized(sharedRefresh, { ...sender, url: 'https://example.com/' }, 'fixture'));
  assert(!authorized({ ...sharedRefresh, provider: 'claude' }, sender, 'fixture'));
  assert(!authorized({ ...sharedRefresh, trigger: 'manual' }, sender, 'fixture'));
});
