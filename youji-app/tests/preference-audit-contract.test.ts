import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { acknowledgedPreferences, validPreferenceWire, unchangedPreferences, validPreferenceAck, retainedPreferenceIntent, frozenPreferenceRequestMatches, exactPreferenceAck, comparisonRows, comparisonTextMatches } from '../scripts/audit-preference-contract.mjs';
import { installPreferenceFault } from '../scripts/audit-preference-faults.mjs';
const settings = { coachStyle: 'gentle', coachPushEnabled: false, coachPushFrequency: 0, quietHours: { enabled: true, start: '23:00', end: '07:00' }, eveningReviewEnabled: false, eveningReviewTime: '21:00' };
const remote = { protocol: 1, revision: '0', settings: { coachStyle: 'gentle', coachPushEnabled: false, pushLimit: 0, quietEnabled: true, quietStart: '23:00', quietEnd: '07:00', eveningReviewEnabled: false, eveningReviewTime: '21:00' } };
const state = { version: 1, epoch: 'test-epoch', localRevision: 2, initial: settings, server: { protocol: 1, revision: '0', settings }, active: null, queued: null };
const local = { databaseName: 'youtrace:user:synthetic-contract:schedule-v1', version: 1, schema: [], tables: [{ name: 'settings', rows: [{ key: 'accountPreferences:state:v1', value: state }, ...Object.entries(settings).map(([key, value]) => ({ key, value }))] }, { name: 'outbox', rows: [] }] };
test('zero is an acknowledged explicit paused value; complete server, revision and queue evidence required', () => {
  assert.equal(acknowledgedPreferences(local, remote), true);
  for (const variant of [{ ...remote, revision: '1' }, { ...remote, revision: 0 }, { ...remote, settings: { ...remote.settings, pushLimit: undefined } }]) assert.equal(Boolean(acknowledgedPreferences(local, variant)), false);
  const pending = structuredClone(local); pending.tables[0].rows[0].value.queued = { changes: { coachPushFrequency: 0 } }; assert.equal(acknowledgedPreferences(pending, remote), false);
});
test('only typed allowlisted preference wire fields are accepted', () => {
  const good = { protocol: 1, mutationId: 'synthetic-id', baseRevision: '0', changes: { pushLimit: 0, eveningReviewEnabled: false, quietEnd: '07:00' } };
  assert.equal(Boolean(validPreferenceWire(good)), true); assert.equal(Boolean(validPreferenceWire({ ...good, privateMemo: 'synthetic-private' })), false);
  for (const changes of [{ pushLimit: null }, { privateMemo: 'synthetic-private' }, { quietEnd: { text: 'private' } }, { coachStyle: { unexpected: 'private' } }, { eveningReviewEnabled: 1 }, {}]) assert.equal(Boolean(validPreferenceWire({ ...good, changes })), false);
});
test('cancel equivalence includes raw pending request/recovery and remote revision', () => {
  const original = { owner: 'synthetic-contract', local, remote }; assert.equal(unchangedPreferences(original, structuredClone(original)), true);
  const changed = structuredClone(original); changed.local.tables[0].rows.push({ key: 'preferenceRecovery:one', value: { retained: true } }); assert.equal(unchangedPreferences(original, changed), false);
  const otherOwner = structuredClone(original); otherOwner.owner = 'other'; assert.equal(unchangedPreferences(original, otherOwner), false);
});
function open(name) { return new Promise((resolve, reject) => { const request = indexedDB.open(name, 1); request.onupgradeneeded = () => { request.result.createObjectStore('settings', { keyPath: 'key' }); request.result.createObjectStore('todos', { keyPath: 'id' }); }; request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); }); }
function done(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError')); tx.onerror = () => {}; }); }
async function put(db, rows) { const tx = db.transaction('settings', 'readwrite'), wait = done(tx); wait.catch(() => {}); try { for (const row of rows) tx.objectStore('settings').put(row); } catch (error) { try { tx.abort(); } catch { /* Already aborted by the tested operation. */ } await wait.catch(() => {}); throw error; } await wait; }
async function all(db) { const tx = db.transaction(['settings', 'todos'], 'readonly'), wait = done(tx), result = tx.objectStore('settings').getAll(); await wait; return result.result; }
const next = { ...state, localRevision: 3, queued: { changes: { eveningReviewTime: '20:00' } } };
test('write fault rolls back exact matching native transaction and releases before one real retry', async () => {
  const databaseName = 'youtrace:user:synthetic-write:schedule-v1', db = await open(databaseName); await put(db, [{ key: 'accountPreferences:state:v1', value: state }]); const before = await all(db);
  try {
    installPreferenceFault({ databaseName, originalRevision: 2, originalEpoch: 'test-epoch', desiredTime: '20:00', kind: 'write', durationMs: 5000 });
    await assert.rejects(put(db, [{ key: 'private-before-target', value: 'rollback' }, { key: 'accountPreferences:state:v1', value: next }]), { name: 'QuotaExceededError' });
    assert.deepEqual(await all(db), before); const hit = globalThis.__youtracePreferenceFault.snapshot(); assert.equal(hit.writeHits, 1); assert.equal(hit.commits, 0); assert.equal(hit.expired, false);
    globalThis.__youtracePreferenceFault.release('explicit-test-release'); await put(db, [{ key: 'accountPreferences:state:v1', value: next }]); assert.equal((await all(db))[0].value.queued.changes.eveningReviewTime, '20:00');
  } finally { globalThis.__youtracePreferenceFault?.release('test-cleanup'); delete globalThis.__youtracePreferenceFault; db.close(); }
});
test('display fault arms only after exact commit; all-table evidence and ACK write transactions remain real', async () => {
  const databaseName = 'youtrace:user:synthetic-read:schedule-v1', db = await open(databaseName); await put(db, [{ key: 'accountPreferences:state:v1', value: state }, { key: 'theme', value: 'system' }]);
  try {
    installPreferenceFault({ databaseName, originalRevision: 2, originalEpoch: 'test-epoch', desiredTime: '20:00', kind: 'read', durationMs: 5000 });
    let tx = db.transaction('settings', 'readonly'), completed = done(tx); tx.objectStore('settings').get('theme'); await completed; assert.equal(globalThis.__youtracePreferenceFault.snapshot().readHits, 0);
    await put(db, [{ key: 'accountPreferences:state:v1', value: next }]);
    tx = db.transaction('settings', 'readonly'); completed = done(tx); completed.catch(() => {}); assert.throws(() => tx.objectStore('settings').get('theme'), { name: 'AbortError' }); await assert.rejects(completed);
    assert.equal((await all(db)).find(row => row.key === 'accountPreferences:state:v1').value.queued.changes.eveningReviewTime, '20:00');
    tx = db.transaction('settings', 'readwrite'); completed = done(tx); tx.objectStore('settings').get('theme'); await completed;
    const hit = globalThis.__youtracePreferenceFault.snapshot(); assert.equal(hit.commits, 1); assert.equal(hit.readHits, 1); assert.ok(hit.events.find(row => row.name === 'matching-write-complete').sequence < hit.events.find(row => row.name === 'display-theme-read-abort').sequence);
    globalThis.__youtracePreferenceFault.release('explicit-test-release'); tx = db.transaction('settings', 'readonly'); completed = done(tx); tx.objectStore('settings').get('theme'); await completed; assert.equal(globalThis.__youtracePreferenceFault.snapshot().expired, false);
  } finally { globalThis.__youtracePreferenceFault?.release('test-cleanup'); delete globalThis.__youtracePreferenceFault; db.close(); }
});

test('HTTP200 alone is insufficient; ACK binds exact mutation, increment and changed values', () => {
  const request = { protocol: 1, mutationId: 'synthetic-id', baseRevision: '0', changes: { pushLimit: 0 } };
  const receipt = { ...remote, revision: '1', mutationId: 'synthetic-id', acknowledged: true };
  assert.equal(Boolean(validPreferenceAck(request, receipt)), true);
  for (const invalid of [{ ...receipt, acknowledged: false }, { ...receipt, mutationId: 'other' }, { ...receipt, revision: '2' }, { ...receipt, settings: { ...receipt.settings, pushLimit: 1 } }]) assert.equal(Boolean(validPreferenceAck(request, invalid)), false);
});

test('each conflict row is bound to exact full source, including zero and all time/switch values', () => {
  const original = comparisonRows(settings), newer = comparisonRows({ ...settings, coachPushFrequency: 3, coachPushEnabled: true, quietHours: { enabled: false, start: '22:30', end: '08:15' }, eveningReviewEnabled: true, eveningReviewTime: '20:30' });
  assert.equal(original.length, 4); assert.equal(comparisonTextMatches(original[0], newer[0]), true);
  for (let index = 1; index < 4; index++) { assert.equal(comparisonTextMatches(original[index], newer[index]), false); assert.equal(comparisonTextMatches('  ' + original[index] + '\n', original[index]), true); }
  assert.equal(comparisonTextMatches(original[1].replace('0', '未设置'), original[1]), false);
});

test('acknowledgement refuses legacy pending, contradictory mirrors and wrong durable protocol', () => {
  const legacy = structuredClone(local); legacy.tables[0].rows.push({ key: 'pendingSetting:coachStyle', value: 'data' }); assert.equal(acknowledgedPreferences(legacy, remote), false);
  const mirror = structuredClone(local); mirror.tables[0].rows.find(row => row.key === 'eveningReviewTime').value = '20:30'; assert.equal(acknowledgedPreferences(mirror, remote), false);
  for (const key of ['version', 'server']) { const broken = structuredClone(local); const stored = broken.tables[0].rows[0].value; if (key === 'version') stored.version = 99; else stored.server.protocol = 99; assert.equal(acknowledgedPreferences(broken, remote), false); }
});
test('cancel checks legacy pending, theme and unrelated rows; only lastPullAt is a declared read timestamp', () => {
  const before = { owner: 'synthetic-contract', local: structuredClone(local), remote }; before.local.tables[0].rows.push({ key: 'pendingSetting:coachStyle', value: 'data' }, { key: 'theme', value: 'dark' }); before.local.tables.push({ name: 'todos', rows: [{ id: 'one', text: 'original' }] });
  for (const key of ['pendingSetting:coachStyle', 'theme']) { const after = structuredClone(before); after.local.tables[0].rows = after.local.tables[0].rows.filter(row => row.key !== key); assert.equal(unchangedPreferences(before, after), false); }
  const changed = structuredClone(before); changed.local.tables.at(-1).rows[0].text = 'different'; assert.equal(unchangedPreferences(before, changed), false);
  const pulled = structuredClone(before); pulled.local.tables[0].rows.push({ key: 'lastPullAt', value: 123 }); assert.equal(unchangedPreferences(before, pulled), true);
});
test('postcommit intent permits increasing localRevision but preserves epoch, initial and non-target raw state', () => {
  const before = { owner: 'synthetic-contract', local, remote }, after = structuredClone(before), saved = after.local.tables[0].rows[0].value; saved.localRevision++; saved.queued = { changes: { eveningReviewTime: '20:30' }, baseRevision: '0', base: structuredClone(settings) }; after.local.tables[0].rows.find(row => row.key === 'eveningReviewTime').value = '20:30';
  assert.equal(retainedPreferenceIntent(before, after, 'eveningReviewTime', '20:30'), true);
  const wrongEpoch = structuredClone(after); wrongEpoch.local.tables[0].rows[0].value.epoch = 'new'; assert.equal(retainedPreferenceIntent(before, wrongEpoch, 'eveningReviewTime', '20:30'), false);
  const unrelated = structuredClone(after); unrelated.local.tables[0].rows.push({ key: 'theme', value: 'light' }); assert.equal(retainedPreferenceIntent(before, unrelated, 'eveningReviewTime', '20:30'), false);
});

test('a fabricated local server value is not proof of a committed preference intent', () => {
  const before = { owner: 'synthetic-contract', local, remote }, after = structuredClone(before), state = after.local.tables[0].rows[0].value; state.localRevision++;
  state.server.settings = { ...state.server.settings, eveningReviewTime: '20:30' }; after.local.tables[0].rows.find(row => row.key === 'eveningReviewTime').value = '20:30';
  assert.equal(retainedPreferenceIntent(before, after, 'eveningReviewTime', '20:30'), false);
  const request = { account: before.owner, body: { protocol: 1, mutationId: 'one', baseRevision: '0', changes: { eveningReviewTime: '20:30' } } };
  assert.equal(exactPreferenceAck([request], [], before.owner), false);
  assert.equal(exactPreferenceAck([request], [{ status: 200, request: request.body, body: { ...remote, revision: '1', mutationId: 'other', acknowledged: true } }], before.owner), false);
});
test('a frozen preference ID cannot silently change its base or any wire field', () => {
  const active = { id: 'one', baseRevision: '99', changes: { eveningReviewTime: '20:30' } }, request = { protocol: 1, mutationId: 'one', baseRevision: '99', changes: { eveningReviewTime: '20:30' } };
  assert.equal(frozenPreferenceRequestMatches(active, request), true);
  assert.equal(frozenPreferenceRequestMatches(active, { ...request, baseRevision: '0' }), false);
  assert.equal(frozenPreferenceRequestMatches(active, { ...request, changes: { eveningReviewTime: '20:45' } }), false);
});
