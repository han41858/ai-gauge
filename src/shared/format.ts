import type { Snapshot, UsageLimit } from './types';
import { ERROR_TEXT } from './errors';
import { percent, resetTime } from './validation';
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const twoDigits = (value: number) => String(value).padStart(2, '0');
function resetValue(value: string | null | undefined, now: number): string {
  const reset = resetTime(value);
  if (reset === null) return '확인 불가';
  const at = new Date(reset);
  const local = `${at.getMonth() + 1}/${at.getDate()}(${DAYS[at.getDay()]}) ${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
  const remaining = at.getTime() - now;
  if (!Number.isFinite(remaining)) return `${local}, 남은 시간 확인 불가`;
  if (remaining <= 0) return `${local}, 초기화 시각 지남 · 갱신 필요`;
  const hours = Math.floor(remaining / 3_600_000), days = Math.floor(hours / 24);
  return `${local}, ${days > 0 ? `${days}d ` : ''}${hours % 24}h 남음`;
}
export const resetLabel = (reset: string | null | undefined, now = Date.now()) => `🕒 사용량 초기화: ${resetValue(reset, now)}`;
export function usagePercentLabel(value: unknown): string {
  const used = percent(value);
  return `사용량: ${used === null ? '확인 불가' : `${Math.round(used)}%`}`;
}
export const usageValue = (limit: UsageLimit) => limit.percent !== null ? `${Math.round(limit.percent)}%` : limit.remaining !== null ? `${limit.remaining.toLocaleString()}${limit.unit ?? ''} 남음` : '확인 불가';
export const usageText = (limit: UsageLimit) => `${limit.label}: ${usageValue(limit)}`;
export function statusText(snapshot: Snapshot): string {
  if (snapshot.state === 'ok') return '최근 수집 성공';
  if (snapshot.state === 'stale') return '오래된 정보 · 갱신 필요';
  return snapshot.errorCode ? ERROR_TEXT[snapshot.errorCode] : '확인 불가';
}
export const collectedText = (at: number | null) => at === null ? '정상 수집 기록 없음' : `마지막 정상 수집: ${new Date(at).toLocaleString()}`;
