import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import Dexie from 'dexie';
const memory = () => { const entries = new Map<string, string>(); return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key), clear: () => entries.clear() }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { location: { replace() {} } }), fetch: () => { throw new Error('No network in Goal integrity tests'); } });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { useGoalStore: store, legacyGoalChanges, resolveLegacyGoalChange, cloneGoalSnapshot, cloneLegacyGoalChange, startGoalObservation } = await import('../src/stores/goalStore.ts');
const { sameGoalSource } = await import('../src/services/goalSource.ts');
const owner = 'synthetic-goal-integrity-owner';
const input = { title: 'Exact synthetic goal', description: 'Only this draft', level: 'short' as const, domain: '生活', priority: 'medium' as const, targetDate: null };
const row = (id = 'synthetic-goal-original') => ({ ...input, id, createdAt: 1, updatedAt: 2, progress: 25, syncScope: 'local' as const });
function barrier() {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, started, waiting };
}
/** Delivery delay begins after the real transaction closes, like a later JS turn.
 * A simulated peer runs outside Dexie's ambient transaction, like a separate tab.
 */
function holdTransaction(mode: 'r' | 'rw', occurrence = 1) {
  const gate = barrier();
  const database = storage.db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> };
  const old = database.transaction;
  let count = 0;
  database.transaction = function (...args) {
    const result = old.apply(this, args);
    if (args[0] !== mode || ++count !== occurrence) return result;
    return result.then(value => Dexie.ignoreTransaction(async () => { gate.entered(); await gate.waiting; return value; }));
  };
  return { ...gate, restore: () => { database.transaction = old; gate.release(); } };
}
function holdActorRead() {
  const gate = barrier(), old = storage.db.settings.get;
  let first = true;
  storage.db.settings.get = async function (...args: Parameters<typeof old>) {
    const result = await old.apply(this, args);
    if (first && args[0] === storage.LOCAL_DATA_EPOCH_KEY) { first = false; gate.entered(); await gate.waiting; }
    return result;
  } as typeof old;
  return { ...gate, restore: () => { storage.db.settings.get = old; gate.release(); } };
}
async function seed(value = row()) {
  await storage.db.goalRecords.put(value);
  await store.getState().loadFromDB();
  return cloneGoalSnapshot(store.getState().items.find(item => item.id === value.id)!);
}
async function seedLegacy() {
  await storage.db.table('goals').put(row());
  return cloneLegacyGoalChange((await legacyGoalChanges())[0]);
}
async function settled(predicate: () => boolean) {
  const end = Date.now() + 1500;
  while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), 'observation did not settle');
}
before(async () => { await storage.bindAccountDatabase(owner); sync.pauseSync(); });
beforeEach(async () => {
  localStorage.clear(); api.setSessionActive(owner); sync.pauseSync();
  await storage.clearAllData({ allowPending: true });
  store.setState({ items: [], statuses: {}, legacyChanges: [], loaded: false, loading: false, readError: null });
});
after(() => { sync.pauseSync(); storage.db.close(); });

for (const [name, change] of Object.entries({
  logout: () => api.clearSession(),
  owner: () => api.setSessionActive('synthetic-other-owner'),
  reauthentication: () => { api.clearSession(); api.setSessionActive(owner); },
  revision: () => localStorage.setItem(api.SESSION_REVISION_KEY, 'synthetic-revision'),
  signedOut: () => localStorage.setItem(api.SIGNED_OUT_KEY, 'true'),
  clear: () => storage.clearAllData({ allowPending: true }),
})) {
  test(`goal integrity: delayed load never republishes after ${name}`, async () => {
    await seed(); const held = holdTransaction('r');
    try {
      const pending = store.getState().loadFromDB(); await held.started;
      await change(); held.release(); await pending;
      assert.deepEqual(store.getState().items, []);
      assert.deepEqual(store.getState().legacyChanges, []);
    } finally { held.restore(); }
  });
  test(`goal integrity: durable create reports changed context without ghost after ${name}`, async () => {
    const held = holdTransaction('rw');
    try {
      const pending = store.getState().addGoal(input); await held.started;
      await change(); held.release(); const result = await pending;
      assert.equal(result.committed, true); assert.equal(result.view, 'context-changed');
      assert.deepEqual(store.getState().items, []);
      assert.equal(await storage.db.goalRecords.count(), name === 'clear' ? 0 : 1);
    } finally { held.restore(); }
  });
}

test('goal integrity: newer completed snapshot wins and statuses/source changes share its view', async () => {
  const source = await seed(); const held = holdTransaction('r');
  try {
    const pending = store.getState().loadFromDB(); await held.started;
    await storage.db.goalRecords.update(source.id, { progress: 100, syncScope: 'account' });
    await storage.db.settings.put({ key: `sync-version:goals:${source.id}`, value: '9' });
    await storage.db.table('goals').put({ ...source, title: 'New old source' });
    await store.getState().loadFromDB();
    held.release(); await pending;
    assert.equal(store.getState().items[0].progress, 100);
    assert.equal(store.getState().statuses[source.id], '已同步');
    assert.equal(store.getState().legacyChanges[0].current?.progress, 100);
  } finally { held.restore(); }
});

