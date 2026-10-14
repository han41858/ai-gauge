import { collectFromTab } from './tab-transport';
import { parseGemini } from './gemini-parser';

export async function collectGemini() { return parseGemini(await collectFromTab('gemini')); }
