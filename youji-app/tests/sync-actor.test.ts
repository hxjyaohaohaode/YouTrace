import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import Dexie from 'dexie';
const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v), removeItem: (k: string) => map.delete(k), clear: () => map.clear() }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: new EventTarget() });
const storage = await import('../src/db/index.ts');
const session = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { useGoalStore } = await import('../src/stores/goalStore.ts');
const owner = 'synthetic-sync-actor-a';
const goal = { id: 'synthetic-actor-goal', title: 'Synthetic A only', description: 'Private to synthetic A', level: 'short' as const, domain: '学习', priority: 'medium' as const, progress: 25, targetDate: null, createdAt: 1, updatedAt: 1, syncScope: 'account' as const };
let calls: Array<{ path: string; init: RequestInit }> = [];
function barrier() { let entered!: () => void, release!: () => void; const started = new Promise<void>(r => { entered = r; }), waiting = new Promise<void>(r => { release = r; }); return { entered, release, started, waiting }; }
async function seed(blocked = false) { await storage.db.goalRecords.put(goal); await storage.db.outbox.add({ entity: 'goals', op: 'upsert', payload: goal, baseVersion: '0', queuedAt: 1, status: blocked ? 'blocked' : 'pending', attempts: 2 }); }
async function snapshot() { return { goals: await storage.db.goalRecords.toArray(), queue: await storage.db.outbox.toArray(), settings: await storage.db.settings.toArray() }; }
function ack(init: RequestInit) { const body = JSON.parse(String(init.body)); return Response.json({ protocol: 2, mutationId: body.mutationId, acknowledged: true, versions: [{ entity: 'goals', entityId: goal.id, seq: '1' }] }); }
function page() { return Response.json({ protocol: 2, features: ['goals-v1'], events: [{ seq: '1', entity: 'goals', entityId: goal.id, operation: 'upsert', data: { ...goal, userId: owner } }], nextCursor: '1', hasMore: false }); }
const changes = {
  owner: () => session.setSessionActive('synthetic-sync-actor-b'),
  logout: () => session.clearSession(),
  reauthentication: () => { session.clearSession(); session.setSessionActive(owner); },
  revision: () => localStorage.setItem(session.SESSION_REVISION_KEY, 'synthetic-new-revision'),
  signedOut: () => localStorage.setItem(session.SIGNED_OUT_KEY, 'true'),
  epoch: async () => { await storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'synthetic-changed-epoch' }); },
};
before(async () => { await storage.bindAccountDatabase(owner); });
beforeEach(async () => {
  sync.pauseSync(); localStorage.clear(); session.setSessionActive(owner);
  await storage.clearAllData({ allowPending: true }); calls = [];
  globalThis.fetch = async (path, init = {}) => { calls.push({ path: String(path), init }); return String(path).includes('/sync/push') ? ack(init) : page(); };
});
after(() => { sync.pauseSync(); session.clearSession(); storage.db.close(); });

test('durable Goal A commit delivered after verified B replacement cannot upload A or consume its queue', async () => {
  const db = storage.db, held = barrier(), transaction = db.transaction; let first = true;
  db.transaction = function (...args: Parameters<typeof transaction>) {
    const result = Reflect.apply(transaction, this, args);
    if (first && args[0] === 'rw' && Array.isArray(args[1]) && args[1].includes(db.goalRecords)) { first = false; return result.then(value => Dexie.ignoreTransaction(async () => { held.entered(); await held.waiting; return value; })); }
    return result;
  } as typeof transaction;
  try {
    const pending = useGoalStore.getState().addGoal(goal, 'synthetic-stable-create-intent'); await held.started;
    const before = await snapshot(); sync.pauseSync(); session.clearSession(); session.setSessionActive('synthetic-sync-actor-b'); sync.resumeSync(); held.release();
    const result = await pending; await sync.flush(); await sync.pullServerChanges();
    assert.equal(result.view, 'context-changed'); assert.equal(calls.length, 0); assert.deepEqual(await snapshot(), before);
  } finally { db.transaction = transaction; held.release(); sync.pauseSync(); }
});

test('mismatched bound database refuses direct push, pull, retry, reset and enqueue without reads becoming writes', async () => {
  await seed(true); const before = await snapshot(); session.setSessionActive('synthetic-sync-actor-b'); sync.resumeSync();
  assert.equal(await sync.flush(), false); await sync.pullServerChanges();
  await assert.rejects(sync.retryBlockedSync()); await assert.rejects(sync.resetSyncCursor()); await assert.rejects(sync.enqueueSync('goals', 'upsert', goal));
  assert.equal(calls.length, 0); assert.deepEqual(await snapshot(), before);
});

