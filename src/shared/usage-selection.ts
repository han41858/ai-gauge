import type { Provider, UsageLimit } from './types';
import { percent, resetTime } from './validation';

function isCommonLimit(provider: Provider, limit: UsageLimit): boolean {
  // OpenAI additional_rate_limits also use category 'product'; only rate_limit is shared.
  return provider === 'chatgpt'
    ? limit.category === 'product' && ['shared:primary_window', 'shared:secondary_window'].includes(limit.id)
    : limit.category === 'window';
}

/** Toolbar and composer share one selection after the caller applies snapshot freshness. */
export function representativeUsageLimit(provider: Provider, limits: readonly UsageLimit[]): UsageLimit | null {
  const valid = limits.filter(limit => isCommonLimit(provider, limit) && percent(limit.percent) !== null);
  const exhausted = valid.filter(limit => limit.percent === 100);
  const candidates = exhausted.length ? exhausted : valid;
  let selected: UsageLimit | null = null;
  let selectedReset: number | null = null;
  for (const limit of candidates) {
    const reset = resetTime(limit.resetsAt);
    const time = reset === null ? null : Date.parse(reset);
    // Unknown exhausted resets must not promise availability at a known time.
    const better = exhausted.length
      ? selectedReset !== null && (time === null || time > selectedReset)
      : time !== null ? selectedReset === null || time < selectedReset
        : selectedReset === null && limit.percent! > (selected?.percent ?? -1);
    if (selected === null || better) {
      selected = limit;
      selectedReset = time;
    }
  }
  return selected;
}
