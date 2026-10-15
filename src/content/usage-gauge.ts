import type { Settings } from '../shared/types';
import { percent as validPercent } from '../shared/validation';
import backgroundSource from '../../assets/gauge-background.svg';
import needleSource from '../../assets/gauge-needle.svg';

type Thresholds = Pick<Settings, 'warning' | 'danger'>;
const SVG_NS = 'http://www.w3.org/2000/svg';
let nextId = 0;

export const USAGE_GAUGE_CSS = `
.usage-gauge{display:block;width:20px;height:20px;flex:0 0 20px;overflow:visible}
.gauge-needle{transform-box:view-box;transform-origin:32px 46px;transition:transform 500ms ease}
.gauge-arc{transition:stroke 300ms ease}
@media (prefers-reduced-motion:reduce){.gauge-needle,.gauge-arc{transition:none}}`;

// The bundled asset files are the single source of the gauge artwork. They are
// parsed as XML (never as HTML) and only their element nodes are copied.
function assetElements(doc: Document, source: string): Element[] {
  const Parser = doc.defaultView?.DOMParser ?? globalThis.DOMParser;
  const root = new Parser().parseFromString(source, 'image/svg+xml').documentElement;
  if (root.namespaceURI !== SVG_NS || root.localName !== 'svg') throw new Error('invalid_gauge_asset');
  return [...root.children].map(child => doc.importNode(child, true));
}

export class UsageGauge {
  readonly element: SVGSVGElement;
  private readonly needle: SVGGElement;
  private readonly arc: SVGPathElement;
  private value: number | null | undefined;

  constructor(doc: Document, value: number | null, thresholds: Thresholds) {
    this.element = doc.createElementNS(SVG_NS, 'svg');
    for (const [name, attribute] of Object.entries({ viewBox: '0 0 64 64', width: '20', height: '20', fill: 'none',
      class: 'usage-gauge brand-icon', 'aria-hidden': 'true', focusable: 'false' })) this.element.setAttribute(name, attribute);
    this.element.append(...assetElements(doc, backgroundSource), ...assetElements(doc, needleSource));
    // Asset IDs are local names; prefix them so several gauges in one tree never share gradients.
    const prefix = `ai-gauge-${++nextId}-`;
    for (const node of this.element.querySelectorAll('[id]')) {
      const id = node.id;
      node.id = prefix + id;
      for (const shape of this.element.querySelectorAll('[fill],[stroke]')) {
        for (const attribute of ['fill', 'stroke']) {
          const current = shape.getAttribute(attribute);
          if (current?.includes(`url(#${id})`)) shape.setAttribute(attribute, current.replace(`url(#${id})`, `url(#${prefix}${id})`));
        }
      }
    }
    const arc = [...this.element.querySelectorAll<SVGPathElement>('path[stroke]')].find(path => path.getAttribute('stroke')!.includes('--gauge-color'));
    const needle = this.element.querySelector<SVGGElement>(`g[id="${prefix}needle-rotor"]`);
    if (!arc || !needle) throw new Error('invalid_gauge_asset');
    arc.classList.add('gauge-arc');
    needle.classList.add('gauge-needle');
    this.arc = arc; this.needle = needle;
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
