import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGemini } from '../src/providers/gemini-parser';

const observed = () => JSON.parse(readFileSync(new URL('./fixtures/gemini-observed.json', import.meta.url), 'utf8')) as unknown[];
const payload = (ratio: unknown = 0.15, reset: unknown = [[1791983127, 343263000]], type: unknown = 1): unknown[] =>
  [1, [[600, ratio, type, reset]], false];

test('Gemini preserves the exact user-observed jSf9Qc fixture and real zero usage', () => {
  const input = observed(), before = JSON.stringify(input);
  assert.equal(before, '[1,[[12096,0,2,[[1792472727,343404000]]],[600,0,1,[[1791983127,343263000]]]],false,[[true]]]');
  const limits = parseGemini(input);
  assert.deepEqual(limits.map(value => [value.id, value.percent, value.windowSeconds]), [['seven_day', 0, 604800], ['five_hour', 0, 18000]]);
  assert.equal(limits[0]!.resetsAt, new Date(1792472727343).toISOString());
  assert.equal(limits[1]!.resetsAt, new Date(1791983127343).toISOString());
  assert(limits.every(value => value.remaining === null && value.unit === null && value.source === 'api'));
  assert.equal(JSON.stringify(input), before);
});

test('Gemini converts only the reported 0–1 ratio without rounding, remaining inference or extra windows', () => {
  for (const ratio of [0, 0.00123, 0.15, 1]) {
    const limits = parseGemini(payload(ratio));
    assert.equal(limits.length, 1); assert.equal(limits[0]!.percent, ratio * 100);
    assert.equal(limits[0]!.remaining, null); assert.equal(limits[0]!.unit, null);
  }
  const unknown = parseGemini(payload(null, null))[0]!;
  assert.equal(unknown.percent, null); assert.equal(unknown.resetsAt, null);
  assert.deepEqual(unknown, { id: 'five_hour', label: '5시간', category: 'window', percent: null, resetsAt: null,
    windowSeconds: 18000, remaining: null, unit: null, source: 'api' }, 'a known window with unavailable values must not become zero or a remaining count');
});

test('Gemini rejects nonnumeric, nonfinite and out-of-range utilization ratios', () => {
  for (const ratio of ['0', true, -0.01, 1.01, Infinity, -Infinity, NaN, {}]) assert.throws(() => parseGemini(payload(ratio)), /invalid_response/);
});

test('Gemini timestamps use Unix seconds and optional nanoseconds independently of local timezone', () => {
  assert.equal(parseGemini(payload(0.25, [[1791983127]]))[0]!.resetsAt, '2026-10-14T13:05:27.000Z');
  assert.equal(parseGemini(payload(0.25, [[1791983127, 999999999]]))[0]!.resetsAt, '2026-10-14T13:05:27.999Z');
  assert.equal(parseGemini(payload(0.25, [[1791936000, 0]]))[0]!.resetsAt, '2026-10-14T00:00:00.000Z');
});

test('Gemini rejects malformed or invalid reset times instead of guessing seconds, milliseconds or timezone', () => {
  for (const reset of [[], [[]], [[0]], [[-1]], [[1791983127.1]], [[1791983127000]], [[Infinity]], [['1791983127']],
    [[1791983127, -1]], [[1791983127, 1e9]], [[1791983127, 0.5]], [[1791983127, null]], [[1791983127, '0']],
    [[1791983127, 0, 0]], [[1791983127], [1791983128]], [1791983127], '2026-10-14T12:05:27']) {
    assert.throws(() => parseGemini(payload(0, reset)), /invalid_response/);
  }
});

test('Gemini rejects duplicate known windows and malformed or empty payloads; unknown windows are not invented', () => {
  const duplicate = payload(); (duplicate[1] as unknown[]).push([700, 0.8, 1, null]);
  assert.throws(() => parseGemini(duplicate), /invalid_response/);
  for (const value of [null, {}, [], [1], [1, []], [1, [null]], payload(0, null, '1'), payload(0, null, 3)]) {
    assert.throws(() => parseGemini(value), /invalid_response/);
  }
  const mixed = payload(); (mixed[1] as unknown[]).push(['unknown', 0.9, 3, 'unrecognized']);
  assert.equal(parseGemini(mixed).length, 1);
});
