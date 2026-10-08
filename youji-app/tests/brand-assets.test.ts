import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const text = (path: string) => read(path).toString('utf8');

test('brand slots consume the exact original user artwork without redraws', () => {
  const wordmark = read('../../logo.txt');
  const mark = read('../../纯logo.txt');
  assert.equal(createHash('sha256').update(wordmark).digest('hex'), '1392864aca6c6b66dae4207081e61eaadeb254650fa2d6a5b16ee4889427390d');
  assert.equal(createHash('sha256').update(mark).digest('hex'), '7250f7734b95d02da53ffc3485bf1038d88c0a9ddb40dd4a52cde5fda3bce522');
  assert.deepEqual(read('../public/brand/youtrace-wordmark.svg'), wordmark);
  assert.deepEqual(read('../public/brand/youtrace-mark.svg'), mark);
  assert.deepEqual(read('../public/favicon.svg'), mark);
  const component = text('../src/components/ui/Brand.tsx');
  assert.match(component, /\/brand\/youtrace-wordmark\.svg/);
  assert.match(component, /\/brand\/youtrace-mark\.svg/);
  assert.match(component, /youtrace-wordmark\.svg\?raw/);
  assert.doesNotMatch(component, /<circle|<path|<text|Sparkles|filter:/);
  for (const file of ['DesktopSidebar', 'TabletSidebar']) {
    assert.match(text(`../src/components/layout/${file}.tsx`), /<Brand/);
  }
  assert.match(text('../src/pages/Login.tsx'), /<Brand variant="full"/);
  assert.match(text('../src/components/ui/SplashScreen.tsx'), /<Brand variant="full" animated/);
});

test('entry artwork keeps timing and session/reduced-motion bypasses', () => {
  const splash = text('../src/components/ui/SplashScreen.tsx');
  assert.match(splash, /youji_splash_shown/);
  assert.match(splash, /prefers-reduced-motion: reduce/);
  assert.match(splash, /elapsed >= 1800/);
  assert.doesNotMatch(splash, /setAttribute\('fill'|<svg|<circle|<text/);
});
