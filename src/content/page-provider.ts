import { providerFromUrl, type Provider } from '../shared/types';
import { hasCodexFooter } from './selectors';

// Codex cloud can remain at chatgpt.com/ after redirecting from /codex/cloud.
// This refines display context only; URL-based host/message authorization stays
// unchanged and still rejects unsupported origins.
export function resolvePageProvider(doc: Document, url: string): Provider | null {
  const provider = providerFromUrl(url);
  return provider === 'chatgpt' && hasCodexFooter(doc) ? 'work_codex' : provider;
}