for (const [name, loseActor] of Object.entries({ logout: () => api.clearSession(), owner: () => api.setSessionActive('other-synthetic-owner'), signedOut: () => localStorage.setItem(api.SIGNED_OUT_KEY, 'true') })) {
  for (const operation of ['edit', 'delete', 'enroll', 'copy', 'keep', 'read-source'] as const) {
    test(`goal integrity: ${operation} rejects ${name} despite bound account DB`, async () => {
      const original = await seed(), preview = await seedLegacy();
      loseActor();
      const action = () => operation === 'edit' ? store.getState().updateGoal(original.id, { title: 'Rejected' }, original) : operation === 'delete' ? store.getState().removeGoal(original.id, original) : operation === 'enroll' ? store.getState().enableSync([original], owner) : operation === 'read-source' ? legacyGoalChanges() : resolveLegacyGoalChange(preview, operation, owner);
      await assert.rejects(action, /账号/);
      assert.equal((await storage.db.goalRecords.get(original.id))?.title, original.title);
      assert.equal(await storage.db.goalRecords.count(), 1); assert.equal(await storage.db.outbox.count(), 0);
      assert.equal(await storage.db.settings.where('key').startsWith('goal-source-recovery:').count(), 0);
    });
  }
}

for (const operation of ['edit', 'delete', 'enroll', 'copy', 'keep'] as const) {
  test(`goal integrity: opened ${operation} snapshot rejects same-owner reauthentication`, async () => {
    const source = await seed(), preview = await seedLegacy();
    api.clearSession(); api.setSessionActive(owner);
    const action = () => operation === 'edit' ? store.getState().updateGoal(source.id, { title: 'Rejected' }, source) : operation === 'delete' ? store.getState().removeGoal(source.id, source) : operation === 'enroll' ? store.getState().enableSync([source], owner) : resolveLegacyGoalChange(preview, operation, owner);
    await assert.rejects(action, /账号/);
    assert.equal(await storage.db.goalRecords.count(), 1); assert.equal(await storage.db.outbox.count(), 0);
  });
  test(`goal integrity: ${operation} rolls back authority loss during final physical writes`, async () => {
    const source = await seed(), preview = await seedLegacy();
    const revoke = () => { api.clearSession(); api.setSessionActive(owner); };
    const table = operation === 'enroll' ? storage.db.outbox : operation === 'keep' ? storage.db.settings : storage.db.goalRecords;
    const event = operation === 'edit' ? 'updating' : operation === 'delete' ? 'deleting' : 'creating';
    table.hook(event, revoke);
    try {
      const action = () => operation === 'edit' ? store.getState().updateGoal(source.id, { title: 'Rejected' }, source) : operation === 'delete' ? store.getState().removeGoal(source.id, source) : operation === 'enroll' ? store.getState().enableSync([source], owner) : resolveLegacyGoalChange(preview, operation, owner);
      await assert.rejects(action, /账号/);
    } finally { table.hook(event).unsubscribe(revoke); }
    assert.equal((await storage.db.goalRecords.get(source.id))?.title, source.title);
    assert.equal(await storage.db.goalRecords.count(), 1); assert.equal(await storage.db.outbox.count(), 0);
    assert.equal(await storage.db.settings.where('key').startsWith('goal-source-recovery:').count(), 0);
    assert.equal(await storage.db.settings.where('key').startsWith('goal-local-copy:').count(), 0);
  });
}

test('goal integrity: final epoch read actor change rolls back a local edit', async () => {
  const source = await seed(); const old = storage.db.settings.get;
  let reads = 0;
  storage.db.settings.get = async function (...args: Parameters<typeof old>) {
    const value = await old.apply(this, args);
    if (args[0] === storage.LOCAL_DATA_EPOCH_KEY && ++reads === 7) { api.clearSession(); api.setSessionActive(owner); }
    return value;
  } as typeof old;
  try { await assert.rejects(store.getState().updateGoal(source.id, { title: 'Rejected' }, source), /账号/); }
  finally { storage.db.settings.get = old; }
  assert.equal((await storage.db.goalRecords.get(source.id))?.title, source.title);
});

test('goal integrity: clear epoch written inside final goal hook rolls back the whole mutation', async () => {
  const source = await seed();
  const changeEpoch = () => { void storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'changed-by-test-in-transaction' }); };
  storage.db.goalRecords.hook('updating', changeEpoch);
  try { await assert.rejects(store.getState().updateGoal(source.id, { progress: 75 }, source), /清除/); }
  finally { storage.db.goalRecords.hook('updating').unsubscribe(changeEpoch); }
  assert.equal((await storage.db.goalRecords.get(source.id))?.progress, 25);
});

test('goal integrity: operation freezes nested source and update before initial awaited actor read', async () => {
  const original = { ...row(), privateMap: new Map([['note', 'first']]) };
  await storage.db.goalRecords.put(original);
  const updates = { title: 'Intended title' }, held = holdActorRead();
  try {
    const pending = store.getState().updateGoal(original.id, updates, original); await held.started;
    original.privateMap.set('note', 'mutated caller'); updates.title = 'Late caller title';
    held.release(); await pending;
    const saved = await storage.db.goalRecords.get(original.id) as typeof original;
    assert.equal(saved.title, 'Intended title'); assert.equal(saved.privateMap.get('note'), 'first');
  } finally { held.restore(); }
});

