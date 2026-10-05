import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { HabitItem, HabitView } from '../src/stores/habitStore';
import type { HabitCheckinRecord } from '../src/db';

const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { location: { replace() {} } }) });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { useHabitStore: store } = await import('../src/stores/habitStore.ts');
const { habitPayload, habitCheckinPayload, sameHabitSource } = await import('../src/services/habitSource.ts');
const { getToday, addDays } = await import('../src/utils/date.ts');
const owner = 'synthetic-habit-integrity';
const input = { name: 'Same synthetic habit', icon: '🌱', frequency: 'weekly' as const };
const today = getToday(), yesterday = addDays(today, -1);
const row = (id = 'synthetic-habit-one'): HabitItem => ({ id, ...input, sortOrder: 1, createdAt: Date.now(), updatedAt: Date.now() });
const checkin = (habitId: string, date = yesterday, done = true): HabitCheckinRecord => ({ id: `${habitId}|${date}`, habitId, date, done, source: 'ai', confirmed: true, aiReason: 'Synthetic factual provenance', updatedAt: 100 });
const view = (id = 'synthetic-habit-one'): HabitView => store.getState().items.find(item => item.id === id)!;
async function seed(record = row(), checkins: HabitCheckinRecord[] = []) {
  await storage.db.habits.put(record); await storage.db.habitCheckins.bulkPut(checkins); await store.getState().loadFromDB(); return view(record.id);
}
const gate = () => {
  let enter!: () => void, release!: () => void;
  return { started: new Promise<void>(resolve => { enter = resolve; }), waiting: new Promise<void>(resolve => { release = resolve; }), enter: () => enter(), release: () => release() };
};
function delayActorRead() {
  const original = storage.db.settings.get, held = gate(); let first = true;
  storage.db.settings.get = (function (key: string) {
    const result = original.call(storage.db.settings, key);
    if (key !== storage.LOCAL_DATA_EPOCH_KEY || !first) return result;
    first = false;
    return result.then(async value => { held.enter(); await held.waiting; return value; });
  }) as typeof original;
  return { ...held, restore: () => { storage.db.settings.get = original; } };
}
function delayCompletedSnapshot() {
  const original = storage.db.transaction, held = gate(); let first = true;
  storage.db.transaction = (function (...args: unknown[]) {
    const result = Reflect.apply(original, storage.db, args) as Promise<unknown>;
    if (args[0] !== 'r' || !Array.isArray(args[1]) || !args[1].includes(storage.db.habits) || !first) return result;
    first = false;
    return result.then(async value => { held.enter(); await held.waiting; return value; });
  }) as typeof original;
  return { ...held, restore: () => { storage.db.transaction = original; } };
}
async function snapshot() { return { habits: await storage.db.habits.toArray(), checkins: await storage.db.habitCheckins.toArray(), outbox: await storage.db.outbox.toArray(), settings: await storage.db.settings.toArray() }; }

before(async () => { await storage.bindAccountDatabase(owner); });
beforeEach(async () => { localStorage.clear(); api.setSessionActive(owner); sync.pauseSync(); await storage.clearAllData({ allowPending: true }); store.setState({ items: [], loaded: false, refreshError: null }); });
after(() => { sync.pauseSync(); api.clearSession(); storage.db.close(); });

test('canonical sources preserve metadata and unknown structured-clone fields, while payloads remain allowlisted', async () => {
  const original = { ...row(), retained: { bytes: new Uint8Array([1, 2]), map: new Map([['key', 7n]]), blob: new Blob(['synthetic exact source'], { type: 'text/plain' }), optional: undefined } };
  const fact = { ...checkin(original.id), retained: new Set(['synthetic-proof']) };
  const loaded = await seed(original, [fact]);
  assert.deepEqual(loaded.source, original); assert.deepEqual(loaded.checkinSources, [fact]);
  assert.notEqual(loaded.source, loaded); assert.equal('done' in loaded.source, false);
  assert.deepEqual(loaded.recentCheckins.find(day => day.date === yesterday)?.source, fact);
  assert.deepEqual(Object.keys(habitPayload(original)).sort(), ['frequency', 'icon', 'id', 'name', 'sortOrder']);
  assert.equal('retained' in habitCheckinPayload(fact), false); assert.equal('updatedAt' in habitCheckinPayload(fact), false);
  assert.equal(await sameHabitSource(original, { ...original, retained: { ...original.retained, map: new Map([['key', 8n]]) } }), false);
  await store.getState().setHabitDone(loaded, yesterday, false);
  const saved = await storage.db.habitCheckins.get(fact.id);
  assert.deepEqual((saved as typeof fact).retained, fact.retained); assert.equal(saved?.source, 'ai'); assert.equal(saved?.aiReason, fact.aiReason); assert.equal(saved?.date, yesterday);
  assert.equal('retained' in ((await storage.db.outbox.toArray())[0].payload as object), false);
});

