import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Dexie from 'dexie';
import { ACCOUNT_SCHEMA, GENERATION_STORE, accountDatabaseName, encodeRecovery, generationRecovery, prepareAccountGeneration } from '../src/db/accountGeneration.ts';

const memoryStorage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; };
Object.assign(globalThis, { localStorage: memoryStorage(), sessionStorage: memoryStorage(), window: Object.assign(new EventTarget(), { location: { replace() {} } }) });
const storage = await import('../src/db/index.ts');

async function sourceDatabase(owner: string, extra: Record<string, string> = {}) {
  const source = new Dexie(accountDatabaseName(owner, true)); source.version(2).stores({ ...ACCOUNT_SCHEMA, ...extra }); await source.open(); return source;
}
async function currentDatabase(owner: string) { await prepareAccountGeneration(owner); const current = new storage.YoujiDatabase(owner, true); await current.open(); return current; }
const schedule = { id: 'weekly-001', date: '2026-10-05', startTime: '09:00', endTime: '10:00', title: 'Synthetic weekly', location: '', type: 'work' as const, repeat: 'weekly' as const, remind: 0, createdAt: 1, updatedAt: 1 };
const exception = { occurrenceDate: '2026-10-12', date: '2026-10-13', startTime: '11:00', endTime: '12:00', title: 'Only this occurrence', location: 'Synthetic place', type: 'work' as const, remind: 5 };

test('account generation copies every table, raw keys, unknown fields, frozen payload and deleted sequence high water exactly', async () => {
  const owner = 'generation-all-tables';
  const source = await sourceDatabase(owner, { unknownStore: '++key, &uniqueValue', externalKeys: '' });
  const shared = { alsoUnknown: new Date('2020-01-01'), bytes: new Uint8Array([0, 1, 255]), absent: undefined, futureNested: { keep: true } };
  for (const table of source.tables) {
    if (['settings', 'outbox', 'unknownStore', 'externalKeys'].includes(table.name)) continue;
    await table.put({ id: `raw-${table.name}`, ...shared });
    await table.put({ id: 77, rawNumericId: true });
  }
  const batch = { mutationId: 'frozen-before-cutover', seqs: [17], keys: ['schedules|weekly-001'], payload: { protocol: 2, mutationId: 'frozen-before-cutover', schedules: [schedule], unexpectedFuture: { raw: true } } };
  await source.table('settings').bulkPut([{ key: 'syncV2Batch', value: batch }, { key: 'captureReview', value: { draft: 'unconfirmed', ...shared } }, { key: 'syncV2Cursor', value: '9007199254740993' }]);
  await source.table('outbox').put({ seq: 17, entity: 'schedules', op: 'upsert', payload: schedule, queuedAt: 1, predecessorSeq: 4, unexpected: shared });
  await source.table('outbox').put({ seq: 800, entity: 'todos' }); await source.table('outbox').delete(800);
  await source.table('unknownStore').put({ key: 31, uniqueValue: 'x', ...shared });
  await source.table('externalKeys').put({ ...shared }, [new Date('2020-01-01'), 'raw-key']);
  const before = new Map(await Promise.all(source.tables.map(async (table) => [table.name, await table.toArray()] as const)));
  const current = await currentDatabase(owner);
  assert.equal(current.name, accountDatabaseName(owner));
  assert.deepEqual(new Set(current.tables.map((table) => table.name)), new Set([...source.tables.map((table) => table.name), GENERATION_STORE]));
  for (const table of source.tables) {
    assert.deepEqual(await current.table(table.name).toArray(), before.get(table.name), table.name);
    assert.deepEqual(await current.table(table.name).toCollection().primaryKeys(), await table.toCollection().primaryKeys(), `${table.name} raw keys`);
    assert.deepEqual(await table.toArray(), before.get(table.name), `${table.name} source unchanged`);
  }
  assert.equal(await current.outbox.add({ entity: 'todos', op: 'upsert', payload: {}, queuedAt: 2 }), 801);
  assert.equal(await source.table('outbox').add({ entity: 'todos' }), 801, 'aborted source generator probe leaves original high-water mark unchanged');
  assert.deepEqual((await current.settings.get('syncV2Batch'))?.value, batch);
  current.close(); source.close();
});

