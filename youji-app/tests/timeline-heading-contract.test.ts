import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { timelineHeadingFailures } from '../scripts/timeline-heading-contract.mjs';

// Pure oracle regression tests. Only the native e2e measurement proves real layout.
function fixture() {
  return {
    count: 1, text: '写一条速记 →', href: '/quick-note', viewport: { width: 360, height: 900 },
    bounds: { left: 240, right: 340, top: 20, bottom: 64, width: 100, height: 44 },
    heading: { left: 20, right: 340, top: 20, bottom: 140, width: 320, height: 120 },
    copy: { left: 20, right: 224, top: 20, bottom: 140, width: 204, height: 120 },
    lines: [{ left: 240, right: 340, top: 32, bottom: 52, height: 20 }],
    styles: [{ display: 'inline-flex', visibility: 'visible', opacity: '1' }], hit: true,
  };
}
test('one rendered action line alongside wrapped heading copy passes', () => {
  assert.deepEqual(timelineHeadingFailures(fixture()), []);
});
test('isolated arrow line fails although document width and link bounds fit', () => {
  const sample = fixture();
  sample.lines.push({ left: 240, right: 252, top: 54, bottom: 74, height: 20 });
  assert.ok(timelineHeadingFailures(sample).includes('capture label and arrow must share one text line'));
});
test('zero text, clipped text, overlapping copy and offscreen targets fail', () => {
  const empty = fixture(); empty.lines = [];
  const clipped = fixture(); clipped.lines[0].right = 341;
  const overlap = fixture(); overlap.copy.right = 241;
  const offscreen = fixture(); offscreen.bounds.right = 361;
  for (const sample of [empty, clipped, overlap, offscreen]) assert.ok(timelineHeadingFailures(sample).length);
});
test('hidden, transparent, covered, undersized and nonfinite targets fail', () => {
  const hidden = fixture(); hidden.styles[0].visibility = 'hidden';
  const transparent = fixture(); transparent.styles[0].opacity = '0';
  const covered = fixture(); covered.hit = false;
  const tiny = fixture(); tiny.bounds.height = 43;
  const invalid = fixture(); invalid.bounds.left = NaN;
  for (const sample of [hidden, transparent, covered, tiny, invalid]) assert.ok(timelineHeadingFailures(sample).length);
});
test('missing, duplicate or changed action cannot satisfy geometry alone', () => {
  for (const patch of [{ count: 0 }, { count: 2 }, { text: '写一条速记' }, { href: '/todo' }]) {
    assert.ok(timelineHeadingFailures({ ...fixture(), ...patch }).length);
  }
  assert.ok(timelineHeadingFailures({ count: 0 }).length);
});
test('native existing responsive loop records measured heading at every viewport', () => {
  const code = readFileSync(new URL('../scripts/e2e-recovery.mjs', import.meta.url), 'utf8');
  assert.match(code, /for \(const width of \[360, 768, 1280\]\)/);
  assert.match(code, /page\.evaluate\(sampleTimelineHeading\)/);
  assert.match(code, /const failures = timelineHeadingFailures\(geometry\)/);
  assert.match(code, /assert\.deepEqual\(failures, \[\], `Timeline heading/);
});
