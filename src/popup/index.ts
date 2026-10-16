import { NAMES, ORIGINS, PAGE_PROVIDERS, PROVIDERS, type PageProvider, type Provider, type Settings, type View } from '../shared/types';
import { request, type Message } from '../shared/contracts';
import { renderCards } from './render';
import { bindDiagnostics } from './diagnostics';
import { DEVELOPMENT } from '../shared/build-mode';
import { checkUsageThresholds } from '../storage/settings';
import { affectsView } from '../storage/snapshots';
import { localizeDocument, setLanguagePreference, t, uiLanguage, type MessageKey } from '../shared/i18n';
localizeDocument(document);
let view: View | null = null, busy = false, viewDirty = false, settingsRevision = 0;
const dirtyFields = new Map<string, number>();
const settingsFields = ['language', 'gauge-warning', 'gauge-danger', ...PAGE_PROVIDERS.map(p => `strip-${p}`)];
let pendingSave: { message: Extract<Message, { type: 'display-settings' }>; revision: number; preserveDraft: boolean } | null = null;
let lastValidThresholds: Pick<Settings, 'warning' | 'danger'> | null = null;
let renderedLanguage = uiLanguage();
const installedManifest = chrome.runtime.getManifest();
const extensionVersion = installedManifest.version_name ?? installedManifest.version;
document.getElementById('extension-version')!.textContent = `AI Gauge ${extensionVersion}`;
if (DEVELOPMENT) bindDiagnostics(document, () => view, extensionVersion);
const cards = document.getElementById('cards')!, feedback = document.getElementById('feedback')!;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const languageField = document.getElementById('language') as HTMLSelectElement;
const onboarding = document.getElementById('onboarding')!, preferences = document.getElementById('preferences')!;
const setupButton = document.getElementById('onboarding-submit') as HTMLButtonElement;
for (const p of PROVIDERS) {
  const label = document.createElement('label'); label.className = 'toggle';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = `choose-${p}`; checkbox.checked = true;
  label.append(checkbox, document.createTextNode(NAMES[p])); document.getElementById('provider-choices')!.append(label);
}
const selectedProviders = () => PROVIDERS.filter(p => field(`choose-${p}`).checked);
function renderSetup() {
  setupButton.disabled = busy || selectedProviders().length === 0;
  for (const p of PROVIDERS) field(`choose-${p}`).disabled = busy;
}
const displayNames: Record<PageProvider, string> = { chatgpt: 'ChatGPT', codex: 'Codex', claude: 'Claude', gemini: 'Gemini' };
const stripLabels = new Map<PageProvider, Text>();
for (const p of PAGE_PROVIDERS) {
  const label = document.createElement('label'); label.className = 'toggle';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = `strip-${p}`;
  const text = document.createTextNode(t('popup_show_in_composer', displayNames[p])); stripLabels.set(p, text);
  label.append(checkbox, text); document.getElementById('strip-settings')!.append(label);
}
function render() {
  if (!view) return;
  setLanguagePreference(view.settings.language);
  localizeDocument(document);
  for (const p of PAGE_PROVIDERS) stripLabels.get(p)!.textContent = t('popup_show_in_composer', displayNames[p]);
  const diagnosticsFeedback = document.getElementById('diagnostics-feedback');
  if (renderedLanguage !== uiLanguage() && diagnosticsFeedback) diagnosticsFeedback.textContent = '';
  renderedLanguage = uiLanguage();
  renderSettingsFeedback();
  const needsSetup = PROVIDERS.every(p => !view!.settings.enabled[p] && !view!.permissions[p]);
  onboarding.hidden = !needsSetup; cards.hidden = needsSetup; preferences.hidden = needsSetup;
  renderSetup();
  renderCards(cards, view, {
    enable: p => { void enable(p); },
    disable: p => { void run(() => request({ type: 'disable', provider: p })); },
    revoke: p => { void run(async () => { await chrome.permissions.remove({ origins: [ORIGINS[p]] }); return request({ type: 'view' }); }); }
  });
  for (const p of PAGE_PROVIDERS) if (!dirtyFields.has(`strip-${p}`)) field(`strip-${p}`).checked = view.settings.strips[p];
  if (!dirtyFields.has('gauge-warning')) field('gauge-warning').value = String(view.settings.warning);
  if (!dirtyFields.has('gauge-danger')) field('gauge-danger').value = String(view.settings.danger);
  if (!dirtyFields.has('language')) languageField.value = view.settings.language;
  const thresholds = pendingSave?.message ?? view.settings;
  lastValidThresholds = { warning: thresholds.warning, danger: thresholds.danger };
}
async function run(action: () => Promise<View>) {
  if (busy) return;
  busy = true;
  renderSetup();
  try { view = await action(); render(); feedback.textContent = ''; }
  catch { feedback.textContent = t('popup_communication_failed'); }
  finally {
    busy = false; renderSetup();
    if (pendingSave) savePendingSettings();
    else if (viewDirty) { viewDirty = false; void run(() => request({ type: 'read' })); }
  }
}
async function enableSelected(providers: Provider[]) {
  if (busy || !providers.length) return;
  let canceled = false;
  await run(async () => {
    // run invokes this callback synchronously, preserving the click gesture.
    if (!await chrome.permissions.request({ origins: providers.map(p => ORIGINS[p]) })) { canceled = true; return request({ type: 'view' }); }
    return providers.length === 1 ? request({ type: 'enable', provider: providers[0]! }) : request({ type: 'enable-many', providers });
  });
  if (canceled) feedback.textContent = t('popup_permission_canceled');
}
const enable = (p: Provider) => enableSelected([p]);
document.getElementById('onboarding-form')!.addEventListener('input', renderSetup);
document.getElementById('onboarding-form')!.addEventListener('submit', event => {
  event.preventDefault();
  void enableSelected(selectedProviders());
});
const settingsFeedback = document.getElementById('settings-feedback')!;
let settingsFeedbackKey: MessageKey | null = null, invalidFields: string[] = [];
function renderSettingsFeedback() {
  const invalid = invalidFields;
  settingsFeedback.setAttribute('role', invalid.length ? 'alert' : 'status');
  settingsFeedback.setAttribute('aria-live', invalid.length ? 'assertive' : 'polite');
  settingsFeedback.textContent = settingsFeedbackKey ? t(settingsFeedbackKey) : '';
  for (const id of ['gauge-warning', 'gauge-danger']) {
    if (invalid.includes(id)) field(id).setAttribute('aria-invalid', 'true');
    else field(id).removeAttribute('aria-invalid');
  }
}
function showSettingsFeedback(key: MessageKey | null, invalid: string[] = []) {
  settingsFeedbackKey = key; invalidFields = invalid; renderSettingsFeedback();
}
function markSettingsDirty(id?: string) {
  settingsRevision++;
  if (id && settingsFields.includes(id)) dirtyFields.set(id, settingsRevision);
  else if (view) {
    if (languageField.value !== view.settings.language) dirtyFields.set('language', settingsRevision);
    for (const name of ['warning', 'danger'] as const) {
      if (field(`gauge-${name}`).value !== String(view.settings[name])) dirtyFields.set(`gauge-${name}`, settingsRevision);
    }
    for (const p of PAGE_PROVIDERS) {
      if (field(`strip-${p}`).checked !== view.settings.strips[p]) dirtyFields.set(`strip-${p}`, settingsRevision);
    }
  }
}
document.getElementById('settings-form')!.addEventListener('input', event => {
  markSettingsDirty((event.target as HTMLElement).id); showSettingsFeedback(null);
});
function queueSettingsSave(thresholdChange: boolean, fieldId?: string, focusInvalid = false) {
  if (!view) return;
  markSettingsDirty(fieldId);
  const checked = checkUsageThresholds(field('gauge-warning').valueAsNumber, field('gauge-danger').valueAsNumber);
  if (!checked.ok) {
    const fields = checked.fields.map(name => `gauge-${name}`);
    showSettingsFeedback(checked.reason === 'order' ? 'popup_threshold_order_error' : 'popup_threshold_range_error', fields);
    if (thresholdChange) { if (focusInvalid) field(fields[0]!).focus(); return; }
  } else {
    lastValidThresholds = checked.value;
    showSettingsFeedback(null);
  }
  const thresholds = lastValidThresholds ?? { warning: view.settings.warning, danger: view.settings.danger };
  const strips = Object.fromEntries(PAGE_PROVIDERS.map(p => [p, field(`strip-${p}`).checked])) as Settings['strips'];
  pendingSave = { message: { type: 'display-settings', strips, ...thresholds, language: languageField.value as Settings['language'] },
    revision: settingsRevision, preserveDraft: !checked.ok };
  savePendingSettings();
}
function savePendingSettings() {
  if (busy || !pendingSave) return;
  const save = pendingSave; pendingSave = null;
  void run(async () => {
    const next = await request(save.message);
    for (const [id, revision] of dirtyFields) {
      if (revision <= save.revision && !(save.preserveDraft && id.startsWith('gauge-'))) dirtyFields.delete(id);
    }
    if (save.revision === settingsRevision && !save.preserveDraft) {
      showSettingsFeedback('popup_settings_saved');
    }
    return next;
  });
}
document.getElementById('settings-form')!.addEventListener('change', event => {
  const target = event.target as HTMLElement;
  queueSettingsSave(target.id === 'gauge-warning' || target.id === 'gauge-danger', target.id);
});
document.getElementById('settings-form')!.addEventListener('submit', event => {
  event.preventDefault(); queueSettingsSave(true, undefined, true);
});
for (const id of ['gauge-warning', 'gauge-danger']) field(id).addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); queueSettingsSave(true, id, true); }
});
// Re-read only; collection was already requested when the popup opened.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!affectsView(changes, areaName)) return;
  if (busy) viewDirty = true; else void run(() => request({ type: 'read' }));
});
// Render cache first; the worker independently refreshes only due enabled providers.
void run(() => request({ type: 'view' }));
setInterval(render, 15_000);
