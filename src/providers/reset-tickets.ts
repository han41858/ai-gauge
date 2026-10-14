import type { ResetTicketGrant, ResetTicketInventory, ResetTicketKind, TicketCollection } from '../shared/types';
import { record, resetTime } from '../shared/validation';

// Read-side contracts: Claude Tuner 9b94ac3, parse-chatgpt.js / parse-claude.js.
// These parsers are independent implementations. Fixtures exercise the public contract;
// they are not recorded responses from a logged-in AI Gauge session.
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): string | null => typeof v === 'string' && v.length <= 64 ? resetTime(v) : null;
const bool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
const emptyGrant = (kind: ResetTicketKind, amount: number): ResetTicketGrant => ({ kind, count: amount, startsAt: null, expiresAt: null, usableNow: null, clears: [], requiresLimit: null, blocked: null, selected: null });

export function parseChatGPTTicketSummary(value: unknown): ResetTicketInventory | null {
  const raw = record(value);
  if (!raw || !count(raw.available_count)) return null;
  return {
    mode: 'summary', grants: raw.available_count ? [emptyGrant('unspecified', raw.available_count)] : [],
    usableCount: count(raw.applicable_available_count) && raw.applicable_available_count <= raw.available_count ? raw.applicable_available_count : null,
    cooldownUntil: null
  };
}

export function parseChatGPTTicketDetail(value: unknown, summary: ResetTicketInventory, now = Date.now()): ResetTicketInventory | null {
  const raw = record(value), held = summary.grants.reduce((sum, g) => sum + g.count, 0);
  if (!raw || !Array.isArray(raw.credits) || raw.credits.length > 100 || raw.available_count !== held || raw.credits.length < held) return null;
  const grants: ResetTicketGrant[] = [];
  for (const item of raw.credits) {
    const credit = record(item);
    if (!credit || typeof credit.reset_type !== 'string' || typeof credit.status !== 'string' || !date(credit.expires_at)
      || (credit.granted_at != null && !date(credit.granted_at))) return null;
    if (credit.status !== 'available' || credit.is_supported_by_plan === false) continue;
    const expiresAt = date(credit.expires_at)!;
    if (Date.parse(expiresAt) <= now) continue;
    const kind = credit.reset_type === 'codex_rate_limits' ? 'full' : credit.reset_type === 'codex_five_hour' ? 'five_hour' : credit.reset_type === 'codex_weekly' ? 'weekly' : null;
    // Shadow and undocumented reset types do not prove that a usable reset exists.
    if (!kind) continue;
    grants.push({ ...emptyGrant(kind, 1), startsAt: date(credit.granted_at), expiresAt,
      clears: kind === 'full' ? ['five_hour', 'seven_day'] : [kind === 'weekly' ? 'seven_day' : 'five_hour'] });
  }
  return { mode: 'detail', grants, usableCount: grants.length === held ? summary.usableCount : null, cooldownUntil: null };
}

export function parseClaudeTickets(value: unknown, now = Date.now()): ResetTicketInventory | null {
  const raw = record(value);
  if (!raw || raw.eligible !== true || !Array.isArray(raw.grants) || raw.grants.length > 100
    || (raw.cooldown_until != null && !date(raw.cooldown_until))) return null;
  const grants: ResetTicketGrant[] = [];
  for (const item of raw.grants) {
    const grant = record(item);
    if (!grant || !count(grant.resets_left) || (grant.ends_at !== null && !date(grant.ends_at))
      || (grant.starts_at != null && !date(grant.starts_at))) return null;
    // The public reference's web contract excludes an explicit null expiry; missing expiry is invalid.
    if (grant.resets_left === 0 || grant.ends_at === null) continue;
    const expiresAt = date(grant.ends_at)!;
    if (Date.parse(expiresAt) <= now) continue;
    if (!Array.isArray(grant.clears) || grant.clears.length > 64 || !grant.clears.every(c => typeof c === 'string' && /^[a-z0-9_]{1,64}$/.test(c))) return null;
    const clears = grant.clears.filter((c): c is string => c === 'five_hour' || /^seven_day(?:_[a-z0-9_]+)?$/.test(c));
    const five = clears.includes('five_hour'), weekly = clears.includes('seven_day');
    const kind = five && weekly ? 'full' : !five && weekly ? 'weekly' : five && !clears.some(c => c.startsWith('seven_day')) ? 'five_hour' : null;
    if (!kind) continue;
    grants.push({ ...emptyGrant(kind, grant.resets_left), startsAt: date(grant.starts_at), expiresAt,
      usableNow: bool(grant.usable_now), clears, requiresLimit: bool(grant.use_requires_limit),
      blocked: Array.isArray(grant.blocking) ? grant.blocking.length > 0 : bool(grant.blocked),
      // The MAIN transport compares grant IDs and then discards them.
      selected: bool(grant.selected) });
  }
  return { mode: 'detail', grants, usableCount: null, cooldownUntil: date(raw.cooldown_until) };
}

/** The page transport only returns allowlisted metadata; failures never affect quota parsing. */
export function parseCollectedTickets(provider: 'chatgpt' | 'claude', response: unknown, now = Date.now()): TicketCollection | undefined {
  const envelope = record(record(response)?.reset_tickets);
  if (!envelope) return undefined;
  const scope = typeof envelope.scope === 'string' && /^[a-f0-9]{64}$/.test(envelope.scope) ? envelope.scope : null;
  if (envelope.state === 'auth' || envelope.state === 'context_changed' || envelope.state === 'unavailable') return { state: envelope.state, scope };
  const summary = provider === 'chatgpt' ? parseChatGPTTicketSummary(envelope.summary) : null;
  if (envelope.state === 'error') return { state: 'error', scope, ...(summary ? { fallback: summary } : {}) };
  if (envelope.state !== 'ok') return { state: 'error', scope };
  if (provider === 'claude') {
    const inventory = parseClaudeTickets(envelope.detail, now);
    return inventory ? { state: 'ok', inventory, scope } : { state: 'error', scope };
  }
  if (!summary) return { state: 'error', scope };
  if (envelope.detail === undefined || envelope.detail === null) return { state: 'ok', inventory: summary, scope };
  const inventory = parseChatGPTTicketDetail(envelope.detail, summary, now);
  return inventory ? { state: 'ok', inventory, scope } : { state: 'error', scope, fallback: summary };
}
