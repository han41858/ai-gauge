import type { UsageLimit } from './types';
import { percent } from './validation';

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
