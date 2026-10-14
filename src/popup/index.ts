import { ORIGINS, PROVIDERS, type Provider, type Settings, type View } from '../shared/types';
import { request } from '../shared/contracts';
import { renderCards } from './render';
import { bindDiagnostics } from './diagnostics';
import { DEVELOPMENT } from '../shared/build-mode';
let view: View | null = null, busy = false, settingsDirty = false, viewDirty = false;
const installedManifest = chrome.runtime.getManifest();
const extensionVersion = installedManifest.version_name ?? installedManifest.version;
document.getElementById('extension-version')!.textContent = `AI Gauge ${extensionVersion}`;
if (DEVELOPMENT) bindDiagnostics(document, () => view, extensionVersion);
const cards = document.getElementById('cards')!, feedback = document.getElementById('feedback')!;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const displayNames: Record<Provider, string> = { chatgpt: 'ChatGPT', work_codex: 'Codex', claude: 'Claude' };
for (const p of PROVIDERS) {
  const label = document.createElement('label'); label.className = 'toggle';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = `strip-${p}`;
  label.append(checkbox, document.createTextNode(`${displayNames[p]} 입력창에 표시`)); document.getElementById('strip-settings')!.append(label);
}
function render() {
  if (!view) return;
  renderCards(cards, view, { enable: p => { void enable(p); }, disable: p => { void run(() => request({ type: 'disable', provider: p })); }, revoke: p => { void run(async () => { await chrome.permissions.remove({ origins: [ORIGINS[p]] }); return request({ type: 'view' }); }); }, refresh: p => { void run(() => request({ type: 'refresh', provider: p, trigger: 'manual' })); } });
  if (!settingsDirty) {
    for (const p of PROVIDERS) field(`strip-${p}`).checked = view.settings.strips[p];
  }
}
async function run(action: () => Promise<View>) {
  if (busy) return;
  busy = true;
  try { view = await action(); render(); feedback.textContent = ''; }
  catch { feedback.textContent = '확장 프로그램과 통신할 수 없습니다. 확장을 다시 로드해 주세요.'; }
  finally { busy = false; if (viewDirty) { viewDirty = false; void run(() => request({ type: 'view' })); } }
}
async function enable(p: Provider) {
  if (busy) return;
  let canceled = false;
  await run(async () => {
    // run invokes this callback synchronously, preserving the click gesture.
    if (!await chrome.permissions.request({ origins: [ORIGINS[p]] })) { canceled = true; return request({ type: 'view' }); }
    return request({ type: 'enable', provider: p });
  });
  if (canceled) feedback.textContent = '권한 승인이 취소되었습니다.';
}
document.getElementById('settings-form')!.addEventListener('input', () => { settingsDirty = true; });
document.getElementById('settings-form')!.addEventListener('submit', event => {
  event.preventDefault();
  const strips = Object.fromEntries(PROVIDERS.map(p => [p, field(`strip-${p}`).checked])) as Settings['strips'];
  settingsDirty = false;
  void run(() => request({ type: 'strips', strips }));
});
chrome.storage.onChanged.addListener(() => { if (busy) viewDirty = true; else void run(() => request({ type: 'view' })); });
// Render cache first; the worker independently refreshes only due enabled providers.
void run(() => request({ type: 'view' }));
setInterval(render, 15_000);
