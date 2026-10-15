import type { CollectionState, ErrorCode } from './types';
import { geminiErrorText } from './format';
export class CollectionError extends Error {
  constructor(public code: ErrorCode, public state: CollectionState = 'error', public retryAfterMs = 0) { super(code); }
}
export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) { const ms = Number(value) * 1000; return Number.isFinite(ms) && ms <= Number.MAX_SAFE_INTEGER ? Math.max(0, ms) : 0; }
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, time - now) : 0;
}
export function httpError(status: number, wait = 0): CollectionError {
  if (status === 401) return new CollectionError('signed_out', 'signed_out');
  if (status === 429) return new CollectionError('rate_limited', 'rate_limited', wait);
  if (status === 403) return new CollectionError('access_denied');
  return new CollectionError(status >= 500 ? 'server' : 'invalid_response');
}
const INVALID_RESPONSE_TEXT = '사용량 응답 형식을 확인할 수 없습니다.';
export const ERROR_TEXT: Record<ErrorCode, string> = {
  not_collected: '아직 수집하지 않았습니다.',
  signed_out: '사이트에 로그인한 뒤 팝업을 다시 열어 주세요.',
  access_denied: '사이트가 접근을 거부했습니다. 보호장치를 우회하지 않습니다.',
  rate_limited: '요청 한도에 도달했습니다. 재시도 시각까지 기다려 주세요.',
  network: '연결 또는 요청 시간이 초과되었습니다.',
  invalid_response: INVALID_RESPONSE_TEXT,
  ...geminiErrorText(INVALID_RESPONSE_TEXT),
  open_tab: '로그인한 서비스 탭을 연 뒤 팝업을 다시 열어 주세요.',
  ambiguous_account: '여러 Claude 조직이 확인되어 선택할 수 없습니다. 계정의 사용량 화면을 확인해 주세요.',
  tab_access_failed: '열린 서비스 탭에서 수집 코드를 실행하지 못했습니다. 마지막 유효 사용량을 유지하며 자동으로 다시 시도합니다.',
  unsupported: '안전한 수집 계약을 검증하지 못해 미지원입니다.',
  permission_required: '이 서비스의 사이트 접근 권한이 필요합니다.',
  server: '서비스 오류입니다. 잠시 후 다시 시도합니다.',
  reset_pending: '초기화 후 확인 중'
};
