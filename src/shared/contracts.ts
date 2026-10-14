import { isProvider, providerFromUrl, PROVIDERS, PAGE_PROVIDERS, type Provider, type Settings, type View } from './types';
import { record } from './validation';
import { isSettings } from '../storage/settings';
import { parseSnapshot } from '../storage/snapshots';
import { canRefreshFromPage } from './display-policy';
export type Message = { type: 'view' } | { type: 'context'; provider: Provider } | { type: 'enable'; provider: Provider } | { type: 'enable-many'; providers: Provider[] } | { type: 'disable'; provider: Provider } | { type: 'strips'; strips: Settings['strips'] } | { type: 'refresh'; provider: Provider; trigger: 'manual' | 'event' } | { type: 'settings'; settings: Settings };
export type Reply = { ok: true; view: View } | { ok: false };
export function parseMessage(input: unknown): Message | null {
  const r = record(input);
  if (!r) return null;
  const keys = Object.keys(r).sort().join(',');
  if (r.type === 'view' && keys === 'type') return { type: 'view' };
  if ((r.type === 'enable' || r.type === 'disable' || r.type === 'context') && keys === 'provider,type' && isProvider(r.provider)) return { type: r.type, provider: r.provider };
  if (r.type === 'enable-many' && keys === 'providers,type' && Array.isArray(r.providers)
    && r.providers.length > 0 && r.providers.length <= PROVIDERS.length
    && r.providers.every(isProvider) && new Set(r.providers).size === r.providers.length) {
    return { type: 'enable-many', providers: [...r.providers] };
  }
  if (r.type === 'strips' && keys === 'strips,type') {
    const strips = record(r.strips);
    if (strips && Object.keys(strips).length === PAGE_PROVIDERS.length && PAGE_PROVIDERS.every(p => typeof strips[p] === 'boolean')) {
      return { type: 'strips', strips: Object.fromEntries(PAGE_PROVIDERS.map(p => [p, strips[p]])) as Settings['strips'] };
    }
  }
  if (r.type === 'refresh' && keys === 'provider,trigger,type' && isProvider(r.provider) && (r.trigger === 'manual' || r.trigger === 'event')) return { type: 'refresh', provider: r.provider, trigger: r.trigger };
  if (r.type === 'settings' && keys === 'settings,type' && isSettings(r.settings)) return { type: 'settings', settings: r.settings };
  return null;
}
export function authorized(message: Message, sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId) return false;
  if (sender.tab) {
    const p = providerFromUrl(sender.url);
    return p !== null && providerFromUrl(sender.tab.url) === p && sender.frameId === 0 && (message.type === 'view' || (message.type === 'context' && canRefreshFromPage(p, message.provider)) || (message.type === 'refresh' && canRefreshFromPage(p, message.provider) && message.trigger === 'event'));
  }
  return message.type !== 'context' && sender.url === `chrome-extension://${extensionId}/popup.html`;
}
function sameFields(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => sameFields(value, right[index]));
  const a = record(left), b = record(right);
  return !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && sameFields(a[key], b[key]));
}
export function isReply(input: unknown): input is Extract<Reply, { ok: true }> {
  const r = record(input), view = record(r?.view);
  if (r?.ok !== true || !view || !isSettings(view.settings)) return false;
  return PROVIDERS.every(p => {
    const raw = record(record(view.snapshots)?.[p]);
    if (!raw || typeof record(view.permissions)?.[p] !== 'boolean') return false;
    const clean = parseSnapshot(raw, p as Provider);
    return sameFields(clean, raw);
  });
}
export async function request(message: Message): Promise<View> {
  const reply: unknown = await chrome.runtime.sendMessage(message);
  if (!isReply(reply)) throw new Error('invalid_extension_response');
  return reply.view;
}