test('normal synced metadata no longer prevents exact delete, and same-name neighbor plus facts survive', async () => {
  const first = row(), other = row('synthetic-habit-neighbor');
  await seed(first, [checkin(first.id)]); await storage.db.habits.put(other); await storage.db.habitCheckins.put(checkin(other.id)); await store.getState().loadFromDB();
  const result = await store.getState().removeHabit(first.id, view(first.id).source);
  assert.deepEqual(result, { status: 'committed-local', viewUpdated: true });
  assert.equal(await storage.db.habits.get(first.id), undefined); assert.equal(await storage.db.habitCheckins.get(checkin(first.id).id), undefined);
  assert.deepEqual(await storage.db.habits.get(other.id), other); assert.deepEqual(await storage.db.habitCheckins.get(checkin(other.id).id), checkin(other.id));
  assert.deepEqual((await storage.db.outbox.toArray()).map(({ entity, op, payload }) => ({ entity, op, payload })), [{ entity: 'habits', op: 'delete', payload: first.id }]);
});

test('delete confirmation consumes its frozen full source, even after a newer store refresh', async () => {
  const opened = await seed(), peer = { ...opened.source, name: 'New peer name', unknownProof: new Map([['keep', 1]]) };
  await storage.db.habits.put(peer); await store.getState().loadFromDB();
  await assert.rejects(store.getState().removeHabit(opened.id, opened.source), /刚刚/);
  assert.deepEqual(await storage.db.habits.get(opened.id), peer); assert.equal(await storage.db.outbox.count(), 0);
  await store.getState().removeHabit(opened.id, view().source); assert.equal(await storage.db.habits.count(), 0);
});

test('missing parent or absent displayed source rejects instead of silently succeeding', async () => {
  const opened = await seed(); await storage.db.habits.delete(opened.id);
  await assert.rejects(store.getState().setHabitDone(opened, yesterday, true), /不存在/);
  await assert.rejects(store.getState().removeHabit(opened.id, opened.source), /不存在/);
  store.setState({ items: [] }); await assert.rejects(store.getState().toggleHabit(opened.id), /不存在/);
  await assert.rejects(store.getState().removeHabit(opened.id), /不存在/);
  assert.equal(await storage.db.habitCheckins.count(), 0); assert.equal(await storage.db.outbox.count(), 0);
});

test('displayed complete action never inverts a peer completion and preserves the peer provenance', async () => {
  const opened = await seed(), peer = checkin(opened.id);
  await storage.db.habitCheckins.put(peer);
  const result = await store.getState().setHabitDone(opened, yesterday, true);
  assert.equal(result.status, 'already-achieved'); assert.deepEqual(await storage.db.habitCheckins.get(peer.id), peer); assert.equal(await storage.db.outbox.count(), 0);
  store.setState({ items: [opened] }); await store.getState().toggleHabit(opened.id, yesterday);
  assert.deepEqual(await storage.db.habitCheckins.get(peer.id), peer); assert.equal(await storage.db.outbox.count(), 0);
});

test('opposite desired state rejects changed child metadata and stale parent even when the requested fact is achieved', async () => {
  const original = row(), fact = checkin(original.id), opened = await seed(original, [fact]);
  const peerFact = { ...fact, aiReason: 'Peer reviewed evidence', updatedAt: 101 };
  await storage.db.habitCheckins.put(peerFact);
  await assert.rejects(store.getState().setHabitDone(opened, yesterday, false), /刚刚/);
  await storage.db.habits.put({ ...original, name: 'Peer parent name' });
  await assert.rejects(store.getState().setHabitDone(opened, yesterday, true), /刚刚/);
  assert.deepEqual(await storage.db.habitCheckins.get(fact.id), peerFact); assert.equal(await storage.db.outbox.count(), 0);
});

