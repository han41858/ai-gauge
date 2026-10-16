import type { Provider, ResetTicketGrant, ResetTicketKind, Snapshot } from './types';
import { ticketSummary } from './tickets';
import { localStamp, relativeTime } from './format';
import { t, type MessageKey } from './i18n';

const MANAGEMENT_URLS: Partial<Record<Provider, string>> = {
  chatgpt: 'https://chatgpt.com/settings/usage?tab=overview',
  claude: 'https://claude.ai/new#settings/usage'
};
const KIND_KEYS: Record<ResetTicketKind, MessageKey> = {
  full: 'ticket_kind_full', five_hour: 'ticket_kind_five_hour', weekly: 'ticket_kind_weekly', unspecified: 'ticket_kind_unspecified'
};
const ticketCount = (count: number) => t(count === 1 ? 'ticket_count_one' : 'ticket_count_other', String(count));
export function inlineTicketDisplay(snapshot: Snapshot, now = Date.now()) {
  // The popup keeps its existing cache grace; the strip requires a successful ticket check.
  const usageReady = snapshot.state === 'ok' && snapshot.errorCode === null;
  const resetElapsed = snapshot.state === 'error' && snapshot.errorCode === 'reset_pending';
  if ((!usageReady && !resetElapsed) || snapshot.failures !== 0 || snapshot.usageInvalidated
    || snapshot.tickets?.failures !== 0) return null;
  const href = MANAGEMENT_URLS[snapshot.provider], summary = ticketSummary(snapshot, now);
  if (!href || !summary?.expiresAt) return null;
  const remaining = relativeTime(Date.parse(summary.expiresAt) - now);
  if (!remaining) return null;
  const text = t('ticket_inline', remaining);
  return { href, text, accessible: `${text}. ${t('ticket_management_action')}` };
}
export const ticketDate = (value: string): string => localStamp(new Date(value));
function grantDetail(grant: ResetTicketGrant, now: number): string {
  const conditions: string[] = [];
  if (grant.startsAt && Date.parse(grant.startsAt) > now) conditions.push(t('ticket_starts', ticketDate(grant.startsAt)));
  if (grant.expiresAt) conditions.push(t('ticket_expiry', ticketDate(grant.expiresAt)));
  if (grant.requiresLimit) conditions.push(t('ticket_requires_limit'));
  if (grant.blocked) conditions.push(t('ticket_blocked'));
  if (grant.selected === false) conditions.push(t('ticket_other_first'));
  if (grant.usableNow === false) conditions.push(t('ticket_unavailable_now'));
  if (grant.usableNow === null) conditions.push(t('ticket_availability_unknown'));
  return `${t(KIND_KEYS[grant.kind])} ${ticketCount(grant.count)}${conditions.length ? ` · ${conditions.join(' · ')}` : ''}`;
}
export function ticketDisplay(snapshot: Snapshot, now = Date.now()) {
  const href = MANAGEMENT_URLS[snapshot.provider], summary = ticketSummary(snapshot, now);
  if (!href || !summary) return null;
  const expiry = summary.expiresAt ? t('ticket_expiry', ticketDate(summary.expiresAt)) : null;
  const count = t(summary.held === 1 ? 'ticket_total_one' : 'ticket_total_other', String(summary.held));
  const entries = summary.grants.length === 1 && !summary.grants[0]!.expiresAt ? []
    : summary.grants.map(grant => grant.expiresAt
      ? `${grant.count > 1 ? `${ticketCount(grant.count)} · ` : ''}${t('ticket_expiry', ticketDate(grant.expiresAt))}`
      : ticketCount(grant.count));
  const details = summary.grants.map(grant => grantDetail(grant, now)).join('\n');
  return { href, count, entries, expiry, details,
    popupAccessible: `${[count, ...entries].join(', ')}. ${t('ticket_management_action')}` };
}
