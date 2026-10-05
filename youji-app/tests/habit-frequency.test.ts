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
const { encodeRecovery } = await import('../src/db/accountGeneration.ts');
const { habitPayload } = await import('../src/services/habitSource.ts');
const { getHabitPeriod } = await import('../src/utils/habitPeriod.ts');
const owner = 'synthetic-habit-frequency';
const today = '2026-10-07', yesterday = '2026-10-06';
const now = new Date(`${today}T23:59:50+08:00`).getTime();
const row = (id = 'synthetic-frequency-one', frequency: HabitItem['frequency'] = 'daily'): HabitItem => ({ id, name: 'Same synthetic habit', icon: '🌱', frequency, sortOrder: 1, createdAt: 100, updatedAt: 200 });
const checkin = (habitId: string, date = yesterday, done = true): HabitCheckinRecord => ({ id: `${habitId}|${date}`, habitId, date, done, source: 'ai', confirmed: true, aiReason: 'Synthetic factual provenance', updatedAt: 101 });
const view = (id = 'synthetic-frequency-one'): HabitView => store.getState().items.find(item => item.id === id)!;
async function seed(record = row(), checkins: HabitCheckinRecord[] = []) {
  await storage.db.habits.put(record); await storage.db.habitCheckins.bulkPut(checkins); await store.getState().loadFromDB(); return view(record.id);
}
async function snapshot() { return { habits: await storage.db.habits.toArray(), checkins: await storage.db.habitCheckins.toArray(), outbox: await storage.db.outbox.toArray(), settings: await storage.db.settings.toArray() }; }
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

before(async () => { await storage.bindAccountDatabase(owner); });
beforeEach(async context => {
  context.mock.timers.enable({ apis: ['Date'], now });
  localStorage.clear(); api.setSessionActive(owner); sync.pauseSync();
  await storage.clearAllData({ allowPending: true }); store.setState({ items: [], loaded: false, refreshError: null });
});
after(() => { sync.pauseSync(); api.clearSession(); storage.db.close(); });

for (const frequency of ['daily', 'weekly'] as const) test(`${frequency} changes immediately to the other current frequency while exact facts and metadata survive`, async () => {
  const original = { ...row(undefined, frequency), retained: { bytes: new Uint8Array([1, 2]), map: new Map([['proof', 7n]]), blob: new Blob(['synthetic parent bytes']), optional: undefined } };
  const facts = [
    { ...checkin(original.id), retained: { blob: new Blob(['synthetic true fact'], { type: 'text/plain' }), data: new Uint8Array([9, 8]), optional: undefined } },
    { ...checkin(original.id, today, false), source: 'manual' as const, confirmed: false, aiReason: undefined, retained: new Map([['keep', new Set([4n])]]) },
    { ...checkin(original.id, '2026-09-20'), source: 'schedule' as const, retained: new Date('2026-09-20T01:00:00Z') },
    checkin(original.id, '2026-10-09'),
  ];
  const neighbor = row('synthetic-frequency-neighbor', frequency), neighborFact = checkin(neighbor.id);
  await seed(original, facts); await storage.db.habits.put(neighbor); await storage.db.habitCheckins.put(neighborFact); await store.getState().loadFromDB();
  const frozenFacts = await encodeRecovery(await storage.db.habitCheckins.toArray());
  const opened = view(), next = frequency === 'daily' ? 'weekly' : 'daily';
  const preview = getHabitPeriod({ ...opened, frequency: next }, today);
  assert.equal(preview.attained, next === 'weekly'); assert.equal(preview.doneToday, false);
  assert.deepEqual(await store.getState().setHabitFrequency(opened, next, today), { status: 'committed-local', viewUpdated: true });
  assert.deepEqual(await storage.db.habits.get(original.id), { ...original, frequency: next, updatedAt: now });
  assert.deepEqual(await storage.db.habits.get(neighbor.id), neighbor);
  assert.deepEqual(await encodeRecovery(await storage.db.habitCheckins.toArray()), frozenFacts);
  assert.deepEqual(getHabitPeriod(view(), today), preview);
  const operations = await storage.db.outbox.toArray(); assert.equal(operations.length, 1);
  assert.equal(operations[0].entity, 'habits'); assert.equal(operations[0].op, 'upsert');
  assert.deepEqual(operations[0].payload, habitPayload({ ...original, frequency: next }));
  assert.deepEqual(Object.keys(operations[0].payload as object).sort(), ['frequency', 'icon', 'id', 'name', 'sortOrder']);
});

test('an unchanged frequency is a fully verified no-op with no timestamp or outbox changes', async () => {
  const original = row(), opened = await seed(original, [checkin(original.id)]), before = await snapshot();
  assert.deepEqual(await store.getState().setHabitFrequency(opened, 'daily', today), { status: 'already-achieved', viewUpdated: true });
  assert.deepEqual(await snapshot(), before);
});

