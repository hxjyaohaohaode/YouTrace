import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { encodeLegacyGraph, decodeLegacyGraph, verifiedLegacyGraph, LEGACY_GRAPH_FORMAT, LEGACY_LIMITS } from '../src/db/legacySnapshotCodec.ts';
import { captureLegacySnapshot, exportLegacySnapshot } from '../src/db/legacySnapshot.ts';
const roundTrip = async (value: unknown) => decodeLegacyGraph(JSON.parse(JSON.stringify(await verifiedLegacyGraph(value))));
function request<T>(r: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function completed(t: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onabort = () => reject(t.error); }); }
after(async () => { await request(indexedDB.deleteDatabase('youtrace')); });

test('typed graph preserves primitives, BigInt, dates, whitespace, aliases, holes and cycles', async () => {
  const array = new Array(4); array[2] = undefined;
  const source = { text: '  原文\n\t', absent: undefined, big: 9007199254740993n, numbers: [NaN, Infinity, -Infinity, -0], date: new Date('2020-01-02T03:04:05Z'), invalid: new Date(NaN), array, map: new Map<unknown, unknown>(), set: new Set<unknown>() };
  source.map.set(source, array); source.set.add(source.map); source.set.add(source); source.array[3] = source;
  const result = await roundTrip(source) as typeof source;
  assert.equal(result.text, source.text); assert.equal(result.big, source.big); assert.ok(Object.hasOwn(result, 'absent'));
  assert.deepEqual(result.numbers, source.numbers); assert.ok(result.date instanceof Date); assert.equal(+result.date, +source.date); assert.ok(Number.isNaN(+result.invalid));
  assert.equal(result.map.get(result), result.array); assert.ok(result.set.has(result)); assert.ok(result.set.has(result.map)); assert.equal(result.array[3], result);
  assert.equal(0 in result.array, false); assert.equal(2 in result.array, true);
});

test('binary buffer aliases, typed offsets, Blob and File bytes survive JSON transport', async () => {
  const buffer = new ArrayBuffer(32); new Uint8Array(buffer).set([0, 255, 128, 4]);
  const source = { buffer, view: new Uint16Array(buffer, 2, 4), data: new DataView(buffer, 1, 10), blob: new Blob([new Uint8Array([0, 255, 128])], { type: 'application/test' }), file: new File(['字\n'], '原.txt', { type: 'text/plain', lastModified: 123 }) };
  const result = await roundTrip(source) as typeof source;
  assert.equal(result.view.buffer, result.buffer); assert.equal(result.data.buffer, result.buffer); assert.equal(result.view.byteOffset, 2); assert.equal(result.data.byteLength, 10); assert.deepEqual(new Uint8Array(result.buffer), new Uint8Array(buffer));
  assert.equal(result.blob.type, source.blob.type); assert.deepEqual(await result.blob.arrayBuffer(), await source.blob.arrayBuffer()); assert.equal(result.file.name, '原.txt'); assert.equal(result.file.lastModified, 123); assert.equal(await result.file.text(), '字\n');
});

test('safe own definitions preserve pollution-shaped original keys without altering prototypes', async () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":"raw"}');
  const result = await roundTrip(source) as Record<string, unknown>;
  assert.deepEqual(result, source); assert.equal(Object.getPrototypeOf(result), Object.prototype); assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const nullObject = Object.create(null); nullObject.__proto__ = 'literal'; const output = await roundTrip(nullObject) as object; assert.equal(Object.getPrototypeOf(output), null);
});

test('strict decoder rejects malformed IDs, dangling refs, duplicate keys and unsafe view/binary payloads', async () => {
  const graph = await encodeLegacyGraph({ value: 1 });
  const cases: unknown[] = [
    { ...graph, encoding: 'unrecognized' }, { ...graph, nodes: [{ ...graph.nodes[0], id: 1 }] }, { ...graph, root: { tag: 'ref', id: 99 } },
    { ...graph, nodes: [{ ...graph.nodes[0], entries: [['x', 1], ['x', 2]] }] },
    { encoding: LEGACY_GRAPH_FORMAT, root: { tag: 'ref', id: 0 }, nodes: [{ id: 0, type: 'ArbitraryConstructor' }] },
  ];
  const binary = await encodeLegacyGraph(new Uint16Array(new ArrayBuffer(4)));
  for (const edit of [ { offset: 1 }, { length: 10 }, { kind: 'Function' }, { buffer: { tag: 'ref', id: 0 } } ]) cases.push({ ...binary, nodes: [{ ...binary.nodes[0], ...edit }, binary.nodes[1]] });
  for (const bytes of ['@@==', 'AB==', 'YQ=', 'YQ==junk', ' YQ==', 'a']) cases.push({ ...binary, nodes: [binary.nodes[0], { ...binary.nodes[1], bytes }] });
  cases.push({ ...graph, nodes: [...graph.nodes, { ...graph.nodes[0], id: 0 }] });
  for (const invalid of cases) assert.throws(() => decodeLegacyGraph(invalid));
  let invoked = false; const getter = Object.defineProperty({}, 'encoding', { enumerable: true, get() { invoked = true; return LEGACY_GRAPH_FORMAT; } });
  assert.throws(() => decodeLegacyGraph(getter)); assert.equal(invoked, false);
});

