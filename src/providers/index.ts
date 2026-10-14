import type { Provider } from '../shared/types';
import { collectChatGPT } from './chatgpt';
import { collectWorkCodex } from './work-codex';
import { collectClaude } from './claude';
export const collect = (p: Provider) => ({ chatgpt: collectChatGPT, work_codex: collectWorkCodex, claude: collectClaude })[p]();
