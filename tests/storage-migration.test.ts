import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, isSettings, parseSettings } from '../src/storage/settings';
import { emptySnapshot, migrateStorage, readSettings, readSnapshot, writeSettings, writeSnapshot } from '../src/storage/snapshots';
import type { Snapshot, UsageLimit } from '../src/shared/types';

const SETTINGS = 'settings:v2';
const MIGRATION = 'migration:shared-chatgpt:v2';
const SHARED = 'snapshot:v4:chatgpt';
const LEGACY = 'snapshot:v2:work_codex';
const limit = (percent = 15): UsageLimit => ({ id: 'shared:primary_window', label: 'Shared quota', category: 'product', percent, resetsAt: '2026-10-15T00:00:00.000Z', windowSeconds: 604800, remaining: null, unit: null, source: 'api' });
const snapshot = (percent = 15): Snapshot => ({ ...emptySnapshot('chatgpt'), state: 'ok', limits: [limit(percent)], collectedAt: 1_000, checkedAt: 1_001, errorCode: null });
const oldSettings = () => ({
  enabled: { chatgpt: true, work_codex: true, claude: true },
  strips: { chatgpt: false, work_codex: true, claude: false },
  selectedLimit: { chatgpt: 'old-experimental-model', work_codex: 'shared:primary_window', claude: 'seven_day' },
  defaultProvider: 'work_codex', followTab: true, warning: 60, danger: 85
});

function installStorage(stored: Record<string, unknown>, beforeGet?: () => Promise<void>, beforeSet?: () => Promise<void>) {
  const previous = globalThis.chrome;
  const reads: string[][] = [], writes: Record<string, unknown>[] = [];
  const local = {
    async get(query: string | string[]) {
      const keys = typeof query === 'string' ? [query] : query;
      reads.push([...keys]);
      await beforeGet?.();
      return Object.fromEntries(keys.filter(key => Object.hasOwn(stored, key)).map(key => [key, structuredClone(stored[key])]));
    },
    async set(values: Record<string, unknown>) {
      await beforeSet?.();
      writes.push(structuredClone(values));
      Object.assign(stored, structuredClone(values));
    }
  };
  globalThis.chrome = { storage: { local } } as unknown as typeof chrome;
  return { reads, writes, restore() { globalThis.chrome = previous; } };
}

test('new settings distinguish three collectors from four page strips and keep Gemini opt-in', () => {
  const base = defaults();
  assert.deepEqual(base.enabled, { chatgpt: false, claude: false, gemini: false });
  assert.deepEqual(base.strips, { chatgpt: true, codex: true, claude: true, gemini: true });
  assert.equal(base.followTab, false);
  assert(isSettings(base));
  assert(!isSettings({ ...base, strips: { chatgpt: true, claude: true, gemini: true } }));
  const parsed = parseSettings({ ...base, enabled: { ...base.enabled, gemini: true }, strips: { ...base.strips, codex: false }, followTab: true });
  assert.equal(parsed.enabled.gemini, true);
  assert.equal(parsed.strips.codex, false);
  assert.equal(parsed.strips.chatgpt, true);
  assert.equal(parsed.followTab, true);
});

test('legacy settings migrate the shared pool once while preserving page preferences', async () => {
  const stored: Record<string, unknown> = { settings: oldSettings(), [LEGACY]: { ...snapshot(), provider: 'work_codex' } };
  const mock = installStorage(stored);
  try {
    const [settings, shared] = await Promise.all([readSettings(), readSnapshot('chatgpt')]);
    assert.deepEqual(settings, {
      enabled: { chatgpt: true, claude: true, gemini: false },
      strips: { chatgpt: false, codex: true, claude: false, gemini: true },
      selectedLimit: { chatgpt: 'shared:primary_window', claude: 'seven_day', gemini: null },
      defaultProvider: 'chatgpt', followTab: true, warning: 60, danger: 85
    });
    assert.deepEqual(shared, snapshot());
    assert.equal(mock.writes.length, 1);
    assert.deepEqual(Object.keys(mock.writes[0]!).sort(), [MIGRATION, SETTINGS, SHARED].sort());
    assert.equal(stored[MIGRATION], true);
  } finally { mock.restore(); }
});

test('experimental ChatGPT opt-in and v3 snapshot never authorize or supply the new collector', async () => {
  for (const sharedEnabled of [undefined, false, 'true']) {
    const old = oldSettings();
    const stored: Record<string, unknown> = {
      settings: { ...old, enabled: { chatgpt: true, work_codex: sharedEnabled, claude: false } },
      'snapshot:v3:chatgpt': snapshot(99)
    };
    const mock = installStorage(stored);
    try {
      assert.equal((await readSettings()).enabled.chatgpt, false);
      assert.deepEqual(await readSnapshot('chatgpt'), emptySnapshot('chatgpt'));
      assert(!mock.reads.flat().includes('snapshot:v3:chatgpt'));
    } finally { mock.restore(); }
  }
});

test('migration copies only validated fields and normalizes reset times', async () => {
  const stored: Record<string, unknown> = {
    settings: { ...oldSettings(), token: 'discarded-test-value' },
    [LEGACY]: { ...snapshot(), provider: 'work_codex', token: 'discarded-test-value', limits: [{ ...limit(), label: ' Shared quota ', resetsAt: '2026-10-15T09:00:00+09:00', token: 'discarded-test-value', raw: { private: true } }] }
  };
  const mock = installStorage(stored);
  try {
    assert.deepEqual(await readSnapshot('chatgpt'), snapshot());
    assert(!JSON.stringify(stored[SHARED]).includes('discarded-test-value'));
    assert(!JSON.stringify(stored[SETTINGS]).includes('discarded-test-value'));
    assert.equal((stored[SHARED] as Snapshot).limits[0]?.resetsAt, '2026-10-15T00:00:00.000Z');
  } finally { mock.restore(); }
});