test('old JavaScript can send a stripped payload and valid ACK only in its retained generation, never delete the occurrence edit', async () => {
  const owner = 'generation-old-client';
  const old = await sourceDatabase(owner);
  await old.table('schedules').put(schedule);
  await old.table('outbox').put({ seq: 9, op: 'upsert', entity: 'schedules', payload: schedule, queuedAt: 1 });
  const frozen = { mutationId: 'frozen-original', seqs: [9], keys: ['schedules|weekly-001'], payload: { protocol: 2, mutationId: 'frozen-original', schedules: [schedule] } };
  await old.table('settings').put({ key: 'syncV2Batch', value: frozen });
  const current = await currentDatabase(owner);
  const edited = { ...schedule, exceptions: [exception], updatedAt: 2 };
  await current.transaction('rw', current.schedules, current.outbox, async () => {
    await current.schedules.put(edited);
    await current.outbox.add({ op: 'upsert', entity: 'schedules', payload: edited, queuedAt: 2, predecessorSeq: 9 });
  });
  // This is the legacy failure mechanism: its whitelist omits exceptions and
  // a valid ACK deletes the frozen queue entries in the database it opened.
  const oldRow = await old.table('schedules').get(schedule.id);
  const strippedPayload = { id: oldRow.id, title: oldRow.title, date: oldRow.date, repeat: oldRow.repeat };
  assert.equal('exceptions' in strippedPayload, false);
  const ack = { protocol: 2, mutationId: frozen.mutationId, acknowledged: true };
  assert.equal(ack.mutationId, frozen.mutationId);
  await old.transaction('rw', old.table('outbox'), old.table('settings'), async () => {
    await old.table('outbox').bulkDelete(frozen.seqs); await old.table('settings').delete('syncV2Batch');
  });
  await old.table('schedules').put({ ...schedule, title: 'Late old-window title' });
  assert.deepEqual((await current.schedules.get(schedule.id))?.exceptions, [exception]);
  assert.equal(await current.outbox.count(), 2, 'old ACK cannot remove old or new entries from new generation');
  assert.deepEqual((await current.settings.get('syncV2Batch'))?.value, frozen);
  const recovery = await generationRecovery(owner);
  assert.deepEqual(recovery.status.changedTables.sort(), ['outbox', 'schedules', 'settings']);
  assert.equal((recovery.source!.tables.find((table) => table.name === 'schedules')!.rows[0].value as { title: string }).title, 'Late old-window title');
  await prepareAccountGeneration(owner);
  assert.deepEqual((await current.schedules.get(schedule.id))?.exceptions, [exception]);
  current.close(); old.close();
});

test('copy quota failure rolls all target rows back; source remains unchanged and restart retries without empty fallback', async () => {
  const owner = 'generation-quota'; const source = await sourceDatabase(owner);
  await source.table('schedules').put(schedule); await source.table('settings').put({ key: 'draft', value: 'keep exact input' });
  const put = IDBObjectStore.prototype.put; let hits = 0;
  IDBObjectStore.prototype.put = function(value, key) {
    if (this.transaction.db.name === accountDatabaseName(owner) && this.name === 'settings') { hits++; throw new DOMException('synthetic generation quota', 'QuotaExceededError'); }
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  };
  try { await assert.rejects(prepareAccountGeneration(owner), /quota/); } finally { IDBObjectStore.prototype.put = put; }
  assert.equal(hits, 1);
  const partial = new Dexie(accountDatabaseName(owner)); await partial.open();
  for (const table of partial.tables) assert.equal(await table.count(), 0, table.name);
  partial.close();
  assert.deepEqual(await source.table('schedules').get(schedule.id), schedule);
  assert.equal((await source.table('settings').get('draft')).value, 'keep exact input');
  const current = await currentDatabase(owner);
  assert.deepEqual(await current.schedules.get(schedule.id), schedule);
  current.close(); source.close();
});

