import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, due, failure, success } from '../src/background/scheduler';
import { CollectionError } from '../src/shared/errors';
import { parseTicketCache, parseTicketInventory, ticketSummary } from '../src/shared/tickets';
import type { CollectionResult, Provider, ResetTicketGrant, ResetTicketInventory, Snapshot, TicketCollection, UsageLimit } from '../src/shared/types';
import { effectiveSnapshot, emptySnapshot, parseSnapshot } from '../src/storage/snapshots';
import { readTicketTrust, writeTicketTrust } from '../src/storage/ticket-trust';

const base = Date.UTC(2026, 9, 14, 12);
const stamp = (offset: number) => new Date(base + offset).toISOString();
const scopeA = 'a'.repeat(64), scopeB = 'b'.repeat(64);
const limits: UsageLimit[] = [{ id: 'five_hour', label: '5시간', category: 'window', percent: 31,
  resetsAt: null, windowSeconds: 18_000, remaining: null, unit: null, source: 'api' }];
const grant = (patch: Partial<ResetTicketGrant> = {}): ResetTicketGrant => ({ kind: 'full', count: 1, startsAt: null,
  expiresAt: stamp(3_600_000), usableNow: true, clears: ['five_hour', 'seven_day'], requiresLimit: false,
  blocked: false, selected: true, ...patch });
const detail = (grants = [grant()]): ResetTicketInventory => ({ mode: 'detail', grants, usableCount: null, cooldownUntil: null });
const summary = (count = 2): ResetTicketInventory => ({ mode: 'summary', grants: [grant({ kind: 'unspecified', count,
  expiresAt: null, usableNow: null, clears: [], requiresLimit: null, blocked: null, selected: null })], usableCount: null, cooldownUntil: null });
const snapshot = (inventory = detail()): Snapshot => ({ ...success(emptySnapshot('chatgpt'), limits, base, 'Plus'),
  tickets: { inventory, checkedAt: base, failures: 0 }, ticketRefreshPending: false });
function harness(initial = emptySnapshot('chatgpt')) {
  let stored = structuredClone(initial), now = base, calls = 0;
  let result: CollectionResult | Error = { limits, plan: 'Plus', tickets: { state: 'ok', inventory: detail(), scope: scopeA } };
  const io = { read: async (provider: Provider) => structuredClone(provider === stored.provider ? stored : emptySnapshot(provider)),
    write: async (value: Snapshot) => { if (value.provider === stored.provider) stored = structuredClone(value); },
    enabled: async () => true, now: () => now, collect: async () => { calls++; if (result instanceof Error) throw result; return result; } };
  const scheduler = new Scheduler(io);
  return { scheduler, io, stored: () => stored, calls: () => calls,
    advance: (ms = 60_000) => { now += ms; }, now: () => now,
    outcome: (tickets: TicketCollection) => { result = { limits, plan: 'Plus', tickets }; },
    error: (error: Error) => { result = error; }
  };
}

test('ticket normalization rejects unknown structures and strips arbitrary identity fields without affecting quota', () => {
  const valid = snapshot();
  const restored = parseSnapshot({ ...valid, scope: scopeA, accountId: 'private-account', tickets: {
    ...valid.tickets, scope: scopeA, inventory: { ...valid.tickets!.inventory, orgId: 'private-org', grants: [
      { ...grant(), id: 'private-ticket', token: 'secret', email: 'private@example.test' }
    ] }
  } }, 'chatgpt');
  assert.deepEqual(restored, valid);
  assert.doesNotMatch(JSON.stringify(restored), /private|secret|scope|accountId|orgId|email|token/);
  for (const value of [null, {}, [], { ...detail(), mode: 'future-mode' }, { ...detail(), mode: { toString: () => 'detail' } }, { ...detail(), usableCount: 2 },
    detail([grant({ count: -1 })]), detail([grant({ count: 0.5 })]), detail([grant({ startsAt: stamp(4_000_000) })]),
    detail([grant({ expiresAt: 'tomorrow' })]), detail([grant({ clears: ['private@example.test'] })])]) {
    assert.equal(parseTicketInventory(value), null);
    const parsed = parseSnapshot({ ...valid, tickets: { inventory: value, checkedAt: base, failures: 0 } }, 'chatgpt');
    assert.equal(parsed.tickets, null); assert.deepEqual(parsed.limits, limits); assert.equal(parsed.state, 'ok');
  }
  assert.equal(parseTicketCache({ ...valid.tickets, failures: -1 }), null);
  assert.equal(parseTicketCache({ ...valid.tickets, checkedAt: 'yesterday' }), null);
  assert.equal(parseSnapshot(valid, 'gemini').tickets, undefined);
  const legacy = success(emptySnapshot('chatgpt'), limits, base);
  assert.deepEqual(parseSnapshot(legacy, 'chatgpt'), legacy);
});

