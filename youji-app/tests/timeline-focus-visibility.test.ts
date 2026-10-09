import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as React from 'react';
import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as dates from '../src/utils/date';

// Actual component handlers with synthetic geometry from run 37976299454.
// This is a deterministic regression, not native keyboard/browser acceptance.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
const row = { id: 'expense:oct04', type: 'expense', date: '2026-10-04', title: '-¥3.21 Synthetic 自然周以外', detail: '记账日期', route: '/expense?record=oct04' };
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => createElement(tag, props, children);
const navigated: unknown[] = [];
const location = { pathname: '/timeline', search: '?range=30&from=2026-09-08&through=2026-10-07', key: 'test', state: null };
const source = readFileSync(process.env.YOUTRACE_TIMELINE_SOURCE ?? new URL('../src/pages/Timeline.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const mocks: Record<string, unknown> = {
  'react-router-dom': { Link: host('a'), useLocation: () => location, useNavigate: () => (...args: unknown[]) => navigated.push(args), useNavigationType: () => 'PUSH' },
  dexie: { liveQuery: () => ({ subscribe: ({ next }: { next: (value: object) => void }) => { next({ notes: [] }); return { unsubscribe() {} }; } }) },
  '../db': { db: { ownerId: 'synthetic' } },
  '../lib/navigation': { isStaticPageEntry: () => false },
  '../components/ui/Button': { Button: host('button') }, '../components/ui/Modal': { Modal: () => null },
  '../utils/date': dates,
  './timelineRange': { timelineRange: () => ({ range: '30', search: location.search }), timelineRangeIncludes: () => true },
  '../services/timelineEntries': { timelineEntries: () => [row], timelineTimeLabel: () => '日期记录' },
  './timelineReturnFocus': { prepareTimelineReturnFocus: () => undefined, consumeTimelineReturnFocus() {} },
};
const exports: { default?: React.ComponentType } = {};
runInNewContext(code, { exports, URLSearchParams, require: (name: string) => mocks[name] ?? require(name),
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, window: { scrollY: 0 } });

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
}
function fixture({ keyboard = true, connected = true, active = true, top = 629.34375, height = 114.375, width = 360, viewportHeight = 800, cardLeft = 37, cardWidth = width - 74, fixedNav = true, navHidden = false, navAncestorHidden = false, raised = true, inDialog = false, blockingDialog = false } = {}) {
  let currentTop = top, focusCalls = 0;
  const scrolls: ScrollIntoViewOptions[] = [];
  const normalStyle = { display: 'block', visibility: 'visible', opacity: '1', position: 'static', outlineWidth: '2px', outlineOffset: '3px' };
  const capture = { style: normalStyle, getBoundingClientRect: () => rect(152, 716, 56, 76) };
  const nav = { parentElement: navAncestorHidden ? { style: { ...normalStyle, opacity: '0' }, parentElement: null } : null, style: { ...normalStyle, position: fixedNav ? 'fixed' : 'static', display: navHidden ? 'none' : 'block' }, getBoundingClientRect: () => rect(0, 735, width, 65), querySelectorAll: () => raised ? [capture] : [] };
  const dialog = { style: normalStyle, getBoundingClientRect: () => rect(0, 80, width, 720) };
  const document: { activeElement: unknown; defaultView: unknown; querySelectorAll: (selector: string) => unknown[] } = {
    activeElement: null,
    defaultView: { innerWidth: width, innerHeight: viewportHeight, getComputedStyle: (node: { style: unknown }) => node.style },
    querySelectorAll: selector => selector === 'nav[aria-label="主导航"]' ? [nav] : selector === '[role="dialog"]' && blockingDialog ? [dialog] : [],
  };
  const target = { isConnected: connected, ownerDocument: document, style: normalStyle,
    matches: (selector: string) => selector === ':focus-visible' && keyboard,
    closest: () => inDialog ? dialog : null,
    getBoundingClientRect: () => rect(cardLeft, currentTop, cardWidth, height),
    scrollIntoView: (options: ScrollIntoViewOptions) => { scrolls.push(options); currentTop = (viewportHeight - height) / 2; },
    focus: () => { focusCalls++; },
  };
  document.activeElement = active ? target : {};
  return { target, document, scrolls, focusCalls: () => focusCalls, box: () => target.getBoundingClientRect() };
}
async function mounted() {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(exports.default!)); });
  const button = tree.root.findAllByType('button').find(button => button.props.className?.startsWith('timeline-row '))!;
  return { tree, button, close: () => act(async () => tree.unmount()) };
}
async function focusCase(options: Parameters<typeof fixture>[0]) {
  const element = fixture(options), view = await mounted();
  try { await act(async () => view.button.props.onFocus?.({ currentTarget: element.target, target: element.target })); }
  finally { await view.close(); }
  assert.equal(element.focusCalls(), 0, 'Visibility repair must never change focus');
  return element;
}

