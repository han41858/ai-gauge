import { collectFromTab } from './tab-transport';
import { parseWorkCodex } from './parsers';
export async function collectWorkCodex() { return parseWorkCodex(await collectFromTab('work_codex')); }
