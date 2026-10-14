import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { reconcileContent } from '../src/background/content-registration';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { View } from '../src/shared/types';

function view(): View { return { settings: defaults(), permissions: { chatgpt: true, claude: true, gemini: true }, snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') } }; }
async function fixture(initial: chrome.scripting.RegisteredContentScript[], run: (state: { registrations: chrome.scripting.RegisteredContentScript[]; injections: Array<{ target: { tabId: number }; func?: () => void; files?: string[] }> }) => Promise<void>) {
  const previous = globalThis.chrome, state = { registrations: [...initial], injections: [] as Array<{ target: { tabId: number }; func?: () => void; files?: string[] }> };
  globalThis.chrome = { tabs: { query: async ({ url }: { url: string }) => [{ id: url.includes('gemini') ? 3 : url.includes('claude') ? 2 : 1 }] }, scripting: {
    getRegisteredContentScripts: async () => [...state.registrations],
    registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => { state.registrations.push(...scripts); },
    unregisterContentScripts: async ({ ids }: { ids: string[] }) => { state.registrations = state.registrations.filter(script => !ids.includes(script.id)); },
    updateContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => { for (const script of scripts) Object.assign(state.registrations.find(value => value.id === script.id)!, script); },
    executeScript: async (injection: typeof state.injections[number]) => { state.injections.push(injection); return []; }
  } } as unknown as typeof chrome;
  try { await run(state); } finally { globalThis.chrome = previous; }
}
test('ordinary ChatGPT and Codex share one registration and no quota observer is installed', async () => fixture([], async state => {
  const current = view(); current.settings.enabled.chatgpt = true;
  await reconcileContent(current);
  assert.deepEqual(state.registrations.map(script => script.id), ['ai-gauge-openai']);
  assert.deepEqual(state.registrations[0]?.js, ['content.js']);
  assert(state.injections.every(injection => !injection.func));
  current.settings.strips.chatgpt = false; await reconcileContent(current); assert.equal(state.registrations.length, 1);
  current.settings.strips.codex = false; await reconcileContent(current); assert.equal(state.registrations.length, 0);
}));
test('Gemini registration follows only its own enable, permission, and strip settings', async () => fixture([], async state => {
  const current = view(); current.settings.enabled.gemini = true; current.permissions.gemini = false;
  await reconcileContent(current); assert.equal(state.registrations.length, 0);
  current.permissions.gemini = true; await reconcileContent(current);
  assert.deepEqual(state.registrations.map(script => script.id), ['ai-gauge-gemini']);
  assert.deepEqual(state.registrations[0]?.matches, ['https://gemini.google.com/*']);
  assert.equal(state.injections[0]?.target.tabId, 3);
  current.settings.enabled.claude = true; await reconcileContent(current);
  current.permissions.gemini = false; await reconcileContent(current);
  assert.deepEqual(state.registrations.map(script => script.id), ['ai-gauge-claude']);
}));
test('upgrading unregisters the retired observer and stops its existing page hook without creating a new observer', async () => fixture([{ id: 'ai-gauge-chatgpt-observer', js: ['chatgpt-observer.js'], matches: ['https://chatgpt.com/*'], world: 'MAIN' }], async state => {
  const current = view(); current.settings.enabled.chatgpt = true;
  await reconcileContent(current); assert.deepEqual(state.registrations.map(script => script.id), ['ai-gauge-openai']);
  const cleanup = state.injections.find(injection => injection.func); assert(cleanup?.func);
  const dom = new JSDOM('', { runScripts: 'outside-only' }); let stopped = 0;
  dom.window.document.addEventListener('ai-gauge-chatgpt-stop', () => { stopped++; });
  try { dom.window.eval(`(${cleanup.func.toString()})()`); assert.equal(stopped, 1); }
  finally { dom.window.close(); }
  state.injections.length = 0; await reconcileContent(current); assert(state.injections.every(injection => !injection.func));
}));
test('legacy idle content registration is updated while unrelated extension registrations survive', async () => fixture([
  { id: 'ai-gauge-claude', js: ['content.js'], matches: ['https://claude.ai/*'], runAt: 'document_idle' },
  { id: 'unrelated-registration', js: ['other.js'], matches: ['https://claude.ai/*'] }
], async state => {
  const current = view(); current.settings.enabled.claude = true; await reconcileContent(current);
  assert.equal(state.registrations.find(script => script.id === 'ai-gauge-claude')?.runAt, 'document_start');
  assert(state.registrations.some(script => script.id === 'unrelated-registration'));
}));
