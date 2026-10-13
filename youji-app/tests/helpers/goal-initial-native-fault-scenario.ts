import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { installGoalInitialReadFault } from '../../scripts/audit-goal-initial-read.mjs';
const memory = () => { const entries = new Map<string, string>(); return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { location: { replace() {} } }), fetch: () => { throw Error('No network in exact Goal native-fault module contract'); } });
const storage = await import('../../src/db/index.ts');
const session = await import('../../src/services/apiClient.ts');
const sync = await import('../../src/services/syncEngine.ts');
const { useGoalStore: store, loadRequiredGoals } = await import('../../src/stores/goalStore.ts');
const owner = 'synthetic-goal-native-module';
await storage.bindAccountDatabase(owner); session.setSessionActive(owner); sync.pauseSync();
const original = { id: 'synthetic-goal-native-module-id', title: '合成原文', description: '完整说明\n第二行', level: 'short' as const, domain: '学习', priority: 'high' as const, progress: 25, targetDate: '2027-03-14', createdAt: 12, updatedAt: 34, syncScope: 'local' as const, unknown: { retained: undefined } };
await storage.db.goalRecords.put(original);
const snapshot = () => storage.db.transaction('r', storage.db.tables, async () => Object.fromEntries(await Promise.all(storage.db.tables.map(async table => [table.name, { keys: await table.toCollection().primaryKeys(), rows: await table.toArray() }]))));
const before = await snapshot(), fault = installGoalInitialReadFault({ databaseName: storage.db.name });
try {
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(loadRequiredGoals());
    assert.equal(store.getState().loaded, false); assert.equal(store.getState().loading, false);
    assert.deepEqual(store.getState().items, []); assert.ok(store.getState().readError);
    assert.deepEqual(await snapshot(), before, 'Every current-owner table/key/value remains exact');
  }
  const failed = fault.snapshot(); assert.equal(failed.hits.length, 2); assert.ok(failed.hits.every((hit: { terminal: string }) => hit.terminal === 'abort')); assert.deepEqual(failed.writes, []);
  fault.release(); assert.equal(fault.snapshot().restored, true);
  await loadRequiredGoals(); assert.equal(store.getState().loaded, true); assert.equal(store.getState().readError, null); assert.deepEqual(store.getState().items, [original]);
  assert.deepEqual(await snapshot(), before);
  console.log(JSON.stringify({ status: 'passed', actualModules: true, fakeIndexedDB: true, browser: false, actualGoalSnapshotAborts: failed.hits.length, writes: failed.writes.length, sameOriginalId: store.getState().items[0].id === original.id }));
} finally { fault.release(); sync.pauseSync(); session.clearSession(); storage.db.close(); }
