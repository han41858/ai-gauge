import type { Settings } from '../shared/types';
import { percent as validPercent } from '../shared/validation';

type Thresholds = Pick<Settings, 'warning' | 'danger'>;
const SVG_NS = 'http://www.w3.org/2000/svg';
let nextId = 0;

export const USAGE_GAUGE_CSS = `
.usage-gauge{display:block;width:20px;height:20px;flex:0 0 20px;overflow:visible}
.gauge-needle{transform-box:view-box;transform-origin:32px 46px;transition:transform 500ms ease}
.gauge-arc{transition:stroke 300ms ease}
@media (prefers-reduced-motion:reduce){.gauge-needle,.gauge-arc{transition:none}}`;

export class UsageGauge {
  readonly element: SVGSVGElement;
  private readonly needle: SVGGElement;
  private readonly arc: SVGPathElement;
  private value: number | null | undefined;

  constructor(doc: Document, value: number | null, thresholds: Thresholds) {
    const node = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) => {
      const element = doc.createElementNS(SVG_NS, tag);
      for (const [name, attribute] of Object.entries(attributes)) element.setAttribute(name, attribute);
      return element;
    };
    const id = `ai-gauge-${++nextId}`;
    this.element = node('svg', {
      viewBox: '0 0 64 64', width: '20', height: '20', fill: 'none',
      class: 'usage-gauge brand-icon', 'aria-hidden': 'true', focusable: 'false'
    });
    // Keep the shapes and orange/blue finishes of the supplied gauge SVGs.
    const defs = node('defs', {});
    const hub = node('linearGradient', { id: `${id}-hub`, x1: '26', y1: '42', x2: '39', y2: '57', gradientUnits: 'userSpaceOnUse' });
    hub.append(node('stop', { 'stop-color': '#80F7FF' }), node('stop', { offset: '0.45', 'stop-color': '#1970D0' }), node('stop', { offset: '1', 'stop-color': '#07275B' }));
    const needleGradient = node('linearGradient', { id: `${id}-needle`, x1: '27', y1: '46', x2: '37', y2: '13', gradientUnits: 'userSpaceOnUse' });
    needleGradient.append(node('stop', { 'stop-color': '#FF8A14' }), node('stop', { offset: '.55', 'stop-color': '#FFAD20' }), node('stop', { offset: '1', 'stop-color': '#FFE483' }));
    defs.append(hub, needleGradient);
    const arc = { d: 'M8 46 A24 24 0 0 1 56 46', 'stroke-linecap': 'round' };
    this.arc = node('path', { ...arc, class: 'gauge-arc', 'stroke-width': '8' });
    this.needle = node('g', { class: 'gauge-needle' });
    this.needle.append(node('path', { d: 'M27.5 46 L32 13 L36.5 46 Z', fill: `url(#${id}-needle)`, stroke: '#FFB528', 'stroke-width': '.6', 'stroke-linejoin': 'round' }));
    this.element.append(
      defs,
      node('path', { ...arc, stroke: '#073D85', 'stroke-width': '10', opacity: '.45' }),
      this.arc,
      node('path', { ...arc, stroke: 'white', 'stroke-width': '1.2', opacity: '.34' }),
      node('circle', { cx: '32', cy: '46', r: '7', fill: '#06377E', stroke: '#3CAFFD', 'stroke-width': '1.5' }),
      node('circle', { cx: '32', cy: '46', r: '5', fill: `url(#${id}-hub)` }),
      this.needle,
      node('circle', { cx: '32', cy: '46', r: '5.5', fill: '#0D4D9F', stroke: '#72E9FF', 'stroke-width': '1.5' }),
      node('circle', { cx: '30.5', cy: '44.5', r: '2.1', fill: '#A8F9FF', opacity: '.75' })
    );
    this.update(value, thresholds);
  }

  update(value: number | null, thresholds: Thresholds): void {
    const used = validPercent(value);
    const color = used === null ? '#8893A0' : used >= thresholds.danger ? '#FF454E' : used >= thresholds.warning ? '#FFAE32' : '#2DE5F4';
    if (this.arc.getAttribute('stroke') !== color) this.arc.setAttribute('stroke', color);
    if (this.value === used) return;
    // Initial/unknown data has no meaningful starting angle. Snap to the first
    // known value; enable transitions only for subsequent known value changes.
    if (this.value == null || used === null) {
      if (this.needle.style.transition !== 'none') this.needle.style.transition = 'none';
    } else if (this.needle.style.transition) this.needle.style.removeProperty('transition');
    const state = used === null ? 'unknown' : 'known';
    if (this.element.getAttribute('data-usage-state') !== state) this.element.setAttribute('data-usage-state', state);
    const visibility = used === null ? 'hidden' : 'visible';
    if (this.needle.getAttribute('visibility') !== visibility) this.needle.setAttribute('visibility', visibility);
    if (used !== null) {
      const transform = `rotate(${-90 + used * 1.8}deg)`;
      if (this.needle.style.transform !== transform) this.needle.style.transform = transform;
    }
    this.value = used;
  }
}