test('selected actual dates remain exact and undo never touches another date or same-name habit', async () => {
  const first = await seed(), other = row('synthetic-habit-neighbor'); await storage.db.habits.put(other); await store.getState().loadFromDB();
  await store.getState().setHabitDone(view(first.id), yesterday, true);
  await store.getState().setHabitDone(view(first.id), today, true);
  await store.getState().setHabitDone(view(other.id), yesterday, true);
  await store.getState().setHabitDone(view(first.id), yesterday, false);
  assert.equal((await storage.db.habitCheckins.get(`${first.id}|${yesterday}`))?.done, false);
  assert.equal((await storage.db.habitCheckins.get(`${first.id}|${today}`))?.done, true);
  assert.equal((await storage.db.habitCheckins.get(`${other.id}|${yesterday}`))?.done, true);
  await assert.rejects(store.getState().setHabitDone(view(first.id), '2026-02-30', true), /日期/);
  await assert.rejects(store.getState().setHabitDone(view(first.id), addDays(today, 1), true), /日期/);
});

for (const kind of ['clear', 'delete', 'logout', 'owner', 'reauth'] as const) test(`dated write delayed before its first source transaction rejects after ${kind}`, async () => {
  const opened = await seed(), held = delayActorRead();
  const writing = store.getState().setHabitDone(opened, yesterday, true); void writing.catch(() => undefined);
  await held.started;
  if (kind === 'clear') { await storage.clearAllData({ allowPending: true }); store.setState({ items: [], loaded: false }); }
  if (kind === 'delete') await storage.db.habits.delete(opened.id);
  if (kind === 'logout') api.clearSession();
  if (kind === 'owner') api.setSessionActive('synthetic-other-owner');
  if (kind === 'reauth') { api.clearSession(); api.setSessionActive(owner); }
  held.release();
  try { await assert.rejects(writing, /变化|不存在/); } finally { held.restore(); }
  assert.equal(await storage.db.habitCheckins.count(), 0); assert.equal(await storage.db.outbox.count(), 0);
});

test('unchanged old displayed sources cannot authorize a new write after same-owner reauthentication', async () => {
  const opened = await seed(); api.clearSession(); api.setSessionActive(owner);
  await assert.rejects(store.getState().setHabitDone(opened, yesterday, true), /账号/);
  await assert.rejects(store.getState().removeHabit(opened.id, opened.source), /账号/);
  await store.getState().loadFromDB(); await store.getState().setHabitDone(view(), yesterday, true);
  assert.equal(await storage.db.habitCheckins.count(), 1);
});

for (const kind of ['clear', 'logout', 'owner', 'reauth'] as const) test(`completed but unpublished load is guarded after ${kind}`, async () => {
  await seed(); store.setState({ items: [], loaded: false }); const held = delayCompletedSnapshot();
  const loading = store.getState().loadFromDB(); void loading.catch(() => undefined); await held.started;
  if (kind === 'clear') await storage.clearAllData({ allowPending: true });
  if (kind === 'logout') api.clearSession();
  if (kind === 'owner') api.setSessionActive('synthetic-other-owner');
  if (kind === 'reauth') { api.clearSession(); api.setSessionActive(owner); }
  held.release();
  try { await assert.rejects(loading, /变化/); } finally { held.restore(); }
  assert.deepEqual(store.getState().items, []); assert.equal(store.getState().loaded, false);
});

test('out-of-order load completion cannot replace a newer published snapshot', async () => {
  const opened = await seed(), held = delayCompletedSnapshot();
  const older = store.getState().loadFromDB(); await held.started;
  await storage.db.habits.put({ ...opened.source, name: 'Newer published name' }); await store.getState().loadFromDB();
  held.release(); try { await older; } finally { held.restore(); }
  assert.equal(view().name, 'Newer published name'); assert.equal(view().source.name, 'Newer published name');
});

test('Habit and child reads share one snapshot while a peer atomic edit waits', async () => {
  const original = row(), opened = await seed(original), held = gate(), originalRead = storage.db.habits.toArray; let first = true;
  storage.db.habits.toArray = (() => originalRead.call(storage.db.habits).then(async rows => {
    if (first) { first = false; held.enter(); await Dexie.waitFor(held.waiting); }
    return rows;
  })) as typeof originalRead;
  const loading = store.getState().loadFromDB(); await held.started;
  const peer = storage.db.transaction('rw', storage.db.habits, storage.db.habitCheckins, async () => {
    await storage.db.habits.put({ ...original, name: 'Peer coherent name' }); await storage.db.habitCheckins.put(checkin(original.id));
  });
  held.release();
  try { await Promise.all([loading, peer]); } finally { storage.db.habits.toArray = originalRead; }
  const loaded = view();
  assert.equal(loaded.name === opened.name && loaded.checkinSources.length === 0 || loaded.name === 'Peer coherent name' && loaded.checkinSources.length === 1, true);
});

