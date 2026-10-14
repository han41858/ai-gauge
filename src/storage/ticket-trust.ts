import type { Provider } from '../shared/types';

const key = (provider: Provider) => `ticket-trust:v1:${provider}`;
// Session storage survives routine MV3 worker eviction but not a browser
// restart. Only a boolean is retained: never an account proof or identifier.
export async function readTicketTrust(provider: Provider): Promise<boolean> {
  try {
    const storage = chrome.storage.session;
    return !!storage && (await storage.get(key(provider)))[key(provider)] === true;
  } catch { return false; }
}
export async function writeTicketTrust(provider: Provider, trusted: boolean): Promise<void> {
  try { await chrome.storage.session?.set({ [key(provider)]: trusted }); } catch { /* Missing session storage cannot prevent usage collection. */ }
}
