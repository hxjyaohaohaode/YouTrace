import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorageProgress, projectStorageProgress, storageProgressSchema } from '../scripts/audit-storage-progress.mjs';
const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => request.result.createObjectStore('todos', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const complete = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.addEventListener('complete', () => resolve()); transaction.addEventListener('abort', () => reject(transaction.error));
});

test('ordinary storage observer returns native requests, preserves values, and records only metadata', async () => {
  const sent: Array<{ event: unknown }> = [], priorWindow = globalThis.window;
  const window = { __youtraceInitializationDiagnostic: async (row: { event: unknown }) => { sent.push(row); } }; Object.assign(window, { top: window }); Object.assign(globalThis, { window });
  const original = IDBObjectStore.prototype.put, restore = installStorageProgress(storageProgressSchema), db = await open('youtrace:user:synthetic-observer:schedule-v1');
  try {
    const transaction = db.transaction('todos', 'readwrite'), ended = complete(transaction);
    const request = transaction.objectStore('todos').put({ id: 'synthetic-only', title: 'synthetic-private-value' });
    assert.ok(request instanceof IDBRequest); await ended;
    const read = db.transaction('todos', 'readonly'), finished = complete(read), loaded = read.objectStore('todos').get('synthetic-only');
    await finished; assert.deepEqual(loaded.result, { id: 'synthetic-only', title: 'synthetic-private-value' });
    const rows = sent.map(row => projectStorageProgress(row.event));
    assert.ok(rows.every(Boolean)); assert.equal(rows.filter(row => row.outcome === 'transaction-complete' && row.mode !== 'versionchange').length, 2);
    assert.equal(rows.filter(row => row.outcome === 'request-success').length, 2);
    assert.ok(rows.some(row => row.outcome === 'request-start' && row.method === 'put'));
    assert.equal(JSON.stringify(sent).includes('synthetic-private-value'), false); assert.equal(JSON.stringify(sent).includes('synthetic-observer'), false);
    const before = sent.length, other = await open('synthetic-unrelated'); const tx = other.transaction('todos', 'readonly'); const done = complete(tx); tx.objectStore('todos').count(); await done; other.close(); assert.equal(sent.length, before);
    window.__youtraceInitializationDiagnostic = () => { throw new Error('Synthetic observer transport error'); };
    const unaffected = db.transaction('todos', 'readonly'), unaffectedDone = complete(unaffected); unaffected.objectStore('todos').count(); await unaffectedDone;
  } finally { restore(); db.close(); Object.assign(globalThis, { window: priorWindow }); }
  assert.equal(IDBObjectStore.prototype.put, original);
});

test('storage metadata projection rejects unknown fields and reads changing getters once', () => {
  const valid = { outcome: 'request-start', mode: 'readonly', database: 1, transaction: 2, request: 3, elapsedMs: 4, stores: ['todos'], store: 'todos', method: 'get', timeOrigin: 12345 };
  assert.deepEqual(projectStorageProgress({ ...valid, value: 'synthetic-private' }), valid);
  for (const key of Object.keys(valid)) {
    let calls = 0;
    const changing = Object.defineProperty({ ...valid }, key, { get() { calls++; return calls === 1 ? valid[key as keyof typeof valid] : 'synthetic-private'; } });
    assert.deepEqual(projectStorageProgress(changing), valid); assert.equal(calls, 1);
    assert.equal(projectStorageProgress(Object.defineProperty({ ...valid }, key, { get() { throw new Error('synthetic-private'); } })), null);
  }
  assert.equal(projectStorageProgress({ ...valid, stores: ['synthetic-private'] }), null);
});

