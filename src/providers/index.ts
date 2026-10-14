import type { Provider } from '../shared/types';
import { collectChatGPT } from './chatgpt';
import { collectGemini } from './gemini';
import { collectClaude } from './claude';
export const collect = (p: Provider) => ({ chatgpt: collectChatGPT, claude: collectClaude, gemini: collectGemini })[p]();
