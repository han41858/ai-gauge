import type { Provider, UsageLimit } from './types';
import { percent, resetTime } from './validation';

export function highestUsageLimit(limits: readonly UsageLimit[]): UsageLimit | null {
  let highest: UsageLimit | null = null;
  let highestPercent = -1;
  for (const limit of limits) {
    const used = percent(limit.percent);
    if (used !== null && used > highestPercent) {
      highest = limit;
      highestPercent = used;
    }
  }
  return highest;
}

/** Only common buckets established by the adapters may represent the composer. */
export function composerUsageLimit(provider: Provider, limits: readonly UsageLimit[]): UsageLimit | null {
  const common = limits.filter(limit => provider === 'chatgpt'
    ? limit.category === 'product' && ['shared:primary_window', 'shared:secondary_window'].includes(limit.id)
    : limit.category === 'window');
  const valid = common.filter(limit => percent(limit.percent) !== null);
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
