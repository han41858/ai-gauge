import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { CompletionWatcher, LoadQueue } from '../src/content/view-requests';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { View } from '../src/shared/types';

test('requests made while one is running merge into a single follow-up that keeps queued refresh targets in order', () => {
  const queue = new LoadQueue();
  assert.equal(queue.finish(), null, 'an idle queue has nothing to run');
  queue.start();
  assert.equal(queue.busy, true);
  queue.defer(); queue.defer('claude'); queue.defer('chatgpt'); queue.defer('claude');
  assert.deepEqual(queue.finish(), { refresh: 'claude' });
  assert.equal(queue.busy, false);
  queue.start();
  assert.deepEqual(queue.finish(), { refresh: 'chatgpt' }, 'remaining refresh targets still run after the merged follow-up');
  queue.start(); queue.requestAgain();
  assert.deepEqual(queue.finish(), { refresh: undefined });
  queue.start();
  assert.equal(queue.finish(), null);
});

test('a completed response waits for stored cooldowns and is dropped for disabled or signed-out providers', async () => {
  const view: View = { settings: { ...defaults(), enabled: { chatgpt: true, claude: false, gemini: false } },
    permissions: { chatgpt: true, claude: true, gemini: false },
    snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini') } };
  const due: string[] = [];
  const watcher = new CompletionWatcher(() => view, source => { due.push(source); });
  watcher.arm('claude');
  assert.deepEqual(due, [], 'a disabled provider is never refreshed');
  view.snapshots.chatgpt = { ...view.snapshots.chatgpt, state: 'signed_out' };
  watcher.arm('chatgpt');
  assert.deepEqual(due, []);
  view.snapshots.chatgpt = { ...emptySnapshot('chatgpt'), nextAttemptAt: Date.now() + 60_000 };
  watcher.arm('chatgpt');
  assert.deepEqual(due, [], 'a retry deadline keeps the completion pending');
  watcher.clear();
  view.snapshots.chatgpt = emptySnapshot('chatgpt');
  watcher.arm('chatgpt');
  assert.deepEqual(due, ['chatgpt']);
  watcher.arm('chatgpt');
  assert.deepEqual(due, ['chatgpt'], 'a second completion within a minute of the last signal waits');
  watcher.clear();
});

test('mutation filtering ignores our own strip moving but reacts to site changes and its removal', async () => {
  const dom = new JSDOM('<main><form></form><div id="ai-gauge-usage-strip"><span></span></div></main>');
  Object.assign(globalThis, { Node: dom.window.Node });
  const { hasExternalChange } = await import('../src/content/mutations');
  const doc = dom.window.document, strip = doc.getElementById('ai-gauge-usage-strip')!;
  const records: MutationRecord[] = [];
  const observer = new dom.window.MutationObserver(list => { records.push(...list); });
  observer.observe(doc, { childList: true, subtree: true, attributes: true });
  try {
    strip.firstElementChild!.setAttribute('class', 'x');
    doc.querySelector('form')!.after(strip);
    records.push(...observer.takeRecords());
    assert.equal(hasExternalChange(records.splice(0)), false);
    doc.querySelector('form')!.setAttribute('class', 'site');
    records.push(...observer.takeRecords());
    assert.equal(hasExternalChange(records.splice(0)), true);
    strip.remove();
    records.push(...observer.takeRecords());
    assert.equal(hasExternalChange(records.splice(0)), true, 'a site removing our strip needs recovery');
  } finally { observer.disconnect(); dom.window.close(); }
});
