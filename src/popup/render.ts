import { HOME_URLS, NAMES, PROVIDERS, type Provider, type View } from '../shared/types';
import { resetLabel, statusText, usagePercentLabel } from '../shared/format';
import { percent } from '../shared/validation';
import { usageColor } from '../shared/usage-color';
import { currentPlanLabel } from '../shared/plan';
import { effectiveSnapshot } from '../storage/snapshots';
import { ticketDisplay } from '../shared/ticket-presentation';
import { setLanguagePreference, t } from '../shared/i18n';
import { localizedLimitLabel } from '../shared/limit-label';
export interface Actions { enable(p: Provider): void; disable(p: Provider): void; revoke(p: Provider): void; select?(p: Provider, id: string | null): void }
export function renderCards(container: HTMLElement, view: View, actions: Actions, now = Date.now()) {
  setLanguagePreference(view.settings.language);
  const d = container.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => { const e = d.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const cards = PROVIDERS.map(p => {
    const s = effectiveSnapshot(view.snapshots[p], now), enabled = view.settings.enabled[p];
    const card = el('section', undefined, 'card');
    card.dataset.provider = p;
    const title = NAMES[p];
    card.setAttribute('aria-label', t('popup_provider_usage', title));
    const heading = el('div', undefined, 'card-heading');
    const identity = el('div', undefined, 'provider-name');
    const plan = enabled && view.permissions[p] ? currentPlanLabel(view.snapshots[p], now) : null;
    const name = el('h2'), home = el('a', title, 'provider-home');
    home.href = HOME_URLS[p]; home.target = '_blank'; home.rel = 'noopener noreferrer';
    home.setAttribute('aria-label', t('popup_open_site', title));
    name.append(home); identity.append(name);
    if (plan) {
      const badge = el('span', plan, 'plan-badge');
      badge.setAttribute('aria-label', t('popup_provider_plan', [title, plan]));
      identity.append(badge);
    }
    heading.append(identity);
    card.append(heading);
    if (!enabled || s.state !== 'ok') card.append(el('p', enabled ? statusText(s) : t('popup_disabled'), 'status'));
    else if (!s.limits.length) card.append(el('p', t('popup_usage_unavailable'), 'status'));
    if (enabled && s.limits.length) {
      if (s.state !== 'ok') card.append(el('p', t('popup_previous_usage'), 'status'));
      const limits = [...s.limits].sort((a, b) => (a.windowSeconds || Infinity) - (b.windowSeconds || Infinity));
      for (const limit of limits) {
        const name = localizedLimitLabel(limit, p);
        const row = el('div', undefined, `limit ${s.state === 'ok' ? '' : 'old'}`), line = el('div', undefined, 'limit-line');
        line.append(el('span', name), el('span', usagePercentLabel(limit.percent), 'percent'));
        row.append(line);
        const used = percent(limit.percent);
        if (used !== null) {
          const bar = el('progress'); bar.max = 100; bar.value = used;
          bar.style.setProperty('--usage-color', usageColor(used, view.settings));
          bar.setAttribute('aria-label', t(s.state === 'ok' ? 'popup_limit_usage' : 'popup_limit_previous_usage', name));
          row.append(bar);
        }
        row.append(el('div', resetLabel(limit.resetsAt, now), 'reset')); card.append(row);
      }
    }
    const tickets = enabled && view.permissions[p] ? ticketDisplay(view.snapshots[p], now) : null;
    if (tickets) {
      const link = el('a', undefined, 'ticket-info');
      link.href = tickets.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = tickets.details;
      link.setAttribute('aria-label', tickets.popupAccessible);
      link.setAttribute('aria-description', tickets.details);
      link.append(el('span', tickets.count, 'ticket-count'));
      for (const entry of tickets.entries) link.append(el('span', entry, 'ticket-expiry'));
      card.append(link);
    }
    const controls = el('div', undefined, 'actions');
    const button = (parent: HTMLElement, text: string, fn: () => void, cls?: string) => {
      const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); parent.append(b); return b;
    };
    if (!enabled || !view.permissions[p]) button(controls, t(view.permissions[p] ? 'popup_enable' : 'popup_grant_enable'), () => actions.enable(p), 'grant');
    if (enabled) button(controls, t('popup_disable'), () => actions.disable(p));
    if (view.permissions[p]) button(controls, t('popup_revoke'), () => actions.revoke(p));
    heading.append(controls); return card;
  });
  container.replaceChildren(...cards);
}
