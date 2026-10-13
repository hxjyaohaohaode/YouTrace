import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { after, before, beforeEach, test } from 'node:test';
import * as React from 'react';
import { act } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import Dexie from 'dexie';
import ts from 'typescript';
import { goalProgressMatchesIdentity } from '../scripts/audit-goal-outcomes.mjs';

// Actual Goal JSX, nested UI, Zustand store, actor checks and Dexie transactions.
// Only CSS loading and browser host facilities are omitted/emulated. This is
// component + fake-IndexedDB evidence, not native layout, focus or multi-device QA.
const memory = () => { const entries = new Map<string, string>(); return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key), clear: () => entries.clear() }; };
Object.assign(globalThis, {
  React, IS_REACT_ACT_ENVIRONMENT: true, localStorage: memory(), sessionStorage: memory(),
  window: Object.assign(new EventTarget(), { location: { replace() {} }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) }),
  requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
  fetch: () => { throw new Error('No network in initial Goal read tests'); },
});
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const goalModule = await import('../src/stores/goalStore.ts');
const { useGoalStore: store } = goalModule;
const { sameGoalSource } = await import('../src/services/goalSource.ts');
const auth = await import('../src/stores/authStore.ts');
const require = createRequire(import.meta.url);
const dependencies: Record<string, unknown> = {
  '../components/schedule/planning.css': {}, '../db': storage, '../stores/goalStore': goalModule, '../stores/authStore': auth,
  '../components/layout/PageHeader': await import('../src/components/layout/PageHeader.tsx'),
  '../components/ui/Modal': await import('../src/components/ui/Modal.tsx'),
  '../components/ui/Button': await import('../src/components/ui/Button.tsx'),
  '../components/ui/Input': await import('../src/components/ui/Input.tsx'),
  '../components/settings/LegacyGoalRecovery': await import('../src/components/settings/LegacyGoalRecovery.tsx'),
  '../components/goal/goalErrors': await import('../src/components/goal/goalErrors.ts'),
  '../components/goal/GoalErrorAlert': await import('../src/components/goal/GoalErrorAlert.tsx'),
  '../services/diagnostics': await import('../src/services/diagnostics.ts'),
};
const goalSource = readFileSync(new URL('../src/pages/Goal.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(goalSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { default?: React.ComponentType } = {};
runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name) });
const Goal = exports.default!;
const owner = 'synthetic-goal-first-read-a', otherOwner = 'synthetic-goal-first-read-b';
const original = { id: 'synthetic-exact-goal-id', title: '同名目标', description: '第一份完整说明\n第二行仍保留', level: 'medium' as const, domain: '学习', priority: 'high' as const, progress: 75, targetDate: '2027-03-14', createdAt: 1770000000123, updatedAt: 1770000000456, syncScope: 'account' as const, extra: { raw: new Map([['未识别字段', '保留']]), bytes: new Uint8Array([1, 3, 9]), absentValue: undefined } };
const neighbor = { ...original, id: 'synthetic-other-goal-id', description: '同名的第二份，绝不能代替第一份', level: 'long' as const, priority: 'low' as const, progress: 100, targetDate: null, syncScope: 'local' as const };
const legacy = { ...original, description: '旧来源原稿，等待明确选择', progress: 25, extra: { raw: new Map([['历史', '保持原样']]), bytes: new Uint8Array([9, 8, 7]), absentValue: undefined } };
let other: InstanceType<typeof storage.YoujiDatabase>, shared: Dexie;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const button = (tree: ReactTestRenderer, label: string) => tree.root.findAllByType('button').find(node => text(node) === label);
async function settle(predicate: () => boolean, label: string) {
  for (let count = 0; count < 100 && !predicate(); count++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.ok(predicate(), `${label}; state=${JSON.stringify({ loaded: store.getState().loaded, loading: store.getState().loading, readError: store.getState().readError })}`);
}
async function mount() { let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(Goal)); }); return tree; }
async function snapshot(database: Dexie) { return database.transaction('r', database.tables, async () => Object.fromEntries(await Promise.all(database.tables.map(async table => [table.name, { keys: await table.toCollection().primaryKeys(), values: await table.toArray() }])))); }
async function snapshots() { return { current: await snapshot(storage.db), other: await snapshot(other), shared: await snapshot(shared) }; }
function trackWrites() {
  const writes: string[] = [], cleanup: (() => void)[] = [];
  for (const database of [storage.db, other, shared]) for (const table of database.tables) for (const event of ['creating', 'updating', 'deleting'] as const) {
    const record = () => { writes.push(`${database.name}/${table.name}/${event}`); };
    table.hook(event, record); cleanup.push(() => table.hook(event).unsubscribe(record));
  }
  return { writes, stop: () => cleanup.forEach(fn => fn()) };
}
async function unchanged(before: Awaited<ReturnType<typeof snapshots>>, writes: string[]) {
  assert.deepEqual(writes, [], 'Reading, failing and refreshing must attempt zero business/settings/outbox/source writes');
  assert.ok(await sameGoalSource(await snapshots(), before), 'All tables of A, B and unowned shared source must remain exact');
}
function failReads(phase: 'initial-epoch' | 'goal-snapshot' | 'after-epoch') {
  const get = storage.db.settings.get, toArray = storage.db.goalRecords.toArray;
  let faults = 0, reads = 0;
  if (phase === 'goal-snapshot') storage.db.goalRecords.toArray = () => { faults++; return Promise.reject(new DOMException('Synthetic snapshot read abort', 'AbortError')); };
  else storage.db.settings.get = function (...args: Parameters<typeof get>) {
    if (args[0] === storage.LOCAL_DATA_EPOCH_KEY && (phase === 'initial-epoch' || ++reads > 1)) { faults++; return Promise.reject(new DOMException('Synthetic epoch read abort', 'AbortError')); }
    return get.apply(this, args);
  } as typeof get;
  return { count: () => faults, restore: () => { storage.db.settings.get = get; storage.db.goalRecords.toArray = toArray; } };
}
function unknown(tree: ReactTestRenderer) {
  assert.equal(store.getState().loaded, false); assert.deepEqual(store.getState().items, []);
  assert.match(text(tree.root), /目标统计暂未读取/); assert.match(text(tree.root), /暂不把未读到的资料算作空列表/);
  assert.match(text(tree.root), /目标暂未读取.*刷新核对.*重试/);
  assert.doesNotMatch(text(tree.root), /还没有目标|创建第一个目标|0\/0|平均进度 0%|修改已保存在本机|本机副本已生成/);
  assert.equal(tree.root.findAllByProps({ role: 'progressbar' }).length, 0);
  assert.equal(tree.root.findAllByProps({ 'data-component': 'goal-source-recovery' }).length, 0);
  assert.equal(button(tree, '刷新核对')?.props.disabled, false);
}
function exactRecovered(tree: ReactTestRenderer) {
  assert.equal(store.getState().readError, null); assert.equal(store.getState().loaded, true); assert.equal(store.getState().loading, false);
  assert.deepEqual(store.getState().items, [original, neighbor]);
  assert.equal(store.getState().statuses[original.id], '已同步'); assert.equal(store.getState().statuses[neighbor.id], '仅本机');
  assert.deepEqual(store.getState().legacyChanges.map(change => ({ id: change.id, source: change.source, current: change.current, previousSource: change.previousSource })), [{ id: legacy.id, source: legacy, current: original, previousSource: null }]);
  assert.match(text(tree.root), /1\/2 完成 · 平均进度 88%/); assert.match(text(tree.root), /第一份完整说明第二行仍保留|第一份完整说明\n第二行仍保留/);
  assert.match(text(tree.root), /2027-03-14/); assert.doesNotMatch(text(tree.root), /目标统计暂未读取|目标列表暂未读取|暂时无法读取目标/);
  assert.deepEqual(tree.root.findAllByProps({ role: 'progressbar' }).map(node => node.props['aria-valuenow']), [75, 100]);
}
before(async context => {
  context.diagnostic(JSON.stringify({ type: 'actual-source-receipt', files: ['../src/stores/goalStore.ts', '../src/pages/Goal.tsx'].map(relative => {
    const resolved = import.meta.resolve(relative), path = realpathSync(fileURLToPath(resolved));
    return { resolved, path, sha256: createHash('sha256').update(relative.endsWith('/Goal.tsx') ? goalSource : readFileSync(path)).digest('hex') };
  }) }));
  await storage.bindAccountDatabase(owner); sync.pauseSync();
  other = new storage.YoujiDatabase(otherOwner); await other.open();
  await other.goalRecords.put({ ...neighbor, id: 'synthetic-owner-b-goal', description: 'B 的完整隔离目标' });
  await other.settings.put({ key: 'synthetic-other-marker', value: { exact: 'owner B' } });
  shared = new Dexie('youtrace'); shared.version(30).stores({ goals: 'id' }); await shared.open();
  await shared.table('goals').put({ ...legacy, id: 17, description: '无归属旧共享原稿' });
});
beforeEach(async () => {
  localStorage.clear(); api.setSessionActive(owner); sync.pauseSync();
  await storage.clearAllData({ allowPending: true });
  await storage.db.goalRecords.bulkPut([original, neighbor]); await storage.db.table('goals').put(legacy);
  await storage.db.settings.put({ key: `sync-version:goals:${original.id}`, value: '12' });
  store.setState({ items: [], statuses: {}, legacyChanges: [], loaded: false, loading: false, readError: null, publishedRevision: 0 });
  // Finish fixture-only mutation notifications before the actual page subscribes.
  await new Promise(resolve => setTimeout(resolve, 10));
});
after(() => { sync.pauseSync(); storage.db.close(); other.close(); shared.close(); });

