import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { installGoalInitialReadFault, assertGoalInitialFault, assertGoalInitialGate, assertGoalRetryDocuments, assertGoalInitialSourcePreserved, runGoalInitialReadRecovery } from '../scripts/audit-goal-initial-read.mjs';

const databaseName = 'youtrace:user:synthetic-goal-native-contract:schedule-v1';
const names = ['goalRecords', 'goals', 'outbox', 'settings'];
const gate = (timeOrigin = 1) => ({ timeOrigin, path: '/goal', errorCount: 1, retryCount: 1, workspaceCount: 0, cardCount: 0, privateGoalText: false, emptyOrZeroGoalView: false, faultInstalled: true });
const expectedFault = { databaseName, timeOrigin: 1 };
const goodFault = () => ({ ...expectedFault, syntheticOnly: true, released: false, expired: false, violation: null, hits: [{ ...expectedFault, stores: names, table: 'goalRecords', mode: 'readonly', requestIssued: true, terminal: 'abort' }], initialization: ['initial', 'recovery'].flatMap(phase => ['goal', 'initialization'].map(stage => ({ phase, stage, outcome: 'error' }))) });
const encode = (value: unknown): unknown => value === undefined ? { type: 'undefined' } : value === null || typeof value !== 'object' ? value : { type: Array.isArray(value) ? 'array' : 'object', ...(Array.isArray(value) ? { length: value.length } : {}), entries: Object.keys(value).sort().map(key => [key, encode(Reflect.get(value, key))]) };
const source = () => ({ catalog: [{ name: databaseName, version: 1 }], otherDatabases: [], events: [{ seq: '1', entity: 'goals', data: { id: 'original', unknown: { exact: true } } }], account: { databaseName, version: 1, schema: [{ name: 'goalRecords', keyPath: 'id' }], tables: [
  { name: 'goalRecords', keys: encode(['original']), losslessRows: encode([{ id: 'original', title: 'Original', progress: 25, unknown: undefined }]) },
  { name: 'outbox', keys: encode([]), losslessRows: encode([]) },
  { name: 'settings', keys: encode(['lastPullAt', 'localDataEpoch', 'shared-goal-recovery:v1:test']), losslessRows: encode([{ key: 'lastPullAt', value: '2026-10-12T12:00:00.000Z' }, { key: 'localDataEpoch', value: 'exact-epoch' }, { key: 'shared-goal-recovery:v1:test', value: { original: 'Keep this full receipt' } }]) },
] } });
const changeRows = (value: Pick<ReturnType<typeof source>, 'account'>, name: string, rows: unknown[]) => { value.account.tables.find(table => table.name === name)!.losslessRows = encode(rows); };

