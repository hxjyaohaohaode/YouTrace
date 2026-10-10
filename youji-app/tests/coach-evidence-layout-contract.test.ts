import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { sampleStableCoachEvidence, coachEvidenceFailures } from '../scripts/coach-evidence-layout-contract.mjs';

const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height });
function fixture() {
  let margin = 0, running = false, opacity = '1', responseTop = 300, streaming = false, fontStatus = 'loaded';
  const window: Record<string, unknown> = {};
  type Element = { parentElement: Element | null; getBoundingClientRect: () => ReturnType<typeof box>; getAnimations: () => unknown[]; contains: () => boolean; [key: string]: unknown };
  const element = (rect: () => ReturnType<typeof box>, parentElement: Element | null = null): Element => ({ parentElement, getBoundingClientRect: rect, getAnimations: () => [], contains: () => true });
  const main = element(() => box(margin, 0, 390 - margin, 844));
  main.getAnimations = () => running ? [{ playState: 'running' }] : [];
  const coach = element(() => box(margin, 0, 390 - margin, 748), main);
  const wrapper = element(() => box(48, responseTop, 310, 96), coach);
  const response = element(() => box(64, responseTop, 278, 84), wrapper);
  response.textContent = 'Synthetic shared provider response';
  const heading = element(() => box(80 + margin, 16, margin ? 36 : 80, margin ? 56 : 28), coach);
  heading.textContent = '生活教练';
  const nav = element(() => box(0, 748, 390, 96)); nav.closest = () => null;
  main.querySelector = (selector: string) => selector === '.coach-page' ? coach : null;
  main.querySelectorAll = (selector: string) => selector === '.coach-page' ? [coach] : [];
  coach.querySelector = (selector: string) => selector === 'h1' ? heading : selector === 'textarea[aria-label="输入消息"]' ? { disabled: streaming } : null;
  coach.querySelectorAll = () => [response];
  const context = {
    window, innerWidth: 390, innerHeight: 844, location: { pathname: '/coach' },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: (el: Element) => ({ opacity: el === wrapper ? opacity : '1', display: 'block', visibility: 'visible', contentVisibility: 'visible', transform: 'none', position: el === nav ? 'fixed' : 'static', marginLeft: el === main ? `${margin}px` : '0px', lineHeight: '28px' }),
    document: {
      fonts: { get status() { return fontStatus; } },
      querySelector: (selector: string) => selector === 'main#workspace-main' ? main : null,
      querySelectorAll: (selector: string) => selector === 'main#workspace-main' ? [main] : selector === 'nav[aria-label="主导航"]' ? [nav] : [],
      elementFromPoint: () => ({}),
    },
  };
  const sample = () => runInNewContext(`(${sampleStableCoachEvidence.toString()})('Synthetic shared provider response')`, context);
  return { sample, main, coach, heading, response, context,
    change: (next: { margin?: number; running?: boolean; opacity?: string; responseTop?: number; streaming?: boolean; fontStatus?: string }) => {
      if (next.margin !== undefined) margin = next.margin;
      if (next.running !== undefined) running = next.running;
      if (next.opacity !== undefined) opacity = next.opacity;
      if (next.responseTop !== undefined) responseTop = next.responseTop;
      if (next.streaming !== undefined) streaming = next.streaming;
      if (next.fontStatus !== undefined) fontStatus = next.fontStatus;
    },
  };
}

test('live 500ms sidebar transition and ancestor message fade cannot be photographed as settled', () => {
  const f = fixture(); f.change({ margin: 148, running: true });
  for (let n = 0; n < 5; n++) assert.equal(f.sample(), false);
  f.change({ margin: 0, running: false, opacity: '0.45' });
  for (let n = 0; n < 5; n++) assert.equal(f.sample(), false);
  f.change({ opacity: '1' });
  assert.equal(f.sample(), false); assert.equal(f.sample(), false);
  assert.deepEqual(coachEvidenceFailures(f.sample()), []);
});

test('a stable 148px mobile gutter is returned and fails geometry, not waited away', () => {
  const f = fixture(); f.change({ margin: 148 });
  assert.equal(f.sample(), false); assert.equal(f.sample(), false);
  const snapshot = f.sample(); assert.ok(snapshot); assert.equal(snapshot.main.rect.left, 148);
  const failures = coachEvidenceFailures(snapshot);
  assert.ok(failures.includes('mobile workspace must not retain sidebar clearance'));
  assert.ok(failures.includes('mobile Coach must use full viewport width'));
  assert.ok(failures.includes('Coach heading must not collapse into wrapped/vertical text'));
});

test('content movement resets consecutive-frame stability even without a Web Animation object', () => {
  const f = fixture(); assert.equal(f.sample(), false); assert.equal(f.sample(), false);
  f.change({ responseTop: 299.5 }); assert.equal(f.sample(), false); assert.equal(f.sample(), false);
  f.change({ responseTop: 299 }); assert.equal(f.sample(), false); assert.equal(f.sample(), false);
  assert.ok(f.sample());
});

test('fonts and actual completed stream are prerequisites; text presence alone is insufficient', () => {
  const f = fixture(); f.change({ streaming: true });
  for (let n = 0; n < 3; n++) assert.equal(f.sample(), false);
  f.change({ streaming: false, fontStatus: 'loading' });
  for (let n = 0; n < 3; n++) assert.equal(f.sample(), false);
  f.change({ fontStatus: 'loaded' }); assert.equal(f.sample(), false); assert.equal(f.sample(), false);
  assert.ok(f.sample());
});

test('opaque yet obscured response is a stable visual failure', () => {
  const f = fixture(); f.response.contains = () => false;
  f.sample(); f.sample();
  assert.ok(coachEvidenceFailures(f.sample()).includes('actual coach and response must be opaque, settled and painted'));
});

test('evidence keeps bounded RAF sampling, raw layout receipts and real screenshots without style overrides', () => {
  const source = readFileSync(new URL('../scripts/server-ai-browser-contract.mjs', import.meta.url), 'utf8');
  assert.match(source, /waitForFunction\(sampleStableCoachEvidence, \{ timeout: 20000, polling: 'raf' \}/);
  assert.match(source, /coachEvidenceFailures\(geometry\)/);
  assert.match(source, /assert\.deepEqual\(failures, \[\]/);
  assert.match(source, /-layout\.json/);
  assert.match(source, /failure: 'Readiness timeout'/);
  assert.match(source, /captureSettled\('server-ai-explicit-consent-mobile', 'Synthetic shared provider response', 390\)/);
  assert.match(source, /geometry\.viewport\.width !== expectedWidth/);
  assert.doesNotMatch(source, /setTimeout|waitForTimeout|emulateMediaFeatures|\.style\s*[.=]/);
  assert.doesNotMatch(source, /scrollWidth <= window\.innerWidth/);
});
