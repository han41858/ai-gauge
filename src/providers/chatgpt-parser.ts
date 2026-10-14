import type { UsageLimit } from '../shared/types';
import { record, resetTime } from '../shared/validation';
import { InvalidResponse } from './parsers';

export interface ChatGPTCollection { limits: UsageLimit[]; observedAt: number }

// Published init metadata identifies features, not an exhaustive list of model quotas.
// There is no verified total in this contract, so remaining must never become a percent.
export function parseChatGPT(input: unknown): UsageLimit[] {
  const data = record(input);
  if (!data || !Array.isArray(data.limits_progress)) throw new InvalidResponse();
  const limits = new Map<string, UsageLimit>();
  const duplicates = new Set<string>();
  for (const raw of data.limits_progress.slice(0, 50)) {
    const row = record(raw);
    if (!row || typeof row.feature_name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(row.feature_name)) continue;
    const id = `feature:${row.feature_name}`;
    if (limits.has(id)) { duplicates.add(id); continue; }
    const remaining = typeof row.remaining === 'number' && Number.isSafeInteger(row.remaining) && row.remaining >= 0 ? row.remaining : null;
    const resetsAt = resetTime(row.reset_after);
    if (remaining === null && resetsAt === null) continue;
    limits.set(id, { id, label: `기능 · ${row.feature_name}`, category: 'product', percent: null, remaining, unit: null, resetsAt, windowSeconds: null, source: 'api' });
  }
  // No scope/window fields distinguish duplicate feature rows; do not pick or add them.
  return [...limits.values()].filter(limit => !duplicates.has(limit.id));
}

export function parseChatGPTObservation(input: unknown, now = Date.now()): ChatGPTCollection {
  const observation = record(input);
  if (!observation || observation.version !== 1 || typeof observation.observedAt !== 'number' || !Number.isSafeInteger(observation.observedAt) || observation.observedAt <= 0 || observation.observedAt > now + 60_000) throw new InvalidResponse();
  return { limits: parseChatGPT(observation.data), observedAt: observation.observedAt };
}
