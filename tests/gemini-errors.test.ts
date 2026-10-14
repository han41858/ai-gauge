import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GEMINI_RESPONSE_ERRORS, type Snapshot, type View } from '../src/shared/types';
import { CollectionError, ERROR_TEXT } from '../src/shared/errors';
import { statusText } from '../src/shared/format';
import { unwrapTransport } from '../src/providers/tab-transport';
import { Scheduler, failure, success } from '../src/background/scheduler';
import { emptySnapshot, parseSnapshot, readSnapshot, writeSnapshot } from '../src/storage/snapshots';
import { defaults } from '../src/storage/settings';
import { createDiagnosticReport } from '../src/popup/diagnostics';
import { renderCards } from '../src/popup/render';
import { isReply } from '../src/shared/contracts';

const limits: Snapshot['limits'] = [{ id: 'five_hour', label: '5시간', category: 'window', percent: 21, resetsAt: null, windowSeconds: 18000, remaining: null, unit: null, source: 'api' }];
const view = (snapshot: Snapshot): View => ({ settings: { ...defaults(), enabled: { chatgpt: false, claude: false, gemini: true } }, permissions: { chatgpt: false, claude: false, gemini: true }, snapshots: { chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: snapshot } });

test('fixed Gemini response errors survive transport, storage, worker restart and developer diagnostics without raw data', async () => {
  const previous = globalThis.chrome;
  const stored: Record<string, unknown> = { 'migration:shared-chatgpt:v2': true, 'settings:v2': defaults() };
  globalThis.chrome = { storage: { local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(stored, key)).map(key => [key, structuredClone(stored[key])])),
    set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }
  } } } as unknown as typeof chrome;
  try {
    for (const code of GEMINI_RESPONSE_ERRORS) {
      const before = success(emptySnapshot('gemini'), limits, 1_000_000);
      await writeSnapshot(before);
      let now = 1_100_000, collections = 0;
      const io = { read: readSnapshot, write: writeSnapshot, enabled: async () => true, now: () => now,
        collect: async (): Promise<Snapshot['limits']> => {
          collections++;
          unwrapTransport({ status: 200, code, retryAfter: null, data: { token: 'private-token', body: 'private-response' }, mime: 'private-mime', url: 'https://private.invalid/' });
          throw new Error('The error envelope must reject before returning data');
        } };
      await new Scheduler(io).refresh('gemini', 'manual');
      const failed = await readSnapshot('gemini');
      assert.equal(failed.errorCode, code); assert.equal(failed.state, 'error');
      assert.equal(failed.collectedAt, before.collectedAt); assert.equal(failed.checkedAt, now);
      assert.deepEqual(failed.limits, limits); assert.equal(collections, 1);
      assert.deepEqual(Object.keys(failed).sort(), Object.keys(before).sort(), 'diagnostics must not add snapshot fields');
      assert(isReply({ ok: true, view: view(failed) }));
      const diagnostic = createDiagnosticReport(view(failed), 'fixture');
      assert.equal(diagnostic.providers.gemini.errorCode, code);
      assert.doesNotMatch(JSON.stringify({ failed, diagnostic, stored }), /private-|mime|https:|token|body/);
      now++;
      await new Scheduler(io).refresh('gemini', 'manual');
      assert.equal(collections, 1, 'a restarted worker respects the saved cooldown');
      now = failed.nextAttemptAt + 1;
      await new Scheduler({ ...io, collect: async () => limits }).refresh('gemini', 'manual');
      const recovered = await readSnapshot('gemini');
      assert.equal(recovered.state, 'ok'); assert.equal(recovered.errorCode, null); assert.equal(recovered.collectedAt, now);
      assert.equal(createDiagnosticReport(view(recovered), 'fixture').providers.gemini.errorCode, null);
    }
  } finally { globalThis.chrome = previous; }
});

test('arbitrary Gemini-prefixed error text cannot cross the transport or snapshot boundary', () => {
  for (const code of ['gemini_private-token', 'gemini_response_type:private-token', 'GEMINI_RPC_INVALID', 'gemini_frame_invalid ', 'gemini_future_unknown']) {
    assert.throws(() => unwrapTransport({ status: 200, code, retryAfter: null, data: null }), (error: unknown) => error instanceof CollectionError && error.code === 'invalid_response' && !error.message.includes(code));
    assert.equal(parseSnapshot({ ...emptySnapshot('gemini'), errorCode: code }, 'gemini').errorCode, 'not_collected');
  }
});

test('detailed response errors preserve the ordinary popup message and remain visible only in the diagnostic error code', () => {
  const dom = new JSDOM('<main id="cards"></main>');
  const actions = { enable() {}, disable() {}, revoke() {}, refresh() {}, select() {} };
  try {
    for (const code of GEMINI_RESPONSE_ERRORS) {
      const snapshot = failure(emptySnapshot('gemini'), new CollectionError(code), 1_000_000);
      renderCards(dom.window.document.getElementById('cards')!, view(snapshot), actions, 1_000_001);
      const card = dom.window.document.querySelector('[data-provider="gemini"]')!;
      assert.equal(ERROR_TEXT[code], ERROR_TEXT.invalid_response);
      assert(card.textContent!.includes(statusText({ ...snapshot, errorCode: 'invalid_response' })));
      assert.doesNotMatch(card.textContent!, /gemini_|MIME|UTF|RPC|framing/);
      assert.equal(createDiagnosticReport(view(snapshot), 'fixture').providers.gemini.errorCode, code);
    }
  } finally { dom.window.close(); }
});

test('older generic response errors and HTTP 429 retain their existing storage and scheduling contract', () => {
  const old = failure(emptySnapshot('gemini'), new CollectionError('invalid_response'), 1_000_000);
  assert.deepEqual(parseSnapshot(old, 'gemini'), old);
  assert.throws(() => unwrapTransport({ status: 429, code: null, retryAfter: '3600', data: null }), (error: unknown) => {
    assert(error instanceof CollectionError); assert.equal(error.code, 'rate_limited');
    const limited = failure(old, error, 1_100_000);
    assert.equal(limited.nextAttemptAt, 4_700_000); assert.equal(limited.state, 'rate_limited');
    return true;
  });
});