test('postcommit create refresh failure is a committed outcome and same-ID retry adds no duplicate', async () => {
  const original = storage.db.habitCheckins.toArray; storage.db.habitCheckins.toArray = (() => Promise.reject(new Error('synthetic refresh failure'))) as typeof original;
  let result;
  try { result = await store.getState().addHabit(input, 'synthetic-stable-create'); } finally { storage.db.habitCheckins.toArray = original; }
  assert.equal(result.status, 'committed-local'); assert.equal(result.viewUpdated, false); assert.match(store.getState().refreshError!, /已保存在本机/);
  assert.equal(await storage.db.habits.count(), 1); assert.equal(await storage.db.outbox.count(), 1);
  const retry = await store.getState().addHabit(input, result.id);
  assert.equal(retry.status, 'already-achieved'); assert.equal(await storage.db.habits.count(), 1); assert.equal(await storage.db.outbox.count(), 1); assert.equal(store.getState().items.length, 1);
  await assert.rejects(store.getState().addHabit({ ...input, name: 'Different draft' }, result.id), /内容已变化/);
  assert.deepEqual((await storage.db.outbox.toArray())[0].payload, habitPayload(result.source));
});

test('postcommit desired-state refresh failure cannot turn retry into undo', async () => {
  const opened = await seed(), original = storage.db.habits.toArray;
  storage.db.habits.toArray = (() => Promise.reject(new Error('synthetic refresh failure'))) as typeof original;
  let result;
  try { result = await store.getState().setHabitDone(opened, yesterday, true); } finally { storage.db.habits.toArray = original; }
  assert.deepEqual(result, { status: 'committed-local', viewUpdated: false });
  assert.equal((await storage.db.habitCheckins.get(`${opened.id}|${yesterday}`))?.done, true);
  assert.equal((await store.getState().setHabitDone(opened, yesterday, true)).status, 'already-achieved');
  assert.equal(await storage.db.outbox.count(), 1); assert.equal((await storage.db.habitCheckins.get(`${opened.id}|${yesterday}`))?.done, true);
});

test('delete refresh failure never reports rollback after durable deletion', async () => {
  const opened = await seed(), original = storage.db.habits.toArray;
  storage.db.habits.toArray = (() => Promise.reject(new Error('synthetic refresh failure'))) as typeof original;
  try { assert.deepEqual(await store.getState().removeHabit(opened.id, opened.source), { status: 'committed-local', viewUpdated: false }); } finally { storage.db.habits.toArray = original; }
  assert.equal(await storage.db.habits.count(), 0); assert.equal(await storage.db.outbox.count(), 1);
});

test('overlapping create publication and load publishes only one authoritative copy per ID', async () => {
  const held = delayCompletedSnapshot(), adding = store.getState().addHabit(input, 'synthetic-overlap-create'); await held.started;
  await store.getState().loadFromDB(); held.release();
  try { await adding; } finally { held.restore(); }
  assert.equal(await storage.db.habits.count(), 1); assert.equal(store.getState().items.length, 1); assert.equal(new Set(store.getState().items.map(item => item.id)).size, 1);
});

test('clear between successful create and publication cannot publish an erased ghost', async () => {
  const held = delayCompletedSnapshot(), adding = store.getState().addHabit(input, 'synthetic-clear-create'); await held.started;
  await storage.clearAllData({ allowPending: true }); store.setState({ items: [], loaded: false }); held.release();
  try { assert.equal((await adding).viewUpdated, false); } finally { held.restore(); }
  assert.equal(await storage.db.habits.count(), 0); assert.equal(await storage.db.outbox.count(), 0); assert.deepEqual(store.getState().items, []);
});

