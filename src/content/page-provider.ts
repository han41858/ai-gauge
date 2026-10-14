import { providerFromUrl, type PageProvider } from '../shared/types';
import { hasCodexFooter } from './selectors';

// Codex cloud can remain at chatgpt.com/ after redirecting from /codex/cloud.
// This refines display context only; URL-based host/message authorization stays
// unchanged and still rejects unsupported origins.
export function resolvePageProvider(doc: Document, url: string): PageProvider | null {
  const provider = providerFromUrl(url);
  return provider === 'chatgpt' && hasCodexFooter(doc) ? 'codex' : provider;
}
