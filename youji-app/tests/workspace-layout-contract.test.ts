import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { sampleStableWorkspace, workspaceLayoutFailures } from '../scripts/workspace-layout-contract.mjs';

const box = (left: number, width: number, height = 900, top = 0) => ({ left, right: left + width, top, bottom: top + height, width, height });
const item = (rect = box(0, 232)) => ({ rect, marginLeft: 0, position: 'static', opacity: 1, visible: true, animating: false, inViewport: true, painted: true });
function fixture(width = 232, viewport = 1280) {
  return {
    mainSelector: 'main#workspace-main', navSelector: 'nav[aria-label="主导航"]', path: '/', mainCount: 1,
    viewport: { width: viewport, height: 900 }, desktop: viewport >= 1025, tablet: viewport >= 769 && viewport <= 1024,
    main: { ...item(box(width, viewport - width)), marginLeft: width }, heading: item(box(width + 32, 200, 40, 40)),
    navigation: [{ nav: item(box(0, width, 650, 120)), sidebar: { ...item(box(0, width)), position: 'fixed' } }],
  };
}
// This switch executes the literal old native predicate against the same
// geometry fixtures, documenting false negatives AND false positives.
const failures = process.env.TEST_LEGACY_WORKSPACE_ORACLE === '1'
  ? (s: ReturnType<typeof fixture>) => s.main.marginLeft >= 260 ? [] : ['legacy margin >= 260']
  : workspaceLayoutFailures;
for (const width of [232, 260]) test(`actual ${width}px fixed sidebar clears workspace`, () => assert.deepEqual(failures(fixture(width)), []));
test('one pixel overlap fails even when old 260px margin predicate passes', () => {
  const s = fixture(260); s.main.rect = box(259, 1021);
  assert.ok(failures(s).length);
});
test('computed margin must independently clear sidebar even with translated main', () => {
  const s = fixture(); s.main.marginLeft = 231;
  assert.ok(failures(s).length);
});
for (const field of ['visible', 'inViewport', 'painted'] as const) test(`missing sidebar ${field} fails`, () => {
  const s = fixture(260); s.navigation[0].sidebar[field] = false;
  assert.ok(failures(s).length);
});
test('missing or duplicate primary navigation fails', () => {
  const s = fixture(260); s.navigation = []; assert.ok(failures(s).length);
  s.navigation = [...fixture(260).navigation, ...fixture(260).navigation]; assert.ok(failures(s).length);
});
for (const field of ['main', 'heading'] as const) test(`transparent, obscured, animating ${field} fails`, () => {
  for (const patch of [{ opacity: 0 }, { opacity: .99 }, { painted: false }, { animating: true }]) {
    const s = fixture(260); Object.assign(s[field], patch); assert.ok(failures(s).length);
  }
});
test('startup/arbitrary main and mismatched desktop viewport fail', () => {
  for (const patch of [{ mainSelector: 'main' }, { mainCount: 0 }, { mainCount: 2 }, { desktop: false }, { path: '/login' }]) {
    assert.ok(failures(Object.assign(fixture(260), patch)).length);
  }
});
test('stale onboarding main with centered 350px margin is a legacy false positive', () => {
  const s = fixture(350); s.mainSelector = 'main.onboarding-content'; s.mainCount = 0; s.navigation = [];
  assert.ok(s.main.marginLeft >= 260, 'old predicate falsely accepts onboarding');
  assert.ok(failures(s).length, 'root URL alone does not turn onboarding into workspace');
});
test('tablet clearance is measured, mobile has bottom navigation without sidebar margin', () => {
  assert.deepEqual(workspaceLayoutFailures(fixture(76, 1024)), []);
  const s = { ...fixture(0, 390), navigation: [{ nav: { ...item(box(0,390,64,836)), position: 'fixed' }, sidebar: null }] };
  assert.deepEqual(workspaceLayoutFailures(s), []);
  s.main.marginLeft = 232; assert.ok(workspaceLayoutFailures(s).length);
  s.main.marginLeft = 0; s.desktop = true; assert.ok(workspaceLayoutFailures(s).length);
});
test('native sampler selects workspace and fixed nav ancestor; waits for painted frame stability, not passing clearance', () => {
  const main = { parentElement: null, getBoundingClientRect: () => box(231,1049), getAnimations: () => [], contains: () => true, querySelector: () => heading };
  const heading = { ...main, getBoundingClientRect: () => box(264,200,40,40), parentElement: main };
  const aside = { ...main, getBoundingClientRect: () => box(0,232) };
  const nav = { ...main, getBoundingClientRect: () => box(0,232,650,120), closest: (selector: string) => { assert.equal(selector,'aside'); return aside; }, parentElement: aside };
  let hasWorkspace = false;
  const window: Record<string, unknown> = {};
  const context = {
    window, innerWidth: 1280, innerHeight: 900, location: { pathname: '/' },
    matchMedia: (q: string) => ({ matches: q === '(min-width: 1025px)' }),
    getComputedStyle: (el: unknown) => ({ opacity: '1', display: 'block', visibility: 'visible', contentVisibility: 'visible', position: el === aside ? 'fixed' : 'static', marginLeft: el === main ? '232px' : '0px' }),
    document: {
      querySelector: (q: string) => { assert.equal(q, 'main#workspace-main'); return hasWorkspace ? main : null; },
      querySelectorAll: (q: string) => q === 'main#workspace-main' ? (hasWorkspace ? [main] : []) : q === 'nav[aria-label="主导航"]' ? [nav] : [],
      elementFromPoint: () => ({}),
    },
  };
  const sample = () => runInNewContext(`(${sampleStableWorkspace.toString()})()`, context);
  assert.equal(sample(), false, 'an unrelated startup main cannot satisfy readiness');
  hasWorkspace = true;
  assert.equal(sample(), false); assert.equal(sample(), false);
  const result = sample(); assert.ok(result);
  assert.equal(result.main.rect.left, 231);
  assert.ok(workspaceLayoutFailures(result).includes('workspace must not overlap sidebar, including one pixel'), 'stable invalid geometry fails instead of waiting it away');
  main.getBoundingClientRect = () => box(232,1048);
  assert.equal(sample(), false); assert.equal(sample(), false);
  assert.deepEqual(workspaceLayoutFailures(sample()), []);
});
test('native login uses exact sampler within original 20 second budget and records raw geometry', () => {
  const code = readFileSync(new URL('../scripts/e2e-recovery.mjs', import.meta.url), 'utf8');
  assert.match(code, /waitForFunction\(sampleStableWorkspace, \{ timeout: 20000, polling: 'raf' \}\)/);
  assert.match(code, /workspaceLayoutFailures\(geometry\)/);
  assert.match(code, /console\.log\('WORKSPACE_LAYOUT', JSON\.stringify\(geometry\)\)/);
  assert.doesNotMatch(code, /marginLeft\) >= 260/);
});
