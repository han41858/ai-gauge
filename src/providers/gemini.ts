import { collectFromTab } from './tab-transport';
import { parseGemini } from './gemini-parser';
import { parseGeminiPlan } from './gemini-plan';
import { record } from '../shared/validation';
import type { CollectionResult } from '../shared/types';

export async function collectGemini(): Promise<CollectionResult> {
  const response = record(await collectFromTab('gemini'));
  return { limits: parseGemini(response?.usage), plan: parseGeminiPlan(response?.plan) };
}