test('interruption after atomic copy before activation resumes exact copied snapshot, not later old-window edits', async () => {
  const owner = 'generation-interrupted'; const source = await sourceDatabase(owner); await source.table('schedules').put(schedule);
  const put = IDBObjectStore.prototype.put; let hits = 0;
  IDBObjectStore.prototype.put = function(value, key) {
    if (this.transaction.db.name === accountDatabaseName(owner) && this.name === GENERATION_STORE && value?.state === 'ready') { hits++; throw new DOMException('synthetic activation interruption', 'AbortError'); }
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  };
  try { await assert.rejects(prepareAccountGeneration(owner), /interruption/); } finally { IDBObjectStore.prototype.put = put; }
  assert.equal(hits, 1);
  await source.table('schedules').put({ ...schedule, title: 'after interrupted copy' });
  const current = await currentDatabase(owner);
  assert.deepEqual(await current.schedules.get(schedule.id), schedule);
  assert.deepEqual((await generationRecovery(owner)).status.changedTables, ['schedules']);
  current.close(); source.close();
});

test('concurrent initialization is idempotent and restarting after source deletion keeps current data', async () => {
  const owner = 'generation-idempotent'; const source = await sourceDatabase(owner); await source.table('schedules').put(schedule);
  await Promise.all([prepareAccountGeneration(owner), prepareAccountGeneration(owner), prepareAccountGeneration(owner)]);
  source.close(); await Dexie.delete(accountDatabaseName(owner, true));
  const current = await currentDatabase(owner); assert.equal(await current.schedules.count(), 1);
  await current.schedules.update(schedule.id, { title: 'new generation edit' }); current.close();
  const reopened = await currentDatabase(owner); assert.equal((await reopened.schedules.get(schedule.id))?.title, 'new generation edit'); reopened.close();
});

test('invalid owners, contradictory source owners and mismatched destination receipts fail closed', async () => {
  await assert.rejects(prepareAccountGeneration('../guest'), /标识/);
  const owner = 'generation-wrong-owner'; const source = await sourceDatabase(owner); await source.table('schedules').put({ ...schedule, userId: 'another-owner' });
  await assert.rejects(prepareAccountGeneration(owner), /归属/);
  assert.equal(await Dexie.exists(accountDatabaseName(owner)), false);
  assert.equal((await source.table('schedules').get(schedule.id)).userId, 'another-owner'); source.close();
  const otherOwner = 'generation-marker-owner'; const current = await currentDatabase(otherOwner);
  await current.table(GENERATION_STORE).update('cutover', { ownerId: 'foreign-owner' }); current.close();
  await assert.rejects(prepareAccountGeneration(otherOwner), /账号或版本/);
});

test('unknown existing target data is not overwritten or adopted without an atomic copy receipt', async () => {
  const owner = 'generation-unproven-target'; const target = new Dexie(accountDatabaseName(owner)); target.version(3).stores({ ...ACCOUNT_SCHEMA, [GENERATION_STORE]: 'key' }); await target.open();
  await target.table('schedules').put(schedule); target.close();
  await assert.rejects(prepareAccountGeneration(owner), /未确认资料/);
  const inspect = new Dexie(accountDatabaseName(owner)); await inspect.open(); assert.deepEqual(await inspect.table('schedules').get(schedule.id), schedule); inspect.close();
});

test('pre-goal-generation account records preserve every old goal field without upload permission', async () => {
  const owner = 'generation-v1-goals'; const source = new Dexie(accountDatabaseName(owner, true)); source.version(1).stores({ goals: 'id', settings: 'key' }); await source.open();
  const goal = { id: 'legacy-goal', title: 'Keep', privateUnknown: { source: 'original' }, progress: 24 }; await source.table('goals').put(goal);
  const current = await currentDatabase(owner);
  assert.deepEqual(await current.table('goals').get(goal.id), goal); assert.deepEqual(await current.goalRecords.get(goal.id), { ...goal, syncScope: 'local' }); assert.deepEqual((await current.settings.get(`goal-source-snapshot:${goal.id}`))?.value, goal);
  assert.equal(await current.outbox.count(), 0); assert.equal(source.verno, 1); current.close(); source.close();
});

