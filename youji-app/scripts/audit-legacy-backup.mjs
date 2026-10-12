// Declared synthetic native IndexedDB source, then original Settings download UI.
import assert from 'node:assert/strict';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { decodeLegacyGraph } from '../src/db/legacySnapshotCodec.ts';

export async function seedLegacyBackupFixture(unsupported = false) {
  const request = item => new Promise((resolve, reject) => { item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error); });
  if (!unsupported && (await indexedDB.databases()).some(db => db.name === 'youtrace')) throw new Error('Synthetic fixture must not replace an existing source');
  const opening = indexedDB.open('youtrace', 20);
  opening.onupgradeneeded = event => {
    if (event.oldVersion !== 0 || unsupported) { opening.transaction.abort(); return; }
    const raw = opening.result.createObjectStore('raw', { autoIncrement: true }); raw.createIndex('byTags', 'tags', { multiEntry: true });
    opening.result.createObjectStore('metadata', { keyPath: ['group', 'sequence'] });
  };
  const database = await request(opening);
  try {
    const tx = database.transaction(['raw', 'metadata'], 'readwrite');
    const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    if (unsupported) tx.objectStore('raw').put(new Error('synthetic unimplemented platform record; retain exactly', { cause: { original: '  retained cause\n' } }), 5001);
    else {
      const buffer = new ArrayBuffer(4 * 1024 * 1024), bytes = new Uint8Array(buffer); bytes[0] = 255; bytes[bytes.length - 1] = 128;
      const shared = { text: '  合成共享对象原文\n' }, array = new Array(3); array[1] = undefined; array['4294967295'] = 'ordinary array property';
      const record = { original: '  合成旧原文\n第二行\t', big: 9007199254740993n, date: new Date('2020-01-02T03:04:05Z'), invalidDate: new Date(NaN), numbers: [NaN, Infinity, -Infinity, -0], tags: ['old', 'unverified'], buffer, view: new Uint16Array(buffer, 2, 8), data: new DataView(buffer, 1, 15), blob: new Blob(['二进制原文\n'], { type: 'text/plain' }), file: new File(['文件原文\n'], '原始.txt', { type: 'text/plain', lastModified: 123456789 }), shared, map: new Map([['raw', '  map原文\n'], [shared, array]]), set: new Set([shared]), array, regexp: /合成/gu };
      record.self = record; array[2] = record;
      tx.objectStore('raw').put(record, 41);
      tx.objectStore('raw').put({ original: 'empty-string key' }, '');
      tx.objectStore('raw').put({ original: 'date key' }, new Date(456));
      tx.objectStore('raw').put({ original: 'binary key' }, new Uint8Array([0, 255]).buffer);
      tx.objectStore('raw').put({ original: 'compound key' }, ['legacy', 7, new Date(789)]);
      tx.objectStore('metadata').put({ group: 'unverified', sequence: 2, text: '来源未认领' });
    }
    await complete;
  } finally { database.close(); }
}

/** Independent semantic oracle: raw IDB records, binary SHA-256 and graph identity.
 * No production encoder and no source writes. Also accepts decoded download data. */
export async function legacyBackupFacts(supplied, databaseName = 'youtrace') {
  let snapshot = supplied;
  if (snapshot === undefined) {
    const opening = indexedDB.open(databaseName); opening.onupgradeneeded = () => opening.transaction.abort();
    const database = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
    try {
      const names = [...database.objectStoreNames], tx = database.transaction(names, 'readonly');
      const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      const request = item => new Promise((resolve, reject) => { item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error); });
      const pending = names.map(name => {
        const store = tx.objectStore(name), indexes = [...store.indexNames].map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; });
        return Promise.all([request(store.getAllKeys()), request(store.getAll())]).then(([keys, values]) => ({ name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, rows: values.map((value, i) => ({ key: keys[i], value })) }));
      });
      snapshot = { name: databaseName, idbVersion: database.version, tables: await Promise.all(pending) }; await done;
    } finally { database.close(); }
  }
  const seen = new Map();
  const digest = async buffer => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
  const visit = async value => {
    if (value === undefined) return ['undefined'];
    if (typeof value === 'bigint') return ['bigint', String(value)];
    if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
    if (value === null || typeof value !== 'object') return [typeof value, value];
    if (seen.has(value)) return ['reference', seen.get(value)];
    const id = seen.size; seen.set(value, id);
    if (value instanceof Date) return ['Date', id, String(+value)];
    if (value instanceof RegExp) return ['RegExp', id, value.source, value.flags, value.lastIndex];
    if (typeof File !== 'undefined' && value instanceof File) return ['File', id, value.name, value.lastModified, value.type, value.size, await digest(await value.arrayBuffer())];
    if (value instanceof Blob) return ['Blob', id, value.type, value.size, await digest(await value.arrayBuffer())];
    if (value instanceof ArrayBuffer) return ['ArrayBuffer', id, value.byteLength, await digest(value)];
    if (ArrayBuffer.isView(value)) return [value.constructor.name, id, value.byteOffset, value.byteLength, await visit(value.buffer)];
    if (value instanceof Map) { const pairs = []; for (const [key, item] of value) pairs.push([await visit(key), await visit(item)]); return ['Map', id, pairs]; }
    if (value instanceof Set) { const items = []; for (const item of value) items.push(await visit(item)); return ['Set', id, items]; }
    if (value instanceof Error) return ['Error', id, value.name, value.message, value.stack, await visit(value.cause)];
    const pairs = []; for (const key of Object.keys(value).sort()) pairs.push([key, await visit(value[key])]);
    return [Array.isArray(value) ? 'Array' : 'Object', id, Array.isArray(value) ? value.length : Object.getPrototypeOf(value) === null ? 'null-prototype' : 'ordinary', pairs];
  };
  return visit(snapshot);
}

