import type { ResetTicketGrant, ResetTicketInventory, Snapshot, TicketCache } from './types';
import { finite, record, resetTime } from './validation';

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nullableBoolean = (value: unknown): value is boolean | null => value === null || typeof value === 'boolean';
const date = (value: unknown): boolean => value === null || resetTime(value) !== null;
const kinds = ['full', 'five_hour', 'weekly', 'unspecified'];

export function parseTicketInventory(input: unknown): ResetTicketInventory | null {
  const raw = record(input);
  if (!raw || typeof raw.mode !== 'string' || !['summary', 'detail'].includes(raw.mode) || !Array.isArray(raw.grants) || raw.grants.length > 100
    || !(raw.usableCount === null || count(raw.usableCount)) || !date(raw.cooldownUntil)) return null;
  const grants: ResetTicketGrant[] = [];
  for (const value of raw.grants) {
    const grant = record(value);
    if (!grant || typeof grant.kind !== 'string' || !kinds.includes(grant.kind) || !count(grant.count)
      || !date(grant.startsAt) || !date(grant.expiresAt)
      || !nullableBoolean(grant.usableNow) || !nullableBoolean(grant.requiresLimit)
      || !nullableBoolean(grant.blocked) || !nullableBoolean(grant.selected)
      || !Array.isArray(grant.clears) || grant.clears.length > 64
      || !grant.clears.every(value => typeof value === 'string' && /^(five_hour|seven_day(?:_[a-z0-9_]+)?)$/.test(value) && value.length <= 64)) return null;
    const startsAt = resetTime(grant.startsAt), expiresAt = resetTime(grant.expiresAt);
    if (startsAt && expiresAt && Date.parse(startsAt) >= Date.parse(expiresAt)) return null;
    grants.push({ kind: grant.kind as ResetTicketGrant['kind'], count: grant.count, startsAt, expiresAt,
      usableNow: grant.usableNow, clears: [...new Set(grant.clears as string[])],
      requiresLimit: grant.requiresLimit, blocked: grant.blocked, selected: grant.selected });
  }
  const total = grants.reduce((sum, grant) => sum + grant.count, 0);
  if (!count(total) || (raw.usableCount !== null && raw.usableCount > total)) return null;
  if (raw.mode === 'summary' && grants.some(grant => grant.kind !== 'unspecified' || grant.startsAt !== null || grant.expiresAt !== null)) return null;
  return { mode: raw.mode as ResetTicketInventory['mode'], grants, usableCount: raw.usableCount as number | null,
    cooldownUntil: resetTime(raw.cooldownUntil) };
}

export function parseTicketCache(input: unknown): TicketCache | null {
  const raw = record(input), inventory = parseTicketInventory(raw?.inventory);
  return inventory && finite(raw?.checkedAt) && raw.checkedAt > 0 && count(raw.failures)
    ? { inventory, checkedAt: raw.checkedAt, failures: raw.failures } : null;
}

export interface TicketSummary { held: number; usable: number | null; expiresAt: string | null; grants: ResetTicketGrant[] }
export function ticketSummary(snapshot: Snapshot, now = Date.now()): TicketSummary | null {
  if (snapshot.provider === 'gemini' || snapshot.ticketRefreshPending || !finite(now)
    || ['signed_out', 'permission_required', 'unsupported'].includes(snapshot.state)
    || ['signed_out', 'access_denied', 'ambiguous_account', 'permission_required'].includes(snapshot.errorCode ?? '')) return null;
  const cache = parseTicketCache(snapshot.tickets);
  if (!cache || cache.checkedAt > now || cache.failures >= 2) return null;
  const { inventory, checkedAt } = cache;
  const grants = inventory.grants.filter(grant => grant.count > 0 && (grant.expiresAt === null || Date.parse(grant.expiresAt) > now));
  const held = grants.reduce((sum, grant) => sum + grant.count, 0);
  if (!held) return null;
  const expiry = grants.flatMap(grant => grant.expiresAt ? [Date.parse(grant.expiresAt)] : []);
  const cooldown = inventory.cooldownUntil ? Date.parse(inventory.cooldownUntil) : null;
  const crossed = (time: string | null) => time !== null && Date.parse(time) > checkedAt && Date.parse(time) <= now;
  // Aggregate availability cannot be redistributed across expired/future grants.
  const changedBoundary = inventory.grants.some(grant => crossed(grant.startsAt) || crossed(grant.expiresAt)) || crossed(inventory.cooldownUntil);
  let usable: number | null = null;
  if (cooldown !== null && cooldown > now) usable = 0;
  else if (inventory.usableCount !== null && !changedBoundary) {
    const startedCount = grants.filter(grant => grant.startsAt === null || Date.parse(grant.startsAt) <= now)
      .reduce((sum, grant) => sum + grant.count, 0);
    usable = inventory.usableCount === 0 || (startedCount === held && inventory.usableCount <= startedCount) ? inventory.usableCount : null;
  } else if (inventory.mode === 'detail') {
    let total = 0, known = true;
    for (const grant of grants) {
      if (grant.startsAt !== null && Date.parse(grant.startsAt) > now) continue;
      if (crossed(grant.startsAt) || crossed(inventory.cooldownUntil)) { known = false; continue; }
      if (grant.blocked === true || grant.selected === false || grant.usableNow === false) continue;
      if (grant.usableNow === true) total += grant.count;
      else known = false;
    }
    if (known) usable = total;
  }
  return { held, usable, expiresAt: expiry.length ? new Date(Math.min(...expiry)).toISOString() : null, grants };
}
