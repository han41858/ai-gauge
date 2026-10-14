import { collectFromTab } from './tab-transport';
import { parseChatGPT } from './parsers';
import { parseChatGPTPlan } from './openai-claude-plan';
import { parseCollectedTickets } from './reset-tickets';
export async function collectChatGPT() {
  const response = await collectFromTab('chatgpt');
  const tickets = parseCollectedTickets('chatgpt', response);
  return { limits: parseChatGPT(response), plan: parseChatGPTPlan(response), ...(tickets ? { tickets } : {}) };
}
