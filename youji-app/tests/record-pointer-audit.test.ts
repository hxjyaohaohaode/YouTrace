import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { revealRecordControl } from '../scripts/audit-record-pointer.mjs';

// Control tests only; the geometry models the saved e52041ec records evidence.
// The summary center is intentionally above the flat nav edge but within its
// raised capture control, so the unchanged elementFromPoint gate is essential.
const entry = 'main a[aria-label="待办"]';
const disclosure = 'aside[aria-label="预算与收支参考"] > details > summary';
function rect(x: number, y: number, width: number, height: number) {
  const box = { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
  return { ...box, toJSON: () => ({ ...box }) };
}
async function run({ summary = false, narrow = true, wheelWorks = true, covered = false, unique = true, hidden = false } = {}) {
  const selector = summary ? disclosure : entry, width = narrow ? 360 : 1280, height = narrow ? 800 : 900;
  const actions: Record<string, unknown>[] = [], moves: { x: number; y: number }[] = [];
  let scrollY = 0, wheelCalls = 0;
  const nav = { getBoundingClientRect: () => rect(0, 735, 360, 65), contains: () => false };
  const target = { parentElement: null, tagName: summary ? 'SUMMARY' : 'A', innerText: summary ? '查看收支统计与历史提示' : '待办', clientWidth: summary ? 320 : 50, scrollWidth: summary ? 320 : 50,
    closest: () => null, getBoundingClientRect: () => rect(summary ? 20 : narrow ? 20 : 350, (narrow ? summary ? 714 : 736.203125 : 500) - scrollY, summary ? 320 : 50, summary ? 20 : 44),
    contains: (hit: unknown): boolean => hit === target,
  };
  const document = {
    querySelectorAll: (query: string) => query === selector ? unique ? [target] : [target, target] : query === 'nav[aria-label="主导航"]' && narrow ? [nav] : [],
    elementFromPoint: (x: number, y: number) => covered || narrow && (y >= 735 || x >= 152 && x <= 208 && y >= 716 && y <= 792) ? nav : target,
  };
  const context = { document, innerWidth: width, innerHeight: height, getComputedStyle: () => ({ visibility: hidden ? 'hidden' : 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' }) };
  const page = {
    viewport: () => ({ width, height }),
    evaluate: async (fn: (...args: unknown[]) => unknown, query: string) => runInNewContext(`(${fn.toString()})(selector)`, { ...context, selector: query }),
    mouse: { move: async (x: number, y: number) => { moves.push({ x, y }); }, wheel: async ({ deltaY }: { deltaY: number }) => { wheelCalls++; if (wheelWorks) scrollY += deltaY; } },
  };
  const result = await revealRecordControl(page, selector, { actions, surface: 'Synthetic records', sleep: async () => undefined });
  return { result, scrollY, wheelCalls, moves, actions };
}

test('A mobile Todo link hidden below the fixed-nav edge becomes fully visible only after native wheel input', async () => {
  const result = await run();
  assert.equal(result.result.visible, true); assert.equal(result.wheelCalls, 1); assert.ok(result.scrollY > 0);
  assert.equal(result.actions[0].kind, 'native-wheel-read-record-control'); assert.equal(result.actions[0].selector, entry);
});
test('A disclosure center covered by the raised capture control above the nav edge still requires native wheel input', async () => {
  const result = await run({ summary: true });
  assert.equal(result.result.centerHit, true); assert.equal(result.result.visible, true); assert.equal(result.wheelCalls, 1);
  assert.equal(result.actions[0].selector, disclosure); assert.ok(result.moves[0].y < 716);
});
test('A readable desktop control needs no wheel; no-op scroll, permanent obstruction, hidden or ambiguous controls cannot pass', async () => {
  assert.equal((await run({ narrow: false })).wheelCalls, 0);
  await assert.rejects(run({ wheelWorks: false }));
  await assert.rejects(run({ covered: true }));
  await assert.rejects(run({ narrow: false, hidden: true }));
  await assert.rejects(run({ narrow: false, unique: false }));
});

test('Every affected record-journey click still uses its exact original target after explicit native reading', () => {
  const source = readFileSync(process.env.YOUTRACE_RECORD_AUDIT_SOURCE ?? new URL('../scripts/audit-user-outcomes.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('audit-user-outcomes.mjs', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  let count = 0;
  const call = (node: ts.Node | undefined) => node && ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression) && ts.isCallExpression(node.expression.expression) ? node.expression.expression : undefined;
  const visit = (node: ts.Node) => {
    if (ts.isBlock(node)) node.statements.forEach((statement, index) => {
      const action = call(statement);
      if (!action || !ts.isIdentifier(action.expression) || action.expression.text !== 'pointer') return;
      const selector = action.arguments[1], label = action.arguments[2];
      if (!selector || !ts.isStringLiteral(selector)) return;
      const todo = selector.text === entry;
      const summary = selector.text === 'summary' && label && ts.isStringLiteral(label) && label.text === '查看收支统计与历史提示';
      if (!todo && !summary) return;
      count++;
      const read = call(node.statements[index - 1]);
      assert.ok(read && ts.isIdentifier(read.expression) && read.expression.text === 'readRecordControl');
      const target = read.arguments[1]; assert.ok(ts.isStringLiteral(target));
      assert.equal(target.text, todo ? entry : disclosure);
    });
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(count, 3, 'Retain the original Todo entry and both disclosure open/close clicks');
});
