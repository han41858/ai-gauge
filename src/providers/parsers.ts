import type { UsageLimit } from '../shared/types';
import { label, nonnegative, percent, record, resetTime, unixReset } from '../shared/validation';

export class InvalidResponse extends Error { constructor() { super('invalid_response'); } }
const item = (id: string, name: string, category: UsageLimit['category'], value: unknown, reset: string | null, span: number | null): UsageLimit =>
  ({ id, label: name, category, percent: percent(value), resetsAt: reset, windowSeconds: span, remaining: null, unit: null, source: 'api' });
export function parseClaude(input: unknown): UsageLimit[] {
  const data = record(input);
  if (!data) throw new InvalidResponse();
  const items: UsageLimit[] = [];
  for (const [key, raw] of Object.entries(data).slice(0, 100)) {
    if (!/^(five_hour|seven_day(?:_[a-z0-9_]+)?)$/.test(key)) continue;
    const w = record(raw);
    if (!w || (!('utilization' in w) && !('resets_at' in w))) continue;
    const name = key === 'five_hour' ? '5시간' : key === 'seven_day' ? '7일' : `7일 · ${key.slice(10)}`;
    items.push(item(key, name, key === 'five_hour' || key === 'seven_day' ? 'window' : 'model', w.utilization, resetTime(w.resets_at), key === 'five_hour' ? 18000 : 604800));
  }
  if (Array.isArray(data.limits)) {
    for (const raw of data.limits.slice(0, 50)) {
      const w = record(raw), model = record(record(w?.scope)?.model);
      const modelName = label(model?.display_name);
      if (w?.kind !== 'weekly_scoped' || !modelName || modelName.length > 100) continue;
      const id = `weekly_scoped:${modelName}`;
      if (items.some(v => v.id === id)) continue;
      items.push(item(id, `7일 · ${modelName}`, 'model', w.percent, resetTime(w.resets_at), 604800));
    }
  }
  if (!items.length) throw new InvalidResponse();
  return items;
}
function chatWindows(raw: unknown, prefix: string, title: string, category: UsageLimit['category']): UsageLimit[] {
  const rate = record(raw);
  if (!rate) return [];
  const result: UsageLimit[] = [];
  for (const key of ['primary_window', 'secondary_window']) {
    const w = record(rate[key]);
    if (!w || !('used_percent' in w || 'reset_at' in w)) continue;
    const span = nonnegative(w.limit_window_seconds);
    const windowLabel = span === 18000 ? '5시간' : span === 604800 ? '7일' : span ? `${span / 3600}시간` : key === 'primary_window' ? '기본 제한' : '추가 제한';
    result.push(item(`${prefix}:${key}`, `${title} · ${windowLabel}`, category, w.used_percent, unixReset(w.reset_at), span));
  }
  return result;
}
export function parseChatGPT(input: unknown): UsageLimit[] {
  const data = record(input);
  if (!data) throw new InvalidResponse();
  const items = chatWindows(data.rate_limit, 'shared', 'ChatGPT', 'product');
  if (Array.isArray(data.additional_rate_limits)) {
    for (const raw of data.additional_rate_limits.slice(0, 50)) {
      const bucket = record(raw);
      const name = label(bucket?.limit_name) ?? label(bucket?.metered_feature);
      if (!name || name.length > 100) continue;
      for (const limit of chatWindows(bucket?.rate_limit, `product:${name}`, name, 'product')) if (!items.some(i => i.id === limit.id)) items.push(limit);
    }
  }
  if (!items.length) throw new InvalidResponse();
  return items;
}
