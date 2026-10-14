import type { Provider, View } from './types';

// A page location is independent of the quota source. Both OpenAI page types
// show the same plan pool; the ordinary-chat observation remains separate.
export const displayProvider = (page: Provider): Provider => page === 'chatgpt' ? 'work_codex' : page;

export function shouldShowStrip(view: View, page: Provider): boolean {
  const source = displayProvider(page);
  return view.permissions[source] && view.settings.enabled[source] && view.settings.strips[page];
}

export function needsContent(view: View, pages: Provider[]): boolean {
  const observeChatGPT = pages.includes('chatgpt') && view.permissions.chatgpt && view.settings.enabled.chatgpt;
  return observeChatGPT || pages.some(page => shouldShowStrip(view, page));
}

export const canRefreshFromPage = (page: Provider, source: Provider): boolean => page === source || displayProvider(page) === source;
