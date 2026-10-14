import { collectFromTab } from './tab-transport';
import { parseClaude } from './parsers';
import { parseClaudePlan } from './openai-claude-plan';
export async function collectClaude() {
  const response = await collectFromTab('claude');
  return { limits: parseClaude(response), plan: parseClaudePlan(response) };
}
