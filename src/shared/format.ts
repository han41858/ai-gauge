import { GEMINI_RESPONSE_ERRORS, type ErrorCode, type Snapshot, type UsageLimit } from './types';
import { percent, resetTime } from './validation';
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const twoDigits = (value: number) => String(value).padStart(2, '0');
/** Local `M/D(요일) HH:mm`, shared by reset times and ticket expiry. */
export function localStamp(at: Date): string {
  return `${at.getMonth() + 1}/${at.getDate()}(${DAYS[at.getDay()]}) ${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
}
/** One text for every Gemini response-shape code; the codes stay distinct only for diagnostics. */
export const geminiErrorText = (text: string) =>
  Object.fromEntries(GEMINI_RESPONSE_ERRORS.map(code => [code, text])) as Record<typeof GEMINI_RESPONSE_ERRORS[number], string>;
function resetValue(value: string | null | undefined, now: number, compact = false): string {
  const reset = resetTime(value);
  if (reset === null) return '확인 불가';
  const at = new Date(reset);
  const prefix = compact ? '' : `${localStamp(at)}, `;
  const remaining = at.getTime() - now;
  if (!Number.isFinite(remaining)) return `${prefix}남은 시간 확인 불가`;
  if (remaining <= 0) return `${prefix}초기화 후 확인 중`;
  const hours = Math.floor(remaining / 3_600_000), days = Math.floor(hours / 24);
  if (compact) {
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    const minutes = Math.floor(remaining / 60_000);
    return minutes > 0 ? `${minutes}m` : '1분 미만';
  }
  return `${prefix}${days > 0 ? `${days}d ` : ''}${hours % 24}h 남음`;
}
export const resetLabel = (reset: string | null | undefined, now = Date.now()) => `🕒 사용량 초기화: ${resetValue(reset, now)}`;
export const resetCountdownLabel = (reset: string | null | undefined, now = Date.now()) => `🕒 사용량 초기화: ${resetValue(reset, now, true)}`;
export function usagePercentLabel(value: unknown): string {
  const used = percent(value);
  return `사용량: ${used === null ? '확인 불가' : `${Math.round(used)}%`}`;
}
export const usageValue = (limit: UsageLimit) => limit.percent !== null ? `${Math.round(limit.percent)}%`
  : limit.remaining !== null ? `${limit.remaining.toLocaleString()}${limit.unit ?? ''} 남음` : '확인 불가';
export const usageText = (limit: UsageLimit) => `${limit.label}: ${usageValue(limit)}`;
const STATUS_TEXT: Record<ErrorCode, string> = {
  not_collected: '사용량 확인 중', signed_out: '로그인 필요', access_denied: '사이트 접근 거부',
  rate_limited: '잠시 후 다시 확인', network: '연결 확인 중', server: '서비스 응답 대기',
  invalid_response: '사용량 확인 불가', ...geminiErrorText('사용량 확인 불가'),
  open_tab: '서비스 탭 열기 필요', tab_access_failed: '사용량 다시 확인 중', ambiguous_account: 'Claude 조직 선택 필요',
  unsupported: '사용량 수집 미지원', permission_required: '사이트 권한 필요', reset_pending: '초기화 후 확인 중'
};
export function statusText(snapshot: Snapshot): string {
  if (snapshot.state === 'ok') return '최근 수집 성공';
  if (snapshot.state === 'stale') return '사용량 확인 중';
  return snapshot.errorCode ? STATUS_TEXT[snapshot.errorCode] : '확인 불가';
}
export const collectedText = (at: number | null) => at === null ? '정상 수집 기록 없음' : `마지막 정상 수집: ${new Date(at).toLocaleString()}`;