test('goal integrity: old full source rejects Map and Blob peer changes without overwriting BigInt metadata', async () => {
  const original = { ...row(), privateMap: new Map([['note', 'first']]), privateBlob: new Blob(['first']), privateBigInt: 12345678901234567890123456789n };
  await storage.db.goalRecords.put(original);
  await store.getState().loadFromDB(); const opened = cloneGoalSnapshot(store.getState().items[0]);
  await storage.db.goalRecords.put({ ...original, privateMap: new Map([['note', 'newer']]), privateBlob: new Blob(['newer']) });
  await assert.rejects(store.getState().updateGoal(original.id, { title: 'Old window' }, opened), /刚刚/);
  await assert.rejects(store.getState().removeGoal(original.id, opened), /刚刚/);
  assert.equal((await storage.db.goalRecords.get(original.id) as typeof original).privateMap.get('note'), 'newer');
  await storage.db.goalRecords.delete(original.id);
  await assert.rejects(store.getState().updateGoal(original.id, { title: 'Resurrect' }, opened), /不存在/);
  await assert.rejects(store.getState().removeGoal(original.id, opened), /不存在/);
});

for (const dateForm of ['empty', 'absent', 'undefined', 'null'] as const) test(`goal integrity: selected enrollment canonicalizes ${dateForm} date and preserves exact originals and neighbors`, async () => {
  const original = { ...row(), privateMap: new Map([['note', 'first']]), privateBlob: new Blob(['bytes']), privateBigInt: 99999999999999999999n, privateSet: new Set([1, 2]), committed: 'real-legacy-value', view: 'also-real', alreadyCommitted: 'retain-me' };
  if (dateForm === 'absent') Reflect.deleteProperty(original, 'targetDate');
  else Reflect.set(original, 'targetDate', dateForm === 'empty' ? '' : dateForm === 'undefined' ? undefined : null);
  const dated = { ...row('synthetic-dated'), targetDate: '2026-10-31' };
  const unselected = { ...row('synthetic-unselected'), targetDate: '', privateMap: new Map([['unselected', 'exact']]) };
  const originals = [dated, original, unselected];
  await storage.db.goalRecords.bulkPut(originals);
  await storage.db.table('goals').bulkPut(originals);
  await store.getState().loadFromDB();
  const selected = [dated, original].map(source => cloneGoalSnapshot(store.getState().items.find(item => item.id === source.id)!));
  const first = await store.getState().enableSync(selected, owner);
  assert.equal(first.alreadyCommitted, false); assert.equal(first.view, 'current');
  const backup = (await storage.db.settings.get(`goal-local-copy:${original.id}`))!.value as { original: typeof original; enrolled: typeof original };
  assert.ok(await sameGoalSource(backup.original, original));
  assert.equal(Object.hasOwn(backup.original, 'targetDate'), dateForm !== 'absent');
  const canonical = { ...original, targetDate: null, syncScope: 'account' };
  assert.ok(await sameGoalSource(await storage.db.goalRecords.get(original.id), canonical));
  assert.ok(await sameGoalSource(backup.enrolled, canonical));
  assert.deepEqual(await storage.db.goalRecords.get(dated.id), { ...dated, syncScope: 'account' });
  const queue = await storage.db.outbox.toArray();
  assert.equal(queue.length, 2);
  for (const { payload } of queue) assert.deepEqual(Object.keys(payload as object).sort(), ['id', 'title', 'description', 'level', 'domain', 'priority', 'progress', 'targetDate', 'createdAt'].sort());
  const payloads = queue.map(entry => entry.payload as { id: string; targetDate: string | null });
  assert.equal(payloads.find(payload => payload.id === original.id)?.targetDate, null);
  assert.equal(payloads.find(payload => payload.id === dated.id)?.targetDate, dated.targetDate);
  assert.ok(await sameGoalSource(await storage.db.goalRecords.get(unselected.id), unselected));
  assert.equal(await storage.db.settings.get(`goal-local-copy:${unselected.id}`), undefined);
  for (const source of originals) assert.ok(await sameGoalSource(await storage.db.table('goals').get(source.id), source));
  assert.equal((cloneGoalSnapshot(store.getState().items.find(item => item.id === original.id)!) as typeof original).view, 'also-real');
  const repeated = await store.getState().enableSync(selected, owner);
  assert.equal(repeated.alreadyCommitted, true); assert.deepEqual(await storage.db.outbox.toArray(), queue);
  assert.ok(await sameGoalSource((await storage.db.settings.get(`goal-local-copy:${original.id}`))!.value, backup));
  await store.getState().removeGoal(original.id, cloneGoalSnapshot(store.getState().items.find(item => item.id === original.id)!));
  const afterDelete = await storage.db.outbox.toArray();
  await assert.rejects(store.getState().enableSync(selected, owner), /刚刚更新/);
  assert.equal(await storage.db.goalRecords.get(original.id), undefined);
  assert.deepEqual(await storage.db.outbox.toArray(), afterDelete);
  assert.ok(await sameGoalSource((await storage.db.settings.get(`goal-local-copy:${original.id}`))!.value, backup));
});

for (const drift of ['equivalent-date', 'unknown-field'] as const) test(`goal integrity: enrollment refuses ${drift} source drift before canonicalizing`, async () => {
  const original = { ...row(), targetDate: '', privateMap: new Map([['note', 'first']]) };
  const opened = await seed(original);
  const changed = drift === 'equivalent-date' ? { ...original, targetDate: null } : { ...original, privateMap: new Map([['note', 'newer']]) };
  await storage.db.goalRecords.put(changed);
  await assert.rejects(store.getState().enableSync([opened], owner), /刚刚更新/);
  assert.ok(await sameGoalSource(await storage.db.goalRecords.get(original.id), changed));
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal(await storage.db.settings.get(`goal-local-copy:${original.id}`), undefined);
});

