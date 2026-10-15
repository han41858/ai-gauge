import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { UsageGauge, USAGE_GAUGE_CSS } from '../src/content/usage-gauge';

const thresholds = { warning: 70, danger: 90 };
const needle = (gauge: UsageGauge) => gauge.element.querySelector<SVGGElement>('.gauge-needle')!;
const arc = (gauge: UsageGauge) => gauge.element.querySelector('.gauge-arc')!;

test('the decorative 20px SVG places only the orange needle at 0, 50 and 100 percent', () => {
  const dom = new JSDOM();
  try {
    for (const [value, angle] of [[0, -90], [50, 0], [100, 90]] as const) {
      const gauge = new UsageGauge(dom.window.document, value, thresholds);
      assert.equal(gauge.element.namespaceURI, 'http://www.w3.org/2000/svg');
      assert.equal(gauge.element.getAttribute('viewBox'), '0 0 64 64');
      assert.equal(gauge.element.getAttribute('width'), '20');
      assert.equal(gauge.element.getAttribute('height'), '20');
      assert.equal(gauge.element.getAttribute('aria-hidden'), 'true');
      assert.equal(gauge.element.getAttribute('focusable'), 'false');
      assert.equal(gauge.element.getAttribute('data-usage-state'), 'known');
      assert.equal(needle(gauge).style.transform, `rotate(${angle}deg)`);
      assert.equal(needle(gauge).style.transition, 'none', 'the initial value does not sweep from an invented angle');
      assert.equal(needle(gauge).getAttribute('visibility'), 'visible');
      assert.equal(needle(gauge).children.length, 1);
      assert.equal(needle(gauge).querySelector('path')?.getAttribute('d'), 'M27.5 46 L32 13 L36.5 46 Z');
      assert.equal(needle(gauge).querySelector('circle'), null, 'the blue hub does not rotate');
      assert.equal(gauge.element.querySelector('circle[r="5.5"]')?.getAttribute('fill'), '#0D4D9F');
      assert.equal(gauge.element.querySelector('[stop-color="#FF8A14"]')?.tagName, 'stop');
    }
  } finally { dom.window.close(); }
});

test('arc color uses exact default and custom warning/danger boundaries', () => {
  const dom = new JSDOM();
  try {
    const gauge = new UsageGauge(dom.window.document, 0, thresholds);
    for (const [value, expected] of [[0, '#2DE5F4'], [69.999, '#2DE5F4'], [70, '#FFAE32'], [89.999, '#FFAE32'], [90, '#FF454E'], [100, '#FF454E']] as const) {
      gauge.update(value, thresholds);
      assert.equal(arc(gauge).getAttribute('stroke'), expected);
    }
    for (const [value, expected] of [[19.999, '#2DE5F4'], [20, '#FFAE32'], [59.999, '#FFAE32'], [60, '#FF454E']] as const) {
      gauge.update(value, { warning: 20, danger: 60 });
      assert.equal(arc(gauge).getAttribute('stroke'), expected);
    }
  } finally { dom.window.close(); }
});

test('invalid and missing percentages stay neutral rather than becoming zero or a clamped angle', () => {
  const dom = new JSDOM();
  try {
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 101]) {
      const gauge = new UsageGauge(dom.window.document, value, thresholds);
      assert.equal(gauge.element.getAttribute('data-usage-state'), 'unknown');
      assert.equal(arc(gauge).getAttribute('stroke'), '#8893A0');
      assert.equal(needle(gauge).getAttribute('visibility'), 'hidden');
      assert.equal(needle(gauge).style.transform, '', 'unknown data has no fabricated initial angle');
    }
  } finally { dom.window.close(); }
});

test('unknown-to-known changes snap while later real percentage changes enable the CSS transition', () => {
  const dom = new JSDOM();
  try {
    const gauge = new UsageGauge(dom.window.document, null, thresholds);
    gauge.update(100, thresholds);
    assert.equal(needle(gauge).getAttribute('visibility'), 'visible');
    assert.equal(needle(gauge).style.transform, 'rotate(90deg)');
    assert.equal(needle(gauge).style.transition, 'none');
    gauge.update(50, thresholds);
    assert.equal(needle(gauge).style.transform, 'rotate(0deg)');
    assert.equal(needle(gauge).style.transition, '', 'known changes use the stylesheet transition');
    gauge.update(null, thresholds);
    assert.equal(needle(gauge).getAttribute('visibility'), 'hidden');
    assert.equal(needle(gauge).style.transition, 'none');
    gauge.update(0, thresholds);
    assert.equal(needle(gauge).style.transform, 'rotate(-90deg)');
    assert.equal(needle(gauge).style.transition, 'none', 'a stale hidden angle never becomes a fake starting usage');
  } finally { dom.window.close(); }
});

test('same values do not mutate SVG nodes and threshold changes only recolor the existing arc', () => {
  const dom = new JSDOM();
  try {
    const gauge = new UsageGauge(dom.window.document, 68, thresholds);
    dom.window.document.body.append(gauge.element);
    const beforeNeedle = needle(gauge), beforeArc = arc(gauge);
    const observer = new dom.window.MutationObserver(() => undefined);
    observer.observe(gauge.element, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 20; i++) gauge.update(68, thresholds);
    assert.equal(observer.takeRecords().length, 0);
    gauge.update(68, { warning: 60, danger: 65 });
    const records = observer.takeRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0]!.target, beforeArc);
    assert.equal(records[0]!.attributeName, 'stroke');
    assert.equal(arc(gauge).getAttribute('stroke'), '#FF454E');
    gauge.update(68.25, thresholds);
    assert.equal(needle(gauge), beforeNeedle);
    assert.equal(arc(gauge), beforeArc);
    assert.equal(gauge.element.querySelectorAll('.gauge-needle').length, 1);
    assert.equal(needle(gauge).style.transform, `rotate(${-90 + 68.25 * 1.8}deg)`);
    observer.takeRecords();
    gauge.update(68.25, thresholds);
    assert.equal(observer.takeRecords().length, 0);
    observer.disconnect();
  } finally { dom.window.close(); }
});

test('multiple components keep gradient references local without images or external resources', () => {
  const dom = new JSDOM();
  try {
    const components = [new UsageGauge(dom.window.document, 0, thresholds), new UsageGauge(dom.window.document, 100, thresholds)];
    dom.window.document.body.append(...components.map(gauge => gauge.element));
    const ids = [...dom.window.document.querySelectorAll('[id]')].map(node => node.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const gauge of components) {
      for (const shape of gauge.element.querySelectorAll('[fill^="url("]')) {
        const id = shape.getAttribute('fill')!.slice(5, -1);
        assert(gauge.element.querySelector(`[id="${id}"]`));
      }
      assert.equal(gauge.element.querySelector('image,script,[href],title,[role="img"]'), null);
    }
    assert.match(USAGE_GAUGE_CSS, /\.usage-gauge\{[^}]*width:20px[^}]*height:20px[^}]*overflow:visible/);
    assert.match(USAGE_GAUGE_CSS, /\.gauge-needle\{[^}]*transform-box:view-box[^}]*transform-origin:32px 46px[^}]*transition:transform 500ms/);
    assert.match(USAGE_GAUGE_CSS, /\.gauge-arc\{transition:stroke 300ms/);
    assert.match(USAGE_GAUGE_CSS, /@media \(prefers-reduced-motion:reduce\)\{\.gauge-needle,\.gauge-arc\{transition:none\}\}/);
  } finally { dom.window.close(); }
});
