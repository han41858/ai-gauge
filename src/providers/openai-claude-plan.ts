import { record } from '../shared/validation';

const openAIPlans = new Map([
  ['free', 'Free'], ['go', 'Go'], ['plus', 'Plus'],
  ['prolite', 'Pro 100'], ['pro', 'Pro 200'], ['promax', 'Pro 500'],
  ['team', 'Team'], ['business', 'Business'], ['enterprise', 'Enterprise'],
  ['education', 'Education'], ['k12', 'Education (K-12)']
]);
const claudeTiers = new Map([
  ['default_claude_max_5x', 'Max 5x'], ['default_claude_max_20x', 'Max 20x'],
  ['claude_max', 'Max'], ['claude_pro', 'Pro'], ['claude_team', 'Team'],
  ['claude_enterprise', 'Enterprise']
]);
function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/i.test(value) ? value.toLowerCase() : null;
}
export function parseChatGPTPlan(input: unknown): string | null {
  return openAIPlans.get(identifier(record(input)?.plan_type) ?? '') ?? null;
}
export function parseClaudePlan(input: unknown): string | null {
  const metadata = record(record(input)?.plan_metadata);
  if (!metadata) return null;
  const capabilities = Array.isArray(metadata.capabilities) ? metadata.capabilities.slice(0, 100) : [];
  const tier = claudeTiers.get(identifier(metadata.rate_limit_tier) ?? '');
  // Commercial organization evidence takes precedence over inherited personal capabilities.
  if (metadata.raven_type === 'enterprise' || capabilities.includes('raven_enterprise') || tier === 'Enterprise') return 'Enterprise';
  if (metadata.raven_type === 'team' || capabilities.includes('raven') || tier === 'Team') return 'Team';
  if (capabilities.includes('claude_max')) return tier === 'Max 5x' || tier === 'Max 20x' ? tier : 'Max';
  if (tier) return tier;
  if (capabilities.includes('claude_pro') || capabilities.includes('pro')) return 'Pro';
  // A missing paid capability or default_claude_ai alone is not evidence of Free.
  if (capabilities.includes('free')) return 'Free';
  return null;
}