test('invalid legacy snapshots cannot become successful shared usage', async () => {
  const candidates = [
    { ...snapshot(), provider: 'chatgpt' },
    { ...snapshot(), provider: 'work_codex', limits: [{ ...limit(), percent: 101 }] },
    { ...snapshot(), provider: 'work_codex', limits: [{ ...limit(), resetsAt: '2026-10-15T09:00:00' }] },
    { ...snapshot(), provider: 'work_codex', collectedAt: null },
    { ...snapshot(), provider: 'work_codex', errorCode: 'unknown_code' },
    { ...snapshot(), provider: 'work_codex', limits: [] }
  ];
  for (const candidate of candidates) {
    const stored: Record<string, unknown> = { [LEGACY]: candidate };
    const mock = installStorage(stored);
    try { assert.deepEqual(await readSnapshot('chatgpt'), emptySnapshot('chatgpt')); }
    finally { mock.restore(); }
  }
});

test('failed legacy collection preserves its last successful data and cooldown', async () => {
  const prior = { ...snapshot(), state: 'error' as const, checkedAt: 2_000, nextAttemptAt: 60_000, failures: 3, errorCode: 'network' as const };
  const mock = installStorage({ [LEGACY]: { ...prior, provider: 'work_codex' } });
  try { assert.deepEqual(await readSnapshot('chatgpt'), prior); }
  finally { mock.restore(); }
});

test('existing new settings and snapshots take priority over legacy values', async () => {
  const settings = defaults();
  settings.enabled.gemini = true;
  settings.defaultProvider = 'gemini';
  const stored: Record<string, unknown> = { settings: oldSettings(), [SETTINGS]: settings, [SHARED]: snapshot(70), [LEGACY]: { ...snapshot(15), provider: 'work_codex' } };
  const mock = installStorage(stored);
  try {
    assert.deepEqual(await readSettings(), settings);
    assert.deepEqual(await readSnapshot('chatgpt'), snapshot(70));
    assert(!Object.hasOwn(mock.writes[0]!, SHARED));
  } finally { mock.restore(); }
});

test('Claude keeps its v2 cache and Gemini starts in a separate empty cache', async () => {
  const claude: Snapshot = { ...snapshot(25), provider: 'claude' };
  const stored: Record<string, unknown> = { 'snapshot:v2:claude': claude, 'snapshot:v2:gemini': { ...snapshot(99), provider: 'gemini' } };
  const mock = installStorage(stored);
  try {
    assert.deepEqual(await readSnapshot('claude'), claude);
    assert.deepEqual(await readSnapshot('gemini'), emptySnapshot('gemini'));
    const gemini: Snapshot = { ...snapshot(10), provider: 'gemini' };
    await writeSnapshot(gemini);
    assert.deepEqual(stored['snapshot:v1:gemini'], gemini);
    assert.deepEqual(stored['snapshot:v2:claude'], claude);
  } finally { mock.restore(); }
});

test('durable completion prevents old settings and snapshots from returning after restart', async () => {
  const stored: Record<string, unknown> = { settings: oldSettings(), [LEGACY]: { ...snapshot(), provider: 'work_codex' } };
  let mock = installStorage(stored);
  try {
    await migrateStorage();
    const disabled = defaults();
    await writeSettings(disabled);
    delete stored[SHARED];
    mock.restore();
    mock = installStorage(stored);
    assert.deepEqual(await readSettings(), disabled);
    assert.deepEqual(await readSnapshot('chatgpt'), emptySnapshot('chatgpt'));
    assert.equal(mock.writes.length, 0);
  } finally { mock.restore(); }
});

test('concurrent migration, reads and writes cannot overwrite a new collection or user setting', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const stored: Record<string, unknown> = { settings: oldSettings(), [LEGACY]: { ...snapshot(15), provider: 'work_codex' } };
  const mock = installStorage(stored, () => gate);
  try {
    const settings = defaults();
    settings.followTab = true;
    const pending = [migrateStorage(), readSettings(), readSnapshot('chatgpt'), writeSettings(settings), writeSnapshot(snapshot(80))];
    assert.equal(mock.reads.length, 1);
    release();
    await Promise.all(pending);
    assert.deepEqual(await readSettings(), settings);
    assert.deepEqual(await readSnapshot('chatgpt'), snapshot(80));
    assert.equal(mock.reads.filter(keys => keys.includes(MIGRATION)).length, 1);
  } finally { release(); mock.restore(); }
});

test('failed migration can retry and does not publish a partial completion marker', async () => {
  let fail = true;
  const stored: Record<string, unknown> = { settings: oldSettings(), [LEGACY]: { ...snapshot(), provider: 'work_codex' } };
  const mock = installStorage(stored, undefined, async () => { if (fail) throw new Error('storage temporarily unavailable'); });
  try {
    await assert.rejects(migrateStorage(), /temporarily unavailable/);
    assert.equal(stored[MIGRATION], undefined);
    assert.equal(stored[SETTINGS], undefined);
    fail = false;
    assert.deepEqual(await readSnapshot('chatgpt'), snapshot());
    assert.equal(stored[MIGRATION], true);
  } finally { mock.restore(); }
});
