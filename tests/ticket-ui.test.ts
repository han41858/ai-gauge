import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { UsageStrip } from '../src/content/usage-strip';
import { renderCards, type Actions } from '../src/popup/render';
import { ticketDate, ticketDisplay } from '../src/shared/ticket-presentation';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';
import type { PageProvider, ResetTicketGrant, Snapshot, View } from '../src/shared/types';

const now = Date.UTC(2026, 9, 14, 12), hour = 3_600_000;
const iso = (offset: number) => new Date(now + offset).toISOString();
const grant = (changes: Partial<ResetTicketGrant> = {}): ResetTicketGrant => ({ kind: 'full', count: 1,
  startsAt: null, expiresAt: iso(24 * hour), usableNow: true, clears: ['five_hour', 'seven_day'],
  requiresLimit: false, blocked: false, selected: null, ...changes });
const snapshot = (provider: Snapshot['provider']): Snapshot => ({ ...emptySnapshot(provider), state: 'ok',
  collectedAt: now, checkedAt: now, errorCode: null,
  limits: [{ id: 'weekly', label: '주간', category: 'window', percent: 42, resetsAt: iso(7 * 24 * hour),
    windowSeconds: 604800, remaining: null, unit: null, source: 'api' }],
  tickets: { checkedAt: now, failures: 0, inventory: { mode: 'detail', grants: [grant()], usableCount: null, cooldownUntil: null } }
});
function view(): View {
  const settings = defaults(); settings.enabled = { chatgpt: true, claude: true, gemini: true };
  return { settings, permissions: { chatgpt: true, claude: true, gemini: true }, snapshots: {
    chatgpt: snapshot('chatgpt'), claude: snapshot('claude'), gemini: snapshot('gemini')
  } };
}
const noop: Actions = { enable() {}, disable() {}, revoke() {} };
const popup = () => {
  const dom = new JSDOM('<main id="cards"></main>');
  return { dom, cards: dom.window.document.getElementById('cards')! };
};
function stripFixture(provider: PageProvider = 'chatgpt') {
  const markup = provider === 'codex'
    ? '<main><div class="ComposerLayoutRoot-synthetic"><textarea></textarea></div></main>'
    : provider === 'claude'
      ? '<main><div data-cds="ChatComposerChin"><div contenteditable="true" class="ProseMirror"></div></div></main>'
      : '<main><form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form></main>';
  const dom = new JSDOM(markup, { url: provider === 'claude' ? 'https://claude.ai/new' : 'https://chatgpt.com/' });
  const roots = new Map<HTMLElement, ShadowRoot>(), original = dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow = function(this: HTMLElement, options: ShadowRootInit) {
    const root = original.call(this, options); roots.set(this, root); return root;
  };
  const doc = dom.window.document, strip = new UsageStrip(provider, doc);
  const root = () => roots.get(doc.getElementById('ai-gauge-usage-strip')!)!;
  return { dom, doc, strip, root, link: () => root().querySelector<HTMLAnchorElement>('.tickets')! };
}

