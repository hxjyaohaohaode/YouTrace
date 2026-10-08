import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timelineRange, timelineRangeIncludes } from '../src/pages/timelineRange';
import { isStaticPageEntry, staticPageEntry } from '../src/lib/navigation';

test('Only the exact static Timeline entry retains heading intent through range normalization', () => {
  const original = staticPageEntry('/timeline', 'owner-a');
  const normalized = { ...original, timelineRangeNormalized: true };
  assert.equal(isStaticPageEntry(original, 'owner-a', '/timeline', 'REPLACE'), false);
  assert.equal(isStaticPageEntry(normalized, 'owner-a', '/timeline', 'REPLACE'), true);
  assert.equal(isStaticPageEntry(normalized, 'owner-a', '/timeline', 'POP'), false);
  assert.equal(isStaticPageEntry(normalized, 'owner-b', '/timeline', 'REPLACE'), false);
  assert.equal(isStaticPageEntry(normalized, 'owner-a', '/expense', 'REPLACE'), false);
  assert.equal(isStaticPageEntry({ ...staticPageEntry('/expense', 'owner-a'), timelineRangeNormalized: true }, 'owner-a', '/expense', 'REPLACE'), false);
  assert.equal(isStaticPageEntry(null, 'owner-a', '/timeline', 'REPLACE'), false, 'Pagination with no static-entry state cannot claim heading focus');
});

test('A near-30-day URL freezes both inclusive boundaries across a later business day', () => {
  const selected = timelineRange('?range=30', '2026-10-07');
  assert.equal(selected.from, '2026-09-08');
  assert.equal(selected.through, '2026-10-07');
  const returned = timelineRange(selected.search, '2026-10-08');
  assert.deepEqual(returned, selected);
  for (const date of ['2026-09-08', '2026-10-06', '2026-10-07', null]) assert.equal(timelineRangeIncludes(date, returned), true);
  for (const date of ['2026-09-07', '2026-10-08']) assert.equal(timelineRangeIncludes(date, returned), false);
});

test('Explicitly choosing today creates a new interval; the old history URL remains unchanged', () => {
  const old = timelineRange('?range=7', '2026-12-31');
  const today = timelineRange('?range=7', '2027-01-01');
  assert.equal(today.from, '2026-12-26');
  assert.equal(today.through, '2027-01-01');
  assert.deepEqual(timelineRange(old.search, '2027-01-01'), old);
  assert.equal(timelineRangeIncludes('2026-12-25', old), true);
  assert.equal(timelineRangeIncludes('2026-12-25', today), false);
});

test('Invalid or inconsistent intervals normalize as a pair, retaining record and pagination', () => {
  for (const query of [
    'from=2026-02-30&through=2026-03-06',
    'from=2026-10-07&through=2026-10-01',
    'from=2026-09-30&through=2026-10-07',
    'from=2026-10-01', 'through=not-a-date',
  ]) {
    const scope = timelineRange(`?range=7&limit=120&record=synthetic-note&${query}`, '2026-10-08');
    assert.equal(scope.from, '2026-10-02');
    assert.equal(scope.through, '2026-10-08');
    const params = new URLSearchParams(scope.search);
    assert.equal(params.get('limit'), '120');
    assert.equal(params.get('record'), 'synthetic-note');
  }
});

test('Calendar dates use Shanghai date arithmetic including leap days, and all remains unbounded', () => {
  const leap = timelineRange('?range=7', '2028-03-01');
  assert.equal(leap.from, '2028-02-24');
  assert.equal(timelineRangeIncludes('2028-02-29', leap), true);
  const all = timelineRange('?range=all&from=bad&through=bad&limit=120', '2026-10-07');
  assert.equal(all.from, null); assert.equal(all.through, null);
  assert.equal(new URLSearchParams(all.search).has('from'), false);
  assert.equal(timelineRangeIncludes('2027-01-01', all), true);
  assert.equal(timelineRange('?range=unknown', '2026-10-07').range, '7');
});
