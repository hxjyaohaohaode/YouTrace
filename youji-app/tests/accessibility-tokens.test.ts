import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// W3C WCAG 2.2 SC 1.4.3. This checks neutral tokens, not whole-page conformance.
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
function luminance(hex: string) {
  const rgb = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}
const css = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
for (const [index, block] of css.split('[data-theme="dark"]').entries()) {
  test(`${index === 0 ? 'light' : 'dark'} neutral text stays readable on all neutral surfaces`, () => {
    const tokens = new Map([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/gi)].map((m) => [m[1], m[2]]));
    for (const fg of ['--text-1', '--text-2', '--text-3', '--text-4', '--text-primary', '--text-secondary', '--text-tertiary', '--text-muted']) {
      for (const bg of ['--bg', '--surface', '--surface-hover', '--surface-2']) {
        assert.ok(contrast(tokens.get(fg)!, tokens.get(bg)!) >= 4.5, `${fg} on ${bg}`);
      }
    }
  });
}

test('diagnostics remain bounded, copy-safe and never accept arbitrary areas or payload fields', async () => {
  const { clearDiagnostics, recordDiagnostic, diagnosticSnapshot } = await import('../src/services/diagnostics.ts');
  clearDiagnostics();
  for (let i = 0; i < 150; i++) recordDiagnostic('button', 'synthetic private input', -1, 999);
  const records = diagnosticSnapshot();
  assert.equal(records.length, 120);
  assert.ok(records.every((item) => item.area === 'unknown' && item.elapsedMs === 0 && !('status' in item)));
  assert.ok(records.every((item) => Object.keys(item).every((key) => ['kind', 'area', 'elapsedMs', 'status', 'at'].includes(key))));
  records[0].area = 'mutated copy';
  assert.equal(diagnosticSnapshot()[0].area, 'unknown');
  clearDiagnostics();
});
