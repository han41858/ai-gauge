import type { Settings } from './types';
import { percent } from './validation';

export function usageColor(value: number | null, thresholds: Pick<Settings, 'warning' | 'danger'>): string {
  const used = percent(value);
  return used === null ? '#8893A0' : used >= thresholds.danger ? '#FF454E' : used >= thresholds.warning ? '#FFAE32' : '#2DE5F4';
}
