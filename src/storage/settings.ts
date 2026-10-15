import { PAGE_PROVIDERS, PROVIDERS, type Settings } from '../shared/types';
import { finite, record } from '../shared/validation';

export type ThresholdField = 'warning' | 'danger';
export type ThresholdResult =
  | { ok: true; value: Pick<Settings, ThresholdField> }
  | { ok: false; reason: 'range' | 'order'; fields: ThresholdField[] };

const inRange = (value: unknown): value is number => finite(value) && value >= 0 && value <= 100;

/** Gauge thresholds are percentages from 0 to 100 (fractions allowed) with warning below danger. */
export function checkUsageThresholds(warning: unknown, danger: unknown): ThresholdResult {
  const fields = (['warning', 'danger'] as const).filter((_, index) => !inRange(index === 0 ? warning : danger));
  if (fields.length) return { ok: false, reason: 'range', fields };
  if ((warning as number) >= (danger as number)) return { ok: false, reason: 'order', fields: ['warning', 'danger'] };
  return { ok: true, value: { warning: warning as number, danger: danger as number } };
}
export function parseUsageThresholds(warning: unknown, danger: unknown): Pick<Settings, ThresholdField> | null {
  const result = checkUsageThresholds(warning, danger);
  return result.ok ? result.value : null;
}
export function parseStrips(value: unknown): Settings['strips'] | null {
  const strips = record(value);
  return strips && Object.keys(strips).length === PAGE_PROVIDERS.length && PAGE_PROVIDERS.every(p => typeof strips[p] === 'boolean')
    ? Object.fromEntries(PAGE_PROVIDERS.map(p => [p, strips[p]])) as Settings['strips'] : null;
}
export function defaults(): Settings {
  return { enabled: { chatgpt: false, claude: false, gemini: false }, strips: { chatgpt: true, codex: true, claude: true, gemini: true }, warning: 70, danger: 90 };
}
/** Retired keys from earlier versions are ignored and dropped on the next write. */
export function parseSettings(value: unknown): Settings {
  const out = defaults(), r = record(value);
  if (!r) return out;
  for (const p of PROVIDERS) {
    const enabled = record(r.enabled)?.[p];
    if (typeof enabled === 'boolean') out.enabled[p] = enabled;
  }
  for (const p of PAGE_PROVIDERS) {
    const strip = record(r.strips)?.[p];
    if (typeof strip === 'boolean') out.strips[p] = strip;
  }
  const thresholds = parseUsageThresholds(r.warning, r.danger);
  if (thresholds) Object.assign(out, thresholds);
  return out;
}
export function isSettings(value: unknown): value is Settings {
  const r = record(value), enabled = record(r?.enabled);
  return !!r && Object.keys(r).length === 4 && !!enabled && PROVIDERS.every(p => typeof enabled[p] === 'boolean')
    && parseStrips(r.strips) !== null && parseUsageThresholds(r.warning, r.danger) !== null;
}
