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

// Actual component handlers with synthetic geometry from run 37966540484.
// This is a deterministic regression, not native keyboard/browser acceptance.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
const row = { id: 'weekly', virtualId: 'weekly@2026-10-11', occurrenceDate: '2026-10-11', date: '2026-10-11', title: 'Synthetic 每周安排', startTime: '11:00', endTime: '12:00', type: 'other', location: 'Synthetic 原地点', repeat: 'weekly', remind: 0, createdAt: 1, updatedAt: 1, source: { id: 'weekly' } };
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => createElement(tag, props, children);
const edited: unknown[] = [];
const state = { items: [row], selectedDate: row.date, loaded: true, setSelectedDate() {} };
const source = readFileSync(process.env.YOUTRACE_SCHEDULE_CONTENT_SOURCE ?? new URL('../src/components/schedule/ScheduleContent.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const mocks: Record<string, unknown> = {
  'framer-motion': { motion: { div: host('div'), button: host('button') } },
  '../../stores/scheduleStore': { useScheduleStore: (select: (value: typeof state) => unknown) => select(state), expandRecurringForRange: () => [row] },
  '../ui/Card': { Card: host('div') }, '../../utils/date': dates,
  './ScheduleEditor': { ScheduleEditor: ({ item }: { item: unknown }) => { edited.push(item); return createElement('div', { 'data-editor': true }); } },
};
const exports: { ScheduleContent?: React.ComponentType } = {};
runInNewContext(code, { exports, require: (name: string) => mocks[name] ?? require(name), structuredClone });

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
}
function fixture({ keyboard = true, connected = true, active = true, top = 629.34375, height = 114.375, width = 360, cardLeft = 37, cardWidth = width - 74, fixedNav = true, navHidden = false, navAncestorHidden = false, raised = true, inDialog = false, blockingDialog = false } = {}) {
  let currentTop = top, focusCalls = 0;
  const scrolls: ScrollIntoViewOptions[] = [];
  const normalStyle = { display: 'block', visibility: 'visible', opacity: '1', position: 'static', outlineWidth: '2px', outlineOffset: '3px' };
  const capture = { style: normalStyle, getBoundingClientRect: () => rect(152, 716, 56, 76) };
  const nav = { parentElement: navAncestorHidden ? { style: { ...normalStyle, opacity: '0' }, parentElement: null } : null, style: { ...normalStyle, position: fixedNav ? 'fixed' : 'static', display: navHidden ? 'none' : 'block' }, getBoundingClientRect: () => rect(0, 735, width, 65), querySelectorAll: () => raised ? [capture] : [] };
  const dialog = { style: normalStyle, getBoundingClientRect: () => rect(0, 80, width, 720) };
  const document: { activeElement: unknown; defaultView: unknown; querySelectorAll: (selector: string) => unknown[] } = {
    activeElement: null,
    defaultView: { innerWidth: width, innerHeight: 800, getComputedStyle: (node: { style: unknown }) => node.style },
    querySelectorAll: selector => selector === 'nav[aria-label="主导航"]' ? [nav] : selector === '[role="dialog"]' && blockingDialog ? [dialog] : [],
  };
  const target = { isConnected: connected, ownerDocument: document, style: normalStyle,
    matches: (selector: string) => selector === ':focus-visible' && keyboard,
    closest: () => inDialog ? dialog : null,
    getBoundingClientRect: () => rect(cardLeft, currentTop, cardWidth, height),
    scrollIntoView: (options: ScrollIntoViewOptions) => { scrolls.push(options); currentTop = (800 - height) / 2; },
    focus: () => { focusCalls++; },
  };
  document.activeElement = active ? target : {};
  return { target, document, scrolls, focusCalls: () => focusCalls, box: () => target.getBoundingClientRect() };
}
async function mounted() {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(exports.ScheduleContent!)); });
  const button = tree.root.findByProps({ className: 'agenda-row' });
  return { tree, button, close: () => act(async () => tree.unmount()) };
}
async function focusCase(options: Parameters<typeof fixture>[0]) {
  const element = fixture(options), view = await mounted();
  try { await act(async () => view.button.props.onFocus?.({ currentTarget: element.target, target: element.target })); }
  finally { await view.close(); }
  assert.equal(element.focusCalls(), 0, 'Visibility repair must never change focus');
  return element;
}

test('The real agenda focus handler reveals the CI card whose bottom exceeded the fixed nav by 8.71875px', async () => {
  const original = fixture({ raised: false });
  assert.equal(original.box().bottom - 735, 8.71875);
  const element = await focusCase({ raised: false });
  assert.equal(element.scrolls.length, 1);
  assert.deepEqual({ ...element.scrolls[0] }, { block: 'center', inline: 'nearest', behavior: 'instant' });
  assert.ok(element.box().top >= 0 && element.box().bottom + 5 < 735);
  assert.equal(element.document.activeElement, element.target);
});

test('The raised Capture control is part of the actual obstruction even above the flat nav edge', async () => {
  const element = await focusCase({ top: 620, height: 110 });
  assert.equal(element.scrolls.length, 1); assert.ok(element.box().bottom + 5 < 716);
});

test('A raised navigation control outside this card horizontal span does not create a false obstruction', async () => {
  const element = await focusCase({ top: 620, height: 110, cardLeft: 220, cardWidth: 100 });
  assert.equal(element.scrolls.length, 0); assert.equal(element.box().bottom + 5, 735);
});

test('Visible mobile or desktop cards and hidden/non-fixed navigation need no scroll', async () => {
  for (const options of [{ top: 500 }, { width: 1280, fixedNav: false }, { navHidden: true }, { navAncestorHidden: true }, { fixedNav: false }]) {
    assert.equal((await focusCase(options)).scrolls.length, 0);
  }
});

test('Mouse focus, detached or superseded targets, and dialogs cannot trigger background scrolling', async () => {
  for (const options of [{ keyboard: false }, { connected: false }, { active: false }, { inDialog: true }, { blockingDialog: true }]) {
    assert.equal((await focusCase(options)).scrolls.length, 0);
  }
});

test('Keyboard focus near a viewport edge without bottom navigation is revealed without another focus', async () => {
  const element = await focusCase({ width: 1280, fixedNav: false, top: -15 });
  assert.equal(element.scrolls.length, 1); assert.ok(element.box().top >= 5);
});

test('A repeated focus observation of the now-visible card does not scroll again or change the edit target', async () => {
  const element = fixture(), view = await mounted(); edited.length = 0;
  try {
    await act(async () => view.button.props.onFocus?.({ currentTarget: element.target, target: element.target }));
    await act(async () => view.button.props.onFocus?.({ currentTarget: element.target, target: element.target }));
    assert.equal(element.scrolls.length, 1); assert.equal(element.focusCalls(), 0);
    await act(async () => view.button.props.onClick());
    assert.deepEqual(edited.at(-1), row, 'Keep the original weekly occurrence and canonical source');
  } finally { await view.close(); }
});
