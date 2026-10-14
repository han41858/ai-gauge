import { findComposerTarget } from './selectors';
import type { PageProvider } from '../shared/types';

export interface ReadyDisplayDiagnostic {
  status: 'ready';
  provider: PageProvider;
  contentReady: true;
  editableCount: number;
  iframeCount: number;
  targetFound: boolean;
  stripCount: number;
  stripVisible: boolean;
}
export type DisplayDiagnostic = ReadyDisplayDiagnostic | {
  status: 'no_site' | 'permission_required' | 'content_unavailable';
  provider?: PageProvider;
};

export function authorizedDisplayRequest(message: unknown, sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  return sender.id === extensionId && !sender.tab && sender.url === `chrome-extension://${extensionId}/popup.html`
    && typeof message === 'object' && message !== null && Object.keys(message).length === 1
    && 'type' in message && message.type === 'display-diagnostics';
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  const win = element.ownerDocument.defaultView;
  if (!win) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
      || style.contentVisibility === 'hidden' || style.opacity === '0') return false;
  }
  return [...element.getClientRects()].some(box => box.width > 1 && box.height > 1
    && box.right > 0 && box.bottom > 0 && box.left < win.innerWidth && box.top < win.innerHeight);
}

export function createDisplayDiagnostic(doc: Document, provider: PageProvider): ReadyDisplayDiagnostic {
  const strips = [...doc.querySelectorAll<HTMLElement>('#ai-gauge-usage-strip')];
  return {
    status: 'ready', provider, contentReady: true,
    editableCount: Math.min(10_000, doc.querySelectorAll('[contenteditable],textarea').length),
    iframeCount: Math.min(10_000, doc.querySelectorAll('iframe').length),
    targetFound: findComposerTarget(doc, provider) !== null,
    stripCount: Math.min(10_000, strips.length), stripVisible: strips.some(visible)
  };
}
