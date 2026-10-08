import test from 'node:test';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRAND_FILES, verifyBrandIntegrity } from '../scripts/verify-brand-integrity.mjs';

const originals = new Map<string, Buffer>(BRAND_FILES.map((name: string) => [name, readFileSync(new URL(`../../${name}`, import.meta.url))]));
const reader = (files: Map<string, Buffer>) => (name: string) => { const value = files.get(name); assert.ok(value, name); return value; };
function damaged(path: string, change: (text: string) => string) {
  const files = new Map(originals);
  const before = files.get(path)!.toString('utf8');
  const after = change(before);
  assert.notEqual(after, before, 'Negative case must actually alter tested source');
  files.set(path, Buffer.from(after));
  return files;
}
test('standalone brand gate passes the actual approved originals, copies and consumers', () => {
  assert.deepEqual(verifyBrandIntegrity(reader(originals)), { originals: 2, exactCopies: 3, consumers: 6 });
});
for (const path of ['logo.txt', '纯logo.txt']) {
  test(`brand gate rejects even whitespace changes in root original ${path}`, () => {
    assert.throws(() => verifyBrandIntegrity(reader(damaged(path, s => `${s}\n`))), /Original artwork changed/);
  });
}
test('changing original and all copies together cannot self-certify a new expected hash', () => {
  const files = damaged('纯logo.txt', s => s.replace('#e8941e', '#7c6fff'));
  for (const path of ['youji-app/public/brand/youtrace-mark.svg', 'youji-app/public/favicon.svg']) files.set(path, files.get('纯logo.txt')!);
  assert.throws(() => verifyBrandIntegrity(reader(files)), /Original artwork changed/);
});
for (const path of ['youji-app/public/brand/youtrace-wordmark.svg', 'youji-app/public/brand/youtrace-mark.svg', 'youji-app/public/favicon.svg']) {
  test(`brand gate rejects modified derived asset ${path}`, () => {
    assert.throws(() => verifyBrandIntegrity(reader(damaged(path, s => `${s}\n`))), /Artwork copy differs/);
  });
}
const brand = 'youji-app/src/components/ui/Brand.tsx';
for (const [name, change] of [
  ['wrong visible full source', (s: string) => s.replace('src="/brand/youtrace-wordmark.svg"', 'src="/vite.svg"')],
  ['wrong visible compact source', (s: string) => s.replace('src="/brand/youtrace-mark.svg"', 'src="/vite.svg"')],
  ['wrong inline original', (s: string) => s.replace('__html: originalWordmark', '__html: "fake"')],
  ['changed canvas', (s: string) => s.replace('width="1160"', 'width="600"')],
  ['rewritten SVG content', (s: string) => s.replace('__html: originalWordmark', '__html: originalWordmark.replace("#e8941e", "purple")')],
] as const) test(`brand gate rejects ${name}`, () => assert.throws(() => verifyBrandIntegrity(reader(damaged(brand, change)))));
for (const path of ['components/layout/DesktopSidebar.tsx', 'components/layout/TabletSidebar.tsx', 'pages/Login.tsx', 'pages/Onboarding.tsx', 'pages/Coach.tsx', 'components/ui/SplashScreen.tsx']) {
  test(`brand gate rejects disconnected actual consumer ${path}`, () => {
    assert.throws(() => verifyBrandIntegrity(reader(damaged(`youji-app/src/${path}`, s => s.replace('<Brand', '<OtherBrand')))), /consumer missing/);
  });
}
for (const declaration of ['filter: grayscale(1);', 'clip-path: inset(10%);', 'object-fit: cover;', 'overflow: hidden;', 'display: none;', 'border-radius: 12px;']) {
  test(`brand gate rejects brand canvas alteration ${declaration}`, () => {
    assert.throws(() => verifyBrandIntegrity(reader(damaged('youji-app/src/styles/global.css', s => `${s}\n.brand-wordmark { ${declaration} }`))), /Artwork visibility\/canvas changed/);
  });
}
test('brand gate rejects disconnected favicon and first-entry Splash bypass', () => {
  assert.throws(() => verifyBrandIntegrity(reader(damaged('youji-app/index.html', s => s.replace('href="/favicon.svg"', 'href="/vite.svg"')))), /Favicon/);
  assert.throws(() => verifyBrandIntegrity(reader(damaged('youji-app/src/App.tsx', s => s.replace('useState(false)', 'useState(true)')))), /pre-skip/);
});
for (const rule of ['.brand-animated circle { fill: #000 !important; }', '.brand-animated text { font-family: serif; }', '.brand-animated circle { stroke: purple; }', '.brand-animated circle { r: 1px; }', 'svg circle { fill: #000; }']) {
  test(`brand gate rejects original SVG repaint ${rule}`, () => {
    assert.throws(() => verifyBrandIntegrity(reader(damaged('youji-app/src/styles/global.css', s => `${s}\n${rule}`))), /internals must not be restyled/);
  });
}
test('consumer name cannot hide a substitute Brand import from another directory', () => {
  assert.throws(() => verifyBrandIntegrity(reader(damaged('youji-app/src/pages/Login.tsx', s => s.replace("'../components/ui/Brand'", "'../fake/Brand'")))), /Canonical Brand import/);
});

