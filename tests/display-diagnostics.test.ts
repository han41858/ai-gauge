import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleEntry } from './helpers/bundle';
import { JSDOM } from 'jsdom';
import { authorizedDisplayRequest, createDisplayDiagnostic, type DisplayDiagnostic, type ReadyDisplayDiagnostic } from '../src/content/display-diagnostics';
import { bindDiagnostics, readActiveDisplayDiagnostic } from '../src/popup/diagnostics';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { View } from '../src/shared/types';

const view = (): View => {
  const settings = defaults(); settings.enabled.chatgpt = true;
  return { settings, permissions: { chatgpt: true, claude: true, gemini: false }, snapshots: {
    chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini')
  } };
};
const ready = (): ReadyDisplayDiagnostic => ({ status: 'ready', provider: 'codex', contentReady: true,
  editableCount: 1, iframeCount: 0, targetFound: true, stripCount: 1, stripVisible: true });
const popupHtml = readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const sender = (): chrome.runtime.MessageSender => ({ id: 'fixture', url: 'chrome-extension://fixture/popup.html' });

test('display diagnostics return only structural counts and booleans without accessing prompt or frame contents', () => {
  const dom = new JSDOM('<main><form><textarea id="input" class="private-class">private prompt</textarea><button>Send</button></form><iframe src="about:blank"></iframe><div id="ai-gauge-usage-strip">private usage</div></main>');
  try {
    const doc = dom.window.document;
    for (const node of [doc.getElementById('input')!, doc.querySelector('iframe')!, doc.getElementById('ai-gauge-usage-strip')!]) {
      for (const key of ['value', 'innerHTML', 'innerText', 'textContent']) {
        Object.defineProperty(node, key, { get() { throw new Error(`Private value accessed: ${key}`); } });
      }
    }
    const result = createDisplayDiagnostic(doc, 'codex');
    assert.deepEqual(result, { status: 'ready', provider: 'codex', contentReady: true, editableCount: 1,
      iframeCount: 1, targetFound: true, stripCount: 1, stripVisible: false });
    assert.doesNotMatch(JSON.stringify(result), /private|class|src|html|coordinate|token|account|url|prompt/i);
    doc.getElementById('input')!.remove();
    assert.equal(createDisplayDiagnostic(doc, 'codex').targetFound, false);
  } finally { dom.window.close(); }
});

test('diagnostics distinguish a rendered strip from an existing hidden or offscreen host', () => {
  const dom = new JSDOM('<form><textarea></textarea></form><div id="ai-gauge-usage-strip"></div>');
  try {
    const doc = dom.window.document, host = doc.getElementById('ai-gauge-usage-strip')!;
    let left = 10;
    Object.defineProperty(host, 'getClientRects', { value: () => [{ width: 200, height: 20, left, top: 10, right: left + 200, bottom: 30 }] });
    assert.equal(createDisplayDiagnostic(doc, 'codex').stripVisible, true);
    host.hidden = true;
    assert.equal(createDisplayDiagnostic(doc, 'codex').stripVisible, false);
    host.hidden = false; host.style.opacity = '0';
    assert.equal(createDisplayDiagnostic(doc, 'codex').stripVisible, false);
    host.style.opacity = '1'; left = -1000;
    assert.equal(createDisplayDiagnostic(doc, 'codex').stripVisible, false);
    assert.equal(createDisplayDiagnostic(doc, 'codex').stripCount, 1);
  } finally { dom.window.close(); }
});

test('display requests authorize the exact installed popup and reject page, other extension and malformed messages', () => {
  const message = { type: 'display-diagnostics' };
  assert(authorizedDisplayRequest(message, sender(), 'fixture'));
  for (const changed of [
    { ...sender(), id: 'other' }, { ...sender(), url: 'https://chatgpt.com/codex' },
    { ...sender(), url: 'chrome-extension://fixture/popup.html#other' },
    { ...sender(), tab: { id: 7 } as chrome.tabs.Tab }, { id: 'fixture' }
  ]) assert.equal(authorizedDisplayRequest(message, changed, 'fixture'), false);
  for (const changed of [null, 'display-diagnostics', {}, { type: 'view' }, { ...message, url: 'private-url' }]) {
    assert.equal(authorizedDisplayRequest(changed, sender(), 'fixture'), false);
  }
});

function apiFixture(options: { url?: string; permission?: boolean; reply?: unknown; reject?: boolean } = {}) {
  const calls: unknown[] = [];
  return { calls, api: {
    tabs: {
      query: async (query: unknown) => { calls.push(query); return [{ id: 4, url: options.url ?? 'https://chatgpt.com/codex' }]; },
      sendMessage: async (...args: unknown[]) => { calls.push(args); if (options.reject) throw new Error('private failure'); return options.reply ?? ready(); }
    },
    permissions: { contains: async (query: unknown) => { calls.push(query); return options.permission ?? true; } }
  } as unknown as Pick<typeof chrome, 'tabs' | 'permissions'> };
}

test('popup reads diagnostics only from the active allowed site top frame and removes untrusted extra fields', async () => {
  const { calls, api } = apiFixture({ reply: { ...ready(), dom: 'private prompt', url: 'private url', token: 'private token' } });
  assert.deepEqual(await readActiveDisplayDiagnostic(view(), api), ready());
  assert.deepEqual(calls, [{ active: true, lastFocusedWindow: true }, { origins: ['https://chatgpt.com/*'] },
    [4, { type: 'display-diagnostics' }, { frameId: 0 }]]);
});

