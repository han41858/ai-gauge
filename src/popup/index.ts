import { NAMES, ORIGINS, PAGE_PROVIDERS, PROVIDERS, type PageProvider, type Provider, type Settings, type View } from '../shared/types';
import { request } from '../shared/contracts';
import { renderCards } from './render';
import { bindDiagnostics } from './diagnostics';
import { DEVELOPMENT } from '../shared/build-mode';
import { checkUsageThresholds } from '../storage/settings';
import { affectsView } from '../storage/snapshots';
let view: View | null = null, busy = false, settingsDirty = false, viewDirty = false, settingsRevision = 0;
const installedManifest = chrome.runtime.getManifest();
const extensionVersion = installedManifest.version_name ?? installedManifest.version;
document.getElementById('extension-version')!.textContent = `AI Gauge ${extensionVersion}`;
if (DEVELOPMENT) bindDiagnostics(document, () => view, extensionVersion);
const cards = document.getElementById('cards')!, feedback = document.getElementById('feedback')!;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
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
for (const p of PAGE_PROVIDERS) {
  const label = document.createElement('label'); label.className = 'toggle';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = `strip-${p}`;
  label.append(checkbox, document.createTextNode(`${displayNames[p]} 입력창에 표시`)); document.getElementById('strip-settings')!.append(label);
}
function render() {
  if (!view) return;
  const needsSetup = PROVIDERS.every(p => !view!.settings.enabled[p] && !view!.permissions[p]);
  onboarding.hidden = !needsSetup; cards.hidden = needsSetup; preferences.hidden = needsSetup;
  renderSetup();
  renderCards(cards, view, { enable: p => { void enable(p); }, disable: p => { void run(() => request({ type: 'disable', provider: p })); }, revoke: p => { void run(async () => { await chrome.permissions.remove({ origins: [ORIGINS[p]] }); return request({ type: 'view' }); }); } });
  if (!settingsDirty) {
    for (const p of PAGE_PROVIDERS) field(`strip-${p}`).checked = view.settings.strips[p];
    field('gauge-warning').value = String(view.settings.warning);
    field('gauge-danger').value = String(view.settings.danger);
  }
}
async function run(action: () => Promise<View>) {
  if (busy) return;
  busy = true;
  renderSetup();
  try { view = await action(); render(); feedback.textContent = ''; }
  catch { feedback.textContent = '확장 프로그램과 통신할 수 없습니다. 확장을 다시 로드해 주세요.'; }
  finally { busy = false; renderSetup(); if (viewDirty) { viewDirty = false; void run(() => request({ type: 'read' })); } }
}
async function enableSelected(providers: Provider[]) {
  if (busy || !providers.length) return;
  let canceled = false;
  await run(async () => {
    // run invokes this callback synchronously, preserving the click gesture.
    if (!await chrome.permissions.request({ origins: providers.map(p => ORIGINS[p]) })) { canceled = true; return request({ type: 'view' }); }
    return providers.length === 1 ? request({ type: 'enable', provider: providers[0]! }) : request({ type: 'enable-many', providers });
  });
  if (canceled) feedback.textContent = '권한 승인이 취소되었습니다.';
}
const enable = (p: Provider) => enableSelected([p]);
document.getElementById('onboarding-form')!.addEventListener('input', renderSetup);
document.getElementById('onboarding-form')!.addEventListener('submit', event => {
  event.preventDefault();
  void enableSelected(selectedProviders());
});
const settingsFeedback = document.getElementById('settings-feedback')!;
function showSettingsFeedback(text: string, invalid: string[] = []) {
  settingsFeedback.setAttribute('role', invalid.length ? 'alert' : 'status');
  settingsFeedback.setAttribute('aria-live', invalid.length ? 'assertive' : 'polite');
  settingsFeedback.textContent = text;
  for (const id of ['gauge-warning', 'gauge-danger']) {
    if (invalid.includes(id)) field(id).setAttribute('aria-invalid', 'true');
    else field(id).removeAttribute('aria-invalid');
  }
}
document.getElementById('settings-form')!.addEventListener('input', () => {
  settingsDirty = true; settingsRevision++; showSettingsFeedback('');
});
document.getElementById('settings-form')!.addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  const checked = checkUsageThresholds(field('gauge-warning').valueAsNumber, field('gauge-danger').valueAsNumber);
  if (!checked.ok) {
    const fields = checked.fields.map(name => `gauge-${name}`);
    showSettingsFeedback(checked.reason === 'order' ? '주의 시작 사용률은 경고 시작 사용률보다 작아야 합니다.' : '주의·경고 시작 사용률은 0~100 사이의 숫자로 입력해 주세요.', fields);
    field(fields[0]!).focus();
    return;
  }
  const thresholds = checked.value;
  const strips = Object.fromEntries(PAGE_PROVIDERS.map(p => [p, field(`strip-${p}`).checked])) as Settings['strips'];
  const revision = settingsRevision;
  showSettingsFeedback('');
  void run(async () => {
    const next = await request({ type: 'display-settings', strips, ...thresholds });
    if (revision === settingsRevision) { settingsDirty = false; showSettingsFeedback('설정을 저장했습니다.'); }
    return next;
  });
});
// Re-read only; collection was already requested when the popup opened.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!affectsView(changes, areaName)) return;
  if (busy) viewDirty = true; else void run(() => request({ type: 'read' }));
});
// Render cache first; the worker independently refreshes only due enabled providers.
void run(() => request({ type: 'view' }));
setInterval(render, 15_000);
