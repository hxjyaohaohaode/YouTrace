import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { FIRST_OPEN_PROFILES, FIRST_OPEN_WINDOW_MS, firstOpenContinuityPass, installFirstDiaryObserver } from '../scripts/audit-diary-first-open.mjs';

// Harness contracts only: no browser, listener, synthetic CI flag or product acceptance.
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('Cold/warm first-open profiles use four distinct accounts and unchanged real initialization deadline', () => {
  assert.equal(FIRST_OPEN_PROFILES.length, 4);
  assert.equal(new Set(FIRST_OPEN_PROFILES.map((p: { phone: string }) => p.phone)).size, 4);
  for (const width of [360, 1280]) for (const start of ['cold', 'warm']) {
    const p = FIRST_OPEN_PROFILES.filter((p: { width: number; start: string }) => p.width === width && p.start === start);
    assert.equal(p.length, 1); assert.ok(p[0].nickname.length <= 20);
  }
  const app = source('../src/hooks/useAppInit.ts');
  const timeout = Number(app.match(/const INIT_TIMEOUT_MS = ([\d_]+);/)![1].replaceAll('_', ''));
  assert.equal(timeout, 12000); assert.equal(FIRST_OPEN_WINDOW_MS, timeout + 1000);
});
function passing() { return { firstPaintAt: 40, lastSampleAt: 13040, samples: 781, violations: [], dropped: 0, initializations: [{ stage: 'initialization', outcome: 'success' }], route: '/diary' }; }
test('Continuity oracle rejects missing paint, short window, detached/hidden/replaced modal and lost evidence', () => {
  assert.equal(firstOpenContinuityPass(passing()), true);
  for (const patch of [{ firstPaintAt: null }, { lastSampleAt: 13039 }, { samples: 1 }, { violations: [{ kind: 'dialog-or-editor-replaced-or-removed' }] }, { dropped: 1 }, { initializations: [] }, { route: '/login' }]) assert.equal(firstOpenContinuityPass({ ...passing(), ...patch }), false);
});
function observer() {
  let now = 0, selected: FakeElement | null = null, mutation: ((records: { removedNodes: FakeElement[] }[]) => void) | undefined, frame: (() => void) | undefined;
  const listeners = new Map<string, (event: unknown) => void>();
  class FakeElement {
    tagName = 'DIV'; id = ''; parentElement = null; isConnected = true; opacity = '1'; left = 0; visibility = 'visible'; input: FakeElement | null = null;
    querySelector() { return this.input; }
    getBoundingClientRect() { return { width: 400, height: 300, left: this.left, right: this.left + 400, top: 0, bottom: 300 }; }
    getAttribute() { return null; }
    closest() { return selected; }
    contains(el: FakeElement) { return this === el || this.input === el; }
  }
  const document = { querySelector: () => selected, activeElement: null, addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn) };
  const context = { location: { pathname: '/diary' }, innerWidth: 1280, innerHeight: 900, performance: { now: () => now }, document, Element: FakeElement, getComputedStyle: (el: FakeElement) => ({ display: 'block', visibility: el.visibility, opacity: el.opacity }), structuredClone, requestAnimationFrame: (fn: () => void) => { frame = fn; }, MutationObserver: class { constructor(fn: typeof mutation) { mutation = fn; } observe() {} }, window: { addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn) } };
  const api = runInNewContext(`(${installFirstDiaryObserver.toString()})(); globalThis.__firstDiaryAudit`, context);
  return { api, context, make: () => { const panel = new FakeElement(); panel.input = new FakeElement(); return panel; }, show: (el: FakeElement | null) => { selected = el; mutation!([]); }, tick: (ms: number) => { now = ms; frame!(); }, remove: (el: FakeElement) => mutation!([{ removedNodes: [el] }]), listeners };
}
test('Passive observer starts at real paint and records removal even if same node is reinserted before callback', () => {
  const o = observer(); o.api.arm(); const panel = o.make(); panel.opacity = '0'; o.show(panel);
  assert.equal(o.api.snapshot().firstPaintAt, null); panel.opacity = '1'; o.tick(20); o.tick(13020);
  o.listeners.get('youtrace:initialization-diagnostic')!({ detail: { phase: 'initial', stage: 'initialization', outcome: 'success', attempt: 1 } });
  assert.equal(firstOpenContinuityPass(o.api.snapshot()), true);
  o.remove(panel); assert.equal(firstOpenContinuityPass(o.api.snapshot()), false);
});
test('Observer fails transient disappearance, replacement, hidden paint and route changes without dismissing anything', () => {
  for (const variant of ['remove', 'replace', 'hide', 'route', 'offscreen', 'field-hidden']) {
    const o = observer(); o.api.arm(); const panel = o.make(); o.show(panel); o.tick(10);
    if (variant === 'remove') o.show(null);
    if (variant === 'replace') o.show(o.make());
    if (variant === 'hide') panel.opacity = '0';
    if (variant === 'offscreen') panel.left = 1281;
    if (variant === 'field-hidden') panel.input!.visibility = 'hidden';
    if (variant === 'route') o.context.location.pathname = '/login';
    o.tick(13010); assert.ok(o.api.snapshot().violations.length > 0, variant);
  }
});
test('Intentional cancel stops the continuity guard while retaining earlier violations and trusted dismissal provenance', () => {
  const o = observer(); o.api.arm(); o.show(o.make()); o.tick(10);
  o.listeners.get('keydown')!({ isTrusted: true, key: 'Escape', target: null });
  assert.equal(o.api.snapshot().events.at(-1).key, 'Escape');
  o.api.stop(); o.show(null); o.tick(13010); assert.deepEqual([...o.api.snapshot().violations], []);
});
test('Native first-empty path does not settle, capture, fetch sources, or reuse slow login before first opening', () => {
  const code = source('../scripts/audit-diary-outcomes.mjs').split('async function firstEmptyDiary(')[1].split('const media = [];')[0];
  const before = code.split("await tap(page, 'button[aria-label=\"写日记\"]');")[0];
  for (const prohibited of ['await login(', 'await capture(', 'await facts(', 'await apiFor(', 'await sleep(', 'networkidle']) assert.equal(before.includes(prohibited), false, prohibited);
  assert.ok(code.includes("assert.equal(draftRow(empty, 'record-draft:diary:new'), undefined"));
  assert.ok(code.includes("assert.deepEqual(assertDraft(reopened, 'record-draft:diary:new', values), form"));
  assert.ok(code.includes('firstOpenContinuityPass(blankTrace)'));
  assert.ok(code.includes('firstOpenContinuityPass(typedTrace)'));
});