export function validateLegacyDownloadedEnvelope(value) {
  assert.equal(value.format, 'youtrace-legacy-quarantine-v2'); assert.equal(value.exportVersion, 2); assert.equal(value.ownership, 'unverified'); assert.equal(value.idbVersion, 20);
  assert.equal(value.scope, 'records-and-structure'); assert.equal(value.restoreStatus, 'no-product-import-or-ownership-assignment'); assert.match(value.keyGeneratorState, /^not-captured/);
  assert.ok(!Object.hasOwn(value, 'tables'), 'No old-importer placeholder entry');
  assert.equal(value.rawSnapshot.encoding, 'youtrace-structured-clone-v2');
  const decoded = decodeLegacyGraph(value.rawSnapshot);
  assert.equal(decoded.name, 'youtrace'); assert.equal(decoded.idbVersion, 20);
  assert.deepEqual(value.summary, decoded.tables.map(table => ({ name: table.name, rows: table.rows.length, autoIncrement: table.autoIncrement })));
  return decoded;
}

export async function runLegacyBackupOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted CI only; do not bypass local browser restrictions');
  const { isolated, login, pointer, waitPath, apiFor, capture, observe, actions, artifacts, writeFile, join } = h;
  await isolated('YLB-native-legacy-backup-1280', { width: 1280, height: 900 }, async page => {
    await login(page, '13900008671', '合成旧库备份');
    const account = await apiFor(page), accountName = `youtrace:user:${account.ownerId}:schedule-v1`;
    assert.match(account.ownerId, /^[a-zA-Z0-9_-]+$/);
    actions.push({ kind: 'declared-synthetic-IDB20-fixture', database: 'youtrace', note: 'Fresh isolated profile only. Historical fixture is preparation, not user UI creation or automatic ownership.' });
    await page.evaluate(seedLegacyBackupFixture, false);
    const before = await page.evaluate(legacyBackupFacts);
    await writeFile(join(artifacts, 'YLB-original-source-facts.json'), JSON.stringify(before));
    await page.evaluate(accountName => {
      window.__legacyReadTransactions = [];
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, options) { if (this.name === 'youtrace' || this.name === accountName) window.__legacyReadTransactions.push({ database: this.name, stores: typeof stores === 'string' ? [stores] : [...stores], mode: mode ?? 'readonly' }); return original.call(this, stores, mode, options); };
    }, accountName);
    const directory = join(artifacts, 'YLB-native-downloads'); await mkdir(directory);
    const client = await page.browser().target().createCDPSession(), begins = [], progress = [];
    client.on('Browser.downloadWillBegin', event => begins.push(event)); client.on('Browser.downloadProgress', event => progress.push(event));
    await client.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: directory, eventsEnabled: true, browserContextId: page.browserContext().id });
    await pointer(page, 'aside nav button', '设置'); await waitPath(page, '/settings'); await page.waitForSelector('section[aria-label="账号"]', { visible: true });
    await page.waitForFunction(() => document.querySelector('[data-component="preference-sync"]')?.textContent.includes('上次核对时，账号偏好已同步'), { timeout: 15000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
    const accountBefore = await page.evaluate(legacyBackupFacts, undefined, accountName);
    await page.evaluate(() => { window.__legacyReadTransactions = []; });
    await pointer(page, 'button', '查看导出说明'); await capture(page, 'YLB-original-export-warning');
    const warning = await page.$eval('[role=dialog]', node => node.innerText); assert.ok(warning.includes('隐藏自增计数未捕获') && warning.includes('归属尚未确认') && warning.includes('没有本产品导入入口'));
    const complete = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { client.off('Browser.downloadProgress', receive); reject(new Error('Native download did not complete within 20 seconds')); }, 20000);
      function receive(event) { if (event.state === 'completed') { clearTimeout(timer); client.off('Browser.downloadProgress', receive); resolve(event); } else if (event.state === 'canceled') { clearTimeout(timer); client.off('Browser.downloadProgress', receive); reject(new Error('Native download canceled')); } }
      client.on('Browser.downloadProgress', receive);
    });
    // Register a rejection handler immediately; failed pointer cannot cause an unhandled later timeout.
    void complete.catch(() => undefined);
    await pointer(page, '[role=dialog] button', '导出记录与结构备份');
    const downloaded = await complete;
    assert.equal(begins.length, 1); assert.equal(begins[0].guid, downloaded.guid); assert.match(downloaded.guid, /^[a-f0-9-]+$/i); assert.match(begins[0].suggestedFilename, /^youtrace-legacy-unverified-\d{4}-\d{2}-\d{2}\.json$/);
    const bytes = await readFile(join(directory, downloaded.guid)), envelope = JSON.parse(bytes.toString('utf8'));
    const decoded = validateLegacyDownloadedEnvelope(envelope);
    assert.deepEqual(await legacyBackupFacts(decoded), before, 'Actual downloaded JSON retains every raw key/field/type/reference and binary digest');
    assert.deepEqual(await page.evaluate(legacyBackupFacts), before, 'Original source unchanged by UI download');
    const accountAfter = await page.evaluate(legacyBackupFacts, undefined, accountName);
    assert.deepEqual(accountAfter, accountBefore, 'No current-owner table/key/value changes or automatic ownership during successful export');
    const readTransactions = await page.evaluate(() => window.__legacyReadTransactions);
    assert.ok(readTransactions.length >= 3 && readTransactions.every(row => row.mode === 'readonly'));
    assert.ok(readTransactions.filter(row => row.database === 'youtrace').every(row => row.stores.join(',') === 'metadata,raw'));
    await observe(page, 'YLB-native-download-lossless-source-preserved', true, 'Original Settings controls produced a real complete browser download. All raw keys/schema/values/types/aliases and 4MiB buffer digests match the unchanged synthetic IDB source; no owner inference or source writes.');
    const completedFiles = await readdir(directory), completedEvents = begins.length;
    actions.push({ kind: 'declared-synthetic-unsupported-Error-fixture', note: 'Adds one retained historical platform value, solely to test honest full-export refusal.' });
    await page.evaluate(seedLegacyBackupFixture, true);
    const unsupportedBefore = await page.evaluate(legacyBackupFacts);
    const negativeAccountBefore = await page.evaluate(legacyBackupFacts, undefined, accountName);
    await page.evaluate(() => { window.__legacyReadTransactions = []; }); // fixture write is outside the measured export phase
    await pointer(page, 'button', '查看导出说明'); await pointer(page, '[role=dialog] button', '导出记录与结构备份');
    await page.waitForFunction(() => document.body.innerText.includes('旧版记录与结构备份未生成：格式、类型或容量超出安全支持范围'), { timeout: 15000 });
    assert.ok(await page.$('[role=dialog]'), 'Failed export does not falsely close confirmation');
    assert.deepEqual(await page.evaluate(legacyBackupFacts), unsupportedBefore);
    const negativeAccountAfter = await page.evaluate(legacyBackupFacts, undefined, accountName);
    assert.deepEqual(negativeAccountAfter, negativeAccountBefore, 'Failed export cannot mutate or claim any current-owner row');
    const failedReadTransactions = await page.evaluate(() => window.__legacyReadTransactions);
    assert.ok(failedReadTransactions.length >= 3 && failedReadTransactions.every(row => row.mode === 'readonly'));
    assert.ok(failedReadTransactions.filter(row => row.database === 'youtrace').every(row => row.stores.join(',') === 'metadata,raw'));
    await client.send('Browser.getVersion'); // ordered protocol round trip after the visible failure, not a timeout-only inference
    assert.equal(begins.length, completedEvents, 'No second native download event after explicit export failure'); assert.deepEqual(await readdir(directory), completedFiles, 'No truncated or partial new download file');
    await observe(page, 'YLB-unsupported-type-visible-refusal-no-download', true, 'Original UI displays completed export failure; download events/files stay unchanged, and all source rows including unsupported Error remain. This is not a timeout-only no-file inference.');
    await writeFile(join(artifacts, 'YLB-download-receipt.json'), JSON.stringify({ syntheticOnly: true, downloadBytes: bytes.length, begins, progress, readTransactions, failedReadTransactions, accountBefore, accountAfter, negativeAccountBefore, negativeAccountAfter, sourceBefore: before, unsupportedBefore, boundaries: ['One desktop Chromium profile', 'No import or ownership confirmation implemented', 'Hidden key-generator nextKey explicitly omitted', 'Fixtures are setup, not native user record creation', 'Unknown platform types fail entire backup; this is not universal structured-clone support'] }, null, 2));
    await client.detach();
  });
}
