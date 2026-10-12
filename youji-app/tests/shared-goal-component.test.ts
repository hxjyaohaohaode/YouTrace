import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as React from 'react';
import { act } from 'react';
import { create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import ts from 'typescript';
// Actual component state/JSX, controlled service/actor and host-only Modal/router.
// Service + real fake-IDB transactions are tested separately, not native paint.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
const original = { id: 'old', title: '  Private synthetic title  ', description: ' raw text ', level: 'short', domain: 'study', priority: 'low', progress: 25.5, targetDate: '', createdAt: 1, updatedAt: 2 };
const preview = { ownerId: 'owner-a', snapshotDigest: 'a'.repeat(64), schemaId: 'known', items: [{ key: 'old', original }] };
const receipt = { intentId: 'b'.repeat(64), sourceKey: 'old', copyId: 'copy-id-private', original, copy: { ...original, id: 'copy-id-private', syncScope: 'local' } };
const text = (n: ReactTestInstance | string): string => typeof n === 'string' ? n : n.children.map(text).join('');
const button = (tree: ReactTestRenderer, label: string) => tree.root.findAllByType('button').find(n => text(n) === label)!;
const host = (tag: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => React.createElement(tag, props, children);
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup() {
  let context = 1, confirmations = 0;
  let read = async () => structuredClone(preview), confirm = async () => structuredClone(receipt);
  let current: unknown = receipt.copy;
  const mocks: Record<string, unknown> = {
    '../ui/Button': { Button: host('button') },
    '../ui/Modal': { Modal: ({ open, children, footer }: { open: boolean; children: React.ReactNode; footer: React.ReactNode }) => open ? React.createElement('div', { role: 'dialog' }, children, footer) : null },
    'react-router-dom': { Link: host('a') },
    '../../services/localActor': { readLocalActor: async () => ({ context }), assertLocalActor: async (actor: { context: number }) => { if (actor.context !== context) throw Error('changed owner/epoch'); } },
    '../../services/sharedGoalRecovery': { previewSharedGoals: () => read(), confirmSharedGoal: (...args: unknown[]) => { confirmations++; assert.equal(args[1], 'old'); assert.equal((args[2] as { ownerId: string }).ownerId, 'owner-a'); assert.equal((args[2] as { belongsToMe: boolean }).belongsToMe, true); return confirm(); }, listSharedGoalReviews: async () => [{ receipt, current, currentEqualsCopy: true, automaticUndoAvailable: false, reason: '已有后续变化或无法确认，保留记录。' }] },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/settings/SharedGoalRecoveryPanel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { SharedGoalRecoveryPanel?: React.ComponentType } = {};
  runInNewContext(code, { exports, require: (name: string) => mocks[name] ?? require(name), Object, Reflect, Number, JSON });
  return { Component: exports.SharedGoalRecoveryPanel!, change: () => { context++; }, setRead: (fn: typeof read) => { read = fn; }, setConfirm: (fn: typeof confirm) => { confirm = fn; }, count: () => confirmations, current: (value: unknown) => { current = value; } };
}
async function mount(s: ReturnType<typeof setup>) { let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(s.Component)); }); return tree; }
async function choose(tree: ReactTestRenderer) { await act(async () => button(tree, '预览旧版目标').props.onClick()); await act(async () => button(tree, '核对这一份原文').props.onClick()); }
async function check(tree: ReactTestRenderer) { await act(async () => tree.root.findByType('input').props.onChange({ target: { checked: true } })); }

test('actual confirmation requires unchecked-by-default owner choice, cancel writes nothing, success preserves explicit partial undo wording', async () => {
  const s = setup(), tree = await mount(s);
  try {
    await choose(tree); assert.equal(button(tree, '确认并创建仅本机副本').props.disabled, true); assert.match(text(tree.root), /25\.5/); assert.match(text(tree.root), /不提供自动撤销删除/);
    await act(async () => button(tree, '暂不恢复').props.onClick()); assert.equal(s.count(), 0);
    await act(async () => button(tree, '核对这一份原文').props.onClick()); assert.equal(tree.root.findByType('input').props.checked, false);
    await check(tree); await act(async () => button(tree, '确认并创建仅本机副本').props.onClick()); assert.equal(s.count(), 1); assert.match(text(tree.root), /耐久收据/); assert.match(text(tree.root), /copy-id-private/);
  } finally { await act(async () => tree.unmount()); }
});
test('busy same-turn double click dispatches one confirmation and uncertainty stays visible inside the original dialog', async () => {
  const s = setup(), tree = await mount(s); s.setConfirm(async () => { throw Error('synthetic lost response'); });
  try {
    await choose(tree); await check(tree); const click = button(tree, '确认并创建仅本机副本').props.onClick;
    await act(async () => { click(); click(); }); assert.equal(s.count(), 1);
    const dialog = tree.root.findByProps({ role: 'dialog' }); assert.match(text(dialog), /复制结果尚未确认/); assert.match(text(dialog), /查看恢复收据或重试/); assert.equal(tree.root.findByType('input').props.checked, true);
    assert.doesNotMatch(text(dialog), /已经回滚|没有保存/);
  } finally { await act(async () => tree.unmount()); }
});
for (const phase of ['preview', 'confirmation'] as const) test(`late ${phase} result after actor/epoch change cannot publish old private content`, async () => {
  const s = setup(), tree = await mount(s);
  try {
    if (phase === 'preview') {
      const gate = deferred<typeof preview>(); s.setRead(() => gate.promise);
      await act(async () => button(tree, '预览旧版目标').props.onClick()); s.change(); await act(async () => gate.resolve(preview));
    } else {
      await choose(tree); await check(tree); const gate = deferred<typeof receipt>(); s.setConfirm(() => gate.promise);
      await act(async () => button(tree, '确认并创建仅本机副本').props.onClick()); s.change(); await act(async () => gate.resolve(receipt));
    }
    assert.doesNotMatch(text(tree.root), /Private synthetic title|copy-id-private|owner-a/); assert.match(text(tree.root), /账号或本机资料已变化/);
  } finally { await act(async () => tree.unmount()); }
});
test('unmount invalidates an in-flight preview and never dispatches a write', async () => {
  const s = setup(), gate = deferred<typeof preview>(); s.setRead(() => gate.promise); const tree = await mount(s);
  await act(async () => button(tree, '预览旧版目标').props.onClick()); await act(async () => tree.unmount()); await act(async () => gate.resolve(preview)); assert.equal(s.count(), 0);
});
test('receipt comparison has no recovery-delete action and extended current values are never silently JSON-normalized', async () => {
  for (const extra of [new Date(1), 1n, undefined, new Map([['raw', 1]])]) {
    const s = setup(); s.current({ ...receipt.copy, extra }); const tree = await mount(s);
    try {
      await act(async () => button(tree, '查看恢复收据').props.onClick());
      await act(async () => tree.root.findAllByType('button').find(n => text(n).startsWith('比较恢复副本：'))!.props.onClick());
      assert.match(text(tree.root), /无法在此完整显示/); assert.match(text(tree.root), /仅比较，不删除或恢复/);
      assert.equal(tree.root.findAllByType('button').filter(n => /自动撤销|删除副本|恢复已删除/.test(text(n))).length, 0);
    } finally { await act(async () => tree.unmount()); }
  }
});
