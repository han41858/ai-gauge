import type { PlanInfo, Provider, Snapshot } from './types';
import { finite, record } from './validation';

const LABELS: Record<Provider, readonly string[]> = {
  chatgpt: ['Free', 'Go', 'Plus', 'Pro', 'Pro 100', 'Pro 200', 'Pro 500', 'Team', 'Business', 'Enterprise', 'Education', 'Education (K-12)'],
  claude: ['Free', 'Pro', 'Max', 'Max 5x', 'Max 20x', 'Team', 'Enterprise'],
  gemini: ['Free', 'AI Plus', 'AI Pro', 'AI Ultra', 'Workspace']
};
export const PLAN_MAX_AGE_MS = 10 * 60_000;
export function knownPlanLabel(provider: Provider, input: unknown): string | null {
  return typeof input === 'string' && LABELS[provider].includes(input) ? input : null;
}
export function parsePlan(provider: Provider, input: unknown): PlanInfo | null {
  const raw = record(input), label = knownPlanLabel(provider, raw?.label);
  return label && finite(raw?.checkedAt) && raw.checkedAt > 0 ? { label, checkedAt: raw.checkedAt } : null;
}
export function currentPlanLabel(snapshot: Snapshot, now = Date.now()): string {
  const plan = parsePlan(snapshot.provider, snapshot.plan);
  // Unlike quota caching, a plan is a current-account claim. Hide it while a
  // collection is pending/failed or when its independent freshness has elapsed.
  return plan && !snapshot.planRefreshPending && snapshot.state === 'ok' && snapshot.errorCode === null
    && plan.checkedAt === snapshot.collectedAt && plan.checkedAt === snapshot.checkedAt
    && finite(now) && plan.checkedAt <= now && now - plan.checkedAt < PLAN_MAX_AGE_MS
    ? plan.label : '확인 불가';
}