for (const change of ['parent-frequency', 'parent-metadata', 'parent-missing', 'child-state', 'child-metadata', 'child-added', 'child-missing', 'child-moved'] as const) test(`a ${change} after preview rejects without discarding peer changes or emitting a mutation`, async () => {
  const original = row(), fact = checkin(original.id), opened = await seed(original, [fact]);
  if (change === 'parent-frequency') await storage.db.habits.update(original.id, { frequency: 'weekly' });
  if (change === 'parent-metadata') await storage.db.habits.put({ ...original, retained: new Blob(['peer metadata']) } as HabitItem);
  if (change === 'parent-missing') await storage.db.habits.delete(original.id);
  if (change === 'child-state') await storage.db.habitCheckins.put({ ...fact, done: false });
  if (change === 'child-metadata') await storage.db.habitCheckins.put({ ...fact, retained: new Map([['peer-proof', 7n]]) } as HabitCheckinRecord);
  if (change === 'child-added') await storage.db.habitCheckins.put(checkin(original.id, '2025-01-01'));
  if (change === 'child-missing') await storage.db.habitCheckins.delete(fact.id);
  if (change === 'child-moved') await storage.db.habitCheckins.put({ ...fact, habitId: 'synthetic-another-parent' });
  await store.getState().loadFromDB(); const before = await snapshot();
  await assert.rejects(store.getState().setHabitFrequency(opened, 'weekly', today), /刚刚|不存在/);
  assert.deepEqual(await snapshot(), before);
});

test('same-frequency requests do not bypass child or parent snapshot validation', async () => {
  const opened = await seed(); await storage.db.habitCheckins.put(checkin(opened.id));
  const before = await snapshot(); await assert.rejects(store.getState().setHabitFrequency(opened, 'daily', today), /刚刚/); assert.deepEqual(await snapshot(), before);
});

test('the whole displayed parent, target ID and child set are frozen before the first awaited read', async () => {
  const original = row(), fact = { ...checkin(original.id), retained: new Uint8Array([1, 2]) }, opened = await seed(original, [fact]);
  const held = delayActorRead(), writing = store.getState().setHabitFrequency(opened, 'weekly', today); await held.started;
  opened.id = 'synthetic-tampered-id'; opened.source.name = 'Tampered after click';
  (opened.checkinSources[0] as typeof fact).retained[0] = 99; opened.checkinSources.length = 0;
  held.release(); try { assert.equal((await writing).status, 'committed-local'); } finally { held.restore(); }
  assert.deepEqual(await storage.db.habits.get(original.id), { ...original, frequency: 'weekly', updatedAt: now });
  assert.deepEqual(await storage.db.habitCheckins.toArray(), [fact]); assert.equal(await storage.db.habits.count(), 1);
});

test('a peer child addition during initial actor read makes the frozen preview stale', async () => {
  const opened = await seed(), held = delayActorRead(), writing = store.getState().setHabitFrequency(opened, 'weekly', today); void writing.catch(() => undefined); await held.started;
  await storage.db.habitCheckins.put(checkin(opened.id)); const before = await snapshot(); held.release();
  try { await assert.rejects(writing, /刚刚/); } finally { held.restore(); }
  assert.deepEqual(await snapshot(), before);
});

test('the complete child snapshot treats row order as a set while preserving every row', async () => {
  const original = row(), facts = [checkin(original.id), checkin(original.id, today, false)], opened = await seed(original, facts);
  opened.checkinSources.reverse(); await store.getState().setHabitFrequency(opened, 'weekly', today);
  assert.deepEqual(await storage.db.habitCheckins.toArray(), facts);
});

test('missing actor-bound source, wrong target ID and unsupported frequency reject without writes', async () => {
  const opened = await seed(), before = await snapshot();
  await assert.rejects(store.getState().setHabitFrequency(structuredClone(opened), 'weekly', today), /预览/);
  await assert.rejects(store.getState().setHabitFrequency({ ...opened, id: 'synthetic-wrong-target' }, 'weekly', today), /预览/);
  await assert.rejects(store.getState().setHabitFrequency(opened, 'monthly' as 'weekly', today), /每天或每周/);
  assert.deepEqual(await snapshot(), before);
});

for (const date of ['2026-10-06', '2026-10-08', '2026-02-30', '']) test(`preview date ${JSON.stringify(date)} cannot schedule a change or save an old preview`, async () => {
  const opened = await seed(), before = await snapshot();
  await assert.rejects(store.getState().setHabitFrequency(opened, 'weekly', date), /重新打开频率预览/);
  assert.deepEqual(await snapshot(), before);
});