// Pure oracles reject quiet route unlocks and fake/missing native failure facts.
test('Goal first-read fault oracle needs actual exact-four-table readonly aborts and required loader failures', () => {
  assert.equal(assertGoalInitialFault(goodFault(), expectedFault), true);
  const cancelled = goodFault(); cancelled.initialization[0].outcome = 'success';
  assert.equal(assertGoalInitialFault(cancelled, expectedFault), true, 'Cancelled ordinary read is not confused with complete required readiness');
  for (const mutate of [
    (f: ReturnType<typeof goodFault>) => { f.hits = []; },
    (f: ReturnType<typeof goodFault>) => { f.hits[0].mode = 'readwrite'; },
    (f: ReturnType<typeof goodFault>) => { f.hits[0].stores = ['settings']; },
    (f: ReturnType<typeof goodFault>) => { f.hits[0].terminal = 'complete'; },
    (f: ReturnType<typeof goodFault>) => { f.hits[0].requestIssued = false; },
    (f: ReturnType<typeof goodFault>) => { f.initialization = f.initialization.filter(row => row.stage !== 'initialization' || row.phase !== 'initial'); },
    (f: ReturnType<typeof goodFault>) => { f.initialization = f.initialization.filter(row => row.stage !== 'goal'); },
    (f: ReturnType<typeof goodFault>) => { f.databaseName += '-other'; },
    (f: ReturnType<typeof goodFault>) => { f.timeOrigin = 2; },
    (f: ReturnType<typeof goodFault>) => { f.hits[0].databaseName += '-other'; },
    (f: ReturnType<typeof goodFault>) => { f.hits[0].timeOrigin = 2; },
    (f: ReturnType<typeof goodFault>) => { f.initialization.push({ phase: 'initial', stage: 'initialization', outcome: 'success' }); },
    (f: ReturnType<typeof goodFault>) => { f.released = true; },
    (f: ReturnType<typeof goodFault>) => { f.expired = true; },
  ]) { const f = goodFault(); mutate(f); assert.throws(() => assertGoalInitialFault(f, expectedFault)); }
});
test('Goal first-read gate and exact two Retry documents reject private content, opened routes, same documents and a third Retry', () => {
  assert.equal(assertGoalInitialGate(gate()), true);
  for (const mutation of [{ errorCount: 0 }, { retryCount: 2 }, { workspaceCount: 1 }, { cardCount: 1 }, { privateGoalText: true }, { emptyOrZeroGoalView: true }, { path: '/' }]) assert.throws(() => assertGoalInitialGate({ ...gate(), ...mutation }));
  const docs = [gate(1), gate(2), { ...gate(3), faultInstalled: false, errorCount: 0, retryCount: 0, workspaceCount: 1, cardCount: 2 }];
  assert.equal(assertGoalRetryDocuments(docs, ['fault-retained', 'fault-released']), true);
  assert.throws(() => assertGoalRetryDocuments(docs, ['fault-released', 'fault-retained']));
  assert.throws(() => assertGoalRetryDocuments(docs, ['fault-retained', 'fault-released', 'fault-released']));
  assert.throws(() => assertGoalRetryDocuments([docs[0], { ...docs[1], timeOrigin: 1 }, docs[2]], ['fault-retained', 'fault-released']));
  assert.throws(() => assertGoalRetryDocuments([docs[0], docs[1], { ...docs[2], faultInstalled: true }], ['fault-retained', 'fault-released']));
  assert.throws(() => assertGoalRetryDocuments([docs[0], docs[1], { ...docs[2], timeOrigin: NaN }], ['fault-retained', 'fault-released']));
  assert.throws(() => assertGoalRetryDocuments([docs[0], { ...docs[1], faultInstalled: false }, docs[2]], ['fault-retained', 'fault-released']));
});
test('all source tables, original keys, unknown undefined fields, queues, epochs, receipts and events remain exact', () => {
  const before = source(); assert.deepEqual(assertGoalInitialSourcePreserved(before, structuredClone(before)), []);
  const cases = [
    (s: ReturnType<typeof source>) => { changeRows(s, 'goalRecords', [{ id: 'original', title: 'Original', progress: 25 }]); },
    (s: ReturnType<typeof source>) => { changeRows(s, 'goalRecords', [{ id: 'replacement', title: 'Original', progress: 25, unknown: undefined }]); },
    (s: ReturnType<typeof source>) => { changeRows(s, 'outbox', [{ entity: 'goals', payload: 'original' }]); },
    (s: ReturnType<typeof source>) => { s.events[0].data.unknown.exact = false; },
    (s: ReturnType<typeof source>) => { s.account.tables[0].keys = encode(['replacement']); },
    (s: ReturnType<typeof source>) => { changeRows(s, 'settings', [{ key: 'lastPullAt', value: '2026-10-12T12:01:00.000Z' }, { key: 'localDataEpoch', value: 'changed' }, { key: 'shared-goal-recovery:v1:test', value: { original: 'Keep this full receipt' } }]); },
    (s: ReturnType<typeof source>) => { s.catalog.push({ name: 'youtrace', version: 30 }); },
  ];
  for (const mutate of cases) { const after = structuredClone(before); mutate(after); assert.throws(() => assertGoalInitialSourcePreserved(before, after, true)); }
  // This oracle-only fixture proves comparisons include present old sources;
  // it does not claim the native profile has any foreign/legacy fixture.
  const withSources = { ...source(), otherDatabases: [{ name: 'youtrace', snapshot: { original: { exact: 'shared source' } } }, { name: 'youtrace:user:other:schedule-v1', snapshot: { original: { exact: 'other owner' } } }] };
  withSources.account.tables.push({ name: 'goals', keys: encode(['old-key']), losslessRows: encode([{ id: 'old-key', raw: { untouched: undefined } }]) });
  assert.deepEqual(assertGoalInitialSourcePreserved(withSources, structuredClone(withSources)), []);
  for (let index = 0; index < withSources.otherDatabases.length; index++) { const after = structuredClone(withSources); after.otherDatabases[index].snapshot.original.exact = 'changed'; assert.throws(() => assertGoalInitialSourcePreserved(withSources, after, true)); }
  const changedOld = structuredClone(withSources); changeRows(changedOld, 'goals', [{ id: 'old-key', raw: {} }]); assert.throws(() => assertGoalInitialSourcePreserved(withSources, changedOld, true));
});
test('only explicit lastPullAt value advancement is allowed across bootstrap; settled failure window has no settings exemption', () => {
  const before = source(), after = structuredClone(before);
  const rows = [{ key: 'lastPullAt', value: '2026-10-12T12:01:00.000Z' }, { key: 'localDataEpoch', value: 'exact-epoch' }, { key: 'shared-goal-recovery:v1:test', value: { original: 'Keep this full receipt' } }];
  changeRows(after, 'settings', rows);
  assert.equal(assertGoalInitialSourcePreserved(before, after, true).length, 1);
  assert.throws(() => assertGoalInitialSourcePreserved(before, after));
  for (const value of ['bad time', '2026-10-12T11:00:00.000Z']) { changeRows(after, 'settings', [{ ...rows[0], value }, ...rows.slice(1)]); assert.throws(() => assertGoalInitialSourcePreserved(before, after, true)); }
});

