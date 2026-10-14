import { resetLabel, statusText, usagePercentLabel } from '../shared/format';
import type { Snapshot, UsageLimit } from '../shared/types';
import { percent } from '../shared/validation';

export interface UsageParts {
  current: string;
  reset: string;
  status: string | null;
  percent: number | null;
  label: string;
}

export function usageParts(snapshot: Snapshot, limit: UsageLimit | undefined, now = Date.now()): UsageParts {
  const currentData = snapshot.state === 'ok';
  const used = currentData ? percent(limit?.percent) : null;
  const current = usagePercentLabel(used);
  const reset = resetLabel(currentData ? limit?.resetsAt : null, now);
  const status = currentData ? null : statusText(snapshot);
  return { current, reset, status, percent: used, label: [current, reset, status].filter(value => value !== null).join('  ') };
}

export function usageLabel(snapshot: Snapshot, limit: UsageLimit | undefined, now = Date.now()): string {
  return usageParts(snapshot, limit, now).label;
}