test('popup accepts trusted Codex display context at the ChatGPT root but rejects other provider mismatches', async () => {
  const redirected = apiFixture({ url: 'https://chatgpt.com/', reply: ready() });
  assert.deepEqual(await readActiveDisplayDiagnostic(view(), redirected.api), ready());
  for (const [url, provider] of [
    ['https://chatgpt.com/', 'claude'], ['https://chatgpt.com/codex', 'chatgpt'], ['https://claude.ai/', 'codex']
  ] as const) {
    const fixture = apiFixture({ url, reply: { ...ready(), provider } });
    const expectedProvider = url.includes('claude.ai') ? 'claude' : url.includes('/codex') ? 'codex' : 'chatgpt';
    assert.deepEqual(await readActiveDisplayDiagnostic(view(), fixture.api), { status: 'content_unavailable', provider: expectedProvider });
  }
});

test('unsupported sites and revoked host permission cannot trigger a content diagnostic request', async () => {
  const unrelated = apiFixture({ url: 'https://example.com/private' });
  assert.deepEqual(await readActiveDisplayDiagnostic(view(), unrelated.api), { status: 'no_site' });
  assert.equal(unrelated.calls.length, 1);
  const denied = apiFixture({ permission: false });
  assert.deepEqual(await readActiveDisplayDiagnostic(view(), denied.api), { status: 'permission_required', provider: 'codex' });
  assert.equal(denied.calls.length, 2);
  const disabledPermission = apiFixture(), v = view(); v.permissions.chatgpt = false;
  assert.deepEqual(await readActiveDisplayDiagnostic(v, disabledPermission.api), { status: 'permission_required', provider: 'codex' });
  assert.equal(disabledPermission.calls.length, 1);
});

test('missing content listener and malformed or wrong-route replies are reported without raw exception text', async () => {
  for (const options of [
    { reject: true }, { reply: {} }, { reply: { ...ready(), provider: 'claude' } },
    { reply: { ...ready(), contentReady: false } }, { reply: { ...ready(), editableCount: -1 } },
    { reply: { ...ready(), iframeCount: 1.5 } }, { reply: { ...ready(), stripCount: 10_001 } },
    { reply: { ...ready(), targetFound: 'yes' } }, { reply: { ...ready(), stripVisible: null } }
  ]) {
    const { api } = apiFixture(options);
    assert.deepEqual(await readActiveDisplayDiagnostic(view(), api), { status: 'content_unavailable', provider: 'codex' });
  }
});

test('display diagnosis runs only on an explicit action and copy waits for its completed result', async () => {
  const dom = new JSDOM(popupHtml), doc = dom.window.document;
  let calls = 0, copied = '';
  try {
    bindDiagnostics(doc, view, '0.1.4', async text => { copied = text; }, async () => { calls++; await flush(); return ready(); });
    assert.equal(calls, 0);
    doc.getElementById('diagnostics-copy')!.click();
    assert.equal(calls, 1); assert.equal(copied, '');
    await flush(); await flush();
    const result = JSON.parse(copied);
    assert.deepEqual(result.display, ready());
    assert.equal(result.providers.chatgpt.enabled, true);
    assert.equal(result.extensionVersion, '0.1.4');
  } finally { dom.window.close(); }
});

test('late display replies cannot overwrite the newer explicitly requested report', async () => {
  const dom = new JSDOM(popupHtml), doc = dom.window.document;
  const replies: Array<(diagnostic: DisplayDiagnostic) => void> = [];
  try {
    bindDiagnostics(doc, view, '0.1.4', async () => undefined, () => new Promise(resolve => { replies.push(resolve); }));
    doc.getElementById('diagnostics-show')!.click(); doc.getElementById('diagnostics-show')!.click();
    replies[1]!({ status: 'no_site' }); await flush();
    replies[0]!(ready()); await flush();
    assert.deepEqual(JSON.parse((doc.getElementById('diagnostics-output') as HTMLTextAreaElement).value).display, { status: 'no_site' });
  } finally { dom.window.close(); }
});

test('production content listener responds only to a trusted popup and leaves usage unchanged', async () => {
  const dom = new JSDOM('<main><form><textarea></textarea><button>Send</button></form></main>', { url: 'https://chatgpt.com/codex', runScripts: 'outside-only' });
  const listeners: Array<(message: unknown, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => void> = [];
  const current = view(); let viewReads = 0;
  try {
    Object.assign(dom.window, { chrome: {
      runtime: { id: 'fixture', sendMessage: async () => { viewReads++; return { ok: true, view: current }; },
        onMessage: { addListener(fn: typeof listeners[number]) { listeners.push(fn); }, removeListener() {} } },
      storage: { onChanged: { addListener() {}, removeListener() {} } }
    } });
    const bundle = bundleEntry('src/content/index.ts');
    dom.window.eval(bundle); await flush();
    assert.equal(listeners.length, 1);
    const beforeReads = viewReads, replies: unknown[] = [];
    listeners[0]!({ type: 'display-diagnostics' }, { ...sender(), tab: { id: 4 } as chrome.tabs.Tab }, value => replies.push(value));
    assert.equal(replies.length, 0);
    listeners[0]!({ type: 'display-diagnostics' }, sender(), value => replies.push(value));
    assert.equal(replies.length, 1);
    assert.equal((replies[0] as ReadyDisplayDiagnostic).provider, 'codex');
    assert.equal((replies[0] as ReadyDisplayDiagnostic).targetFound, true);
    assert.equal((replies[0] as ReadyDisplayDiagnostic).stripCount, 1);
    assert.equal(viewReads, beforeReads);
    assert.equal(current.snapshots.chatgpt.collectedAt, null);
  } finally {
    for (const listener of listeners) listener({ type: 'permissions-revoked', origins: ['https://chatgpt.com/*'] }, { id: 'fixture' }, () => undefined);
    dom.window.close();
  }
});
