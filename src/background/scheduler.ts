import type { CollectionResult, Provider, Snapshot, TicketCollection, UsageLimit } from '../shared/types';
import { CollectionError } from '../shared/errors';
import { FRESH_MS, hasElapsedReset, validLimits } from '../storage/snapshots';
import { knownPlanLabel } from '../shared/plan';
import { parseTicketCache, parseTicketInventory } from '../shared/tickets';
export type Trigger = 'manual' | 'event' | 'periodic' | 'tab';
export interface SchedulerIO {
  read(p: Provider): Promise<Snapshot>; write(s: Snapshot): Promise<void>; collect(p: Provider): Promise<CollectionResult>;
  enabled(p: Provider): Promise<boolean>; now(): number;
  readTicketTrust?(p: Provider): Promise<boolean>; writeTicketTrust?(p: Provider, trusted: boolean): Promise<void>;
}
export function backoff(failures: number): number { return Math.min(60 * 60_000, 60_000 * 2 ** Math.min(6, Math.max(0, failures - 1))); }
export function due(s: Snapshot, trigger: Trigger, now: number): boolean {
  // Only a browser tab lifecycle event can lift a missing-tab delay. Popup view
  // reads also use 'event', so letting those through would create a storage loop.
  if (s.state === 'error' && s.errorCode === 'open_tab' && trigger === 'tab') return true;
  if (now < s.nextAttemptAt) return false;
  if (s.checkedAt !== null && now - s.checkedAt < 60_000) return false;
  if (trigger !== 'manual' && ['signed_out', 'permission_required', 'unsupported'].includes(s.state)) return false;
  return trigger === 'manual' || s.collectedAt === null || s.state !== 'ok' || s.planRefreshPending === true || hasElapsedReset(s, now)
    || s.collectedAt > now + 60_000 || now - s.collectedAt >= (trigger === 'periodic' ? FRESH_MS : 60_000);
}
export function success(previous: Snapshot, limits: UsageLimit[], now: number, plan: unknown = null): Snapshot {
  const label = knownPlanLabel(previous.provider, plan);
  const { usageInvalidated: _usageInvalidated, ...retained } = previous;
  return { ...retained, limits, state: 'ok', collectedAt: now, checkedAt: now, failures: 0, nextAttemptAt: now + 60_000, errorCode: null,
    plan: label ? { label, checkedAt: now } : null, planRefreshPending: false };
}
export function failure(previous: Snapshot, error: unknown, now: number): Snapshot {
  previous = { ...previous, plan: null, planRefreshPending: false };
  const e = error instanceof CollectionError ? error : new CollectionError('invalid_response');
  // A later tab/network failure must not revive usage from a known invalid
  // account or permission context, including after a worker restart.
  const invalidatesUsage = (code: Snapshot['errorCode']) => code !== null
    && ['signed_out', 'access_denied', 'permission_required', 'ambiguous_account', 'unsupported'].includes(code);
  if (invalidatesUsage(e.code) || invalidatesUsage(previous.errorCode)
    || ['signed_out', 'permission_required', 'unsupported'].includes(previous.state)) previous = { ...previous, usageInvalidated: true };
  if (Object.hasOwn(previous, 'tickets')) previous = { ...previous,
    tickets: ['signed_out', 'access_denied', 'permission_required', 'ambiguous_account', 'unsupported'].includes(e.code) ? null : previous.tickets ?? null,
    ticketRefreshPending: true };
  if (e.code === 'open_tab') return { ...previous, state: 'error', checkedAt: now, nextAttemptAt: now + 60_000, failures: 0, errorCode: e.code };
  const failures = previous.failures + 1;
  return { ...previous, state: e.state, checkedAt: now, failures, nextAttemptAt: now + Math.max(backoff(failures), e.retryAfterMs), errorCode: e.code };
}
export class Scheduler {
  private flights = new Map<Provider, Promise<Snapshot>>();
  private writes = new Map<Provider, Promise<void>>();
  private planEpoch = new Map<Provider, number>();
  private ticketEpoch = new Map<Provider, number>();
  private ticketScopes = new Map<Provider, string>();
  constructor(private io: SchedulerIO) {}
  private update(p: Provider, change: (current: Snapshot) => Snapshot, updateTrust = false): Promise<void> {
    const task = (this.writes.get(p) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const after = change(await this.io.read(p));
      if (updateTrust) await this.io.writeTicketTrust?.(p, false).catch(() => undefined);
      await this.io.write(after);
      if (updateTrust && after.tickets && !after.ticketRefreshPending && after.tickets.failures < 2)
        await this.io.writeTicketTrust?.(p, true).catch(() => undefined);
    });
    this.writes.set(p, task);
    return task.finally(() => { if (this.writes.get(p) === task) this.writes.delete(p); });
  }
  invalidatePlan(p: Provider): Promise<void> {
    this.planEpoch.set(p, (this.planEpoch.get(p) ?? 0) + 1);
    this.ticketEpoch.set(p, (this.ticketEpoch.get(p) ?? 0) + 1);
    this.ticketScopes.delete(p);
    return this.update(p, current => ({ ...current, plan: null, planRefreshPending: true,
      ...(Object.hasOwn(current, 'tickets') ? { tickets: null, ticketRefreshPending: true } : {}) }), true);
  }
  invalidateTickets(p: Provider, preserveCache = false): Promise<void> {
    this.ticketEpoch.set(p, (this.ticketEpoch.get(p) ?? 0) + 1);
    this.ticketScopes.delete(p);
    return this.update(p, current => Object.hasOwn(current, 'tickets')
      ? { ...current, tickets: preserveCache ? current.tickets ?? null : null, ticketRefreshPending: true } : current, true);
  }
  async prepareTickets(): Promise<void> {
    // A session-only boolean keeps normal worker eviction from hiding valid
    // counts. Browser restart/missing session trust requires fresh collection.
    await Promise.all((['chatgpt', 'claude'] as const).map(async p => {
      if (await this.io.readTicketTrust?.(p).catch(() => false)) return;
      await this.invalidateTickets(p, true);
    }));
  }
  private tickets(previous: Snapshot, after: Snapshot, result: TicketCollection | undefined, now: number): Snapshot {
    if (after.provider === 'gemini' || !result) {
      if (Object.hasOwn(previous, 'tickets')) return { ...after, tickets: null, ticketRefreshPending: false };
      return after;
    }
    const p = after.provider;
    const scope = typeof result.scope === 'string' && /^[a-f0-9]{64}$/.test(result.scope) ? result.scope : null;
    const remembered = this.ticketScopes.get(p);
    const same = scope !== null && scope === remembered;
    const changed = remembered !== undefined && scope !== remembered;
    const old = same && !previous.ticketRefreshPending ? parseTicketCache(previous.tickets) : null;
    const inventory = result.state === 'ok' ? parseTicketInventory(result.inventory) : null;
    if (inventory) {
      if (scope) this.ticketScopes.set(p, scope); else this.ticketScopes.delete(p);
      return { ...after, tickets: { inventory, checkedAt: now, failures: 0 }, ticketRefreshPending: false };
    }
    if (result.state === 'error' || result.state === 'ok') {
      const reported = parseTicketInventory(result.fallback);
      const reportedCount = reported?.mode === 'summary' ? reported.grants.reduce((sum, grant) => sum + grant.count, 0) : null;
      if (reported?.mode === 'summary' && reportedCount === 0) {
        if (scope) this.ticketScopes.set(p, scope); else this.ticketScopes.delete(p);
        return { ...after, tickets: { inventory: reported, checkedAt: now, failures: 0 }, ticketRefreshPending: false };
      }
      if (old) {
        const cachedCount = old.inventory.grants.filter(grant => grant.expiresAt === null || Date.parse(grant.expiresAt) > now)
          .reduce((sum, grant) => sum + grant.count, 0);
        if (reportedCount === null || reportedCount === cachedCount)
          return { ...after, tickets: { ...old, failures: old.failures + 1 }, ticketRefreshPending: false };
      }
      const fallback = !changed && previous.tickets?.inventory.mode !== 'detail' ? reported : null;
      if (fallback?.mode === 'summary') {
        if (scope) this.ticketScopes.set(p, scope); else this.ticketScopes.delete(p);
        return { ...after, tickets: { inventory: fallback, checkedAt: now, failures: 0 }, ticketRefreshPending: false };
      }
    }
    this.ticketScopes.delete(p);
    return { ...after, tickets: null, ticketRefreshPending: false };
  }
  refresh(p: Provider, trigger: Trigger): Promise<Snapshot> {
    const active = this.flights.get(p);
    if (active) return active;
    const task = this.run(p, trigger).finally(() => this.flights.delete(p));
    this.flights.set(p, task);
    return task;
  }
  private async run(p: Provider, trigger: Trigger): Promise<Snapshot> {
    const epoch = this.planEpoch.get(p) ?? 0;
    const ticketEpoch = this.ticketEpoch.get(p) ?? 0;
    const before = await this.io.read(p);
    if (!await this.io.enabled(p) || !due(before, trigger, this.io.now())) return before;
    // Persist an attempt lease before fetch: a terminated worker must not instantly repeat it.
    await this.update(p, current => ({ ...current, checkedAt: this.io.now(), nextAttemptAt: this.io.now() + 60_000, errorCode: before.errorCode === 'open_tab' ? 'not_collected' : before.errorCode }));
    let after: Snapshot;
    try {
      const result = await this.io.collect(p), now = this.io.now();
      if (!result || !validLimits(result.limits) || !result.limits.length) throw new CollectionError('invalid_response');
      after = success(before, result.limits, now, result.plan);
      after = this.tickets(before, after, result.tickets, now);
    }
    catch (e) { this.ticketScopes.delete(p); after = failure(before, e, this.io.now()); }
    // Disabling a provider or revoking permission while a request is pending must not publish it.
    if (!await this.io.enabled(p)) return before;
    await this.update(p, () => {
      if (epoch !== (this.planEpoch.get(p) ?? 0)) after = { ...after, plan: null, planRefreshPending: true };
      if (ticketEpoch !== (this.ticketEpoch.get(p) ?? 0) && Object.hasOwn(after, 'tickets')) {
        this.ticketScopes.delete(p);
        after = { ...after, tickets: null, ticketRefreshPending: true };
      }
      return after;
    }, Object.hasOwn(after, 'tickets'));
    return after;
  }
}