for (const phase of ['initial-epoch', 'goal-snapshot', 'after-epoch'] as const) test(`actual Goal first ${phase} failure stays unknown and its original refresh restores exact records without writes`, async context => {
  const before = await snapshots(), monitor = trackWrites(), fault = failReads(phase), tree = await mount();
  try {
    try { await settle(() => fault.count() > 0 && !store.getState().loading && Boolean(store.getState().readError), 'A settled read failure must expose the original retry'); }
    catch (error) { fault.restore(); await unchanged(before, monitor.writes); context.diagnostic(JSON.stringify({ phase, writes: monitor.writes, renderedText: text(tree.root), buttons: tree.root.findAllByType('button').map(node => ({ text: text(node), disabled: node.props.disabled === true })) })); throw error; }
    unknown(tree); fault.restore(); await unchanged(before, monitor.writes);
    // Use the rendered control, never call loadFromDB or setState to recover.
    await act(async () => { button(tree, '刷新核对')!.props.onClick(); });
    await settle(() => store.getState().loaded, 'Original refresh must recover');
    exactRecovered(tree); await unchanged(before, monitor.writes);
  } finally { fault.restore(); monitor.stop(); await act(async () => tree.unmount()); }
});

function holdSnapshotDelivery() {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const database = storage.db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> };
  const transaction = database.transaction; let held = false;
  database.transaction = function (...args) {
    const result = transaction.apply(this, args);
    if (held || args[0] !== 'r' || !Array.isArray(args[1])) return result;
    held = true;
    return result.then(value => Dexie.ignoreTransaction(async () => { entered(); await waiting; return value; }));
  };
  return { started, release, restore: () => { database.transaction = transaction; release(); } };
}