test('guest/shared records never migrate into a verified account and clear never recopies a retained or late source', async () => {
  const guest = new storage.YoujiDatabase(); await guest.open(); await guest.todos.put({ id: 'guest-only', text: 'Guest', done: false, priority: 'medium' });
  const owner = 'generation-clear'; const source = await sourceDatabase(owner, { unknownExternalKey: '' });
  await source.table('unknownExternalKey').put({ lostByPlainJson: undefined, unknownValue: new Uint8Array([99]) }, ['keep', 99]); await source.table('schedules').put(schedule);
  await storage.bindAccountDatabase(owner);
  assert.equal(await storage.db.todos.get('guest-only'), undefined);
  const backup = await storage.exportAllData(); assert.equal(backup.schemaVersion, 3); assert.ok(backup.generationRecovery?.baseline); assert.equal(backup.ownerId, owner); assert.equal(backup.rawTablesEncoding, 'youtrace-structured-clone-v1'); assert.ok(JSON.stringify(backup.rawTables).includes('unknownExternalKey')); assert.ok(JSON.stringify(backup.rawTables).includes('lostByPlainJson'));
  await storage.clearAllData();
  assert.equal(await storage.db.schedules.count(), 0);
  await source.table('schedules').put({ ...schedule, title: 'Late after clear' });
  await source.table('todos').put({ id: 'late-old-only', text: 'Late old work' });
  await prepareAccountGeneration(owner);
  const reopened = new storage.YoujiDatabase(owner, true); await reopened.open();
  assert.equal(await reopened.schedules.count(), 0); assert.equal(await reopened.todos.count(), 0); assert.ok(await reopened.settings.get(storage.LOCAL_DATA_EPOCH_KEY));
  assert.equal((await generationRecovery(owner)).status.cleared, true);
  assert.deepEqual((await generationRecovery(owner)).status.changedTables.sort(), ['schedules', 'todos']);
  assert.equal(await guest.todos.count(), 1);
  const recovery = await storage.exportAccountGenerationRecovery(); assert.ok(JSON.stringify(recovery).includes('Late after clear')); assert.ok(JSON.stringify(recovery).includes('Synthetic weekly'));
  assert.deepEqual(await encodeRecovery({ field: undefined, binary: new Uint8Array([7]), date: new Date(1) }), await encodeRecovery(structuredClone({ field: undefined, binary: new Uint8Array([7]), date: new Date(1) })));
  reopened.close(); storage.db.close(); source.close(); guest.close();
});

test('recovery encoding preserves Error changes, array metadata, cyclic BigInt and shared binary view offsets', async () => {
  const buffer = new ArrayBuffer(8), array = Object.assign([1], { extra: 'keep custom metadata' });
  const cyclic: { self?: unknown; large: bigint } = { large: 9007199254740997n }; cyclic.self = cyclic;
  const encoded = JSON.stringify(await encodeRecovery({ error: new Error('exact problem', { cause: new Error('cause') }), array, cyclic, invalidDate: new Date(NaN), buffer, view: new Uint8Array(buffer, 2, 2), data: new DataView(buffer, 4, 2) }));
  for (const text of ['exact problem', 'cause', 'keep custom metadata', '9007199254740997', 'NaN', '"byteOffset":2', '"byteOffset":4', '"$ref"']) assert.ok(encoded.includes(text), text);
  assert.notEqual(JSON.stringify(await encodeRecovery(new Uint8Array(buffer, 1, 2))), JSON.stringify(await encodeRecovery(new Uint8Array(buffer, 2, 2))));
  assert.notEqual(JSON.stringify(await encodeRecovery(new Error('before'))), JSON.stringify(await encodeRecovery(new Error('after'))));
});

