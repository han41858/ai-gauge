import type { Provider, ResetTicketGrant, ResetTicketKind, Snapshot } from './types';
import { ticketSummary } from './tickets';
import { localStamp } from './format';

const MANAGEMENT_URLS: Partial<Record<Provider, string>> = {
  chatgpt: 'https://chatgpt.com/settings/usage?tab=overview',
  claude: 'https://claude.ai/new#settings/usage'
};
const KIND_LABELS: Record<ResetTicketKind, string> = {
  full: '전체 한도', five_hour: '5시간 한도', weekly: '주간 한도', unspecified: '종류 확인 불가'
};
export const ticketDate = (value: string): string => localStamp(new Date(value));
function grantDetail(grant: ResetTicketGrant, now: number): string {
  const conditions: string[] = [];
  if (grant.startsAt && Date.parse(grant.startsAt) > now) conditions.push(`${ticketDate(grant.startsAt)}부터`);
  if (grant.expiresAt) conditions.push(`${ticketDate(grant.expiresAt)} 만료`);
  if (grant.requiresLimit) conditions.push('한도 도달 조건');
  if (grant.blocked) conditions.push('사용 제한 중');
  if (grant.selected === false) conditions.push('다른 티켓 우선');
  if (grant.usableNow === false) conditions.push('현재 사용 불가');
  if (grant.usableNow === null) conditions.push('사용 가능 여부 확인 불가');
  return `${KIND_LABELS[grant.kind]} ${grant.count}개${conditions.length ? ` · ${conditions.join(' · ')}` : ''}`;
}
export function ticketDisplay(snapshot: Snapshot, now = Date.now()) {
  const href = MANAGEMENT_URLS[snapshot.provider], summary = ticketSummary(snapshot, now);
  if (!href || !summary) return null;
  const expiry = summary.expiresAt ? `${ticketDate(summary.expiresAt)} 만료` : null;
  const count = `🎫 초기화 티켓 ${summary.held}개`;
  const inline = expiry ? `🎫 초기화 티켓 ×${summary.held} · ${expiry}` : count;
  const entries = summary.grants.length === 1 && !summary.grants[0]!.expiresAt ? []
    : summary.grants.map(grant => grant.expiresAt
      ? `${grant.count > 1 ? `${grant.count}개 · ` : ''}${ticketDate(grant.expiresAt)} 만료`
      : `${grant.count}개`);
  const details = summary.grants.map(grant => grantDetail(grant, now)).join('\n');
  const action = '공식 사용량 관리 화면 열기 (새 탭)';
  return { href, count, entries, expiry, inline, details,
    accessible: `${count}${expiry ? `, ${expiry}` : ''}. ${action}`,
    popupAccessible: `${[count, ...entries].join(', ')}. ${action}` };
}
