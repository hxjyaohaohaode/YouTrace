import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Source: the user's immutable root originals, independently verified before the
// 2026-10-08 reconstruction (checkpoint c7dc1756). Never derive expected hashes
// from the files being checked. Deliberate brand changes require separate review.
export const ORIGINAL_SHA256 = Object.freeze({
  'logo.txt': '1392864aca6c6b66dae4207081e61eaadeb254650fa2d6a5b16ee4889427390d',
  '纯logo.txt': '7250f7734b95d02da53ffc3485bf1038d88c0a9ddb40dd4a52cde5fda3bce522',
});
export const BRAND_FILES = Object.freeze([
  'logo.txt', '纯logo.txt',
  'youji-app/public/brand/youtrace-wordmark.svg', 'youji-app/public/brand/youtrace-mark.svg', 'youji-app/public/favicon.svg',
  'youji-app/index.html', 'youji-app/src/App.tsx', 'youji-app/src/components/ui/Brand.tsx', 'youji-app/src/components/ui/SplashScreen.tsx',
  'youji-app/src/components/layout/DesktopSidebar.tsx', 'youji-app/src/components/layout/TabletSidebar.tsx',
  'youji-app/src/pages/Login.tsx', 'youji-app/src/pages/Onboarding.tsx', 'youji-app/src/pages/Coach.tsx',
  'youji-app/src/styles/global.css', 'youji-app/src/styles/home-coach.css', 'youji-app/src/styles/record-pages.css', 'youji-app/src/styles/tokens.css', 'youji-app/src/components/schedule/planning.css',
]);

export function verifyBrandIntegrity(read, { cssFiles = BRAND_FILES.filter(name => name.endsWith('.css')) } = {}) {
  const text = name => read(name).toString('utf8');
  for (const [name, expected] of Object.entries(ORIGINAL_SHA256)) {
    assert.equal(createHash('sha256').update(read(name)).digest('hex'), expected, `Original artwork changed: ${name}`);
  }
  for (const [original, copy] of [
    ['logo.txt', 'youji-app/public/brand/youtrace-wordmark.svg'],
    ['纯logo.txt', 'youji-app/public/brand/youtrace-mark.svg'],
    ['纯logo.txt', 'youji-app/public/favicon.svg'],
  ]) assert.deepEqual(read(copy), read(original), `Artwork copy differs: ${copy}`);

  const brand = text('youji-app/src/components/ui/Brand.tsx');
  assert.match(brand, /import originalWordmark from ['"]\.\.\/\.\.\/\.\.\/public\/brand\/youtrace-wordmark\.svg\?raw['"]/, 'Animated artwork must import the exact original copy');
  assert.match(brand, /dangerouslySetInnerHTML=\{\{ __html: originalWordmark \}\}/, 'Animated artwork must consume the unmodified original');
  assert.match(brand, /<img src="\/brand\/youtrace-wordmark\.svg"[^>]*width="1160" height="320"/, 'Full artwork must retain its original canvas');
  assert.match(brand, /<img src="\/brand\/youtrace-mark\.svg"[^>]*width="1024" height="1024"/, 'Compact artwork must retain its original canvas');
  assert.doesNotMatch(brand, /<svg|<circle|<path|<text\b|Sparkles|\.replace\(|\.slice\(|\.substring\(|\bstyle=|\bfilter\b|clipPath|object-cover|overflow-hidden/, 'Brand must not redraw, crop, filter or rewrite artwork');
  assert.match(text('youji-app/index.html'), /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/, 'Favicon must consume protected original');

  const consumers = [
    ['components/layout/DesktopSidebar.tsx', '../ui/Brand', /<Brand\s*\/>/],
    ['components/layout/TabletSidebar.tsx', '../ui/Brand', /<Brand variant="mark"/],
    ['pages/Login.tsx', '../components/ui/Brand', /<Brand variant="full"/],
    ['pages/Onboarding.tsx', '../components/ui/Brand', /<Brand variant="full"/],
    ['pages/Coach.tsx', '../components/ui/Brand', /<Brand variant="mark"/],
    ['components/ui/SplashScreen.tsx', './Brand', /<Brand variant="full" animated artworkRef=\{artworkRef\}/],
  ];
  for (const [relative, canonicalImport, use] of consumers) {
    const source = text(`youji-app/src/${relative}`);
    const actualImport = source.match(/import \{ Brand \} from ['"]([^'"]+)['"]/);
    assert.equal(actualImport?.[1], canonicalImport, `Canonical Brand import missing: ${relative}`);
    assert.match(source, use, `Original Brand consumer missing: ${relative}`);
    for (const tag of source.matchAll(/<Brand\b[^>]*\/>/g)) {
      assert.doesNotMatch(tag[0], /\b(?:hidden|invisible|opacity-0|grayscale|invert|hue-rotate|brightness|contrast|object-cover|overflow-hidden|rounded)\b|\bstyle\s*=/, `Brand consumer must not hide or alter original artwork: ${relative}`);
    }
  }
  const app = text('youji-app/src/App.tsx');
  assert.match(app, /import SplashScreen from ['"]\.\/components\/ui\/SplashScreen['"]/, 'App must import protected Splash');
  assert.match(app, /if \(!splashComplete\) return <SplashScreen onComplete=\{\(\) => setSplashComplete\(true\)\}/, 'App must render Splash until completion');
  assert.match(app, /const \[splashComplete, setSplashComplete\] = useState\(false\)/, 'App must not pre-skip first entry');
  const splash = text('youji-app/src/components/ui/SplashScreen.tsx');
  assert.doesNotMatch(splash, /<svg|<circle|<path|<text\b|setAttribute\(['"](?:fill|stroke|viewBox)/, 'Entry animation must operate on original artwork, not redraw/recolor it');
  for (const css of cssFiles) {
    const source = text(css);
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1];
      const targetsSvg = /(?:^|[\s,>+~])(?:svg|circle|text|path|g|stop|rect|line|ellipse|polygon|polyline|defs)(?=[\s,>+~.#[:]|$)/i.test(selector);
      const targetsBrand = /(?:brand|wordmark)/i.test(selector);
      if (targetsSvg) {
        assert.doesNotMatch(rule[2], /(?:^|[;\s])(?:fill(?:-[a-z-]+)?|stroke(?:-[a-z-]+)?|stop-(?:color|opacity)|font(?:-[a-z-]+)?|transform|filter|opacity|[rcxy]|cx|cy|d|rx|ry|text-anchor|letter-spacing)\s*:/i, `Original SVG internals must not be restyled in ${css}: ${selector.trim()}`);
      }
      if (!targetsBrand && !targetsSvg) continue;
      assert.doesNotMatch(rule[2], /(?:border-radius\s*:|filter\s*:|clip-path\s*:|mask(?:-image)?\s*:|object-fit\s*:\s*cover|overflow(?:-[xy])?\s*:\s*(?:hidden|clip)|display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$))/i, `Artwork visibility/canvas changed in ${css}: ${selector.trim()}`);
    }
  }
  return { originals: 2, exactCopies: 3, consumers: consumers.length };
}

export function discoverStyles(root) {
  const files = [];
  function visit(relative) {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && name.endsWith('.css')) files.push(name);
    }
  }
  visit('youji-app/src');
  return files.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = verifyBrandIntegrity(name => readFileSync(path.join(root, name)), { cssFiles: discoverStyles(root) });
  console.log(`Original brand integrity verified: ${result.originals} pinned originals, ${result.exactCopies} exact copies, ${result.consumers} consumers.`);
}