test('retained source detects resizable buffer capacity changes and export preserves capacity', async () => {
  const owner = 'generation-buffer-capacity';
  const source = await sourceDatabase(owner, { futureMetadata: 'id' });
  const original = { id: 'original-buffer', buffer: new ArrayBuffer(4, { maxByteLength: 8 }) };
  new Uint8Array(original.buffer).set([1, 2, 3, 4]);
  await source.table('futureMetadata').put(original);
  const current = await currentDatabase(owner);
  try {
    const copied = await current.table('futureMetadata').get(original.id);
    assert.equal(copied.buffer.resizable, true);
    assert.equal(copied.buffer.maxByteLength, 8);
    const changed = { ...original, buffer: new ArrayBuffer(4, { maxByteLength: 16 }) };
    new Uint8Array(changed.buffer).set([1, 2, 3, 4]);
    await source.table('futureMetadata').put(changed);
    const recovery = await generationRecovery(owner);
    assert.deepEqual(recovery.status.changedTables, ['futureMetadata']);
    const baselineBuffer = recovery.baseline?.tables.find(table => table.name === 'futureMetadata')?.rows[0].value as typeof original;
    const sourceBuffer = recovery.source?.tables.find(table => table.name === 'futureMetadata')?.rows[0].value as typeof original;
    assert.deepEqual(JSON.parse(JSON.stringify(await encodeRecovery(baselineBuffer.buffer))), { $id: 0, $type: 'ArrayBuffer', resizable: true, maxByteLength: 8, bytes: [1, 2, 3, 4] });
    assert.deepEqual(JSON.parse(JSON.stringify(await encodeRecovery(sourceBuffer.buffer))), { $id: 0, $type: 'ArrayBuffer', resizable: true, maxByteLength: 16, bytes: [1, 2, 3, 4] });
    assert.notDeepEqual(await encodeRecovery(new ArrayBuffer(4)), await encodeRecovery(new ArrayBuffer(4, { maxByteLength: 4 })));
    assert.equal((await current.table('futureMetadata').get(original.id)).buffer.maxByteLength, 8, 'Detection and export never apply a later source change to current data');
  } finally { current.close(); source.close(); }
});

// Delay delivery of one completed read, not the transaction itself: another
// browser connection may commit a cutover before this caller resumes.
async function interleaveAfterFirstTargetRead(owner: string, otherConnection: () => Promise<void>, operation: () => Promise<void>) {
  const transaction = IDBDatabase.prototype.transaction;
  let intercepted = false;
  let contenderError: unknown;
  IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase['transaction']>) {
    const tx = transaction.apply(this, args);
    if (!intercepted && this.name === accountDatabaseName(owner) && tx.mode === 'readonly') {
      intercepted = true;
      Object.defineProperty(tx, 'oncomplete', {
        configurable: true,
        set(handler: ((event: Event) => void) | null) {
          tx.addEventListener('complete', async (event: Event) => {
            try { await otherConnection(); } catch (error) { contenderError = error; }
            handler?.call(tx, event);
          });
        },
      });
    }
    return tx;
  };
  try { await operation(); assert.equal(intercepted, true); if (contenderError) throw contenderError; }
  finally { IDBDatabase.prototype.transaction = transaction; }
}

test('another connection completing cutover after an empty target read is accepted without losing its later edits', async () => {
  const owner = 'generation-cross-tab-read-gap';
  const source = await sourceDatabase(owner); await source.table('schedules').put(schedule);
  const first = new Dexie(accountDatabaseName(owner)); first.version(3).stores({ ...ACCOUNT_SCHEMA, [GENERATION_STORE]: 'key' }); await first.open();
  const second = new Dexie(accountDatabaseName(owner)); await second.open();
  try {
    await interleaveAfterFirstTargetRead(owner, async () => {
      await prepareAccountGeneration(owner);
      await second.table('schedules').update(schedule.id, { title: 'newer tab edit survives' });
    }, () => prepareAccountGeneration(owner));
    assert.equal((await first.table('schedules').get(schedule.id)).title, 'newer tab edit survives');
    assert.equal((await first.table(GENERATION_STORE).get('cutover')).state, 'ready');
    assert.deepEqual(await source.table('schedules').get(schedule.id), schedule);
  } finally { first.close(); second.close(); source.close(); }
});

