import { collectFromTab } from './tab-transport';
import { parseChatGPT } from './parsers';
import { parseChatGPTPlan } from './openai-claude-plan';
export async function collectChatGPT() {
  const response = await collectFromTab('chatgpt');
  return { limits: parseChatGPT(response), plan: parseChatGPTPlan(response) };
}
