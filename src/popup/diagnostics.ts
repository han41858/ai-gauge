import { ORIGINS, PAGE_PROVIDERS, PROVIDERS, providerFromUrl, type PageProvider, type Provider, type Snapshot, type View } from '../shared/types';
import { displayProvider } from '../shared/display-policy';
import type { DisplayDiagnostic, ReadyDisplayDiagnostic } from '../content/display-diagnostics';
import { t } from '../shared/i18n';

type ProviderDiagnostic = Pick<Snapshot, 'state' | 'errorCode' | 'checkedAt' | 'collectedAt' | 'nextAttemptAt'> & {
  enabled: boolean;
  permission: boolean;
};
export interface DiagnosticReport {
  extensionVersion: string;
  providers: Record<Provider, ProviderDiagnostic>;
  strips: Record<PageProvider, boolean>;
  display?: DisplayDiagnostic;
}

export function createDiagnosticReport(view: View, extensionVersion: string): DiagnosticReport {
  const providers = {} as DiagnosticReport['providers'];
  for (const p of PROVIDERS) {
    const snapshot = view.snapshots[p];
    providers[p] = {
      enabled: view.settings.enabled[p], permission: view.permissions[p],
      state: snapshot.state, errorCode: snapshot.errorCode,
      checkedAt: snapshot.checkedAt, collectedAt: snapshot.collectedAt, nextAttemptAt: snapshot.nextAttemptAt
    };
  }
  const strips = Object.fromEntries(PAGE_PROVIDERS.map(p => [p, view.settings.strips[p]])) as DiagnosticReport['strips'];
  return { extensionVersion, providers, strips };
}

function cleanDisplayReply(value: unknown, provider: PageProvider): ReadyDisplayDiagnostic | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  // A trusted content script may recognize Codex cloud at the ChatGPT root URL.
  // Both contexts have the same optional host permission; no other mismatch is accepted.
  const resolved = raw.provider === provider ? provider : provider === 'chatgpt' && raw.provider === 'codex' ? 'codex' : null;
  if (raw.status !== 'ready' || !resolved || raw.contentReady !== true
    || typeof raw.targetFound !== 'boolean' || typeof raw.stripVisible !== 'boolean') return null;
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
  if (!count(raw.editableCount) || !count(raw.iframeCount) || !count(raw.stripCount)) return null;
  return { status: 'ready', provider: resolved, contentReady: true, editableCount: raw.editableCount, iframeCount: raw.iframeCount,
    targetFound: raw.targetFound, stripCount: raw.stripCount, stripVisible: raw.stripVisible };
}

export async function readActiveDisplayDiagnostic(view: View, api: Pick<typeof chrome, 'tabs' | 'permissions'> = chrome): Promise<DisplayDiagnostic> {
  let provider: PageProvider | null = null;
  try {
    const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    provider = providerFromUrl(tab?.url);
    if (!provider || typeof tab?.id !== 'number') return { status: 'no_site' };
    const source = displayProvider(provider);
    if (!view.permissions[source] || !await api.permissions.contains({ origins: [ORIGINS[source]] })) return { status: 'permission_required', provider };
    const reply: unknown = await api.tabs.sendMessage(tab.id, { type: 'display-diagnostics' }, { frameId: 0 });
    return cleanDisplayReply(reply, provider) ?? { status: 'content_unavailable', provider };
  } catch {
    return provider ? { status: 'content_unavailable', provider } : { status: 'content_unavailable' };
  }
}

export function bindDiagnostics(doc: Document, getView: () => View | null, extensionVersion: string,
  copy: (text: string) => Promise<void> = text => doc.defaultView!.navigator.clipboard.writeText(text),
  readDisplay: ((view: View) => Promise<DisplayDiagnostic>) | undefined = typeof chrome !== 'undefined' && chrome.tabs ? readActiveDisplayDiagnostic : undefined) {
  const output = doc.getElementById('diagnostics-output') as HTMLTextAreaElement;
  const feedback = doc.getElementById('diagnostics-feedback')!;
  let revision = 0;
  const show = async () => {
    const currentRevision = ++revision;
    const view = getView();
    if (!view) { feedback.textContent = t('diagnostics_not_ready'); return null; }
    const report = createDiagnosticReport(view, extensionVersion);
    output.value = JSON.stringify(report, null, 2); output.hidden = false;
    if (readDisplay) {
      feedback.textContent = t('diagnostics_checking_tab');
      try { report.display = await readDisplay(view); }
      catch { report.display = { status: 'content_unavailable' }; }
      if (revision !== currentRevision) return null;
    }
    const text = JSON.stringify(report, null, 2);
    output.value = text;
    feedback.textContent = t('diagnostics_shown');
    return text;
  };
  doc.getElementById('diagnostics-show')!.addEventListener('click', () => { void show(); });
  doc.getElementById('diagnostics-copy')!.addEventListener('click', () => {
    void (async () => {
      const text = await show();
      if (text === null) return;
      try { await copy(text); feedback.textContent = t('diagnostics_copied'); }
      catch { output.focus(); output.select(); feedback.textContent = t('diagnostics_copy_failed'); }
    })();
  });
}