test('business midnight during the initial read rejects the old-day preview', async context => {
  const opened = await seed(), before = await snapshot(), held = delayActorRead();
  const writing = store.getState().setHabitFrequency(opened, 'weekly', today); void writing.catch(() => undefined); await held.started;
  context.mock.timers.setTime(now + 20_000); held.release();
  try { await assert.rejects(writing, /日期已变化/); } finally { held.restore(); }
  assert.deepEqual(await snapshot(), before);
});

test('business midnight during the final outbox write rolls back parent and queue', async context => {
  const opened = await seed(), before = await snapshot();
  const crossMidnight = () => { context.mock.timers.setTime(now + 20_000); };
  storage.db.outbox.hook('creating', crossMidnight);
  try { await assert.rejects(store.getState().setHabitFrequency(opened, 'weekly', today), /日期已变化/); } finally { storage.db.outbox.hook('creating').unsubscribe(crossMidnight); }
  assert.deepEqual(await snapshot(), before);
});

for (const kind of ['clear', 'logout', 'owner', 'reauth'] as const) test(`initial captured authority rejects after ${kind}`, async () => {
  const opened = await seed(), held = delayActorRead(), writing = store.getState().setHabitFrequency(opened, 'weekly', today); void writing.catch(() => undefined); await held.started;
  if (kind === 'clear') { await storage.clearAllData({ allowPending: true }); store.setState({ items: [], loaded: false }); }
  if (kind === 'logout') api.clearSession();
  if (kind === 'owner') api.setSessionActive('synthetic-other-owner');
  if (kind === 'reauth') { api.clearSession(); api.setSessionActive(owner); }
  const before = await snapshot(); held.release();
  try { await assert.rejects(writing, /变化/); } finally { held.restore(); }
  assert.deepEqual(await snapshot(), before);
});

for (const kind of ['reauth', 'clear-then-restored-row'] as const) test(`the viewed source authority rejects an unchanged source after ${kind}`, async () => {
  const original = row(), opened = await seed(original);
  if (kind === 'reauth') { api.clearSession(); api.setSessionActive(owner); }
  else { await storage.clearAllData({ allowPending: true }); await storage.db.habits.put(original); }
  const before = await snapshot(); await assert.rejects(store.getState().setHabitFrequency(opened, 'weekly', today), /变化/); assert.deepEqual(await snapshot(), before);
  await store.getState().loadFromDB(); await store.getState().setHabitFrequency(view(), 'weekly', today); assert.equal((await storage.db.habits.get(opened.id))?.frequency, 'weekly');
});

for (const kind of ['logout', 'owner', 'reauth', 'clear-epoch'] as const) test(`${kind} during the final outbox write rolls back all transaction writes`, async () => {
  const original = row(), opened = await seed(original, [checkin(original.id)]), before = await snapshot(); let epochWrite: PromiseLike<unknown> | undefined;
  const fault = () => {
    if (kind === 'logout') api.clearSession();
    if (kind === 'owner') api.setSessionActive('synthetic-other-owner');
    if (kind === 'reauth') { api.clearSession(); api.setSessionActive(owner); }
    if (kind === 'clear-epoch') epochWrite = storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'synthetic-changed-clear-epoch' });
  };
  storage.db.outbox.hook('creating', fault);
  try { await assert.rejects(store.getState().setHabitFrequency(opened, 'weekly', today), /变化/); if (epochWrite) await Promise.resolve(epochWrite).catch(() => undefined); }
  finally { storage.db.outbox.hook('creating').unsubscribe(fault); }
  assert.deepEqual(await snapshot(), before);
});

