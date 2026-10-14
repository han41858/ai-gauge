import { PROVIDERS, type Provider, type Snapshot, type UsageLimit, type View } from '../shared/types';
import { record, finite, percent, resetTime, label, nonnegative } from '../shared/validation';
import { parseSettings } from './settings';
import { ERROR_TEXT } from '../shared/errors';
export const FRESH_MS = 10 * 60_000;
export function emptySnapshot(provider: Provider): Snapshot {
  return { provider, state: 'error', limits: [], collectedAt: null, checkedAt: null, nextAttemptAt: 0, failures: 0, errorCode: provider === 'chatgpt' ? 'chatgpt_usage_pending' : 'not_collected' };
}
export function validLimits(input: unknown): input is UsageLimit[] {
  return Array.isArray(input) && input.length <= 150 && input.every(x => {
    const r = record(x);
    return r && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 200 && label(r.label) && ['window', 'model', 'product'].includes(String(r.category)) && r.source === 'api' && (r.percent === null || percent(r.percent) !== null) && (r.resetsAt === null || resetTime(r.resetsAt) !== null) && (r.windowSeconds === null || nonnegative(r.windowSeconds) !== null) && (r.remaining === null || nonnegative(r.remaining) !== null) && (r.unit === null || label(r.unit));
  }) && new Set(input.map(x => x.id)).size === input.length;
}
export function parseSnapshot(input: unknown, provider: Provider): Snapshot {
  const r = record(input);
  if (!r || r.provider !== provider || !['ok', 'stale', 'signed_out', 'permission_required', 'rate_limited', 'unsupported', 'error'].includes(String(r.state)) || !validLimits(r.limits) || !(r.collectedAt === null || finite(r.collectedAt)) || !(r.checkedAt === null || finite(r.checkedAt)) || !finite(r.nextAttemptAt) || !finite(r.failures) || !(r.errorCode === null || (typeof r.errorCode === 'string' && Object.hasOwn(ERROR_TEXT, r.errorCode)))) return emptySnapshot(provider);
  if (r.state === 'ok' && (r.collectedAt === null || r.limits.length === 0)) return emptySnapshot(provider);
  return { provider, state: r.state as Snapshot['state'], limits: r.limits, collectedAt: r.collectedAt, checkedAt: r.checkedAt, nextAttemptAt: Math.max(0, r.nextAttemptAt), failures: Math.max(0, r.failures), errorCode: r.errorCode as Snapshot['errorCode'] };
}
export function effectiveSnapshot(snapshot: Snapshot, now = Date.now()): Snapshot {
  return snapshot.state === 'ok' && (snapshot.collectedAt === null || now - snapshot.collectedAt >= FRESH_MS || snapshot.collectedAt > now + 60_000) ? { ...snapshot, state: 'stale' } : snapshot;
}
export async function readSnapshot(provider: Provider): Promise<Snapshot> {
  const key = snapshotKey(provider);
  return parseSnapshot((await chrome.storage.local.get(key))[key], provider);
}
const snapshotKey = (provider: Provider) => `snapshot:${provider === 'chatgpt' ? 'v3' : 'v2'}:${provider}`;
export async function writeSnapshot(snapshot: Snapshot): Promise<void> { await chrome.storage.local.set({ [snapshotKey(snapshot.provider)]: snapshot }); }
export async function readSettings() { return parseSettings((await chrome.storage.local.get('settings')).settings); }
export async function readView(): Promise<View> {
  const settings = await readSettings();
  const permissions = {} as View['permissions'], snapshots = {} as View['snapshots'];
  const { ORIGINS } = await import('../shared/types');
  await Promise.all(PROVIDERS.map(async p => {
    permissions[p] = await chrome.permissions.contains({ origins: [ORIGINS[p]] });
    const s = effectiveSnapshot(await readSnapshot(p));
    snapshots[p] = permissions[p] ? s : { ...s, state: 'permission_required', errorCode: 'permission_required' };
  }));
  return { settings, snapshots, permissions };
}
