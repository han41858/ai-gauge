import type { CollectionState, ErrorCode } from './types';
import { geminiErrorText } from './format';
import { t, type MessageKey } from './i18n';
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
const ERROR_KEYS: Record<ErrorCode, MessageKey> = {
  not_collected: 'error_not_collected', signed_out: 'error_signed_out', access_denied: 'error_access_denied',
  rate_limited: 'error_rate_limited', network: 'error_network', invalid_response: 'error_invalid_response',
  ...geminiErrorText('error_invalid_response'), open_tab: 'error_open_tab', ambiguous_account: 'error_ambiguous_account',
  tab_access_failed: 'error_tab_access_failed', unsupported: 'error_unsupported', permission_required: 'error_permission_required',
  server: 'error_server', reset_pending: 'format_reset_pending'
};
// Resolve on access so a saved language change also updates existing error states.
export const ERROR_TEXT = Object.defineProperties({}, Object.fromEntries(
  Object.entries(ERROR_KEYS).map(([code, key]) => [code, { enumerable: true, get: () => t(key) }])
)) as Record<ErrorCode, string>;