test('unsupported types, accessors, oversized data and resizable buffers block the entire export', async () => {
  for (const value of [new Error('private raw'), new WeakMap(), () => 0, Symbol('private'), new SharedArrayBuffer(4), new ArrayBuffer(4, { maxByteLength: 8 }), { get secret() { throw new Error('must not execute'); } }, new Array(LEGACY_LIMITS.arrayLength + 1)]) {
    await assert.rejects(verifiedLegacyGraph(value), /安全支持范围/);
  }
  await assert.rejects(verifiedLegacyGraph(new Blob([new Uint8Array(LEGACY_LIMITS.bytes + 1)])), /安全支持范围/);
});

test('missing source is never created and all stores, indexes, out-of-line keys remain unchanged', async () => {
  await assert.rejects(exportLegacySnapshot()); assert.equal((await indexedDB.databases()).some(db => db.name === 'youtrace'), false);
  const opening = indexedDB.open('youtrace', 20);
  opening.onupgradeneeded = () => {
    const database = opening.result, store = database.createObjectStore('raw', { autoIncrement: true }); store.createIndex('byTags', 'tags', { multiEntry: true });
    database.createObjectStore('other', { keyPath: ['a', 'b'] });
  };
  const database = await request(opening);
  try {
  let tx = database.transaction(['raw', 'other'], 'readwrite'), done = completed(tx);
  tx.objectStore('raw').put({ text: '  original\n', big: 9007199254740993n, date: new Date(123), map: new Map([['key', 'exact']]), tags: ['a'] }, 41);
  tx.objectStore('raw').put({ original: 'removed before snapshot' }, 999); tx.objectStore('raw').delete(999);
  tx.objectStore('other').put({ a: 'x', b: 2, blob: new Blob(['data']) }); await done;
  const before = await captureLegacySnapshot(), exported = await exportLegacySnapshot();
  assert.equal(exported.format, 'youtrace-legacy-quarantine-v2'); assert.equal('tables' in exported, false); assert.equal(exported.ownership, 'unverified'); assert.match(exported.keyGeneratorState, /not-captured/);
  assert.deepEqual(decodeLegacyGraph(exported.rawSnapshot), before); assert.deepEqual(await captureLegacySnapshot(), before);
  assert.equal(before.tables[1].rows[0].key, 41); assert.deepEqual(before.tables[1].indexes, [{ name: 'byTags', keyPath: 'tags', unique: false, multiEntry: true }]);
  tx = database.transaction('raw', 'readwrite'); done = completed(tx); const key = await request(tx.objectStore('raw').add({ after: 'fixture verifies hidden generator was never reset' })); await done; assert.equal(key, 1000);
  } finally { database.close(); }
});

test('single readonly multi-store snapshot excludes a concurrent writer atomically', async () => {
  const database = await request(indexedDB.open('youtrace'));
  const original = IDBDatabase.prototype.transaction;
  const observed: { names: string[]; mode: string }[] = [];
  let writing: Promise<void> | undefined;
  IDBDatabase.prototype.transaction = function (names, mode, options) {
    const transaction = original.call(this, names, mode, options);
    if (this.name === 'youtrace' && this !== database) {
      observed.push({ names: typeof names === 'string' ? [names] : [...names], mode: mode ?? 'readonly' });
      if (mode === 'readonly') {
        const write = original.call(database, ['raw', 'other'], 'readwrite'); writing = completed(write);
        write.objectStore('raw').put({ concurrent: 2 }, 41); write.objectStore('other').put({ a: 'x', b: 2, concurrent: 2 });
      }
    }
    return transaction;
  };
  try {
    const snapshot = await captureLegacySnapshot(); await writing;
    assert.deepEqual(observed, [{ names: ['other', 'raw'], mode: 'readonly' }]);
    assert.equal((snapshot.tables[1].rows[0].value as { concurrent?: number }).concurrent, undefined);
    assert.equal((snapshot.tables[0].rows[0].value as { concurrent?: number }).concurrent, undefined);
  } finally { IDBDatabase.prototype.transaction = original; database.close(); }
  const source = await captureLegacySnapshot();
  assert.equal((source.tables[1].rows[0].value as { concurrent?: number }).concurrent, 2);
  assert.equal((source.tables[0].rows[0].value as { concurrent?: number }).concurrent, 2);
});

