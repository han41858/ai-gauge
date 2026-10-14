import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildVersion } = await import(new URL('../scripts/build-version.mjs', import.meta.url).href) as {
  buildVersion(date?: Date): { version: string; version_name: string }
};

test('build version uses Korea time across the UTC year boundary', () => {
  assert.deepEqual(buildVersion(new Date('2025-12-31T15:05:59.999Z')), {
    version: '2026.1.1.5', version_name: '202601010005'
  });
});

test('midnight has a zero Chrome time component and a padded 0000 display time', () => {
  assert.deepEqual(buildVersion(new Date('2026-03-04T15:00:00Z')), {
    version: '2026.3.5.0', version_name: '202603050000'
  });
});

test('ordinary build minutes retain display padding without invalid Chrome leading zeros', () => {
  assert.deepEqual(buildVersion(new Date('2026-03-05T00:07:42Z')), {
    version: '2026.3.5.907', version_name: '202603050907'
  });
});

test('internal and displayed versions consistently identify the same valid build minute', () => {
  for (const date of ['2026-10-14T08:09:15Z', '2026-02-28T14:59:59Z', '2028-02-28T15:01:00Z', '9999-12-31T14:59:00Z']) {
    const result = buildVersion(new Date(date));
    assert.match(result.version_name, /^\d{12}$/);
    assert.match(result.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    const parts = result.version.split('.').map(Number);
    assert(parts.every(part => Number.isInteger(part) && part >= 0 && part <= 65535));
    const stamp = result.version_name;
    assert.deepEqual(parts, [stamp.slice(0, 4), stamp.slice(4, 6), stamp.slice(6, 8), stamp.slice(8, 12)].map(Number));
  }
});

test('build timestamps change at the minute boundary rather than on elapsed seconds', () => {
  const start = buildVersion(new Date('2026-10-14T08:09:00Z'));
  assert.deepEqual(start, buildVersion(new Date('2026-10-14T08:09:59.999Z')));
  const next = buildVersion(new Date('2026-10-14T08:10:00Z'));
  assert.equal(start.version_name, '202610141709');
  assert.equal(next.version_name, '202610141710');
});

test('invalid dates and non-four-digit build years are rejected', () => {
  assert.throws(() => buildVersion(new Date(Number.NaN)), /Invalid build date/);
  assert.throws(() => buildVersion(new Date('0999-06-01T00:00:00Z')), /four digits/);
  assert.throws(() => buildVersion(new Date('+010000-06-01T00:00:00Z')), /four digits/);
});
