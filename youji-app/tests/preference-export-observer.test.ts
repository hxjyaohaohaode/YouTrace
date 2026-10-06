import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import 'fake-indexeddb/auto';
import { encodePreferenceEvidence as encode, installPreferenceExportObserver, releasePreferenceExportObserver, preferenceExportMatchesObservation, preferenceExportKeepsFrozenIntent } from '../scripts/audit-preference-export.mjs';

const names = ['_accountGeneration', 'outbox', 'settings', 'todos'];
const key = 'accountPreferences:state:v1';
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.addEventListener('complete', () => resolve()); tx.addEventListener('abort', () => reject(tx.error ?? new Error('aborted'))); });
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.addEventListener('success', () => resolve(request.result)); request.addEventListener('error', () => reject(request.error)); });
async function open(suffix: string) {
  const request = indexedDB.open(`youtrace:user:synthetic-export-${suffix}:schedule-v1`);
  request.onupgradeneeded = () => { for (const name of names) request.result.createObjectStore(name, { keyPath: 'key' }); };
  return result(request);
}
async function put(db: IDBDatabase, value: object) {
  const tx = db.transaction('settings', 'readwrite'), completion = done(tx); tx.objectStore('settings').put({ key, value }); await completion;
}
async function rows(db: IDBDatabase, stores = names, mode: IDBTransactionMode = 'readonly') {
  const tx = db.transaction(stores, mode), completion = done(tx), request = tx.objectStore('settings').getAll();
  const value = await result(request); await completion; return value;
}
const snapshot = (db: IDBDatabase, settings: object[]) => ({ databaseName: db.name, version: db.version, schema: names.map(name => ({ name, keyPath: 'key' })), tables: names.map(name => { const tableRows = name === 'settings' ? settings : []; return { name, keys: encode(tableRows.map(row => row.key)), rows: tableRows, losslessRows: encode(tableRows) }; }) });
const rawTables = (settings: object[]) => names.filter(name => name !== '_accountGeneration').map(name => ({ name, keys: name === 'settings' ? settings.map(row => row.key) : [], rows: name === 'settings' ? settings : [] }));

test('the first already-frozen request cannot be replaced by a later equal-valued request', () => {
  const queued = { active: null }, active = { active: { id: 'first', baseRevision: '4', base: { cap: 0 }, changes: { cap: 1 } } };
  assert.equal(preferenceExportKeepsFrozenIntent([queued, active, structuredClone(active)]), true);
  assert.equal(preferenceExportKeepsFrozenIntent([queued, queued, queued]), true);
  for (const changed of [{ id: 'replacement' }, { id: '' }, { baseRevision: '5' }, { base: { cap: 9 } }, { changes: { cap: 2 } }]) {
    assert.equal(preferenceExportKeepsFrozenIntent([active, { active: { ...active.active, ...changed } }, { active: { ...active.active, ...changed } }]), false);
  }
  assert.equal(preferenceExportKeepsFrozenIntent([active, queued, active]), false);
});

