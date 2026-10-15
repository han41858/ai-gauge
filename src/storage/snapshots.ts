import { ORIGINS, PROVIDERS, type Provider, type Settings, type Snapshot, type UsageLimit, type View } from '../shared/types';
import { record, finite, percent, resetTime, label, nonnegative } from '../shared/validation';
import { parseSettings } from './settings';
import { ERROR_TEXT } from '../shared/errors';
import { parsePlan } from '../shared/plan';
import { parseTicketCache } from '../shared/tickets';
export const FRESH_MS = 10 * 60_000;
export function emptySnapshot(provider: Provider): Snapshot {
  return { provider, state: 'error', limits: [], collectedAt: null, checkedAt: null, nextAttemptAt: 0, failures: 0, errorCode: 'not_collected' };
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
  const limits: UsageLimit[] = r.limits.map(limit => ({
    id: limit.id, label: label(limit.label)!, category: limit.category, percent: limit.percent,
    resetsAt: limit.resetsAt === null ? null : resetTime(limit.resetsAt), windowSeconds: limit.windowSeconds,
    remaining: limit.remaining, unit: limit.unit === null ? null : label(limit.unit), source: 'api'
  }));
  return { provider, state: r.state as Snapshot['state'], limits, collectedAt: r.collectedAt, checkedAt: r.checkedAt, nextAttemptAt: Math.max(0, r.nextAttemptAt), failures: Math.max(0, r.failures), errorCode: r.errorCode as Snapshot['errorCode'],
    ...(Object.hasOwn(r, 'plan') ? { plan: parsePlan(provider, r.plan) } : {}),
    ...(Object.hasOwn(r, 'planRefreshPending') ? { planRefreshPending: r.planRefreshPending === true } : {}),
    ...(Object.hasOwn(r, 'tickets') ? { tickets: provider === 'gemini' ? null : parseTicketCache(r.tickets) } : {}),
    ...(Object.hasOwn(r, 'ticketRefreshPending') ? { ticketRefreshPending: r.ticketRefreshPending === true } : {}) };
}
export function hasElapsedReset(snapshot: Snapshot, now = Date.now()): boolean {
  return snapshot.limits.some(limit => {
    const reset = resetTime(limit.resetsAt);
    return reset !== null && Date.parse(reset) <= now;
  });
}
export function effectiveSnapshot(snapshot: Snapshot, now = Date.now()): Snapshot {
  const firstTransient = snapshot.failures === 1 && (snapshot.errorCode === 'network' || snapshot.errorCode === 'server');
  const legacyAgeOnly = snapshot.state === 'stale' && snapshot.errorCode === null && snapshot.failures === 0;
  const current = snapshot.state === 'ok';
  if (!current && !legacyAgeOnly && !(snapshot.state === 'error' && firstTransient)) return snapshot;
  if (current && snapshot.errorCode !== null && !firstTransient) return { ...snapshot, state: 'error' };
  const usable = finite(now) && finite(snapshot.collectedAt) && snapshot.collectedAt > 0
    && snapshot.collectedAt <= now + 60_000 && snapshot.limits.length > 0 && validLimits(snapshot.limits);
  if (!usable) return current || legacyAgeOnly ? { ...snapshot, state: 'error', errorCode: 'invalid_response' } : snapshot;
  if (hasElapsedReset(snapshot, now)) return { ...snapshot, state: 'error', errorCode: 'reset_pending' };
  // A view may hide one transient failure, but storage retains its retry state.
  return current ? snapshot : { ...snapshot, state: 'ok' };
}
export async function readSnapshot(provider: Provider): Promise<Snapshot> {
  await migrateStorage();
  const key = snapshotKey(provider);
  return parseSnapshot((await chrome.storage.local.get(key))[key], provider);
}
const SNAPSHOT_KEYS: Record<Provider, string> = { chatgpt: 'snapshot:v4:chatgpt', claude: 'snapshot:v2:claude', gemini: 'snapshot:v1:gemini' };
const snapshotKey = (provider: Provider) => SNAPSHOT_KEYS[provider];
const SETTINGS_KEY = 'settings:v2';
const MIGRATION_KEY = 'migration:shared-chatgpt:v2';
const migrations = new WeakMap<chrome.storage.StorageArea, Promise<void>>();