for (const targetDate of [' ', 'not-a-date', '2026-02-30']) test(`goal integrity: invalid nonempty enrollment date ${JSON.stringify(targetDate)} rolls back the full selection`, async () => {
  const originals = [{ ...row('synthetic-valid-first'), targetDate: '' }, { ...row('synthetic-invalid-second'), targetDate }];
  await storage.db.goalRecords.bulkPut(originals); await storage.db.table('goals').bulkPut(originals);
  await assert.rejects(store.getState().enableSync(originals, owner), /有效的目标日期/);
  for (const original of originals) {
    assert.deepEqual(await storage.db.goalRecords.get(original.id), original);
    assert.deepEqual(await storage.db.table('goals').get(original.id), original);
    assert.equal(await storage.db.settings.get(`goal-local-copy:${original.id}`), undefined);
  }
  assert.equal(await storage.db.outbox.count(), 0);
});

test('goal integrity: second normalized enrollment queue quota failure rolls back every record and original backup', async () => {
  const originals = [{ ...row('synthetic-quota-first'), targetDate: '2026-10-31' }, { ...row('synthetic-quota-second'), targetDate: '' }];
  await storage.db.goalRecords.bulkPut(originals); await storage.db.table('goals').bulkPut(originals);
  let attempts = 0;
  const failSecond = () => { if (++attempts === 2) throw new DOMException('Synthetic second goal quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', failSecond);
  try { await assert.rejects(store.getState().enableSync(originals, owner), /quota/); }
  finally { storage.db.outbox.hook('creating').unsubscribe(failSecond); }
  assert.equal(attempts, 2);
  for (const original of originals) {
    assert.deepEqual(await storage.db.goalRecords.get(original.id), original);
    assert.deepEqual(await storage.db.table('goals').get(original.id), original);
    assert.equal(await storage.db.settings.get(`goal-local-copy:${original.id}`), undefined);
  }
  assert.equal(await storage.db.outbox.count(), 0);
});

test('goal integrity: final enrollment epoch read rejects reauthentication after canonical queue writes', async () => {
  const original = { ...row(), targetDate: '' }, opened = await seed(original);
  const get = storage.db.settings.get;
  let queued = false, finalReads = 0;
  const markQueued = () => { queued = true; };
  storage.db.outbox.hook('creating', markQueued);
  storage.db.settings.get = async function (...args: Parameters<typeof get>) {
    const value = await get.apply(this, args);
    // Enqueue's actor read, the two viewed/current authority reads, then the
    // enrollment transaction's final awaited epoch read.
    if (queued && args[0] === storage.LOCAL_DATA_EPOCH_KEY && ++finalReads === 4) { api.clearSession(); api.setSessionActive(owner); }
    return value;
  } as typeof get;
  try { await assert.rejects(store.getState().enableSync([opened], owner), /账号/); }
  finally { storage.db.settings.get = get; storage.db.outbox.hook('creating').unsubscribe(markQueued); }
  assert.equal(finalReads, 4);
  assert.deepEqual(await storage.db.goalRecords.get(original.id), original);
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal(await storage.db.settings.get(`goal-local-copy:${original.id}`), undefined);
});

for (const hasEnrolledSnapshot of [false, true]) test(`goal integrity: prior blocked account enrollment with ${hasEnrolledSnapshot ? 'stored' : 'legacy'} receipt remains unchanged`, async () => {
  const original = { ...row(), targetDate: '' }, enrolled = { ...original, syncScope: 'account' as const };
  await storage.db.goalRecords.put(enrolled);
  const backup = { ownerId: owner, original, ...(hasEnrolledSnapshot ? { enrolled } : {}), enrolledAt: 1 };
  await storage.db.settings.put({ key: `goal-local-copy:${original.id}`, value: backup });
  await storage.db.outbox.add({ entity: 'goals', op: 'upsert', payload: enrolled, queuedAt: 1, status: 'blocked', lastStatus: 400 });
  const queue = await storage.db.outbox.toArray();
  assert.equal((await store.getState().enableSync([original], owner)).alreadyCommitted, true);
  await assert.rejects(store.getState().enableSync([cloneGoalSnapshot(store.getState().items[0])], owner), /刚刚更新/);
  assert.deepEqual(await storage.db.goalRecords.get(original.id), enrolled);
  assert.deepEqual((await storage.db.settings.get(`goal-local-copy:${original.id}`))!.value, backup);
  assert.deepEqual(await storage.db.outbox.toArray(), queue);
  assert.equal(store.getState().statuses[original.id], '需要检查');
});

for (const operation of ['create', 'edit', 'delete', 'enroll', 'copy', 'keep'] as const) {
  test(`goal integrity: ${operation} reports durable commit independently of failed display read`, async () => {
    const source = await seed(), preview = await seedLegacy();
    const id = `synthetic-create-${operation}`, old = storage.db.goalRecords.toArray;
    storage.db.goalRecords.toArray = () => Promise.reject(new Error('Synthetic postcommit display read failure'));
    let result;
    try {
      result = await (operation === 'create' ? store.getState().addGoal(input, id) : operation === 'edit' ? store.getState().updateGoal(source.id, { progress: 75 }, source) : operation === 'delete' ? store.getState().removeGoal(source.id, source) : operation === 'enroll' ? store.getState().enableSync([source], owner) : resolveLegacyGoalChange(preview, operation, owner));
    } finally { storage.db.goalRecords.toArray = old; }
    assert.equal(result.committed, true); assert.equal(result.view, 'refresh-needed'); assert.match(store.getState().readError!, /已保存在本机/);
    if (operation === 'create') {
      const repeated = await store.getState().addGoal(input, id);
      assert.equal(repeated.alreadyCommitted, true); assert.equal(await storage.db.goalRecords.count(), 2); assert.equal(await storage.db.outbox.count(), 1);
    } else if (operation === 'enroll') {
      assert.equal((await store.getState().enableSync([source], owner)).alreadyCommitted, true); assert.equal(await storage.db.outbox.count(), 1);
    } else if (operation === 'copy' || operation === 'keep') {
      const repeated = await resolveLegacyGoalChange(preview, operation, owner);
      assert.equal(repeated.alreadyCommitted, true); assert.equal(repeated.copyId, (result as { copyId: string | null }).copyId);
      assert.equal(await storage.db.goalRecords.count(), operation === 'copy' ? 2 : 1);
      assert.equal(await storage.db.settings.where('key').startsWith('goal-source-recovery:').count(), 1); assert.equal(await storage.db.outbox.count(), 0);
      await assert.rejects(resolveLegacyGoalChange(preview, operation === 'copy' ? 'keep' : 'copy', owner), /刚刚变化/);
    } else {
      assert.equal((await storage.db.goalRecords.get(source.id))?.progress, operation === 'delete' ? undefined : 75);
    }
  });
}

test('goal integrity: stable create intent cannot recreate a deleted or cleared goal', async () => {
  const id = 'synthetic-create-stable-deleted';
  const created = await store.getState().addGoal(input, id);
  await store.getState().removeGoal(created.id, cloneGoalSnapshot(created));
  await assert.rejects(store.getState().addGoal(input, id), /已删除/);
  await storage.clearAllData({ allowPending: true });
  await assert.rejects(store.getState().addGoal(input, id), /清除/);
  assert.equal(await storage.db.goalRecords.count(), 0);
});

test('goal integrity: copy recovery rejects full Map source drift and preserves original blob in receipt', async () => {
  const original = { ...row(), privateMap: new Map([['note', 'first']]), privateBlob: new Blob(['source bytes']), privateBigInt: 44444444444444444444n };
  await storage.db.table('goals').put(original);
  const opened = (await legacyGoalChanges())[0];
  await storage.db.table('goals').put({ ...original, privateMap: new Map([['note', 'newer']]) });
  await assert.rejects(resolveLegacyGoalChange(opened, 'copy', owner), /刚刚变化/);
  const preview = (await legacyGoalChanges())[0];
  const result = await resolveLegacyGoalChange(preview, 'copy', owner);
  const saved = await storage.db.goalRecords.get(result.copyId!) as typeof original;
  assert.equal(saved.privateMap.get('note'), 'newer'); assert.equal(await saved.privateBlob.text(), 'source bytes');
  const receipt = (await storage.db.settings.where('key').startsWith('goal-source-recovery:').first())!.value as { source: typeof original };
  assert.equal(receipt.source.privateBigInt, original.privateBigInt);
  assert.ok(await sameGoalSource(receipt.source, await storage.db.table('goals').get(original.id)));
});

test('goal integrity: copy quota failure rolls back copy, decision and source snapshot together', async () => {
  const preview = await seedLegacy();
  const fail = () => { throw new DOMException('Synthetic quota', 'QuotaExceededError'); };
  storage.db.goalRecords.hook('creating', fail);
  try { await assert.rejects(resolveLegacyGoalChange(preview, 'copy', owner), /quota/); }
  finally { storage.db.goalRecords.hook('creating').unsubscribe(fail); }
  assert.equal(await storage.db.goalRecords.count(), 0); assert.equal(await storage.db.settings.where('key').startsWith('goal-source-recovery:').count(), 0);
  assert.equal(await storage.db.settings.get(`goal-source-snapshot:${preview.id}`), undefined);
  assert.equal((await legacyGoalChanges()).length, 1);
});

test('goal integrity: recovery repeated receipt never consumes a subsequent independent old-source change', async () => {
  const preview = await seedLegacy(); const first = await resolveLegacyGoalChange(preview, 'copy', owner);
  await storage.db.table('goals').update(preview.id, { progress: 100 });
  const repeated = await resolveLegacyGoalChange(preview, 'copy', owner);
  assert.equal(repeated.alreadyCommitted, true); assert.equal(repeated.copyId, first.copyId);
  assert.equal((await legacyGoalChanges())[0].source?.progress, 100);
  assert.equal(await storage.db.goalRecords.count(), 1);
});

test('goal integrity: full source comparator preserves references, cycles, binary views and distinguishes nested changes', async () => {
  const shared = { note: 'same' }, data: Record<string, unknown> = { a: shared, b: shared, binary: new Uint16Array([1, 65535]), date: new Date(7), regexp: /goal/iu, undefinedValue: undefined, negativeZero: -0, nan: NaN };
  data.self = data;
  assert.equal(await sameGoalSource(data, structuredClone(data)), true);
  const different = structuredClone(data); different.b = { note: 'same' };
  assert.equal(await sameGoalSource(data, different), false);
  assert.equal(await sameGoalSource(new Map([['a', 1]]), new Map([['a', 2]])), false);
  assert.equal(await sameGoalSource(new Blob(['same']), new Blob(['different'])), false);
});

test('goal integrity: storage read fault preserves existing snapshot and explicit retry recovers', async () => {
  await seed(); const old = storage.db.settings.get;
  storage.db.settings.get = () => Promise.reject(new Error('Synthetic actor epoch read fault'));
  try { await assert.rejects(store.getState().loadFromDB(), /epoch read fault/); }
  finally { storage.db.settings.get = old; }
  assert.equal(store.getState().items.length, 1); assert.equal(store.getState().loaded, true); assert.ok(store.getState().readError);
  await store.getState().loadFromDB(); assert.equal(store.getState().readError, null);
});

test('goal integrity: observed snapshot tracks Goal, outbox and source updates without direct UI publication', async () => {
  const stop = startGoalObservation();
  try {
    await settled(() => store.getState().loaded);
    await storage.db.goalRecords.put(row()); await settled(() => store.getState().items.length === 1);
    assert.equal(store.getState().statuses[row().id], '仅本机');
    await storage.db.goalRecords.update(row().id, { syncScope: 'account' });
    await storage.db.settings.put({ key: `sync-version:goals:${row().id}`, value: '1' });
    await settled(() => store.getState().statuses[row().id] === '已同步');
    await storage.db.table('goals').put({ ...row(), progress: 75 }); await settled(() => store.getState().legacyChanges.length === 1);
    await storage.clearAllData({ allowPending: true }); await settled(() => store.getState().loaded && store.getState().items.length === 0 && store.getState().legacyChanges.length === 0);
  } finally { stop(); }
});

test('goal integrity: real frozen queue is unchanged while a later account edit gets its own successor', async () => {
  const created = await store.getState().addGoal(input);
  const first = (await storage.db.outbox.toArray())[0];
  const frozen = { mutationId: 'synthetic-frozen-goal-mutation', seqs: [first.seq], keys: [`goals:${created.id}`], payload: { protocol: 2, mutationId: 'synthetic-frozen-goal-mutation', goals: [first.payload] } };
  await storage.db.settings.put({ key: 'syncV2Batch', value: frozen });
  await store.getState().updateGoal(created.id, { progress: 100 }, cloneGoalSnapshot(created));
  assert.deepEqual((await storage.db.settings.get('syncV2Batch'))!.value, frozen);
  const rows = await storage.db.outbox.toArray(); assert.equal(rows.length, 2); assert.equal(rows[1].predecessorSeq, first.seq);
  assert.deepEqual(rows[0], first);
});

test('goal integrity: missing legacy date stays raw in local edit and source copy while enrollment becomes canonical', async () => {
  const original = row(); Reflect.deleteProperty(original, 'targetDate');
  const opened = await seed(original);
  await store.getState().updateGoal(original.id, { progress: 50 }, opened);
  const edited = cloneGoalSnapshot(store.getState().items[0]);
  assert.equal(Object.hasOwn(edited, 'targetDate'), false);
  await store.getState().enableSync([edited], owner);
  const backup = (await storage.db.settings.get(`goal-local-copy:${original.id}`))!.value as { original: object };
  assert.equal(Object.hasOwn(backup.original, 'targetDate'), false);
  assert.equal((await storage.db.goalRecords.get(original.id))?.targetDate, null);
  await storage.db.table('goals').put(original);
  const recovery = await resolveLegacyGoalChange((await legacyGoalChanges())[0], 'copy', owner);
  assert.equal(Object.hasOwn((await storage.db.goalRecords.get(recovery.copyId!))!, 'targetDate'), false);
});

test('goal integrity: old create callback cannot erase a newer post-clear published snapshot', async () => {
  const held = holdTransaction('rw');
  try {
    const pending = store.getState().addGoal(input); await held.started;
    await storage.clearAllData({ allowPending: true });
    await storage.db.goalRecords.put(row('synthetic-new-after-clear')); await store.getState().loadFromDB();
    held.release(); const result = await pending;
    assert.equal(result.view, 'context-changed'); assert.equal(store.getState().loaded, true);
    assert.deepEqual(store.getState().items.map(item => item.id), ['synthetic-new-after-clear']);
  } finally { held.restore(); }
});

test('goal integrity: original create intent rejects same-owner new session even with unchanged content', async () => {
  const id = 'synthetic-create-prior-session'; await store.getState().addGoal(input, id);
  api.clearSession(); api.setSessionActive(owner);
  await assert.rejects(store.getState().addGoal(input, id), /账号/);
  assert.equal(await storage.db.goalRecords.count(), 1); assert.equal(await storage.db.outbox.count(), 1);
});

test('goal integrity: empty-string legacy date stays raw locally but explicit enrollment queues null despite a failed display read', async () => {
  const original = { ...row(), targetDate: '' };
  const opened = await seed(original);
  await store.getState().updateGoal(original.id, { progress: 50 }, opened);
  assert.equal((await storage.db.goalRecords.get(original.id))?.targetDate, '');
  const selected = cloneGoalSnapshot(store.getState().items[0]), read = storage.db.goalRecords.toArray;
  storage.db.goalRecords.toArray = () => Promise.reject(new Error('Synthetic enrollment display read failure'));
  try {
    const result = await store.getState().enableSync([selected], owner);
    assert.equal(result.committed, true); assert.equal(result.view, 'refresh-needed');
  } finally { storage.db.goalRecords.toArray = read; }
  assert.equal(((await storage.db.outbox.toArray())[0].payload as { targetDate: null }).targetDate, null);
  assert.equal(((await storage.db.settings.get(`goal-local-copy:${original.id}`))!.value as { original: { targetDate: string } }).original.targetDate, '');
  assert.equal((await store.getState().enableSync([selected], owner)).alreadyCommitted, true);
  assert.equal(await storage.db.outbox.count(), 1);
  await storage.db.table('goals').put(original);
  const result = await resolveLegacyGoalChange((await legacyGoalChanges())[0], 'copy', owner);
  assert.equal((await storage.db.goalRecords.get(result.copyId!))?.targetDate, '');
});

test('goal integrity: final publication promise delivery cannot claim current visibility after clear', async () => {
  const held = holdTransaction('r', 2);
  try {
    const pending = store.getState().addGoal(input); await held.started;
    assert.equal(store.getState().items.length, 1);
    await storage.clearAllData({ allowPending: true });
    held.release(); const result = await pending;
    assert.equal(result.view, 'context-changed'); assert.deepEqual(store.getState().items, []);
  } finally { held.restore(); }
});

test('goal integrity: resizable ArrayBuffer capacity drift is a source conflict even with identical bytes', async () => {
  const original = { ...row(), unknown: new ArrayBuffer(4, { maxByteLength: 8 }) };
  const opened = await seed(original);
  const peer = { ...original, unknown: new ArrayBuffer(4, { maxByteLength: 16 }) };
  await storage.db.goalRecords.put(peer);
  await assert.rejects(store.getState().updateGoal(original.id, { progress: 50 }, opened), /刚刚/);
  const after = await storage.db.goalRecords.get(original.id) as typeof original;
  assert.equal(after.unknown.maxByteLength, 16); assert.equal(after.progress, 25);
  assert.equal(await sameGoalSource(new ArrayBuffer(4), new ArrayBuffer(4, { maxByteLength: 4 })), false);
});

test('goal integrity: resizable typed views fail closed rather than ignoring hidden length-tracking state', async () => {
  const backing = new ArrayBuffer(4, { maxByteLength: 8 });
  const raw = { ...row(), unknown: new Uint8Array(backing) };
  await storage.db.goalRecords.put(raw); const before = await storage.db.goalRecords.get(raw.id);
  await assert.rejects(store.getState().updateGoal(raw.id, { progress: 50 }, raw), /不能安全比较/);
  assert.deepEqual(await storage.db.goalRecords.get(raw.id), before); assert.equal(await storage.db.outbox.count(), 0);
});

for (const [version, expected] of [[undefined, '待同步'], ['0', '待同步'], ['1', '已同步'], [0, '需要检查'], ['not-a-version', '需要检查'], ['9223372036854775808', '需要检查'], [null, '需要检查']] as const) {
  test(`goal integrity: canonical version ${String(version)} displays only proven sync status`, async () => {
    await storage.db.goalRecords.put({ ...row(), syncScope: 'account' });
    if (version !== undefined) await storage.db.settings.put({ key: `sync-version:goals:${row().id}`, value: version });
    await store.getState().loadFromDB(); assert.equal(store.getState().statuses[row().id], expected);
  });
}

for (const initial of ['superseded', 'read-error'] as const) test(`goal integrity: ${initial} observation still follows later ACK without a manual reload`, async () => Dexie.ignoreTransaction(async () => {
  const source = { ...row(), syncScope: 'account' as const };
  await storage.db.goalRecords.put(source);
  const queued = await storage.db.outbox.add({ entity: 'goals', op: 'upsert', payload: source, baseVersion: '0', queuedAt: 1, status: 'pending' });
  const gate = barrier(), get = storage.db.settings.get; let first = true;
  storage.db.settings.get = function (...args: Parameters<typeof get>) {
    return get.apply(this, args).then(value => {
      if (first && args[0] === storage.LOCAL_DATA_EPOCH_KEY) {
        first = false; gate.entered();
        return Dexie.Promise.resolve(gate.waiting).then(() => {
          if (initial === 'read-error') throw new Error('Synthetic initial epoch read error');
          return value;
        });
      }
      return value;
    });
  } as typeof get;
  const stop = startGoalObservation();
  try {
    await gate.started;
    if (initial === 'superseded') await store.getState().loadFromDB();
    gate.release(); await new Promise(resolve => setTimeout(resolve, 40));
    storage.db.settings.get = get;
    if (initial === 'read-error') { assert.ok(store.getState().readError); await store.getState().loadFromDB(); }
    assert.equal(store.getState().statuses[source.id], '待同步');
    // Same actual IndexedDB mutations as an accepted ACK; no store refresh call.
    await Dexie.ignoreTransaction(() => storage.db.transaction('rw', storage.db.outbox, storage.db.settings, async () => {
      await storage.db.outbox.delete(queued);
      await storage.db.settings.put({ key: `sync-version:goals:${source.id}`, value: '1' });
    }));
    await settled(() => store.getState().statuses[source.id] === '已同步');
    assert.equal(store.getState().items[0].progress, 25);
  } finally { gate.release(); storage.db.settings.get = get; stop(); }
}));

test('goal integrity: shared observation survives one consumer closing and unsubscribes after the last', async () => {
  const source = { ...row(), syncScope: 'account' as const };
  await storage.db.goalRecords.put(source); await storage.db.settings.put({ key: `sync-version:goals:${source.id}`, value: '0' });
  const stopPage = startGoalObservation(), stopRecovery = startGoalObservation();
  try {
    await settled(() => store.getState().statuses[source.id] === '待同步'); stopPage();
    await storage.db.settings.put({ key: `sync-version:goals:${source.id}`, value: '1' });
    await settled(() => store.getState().statuses[source.id] === '已同步');
    stopRecovery();
    await storage.db.settings.put({ key: `sync-version:goals:${source.id}`, value: 'not-a-version' });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(store.getState().statuses[source.id], '已同步', 'no new observer publication after every consumer closes');
  } finally { stopPage(); stopRecovery(); }
});

function holdSnapshotReads(failFirstDelivery = false) {
  const gates = [barrier(), barrier()], database = storage.db, original = database.transaction; let count = 0;
  database.transaction = function (...args: Parameters<typeof original>) {
    const result = Reflect.apply(original, this, args);
    if (args[0] === 'r' && Array.isArray(args[1]) && args[1].includes(database.goalRecords) && count < 2) {
      const index = count++, gate = gates[index];
      return result.then(value => Dexie.ignoreTransaction(async () => { gate.entered(); await gate.waiting; if (failFirstDelivery && index === 0) throw new Error('Synthetic earlier read delivery error'); return value; }));
    }
    return result;
  } as typeof original;
  return { gates, restore: () => { database.transaction = original; for (const gate of gates) gate.release(); } };
}

for (const failEarlierRead of [false, true]) test(`goal integrity: newer successful publication resolves superseded ${failEarlierRead ? 'failed' : 'successful'} commit refresh`, async () => {
  const source = await seed(), held = holdSnapshotReads(failEarlierRead);
  try {
    const saving = store.getState().updateGoal(source.id, { progress: 75 }, source); await held.gates[0].started;
    const newer = store.getState().loadFromDB(); await held.gates[1].started; held.gates[1].release(); await newer;
    held.gates[0].release(); const result = await saving;
    assert.equal(result.committed, true); assert.equal(result.view, 'current');
    assert.ok(store.getState().publishedRevision >= result.refreshRevision); assert.equal(store.getState().readError, null); assert.equal(store.getState().items[0].progress, 75);
  } finally { held.restore(); }
});

test('goal integrity: a newer read still in flight is refreshing, not a failed-read recovery request', async () => {
  const source = await seed(), held = holdSnapshotReads();
  try {
    const saving = store.getState().updateGoal(source.id, { progress: 75 }, source); await held.gates[0].started;
    const newer = store.getState().loadFromDB(); await held.gates[1].started; held.gates[0].release(); const result = await saving;
    assert.equal(result.committed, true); assert.equal(result.view, 'refreshing'); assert.equal(store.getState().readError, null);
    assert.ok(store.getState().publishedRevision < result.refreshRevision);
    held.gates[1].release(); await newer;
    assert.ok(store.getState().publishedRevision >= result.refreshRevision); assert.equal(store.getState().items[0].progress, 75);
  } finally { held.restore(); }
});

test('goal integrity: a failed newer read keeps a real recoverable notice until successful publication', async () => {
  const source = await seed(), held = holdSnapshotReads(), original = storage.db.goalRecords.toArray;
  try {
    const saving = store.getState().updateGoal(source.id, { progress: 75 }, source); await held.gates[0].started;
    storage.db.goalRecords.toArray = () => Promise.reject(new Error('Synthetic newer read failure'));
    await assert.rejects(store.getState().loadFromDB(), /newer read failure/);
    storage.db.goalRecords.toArray = original; held.gates[0].release(); const result = await saving;
    assert.equal(result.committed, true); assert.equal(result.view, 'refresh-needed'); assert.ok(store.getState().readError);
    assert.ok(store.getState().publishedRevision < result.refreshRevision);
    await store.getState().loadFromDB(); assert.equal(store.getState().readError, null);
    assert.ok(store.getState().publishedRevision >= result.refreshRevision); assert.equal(store.getState().items[0].progress, 75);
  } finally { held.restore(); storage.db.goalRecords.toArray = original; }
});

test('goal integrity: a postcommit observation before delayed write delivery remains current if the redundant reread fails', async () => {
  const source = await seed(), held = holdTransaction('rw'), original = storage.db.goalRecords.toArray;
  try {
    const saving = store.getState().updateGoal(source.id, { progress: 75 }, source); await held.started;
    await store.getState().loadFromDB(); assert.equal(store.getState().items[0].progress, 75);
    storage.db.goalRecords.toArray = () => Promise.reject(new Error('Synthetic redundant reread failed'));
    held.release(); const result = await saving;
    assert.equal(result.committed, true); assert.equal(result.view, 'current'); assert.equal(store.getState().readError, null);
    assert.equal(store.getState().items[0].progress, 75);
  } finally { held.restore(); storage.db.goalRecords.toArray = original; }
});

test('goal integrity: a later rejected write is not evidence that a replacement read is still running', async () => {
  const source = await seed(), held = holdSnapshotReads();
  try {
    const saving = store.getState().updateGoal(source.id, { progress: 75 }, source); await held.gates[0].started;
    await assert.rejects(store.getState().updateGoal(source.id, { progress: 100 }, source), /刚刚/);
    held.gates[0].release(); const result = await saving;
    assert.equal(result.committed, true); assert.equal(result.view, 'refresh-needed');
    assert.ok(store.getState().publishedRevision < result.refreshRevision);
    const refreshing = store.getState().loadFromDB(); await held.gates[1].started; held.gates[1].release(); await refreshing;
    assert.ok(store.getState().publishedRevision >= result.refreshRevision); assert.equal(store.getState().items[0].progress, 75);
  } finally { held.restore(); }
});
