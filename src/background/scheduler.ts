import type { CollectionResult, Provider, Snapshot, UsageLimit } from '../shared/types';
import { CollectionError } from '../shared/errors';
import { FRESH_MS, hasElapsedReset, validLimits } from '../storage/snapshots';
import { knownPlanLabel } from '../shared/plan';
export type Trigger = 'manual' | 'event' | 'periodic' | 'tab';
export interface SchedulerIO { read(p: Provider): Promise<Snapshot>; write(s: Snapshot): Promise<void>; collect(p: Provider): Promise<CollectionResult>; enabled(p: Provider): Promise<boolean>; now(): number }
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
  return { ...previous, limits, state: 'ok', collectedAt: now, checkedAt: now, failures: 0, nextAttemptAt: now + 60_000, errorCode: null,
    plan: label ? { label, checkedAt: now } : null, planRefreshPending: false };
}
export function failure(previous: Snapshot, error: unknown, now: number): Snapshot {
  previous = { ...previous, plan: null, planRefreshPending: false };
  const e = error instanceof CollectionError ? error : new CollectionError('invalid_response');
  if (e.code === 'open_tab') return { ...previous, state: 'error', checkedAt: now, nextAttemptAt: now + 60_000, failures: 0, errorCode: e.code };
  const failures = previous.failures + 1;
  return { ...previous, state: e.state, checkedAt: now, failures, nextAttemptAt: now + Math.max(backoff(failures), e.retryAfterMs), errorCode: e.code };
}
export class Scheduler {
  private flights = new Map<Provider, Promise<Snapshot>>();
  private writes = new Map<Provider, Promise<void>>();
  private planEpoch = new Map<Provider, number>();
  constructor(private io: SchedulerIO) {}
  private update(p: Provider, change: (current: Snapshot) => Snapshot): Promise<void> {
    const task = (this.writes.get(p) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await this.io.write(change(await this.io.read(p)));
    });
    this.writes.set(p, task);
    return task.finally(() => { if (this.writes.get(p) === task) this.writes.delete(p); });
  }
  invalidatePlan(p: Provider): Promise<void> {
    this.planEpoch.set(p, (this.planEpoch.get(p) ?? 0) + 1);
    return this.update(p, current => ({ ...current, plan: null, planRefreshPending: true }));
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
    const before = await this.io.read(p);
    if (!await this.io.enabled(p) || !due(before, trigger, this.io.now())) return before;
    // Persist an attempt lease before fetch: a terminated worker must not instantly repeat it.
    await this.update(p, current => ({ ...current, plan: null, checkedAt: this.io.now(), nextAttemptAt: this.io.now() + 60_000, errorCode: before.errorCode === 'open_tab' ? 'not_collected' : before.errorCode }));
    let after: Snapshot;
    try {
      const result = await this.io.collect(p), now = this.io.now();
      if (!result || !validLimits(result.limits) || !result.limits.length) throw new CollectionError('invalid_response');
      after = success(before, result.limits, now, result.plan);
    }
    catch (e) { after = failure(before, e, this.io.now()); }
    // Disabling a provider or revoking permission while a request is pending must not publish it.
    if (!await this.io.enabled(p)) return before;
    await this.update(p, () => {
      if (epoch !== (this.planEpoch.get(p) ?? 0)) after = { ...after, plan: null, planRefreshPending: true };
      return after;
    });
    return after;
  }
}