test('popup ticket links show held counts and every local expiry without current availability', () => {
  const { dom, cards } = popup(), v = view();
  try {
    v.snapshots.chatgpt.tickets!.inventory.grants = [grant(), grant({ kind: 'five_hour', expiresAt: iso(48 * hour) })];
    v.snapshots.claude.tickets!.inventory.grants = [grant(), grant({ kind: 'weekly', count: 2,
      startsAt: iso(hour), expiresAt: iso(48 * hour), usableNow: false, clears: ['seven_day'], requiresLimit: true })];
    renderCards(cards, v, noop, now);
    const links = [...cards.querySelectorAll<HTMLAnchorElement>('.ticket-info')];
    assert.equal(links.length, 2, 'Gemini is excluded even with injected ticket data');
    assert.equal(links[0]!.href, 'https://chatgpt.com/settings/usage?tab=overview');
    assert.equal(links[1]!.href, 'https://claude.ai/new#settings/usage');
    assert.equal(links[0]!.querySelector('.ticket-count')!.textContent, '🎫 초기화 티켓 2개');
    assert.equal(links[1]!.querySelector('.ticket-count')!.textContent, '🎫 초기화 티켓 3개');
    assert.deepEqual([...links[0]!.querySelectorAll('.ticket-expiry')].map(row => row.textContent), [
      `${ticketDate(iso(24 * hour))} 만료`, `${ticketDate(iso(48 * hour))} 만료`
    ]);
    assert.deepEqual([...links[1]!.querySelectorAll('.ticket-expiry')].map(row => row.textContent), [
      `${ticketDate(iso(24 * hour))} 만료`, `2개 · ${ticketDate(iso(48 * hour))} 만료`
    ]);
    assert.doesNotMatch(cards.textContent!, /지금 사용 가능/);
    assert.match(links[1]!.title, /전체 한도 1개/);
    assert.match(links[1]!.title, /주간 한도 2개.*부터.*한도 도달 조건.*현재 사용 불가/);
    assert.equal(links[1]!.getAttribute('aria-description'), links[1]!.title);
    for (const link of links) {
      assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
      assert.equal(link.tabIndex, 0); assert.match(link.getAttribute('aria-label')!, /공식 사용량 관리 화면 열기 \(새 탭\)/);
      assert.doesNotMatch(link.getAttribute('aria-label')!, /지금 사용 가능/);
      for (const row of link.querySelectorAll('.ticket-expiry')) assert(link.getAttribute('aria-label')!.includes(row.textContent!));
    }
    assert.equal(cards.querySelectorAll('progress').length, 3);
    assert.equal(cards.querySelector('details,select'), null);
  } finally { dom.window.close(); }
});

test('zero, unknown and expired inventories create no popup ticket section and preserve quota', () => {
  const { dom, cards } = popup();
  try {
    for (const inventory of [null, { checkedAt: now, failures: 0, inventory: { mode: 'detail' as const,
      grants: [], usableCount: 0, cooldownUntil: null } }, { checkedAt: now, failures: 0, inventory: {
      mode: 'detail' as const, grants: [grant({ expiresAt: iso(-1) })], usableCount: null, cooldownUntil: null } }]) {
      const v = view(); v.snapshots.chatgpt.tickets = inventory; v.snapshots.claude.tickets = inventory;
      renderCards(cards, v, noop, now);
      assert.equal(cards.querySelector('.ticket-info'), null);
      assert.equal(cards.querySelectorAll('progress').length, 3);
      assert.doesNotMatch(cards.textContent!, /초기화 티켓/);
    }
  } finally { dom.window.close(); }
});

test('ticket summary without verified expiry shows count only and never invents current availability', () => {
  const v = view(), s = v.snapshots.chatgpt;
  s.tickets!.inventory = { mode: 'summary', grants: [grant({ kind: 'unspecified', count: 2,
    expiresAt: null, usableNow: null, clears: [], requiresLimit: null, blocked: null })], usableCount: null, cooldownUntil: null };
  const display = ticketDisplay(s, now)!;
  assert.equal(display.inline, '🎫 초기화 티켓 2개');
  assert.equal(display.expiry, null); assert.deepEqual(display.entries, []);
  assert.doesNotMatch(display.accessible, /0개|만료/);
  const { dom, cards } = popup();
  try {
    renderCards(cards, v, noop, now);
    const link = cards.querySelector('[data-provider="chatgpt"] .ticket-info')!;
    assert.equal(link.textContent, '🎫 초기화 티켓 2개');
    assert.equal(link.querySelector('.ticket-expiry'), null);
    assert.doesNotMatch(link.getAttribute('aria-label')!, /사용 가능|만료/);
  } finally { dom.window.close(); }
});

test('disabled, revoked, signed-out and invalidated contexts hide previous tickets', () => {
  const { dom, cards } = popup();
  try {
    const v = view(); v.settings.enabled.chatgpt = false; v.permissions.claude = false;
    renderCards(cards, v, noop, now); assert.equal(cards.querySelector('.ticket-info'), null);
    for (const field of ['signed_out', 'pending'] as const) {
      const v = view();
      for (const p of ['chatgpt', 'claude'] as const) {
        if (field === 'signed_out') { v.snapshots[p].state = 'signed_out'; v.snapshots[p].errorCode = 'signed_out'; }
        else v.snapshots[p].ticketRefreshPending = true;
      }
      renderCards(cards, v, noop, now); assert.equal(cards.querySelector('.ticket-info'), null);
    }
  } finally { dom.window.close(); }
});