test('an exact intermediate export snapshot is retained while queued and failed-attempt boundary states differ', async () => {
  const db = await open('intermediate'), original = IDBObjectStore.prototype.getAll;
  try {
    const tx = db.transaction('settings', 'readwrite'), completion = done(tx);
    tx.objectStore('settings').put({ key: 'unknown-fixture', value: { nested: [undefined, -0, 12n], retained: true } }); await completion;
    await put(db, { localRevision: 20, active: null, queued: { changes: { cap: 1 } } });
    const before = snapshot(db, await rows(db));
    await put(db, { localRevision: 22, active: { id: 'actual-request', baseRevision: '4', changes: { cap: 1 }, attempts: 0 }, queued: null });
    installPreferenceExportObserver({ databaseName: db.name, stores: names });
    const exported = await rows(db), evidence = releasePreferenceExportObserver();
    assert.equal(IDBObjectStore.prototype.getAll, original);
    await put(db, { localRevision: 23, active: { id: 'actual-request', baseRevision: '4', changes: { cap: 1 }, attempts: 1, error: 'offline' }, queued: null });
    const after = snapshot(db, await rows(db)), raw = rawTables(exported);
    assert.equal(isDeepStrictEqual(exported, before.tables.find(row => row.name === 'settings')?.rows), false);
    assert.equal(isDeepStrictEqual(exported, after.tables.find(row => row.name === 'settings')?.rows), false);
    assert.equal(preferenceExportMatchesObservation(evidence, raw, before, after), true);
    for (const change of [(copy) => { copy.find(row => row.name === 'settings').rows[0].value.localRevision++; }, (copy) => { copy.find(row => row.name === 'settings').rows[0].value.active.attempts++; }, (copy) => { delete copy.find(row => row.name === 'settings').rows[1].value.nested; }, (copy) => { copy.pop(); }]) {
      const altered = structuredClone(raw); change(altered); assert.equal(preferenceExportMatchesObservation(evidence, altered, before, after), false);
    }
    for (const delta of [{ expired: true }, { released: false }, { errors: ['failed'] }, { databaseName: 'wrong' }, { transactions: [] }, { transactions: [...evidence.transactions, ...evidence.transactions] }]) assert.equal(preferenceExportMatchesObservation({ ...evidence, ...delta }, raw, before, after), false);
    const unfinished = structuredClone(evidence); unfinished.transactions[0].complete = false; assert.equal(preferenceExportMatchesObservation(unfinished, raw, before, after), false);
  } finally { globalThis.__youtracePreferenceExportObserver?.release(); delete globalThis.__youtracePreferenceExportObserver; db.close(); }
});

test('unrelated reads are excluded, native getAll returns the original request once, and observation ends before corroboration', async () => {
  const db = await open('scope'), other = await open('other'), original = IDBObjectStore.prototype.getAll;
  const nativeRequests: IDBRequest[] = [];
  IDBObjectStore.prototype.getAll = function (...args) { const request = original.apply(this, args); nativeRequests.push(request); return request; };
  try {
    await put(db, { preserved: true });
    installPreferenceExportObserver({ databaseName: db.name, stores: names });
    await rows(other); await rows(db, ['settings']); await rows(db, names, 'readwrite');
    const tx = db.transaction(names, 'readonly'), completion = done(tx), previous = nativeRequests.length, request = tx.objectStore('settings').getAll();
    assert.equal(request, nativeRequests.at(-1)); assert.equal(nativeRequests.length, previous + 1); assert.deepEqual(await result(request), [{ key, value: { preserved: true } }]); await completion;
    const evidence = releasePreferenceExportObserver(); await rows(db);
    assert.equal(evidence.transactions.length, 1); assert.equal(evidence.transactions[0].reads.length, 1); assert.equal(evidence.transactions[0].complete, true);
  } finally { globalThis.__youtracePreferenceExportObserver?.release(); delete globalThis.__youtracePreferenceExportObserver; IDBObjectStore.prototype.getAll = original; db.close(); other.close(); }
});

test('unsupported observation values and aborts remain failures without changing the native outcome', async () => {
  const db = await open('failure');
  try {
    await put(db, { unsupported: new Map([['x', 1]]) });
    installPreferenceExportObserver({ databaseName: db.name, stores: names });
    const actual = await rows(db), evidence = releasePreferenceExportObserver();
    assert.deepEqual(actual[0].value.unsupported, new Map([['x', 1]])); assert.equal(evidence.transactions[0].complete, true); assert.deepEqual(evidence.errors, ['observation-failed']);
    installPreferenceExportObserver({ databaseName: db.name, stores: names });
    const tx = db.transaction(names, 'readonly'), completion = done(tx); tx.objectStore('settings').getAll(); tx.abort(); await assert.rejects(completion);
    const aborted = releasePreferenceExportObserver(); assert.equal(aborted.transactions[0].aborted, true); assert.equal(aborted.transactions[0].complete, false);
  } finally { globalThis.__youtracePreferenceExportObserver?.release(); delete globalThis.__youtracePreferenceExportObserver; db.close(); }
});
