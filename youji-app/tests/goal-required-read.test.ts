import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import Dexie from 'dexie';
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { location: { replace() {} } }), fetch: () => { throw new Error('No network in required Goal read tests'); } });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { useGoalStore: store, loadRequiredGoals } = await import('../src/stores/goalStore.ts');
const { sameGoalSource } = await import('../src/services/goalSource.ts');
const owner = 'synthetic-required-goal-a', otherOwner = 'synthetic-required-goal-b';
const original = { id: 'synthetic-required-exact-id', title: 'Exact synthetic Goal', description: 'Full source\nsecond line', level: 'short' as const, priority: 'high' as const, domain: '学习', progress: 25, targetDate: '2027-03-14', createdAt: 17, updatedAt: 29, syncScope: 'local' as const, unknown: new Map([['bytes', new Uint8Array([1, 4, 7])]]) };
let shared: Dexie, other: InstanceType<typeof storage.YoujiDatabase>;
function barrier() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  return { enter, release, entered, waiting };
}
async function snapshot() {
  const database = storage.db;
  return database.transaction('r', database.tables, async () => Object.fromEntries(await Promise.all(database.tables.map(async table => [table.name, { keys: await table.toCollection().primaryKeys(), values: await table.toArray() }]))));
}
async function readOnly(operation: () => Promise<void>) {
  const before = await snapshot(), writes: string[] = [], cleanups: Array<() => void> = [];
  for (const table of storage.db.tables) for (const event of ['creating', 'updating', 'deleting'] as const) {
    const record = () => { writes.push(`${table.name}:${event}`); };
    table.hook(event, record); cleanups.push(() => table.hook(event).unsubscribe(record));
  }
  try {
    await operation(); assert.deepEqual(writes, []);
    assert.ok(await sameGoalSource(await snapshot(), before), 'All current physical keys/values, including settings/outbox/receipts, stay exact');
  } finally { cleanups.forEach(cleanup => cleanup()); }
}
before(async () => {
  await storage.bindAccountDatabase(owner); api.setSessionActive(owner);
  other = new storage.YoujiDatabase(otherOwner); await other.open();
  await other.goalRecords.put({ ...original, id: 'synthetic-required-b-id' });
  shared = new Dexie('youtrace'); shared.version(30).stores({ goals: 'id' }); await shared.open(); await shared.table('goals').put({ ...original, id: 17 });
});
beforeEach(async () => {
  await storage.bindAccountDatabase(owner); api.setSessionActive(owner); sync.pauseSync();
  await storage.clearAllData({ allowPending: true });
  await storage.db.goalRecords.put(original); await storage.db.table('goals').put({ ...original, description: 'Unchanged old source' });
  await storage.db.settings.put({ key: 'synthetic-retained-metadata', value: { exact: true } });
  store.setState({ items: [], statuses: {}, legacyChanges: [], loaded: false, loading: false, readError: null, publishedRevision: 0 });
});
after(() => { sync.pauseSync(); storage.db.close(); shared.close(); other.close(); });

test('required default loader reads and publishes the exact Goal without any writes', async () => {
  await readOnly(async () => { await loadRequiredGoals(); assert.deepEqual(store.getState().items, [original]); assert.ok(store.getState().publishedRevision > 0); });
});

test('public loaded/revision fields cannot forge a current internal publication', async () => {
  store.setState({ loaded: true, publishedRevision: 9001, items: [original] });
  await readOnly(async () => { await assert.rejects(loadRequiredGoals(async () => undefined)); });
});

for (const field of ['loaded', 'publishedRevision'] as const) test(`required proof rejects a mismatched public ${field}`, async () => {
  await store.getState().loadFromDB();
  store.setState(field === 'loaded' ? { loaded: false } : { publishedRevision: store.getState().publishedRevision + 1 });
  await readOnly(async () => { await assert.rejects(loadRequiredGoals(async () => undefined)); });
});