for (const [name, change] of Object.entries(changes)) {
  test(`in-flight push ${name} retains exact frozen batch and queue without ACK/version consumption`, async () => {
    await seed(); const held = barrier();
    globalThis.fetch = async (path, init = {}) => { calls.push({ path: String(path), init }); held.entered(); await held.waiting; return ack(init); };
    sync.resumeSync(); const pending = sync.flush(); await held.started; const before = await snapshot();
    await change(); held.release(); assert.equal(await pending, false);
    const after = await snapshot(); assert.deepEqual(after.goals, before.goals); assert.deepEqual(after.queue, before.queue);
    assert.deepEqual(after.settings.filter(r => r.key !== storage.LOCAL_DATA_EPOCH_KEY), before.settings.filter(r => r.key !== storage.LOCAL_DATA_EPOCH_KEY)); assert.equal(calls.length, 1);
  });
  test(`in-flight pull ${name} neither publishes remote rows nor advances cursor`, async () => {
    const held = barrier(); globalThis.fetch = async (path, init = {}) => { calls.push({ path: String(path), init }); held.entered(); await held.waiting; return page(); };
    sync.resumeSync(); const pending = sync.pullServerChanges(); await held.started; await change(); held.release(); await pending;
    assert.equal(await storage.db.goalRecords.count(), 0); assert.equal(await storage.db.settings.get('syncV2Cursor'), undefined); assert.equal(await storage.db.settings.get(`sync-version:goals:${goal.id}`), undefined);
  });
  test(`ACK last-write ${name} rolls back deletion and all version updates`, async () => {
    await seed(); const original = storage.db.outbox.bulkDelete; let before: Awaited<ReturnType<typeof snapshot>> | undefined;
    globalThis.fetch = async (_path, init = {}) => { before = await Dexie.ignoreTransaction(snapshot); return ack(init); };
    storage.db.outbox.bulkDelete = async function (...args: Parameters<typeof original>) { const result = await original.apply(this, args); await change(); return result; };
    try { sync.resumeSync(); assert.equal(await sync.flush(), false); assert.ok(before); const after = await snapshot(); assert.deepEqual(after, before); }
    finally { storage.db.outbox.bulkDelete = original; }
  });
  test(`pull last-write ${name} rolls back rows, versions and cursor`, async () => {
    const original = storage.db.settings.put; let injected = false;
    storage.db.settings.put = async function (...args: Parameters<typeof original>) {
      const result = await original.apply(this, args);
      if (!injected && args[0].key === 'lastPullAt') { injected = true; await change(); }
      return result;
    } as typeof original;
    try {
      const before = await snapshot(); sync.resumeSync(); await sync.pullServerChanges();
      assert.equal(injected, true); assert.deepEqual(await snapshot(), before);
    } finally { storage.db.settings.put = original; }
  });
}

test('network error from an obsolete session does not mark pending rows or schedule its retry', async () => {
  await seed(); const held = barrier(); globalThis.fetch = async () => { held.entered(); await held.waiting; throw new Error('Synthetic old transport failure'); };
  sync.resumeSync(); const pending = sync.flush(); await held.started; const before = await snapshot(); session.clearSession(); held.release(); assert.equal(await pending, false); assert.deepEqual(await snapshot(), before);
});

test('retry status mutation is rolled back if authority changes at the final write', async () => {
  await seed(true); const before = await snapshot();
  const hook = () => { session.setSessionActive('synthetic-sync-actor-b'); };
  storage.db.outbox.hook('updating', hook);
  try { await assert.rejects(sync.retryBlockedSync()); assert.deepEqual(await snapshot(), before); assert.equal(calls.length, 0); }
  finally { storage.db.outbox.hook('updating').unsubscribe(hook); }
});

for (const [name, change] of Object.entries(changes)) {
  test(`prepared batch delivery after ${name} cannot start any HTTP request`, async () => {
    await seed(); const db = storage.db, held = barrier(), original = db.transaction; let first = true;
    db.transaction = function (...args: Parameters<typeof original>) {
      const result = Reflect.apply(original, this, args);
      if (first && args[0] === 'rw') { first = false; return result.then(value => Dexie.ignoreTransaction(async () => { held.entered(); await held.waiting; return value; })); }
      return result;
    } as typeof original;
    try {
      sync.resumeSync(); const pending = sync.flush(); await held.started; const before = await snapshot(); await change(); held.release(); assert.equal(await pending, false);
      assert.equal(calls.length, 0); const after = await snapshot(); assert.deepEqual(after.queue, before.queue); assert.deepEqual(after.settings.filter(row => row.key !== storage.LOCAL_DATA_EPOCH_KEY), before.settings.filter(row => row.key !== storage.LOCAL_DATA_EPOCH_KEY));
    } finally { db.transaction = original; held.release(); }
  });
}

for (const [name, change] of Object.entries(changes).filter(([name]) => name !== 'epoch')) {
  test(`identity ${name} after final pre-send epoch read does not leak one last request`, async () => {
    await seed(); const db = storage.db, transaction = db.transaction, get = db.settings.get; let sendPhase = false, injected = false;
    db.transaction = function (...args: Parameters<typeof transaction>) {
      if (args[0] === 'r') sendPhase = true;
      return Reflect.apply(transaction, this, args);
    } as typeof transaction;
    db.settings.get = async function (...args: Parameters<typeof get>) {
      const result = await get.apply(this, args);
      if (sendPhase && !injected && args[0] === storage.LOCAL_DATA_EPOCH_KEY) { injected = true; await change(); }
      return result;
    } as typeof get;
    try { sync.resumeSync(); assert.equal(await sync.flush(), false); assert.equal(injected, true); assert.equal(calls.length, 0); assert.equal(await db.outbox.count(), 1); assert.ok(await db.settings.get('syncV2Batch')); }
    finally { db.transaction = transaction; db.settings.get = get; }
  });
}