test('zero or unknown tickets remain hidden, while one or multiple kinds have summed holdings and earliest known expiry', () => {
  assert.equal(ticketSummary(snapshot(detail([])), base), null);
  assert.equal(ticketSummary(snapshot(detail([grant({ count: 0 })])), base), null);
  assert.equal(ticketSummary({ ...snapshot(), tickets: null }, base), null);
  assert.equal(ticketSummary({ ...snapshot(), provider: 'gemini' }, base), null);
  assert.equal(ticketSummary(snapshot(), base)?.held, 1);
  const combined = detail([grant({ count: 2, kind: 'five_hour', expiresAt: stamp(7_200_000) }),
    grant({ kind: 'weekly', expiresAt: stamp(1_800_000) })]);
  const value = ticketSummary(snapshot(combined), base)!;
  assert.equal(value.held, 3); assert.equal(value.usable, 3); assert.equal(value.expiresAt, stamp(1_800_000));
  assert.deepEqual(value.grants.map(g => g.kind), ['five_hour', 'weekly']);
  const countOnly = ticketSummary(snapshot(summary(2)), base)!;
  assert.equal(countOnly.held, 2); assert.equal(countOnly.usable, null); assert.equal(countOnly.expiresAt, null);
});

test('current time removes expired grants and excludes future starts, blocking, selection and unknown availability', () => {
  const value = detail([grant({ count: 2, expiresAt: stamp(60_000) }), grant({ startsAt: stamp(120_000) }),
    grant({ usableNow: false }), grant({ blocked: true }), grant({ selected: false }), grant()]);
  assert.equal(ticketSummary(snapshot(value), base)?.held, 7);
  assert.equal(ticketSummary(snapshot(value), base)?.usable, 3);
  const expired = ticketSummary(snapshot(value), base + 60_000)!;
  assert.equal(expired.held, 5); assert.equal(expired.usable, 1); assert.equal(expired.expiresAt, stamp(3_600_000));
  assert.equal(ticketSummary(snapshot(value), base + 120_000)?.usable, null, 'a crossed start must not invent new usability');
  assert.equal(ticketSummary(snapshot(value), base + 3_600_000), null);
  assert.equal(ticketSummary(snapshot(detail([grant({ usableNow: null, requiresLimit: true })])), base)?.usable, null);
});

test('aggregate availability becomes unknown after a timing boundary and cooldown never creates future usable counts', () => {
  const inventory = { ...detail([grant({ usableNow: null, expiresAt: stamp(60_000) }), grant({ usableNow: null })]), usableCount: 1 };
  assert.equal(ticketSummary(snapshot(inventory), base)?.usable, 1);
  assert.equal(ticketSummary(snapshot(inventory), base + 60_000)?.usable, null);
  const cooldown = { ...detail(), cooldownUntil: stamp(120_000) };
  assert.equal(ticketSummary(snapshot(cooldown), base)?.usable, 0);
  assert.equal(ticketSummary(snapshot(cooldown), base + 120_000)?.usable, null);
  const future = { ...detail([grant({ usableNow: null }), grant({ usableNow: null, startsAt: stamp(120_000) })]), usableCount: 1 };
  assert.equal(ticketSummary(snapshot(future), base)?.usable, null, 'aggregate availability cannot be assigned across future grants');
  assert.equal(ticketSummary(snapshot({ ...future, usableCount: 0 }), base)?.usable, 0);
});

test('same-context optional failures retain original expiries once, hide repeated failures, and recover independently of quota', async () => {
  const h = harness(); await h.scheduler.refresh('chatgpt', 'manual');
  const original = structuredClone(h.stored().tickets);
  h.advance(); h.outcome({ state: 'error', scope: scopeA, fallback: summary(1) });
  await h.scheduler.refresh('chatgpt', 'manual');
  assert.equal(h.stored().state, 'ok'); assert.equal(h.stored().collectedAt, h.now());
  assert.deepEqual(h.stored().tickets?.inventory, original?.inventory);
  assert.equal(h.stored().tickets?.checkedAt, base);
  assert.equal(ticketSummary(h.stored(), h.now())?.held, 1);
  h.advance(); await h.scheduler.refresh('chatgpt', 'manual');
  assert.equal(h.stored().tickets?.failures, 2); assert.equal(ticketSummary(h.stored(), h.now()), null);
  assert.deepEqual(h.stored().limits, limits);
  h.advance(); h.outcome({ state: 'ok', scope: scopeA, inventory: detail([grant({ count: 4 })]) });
  await h.scheduler.refresh('chatgpt', 'manual');
  assert.equal(ticketSummary(h.stored(), h.now())?.held, 4); assert.equal(h.stored().tickets?.failures, 0);
});

