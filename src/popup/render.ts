import { HOME_URLS, NAMES, PROVIDERS, type Provider, type View } from '../shared/types';
import { resetLabel, statusText, usagePercentLabel } from '../shared/format';
import { percent } from '../shared/validation';
import { currentPlanLabel } from '../shared/plan';
import { effectiveSnapshot } from '../storage/snapshots';
export interface Actions { enable(p: Provider): void; disable(p: Provider): void; revoke(p: Provider): void; refresh(p: Provider): void; select?(p: Provider, id: string | null): void }
const limitLabel = (provider: Provider, label: string) => provider === 'chatgpt'
  ? label.replace(/^Work\s*\/\s*Codex\s*공유\s*(?:[·:–—-]\s*)?/, '').trim() || '사용량' : label;
export function renderCards(container: HTMLElement, view: View, actions: Actions, now = Date.now()) {
  const d = container.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => { const e = d.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const cards = PROVIDERS.map(p => {
    const s = effectiveSnapshot(view.snapshots[p], now), enabled = view.settings.enabled[p];
    const card = el('section', undefined, 'card');
    card.dataset.provider = p;
    const title = NAMES[p];
    card.setAttribute('aria-label', `${title} 사용량`);
    const heading = el('div', undefined, 'card-heading');
    const plan = enabled && view.permissions[p] ? currentPlanLabel(view.snapshots[p], now) : '확인 불가';
    heading.append(el('h2', title));
    if (plan !== '확인 불가') {
      const badge = el('span', plan, 'plan-badge');
      badge.setAttribute('aria-label', `${title} 요금제: ${plan}`);
      heading.append(badge);
    }
    card.append(heading);
    if (!enabled || s.state !== 'ok') card.append(el('p', enabled ? statusText(s) : '꺼짐', 'status'));
    else if (!s.limits.length) card.append(el('p', '사용량 확인 불가', 'status'));
    if (enabled && s.limits.length) {
      if (s.state !== 'ok') card.append(el('p', '이전 수집값', 'status'));
      for (const limit of s.limits) {
        const name = limitLabel(p, limit.label);
        const row = el('div', undefined, `limit ${s.state === 'ok' ? '' : 'old'}`), line = el('div', undefined, 'limit-line');
        line.append(el('span', name), el('span', usagePercentLabel(limit.percent), 'percent'));
        row.append(line);
        const used = percent(limit.percent);
        if (used !== null) { const bar = el('progress'); bar.max = 100; bar.value = used; bar.setAttribute('aria-label', `${name} 사용량${s.state === 'ok' ? '' : ' (이전 값)'}`); row.append(bar); }
        row.append(el('div', resetLabel(limit.resetsAt, now), 'reset')); card.append(row);
      }
    }
    const controls = el('div', undefined, 'actions');
    const button = (parent: HTMLElement, text: string, fn: () => void, cls?: string) => { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); parent.append(b); return b; };
    if (!enabled || !view.permissions[p]) button(controls, view.permissions[p] ? '켜기' : '권한 승인 및 켜기', () => actions.enable(p), 'grant');
    if (enabled) {
      const refresh = button(controls, '새로고침', () => actions.refresh(p));
      refresh.disabled = !view.permissions[p] || s.nextAttemptAt > now;
      button(controls, '끄기', () => actions.disable(p));
    }
    if (view.permissions[p]) button(controls, '권한 철회', () => actions.revoke(p));
    const link = el('a', '사이트 열기'); link.href = HOME_URLS[p]; link.target = '_blank'; link.rel = 'noopener noreferrer'; controls.append(link);
    card.append(controls); return card;
  });
  container.replaceChildren(...cards);
}
