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
