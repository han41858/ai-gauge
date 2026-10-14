import { collectFromTab } from './tab-transport';
import { parseChatGPT } from './parsers';
export async function collectChatGPT() { return parseChatGPT(await collectFromTab('chatgpt')); }