for (const action of ['create', 'check', 'delete'] as const) test(`actual outbox quota failure rolls back ${action} records, check-ins and receipt together`, async () => {
  const record = row(), opened = await seed(record, [checkin(record.id)]), original = await snapshot(); let hits = 0;
  const fault = () => { hits += 1; throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', fault);
  try {
    const write = action === 'create' ? store.getState().addHabit(input, 'synthetic-quota-create') : action === 'check' ? store.getState().setHabitDone(opened, yesterday, false) : store.getState().removeHabit(opened.id, opened.source);
    await assert.rejects(write, /quota/);
  } finally { storage.db.outbox.hook('creating').unsubscribe(fault); }
  assert.equal(hits, 1); assert.deepEqual(await snapshot(), original);
  if (action === 'create') { await store.getState().addHabit(input, 'synthetic-quota-create'); assert.equal(await storage.db.habits.count(), 2); }
  if (action === 'check') { await store.getState().setHabitDone(opened, yesterday, false); assert.equal((await storage.db.habitCheckins.get(checkin(record.id).id))?.done, false); }
  if (action === 'delete') { await store.getState().removeHabit(opened.id, opened.source); assert.equal(await storage.db.habits.get(opened.id), undefined); }
});

for (const action of ['create', 'check', 'delete'] as const) test(`authority change in the final outbox write rolls back ${action}`, async () => {
  const opened = await seed(), original = await snapshot();
  const fault = () => { api.clearSession(); api.setSessionActive(owner); };
  storage.db.outbox.hook('creating', fault);
  try {
    await assert.rejects(action === 'create' ? store.getState().addHabit(input, 'synthetic-actor-create') : action === 'check' ? store.getState().setHabitDone(opened, yesterday, true) : store.getState().removeHabit(opened.id, opened.source), /账号/);
  } finally { storage.db.outbox.hook('creating').unsubscribe(fault); }
  assert.deepEqual(await snapshot(), original);
});

test('pending child and parent operations or uncertain frozen bytes block delete without discarding any work', async () => {
  const opened = await store.getState().addHabit(input, 'synthetic-pending-parent');
  await store.getState().setHabitDone(view(opened.id), yesterday, true);
  let original = await snapshot(); await assert.rejects(store.getState().removeHabit(opened.id, view(opened.id).source), /未确认修改/); assert.deepEqual(await snapshot(), original);
  // A known successful test ACK fixture retires the exact selected mutation set; no network is claimed.
  const operations = await storage.db.outbox.toArray();
  await storage.db.transaction('rw', storage.db.outbox, storage.db.settings, async () => {
    for (const operation of operations) await storage.db.settings.put({ key: `sync-version:${operation.entity === 'habits' ? `habits:${opened.id}` : `habitCheckins:${opened.id}|${yesterday}`}`, value: '41' });
    await storage.db.outbox.bulkDelete(operations.map(operation => operation.seq!));
  });
  const frozen = { mutationId: 'synthetic-uncertain-batch', seqs: operations.map(operation => operation.seq!), keys: [`habitCheckins:${opened.id}|${yesterday}`], payload: { protocol: 2, mutationId: 'synthetic-uncertain-batch', habitCheckins: [{ ...habitCheckinPayload(checkin(opened.id)), baseVersion: '0' }] } };
  await storage.db.settings.put({ key: 'syncV2Batch', value: frozen }); original = await snapshot();
  await assert.rejects(store.getState().removeHabit(opened.id, view(opened.id).source), /未确认修改/); assert.deepEqual(await snapshot(), original);
  // Known fixture ACK of the exact frozen batch clears only its receipt.
  await storage.db.settings.delete('syncV2Batch');
  await store.getState().removeHabit(opened.id, view(opened.id).source);
  assert.equal(await storage.db.habits.get(opened.id), undefined); assert.equal(await storage.db.habitCheckins.count(), 0); assert.equal(await storage.db.outbox.count(), 1);
  await assert.rejects(store.getState().addHabit(input, opened.id), /已删除/); assert.equal(await storage.db.habits.count(), 0);
});

test('an unrelated pending or frozen Habit does not block exact deletion of an ACKed parent', async () => {
  const opened = await seed(); await store.getState().addHabit(input, 'synthetic-unrelated-pending');
  await storage.db.settings.put({ key: 'syncV2Batch', value: { mutationId: 'synthetic-unrelated', keys: ['habits:synthetic-unrelated-pending'], seqs: [] } });
  const original = await storage.db.settings.get('syncV2Batch');
  await store.getState().removeHabit(opened.id, opened.source);
  assert.deepEqual(await storage.db.settings.get('syncV2Batch'), original); assert.equal(await storage.db.habits.count(), 1); assert.equal(await storage.db.outbox.count(), 2);
});

test('same-ID creation retry cannot report unchanged content after a peer edited its original record', async () => {
  const created = await store.getState().addHabit(input, 'synthetic-edited-create');
  await storage.db.habits.update(created.id, { name: 'Peer changed name' });
  await assert.rejects(store.getState().addHabit(input, created.id), /刚刚/);
  assert.equal(await storage.db.habits.count(), 1); assert.equal(await storage.db.outbox.count(), 1); assert.equal((await storage.db.habits.get(created.id))?.name, 'Peer changed name');
});

test('an unexpected nested value in an allowed provenance field cannot enter the wire payload', async () => {
  const original = row(), malformed = { ...checkin(original.id), aiReason: { privateProof: 'synthetic unknown value' } };
  await seed(original, [malformed as unknown as HabitCheckinRecord]);
  const before = await snapshot();
  await assert.rejects(store.getState().setHabitDone(view(), yesterday, false), /来源字段/);
  assert.deepEqual(await snapshot(), before);
});
