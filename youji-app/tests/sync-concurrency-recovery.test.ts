import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
};
Object.assign(globalThis, {
  localStorage: memoryStorage(), sessionStorage: memoryStorage(),
  window: Object.assign(new EventTarget(), { location: { replace() {} } }),
});
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const owner = 'synthetic-concurrency-owner';

before(async () => { await storage.bindAccountDatabase(owner); api.setSessionActive(owner); });
after(() => { sync.pauseSync(); storage.db.close(); });

function todoEvent(seq: string, entityId: string) {
  return { seq, entity: 'todos', entityId, operation: 'upsert', data: { id: entityId, userId: owner, text: `Synthetic ${entityId}`, priority: 'medium', done: false } };
}

test('durable reset epoch fences a pre-clear pull without relying on a tab-local pause', async () => {
  await storage.db.todos.put({ id: 'prior-page-row', text: 'Old cached row', priority: 'medium', done: false });
  await storage.db.settings.put({ key: 'syncV2Cursor', value: '5' });
  await storage.db.settings.put({ key: 'sync-version:todos:prior-page-row', value: '5' });
  let signalRequest!: () => void;
  let releaseResponse!: (response: Response) => void;
  const requested = new Promise<void>((resolve) => { signalRequest = resolve; });
  globalThis.fetch = async (path) => {
    assert.ok(String(path).includes('cursor=5'));
    signalRequest();
    return new Promise<Response>((resolve) => { releaseResponse = resolve; });
  };
  const delayedPull = sync.pullServerChanges();
  await requested;
  // A second tab clearing the same IndexedDB cannot increment this module's
  // in-memory generation. Only the durable epoch can reject this old response.
  await storage.clearAllData();
  const epoch = await storage.getSetting<string>(storage.LOCAL_DATA_EPOCH_KEY, '');
  assert.ok(epoch);
  releaseResponse(Response.json({ protocol: 2, features: ['goals-v1'], events: [todoEvent('6', 'later-page-row')], nextCursor: '6', hasMore: false }));
  await delayedPull;
  assert.equal(await storage.db.todos.count(), 0, 'old page must not repopulate a just-cleared database');
  assert.equal(await storage.getSetting('syncV2Cursor', '0'), '0', 'old response must not skip the erased earlier page');
  assert.equal(await storage.getSetting(storage.LOCAL_DATA_EPOCH_KEY, ''), epoch);

  globalThis.fetch = async (path) => {
    assert.ok(String(path).includes('cursor=0'));
    return Response.json({ protocol: 2, features: ['goals-v1'], events: [todoEvent('5', 'prior-page-row'), todoEvent('6', 'later-page-row')], nextCursor: '6', hasMore: false });
  };
  await sync.pullServerChanges();
  assert.equal(await storage.db.todos.count(), 2);
  assert.equal(await storage.getSetting('syncV2Cursor', '0'), '6');
});

