import { GEMINI_RESPONSE_ERRORS, ORIGINS, type Provider } from '../shared/types';
import { CollectionError, httpError, retryAfter } from '../shared/errors';
import { record } from '../shared/validation';
import { collectGeminiInPage } from './gemini-transport';
import { collectGeminiInWorker } from './gemini-bootstrap';
import { collectInPage } from './openai-claude-transport';
/** Fixed-shape result returned by every serialized page or worker collector. */
export interface TransportResult { status: number; code: string | null; retryAfter: string | null; data: unknown }

export function unwrapTransport(value: unknown): unknown {
  const r = record(value);
  if (!r || typeof r.status !== 'number' || !Number.isInteger(r.status) || r.status < 0 || r.status > 599) throw new CollectionError('invalid_response');
  if (r.code !== null) {
    const geminiError = GEMINI_RESPONSE_ERRORS.find(code => code === r.code);
    if (geminiError) throw new CollectionError(geminiError);
    if (r.code === 'unsupported') throw new CollectionError('unsupported', 'unsupported');
    if (r.code === 'network' || r.code === 'invalid_response' || r.code === 'open_tab' || r.code === 'ambiguous_account') throw new CollectionError(r.code);
    throw new CollectionError('invalid_response');
  }
  if (r.status !== 200) throw httpError(r.status, retryAfter(typeof r.retryAfter === 'string' && r.retryAfter.length <= 100 ? r.retryAfter : null));
  return r.data;
}
async function collectionTab(provider: Provider): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: ORIGINS[provider] });
  const eligible = tabs.filter(tab => !tab.discarded && !tab.frozen && typeof tab.id === 'number');
  // An unavailable existing tab may represent a different account. Never silently
  // replace that context with the browser's default cookie session.
  if (tabs.length && !eligible.length) throw new CollectionError('open_tab');
  if (eligible.length <= 1) return eligible[0];
  // Every window can have an active tab. Prefer the tab the user is actually
  // looking at, and select only once rather than trying another account on error.
  const focused = await chrome.tabs.query({ url: ORIGINS[provider], active: true, lastFocusedWindow: true });
  return eligible.find(tab => focused.some(candidate => candidate.id === tab.id && candidate.active))
    ?? eligible.sort((a, b) => Number(b.active) - Number(a.active))[0];
}
export async function collectFromTab(provider: Provider): Promise<unknown> {
  if (!await chrome.permissions.contains({ origins: [ORIGINS[provider]] })) throw new CollectionError('permission_required', 'permission_required');
  const tab = await collectionTab(provider);
  if (typeof tab?.id !== 'number') {
    return unwrapTransport(provider === 'gemini'
      ? await collectGeminiInWorker()
      : await collectInPage(provider, ticketScopeSalt(), 'worker'));
  }
  let results: chrome.scripting.InjectionResult<TransportResult>[];
  try { results = provider === 'gemini'
    ? await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectGeminiInPage })
    : await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: collectInPage, args: [provider, ticketScopeSalt()] }); }
  catch { throw new CollectionError('tab_access_failed'); }
  return unwrapTransport(results[0]?.result);
}
let scopeSalt: string | undefined;
function ticketScopeSalt(): string {
  try { return scopeSalt ??= Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join(''); }
  catch { return ''; }
}
