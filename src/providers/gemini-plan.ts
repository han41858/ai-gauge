// Public policy vocabulary documented by Claude Tuner at 9b94ac3c412732d88cc5a570f0dfe0603d1fc71c.
// Numeric jSf9Qc plan IDs are not reliable subscription identifiers.
const POLICY_LABELS: Readonly<Record<string, string>> = {
  v3p2_free_policy: 'Free', v3p2_basic_policy: 'Free',
  v3p2_plus_policy: 'AI Plus', v3p2_pro_policy: 'AI Pro',
  v3p2_ultra_policy: 'AI Ultra', v3p2_business_policy: 'Workspace',
  basic_policy: 'Free', brownfield_basic_policy: 'Free',
  brownfield_paid_policy: 'AI Plus', plus_policy: 'AI Pro', neon_policy: 'AI Ultra'
};

export function parseGeminiPlan(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const policies: unknown = (input as Record<string, unknown>).policies;
  if (!Array.isArray(policies) || policies.length > 20) return null;
  const labels = new Set<string>();
  for (const policy of policies) {
    if (typeof policy !== 'string' || policy.length > 80) return null;
    if (Object.hasOwn(POLICY_LABELS, policy)) labels.add(POLICY_LABELS[policy]!);
  }
  // Empty, unknown, or contradictory policy information cannot identify a plan.
  return labels.size === 1 ? [...labels][0]! : null;
}
