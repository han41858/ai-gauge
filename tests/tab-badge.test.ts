import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateBadge } from '../src/background/badge';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { Snapshot, UsageLimit, View } from '../src/shared/types';

interface Tab { id: number; url?: string }
interface TextWrite { tabId?: number; text: string }
const snapshot = (provider: Snapshot['provider'], percent: number): Snapshot => ({
  ...emptySnapshot(provider), state: 'ok', errorCode: null, collectedAt: Date.now(), checkedAt: Date.now(),
  limits: [{ id: 'reported', label: '기간', category: 'window', percent, resetsAt: null,
    windowSeconds: null, remaining: null, unit: null, source: 'api' } satisfies UsageLimit]
});
const view = (): View => {
  const settings = defaults();
  settings.enabled.work_codex = true; settings.enabled.claude = true;
  return { settings, permissions: { chatgpt: true, work_codex: true, claude: true },
    snapshots: { chatgpt: emptySnapshot('chatgpt'), work_codex: snapshot('work_codex', 15), claude: snapshot('claude', 63) } };
};
function browser(initial: Tab[]) {
  const tabs = new Map(initial.map(tab => [tab.id, { ...tab }]));
  const texts = new Map<number, string>(), titles = new Map<number, string>(), colors = new Map<number, string>(), textColors = new Map<number, string>();
  const writes: TextWrite[] = [];
  let globalText = '99%', globalTitle = 'old global provider';
  const api = {
    tabs: {
      query: async (_query: object) => [...tabs.values()].map(tab => ({ ...tab })),
      get: async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error('Tab closed');
        return { ...tab };
      }
    },
    action: {
      setBadgeText: async (value: TextWrite) => {
        writes.push(value);
        if (value.tabId === undefined) globalText = value.text;
        else texts.set(value.tabId, value.text);
      },
      setTitle: async (value: { tabId?: number; title: string }) => {
        if (value.tabId === undefined) globalTitle = value.title;
        else titles.set(value.tabId, value.title);
      },
      setBadgeBackgroundColor: async (value: { tabId?: number; color: string }) => {
        if (value.tabId !== undefined) colors.set(value.tabId, value.color);
      },
      setBadgeTextColor: async (value: { tabId?: number; color: string }) => {
        if (value.tabId !== undefined) textColors.set(value.tabId, value.color);
      }
    }
  };
  return { api, tabs, texts, titles, colors, textColors, writes, current: (id: number) => texts.get(id) ?? globalText,
    global: () => ({ text: globalText, title: globalTitle }) };
}

test('every tab receives only its own service badge while global and unrelated tabs stay blank', async () => {
  const mock = browser([
    { id: 1, url: 'https://chatgpt.com/' }, { id: 2, url: 'https://chatgpt.com/codex' },
    { id: 3, url: 'https://claude.ai/new' }, { id: 4, url: 'https://unrelated.invalid/' }, { id: 5 }
  ]);
  const previous = globalThis.chrome;
  globalThis.chrome = mock.api as unknown as typeof chrome;
  try {
    const current = view();
    await updateBadge(current);
    assert.equal(mock.current(1), '15%'); assert.equal(mock.current(2), '15%');
    assert.equal(mock.current(3), '63%'); assert.equal(mock.current(4), ''); assert.equal(mock.current(5), '');
    assert.match(mock.titles.get(1)!, /Work \/ Codex/);
    assert.match(mock.titles.get(3)!, /Claude/);
    assert.equal(mock.titles.get(4), 'AI Gauge');
    assert.equal(mock.colors.get(1), '#0D8669'); assert.equal(mock.colors.get(2), '#0D8669');
    assert.equal(mock.colors.get(3), '#B16046');
    assert.equal(mock.textColors.get(1), '#FFFFFF'); assert.equal(mock.textColors.get(3), '#FFFFFF');
    current.snapshots.work_codex.limits[0]!.percent = 100;
    current.snapshots.claude.limits[0]!.percent = 100;
    current.settings.warning = 0; current.settings.danger = 1;
    await updateBadge(current);
    assert.equal(mock.current(1), '100%'); assert.equal(mock.current(3), '100%');
    assert.equal(mock.colors.get(1), '#0D8669', 'legacy thresholds and exhausted usage must not replace the ChatGPT color');
    assert.equal(mock.colors.get(3), '#B16046', 'legacy thresholds and exhausted usage must not replace the Claude color');
    assert.deepEqual(mock.global(), { text: '', title: 'AI Gauge' });
    assert(mock.writes.every(write => write.tabId !== undefined || write.text === ''), 'provider usage must never be written globally');
    mock.tabs.set(6, { id: 6, url: 'https://another.invalid/' });
    assert.equal(mock.current(6), '', 'new tabs inherit only the empty global default');
  } finally { globalThis.chrome = previous; }
});

