import { selectedLimit } from '../background/badge';
import { type PageProvider, type View } from '../shared/types';
import { displayProvider, shouldShowStrip } from '../shared/display-policy';
import { usageParts } from './usage-label';
import { findComposerTarget, type ComposerTarget } from './selectors';
import { effectiveSnapshot } from '../storage/snapshots';
import { ICON_DATA_URL } from '../shared/icon';
export class UsageStrip {
  private host: HTMLElement | null = null;
  private view: View | null = null;
  private target: ComposerTarget | null = null;
  private footerLayout: { element: HTMLElement; value: string; priority: string; appliedPriority: string; owned: boolean } | null = null;
  constructor(private provider: PageProvider, private doc: Document) {}
  update(view: View) { this.view = view; this.mount(); }
  mount() {
    const view = this.view, p = this.provider;
    if (!view || !shouldShowStrip(view, p)) { this.remove(); return; }
    // A second unpacked installation has a separate isolated world. Yield to its
    // connected strip instead of moving two identically named nodes endlessly.
    if ([...this.doc.querySelectorAll('#ai-gauge-usage-strip')].some(node => node !== this.host)) { this.remove(); return; }
    const next = findComposerTarget(this.doc, p);
    if (next) this.target = next;
    // A temporary mirror editor or disabled input during streaming must not
    // destroy a known composer. Actual removal/hiding and route changes still do.
    else if (!this.target || !this.target.anchor.isConnected || this.hidden(this.target.anchor)
      || (this.target.input && (!this.target.input.isConnected || this.hidden(this.target.input)
        || (this.target.placement !== 'append' && !this.target.anchor.contains(this.target.input))))) { this.remove(); return; }
    const anchor = this.target!.anchor;
    if (!this.host) {
      this.host = this.doc.createElement('div');
      this.host.id = 'ai-gauge-usage-strip';
      this.host.dataset.aiGaugeOwned = 'usage-strip';
      const root = this.host.attachShadow({ mode: 'closed' });
      const style = this.doc.createElement('style');
      style.textContent = `
:host{display:block;position:static;box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:30px;flex:0 0 auto;align-self:stretch;grid-column:1/-1;margin:0;border:0;background:transparent;font:12px/1.5 system-ui;color:inherit;container:ai-gauge/inline-size}
.usage{display:flex;align-items:center;gap:14px;box-sizing:border-box;height:30px;padding:0 10px;border:0;background:transparent;overflow:hidden}
.current{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0;max-width:100%;overflow:hidden}
.current>span,.reset,.status{color:inherit;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.reset,.status{min-width:0;max-width:100%}
.usage:has(.status:not([hidden])) .reset{display:none}
progress{appearance:none;-webkit-appearance:none;width:80px;max-width:100%;height:6px;flex:0 0 80px;box-sizing:border-box;border:0;border-radius:999px;overflow:hidden;background:#8893a033;color:inherit;accent-color:currentColor}
progress::-webkit-progress-bar{background:#8893a033;border-radius:999px}
progress::-webkit-progress-value{background:currentColor;border-radius:999px}
progress::-moz-progress-bar{background:currentColor;border-radius:999px}
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
      this.progress.setAttribute('aria-label', '사용량');
      current.append(this.currentText, this.progress);
      if (ICON_DATA_URL) {
        const icon = this.doc.createElement('img');
        icon.src = ICON_DATA_URL; icon.alt = ''; icon.width = 20; icon.height = 20;
        icon.draggable = false; icon.className = 'brand-icon';
        icon.style.cssText = 'width:20px;height:20px;flex:0 0 20px;object-fit:contain';
        icon.setAttribute('aria-hidden', 'true');
        current.prepend(icon);
      }
      this.resetText = this.doc.createElement('span'); this.resetText.className = 'reset';
      this.statusText = this.doc.createElement('span'); this.statusText.className = 'status'; this.statusText.hidden = true;
      row.append(current, this.resetText, this.statusText);
      root.append(style, row);
    }
    this.prepareFooterLayout(this.target!);
    if (this.target!.placement === 'append') {
      if (anchor.lastChild !== this.host) anchor.append(this.host);
    } else if (anchor.nextElementSibling !== this.host) anchor.after(this.host);
    const snapshot = effectiveSnapshot(view.snapshots[displayProvider(p)]), limit = selectedLimit(snapshot, view.settings) ?? snapshot.limits[0];
    const parts = usageParts(snapshot, limit);
    if (this.currentText!.textContent !== parts.current) this.currentText!.textContent = parts.current;
    if (this.resetText!.textContent !== parts.reset) this.resetText!.textContent = parts.reset;
    const status = parts.status ?? '';
    if (this.statusText!.textContent !== status) this.statusText!.textContent = status;
    if (this.statusText!.hidden !== (parts.status === null)) this.statusText!.hidden = parts.status === null;
    if (this.progress!.hidden !== (parts.percent === null)) this.progress!.hidden = parts.percent === null;
    if (parts.percent === null) {
      if (this.progress!.hasAttribute('value')) this.progress!.removeAttribute('value');
    } else if (this.progress!.getAttribute('value') !== String(parts.percent)) this.progress!.setAttribute('value', String(parts.percent));
    if (this.host.getAttribute('aria-label') !== parts.label) this.host.setAttribute('aria-label', parts.label);
  }
  private prepareFooterLayout(target: ComposerTarget) {
    const style = this.doc.defaultView?.getComputedStyle(target.anchor);
    const row = this.provider === 'codex' && target.placement === 'append'
      && (style?.display === 'flex' || style?.display === 'inline-flex')
      && !style.flexDirection.startsWith('column');
    if (this.footerLayout && (this.footerLayout.element !== target.anchor || !row)) this.restoreFooterLayout();
    const basis = row ? '100%' : '';
    if (this.host!.style.flexBasis !== basis) {
      if (basis) this.host!.style.setProperty('flex-basis', basis);
      else this.host!.style.removeProperty('flex-basis');
    }
    if (!row) return;
    const inline = target.anchor.style;
    if (this.footerLayout) {
      // A later site change owns the property again. Do not fight it on every
      // mutation callback or overwrite its new value when removing the strip.
      if (inline.getPropertyValue('flex-wrap') !== 'wrap'
        || inline.getPropertyPriority('flex-wrap') !== this.footerLayout.appliedPriority) this.footerLayout.owned = false;
      return;
    }
    if (style.flexWrap && style.flexWrap !== 'nowrap') return;
    const value = inline.getPropertyValue('flex-wrap'), priority = inline.getPropertyPriority('flex-wrap');
    inline.setProperty('flex-wrap', 'wrap', priority);
    if (this.doc.defaultView?.getComputedStyle(target.anchor).flexWrap !== 'wrap') inline.setProperty('flex-wrap', 'wrap', 'important');
    this.footerLayout = { element: target.anchor, value, priority, appliedPriority: inline.getPropertyPriority('flex-wrap'), owned: true };
  }
  private restoreFooterLayout() {
    const previous = this.footerLayout;
    if (!previous) return;
    const inline = previous.element.style;
    if (previous.owned && inline.getPropertyValue('flex-wrap') === 'wrap'
      && inline.getPropertyPriority('flex-wrap') === previous.appliedPriority) {
      if (previous.value) inline.setProperty('flex-wrap', previous.value, previous.priority);
      else inline.removeProperty('flex-wrap');
    }
    this.footerLayout = null;
  }
  private hidden(input: HTMLElement): boolean {
    if (input.closest('[hidden],[inert],[aria-hidden="true"]')) return true;
    for (let node: HTMLElement | null = input; node; node = node.parentElement) {
      const style = this.doc.defaultView?.getComputedStyle(node);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return true;
    }
    return false;
  }
  private currentText: HTMLElement | null = null;
  private resetText: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private progress: HTMLProgressElement | null = null;
  remove() {
    this.restoreFooterLayout(); this.host?.remove(); this.host = null; this.target = null;
    this.currentText = null; this.resetText = null; this.statusText = null; this.progress = null;
  }
}
