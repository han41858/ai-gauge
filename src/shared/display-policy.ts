import type { PageProvider, Provider, View } from './types';

// A page location is independent of the quota source. Both OpenAI page types
// show the same plan pool, collected and stored once.
export const displayProvider = (page: PageProvider): Provider => page === 'codex' ? 'chatgpt' : page;

export function shouldShowStrip(view: View, page: PageProvider): boolean {
  const source = displayProvider(page);
  return view.permissions[source] && view.settings.enabled[source] && view.settings.strips[page];
}

export function needsContent(view: View, pages: PageProvider[]): boolean {
  return pages.some(page => shouldShowStrip(view, page));
}

export const canRefreshFromPage = (page: PageProvider, source: Provider): boolean => displayProvider(page) === source;
