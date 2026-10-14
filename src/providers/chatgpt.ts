import { CollectionError } from '../shared/errors';
import { collectChatGPTFromTab } from './tab-transport';
import { parseChatGPTObservation } from './chatgpt-parser';
// Read only quota metadata the site has already received, without initiating a chat.
export async function collectChatGPT() {
  const observation = await collectChatGPTFromTab();
  if (observation === null) throw new CollectionError('chatgpt_usage_pending');
  return parseChatGPTObservation(observation);
}