function legacySettings(input: unknown): Settings {
  const old = record(input), enabled = record(old?.enabled), strips = record(old?.strips);
  return parseSettings({
    enabled: { chatgpt: enabled?.work_codex, claude: enabled?.claude },
    strips: { chatgpt: strips?.chatgpt, codex: strips?.work_codex, claude: strips?.claude },
    warning: old?.warning, danger: old?.danger
  });
}

async function migrate(local: chrome.storage.StorageArea): Promise<void> {
  const sharedKey = snapshotKey('chatgpt');
  const stored = await local.get([MIGRATION_KEY, SETTINGS_KEY, sharedKey, 'settings', 'snapshot:v2:work_codex']);
  if (stored[MIGRATION_KEY] === true) return;
  const updates: Record<string, unknown> = { [MIGRATION_KEY]: true };
  updates[SETTINGS_KEY] = Object.hasOwn(stored, SETTINGS_KEY) ? parseSettings(stored[SETTINGS_KEY]) : legacySettings(stored.settings);
  if (!Object.hasOwn(stored, sharedKey)) {
    const old = record(stored['snapshot:v2:work_codex']);
    // The retired ChatGPT feature experiment is deliberately never read or promoted.
    updates[sharedKey] = old?.provider === 'work_codex' ? parseSnapshot({
      provider: 'chatgpt', state: old.state, limits: old.limits, collectedAt: old.collectedAt,
      checkedAt: old.checkedAt, nextAttemptAt: old.nextAttemptAt, failures: old.failures, errorCode: old.errorCode
    }, 'chatgpt') : emptySnapshot('chatgpt');
  }
  // Publish the copied snapshot, settings and completion marker together.
  await local.set(updates);
}

export function migrateStorage(): Promise<void> {
  const local = chrome.storage.local;
  let pending = migrations.get(local);
  if (!pending) {
    pending = migrate(local).catch(error => { migrations.delete(local); throw error; });
    migrations.set(local, pending);
  }
  return pending;
}

/** Only saved settings and usage snapshots change what tabs and the popup render. */
export function affectsView(changes: Record<string, unknown> | undefined, areaName: string | undefined): boolean {
  return areaName === 'local' && !!changes && Object.keys(changes).some(key => key === SETTINGS_KEY || Object.values(SNAPSHOT_KEYS).includes(key));
}
export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await migrateStorage();
  await chrome.storage.local.set({ [snapshotKey(snapshot.provider)]: parseSnapshot(snapshot, snapshot.provider) });
}
export async function readSettings(): Promise<Settings> {
  await migrateStorage();
  return parseSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
}
export async function writeSettings(settings: Settings): Promise<void> {
  await migrateStorage();
  await chrome.storage.local.set({ [SETTINGS_KEY]: parseSettings(settings) });
}
export async function readView(): Promise<View> {
  await migrateStorage();
  // One storage read and parallel permission checks per view; tabs request views often.
  const [stored, granted] = await Promise.all([
    chrome.storage.local.get([SETTINGS_KEY, ...PROVIDERS.map(snapshotKey)]),
    Promise.all(PROVIDERS.map(p => chrome.permissions.contains({ origins: [ORIGINS[p]] })))
  ]);
  const settings = parseSettings(stored[SETTINGS_KEY]);
  const permissions = {} as View['permissions'], snapshots = {} as View['snapshots'];
  PROVIDERS.forEach((p, index) => {
    permissions[p] = granted[index]!;
    const s = effectiveSnapshot(parseSnapshot(stored[snapshotKey(p)], p));
    snapshots[p] = permissions[p] ? s : { ...s, state: 'permission_required', errorCode: 'permission_required' };
  });
  return { settings, snapshots, permissions };
}