async function failedPage() {
  const fault = failReads('goal-snapshot'), tree = await mount();
  await settle(() => Boolean(store.getState().readError) && !store.getState().loading, 'Initial failed page must settle');
  unknown(tree); fault.restore(); return tree;
}

test('actual Goal repeat refresh callbacks and an older delivered read never supersede the newer exact publication', async () => {
  const tree = await failedPage(), before = await snapshots(), monitor = trackWrites(), held = holdSnapshotDelivery();
  try {
    const click = button(tree, '刷新核对')!.props.onClick;
    await act(async () => { click(); click(); await held.started; });
    assert.equal(button(tree, '刷新核对')!.props.disabled, true);
    assert.equal(store.getState().loaded, false); assert.deepEqual(store.getState().items, []);
    // A retained callback models an already queued retry, not a native click on a disabled button.
    await act(async () => { click(); });
    await settle(() => store.getState().loaded, 'Newer original callback must finish');
    const revision = store.getState().publishedRevision;
    exactRecovered(tree);
    await act(async () => { held.release(); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(store.getState().publishedRevision, revision); exactRecovered(tree); await unchanged(before, monitor.writes);
  } finally { held.restore(); monitor.stop(); await act(async () => tree.unmount()); }
});

for (const invalidation of ['owner', 'reauthentication', 'logout'] as const) test(`actual Goal retry read cannot reveal private rows after ${invalidation}`, async () => {
  const tree = await failedPage(), before = await snapshots(), monitor = trackWrites(), held = holdSnapshotDelivery();
  try {
    await act(async () => { button(tree, '刷新核对')!.props.onClick(); await held.started; });
    await act(async () => {
      api.clearSession();
      if (invalidation !== 'logout') api.setSessionActive(invalidation === 'owner' ? otherOwner : owner);
      held.release(); await new Promise(resolve => setTimeout(resolve, 15));
    });
    await settle(() => !store.getState().loading, 'Invalidated retry must finish');
    assert.equal(store.getState().loaded, false); assert.deepEqual(store.getState().items, []); assert.deepEqual(store.getState().legacyChanges, []);
    assert.doesNotMatch(text(tree.root), /同名目标|第一份完整说明|旧来源原稿|1\/2 完成|平均进度 88%/);
    assert.equal(tree.root.findAllByProps({ role: 'progressbar' }).length, 0); await unchanged(before, monitor.writes);
  } finally { held.restore(); monitor.stop(); await act(async () => tree.unmount()); }
});

test('actual Goal late pre-clear snapshot cannot restore cleared rows over the new epoch', async () => {
  const tree = await failedPage(), held = holdSnapshotDelivery(); let monitor: ReturnType<typeof trackWrites> | undefined;
  try {
    const beforeOther = await snapshot(other), beforeShared = await snapshot(shared);
    await act(async () => { button(tree, '刷新核对')!.props.onClick(); await held.started; });
    // The explicit synthetic clear is the scenario, not an effect of failure/retry.
    await act(async () => { await storage.clearAllData({ allowPending: true }); });
    await settle(() => store.getState().loaded && store.getState().items.length === 0, 'New epoch must publish its own known-empty result');
    const before = await snapshots(), revision = store.getState().publishedRevision; monitor = trackWrites();
    await act(async () => { held.release(); await new Promise(resolve => setTimeout(resolve, 15)); });
    assert.equal(store.getState().publishedRevision, revision); assert.deepEqual(store.getState().items, []); assert.deepEqual(store.getState().legacyChanges, []);
    assert.doesNotMatch(text(tree.root), /第一份完整说明|1\/2 完成|平均进度 88%/);
    assert.equal(tree.root.findAllByProps({ role: 'progressbar' }).length, 0);
    assert.ok(await sameGoalSource(await snapshot(other), beforeOther)); assert.ok(await sameGoalSource(await snapshot(shared), beforeShared));
    assert.deepEqual(await storage.db.table('goals').toArray(), [], 'The explicit clear also removed the current-generation legacy source; the late reader must not restore it'); await unchanged(before, monitor.writes);
  } finally { held.restore(); monitor?.stop(); await act(async () => tree.unmount()); }
});


function holdFailedSnapshotDelivery(window: 'snapshot' | 'error-publication') {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const database = storage.db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> };
  const transaction = database.transaction; let held = false;
  database.transaction = function (...args) {
    const result = transaction.apply(this, args);
    if (held || args[0] !== 'r' || Array.isArray(args[1]) !== (window === 'snapshot')) return result;
    held = true;
    return result.catch(error => Dexie.ignoreTransaction(async () => { entered(); await waiting; throw error; }));
  };
  return { started, release, restore: () => { database.transaction = transaction; release(); } };
}

for (const rejectionWindow of ['snapshot', 'error-publication'] as const) for (const replacement of ['owner', 'reauthentication', 'newer-read', 'clear-epoch'] as const) test(`actual Goal delayed ${rejectionWindow} failure after captured epoch cannot override ${replacement}`, async () => {
  const beforeOther = await snapshot(other), beforeShared = await snapshot(shared);
  const held = holdFailedSnapshotDelivery(rejectionWindow), fault = failReads('after-epoch'), tree = await mount();
  let monitor: ReturnType<typeof trackWrites> | undefined;
  try {
    await act(async () => { await held.started; });
    assert.equal(store.getState().loading, true); assert.equal(store.getState().loaded, false);
    fault.restore();
    if (replacement === 'owner' || replacement === 'reauthentication') {
      api.clearSession(); api.setSessionActive(replacement === 'owner' ? otherOwner : owner);
    } else if (replacement === 'clear-epoch') {
      // Explicit synthetic clearing is outside the subsequent zero-write window.
      await act(async () => { await storage.clearAllData({ allowPending: true }); });
      await settle(() => store.getState().loaded, 'Post-clear observation must finish');
    } else {
      await act(async () => { window.dispatchEvent(new Event('youtrace:data-updated')); });
      await settle(() => store.getState().loaded, 'Newer observation must finish'); exactRecovered(tree);
    }
    const before = await snapshots(), revision = store.getState().publishedRevision; monitor = trackWrites();
    await act(async () => { held.release(); await new Promise(resolve => setTimeout(resolve, 15)); });
    await settle(() => !store.getState().loading, 'Obsolete failure must settle');
    assert.equal(store.getState().readError, null, 'Obsolete failure must not overwrite the replacement state');
    if (replacement === 'newer-read') { assert.equal(store.getState().publishedRevision, revision); exactRecovered(tree); }
    else {
      assert.deepEqual(store.getState().items, []); assert.deepEqual(store.getState().legacyChanges, []);
      assert.doesNotMatch(text(tree.root), /第一份完整说明|1\/2 完成|平均进度 88%/);
      assert.equal(store.getState().loaded, replacement === 'clear-epoch');
      if (replacement === 'clear-epoch') assert.equal(store.getState().publishedRevision, revision);
    }
    assert.ok(await sameGoalSource(await snapshot(other), beforeOther)); assert.ok(await sameGoalSource(await snapshot(shared), beforeShared));
    await unchanged(before, monitor.writes);
  } finally { fault.restore(); held.restore(); monitor?.stop(); await act(async () => tree.unmount()); }
});

// DOM-path model over real component host output; no native layout claim.
test('actual Goal first post-reload feedback cannot invalidate the progress identity witness', async context => {
  // Motion's scroll observation needs a host document even without DOM refs.
  Object.assign(globalThis, { document: { documentElement: { scrollLeft: 0, scrollTop: 0 }, body: { scrollLeft: 0, scrollTop: 0 } } });
  const tree = await mount();
  type Host = { type: string; props: Record<string, unknown>; children: Array<Host | string> | null };
  const snapshot = () => tree.toJSON() as unknown as Host;
  const children = (node: Host) => (node.children ?? []).filter((row): row is Host => typeof row !== 'string');
  const walk = (node: Host): Host[] => [node, ...children(node).flatMap(walk)];
  const content = (node: Host): string => (node.children ?? []).map(row => typeof row === 'string' ? row : content(row)).join('');
  const isOriginal = (node: Host) => node.props['data-component'] === 'goal-card' && walk(node).some(row => row.type === 'p' && content(row) === original.description);
  const locate = (node: Host, path: Array<{ tag: string; nth: number }> = []): Array<{ tag: string; nth: number }> | undefined => {
    if (isOriginal(node)) return path;
    const counts = new Map<string, number>();
    for (const row of children(node)) { const nth = (counts.get(row.type) ?? 0) + 1; counts.set(row.type, nth); const found = locate(row, [...path, { tag: row.type, nth }]); if (found) return found; }
  };
  const resolve = (root: Host, path: Array<{ tag: string; nth: number }>) => path.reduce<Host | undefined>((node, step) => node && children(node).filter(row => row.type === step.tag)[step.nth - 1], root);
  try {
    await settle(() => store.getState().loaded, 'The original unmodified component must load');
    const before = snapshot(), originalPath = locate(before)!;
    assert.ok(originalPath.length > 0); assert.equal(walk(before).filter(node => node.props.role === 'status' && content(node).includes('进度已保存')).length, 0);
    const originalCard = tree.root.findAll(node => typeof node.type === 'string' && node.props['data-component'] === 'goal-card').find(node => text(node).includes(original.description))!;
    await act(async () => { originalCard.findAllByType('button').find(node => node.props['aria-label'] === '将目标进度设为 100%')!.props.onClick(); });
    await settle(() => store.getState().items.find(row => row.id === original.id)?.progress === 100 && text(tree.root).includes('进度已保存'), 'Actual progress save and feedback must finish');
    const after = snapshot(), movedPath = locate(after)!;
    const source = await storage.db.goalRecords.get(original.id); assert.equal(source?.progress, 100);
    assert.equal((await storage.db.goalRecords.get(neighbor.id))?.progress, neighbor.progress);
    const remembered = resolve(after, originalPath);
    const oldValue = remembered && walk(remembered).find(node => node.props.role === 'progressbar')?.props['aria-valuenow'];
    context.diagnostic(JSON.stringify({ kind: 'actual-component-host-tree-path-model', originalPath, movedPath, oldValue: oldValue ?? null, actualProgress: source.progress, feedback: true }));
    assert.equal(oldValue, undefined, 'The archived native nth path loses the real card when ordinary feedback inserts a div');
    assert.notDeepEqual(movedPath, originalPath);
    const adapter = (node: Host): { innerText: string; querySelector: (selector: string) => unknown; querySelectorAll: (selector: string) => unknown[]; getAttribute: (name: string) => string | null } => {
      const matching = (selector: string) => walk(node).slice(1).filter(row => selector === '[role=progressbar]' ? row.props.role === 'progressbar' : row.type === selector);
      return { innerText: content(node), getAttribute: name => node.props[name] === undefined ? null : String(node.props[name]), querySelector: selector => { const found = matching(selector)[0]; return found ? adapter(found) : null; }, querySelectorAll: selector => matching(selector).map(adapter) };
    };
    const document = { querySelectorAll: (selector: string) => {
      assert.equal(selector, '[data-component="goal-workspace"] [data-component="goal-card"]');
      return walk(after).filter(node => node.props['data-component'] === 'goal-card').map(adapter);
    } };
    const ready = runInNewContext(`(${goalProgressMatchesIdentity.toString()})`, { document });
    assert.equal(ready({ identity: original, value: 100 }), true, 'The same actual host card is found by its unchanged visible identity after save');
    assert.equal(ready({ identity: original, value: 75 }), false);
  } finally { await act(async () => tree.unmount()); }
});
