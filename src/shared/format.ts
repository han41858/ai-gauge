import { GEMINI_RESPONSE_ERRORS, type ErrorCode, type Snapshot, type UsageLimit } from './types';
import { percent, resetTime } from './validation';
import { t, uiLanguage, type MessageKey } from './i18n';
import { localizedLimitLabel } from './limit-label';
const DAYS = { ko: ['일', '월', '화', '수', '목', '금', '토'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const twoDigits = (value: number) => String(value).padStart(2, '0');
/** Local date and time, shared by reset times and ticket expiry. */
export function localStamp(at: Date): string {
  return `${at.getMonth() + 1}/${at.getDate()}(${DAYS[uiLanguage()][at.getDay()]}) ${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
}
/** One text for every Gemini response-shape code; the codes stay distinct only for diagnostics. */
export const geminiErrorText = <T extends string>(text: T) =>
  Object.fromEntries(GEMINI_RESPONSE_ERRORS.map(code => [code, text])) as Record<typeof GEMINI_RESPONSE_ERRORS[number], T>;
/** Largest whole unit for a confirmed future reset or ticket expiry. */
export function relativeTime(remaining: number): string | null {
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  for (const [unit, size] of [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]] as const) {
    if (remaining >= size) {
      const count = Math.floor(remaining / size);
      return t(`format_relative_${unit}_${count === 1 ? 'one' : 'other'}`, String(count));
    }
  }
  return t('format_less_than_minute');
}
function resetValue(value: string | null | undefined, now: number, compact = false): string {
  const reset = resetTime(value);
  if (reset === null) return t('format_unknown');
  const at = new Date(reset);
  const prefix = compact ? '' : `${localStamp(at)}, `;
  const remaining = at.getTime() - now;
  if (!Number.isFinite(remaining)) return `${prefix}${t('format_remaining_unknown')}`;
  if (remaining <= 0) return `${prefix}${t('format_reset_pending')}`;
  if (compact) return relativeTime(remaining) ?? t('format_remaining_unknown');
  const hours = Math.floor(remaining / 3_600_000), days = Math.floor(hours / 24);
  return `${prefix}${t('format_duration_left', `${days > 0 ? `${days}d ` : ''}${hours % 24}h`)}`;
}
export const resetLabel = (reset: string | null | undefined, now = Date.now()) => t('format_reset_popup', resetValue(reset, now));
export function resetCountdownLabel(reset: string | null | undefined, now = Date.now()): string {
  const at = resetTime(reset), remaining = at === null ? null : relativeTime(Date.parse(at) - now);
  return remaining ? t('format_reset_countdown', remaining) : t('format_reset_unavailable', resetValue(reset, now, true));
}
export function usagePercentLabel(value: unknown): string {
  const used = percent(value);
  return t('format_usage', used === null ? t('format_unknown') : `${Math.round(used)}%`);
}
export const usageValue = (limit: UsageLimit) => limit.percent !== null ? `${Math.round(limit.percent)}%`
  : limit.remaining !== null ? t('format_remaining', `${limit.remaining.toLocaleString(uiLanguage())}${limit.unit ?? ''}`) : t('format_unknown');
export const usageText = (limit: UsageLimit) => `${localizedLimitLabel(limit)}: ${usageValue(limit)}`;
const STATUS_KEYS: Record<ErrorCode, MessageKey> = {
  not_collected: 'status_not_collected', signed_out: 'status_signed_out', access_denied: 'status_access_denied',
  rate_limited: 'status_rate_limited', network: 'status_network', server: 'status_server',
  invalid_response: 'status_invalid_response', ...geminiErrorText('status_invalid_response'),
  open_tab: 'status_open_tab', tab_access_failed: 'status_tab_access_failed', ambiguous_account: 'status_ambiguous_account',
  unsupported: 'status_unsupported', permission_required: 'status_permission_required', reset_pending: 'format_reset_pending'
};
export function statusText(snapshot: Snapshot): string {
  if (snapshot.state === 'ok') return t('status_ok');
  if (snapshot.state === 'stale') return t('status_not_collected');
  return snapshot.errorCode ? t(STATUS_KEYS[snapshot.errorCode]) : t('format_unknown');
}
export const collectedText = (at: number | null) => at === null ? t('format_not_collected')
  : t('format_last_collected', new Date(at).toLocaleString(uiLanguage()));