test('verified zero replaces old holdings and unavailable/auth outcomes never become invented zero', async () => {
  for (const state of ['unavailable', 'auth', 'context_changed'] as const) {
    const h = harness(); await h.scheduler.refresh('chatgpt', 'manual');
    h.advance(); h.outcome({ state, scope: scopeA }); await h.scheduler.refresh('chatgpt', 'manual');
    assert.equal(h.stored().tickets, null); assert.equal(h.stored().state, 'ok'); assert.deepEqual(h.stored().limits, limits);
  }
  const h = harness(); await h.scheduler.refresh('chatgpt', 'manual'); h.advance();
  h.outcome({ state: 'ok', scope: scopeA, inventory: detail([]) }); await h.scheduler.refresh('chatgpt', 'manual');
  assert.deepEqual(h.stored().tickets?.inventory.grants, []); assert.equal(ticketSummary(h.stored(), h.now()), null);
});

test('a fresh summary contradicting saved details never displays old holdings or reassigns their expiries', async () => {
  for (const currentCount of [0, 2]) {
    const h = harness(); await h.scheduler.refresh('chatgpt', 'manual');
    h.advance(); h.outcome({ state: 'error', scope: scopeA, fallback: summary(currentCount) });
    await h.scheduler.refresh('chatgpt', 'manual');
    assert.equal(ticketSummary(h.stored(), h.now()), null);
    if (currentCount === 0) assert.equal(h.stored().tickets?.inventory.grants[0]?.count, 0, 'explicit zero is a fresh verified count');
    else assert.equal(h.stored().tickets, null, 'changed positive counts have no verified matching expiry inventory');
    assert.deepEqual(h.stored().limits, limits); assert.equal(h.stored().state, 'ok');
  }
});

test('changed or missing account proof cannot reuse previous detailed tickets or replace them with a count-only failure fallback', async () => {
  for (const scope of [scopeB, null]) {
    const h = harness(); await h.scheduler.refresh('chatgpt', 'manual');
    h.advance(); h.outcome({ state: 'error', scope, fallback: summary(8) });
    await h.scheduler.refresh('chatgpt', 'manual');
    assert.equal(h.stored().tickets, null); assert.equal(ticketSummary(h.stored(), h.now()), null);
    assert.equal(h.stored().state, 'ok'); assert.equal(h.stored().collectedAt, h.now());
  }
  const h = harness(); h.outcome({ state: 'error', scope: scopeA, fallback: summary(2) });
  await h.scheduler.refresh('chatgpt', 'manual'); assert.equal(ticketSummary(h.stored(), h.now())?.held, 2);
});

test('full usage failure cannot verify ticket identity, but normal usage cache grace remains intact', async () => {
  const h = harness(); await h.scheduler.refresh('chatgpt', 'manual');
  h.advance(); h.error(new CollectionError('network')); await h.scheduler.refresh('chatgpt', 'manual');
  assert.equal(h.stored().tickets?.inventory.grants.length, 1, 'last good data may remain stored but hidden');
  assert.equal(h.stored().ticketRefreshPending, true); assert.equal(ticketSummary(h.stored(), h.now()), null);
  assert.equal(effectiveSnapshot(h.stored(), h.now()).state, 'ok');
  const signedOut = failure(snapshot(), new CollectionError('signed_out', 'signed_out'), base + 60_000);
  assert.equal(signedOut.tickets, null); assert.deepEqual(signedOut.limits, limits);
});

test('worker restart hides unbound saved tickets, preserves retry gates, and recollects before exposing them', async () => {
  const h = harness(snapshot()); const restarted = new Scheduler(h.io);
  await restarted.prepareTickets();
  assert.equal(h.stored().ticketRefreshPending, true); assert.equal(ticketSummary(h.stored(), base), null);
  assert.equal(h.stored().plan?.label, 'Plus'); assert.deepEqual(h.stored().limits, limits);
  await restarted.refresh('chatgpt', 'periodic'); assert.equal(h.calls(), 0);
  for (let i = 0; i < 9; i++) {
    h.advance(); const nextWorker = new Scheduler(h.io); await nextWorker.prepareTickets();
    await nextWorker.refresh('chatgpt', 'periodic'); assert.equal(h.calls(), 0, 'worker restart must not change the ten-minute collection interval');
  }
  h.advance(); await restarted.refresh('chatgpt', 'periodic');
  assert.equal(h.calls(), 1); assert.equal(ticketSummary(h.stored(), h.now())?.held, 1);
  assert.equal(h.stored().ticketRefreshPending, false);
  for (const error of [new CollectionError('rate_limited', 'rate_limited', 600_000), new CollectionError('signed_out', 'signed_out')]) {
    const stored = failure(snapshot(), error, base);
    assert.equal(due({ ...stored, ticketRefreshPending: true }, 'periodic', base + 60_000), false);
  }
  assert.doesNotMatch(JSON.stringify(h.stored()), new RegExp(`${scopeA}|scope|account_id|orgId`));
});