test('required availability retains a trusted cache and the real failed refresh notice', async () => {
  await store.getState().loadFromDB(); const revision = store.getState().publishedRevision;
  const read = storage.db.goalRecords.toArray;
  await readOnly(async () => {
    storage.db.goalRecords.toArray = () => Promise.reject(new DOMException('Synthetic Goal snapshot failure', 'AbortError'));
    try { await loadRequiredGoals(); } finally { storage.db.goalRecords.toArray = read; }
    assert.equal(store.getState().publishedRevision, revision); assert.deepEqual(store.getState().items, [original]); assert.ok(store.getState().readError);
  });
});

test('a prior actual publication cannot authorize required entry after clear epoch changes', async () => {
  await store.getState().loadFromDB();
  // Synthetic peer epoch advance belongs to setup, outside the zero-write window.
  await storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'synthetic-peer-cleared' });
  await readOnly(async () => { await assert.rejects(loadRequiredGoals(async () => undefined), /已清除/); });
});

test('extra epoch verification failure rejects after the actual reader has run', async () => {
  const get = storage.db.settings.get;
  await readOnly(async () => {
    let read = false;
    try {
      await assert.rejects(loadRequiredGoals(async () => {
        await store.getState().loadFromDB(); read = true;
        storage.db.settings.get = () => Promise.reject(new DOMException('Synthetic final epoch verification failure', 'AbortError'));
      }), /Synthetic final epoch verification failure/);
      assert.equal(read, true); assert.deepEqual(store.getState().items, [original]);
    } finally { storage.db.settings.get = get; }
  });
});

for (const change of ['owner', 'generation'] as const) test(`a changed ${change} cannot authorize an older required call`, async () => {
  const gate = barrier();
  const pending = loadRequiredGoals(async () => { await store.getState().loadFromDB(); gate.enter(); await gate.waiting; });
  const rejected = assert.rejects(pending, /账号或本机资料已变化/);
  await gate.entered;
  // A different owner must reload to bind its database. The obsolete document
  // fails closed; a same-owner generation can really publish a newer snapshot.
  api.setSessionActive(change === 'owner' ? otherOwner : owner);
  await store.getState().loadFromDB(); const current = store.getState();
  gate.release(); await rejected;
  assert.equal(store.getState(), current, 'Required guard does not overwrite the newer account/result');
});

// Hold only promise delivery after the final real readonly transaction closes;
// no native keepalive or synthetic transaction-success event is introduced.
for (const change of ['same-epoch-publication', 'new-epoch-publication', 'generation', 'owner'] as const) test(`required final await revalidates ${change}`, async () => {
  const database = storage.db, transaction = database.transaction, gate = barrier(); let armed = false, held = false;
  database.transaction = function (...args: Parameters<typeof transaction>) {
    const result = transaction.apply(this, args);
    if (!armed || held || args[0] !== 'r' || args[1] !== database.settings) return result;
    held = true;
    return result.then(value => Dexie.ignoreTransaction(async () => { gate.enter(); await gate.waiting; return value; }));
  } as typeof transaction;
  const pending = loadRequiredGoals(async () => { await store.getState().loadFromDB(); armed = true; });
  const outcome = change === 'same-epoch-publication' ? pending : assert.rejects(pending);
  try {
    await gate.entered;
    if (change === 'new-epoch-publication') await database.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'synthetic-later-epoch' });
    // A different owner must reload to bind its database. The obsolete document
  // fails closed; a same-owner generation can really publish a newer snapshot.
    if (change === 'generation' || change === 'owner') api.setSessionActive(change === 'owner' ? otherOwner : owner);
    await store.getState().loadFromDB(); const latest = store.getState();
    gate.release(); await outcome;
    assert.equal(store.getState(), latest);
    assert.deepEqual(latest.items, change === 'owner' ? [] : [original]);
  } finally { database.transaction = transaction; gate.release(); }
});