for (const [field, value] of Object.entries({ ownerId: 'foreign-owner', generation: 'unknown-generation', sourceName: 'youtrace', state: 'unconfirmed' })) {
  test(`concurrent target receipt with wrong ${field} remains rejected without changing either connection's data`, async () => {
    const owner = `generation-cross-tab-invalid-${field}`;
    const first = new Dexie(accountDatabaseName(owner)); first.version(3).stores({ ...ACCOUNT_SCHEMA, [GENERATION_STORE]: 'key' }); await first.open();
    const second = new Dexie(accountDatabaseName(owner)); await second.open();
    try {
      await assert.rejects(interleaveAfterFirstTargetRead(owner, async () => {
        await second.transaction('rw', second.table('schedules'), second.table(GENERATION_STORE), async () => {
          await second.table('schedules').put(schedule);
          await second.table(GENERATION_STORE).put({ key: 'cutover', ownerId: owner, generation: 'schedule-v1', sourceName: accountDatabaseName(owner, true), state: 'ready', source: null, [field]: value });
        });
      }, () => prepareAccountGeneration(owner)), /账号或版本/);
      assert.deepEqual(await first.table('schedules').get(schedule.id), schedule);
      assert.equal((await first.table(GENERATION_STORE).get('cutover'))[field], value);
    } finally { first.close(); second.close(); }
  });
}

test('concurrent unreceipted target data is rejected and preserved through both connections', async () => {
  const owner = 'generation-cross-tab-unreceipted';
  const first = new Dexie(accountDatabaseName(owner)); first.version(3).stores({ ...ACCOUNT_SCHEMA, [GENERATION_STORE]: 'key' }); await first.open();
  const second = new Dexie(accountDatabaseName(owner)); await second.open();
  try {
    await assert.rejects(interleaveAfterFirstTargetRead(owner, async () => { await second.table('schedules').put(schedule); }, () => prepareAccountGeneration(owner)), /未确认资料/);
    assert.deepEqual(await first.table('schedules').get(schedule.id), schedule);
    assert.equal(await first.table(GENERATION_STORE).count(), 0);
    assert.deepEqual(await second.table('schedules').get(schedule.id), schedule);
  } finally { first.close(); second.close(); }
});

test('an existing target without the generation store is never adopted even when empty', async () => {
  const owner = 'generation-no-receipt-store';
  const target = new Dexie(accountDatabaseName(owner)); target.version(3).stores(ACCOUNT_SCHEMA); await target.open();
  try { await assert.rejects(prepareAccountGeneration(owner), /缺少升级凭据/); assert.equal(await target.table('schedules').count(), 0); }
  finally { target.close(); }
});

test('a concurrently copied receipt still verifies exact data before activation', async () => {
  const owner = 'generation-cross-tab-copied-invalid';
  const first = new Dexie(accountDatabaseName(owner)); first.version(3).stores({ ...ACCOUNT_SCHEMA, [GENERATION_STORE]: 'key' }); await first.open();
  const second = new Dexie(accountDatabaseName(owner)); await second.open();
  try {
    await assert.rejects(interleaveAfterFirstTargetRead(owner, async () => {
      await second.transaction('rw', second.table('schedules'), second.table(GENERATION_STORE), async () => {
        await second.table('schedules').put(schedule);
        await second.table(GENERATION_STORE).put({ key: 'cutover', ownerId: owner, generation: 'schedule-v1', sourceName: accountDatabaseName(owner, true), state: 'copied', source: null });
      });
    }, () => prepareAccountGeneration(owner)), /复制校验未通过/);
    assert.equal((await first.table(GENERATION_STORE).get('cutover')).state, 'copied');
    assert.deepEqual(await first.table('schedules').get(schedule.id), schedule);
  } finally { first.close(); second.close(); }
});