test('Actual Timeline handler reveals the exact desktop CI subpixel clipping, including the full 5px outline', async () => {
  for (const top of [803.171875, 898, -0.171875, -50]) {
    const element = await focusCase({ width: 1280, viewportHeight: 900, fixedNav: false, raised: false, top, height: 97 });
    assert.equal(element.scrolls.length, 1);
    assert.deepEqual({ ...element.scrolls[0] }, { block: 'center', inline: 'nearest', behavior: 'instant' });
    assert.ok(element.box().top - 5 >= 0 && element.box().bottom + 5 <= 900);
    assert.equal(element.document.activeElement, element.target);
  }
});

test('An otherwise visible desktop row with only its outline clipped still scrolls', async () => {
  const element = await focusCase({ width: 1280, viewportHeight: 900, fixedNav: false, top: 800, height: 97 });
  assert.equal(element.scrolls.length, 1);
  assert.ok(element.box().bottom + 5 <= 900);
});

test('Mobile fixed navigation and its raised Capture control are both respected', async () => {
  for (const raised of [false, true]) {
    const element = await focusCase({ raised });
    assert.equal(element.scrolls.length, 1);
    assert.ok(element.box().bottom + 5 < (raised ? 716 : 735));
  }
});

test('Pointer, disconnected, inactive, invisible and modal-owned rows do not scroll', async () => {
  for (const options of [{ keyboard: false }, { connected: false }, { active: false }, { inDialog: true }, { blockingDialog: true }, { height: 0 }]) {
    const element = await focusCase(options);
    assert.equal(element.scrolls.length, 0, JSON.stringify(options));
  }
  for (const width of [360, 1280]) {
    const element = await focusCase({ width, keyboard: false, top: 795 });
    assert.equal(element.scrolls.length, 0, 'Ordinary clicks must not trigger the keyboard visibility correction');
  }
});

test('Fully visible rows and hidden or non-fixed navigation require no repair', async () => {
  for (const options of [{ top: 100 }, { fixedNav: false }, { navHidden: true }, { navAncestorHidden: true }]) {
    const element = await focusCase(options);
    assert.equal(element.scrolls.length, 0, JSON.stringify(options));
  }
});

test('Repeated focus does not scroll again, schedule callbacks, change focus or change the destination', async () => {
  const element = fixture(), view = await mounted(); navigated.length = 0;
  try {
    await act(async () => view.button.props.onFocus?.({ currentTarget: element.target, target: element.target }));
    await act(async () => view.button.props.onFocus?.({ currentTarget: element.target, target: element.target }));
    assert.equal(element.scrolls.length, 1); assert.equal(element.focusCalls(), 0);
    await act(async () => view.button.props.onClick());
    assert.deepEqual(structuredClone(navigated.at(-1)), [row.route, { state: { returnTo: { path: location.pathname + location.search, label: '返回时间线' } } }]);
  } finally { await view.close(); }
});
