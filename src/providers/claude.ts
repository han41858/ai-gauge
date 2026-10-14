import { collectFromTab } from './tab-transport';
import { parseClaude } from './parsers';
export async function collectClaude() { return parseClaude(await collectFromTab('claude')); }
