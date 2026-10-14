import type { UsageLimit } from '../shared/types';
import { InvalidResponse } from './parsers';

/** The observed jSf9Qc payload. Plan, remaining units and extra flags are not interpreted. */
export function parseGemini(input: unknown): UsageLimit[] {
  if (!Array.isArray(input) || !Array.isArray(input[1]) || input[1].length > 20) throw new InvalidResponse();
  const limits: UsageLimit[] = [], seen = new Set<number>();
  for (const row of input[1]) {
    if (!Array.isArray(row) || !Number.isInteger(row[2])) throw new InvalidResponse();
    const type = row[2] as number;
    if (type !== 1 && type !== 2) continue;
    if (seen.has(type)) throw new InvalidResponse();
    seen.add(type);
    const ratio: unknown = row[1];
    if (ratio != null && (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1)) throw new InvalidResponse();
    let resetsAt: string | null = null;
    const reset: unknown = row[3];
    if (reset != null) {
      if (!Array.isArray(reset) || reset.length !== 1 || !Array.isArray(reset[0])) throw new InvalidResponse();
      const stamp = reset[0] as unknown[];
      const seconds = stamp[0], nanos = stamp.length === 1 ? 0 : stamp[1];
      if (stamp.length < 1 || stamp.length > 2 || typeof seconds !== 'number' || !Number.isSafeInteger(seconds)
        || seconds <= 0 || seconds >= 4_102_444_800 || typeof nanos !== 'number' || !Number.isInteger(nanos)
        || nanos < 0 || nanos >= 1_000_000_000) throw new InvalidResponse();
      resetsAt = new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
    }
    limits.push({ id: type === 1 ? 'five_hour' : 'seven_day', label: type === 1 ? '5시간' : '7일', category: 'window',
      percent: ratio == null ? null : (ratio as number) * 100, resetsAt,
      windowSeconds: type === 1 ? 18_000 : 604_800, remaining: null, unit: null, source: 'api' });
  }
  if (!limits.length) throw new InvalidResponse();
  return limits;
}
