import { representativeUsageLimit } from '../shared/usage-selection';
import { type PageProvider, type View } from '../shared/types';
import { displayProvider, shouldShowStrip } from '../shared/display-policy';
import { usageParts } from './usage-label';
import { findComposerTarget, retainsComposerTarget, type ComposerTarget } from './selectors';
import { effectiveSnapshot } from '../storage/snapshots';
import { inlineTicketDisplay } from '../shared/ticket-presentation';
import { UsageGauge, USAGE_GAUGE_CSS } from './usage-gauge';
import { usageColor } from '../shared/usage-color';
import { setLanguagePreference, t, uiLanguage } from '../shared/i18n';
export class UsageStrip {
  private host: HTMLElement | null = null;
  private view: View | null = null;
  private target: ComposerTarget | null = null;
  constructor(private provider: PageProvider, private doc: Document) {}
  update(view: View) { this.view = view; this.mount(); }
  mount() {
    const view = this.view, p = this.provider;
    if (!view || !shouldShowStrip(view, p)) { this.remove(); return; }
    setLanguagePreference(view.settings.language);
    // A second unpacked installation has a separate isolated world. Yield to its
    // connected strip instead of moving two identically named nodes endlessly.
    if ([...this.doc.querySelectorAll('#ai-gauge-usage-strip')].some(node => node !== this.host)) { this.remove(); return; }
    const next = findComposerTarget(this.doc, p);
    if (next) this.target = next;
    // Keep a known composer through transient editors and modal isolation;
    // actual hiding, removal or loss of its composer structure still clears it.
    else if (!this.target || !retainsComposerTarget(this.target)) { this.remove(); return; }
    const anchor = this.target!.anchor;
    const snapshot = effectiveSnapshot(view.snapshots[displayProvider(p)]), limit = representativeUsageLimit(displayProvider(p), snapshot.limits) ?? undefined;
    const parts = usageParts(snapshot, limit);
    if (!this.host) {
      this.host = this.doc.createElement('div');
      this.host.id = 'ai-gauge-usage-strip';
      this.host.dataset.aiGaugeOwned = 'usage-strip';
      this.host.lang = uiLanguage();
      const root = this.host.attachShadow({ mode: 'closed' });
      const style = this.doc.createElement('style');
      style.textContent = `
${USAGE_GAUGE_CSS}
:host{display:block;position:static;box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:30px;flex:0 0 auto;align-self:stretch;grid-column:1/-1;margin:0;border:0;background:transparent;font:12px/1.5 system-ui;color:inherit;container:ai-gauge/inline-size}
.usage{display:flex;align-items:center;gap:14px;box-sizing:border-box;height:30px;padding:0 10px;border:0;background:transparent;overflow:hidden}
.current{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0;max-width:100%;overflow:hidden}
.current>span,.reset,.status{color:inherit;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.reset,.status{min-width:0;max-width:100%}
.tickets{flex:0 0 auto;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;opacity:.8;text-decoration:underline;text-underline-offset:3px}
.tickets:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:2px}
.usage:has(.status:not([hidden])) .reset{display:none}
progress{appearance:none;-webkit-appearance:none;width:80px;max-width:100%;height:6px;flex:0 0 80px;box-sizing:border-box;border:0;border-radius:999px;overflow:hidden;background:#8893a033;accent-color:var(--usage-color)}
progress::-webkit-progress-bar{background:#8893a033;border-radius:999px}
progress::-webkit-progress-value{background:var(--usage-color);border-radius:999px;transition:background-color 300ms ease}
progress::-moz-progress-bar{background:var(--usage-color);border-radius:999px;transition:background-color 300ms ease}
@media (prefers-reduced-motion:reduce){progress::-webkit-progress-value{transition:none}progress::-moz-progress-bar{transition:none}}
@container ai-gauge (max-width:900px){.tickets{display:none}}
@container ai-gauge (max-width:520px){.reset{display:none}}
@container ai-gauge (max-width:280px){progress{display:none}}
@container ai-gauge (max-width:180px){.brand-icon{display:none}}
[hidden]{display:none!important}`;
      const row = this.doc.createElement('div');
      row.className = 'usage';
      row.setAttribute('role', 'status');
      row.setAttribute('aria-live', 'polite');
      row.setAttribute('aria-atomic', 'true');
      const current = this.doc.createElement('span'); current.className = 'current';
      this.currentText = this.doc.createElement('span');
      this.progress = this.doc.createElement('progress');
      this.progress.max = 100;
      this.progress.hidden = true;
      this.progress.setAttribute('aria-label', t('format_usage_name'));
      current.append(this.currentText, this.progress);
      this.gauge = new UsageGauge(this.doc, parts.percent, view.settings);
      current.prepend(this.gauge.element);
      this.resetText = this.doc.createElement('span'); this.resetText.className = 'reset';
      this.statusText = this.doc.createElement('span'); this.statusText.className = 'status'; this.statusText.hidden = true;
      row.append(current, this.resetText, this.statusText);
      if (p !== 'gemini') {
        this.ticketLink = this.doc.createElement('a'); this.ticketLink.className = 'tickets'; this.ticketLink.hidden = true;
        this.ticketLink.target = '_blank'; this.ticketLink.rel = 'noopener noreferrer';
        row.append(this.ticketLink);
      }
      root.append(style, row);
    }
    if (anchor.nextElementSibling !== this.host) anchor.after(this.host);
    if (this.host.lang !== uiLanguage()) this.host.lang = uiLanguage();
    const progressLabel = t('format_usage_name');
    if (this.progress!.getAttribute('aria-label') !== progressLabel) this.progress!.setAttribute('aria-label', progressLabel);
    this.gauge!.update(parts.percent, view.settings);
    const color = usageColor(parts.percent, view.settings);
    if (this.progress!.style.getPropertyValue('--usage-color') !== color) this.progress!.style.setProperty('--usage-color', color);
    if (this.currentText!.textContent !== parts.current) this.currentText!.textContent = parts.current;
    if (this.resetText!.textContent !== parts.reset) this.resetText!.textContent = parts.reset;
    const status = parts.status ?? '';
    if (this.statusText!.textContent !== status) this.statusText!.textContent = status;
    if (this.statusText!.hidden !== (parts.status === null)) this.statusText!.hidden = parts.status === null;
    if (this.progress!.hidden !== (parts.percent === null)) this.progress!.hidden = parts.percent === null;
    if (parts.percent === null) {
      if (this.progress!.hasAttribute('value')) this.progress!.removeAttribute('value');
    } else if (this.progress!.getAttribute('value') !== String(parts.percent)) this.progress!.setAttribute('value', String(parts.percent));
    if (this.ticketLink) {
      const tickets = inlineTicketDisplay(view.snapshots[displayProvider(p)]);
      if (this.ticketLink.hidden !== (tickets === null)) this.ticketLink.hidden = tickets === null;
      if (tickets) {
        if (this.ticketLink.textContent !== tickets.text) this.ticketLink.textContent = tickets.text;
        if (this.ticketLink.getAttribute('href') !== tickets.href) this.ticketLink.href = tickets.href;
        if (this.ticketLink.getAttribute('aria-label') !== tickets.accessible) this.ticketLink.setAttribute('aria-label', tickets.accessible);
      } else {
        if (this.ticketLink.textContent) this.ticketLink.textContent = '';
        for (const attribute of ['href', 'aria-label', 'aria-description', 'title']) if (this.ticketLink.hasAttribute(attribute)) this.ticketLink.removeAttribute(attribute);
      }
    }
    if (this.host.getAttribute('aria-label') !== parts.label) this.host.setAttribute('aria-label', parts.label);
  }
  private currentText: HTMLElement | null = null;
  private resetText: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private progress: HTMLProgressElement | null = null;
  private gauge: UsageGauge | null = null;
  private ticketLink: HTMLAnchorElement | null = null;
  remove() {
    this.host?.remove(); this.host = null; this.target = null;
    this.currentText = null; this.resetText = null; this.statusText = null; this.progress = null; this.ticketLink = null; this.gauge = null;
  }
}
