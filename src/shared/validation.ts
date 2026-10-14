export function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const percent = (v: unknown): number | null => finite(v) && v >= 0 && v <= 100 ? v : null;
export const nonnegative = (v: unknown): number | null => finite(v) && v >= 0 ? v : null;
export function label(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 120 && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null;
}
export function resetTime(v: unknown): string | null {
  // Never interpret timezone-free strings using the machine's timezone.
  if (typeof v !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms > 0 && ms < 4102444800000 ? new Date(ms).toISOString() : null;
}
export function unixReset(v: unknown): string | null {
  return finite(v) && v > 0 && v < 4102444800 ? new Date(v * 1000).toISOString() : null;
}