async function open(name: string) {
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => { for (const table of [...names, 'todos']) request.result.createObjectStore(table, { keyPath: table === 'settings' ? 'key' : 'id' }); };
  return new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function transactionResult(transaction: IDBTransaction) { return new Promise<string>(resolve => { transaction.oncomplete = () => resolve('complete'); transaction.onabort = () => resolve('abort'); }); }
function swallowRequestError(request: IDBRequest) { request.onerror = () => undefined; return request; }

test('real IDB fault aborts only exact-owner four-table readonly Goal requests; all-scope evidence/settings/foreign/write operations pass through', async () => {
  const previousWindow = globalThis.window; Object.assign(globalThis, { window: new EventTarget() });
  const original = IDBObjectStore.prototype.getAll, put = IDBObjectStore.prototype.put;
  const own = await open(databaseName), foreign = await open('youtrace:user:synthetic-other:schedule-v1');
  const seed = own.transaction(names, 'readwrite'), seeded = transactionResult(seed); seed.objectStore('goalRecords').put({ id: 'original', value: 'exact' }); await seeded;
  const control = installGoalInitialReadFault({ databaseName });
  try {
    for (const [database, tables, mode] of [[foreign, names, 'readonly'], [own, [...names, 'todos'], 'readonly'], [own, ['settings'], 'readonly'], [own, names, 'readwrite']] as const) {
      const transaction = database.transaction([...tables].reverse(), mode), done = transactionResult(transaction);
      swallowRequestError(transaction.objectStore(tables.includes('goalRecords') ? 'goalRecords' : 'settings').getAll());
      assert.equal(await done, 'complete');
    }
    assert.equal(control.snapshot().hits.length, 0);
    for (const tables of [names, [...names].reverse()]) {
      const transaction = own.transaction(tables, 'readonly'), done = transactionResult(transaction);
      const request = swallowRequestError(transaction.objectStore('goalRecords').getAll());
      assert.ok(request instanceof IDBRequest, 'Do not fabricate a successful request or result');
      assert.equal(await done, 'abort');
    }
    assert.equal(control.snapshot().hits.length, 2); assert.ok(control.snapshot().hits.every((hit: { terminal: string }) => hit.terminal === 'abort'));
    assert.deepEqual(control.snapshot().writes, []);
    control.release(); assert.equal(control.snapshot().restored, true); assert.equal(IDBObjectStore.prototype.getAll, original); assert.equal(IDBObjectStore.prototype.put, put);
    const transaction = own.transaction(names, 'readonly'), done = transactionResult(transaction), read = transaction.objectStore('goalRecords').getAll();
    const rows = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); });
    assert.equal(await done, 'complete'); assert.deepEqual(rows, [{ id: 'original', value: 'exact' }]);
  } finally { control.release(); own.close(); foreign.close(); Object.assign(globalThis, { window: previousWindow }); }
});
test('bounded fault deadline expires as a failed contract and restores methods without keepalive or implicit success', () => {
  const before = { window: globalThis.window, setTimeout, clearTimeout }; let delay = 0, expire!: () => void;
  Object.assign(globalThis, { window: new EventTarget(), setTimeout: (fn: () => void, ms: number) => { expire = fn; delay = ms; return 1; }, clearTimeout: () => undefined });
  const control = installGoalInitialReadFault({ databaseName });
  try { assert.equal(delay, 45000); expire(); assert.equal(control.snapshot().expired, true); assert.equal(control.snapshot().restored, true); assert.throws(() => assertGoalInitialFault(control.snapshot(), { databaseName, timeOrigin: performance.timeOrigin })); }
  finally { control.release(); Object.assign(globalThis, before); }
});
test('zero-write observer also detects cursor same-value updates and deletes, even when their real transaction aborts', async () => {
  const previousWindow = globalThis.window; Object.assign(globalThis, { window: new EventTarget() });
  const own = await open(databaseName), originals = [IDBObjectStore.prototype.getAll, IDBObjectStore.prototype.put, IDBObjectStore.prototype.add, IDBObjectStore.prototype.delete, IDBObjectStore.prototype.clear, IDBCursor.prototype.update, IDBCursor.prototype.delete];
  const seed = own.transaction('goalRecords', 'readwrite'), seeded = transactionResult(seed); seed.objectStore('goalRecords').put({ id: 'cursor-original', value: 'exact' }); await seeded;
  const control = installGoalInitialReadFault({ databaseName });
  try {
    const transaction = own.transaction('goalRecords', 'readwrite'), done = transactionResult(transaction), cursor = transaction.objectStore('goalRecords').openCursor('cursor-original');
    cursor.onsuccess = () => { const original = cursor.result!; swallowRequestError(original.update(original.value)); swallowRequestError(original.delete()); transaction.abort(); };
    assert.equal(await done, 'abort');
    assert.deepEqual(control.snapshot().writes.map((row: { method: string }) => row.method), ['cursor.update', 'cursor.delete']);
    assert.equal(control.snapshot().hits.length, 0, 'Observing writes must not expand the readonly fault boundary');
    control.release(); assert.equal(control.snapshot().restored, true);
    assert.deepEqual([IDBObjectStore.prototype.getAll, IDBObjectStore.prototype.put, IDBObjectStore.prototype.add, IDBObjectStore.prototype.delete, IDBObjectStore.prototype.clear, IDBCursor.prototype.update, IDBCursor.prototype.delete], originals);
    const read = own.transaction('goalRecords', 'readonly'), readDone = transactionResult(read), request = read.objectStore('goalRecords').get('cursor-original');
    const value = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); }); await readDone;
    assert.deepEqual(value, { id: 'cursor-original', value: 'exact' });
  } finally { control.release(); own.close(); Object.assign(globalThis, { window: previousWindow }); }
});
test('hosted guard and source contract forbid state/ready injection, keepalive, matrix changes and swallowed first failures', async () => {
  const previous = process.env.GITHUB_ACTIONS; delete process.env.GITHUB_ACTIONS;
  try { await assert.rejects(runGoalInitialReadRecovery({}), /hosted-CI only/); }
  finally { if (previous === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = previous; }
  const native = await readFile(new URL('../scripts/audit-goal-initial-read.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['.setState(', 'loadFromDB(', 'setReady(', 'nativeFetch', 'fetch =', '.count()', 'finish(\'initial\'']) assert.ok(!native.includes(forbidden), forbidden);
  assert.equal((native.match(/await nativeRetry\('/g) ?? []).length, 2);
  assert.ok(native.indexOf("save('FIRST-FAILURE-fault-before-cleanup'") < native.lastIndexOf('await release()'));
  const goals = await readFile(new URL('../scripts/audit-goal-outcomes.mjs', import.meta.url), 'utf8');
  assert.ok(goals.includes('await runGoalInitialReadRecovery({'));
  assert.ok(!goals.includes('segment(page, `${label}-initial-read`'));
  assert.ok(goals.indexOf('await runGoalInitialReadRecovery({') < goals.indexOf('await quotaEdit(page'));
  const hook = await readFile(new URL('../src/hooks/useAppInit.ts', import.meta.url), 'utf8'); assert.ok(hook.includes('const INIT_TIMEOUT_MS = 12_000;'));
});


test('exact native fault boundary reaches the actual Goal reader twice and read-only restoration returns its original record', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/helpers/goal-initial-native-fault-scenario.ts'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.actualGoalSnapshotAborts, 2); assert.equal(report.writes, 0); assert.equal(report.sameOriginalId, true); assert.equal(report.browser, false);
});

// Mock only the browser driver here to exercise runner ordering and failure
// propagation. This is orchestration evidence, never a native/browser result.
function journeyDriver(mode = 'success') {
  const originals = [{ id: 'original', title: 'Same title', description: 'Exact first body', progress: 25, unknown: undefined }, { id: 'neighbor', title: 'Same title', description: 'Exact second body', progress: 50, unknown: { retained: true } }];
  const facts = source(); facts.account.tables[0].keys = encode(originals.map(row => row.id)); changeRows(facts, 'goalRecords', originals);
  const files = new Map<string, unknown>(), order: string[] = [], actions: { kind: string; purpose?: string; ordinal?: number }[] = [];
  let document = 0, clicks = 0, installed = false, released = false, verifies = 0, faultReads = 0;
  const currentOrigin = () => mode === 'same-retry-document' && document === 2 ? 1 : document;
  const fault = () => {
    const row = goodFault(), timeOrigin = currentOrigin();
    const miss = mode === 'first-document-misses' && document === 1 || mode === 'second-document-misses' && document === 2;
    return { ...row, timeOrigin, released, restored: released, writes: mode === 'stable-window-write' && faultReads >= 3 ? [{ table: 'settings', method: 'put' }] : [], hits: miss ? [] : row.hits.map(hit => ({ ...hit, timeOrigin })) };
  };
  const page = {
    url: () => 'http://127.0.0.1:4317/goal', on: () => undefined, exposeFunction: async () => undefined,
    evaluateOnNewDocument: async (fn: unknown) => { if (typeof fn === 'string') { installed = true; order.push('install-fault'); return { identifier: 'fault-script' }; } return { identifier: 'observer-script' }; },
    removeScriptToEvaluateOnNewDocument: async (id: string) => { assert.equal(id, 'fault-script'); installed = false; order.push('remove-new-document-fault'); },
    goto: async (url: string) => { assert.equal(url, page.url()); assert.equal(installed, true); document = 1; order.push('document-1'); },
    waitForFunction: async () => undefined, waitForSelector: async () => undefined, waitForNavigation: async () => undefined,
    evaluate: async (fn: unknown, ...args: unknown[]) => {
      const body = String(fn), name = typeof fn === 'function' ? fn.name : '';
      if (name === 'readExistingAccount') { order.push(`snapshot-${document}`); return structuredClone(facts.account); }
      if (body.includes('indexedDB.databases()')) return structuredClone(facts.catalog);
      if (args[0] && typeof args[0] === 'object' && 'descriptions' in args[0]) return document < 3 ? gate(currentOrigin()) : { ...gate(currentOrigin()), faultInstalled: false, workspaceCount: 1, cardCount: 2, errorCount: 0, retryCount: 0, privateGoalText: true };
      if (body.includes('value.release(')) { released = true; order.push('release-current-fault'); return fault(); }
      if (body.includes('snapshot()')) { faultReads++; order.push(`fault-${document}`); return fault(); }
      if (body.includes('requestAnimationFrame')) return undefined;
      assert.fail(`Unexpected mocked evaluate: ${body}`);
    },
  };
  const h = {
    page, owner: 'synthetic-goal-native-contract', target: originals[0], neighbor: originals[1], label: 'mock-only-first-read', actions, artifacts: 'mock-artifacts', join,
    tap: async (_page: unknown, selector: string, text: string) => {
      assert.equal(selector, 'button'); assert.equal(text, '重试'); clicks++;
      assert.equal(clicks <= 2, true); assert.equal(installed, clicks === 1); assert.equal(released, clicks === 2);
      document++; faultReads = 0; order.push(`Retry-${clicks}-document-${document}`);
    },
    read: async () => ({ visible: true }), exactSelector: async (_page: unknown, selector: string, text: string) => `${selector}:${text}`,
    readLedger: async () => { order.push(`ledger-${document}`); return structuredClone(facts.events); },
    verifyPair: async (rows: unknown) => { verifies++; assert.deepEqual(rows, originals); if (mode === 'recovered-pair-mismatch') throw Error('Original Goal pair mismatch'); },
    capture: async (_page: unknown, label: string) => { order.push(`capture:${label}`); },
    writeFile: async (path: string, body: string) => { files.set(path, JSON.parse(body)); order.push(`save:${path}`); },
  };
  return { h, files, order, get result() { return { clicks, document, verifies, installed, released }; } };
}
async function mockHostedJourney(driver: ReturnType<typeof journeyDriver>) {
  const prior = process.env.GITHUB_ACTIONS; process.env.GITHUB_ACTIONS = 'true';
  try { await runGoalInitialReadRecovery(driver.h); }
  finally { if (prior === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prior; }
}
test('driver orchestration uses exactly two original Retry actions and three documents; release precedes only the second Retry', async () => {
  const driver = journeyDriver(); await mockHostedJourney(driver);
  assert.deepEqual(driver.result, { clicks: 2, document: 3, verifies: 1, installed: false, released: true });
  assert.deepEqual(driver.h.actions.filter(row => row.kind === 'native-goal-first-read-global-Retry').map(row => [row.purpose, row.ordinal]), [['fault-retained', 1], ['fault-released', 2]]);
  assert.ok(driver.order.indexOf('Retry-1-document-2') < driver.order.indexOf('remove-new-document-fault'));
  assert.ok(driver.order.indexOf('release-current-fault') < driver.order.indexOf('Retry-2-document-3'));
  assert.ok([...driver.files.keys()].some(path => path.endsWith('-exact-recovery.json')));
  assert.ok(![...driver.files.keys()].some(path => path.includes('FIRST-FAILURE')));
});
for (const [mode, clicks] of [['first-document-misses', 0], ['second-document-misses', 1], ['same-retry-document', 1], ['stable-window-write', 0], ['recovered-pair-mismatch', 2]] as const) {
  test(`driver ${mode} stops the profile before later business writes, preserves first-failure evidence and never adds a Retry`, async () => {
    const driver = journeyDriver(mode); let laterBusinessMutation = false;
    await assert.rejects(async () => { await mockHostedJourney(driver); laterBusinessMutation = true; });
    assert.equal(laterBusinessMutation, false); assert.equal(driver.result.clicks, clicks);
    assert.equal(driver.result.verifies, mode === 'recovered-pair-mismatch' ? 1 : 0);
    const evidence = [...driver.files.keys()];
    for (const suffix of ['FIRST-FAILURE.json', 'FIRST-FAILURE-fault-before-cleanup.json', 'FIRST-FAILURE-full-account.json']) assert.ok(evidence.some(path => path.endsWith(suffix)));
    assert.ok(driver.order.some(value => value === 'capture:mock-only-first-read-FIRST-FAILURE'));
    if (clicks < 2) {
      const release = driver.order.indexOf('release-current-fault');
      for (const suffix of ['FIRST-FAILURE-fault-before-cleanup.json', 'FIRST-FAILURE-full-account.json']) assert.ok(driver.order.findIndex(value => value.startsWith('save:') && value.endsWith(suffix)) < release);
    }
    assert.equal(driver.result.installed, false); assert.equal(driver.result.released, true);
  });
}

for (const failure of ['FIRST-FAILURE.json', 'FIRST-FAILURE-fault-before-cleanup.json', 'FIRST-FAILURE-full-account.json', 'FIRST-FAILURE-server-ledger.json', 'screenshot', 'fault-read', 'account-read', 'server-ledger-read', 'remove-script', 'release-controller', 'explicit-fault-release.json', 'cleanup-failure.json', 'initialization-chronology.json']) {
  test(`first business error stays primary when ${failure} fails; all remaining evidence is attempted before cleanup`, async () => {
    const driver = journeyDriver(), primary = Error('Original required Goal failure'), secondary = Error(`Synthetic preservation failure: ${failure}`), attempts: string[] = [];
    driver.h.page.waitForFunction = async () => { throw primary; };
    const write = driver.h.writeFile, capture = driver.h.capture, evaluate = driver.h.page.evaluate, remove = driver.h.page.removeScriptToEvaluateOnNewDocument, ledger = driver.h.readLedger;
    driver.h.writeFile = async (path, body) => { attempts.push(`write:${path}`); if (path.endsWith(`-${failure}`)) throw secondary; await write(path, body); };
    driver.h.capture = async (page, label) => { attempts.push('screenshot'); if (failure === 'screenshot') throw secondary; await capture(page, label); };
    driver.h.readLedger = async () => { attempts.push('ledger-read'); if (failure === 'server-ledger-read' && accountReads > 1) throw secondary; return ledger(); };
    driver.h.page.removeScriptToEvaluateOnNewDocument = async id => { attempts.push('cleanup-remove'); if (failure === 'remove-script' || failure === 'cleanup-failure.json') throw secondary; await remove(id); };
    let accountReads = 0;
    driver.h.page.evaluate = async (fn, ...args) => {
      const body = String(fn);
      if (typeof fn === 'function' && fn.name === 'readExistingAccount') { accountReads++; if (accountReads > 1) { attempts.push('account-read'); if (['account-read', 'server-ledger-read', 'FIRST-FAILURE-server-ledger.json'].includes(failure)) throw secondary; } }
      if (body.includes('value.release(')) { attempts.push('cleanup-release'); if (failure === 'release-controller') throw secondary; }
      else if (body.includes('snapshot()')) { attempts.push('fault-read'); if (failure === 'fault-read') throw secondary; }
      return evaluate(fn, ...args);
    };
    await assert.rejects(mockHostedJourney(driver), error => error === primary);
    const cleanup = attempts.indexOf('cleanup-remove'); assert.ok(cleanup >= 0);
    for (const expected of ['fault-read', 'screenshot', 'account-read']) { const position = attempts.indexOf(expected); assert.ok(position >= 0 && position < cleanup, `${expected} must be attempted before cleanup despite ${failure}`); }
    assert.ok(attempts.some(value => value.endsWith('-FIRST-FAILURE.json')));
    assert.ok(attempts.includes('cleanup-release'), 'Script removal failure must not prevent restoring current-document methods');
    if (failure === 'account-read') assert.ok(attempts.lastIndexOf('ledger-read') > attempts.indexOf('account-read') && attempts.lastIndexOf('ledger-read') < cleanup, 'Available server ledger is attempted even when the account snapshot is unavailable');
    assert.ok(attempts.some(value => value.endsWith('-initialization-chronology.json')));
    assert.equal(driver.result.clicks, 0); assert.equal(driver.result.verifies, 0);
  });
}
test('a final chronology failure after a successful journey still rejects rather than awarding a pass', async () => {
  const driver = journeyDriver(), secondary = Error('Final chronology disk failure'), write = driver.h.writeFile;
  driver.h.writeFile = async (path, body) => { if (path.endsWith('-initialization-chronology.json')) throw secondary; await write(path, body); };
  await assert.rejects(mockHostedJourney(driver), error => error === secondary);
  assert.equal(driver.result.clicks, 2); assert.equal(driver.result.released, true);
});