test('remote parent deletion preserves a pending child until explicit resolution saves a recovery copy', async () => {
  await storage.clearAllData();
  sync.pauseSync();
  const habitId = 'pending-child-habit', date = '2026-10-04', childId = `${habitId}|${date}`;
  const child = { id: childId, habitId, date, done: true, source: 'manual' as const, confirmed: true, updatedAt: 1 };
  await storage.db.habits.put({ id: habitId, name: 'Synthetic habit', icon: 'H', frequency: 'daily', sortOrder: 0, createdAt: 1 });
  await storage.db.habitCheckins.put(child);
  await storage.db.settings.bulkPut([
    { key: `sync-version:habits:${habitId}`, value: '10' },
    { key: `sync-version:habitCheckins:${childId}`, value: '11' },
    { key: 'syncV2Cursor', value: '11' },
  ]);
  await storage.db.transaction('rw', storage.db.outbox, storage.db.settings, async () => {
    await sync.enqueueSync('habitCheckins', 'upsert', child);
  });
  globalThis.fetch = async (path, init) => {
    if (String(path).includes('/sync/push')) {
      const payload = JSON.parse(String(init?.body)) as { mutationId: string };
      return Response.json({ acknowledged: false, mutationId: payload.mutationId, error: 'Synthetic missing parent', code: 'MISSING_PARENT', conflict: { entity: 'habitCheckins', entityId: childId } }, { status: 409 });
    }
    assert.ok(String(path).includes('cursor=11'));
    return Response.json({ protocol: 2, features: ['goals-v1'], events: [
      { seq: '12', entity: 'habitCheckins', entityId: childId, operation: 'delete', data: null },
      { seq: '13', entity: 'habits', entityId: habitId, operation: 'delete', data: null },
    ], nextCursor: '13', hasMore: false });
  };
  await sync.bootstrapSync();
  assert.equal(await storage.db.outbox.count(), 1);
  assert.equal((await storage.db.habitCheckins.get(childId))?.done, true, 'pending local child remains visible/recoverable');
  assert.ok(await storage.db.habits.get(habitId), 'parent must survive while its local child is pending');
  assert.ok(await storage.db.settings.get(`sync-conflict:habitCheckins:${childId}`));
  const parentConflict = `sync-conflict:habits:${habitId}`;
  assert.ok(await storage.db.settings.get(parentConflict));
  assert.equal(await storage.getSetting('syncV2Cursor', '0'), '13');
  assert.equal(await storage.getSetting(`sync-version:habitCheckins:${childId}`, '0'), '11', 'remote deletion must not silently rebase the pending child');

  await sync.acceptRemoteConflict(parentConflict, (await sync.readConflictSnapshot(parentConflict))!);
  assert.equal(await storage.db.habits.get(habitId), undefined);
  assert.equal(await storage.db.habitCheckins.get(childId), undefined);
  assert.equal(await storage.db.outbox.count(), 0);
  const copies = (await storage.db.settings.toArray()).filter((row) => row.key.startsWith('sync-recovery:'));
  assert.equal(copies.length, 1);
  const recovery = copies[0].value as { local: { id: string }; mutations: Array<{ entity: string; payload: typeof child }> };
  assert.equal(recovery.local.id, habitId);
  assert.equal(recovery.mutations.length, 1);
  assert.equal(recovery.mutations[0].entity, 'habitCheckins');
  assert.deepEqual(recovery.mutations[0].payload, child, 'explicit resolution retains the exact unsent child draft');
});

test('accepting a parent habit update preserves independent pending child checkins', async () => {
  const storage = await import('../src/db/index.ts');
  const sync = await import('../src/services/syncEngine.ts');
  const database = storage.db;
  await database.outbox.clear();
  await database.settings.delete('syncV2Batch');
  const habitId = 'parent-upsert-001', childId = `${habitId}|2026-10-04`;
  await database.habits.put({ id: habitId, name: 'local name', icon: 'x', frequency: 'daily', sortOrder: 0, createdAt: 1 });
  await database.habitCheckins.put({ id: childId, habitId, date: '2026-10-04', done: true, source: 'manual', confirmed: true, updatedAt: 1 });
  await database.outbox.add({ entity: 'habitCheckins', op: 'upsert', payload: { habitId, date: '2026-10-04', done: true }, queuedAt: 1, baseVersion: '0' });
  const key = `sync-conflict:habits:${habitId}`;
  await database.settings.put({ key, value: { event: { seq: '999', entity: 'habits', entityId: habitId, operation: 'upsert', data: { id: habitId, name: 'remote name', icon: 'x', frequency: 'daily', sortOrder: 0, createdAt: 1 } }, receivedAt: 1 } });
  await sync.acceptRemoteConflict(key, (await sync.readConflictSnapshot(key))!);
  assert.equal(await database.outbox.count(), 1);
  assert.equal((await database.habitCheckins.get(childId))?.done, true);
  assert.equal((await database.habits.get(habitId))?.name, 'remote name');
});
