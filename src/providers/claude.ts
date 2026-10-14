import { collectFromTab } from './tab-transport';
import { parseClaude } from './parsers';
import { parseClaudePlan } from './openai-claude-plan';
import { parseCollectedTickets } from './reset-tickets';
export async function collectClaude() {
  const response = await collectFromTab('claude');
  const tickets = parseCollectedTickets('claude', response);
  return { limits: parseClaude(response), plan: parseClaudePlan(response), ...(tickets ? { tickets } : {}) };
}