test('popup local clock excludes expired grants and recalculates held count without fetching', () => {
  const { dom, cards } = popup(), v = view();
  try {
    v.snapshots.chatgpt.tickets!.inventory.grants = [grant({ expiresAt: iso(10_000) }), grant({ expiresAt: iso(60_000) })];
    renderCards(cards, v, noop, now);
    assert.match(cards.querySelector('[data-provider="chatgpt"] .ticket-count')!.textContent!, /티켓 2개/);
    assert.equal(cards.querySelectorAll('[data-provider="chatgpt"] .ticket-expiry').length, 2);
    renderCards(cards, v, noop, now + 15_000);
    assert.match(cards.querySelector('[data-provider="chatgpt"] .ticket-count')!.textContent!, /티켓 1개/);
    assert.deepEqual([...cards.querySelectorAll('[data-provider="chatgpt"] .ticket-expiry')].map(row => row.textContent), [`${ticketDate(iso(60_000))} 만료`]);
    renderCards(cards, v, noop, now + 60_000);
    assert.equal(cards.querySelector('[data-provider="chatgpt"] .ticket-info'), null);
    assert.equal(cards.querySelector('[data-provider="chatgpt"] progress')!.getAttribute('value'), '42');
  } finally { dom.window.close(); }
});

test('ChatGPT and Codex share the same ticket link and Claude opens its own official management page', t => {
  t.mock.method(Date, 'now', () => now);
  const v = view();
  for (const provider of ['chatgpt', 'codex', 'claude'] as const) {
    const f = stripFixture(provider);
    try {
      f.strip.update(v);
      assert.equal(f.link().hidden, false);
      assert.equal(f.link().textContent, `🎫 초기화 티켓 ×1 · ${ticketDate(iso(24 * hour))} 만료`);
      assert.equal(f.link().href, provider === 'claude' ? 'https://claude.ai/new#settings/usage' : 'https://chatgpt.com/settings/usage?tab=overview');
      assert.equal(f.link().tagName, 'A'); assert.equal(f.link().tabIndex, 0);
      assert.equal(f.link().target, '_blank'); assert.equal(f.link().rel, 'noopener noreferrer');
      assert.match(f.link().getAttribute('aria-label')!, /초기화 티켓 1개.*새 탭/);
      assert.doesNotMatch(f.link().getAttribute('aria-label')!, /지금 사용 가능/);
      assert.equal(f.root().querySelector('progress')!.value, 42);
    } finally { f.dom.window.close(); }
  }
});

test('strip clock removes expired ticket content and attributes while retaining the usage node', t => {
  let at = now; t.mock.method(Date, 'now', () => at);
  const f = stripFixture(), v = view(); v.snapshots.chatgpt.tickets!.inventory.grants[0]!.expiresAt = iso(10_000);
  try {
    f.strip.update(v); const link = f.link(), progress = f.root().querySelector('progress');
    assert.equal(link.hidden, false);
    at += 15_000; f.strip.mount();
    assert.equal(f.link(), link); assert.equal(link.hidden, true); assert.equal(link.textContent, '');
    assert.equal(link.hasAttribute('href'), false); assert.equal(link.hasAttribute('title'), false);
    assert.equal(link.hasAttribute('aria-description'), false);
    assert.equal(f.root().querySelector('progress'), progress); assert.equal(progress!.value, 42);
  } finally { f.dom.window.close(); }
});

test('unchanged ticket renders do not churn nodes or mutations and responsive rules hide tickets first', t => {
  t.mock.method(Date, 'now', () => now);
  const f = stripFixture();
  try {
    f.strip.update(view()); const link = f.link(), observer = new f.dom.window.MutationObserver(() => undefined);
    observer.observe(f.root(), { attributes: true, childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 10; i++) f.strip.mount();
    assert.equal(observer.takeRecords().length, 0); assert.equal(f.link(), link);
    const style = f.root().querySelector('style')!.textContent!;
    assert.match(style, /@container ai-gauge \(max-width:900px\)\{\.tickets\{display:none/);
    assert.match(style, /@container ai-gauge \(max-width:520px\)\{\.reset\{display:none/);
    assert.match(style, /:host\{[^}]*height:30px[^}]*font:12px/);
    assert.match(style, /\.tickets:focus-visible\{outline:2px/);
    observer.disconnect();
  } finally { f.dom.window.close(); }
});
