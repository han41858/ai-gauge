import { isProvider, PAGE_PROVIDERS, PROVIDERS, type Settings } from '../shared/types';
import { record, finite } from '../shared/validation';
export function defaults(): Settings {
  return { enabled: { chatgpt: false, claude: false, gemini: false }, strips: { chatgpt: true, codex: true, claude: true, gemini: true }, defaultProvider: 'chatgpt', selectedLimit: { chatgpt: null, claude: null, gemini: null }, followTab: false, warning: 70, danger: 90 };
}
export function parseSettings(value: unknown): Settings {
  const out = defaults(), r = record(value);
  if (!r) return out;
  for (const p of PROVIDERS) {
    const enabled = record(r.enabled)?.[p];
    if (typeof enabled === 'boolean') out.enabled[p] = enabled;
    const selected = record(r.selectedLimit)?.[p];
    if (selected === null || (typeof selected === 'string' && selected.length <= 200)) out.selectedLimit[p] = selected;
  }
  for (const p of PAGE_PROVIDERS) {
    const strip = record(r.strips)?.[p];
    if (typeof strip === 'boolean') out.strips[p] = strip;
  }
  if (isProvider(r.defaultProvider)) out.defaultProvider = r.defaultProvider;
  if (typeof r.followTab === 'boolean') out.followTab = r.followTab;
  if (finite(r.warning) && finite(r.danger) && r.warning >= 0 && r.warning < r.danger && r.danger <= 100) { out.warning = r.warning; out.danger = r.danger; }
  return out;
}
export function isSettings(value: unknown): value is Settings {
  const r = record(value);
  if (!r || !isProvider(r.defaultProvider) || typeof r.followTab !== 'boolean') return false;
  if (!finite(r.warning) || !finite(r.danger) || r.warning < 0 || r.warning >= r.danger || r.danger > 100) return false;
  return PROVIDERS.every(p => typeof record(r.enabled)?.[p] === 'boolean' && (record(r.selectedLimit)?.[p] === null || (typeof record(r.selectedLimit)?.[p] === 'string' && String(record(r.selectedLimit)?.[p]).length <= 200))) && PAGE_PROVIDERS.every(p => typeof record(r.strips)?.[p] === 'boolean');
}
