export const PROVIDERS = ['chatgpt', 'work_codex', 'claude'] as const;
export type Provider = typeof PROVIDERS[number];
export const ORIGINS: Record<Provider, string> = { chatgpt: 'https://chatgpt.com/*', work_codex: 'https://chatgpt.com/*', claude: 'https://claude.ai/*' };
export const NAMES: Record<Provider, string> = { chatgpt: 'ChatGPT', work_codex: 'Work / Codex', claude: 'Claude' };
export const HOME_URLS: Record<Provider, string> = { chatgpt: 'https://chatgpt.com/', work_codex: 'https://chatgpt.com/codex', claude: 'https://claude.ai/' };
export type CollectionState = 'ok' | 'stale' | 'signed_out' | 'permission_required' | 'rate_limited' | 'unsupported' | 'error';
export type ErrorCode = 'not_collected' | 'signed_out' | 'access_denied' | 'rate_limited' | 'network' | 'invalid_response' | 'open_tab' | 'tab_access_failed' | 'ambiguous_account' | 'unsupported' | 'chatgpt_usage_unverified' | 'chatgpt_usage_pending' | 'chatgpt_quota_absent' | 'permission_required' | 'server';
export interface UsageLimit {
  id: string;
  label: string;
  category: 'window' | 'model' | 'product';
  percent: number | null;
  resetsAt: string | null;
  windowSeconds: number | null;
  remaining: number | null;
  unit: string | null;
  source: 'api';
}
export interface ObservedUsage { limits: UsageLimit[]; observedAt: number }
export type CollectionResult = UsageLimit[] | ObservedUsage;
export interface Snapshot {
  provider: Provider;
  state: CollectionState;
  limits: UsageLimit[];
  collectedAt: number | null;
  checkedAt: number | null;
  nextAttemptAt: number;
  failures: number;
  errorCode: ErrorCode | null;
}
export interface Settings {
  enabled: Record<Provider, boolean>;
  strips: Record<Provider, boolean>;
  defaultProvider: Provider;
  selectedLimit: Record<Provider, string | null>;
  followTab: boolean;
  warning: number;
  danger: number;
}
export interface View { settings: Settings; snapshots: Record<Provider, Snapshot>; permissions: Record<Provider, boolean> }
export const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);
export const SITE_GROUPS: Array<{ id: string; origin: string; providers: Provider[] }> = [
  { id: 'openai', origin: ORIGINS.chatgpt, providers: ['chatgpt', 'work_codex'] },
  { id: 'claude', origin: ORIGINS.claude, providers: ['claude'] }
];
export function providerFromUrl(url: string | undefined): Provider | null {
  try {
    const u = new URL(url ?? '');
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'claude.ai') return 'claude';
    if (u.hostname === 'chatgpt.com') return /^\/(codex|work)(?:\/|$)/.test(u.pathname) ? 'work_codex' : 'chatgpt';
    return null;
  } catch { return null; }
}