test('aborted read transaction rejects whole snapshot without writing or changing retained source', async () => {
  const before = await verifiedLegacyGraph(await captureLegacySnapshot());
  const original = IDBObjectStore.prototype.openCursor;
  IDBObjectStore.prototype.openCursor = function (...args) {
    const cursor = original.apply(this, args);
    if (this.name === 'raw') this.transaction.abort();
    return cursor;
  };
  try { await assert.rejects(exportLegacySnapshot(), /未生成备份/); }
  finally { IDBObjectStore.prototype.openCursor = original; }
  assert.deepEqual(await verifiedLegacyGraph(await captureLegacySnapshot()), before);
});

test('IDB-supported but unimplemented platform Error blocks export, preserving the retained source', async () => {
  const database = await request(indexedDB.open('youtrace'));
  try {
    const tx = database.transaction('raw', 'readwrite'), done = completed(tx);
    tx.objectStore('raw').put(new Error('synthetic unimplemented structured-clone type'), 5001); await done;
    const source = await captureLegacySnapshot();
    await assert.rejects(exportLegacySnapshot(), /安全支持范围/);
    assert.deepEqual(await captureLegacySnapshot(), source);
  } finally { database.close(); }
});

test('all fixed standard typed views and native key types round trip exactly', async () => {
  const buffer = new ArrayBuffer(64);
  const source = [new Int8Array(buffer), new Uint8Array(buffer), new Uint8ClampedArray(buffer), new Int16Array(buffer), new Uint16Array(buffer), new Int32Array(buffer), new Uint32Array(buffer), new Float32Array(buffer), new Float64Array(buffer), new BigInt64Array(buffer), new BigUint64Array(buffer), new DataView(buffer)];
  const result = await roundTrip(source) as typeof source;
  for (let i = 0; i < result.length; i++) { assert.equal(result[i].constructor, source[i].constructor); assert.equal(result[i].buffer, result[0].buffer); }
  const keys: IDBValidKey[] = [1, '  key\n', new Date(123), new Uint8Array([0, 255]).buffer, ['nested', 5, new Date(456)]];
  const output = await roundTrip(keys) as IDBValidKey[]; keys.forEach((key, i) => assert.equal(indexedDB.cmp(key, output[i]), 0));
});


test('valid 4 MiB base64 uses bounded linear validation without regex stack overflow', async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024);
  bytes[0] = 255; bytes[bytes.length - 1] = 127;
  assert.deepEqual(new Uint8Array(await roundTrip(bytes.buffer) as ArrayBuffer), bytes);
});


test('array non-index properties including 4294967295 retain their exact original values', async () => {
  const source = Object.assign([], { '4294967295': 'ordinary property', '9007199254740993': 'also ordinary', '01': 'not canonical' });
  const result = await roundTrip(structuredClone(source));
  assert.deepEqual(result, source); assert.equal((result as unknown[]).length, 0);
});

test('standalone decoder enforces graph depth, node bound and reachability', () => {
  const make = (count: number) => ({ encoding: LEGACY_GRAPH_FORMAT, root: { tag: 'ref', id: 0 }, nodes: Array.from({ length: count }, (_, id) => ({ id, type: 'Object', nullPrototype: false, entries: id + 1 < count ? [['child', { tag: 'ref', id: id + 1 }]] : [] })) });
  assert.doesNotThrow(() => decodeLegacyGraph(make(LEGACY_LIMITS.depth + 1)));
  assert.throws(() => decodeLegacyGraph(make(LEGACY_LIMITS.depth + 2)));
  assert.throws(() => decodeLegacyGraph({ ...make(1), root: null }));
  assert.throws(() => decodeLegacyGraph({ ...make(1), nodes: new Array(LEGACY_LIMITS.nodes + 1) }));
});