// Actual Brand function and React renderer; no fake component stands in for Brand.
function actualBrandContract(source = originals.get(brand)!.toString('utf8')) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules: Record<string, unknown> = {
    'react/jsx-runtime': jsx,
    '../../../public/brand/youtrace-wordmark.svg?raw': { __esModule: true, default: originals.get('logo.txt')!.toString('utf8') },
  };
  const exports: { Brand?: React.ComponentType<{ variant: string; animated?: boolean }> } = {};
  runInNewContext(code, { exports, require: (id: string) => { assert.ok(id in modules, id); return modules[id]; } });
  assert.ok(exports.Brand);
  const output = (variant: string, animated = false) => renderToStaticMarkup(React.createElement(exports.Brand!, { variant, animated }));
  const full = output('full').match(/<img\b[^>]+>/)?.[0] ?? '';
  assert.match(full, /src="\/brand\/youtrace-wordmark.svg"/);
  assert.match(full, /width="1160" height="320"/);
  const mark = output('mark');
  assert.match(mark, /src="\/brand\/youtrace-mark.svg"/);
  assert.match(mark, /width="1024" height="1024"/);
  assert.doesNotMatch(mark, /<strong/);
  const compact = output('compact');
  assert.match(compact, /src="\/brand\/youtrace-mark.svg"/);
  assert.match(compact, /<strong>有迹<\/strong>/);
  assert.match(compact, /<small>YOUTRACE<\/small>/);
  const animated = output('full', true);
  assert.ok(animated.includes(originals.get('logo.txt')!.toString('utf8')), 'Animated output must contain entire unmodified original SVG');
  assert.doesNotMatch(animated, /<img/);
}
test('actual React Brand output consumes original full, mark, compact and animated variants', () => actualBrandContract());
test('actual variant rendering catches swapped branch conditions even with original strings retained', () => {
  const source = originals.get(brand)!.toString('utf8');
  assert.throws(() => actualBrandContract(source.replaceAll("variant === 'full'", "variant === 'mark'")), { code: 'ERR_ASSERTION' });
  assert.throws(() => actualBrandContract(source.replace("variant === 'compact'", "variant === 'mark'")), { code: 'ERR_ASSERTION' });
});

for (const rule of ['.brand-animated circle { stroke-width: 99; }', '.brand-animated stop { stop-color: #000; }', 'text { font-family: serif; }', 'svg { filter: grayscale(1); }', '.brand-animated>circle { fill: #000; }']) {
  test(`independent-audit counterexample is rejected: ${rule}`, () => {
    assert.throws(() => verifyBrandIntegrity(reader(damaged('youji-app/src/styles/global.css', s => `${s}\n${rule}`))), /internals must not be restyled|visibility\/canvas changed/);
  });
}

test('consumer may not silently hide its canonical Brand while retaining the import', () => {
  assert.throws(() => verifyBrandIntegrity(reader(damaged('youji-app/src/pages/Login.tsx', s => s.replace('className="login-wordmark"', 'className="hidden"')))), /must not hide/);
});
test('newly discovered CSS is subject to the same original artwork guard', () => {
  const files = new Map(originals);
  files.set('youji-app/src/styles/new-brand-override.css', Buffer.from('.brand-animated stop { stop-color: #000; }'));
  assert.throws(() => verifyBrandIntegrity(reader(files), { cssFiles: [...BRAND_FILES.filter((path: string) => path.endsWith('.css')), 'youji-app/src/styles/new-brand-override.css'] }), /internals must not be restyled/);
});
