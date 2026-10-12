// Independent implementation of the documented v2 graph wire format for this
// primitive-only native30 fixture. No production codec or recovery import.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
export function fixtureGraphHash(value) {
  const nodes = [], ids = new Map();
  function visit(item) {
    if (item === undefined) return { tag: 'undefined' };
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') { assert.ok(Number.isFinite(item)); return Object.is(item, -0) ? { tag: 'number', value: '-0' } : item; }
    assert.ok(item && typeof item === 'object' && (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null), 'Fixture oracle rejects unimplemented types');
    if (ids.has(item)) return { tag: 'ref', id: ids.get(item) };
    const id = nodes.length; ids.set(item, id);
    const node = Array.isArray(item) ? { id, type: 'Array', length: item.length } : { id, type: 'Object', nullPrototype: Object.getPrototypeOf(item) === null };
    nodes.push(node);
    assert.equal(Object.getOwnPropertySymbols(item).length, 0);
    node.entries = Object.keys(item).map(key => { const descriptor = Object.getOwnPropertyDescriptor(item, key); assert.ok('value' in descriptor); return [key, visit(descriptor.value)]; });
    return { tag: 'ref', id };
  }
  const root = visit(value);
  return createHash('sha256').update(JSON.stringify({ encoding: 'youtrace-structured-clone-v2', root, nodes })).digest('hex');
}
const fields = ['createdAt', 'description', 'domain', 'id', 'level', 'priority', 'progress', 'targetDate', 'title', 'updatedAt'];
const canonical = row => fields.map(field => [field, row[field]]);
export function verifySharedGoalReceiptHash(row, { ownerId, epoch, sourceSnapshot }) {
  const r = row.value;
  assert.deepEqual(Object.keys(r).filter(key => key !== 'epoch').sort(), ['format', 'version', 'ownerId', 'schemaId', 'snapshotDigest', 'rowDigest', 'sourceKey', 'intentId', 'copyId', 'original', 'copy', 'confirmedAt', 'automaticUndoProof', 'receiptDigest'].sort());
  // Puppeteer JSON transport can omit an undefined epoch, but the bound value
  // is checked against the independent account snapshot in either representation.
  assert.equal(r.format, 'youtrace-shared-goal-copy'); assert.equal(r.version, 1);
  assert.equal(r.schemaId, 'youtrace-native30-9abd4d3'); assert.equal(r.ownerId, ownerId); assert.ok(equal(r.epoch, epoch));
  assert.equal(r.automaticUndoProof, 'unavailable-unfenced-writers');
  assert.equal(sourceSnapshot.name, 'youtrace'); assert.equal(sourceSnapshot.idbVersion, 30);
  const source = sourceSnapshot.tables.find(t => t.name === 'goals').rows.find(item => item.key === r.sourceKey);
  assert.ok(source); assert.ok(equal(source.value, r.original)); assert.equal(r.sourceKey, r.original.id);
  assert.ok(equal(r.copy, { ...r.original, id: r.copyId, syncScope: 'local' })); assert.notEqual(r.copyId, r.sourceKey);
  const snapshotDigest = fixtureGraphHash(sourceSnapshot);
  const rowDigest = fixtureGraphHash({ key: r.sourceKey, value: canonical(r.original) });
  const intentId = fixtureGraphHash({ schemaId: r.schemaId, ownerId, epoch, sourceKey: r.sourceKey, rowDigest });
  const receiptDigest = fixtureGraphHash([r.format, r.version, ownerId, epoch, r.schemaId, snapshotDigest, rowDigest, r.sourceKey, intentId, r.copyId, canonical(r.original), canonical(r.copy), r.copy.syncScope, r.confirmedAt, r.automaticUndoProof]);
  assert.equal(r.snapshotDigest, snapshotDigest); assert.equal(r.rowDigest, rowDigest); assert.equal(r.intentId, intentId); assert.equal(r.receiptDigest, receiptDigest); assert.equal(row.key, `shared-goal-recovery:v1:${intentId}`);
  return { sourceKey: r.sourceKey, copyId: r.copyId, snapshotDigest, rowDigest, intentId, receiptDigest, independentWireFormatImplementation: true };
}
// Separate native all-store readonly reader. No app services or hidden stores.
export async function readSharedGoalRawSnapshot() {
  const opening = indexedDB.open('youtrace'); opening.onupgradeneeded = () => opening.transaction.abort();
  const db = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
  try {
    const names = [...db.objectStoreNames], tx = db.transaction(names, 'readonly');
    const completed = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    const get = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tables = await Promise.all(names.map(async name => {
      const store = tx.objectStore(name);
      const indexes = [...store.indexNames].map(name => { const i = store.index(name); return { name, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }; });
      const [keys, values] = await Promise.all([get(store.getAllKeys()), get(store.getAll())]);
      return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, rows: keys.map((key, i) => ({ key, value: values[i] })) };
    }));
    await completed; return { name: 'youtrace', idbVersion: db.version, tables };
  } finally { db.close(); }
}
// Decoder for the separate readonly account-evidence format, not the app backup
// format. Safe own definitions preserve undefined keys in raw account receipts.
export function decodeAccountFact(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value.type === 'undefined') return undefined;
  if (value.type === 'number') return value.value === '-0' ? -0 : Number(value.value);
  if (value.type === 'bigint') return BigInt(value.value);
  if (value.type === 'date') return new Date(value.value);
  assert.ok(value.type === 'array' || value.type === 'object');
  const result = value.type === 'array' ? new Array(value.length) : {};
  for (const [key, item] of value.entries) Object.defineProperty(result, key, { value: decodeAccountFact(item), enumerable: true, writable: true, configurable: true });
  return result;
}