test('outbox quota failure rolls back the current frequency and permits exact retry', async () => {
  const original = row(), opened = await seed(original, [checkin(original.id)]), before = await snapshot(); let hits = 0;
  const fault = () => { hits += 1; throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', fault);
  try { await assert.rejects(store.getState().setHabitFrequency(opened, 'weekly', today), /quota/); } finally { storage.db.outbox.hook('creating').unsubscribe(fault); }
  assert.equal(hits, 1); assert.deepEqual(await snapshot(), before);
  assert.equal((await store.getState().setHabitFrequency(opened, 'weekly', today)).status, 'committed-local'); assert.equal(await storage.db.outbox.count(), 1);
});

test('postcommit refresh failure reports durable success and does not permit an extra stale write', async () => {
  const original = row(), opened = await seed(original, [checkin(original.id)]), originalRead = storage.db.habits.toArray;
  storage.db.habits.toArray = (() => Promise.reject(new Error('synthetic refresh failure'))) as typeof originalRead;
  try { assert.deepEqual(await store.getState().setHabitFrequency(opened, 'weekly', today), { status: 'committed-local', viewUpdated: false }); } finally { storage.db.habits.toArray = originalRead; }
  assert.match(store.getState().refreshError!, /已保存在本机/); assert.equal((await storage.db.habits.get(opened.id))?.frequency, 'weekly');
  const before = await snapshot(); await assert.rejects(store.getState().setHabitFrequency(opened, 'weekly', today), /刚刚/); assert.deepEqual(await snapshot(), before);
  await store.getState().loadFromDB(); assert.equal((await store.getState().setHabitFrequency(view(), 'weekly', today)).status, 'already-achieved');
  assert.equal(await storage.db.outbox.count(), 1); assert.equal(store.getState().refreshError, null);
});

for (const kind of ['clear', 'reauth'] as const) test(`a successful frequency write cannot publish an old view after ${kind}`, async () => {
  const opened = await seed(), held = delayCompletedSnapshot(), writing = store.getState().setHabitFrequency(opened, 'weekly', today); await held.started;
  if (kind === 'clear') await storage.clearAllData({ allowPending: true });
  else { api.clearSession(); api.setSessionActive(owner); }
  store.setState({ items: [], loaded: false, refreshError: null }); held.release();
  try { assert.deepEqual(await writing, { status: 'committed-local', viewUpdated: false }); } finally { held.restore(); }
  assert.deepEqual(store.getState().items, []); assert.equal(store.getState().refreshError, null);
  assert.equal(await storage.db.outbox.count(), kind === 'clear' ? 0 : 1);
});

test('parent and full child-set CAS share one locked snapshot while a peer edit waits', async () => {
  const original = row(), opened = await seed(original), held = gate(), originalRead = storage.db.habits.get; let first = true;
  storage.db.habits.get = (function (key: string) {
    return originalRead.call(storage.db.habits, key).then(async value => {
      if (first) { first = false; held.enter(); await Dexie.waitFor(held.waiting); } return value;
    });
  }) as typeof originalRead;
  const writing = store.getState().setHabitFrequency(opened, 'weekly', today); await held.started;
  let peerFinished = false;
  const peer = storage.db.transaction('rw', storage.db.habitCheckins, async () => { await storage.db.habitCheckins.put(checkin(original.id)); peerFinished = true; });
  assert.equal(peerFinished, false); held.release();
  try { assert.equal((await writing).status, 'committed-local'); await peer; } finally { storage.db.habits.get = originalRead; }
  assert.equal((await storage.db.habits.get(original.id))?.frequency, 'weekly'); assert.equal(await storage.db.habitCheckins.count(), 1);
});

test('standard protocol-2 payload retains known base version and pending child work without history fields', async () => {
  const original = row(), opened = await seed(original, [checkin(original.id)]);
  await storage.db.settings.put({ key: `sync-version:habits:${original.id}`, value: '41' });
  await sync.enqueueSync('habits', 'upsert', habitPayload(original));
  await sync.enqueueSync('habitCheckins', 'upsert', { id: `${original.id}|${today}`, habitId: original.id, date: today, done: false, source: 'manual', confirmed: true });
  const previous = await storage.db.outbox.toArray();
  await store.getState().setHabitFrequency(opened, 'weekly', today);
  const operations = await storage.db.outbox.toArray(); assert.equal(operations.length, 3);
  assert.deepEqual(operations.slice(0, 2), previous); assert.equal(operations[2].baseVersion, '41'); assert.equal(operations[2].predecessorSeq, previous[0].seq);
  const requests: Array<Record<string, unknown>> = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async (_path, init = {}) => {
    const body = JSON.parse(String(init.body)) as { mutationId: string; habits: Array<{ id: string }>; habitCheckins: Array<{ id: string }> };
    requests.push(body);
    return Response.json({ protocol: 2, acknowledged: true, mutationId: body.mutationId, versions: [
      ...body.habits.map(habit => ({ entity: 'habits', entityId: habit.id, seq: '42' })),
      ...body.habitCheckins.map(fact => ({ entity: 'habitCheckins', entityId: fact.id, seq: '43' })),
    ] });
  };
  try { sync.resumeSync(); assert.equal(await sync.flush(), true); } finally { sync.pauseSync(); globalThis.fetch = originalFetch; }
  assert.equal(requests.length, 1); assert.deepEqual(Object.keys(requests[0]).sort(), ['habitCheckins', 'habits', 'mutationId', 'protocol']);
  assert.deepEqual(requests[0].habits, [{ ...habitPayload({ ...original, frequency: 'weekly' }), baseVersion: '41' }]);
  assert.equal(await storage.db.outbox.count(), 0); assert.equal((await storage.db.settings.get(`sync-version:habits:${original.id}`))?.value, '42');
  assert.deepEqual(await storage.db.habitCheckins.toArray(), [checkin(original.id)]);
});