test('document invalidation during a collection prevents old tickets from returning without losing the new usage result', async () => {
  let stored = snapshot(), finish!: (result: CollectionResult) => void, started!: () => void;
  const pending = new Promise<CollectionResult>(resolve => { finish = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const scheduler = new Scheduler({ read: async () => stored, write: async value => { stored = value; }, enabled: async () => true,
    now: () => base + 60_000, collect: async () => { started(); return pending; } });
  const refresh = scheduler.refresh('chatgpt', 'manual'); await ready;
  await scheduler.invalidatePlan('chatgpt'); assert.equal(stored.tickets, null);
  finish({ limits: [{ ...limits[0]!, percent: 44 }], plan: 'Plus', tickets: { state: 'ok', inventory: detail(), scope: scopeA } });
  await refresh; assert.equal(stored.tickets, null); assert.equal(stored.ticketRefreshPending, true);
  assert.equal(stored.limits[0]!.percent, 44); assert.equal(stored.state, 'ok');
});

test('disabling or revoking ticket trust drops all holdings until a fresh successful response', async () => {
  const h = harness(); await h.scheduler.refresh('chatgpt', 'manual');
  await h.scheduler.invalidateTickets('chatgpt');
  assert.equal(h.stored().tickets, null); assert.equal(h.stored().ticketRefreshPending, true);
  assert.equal(h.stored().plan?.label, 'Plus'); assert.deepEqual(h.stored().limits, limits);
  h.advance(); h.outcome({ state: 'error', scope: scopeA }); await h.scheduler.refresh('chatgpt', 'manual');
  assert.equal(ticketSummary(h.stored(), h.now()), null);
});

test('session-only trust keeps successful tickets visible across minute-by-minute worker eviction without extra API calls', async () => {
  for (const scope of [scopeA, null]) {
    const h = harness(); h.outcome({ state: 'ok', scope, inventory: detail() });
    const trust = new Map<string, boolean>();
    const io = { ...h.io, readTicketTrust: async (provider: string) => trust.get(provider) === true,
      writeTicketTrust: async (provider: string, value: boolean) => { trust.set(provider, value); } };
    await new Scheduler(io).refresh('chatgpt', 'manual');
    assert.equal(trust.get('chatgpt'), true);
    for (let i = 0; i < 9; i++) {
      h.advance(); const restarted = new Scheduler(io); await restarted.prepareTickets();
      assert.equal(ticketSummary(h.stored(), h.now())?.held, 1);
      await restarted.refresh('chatgpt', 'periodic'); assert.equal(h.calls(), 1);
    }
    h.advance(); const restarted = new Scheduler(io); await restarted.prepareTickets();
    await restarted.refresh('chatgpt', 'periodic'); assert.equal(h.calls(), 2);
    assert.equal(ticketSummary(h.stored(), h.now())?.held, 1);
    const unknownScopeWorker = new Scheduler(io); await unknownScopeWorker.prepareTickets();
    h.advance(); h.outcome({ state: 'error', scope }); await unknownScopeWorker.refresh('chatgpt', 'manual');
    assert.equal(ticketSummary(h.stored(), h.now()), null, 'session trust is not identity proof for reusing failed metadata');
    assert.equal(trust.get('chatgpt'), false);
  }
});

test('missing browser-session trust quarantines persisted data and contains only provider booleans when available', async () => {
  const previous = globalThis.chrome, session: Record<string, unknown> = {};
  globalThis.chrome = { storage: { session: {
    get: async (key: string) => ({ [key]: session[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(session, values); }
  } } } as unknown as typeof chrome;
  try {
    assert.equal(await readTicketTrust('chatgpt'), false);
    await writeTicketTrust('chatgpt', true); assert.equal(await readTicketTrust('chatgpt'), true);
    await writeTicketTrust('claude', false); assert.equal(await readTicketTrust('claude'), false);
    assert.deepEqual(session, { 'ticket-trust:v1:chatgpt': true, 'ticket-trust:v1:claude': false });
    Object.assign(session, { 'ticket-trust:v1:chatgpt': 'true' }); assert.equal(await readTicketTrust('chatgpt'), false);
    globalThis.chrome = { storage: {} } as unknown as typeof chrome;
    assert.equal(await readTicketTrust('chatgpt'), false); await writeTicketTrust('chatgpt', true);
    globalThis.chrome = { storage: { session: { get: async () => { throw new Error('session unavailable'); },
      set: async () => { throw new Error('session unavailable'); } } } } as unknown as typeof chrome;
    assert.equal(await readTicketTrust('chatgpt'), false); await writeTicketTrust('chatgpt', true);
  } finally { globalThis.chrome = previous; }
});
