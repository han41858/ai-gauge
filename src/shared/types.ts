export const PROVIDERS = ['chatgpt', 'claude', 'gemini'] as const;
export type Provider = typeof PROVIDERS[number];
export const PAGE_PROVIDERS = ['chatgpt', 'codex', 'claude', 'gemini'] as const;
export type PageProvider = typeof PAGE_PROVIDERS[number];
export const ORIGINS: Record<Provider, string> = { chatgpt: 'https://chatgpt.com/*', claude: 'https://claude.ai/*', gemini: 'https://gemini.google.com/*' };
export const NAMES: Record<Provider, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };
export const HOME_URLS: Record<Provider, string> = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/' };
export type CollectionState = 'ok' | 'stale' | 'signed_out' | 'permission_required' | 'rate_limited' | 'unsupported' | 'error';
export type ErrorCode = 'not_collected' | 'signed_out' | 'access_denied' | 'rate_limited' | 'network' | 'invalid_response' | 'open_tab' | 'tab_access_failed' | 'ambiguous_account' | 'unsupported' | 'permission_required' | 'server';
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
export type CollectionResult = UsageLimit[];
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
  strips: Record<PageProvider, boolean>;
  defaultProvider: Provider;
  selectedLimit: Record<Provider, string | null>;
  followTab: boolean;
  warning: number;
  danger: number;
}
export interface View { settings: Settings; snapshots: Record<Provider, Snapshot>; permissions: Record<Provider, boolean> }
export const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);
export const SITE_GROUPS: Array<{ id: string; origin: string; providers: PageProvider[] }> = [
  { id: 'openai', origin: ORIGINS.chatgpt, providers: ['chatgpt', 'codex'] },
  { id: 'claude', origin: ORIGINS.claude, providers: ['claude'] },
  { id: 'gemini', origin: ORIGINS.gemini, providers: ['gemini'] }
];
export function providerFromUrl(url: string | undefined): PageProvider | null {
  try {
    const u = new URL(url ?? '');
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'claude.ai') return 'claude';
    if (u.hostname === 'gemini.google.com') return 'gemini';
    if (u.hostname === 'chatgpt.com') return /^\/(codex|work)(?:\/|$)/.test(u.pathname) ? 'codex' : 'chatgpt';
    return null;
  } catch { return null; }
}
