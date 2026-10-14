import { SITE_GROUPS, type View } from '../shared/types';
import { needsContent } from '../shared/display-policy';
import { installChatGPTObserver, stopChatGPTObserver } from '../providers/chatgpt-observer';
export async function reconcileContent(view: View): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const currentIds = new Set(SITE_GROUPS.map(site => `ai-gauge-${site.id}`));
  const observerId = 'ai-gauge-chatgpt-observer';
  currentIds.add(observerId);
  const retired = existing.filter(s => s.id.startsWith('ai-gauge-') && !currentIds.has(s.id)).map(s => s.id);
  if (retired.length) await chrome.scripting.unregisterContentScripts({ ids: retired });
  const observe = view.permissions.chatgpt && view.settings.enabled.chatgpt;
  const observing = existing.some(s => s.id === observerId);
  if (observe && !observing) await chrome.scripting.registerContentScripts([{ id: observerId, matches: ['https://chatgpt.com/*'], js: ['chatgpt-observer.js'], world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true }]);
  if (!observe && observing) await chrome.scripting.unregisterContentScripts({ ids: [observerId] });
  if (view.permissions.chatgpt && (observe || observing)) {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    await Promise.all(tabs.filter(t => typeof t.id === 'number' && !t.discarded && !t.frozen).map(t =>
      chrome.scripting.executeScript({ target: { tabId: t.id! }, world: 'MAIN', func: observe ? installChatGPTObserver : stopChatGPTObserver }).catch(() => undefined)));
  }
  for (const site of SITE_GROUPS) {
    const id = `ai-gauge-${site.id}`, present = existing.some(s => s.id === id);
    // Keep the isolated cleanup/event bridge while ChatGPT observation is enabled,
    // even when its visual strip is turned off.
    const enabled = needsContent(view, site.providers);
    if (!enabled && present) await chrome.scripting.unregisterContentScripts({ ids: [id] });
    if (enabled && !present) await chrome.scripting.registerContentScripts([{ id, matches: [site.origin], js: ['content.js'], runAt: 'document_start', persistAcrossSessions: true }]);
    if (enabled && present && existing.find(s => s.id === id)?.runAt === 'document_idle') await chrome.scripting.updateContentScripts([{ id, js: ['content.js'], runAt: 'document_start' }]);
    if (enabled) {
      const tabs = await chrome.tabs.query({ url: site.origin });
      await Promise.all(tabs.filter(t => typeof t.id === 'number' && !t.discarded && !t.frozen).map(t => chrome.scripting.executeScript({ target: { tabId: t.id! }, files: ['content.js'] }).catch(() => undefined)));
    }
  }
}