test('a resume timer captured before reauthentication never adopts the new same-owner session', async () => {
  await seed(); const before = await snapshot(); sync.resumeSync();
  session.clearSession(); session.setSessionActive(owner);
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(calls.length, 0); assert.deepEqual(await snapshot(), before);
  assert.equal(await sync.flush(), true); assert.equal(calls.length, 1); assert.equal(await storage.db.outbox.count(), 0);
});

test('a timer captured before clear cannot send a new epoch queue without a current trigger', async () => {
  await seed(); sync.resumeSync(); await storage.clearAllData({ allowPending: true }); await seed(); const before = await snapshot();
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(calls.length, 0); assert.deepEqual(await snapshot(), before);
  assert.equal(await sync.flush(), true); assert.equal(calls.length, 1);
});

test('failure metadata transaction also rolls back when identity changes after a queue update', async () => {
  await seed(); const update = storage.db.outbox.update; let before: Awaited<ReturnType<typeof snapshot>> | undefined, injected = false;
  globalThis.fetch = async () => { before = await snapshot(); return Response.json({ error: 'Synthetic conflict', code: 'VERSION_CONFLICT' }, { status: 409 }); };
  storage.db.outbox.update = async function (...args: Parameters<typeof update>) { const result = await update.apply(this, args); injected = true; session.setSessionActive('synthetic-sync-actor-b'); return result; };
  try { sync.resumeSync(); assert.equal(await sync.flush(), false); assert.equal(injected, true); assert.ok(before); assert.deepEqual(await snapshot(), before); }
  finally { storage.db.outbox.update = update; }
});

test('capture confirmation cannot write account rows or outbox after signout', async () => {
  const { applyCaptureDraft } = await import('../src/services/quickNoteIntegration.ts');
  const before = await snapshot(), noteCount = await storage.db.quickNotes.count(); session.clearSession();
  await assert.rejects(applyCaptureDraft({ id: 'synthetic-signedout-capture', input: 'Synthetic retained input', expenses: [], habits: [], todos: [], diary: null, mood: null, moodScore: 5 }));
  assert.deepEqual(await snapshot(), before); assert.equal(await storage.db.quickNotes.count(), noteCount); assert.equal(calls.length, 0);
});

test('legacy Goal with object audit time stays local and unqueued during explicit enrollment', async () => {
  const raw = { ...goal, syncScope: 'local', createdAt: { unexpectedPrivate: 'Synthetic retained audit detail' } };
  await storage.db.table('goalRecords').put(raw); await useGoalStore.getState().loadFromDB(); const before = await snapshot();
  await assert.rejects(useGoalStore.getState().enableSync(useGoalStore.getState().items, owner), /尚未传输/);
  assert.deepEqual(await snapshot(), before); assert.equal(calls.length, 0);
});

for (const change of ['reauth', 'clear'] as const) for (const oldTimerFiresWhileBusy of [true, false]) test(`old resume timer preserves ${change} demand (${oldTimerFiresWhileBusy ? 'fires busy' : 'fires after release'})`, async () => {
  await seed(); const held = barrier(), original = storage.db.outbox.count; let reads = 0;
  storage.db.outbox.count = (() => original.call(storage.db.outbox).then(async value => { if (++reads === 2) { held.entered(); await held.waiting; } return value; })) as typeof original;
  try {
    sync.resumeSync(); const draining = sync.flush(); await held.started; assert.equal(calls.length, 1);
    if (change === 'reauth') { session.clearSession(); session.setSessionActive(owner); }
    else await storage.clearAllData({ allowPending: true });
    await sync.enqueueSync('goals', 'upsert', { ...goal, id: 'synthetic-new-session-goal' });
    // Let the already-armed old-session resume timer fire while still busy.
    if (oldTimerFiresWhileBusy) await new Promise(resolve => setTimeout(resolve, 600));
    held.release(); await draining; storage.db.outbox.count = original;
    globalThis.fetch = async (path, init = {}) => { calls.push({ path: String(path), init }); const body = JSON.parse(String(init.body)); return Response.json({ protocol: 2, mutationId: body.mutationId, acknowledged: true, versions: body.goals.map((row: { id: string }) => ({ entity: 'goals', entityId: row.id, seq: '2' })) }); };
    const deadline = Date.now() + 2500;
    while (await original.call(storage.db.outbox) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await original.call(storage.db.outbox), 0); assert.equal(calls.length, 2);
    assert.equal(JSON.parse(String(calls[1].init.body)).goals[0].id, 'synthetic-new-session-goal');
  } finally { held.release(); storage.db.outbox.count = original; }
});