test('navigating a supported tab elsewhere clears its previous number and service title', async () => {
  const mock = browser([{ id: 1, url: 'https://claude.ai/new' }]);
  const previous = globalThis.chrome;
  globalThis.chrome = mock.api as unknown as typeof chrome;
  try {
    await updateBadge(view());
    assert.equal(mock.current(1), '63%');
    mock.tabs.set(1, { id: 1, url: 'https://unrelated.invalid/' });
    await updateBadge(view());
    assert.equal(mock.current(1), ''); assert.equal(mock.titles.get(1), 'AI Gauge');
  } finally { globalThis.chrome = previous; }
});

test('revoked permissions and redacted URLs clear stale tab numbers without new permissions', async () => {
  const mock = browser([{ id: 1, url: 'https://chatgpt.com/codex' }, { id: 2, url: 'https://claude.ai/new' }]);
  const previous = globalThis.chrome;
  globalThis.chrome = mock.api as unknown as typeof chrome;
  try {
    const current = view();
    await updateBadge(current);
    assert.equal(mock.current(1), '15%');
    current.permissions.chatgpt = false; current.permissions.work_codex = false;
    mock.tabs.set(1, { id: 1 });
    await updateBadge(current);
    assert.equal(mock.current(1), ''); assert.equal(mock.titles.get(1), 'AI Gauge');
    assert.equal(mock.current(2), '63%');
    current.snapshots.claude.state = 'error'; current.snapshots.claude.errorCode = 'network';
    await updateBadge(current);
    assert.equal(mock.current(2), '—');
    assert.equal(mock.colors.get(2), '#697386'); assert.equal(mock.textColors.get(2), '#FFFFFF');
  } finally { globalThis.chrome = previous; }
});

test('closed-tab failures during lookup or action writes do not stop other badge updates', async () => {
  const mock = browser([{ id: 1, url: 'https://chatgpt.com/' }, { id: 2, url: 'https://claude.ai/' }, { id: 3, url: 'https://claude.ai/' }]);
  const previous = globalThis.chrome, get = mock.api.tabs.get, write = mock.api.action.setBadgeText;
  mock.api.tabs.get = async id => { if (id === 2) throw new Error('Tab already closed'); return get(id); };
  mock.api.action.setBadgeText = async value => { if (value.tabId === 3) throw new Error('Tab closed during action'); await write(value); };
  globalThis.chrome = mock.api as unknown as typeof chrome;
  try {
    await assert.doesNotReject(updateBadge(view()));
    assert.equal(mock.current(1), '15%');
    assert.equal(mock.texts.has(2), false);
  } finally { globalThis.chrome = previous; }
});

test('tab URL is rechecked after enumeration before assigning its badge', async () => {
  const mock = browser([{ id: 1, url: 'https://chatgpt.com/' }]);
  const previous = globalThis.chrome, query = mock.api.tabs.query;
  mock.api.tabs.query = async options => {
    const result = await query(options);
    mock.tabs.set(1, { id: 1, url: 'https://unrelated.invalid/' });
    return result;
  };
  globalThis.chrome = mock.api as unknown as typeof chrome;
  try { await updateBadge(view()); assert.equal(mock.current(1), ''); }
  finally { globalThis.chrome = previous; }
});

test('a delayed old badge write cannot overwrite a newer unsupported-page clear', async () => {
  const mock = browser([{ id: 1, url: 'https://chatgpt.com/' }]);
  const previous = globalThis.chrome, write = mock.api.action.setBadgeText;
  let release: (() => void) | undefined, notifyStarted: (() => void) | undefined;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { notifyStarted = resolve; });
  mock.api.action.setBadgeText = async value => {
    if (value.tabId === 1 && value.text === '15%') { notifyStarted!(); await blocked; }
    await write(value);
  };
  globalThis.chrome = mock.api as unknown as typeof chrome;
  try {
    const first = updateBadge(view());
    await started;
    mock.tabs.set(1, { id: 1, url: 'https://unrelated.invalid/' });
    const latest = updateBadge(view());
    release!();
    await Promise.all([first, latest]);
    assert.equal(mock.current(1), ''); assert.equal(mock.titles.get(1), 'AI Gauge');
    assert.deepEqual(mock.writes.filter(value => value.tabId === 1).map(value => value.text), ['15%', '']);
  } finally { release!(); globalThis.chrome = previous; }
});