test('close requests and lifecycle observations preserve the pending transaction and original page handlers', async () => {
  const sent: Array<{ event: unknown }> = [], priorWindow = globalThis.window, priorDocument = globalThis.document;
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: 'hidden', wasDiscarded: false });
  Object.assign(window, { top: window, __youtraceInitializationDiagnostic: async (row: { event: unknown }) => { sent.push(row); } });
  Object.assign(globalThis, { window, document });
  const originalClose = IDBDatabase.prototype.close;
  let closeCalls = 0, originalPageHandler = 0;
  IDBDatabase.prototype.close = function (...args) { closeCalls++; return Reflect.apply(originalClose, this, args); };
  window.addEventListener('pagehide', () => { originalPageHandler++; });
  const restore = installStorageProgress(storageProgressSchema), db = await open('youtrace:user:synthetic-lifecycle:schedule-v1');
  try {
    const tx = db.transaction('todos', 'readwrite'), ended = complete(tx);
    tx.objectStore('todos').put({ id: 'synthetic-only', text: 'SYNTHETIC_PRIVATE_LIFECYCLE' });
    let persistedReads = 0;
    const hidden = Object.defineProperty(new Event('pagehide'), 'persisted', { get() { persistedReads++; return persistedReads === 1 ? true : 'SYNTHETIC_PRIVATE_LIFECYCLE'; } });
    window.dispatchEvent(hidden);
    assert.equal(persistedReads, 1); assert.equal(originalPageHandler, 1);
    const returned = db.close(); assert.equal(returned, undefined); assert.equal(closeCalls, 1);
    assert.throws(() => db.transaction('todos', 'readonly'), { name: 'InvalidStateError' });
    await ended;
    document.visibilityState = 'visible'; window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    const rows = sent.map(row => projectStorageProgress(row.event));
    const hide = rows.find(row => row.outcome === 'document-pagehide'), show = rows.find(row => row.outcome === 'document-pageshow'), closed = rows.find(row => row.outcome === 'connection-close-requested');
    assert.equal(hide.persisted, true); assert.equal(hide.trusted, false); assert.equal(hide.observedUnfinished, 1);
    assert.equal(closed.database, hide.database); assert.equal(closed.observedUnfinished, 1);
    assert.equal(show.observedUnfinished, 0); assert.equal(show.observedComplete, hide.observedComplete + 1); assert.equal(show.observedAbort, 0);
    assert.equal(rows.some(row => row.outcome === 'connection-close-event'), false, 'Explicit close is not an observed unexpected-close event');
    assert.equal(JSON.stringify(sent).includes('synthetic-lifecycle'), false); assert.equal(JSON.stringify(sent).includes('SYNTHETIC_PRIVATE_LIFECYCLE'), false);
    restore(); const count = sent.length; window.dispatchEvent(hidden); assert.equal(sent.length, count); assert.equal(originalPageHandler, 2);
  } finally { restore(); IDBDatabase.prototype.close = originalClose; db.close(); Object.assign(globalThis, { window: priorWindow, document: priorDocument }); }
});

test('the observer adds no GC-retaining database listeners and keeps the app versionchange handler intact', async () => {
  const sent: Array<{ event: unknown }> = [], priorWindow = globalThis.window;
  const window = { __youtraceInitializationDiagnostic: async (row: { event: unknown }) => { sent.push(row); } }; Object.assign(window, { top: window }); Object.assign(globalThis, { window });
  const db = await open('youtrace:user:synthetic-version-event:schedule-v1');
  const originalListener = db.addEventListener, added: string[] = [];
  db.addEventListener = function (type, ...args) { added.push(type); return Reflect.apply(originalListener, this, [type, ...args]); };
  const restore = installStorageProgress(storageProgressSchema);
  let appHandler = 0;
  try {
    const tx = db.transaction('todos', 'readonly'), ended = complete(tx); tx.objectStore('todos').count(); await ended;
    db.onversionchange = () => { appHandler++; db.close(); };
    const upgrade = indexedDB.open(db.name, 2), upgraded = await new Promise<IDBDatabase>((resolve, reject) => { upgrade.onsuccess = () => resolve(upgrade.result); upgrade.onerror = () => reject(upgrade.error); }); upgraded.close();
    assert.equal(appHandler, 1);
    assert.deepEqual(added, ['close']);
    assert.equal(sent.map(row => projectStorageProgress(row.event)).some(row => row.outcome === 'connection-close-requested'), true);
    const valid = { outcome: 'document-pagehide', mode: 'none', database: 1, transaction: 0, request: 0, elapsedMs: 0, stores: ['todos'], timeOrigin: 12345, observedTransactions: 3, observedUnfinished: 1, observedComplete: 1, observedAbort: 1, connectionVersion: 30, documentElapsedMs: 10, persisted: true, trusted: false, wasDiscarded: false, visibility: 'hidden' };
    for (const key of Object.keys(valid)) {
      let reads = 0;
      const changing = Object.defineProperty({ ...valid }, key, { get() { reads++; return reads === 1 ? valid[key as keyof typeof valid] : 'SYNTHETIC_PRIVATE_METADATA'; } });
      assert.deepEqual(projectStorageProgress(changing), valid); assert.equal(reads, 1);
    }
    assert.deepEqual(projectStorageProgress({ ...valid, owner: 'private', databaseName: 'private', key: 'private', value: 'private' }), valid);
  } finally { restore(); db.close(); Object.assign(globalThis, { window: priorWindow }); }
});
