import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { sharedGoalFixture, seedSharedGoalFixture, installOneReceiptAbort, accountRows, recoveryReceipts, exactLocalCopy, unchangedAccount } from '../scripts/audit-shared-goal-recovery.mjs';
import { legacyBackupFacts } from '../scripts/audit-legacy-backup.mjs';
import { captureLegacySnapshot } from '../src/db/legacySnapshot.ts';
const request = <T>(item: IDBRequest<T>) => new Promise<T>((resolve, reject) => { item.onsuccess = () => resolve(item.result); item.onerror = () => reject(item.error); });
after(async () => { await request(indexedDB.deleteDatabase('youtrace')); });

test('native shared fixture is exact native30 source, includes same-name/unknown row and never replaces an existing database', async () => {
  await seedSharedGoalFixture(sharedGoalFixture); const source = await captureLegacySnapshot();
  assert.equal(source.idbVersion, 30); assert.equal(source.tables.length, 12);
  assert.deepEqual(source.tables.find(t => t.name === 'goals')!.rows.map(r => r.value), sharedGoalFixture);
  assert.equal(source.tables.find(t => t.name === 'todos')!.rows.length, 1);
  const before = await legacyBackupFacts(undefined); await assert.rejects(seedSharedGoalFixture(sharedGoalFixture), /refuses an existing/); assert.deepEqual(await legacyBackupFacts(undefined), before);
});
test('independent native Goal copy oracle rejects raw, owner, ID, scope and queue corruption', () => {
  const original = sharedGoalFixture[0], copy = { ...original, id: 'new-native-id', syncScope: 'local' };
  const receipt = { original, copy, copyId: copy.id, sourceKey: original.id, ownerId: 'owner', automaticUndoProof: 'unavailable-unfenced-writers', intentId: 'a'.repeat(64), rowDigest: 'b'.repeat(64), receiptDigest: 'c'.repeat(64) };
  const before = { databaseName: 'youtrace:user:owner:schedule-v1', tables: [{ name: 'goalRecords', rows: [copy] }, { name: 'outbox', rows: [] }, { name: 'settings', rows: [{ key: 'shared-goal-recovery:v1:'+receipt.intentId, value: receipt }] }] };
  assert.equal(exactLocalCopy(before, original), true); assert.equal(recoveryReceipts(before).length, 1);
  for (const mutate of [
    (facts: typeof before) => { accountRows(facts, 'goalRecords')[0].description = 'trimmed'; },
    (facts: typeof before) => { recoveryReceipts(facts)[0].value.ownerId = 'another-owner'; },
    (facts: typeof before) => { accountRows(facts, 'goalRecords')[0].id = original.id; },
    (facts: typeof before) => { accountRows(facts, 'goalRecords')[0].syncScope = 'account'; },
    (facts: typeof before) => { accountRows(facts, 'outbox').push({ entity: 'goals' }); },
    (facts: typeof before) => { recoveryReceipts(facts)[0].value.original.progress = 26; },
  ]) { const changed = structuredClone(before); mutate(changed); assert.equal(Boolean(exactLocalCopy(changed, original)), false); assert.equal(unchangedAccount(before, changed), false); }
});
test('cancel/abort oracle refuses any changed original table, setting, schema or key', () => {
  const original = { tables: [{ name: 'settings', rows: [{ key: 'original', value: { retained: 'raw' } }], keys: ['original'] }], schema: [{ name: 'settings', keyPath: 'key' }] };
  assert.ok(unchangedAccount(original, structuredClone(original)));
  for (const changed of [{ ...original, schema: [] }, { ...original, tables: [] }, { ...original, tables: [{ ...original.tables[0], keys: [] }] }, { ...original, tables: [{ ...original.tables[0], rows: [{ key: 'original', value: { retained: 'changed' } }] }] }]) assert.equal(unchangedAccount(original, changed), false);
});
test('one native receipt fault aborts real Goal+receipt transaction and restores original add for visible retry', async () => {
  Object.assign(globalThis, { window: {} });
  const name = 'youtrace:user:synthetic-native-fault:schedule-v1'; const opening = indexedDB.open(name, 30); opening.onupgradeneeded = () => { opening.result.createObjectStore('goalRecords', { keyPath: 'id' }); opening.result.createObjectStore('settings', { keyPath: 'key' }); };
  const db = await request(opening);
  try {
    installOneReceiptAbort('synthetic-native-fault');
    const tx = db.transaction(['goalRecords', 'settings'], 'readwrite'); const done = new Promise<void>(resolve => { tx.onabort = () => resolve(); });
    await request(tx.objectStore('goalRecords').add({ id: 'synthetic-new-copy' }));
    assert.throws(() => tx.objectStore('settings').add({ key: 'shared-goal-recovery:v1:synthetic', value: {} }), /空间不足/); await done;
    const read = db.transaction(['goalRecords', 'settings'], 'readonly'); assert.equal(await request(read.objectStore('goalRecords').count()), 0); assert.equal(await request(read.objectStore('settings').count()), 0);
    const retry = db.transaction(['goalRecords', 'settings'], 'readwrite'); await request(retry.objectStore('goalRecords').add({ id: 'synthetic-new-copy' })); await request(retry.objectStore('settings').add({ key: 'shared-goal-recovery:v1:synthetic', value: {} }));
    const state = (window as unknown as { __sharedReceiptFault: { fired: number; restored: boolean } }).__sharedReceiptFault; assert.deepEqual(state, { fired: 1, restored: true });
  } finally { db.close(); await request(indexedDB.deleteDatabase(name)); }
});
test('hosted native chain has bounded real controls/owner snapshots and no service invocation or automated rollback', async () => {
  const source = await readFile(new URL('../scripts/audit-shared-goal-recovery.mjs', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.GITHUB_ACTIONS, 'true'/); assert.match(source, /\[1280, 360\]/);
  for (const required of ['finishAuthenticatedEntry', '暂不恢复', '确认并创建仅本机副本', '复制结果尚未确认', '查看恢复收据', '确认删除', 'other-owner-unclaimed', 'sourceTransactions.every', 'native-browser-reload']) assert.ok(source.includes(required), required);
  assert.doesNotMatch(source, /import\([^\n]*sharedGoalRecovery|\.evaluate\([^\n]*(confirmSharedGoal|useGoalStore)|localStorage\.setItem|document\.querySelector[^\n]*\.click\(/);
});

test('independent wire-format oracle agrees with actual production snapshot/copy hashes and rejects tampering without importing its codec', async () => {
  const { fixtureGraphHash, verifySharedGoalReceiptHash, readSharedGoalRawSnapshot } = await import('../scripts/audit-shared-goal-hashes.mjs');
  const { encodeLegacyGraph } = await import('../src/db/legacySnapshotCodec.ts');
  const { createHash } = await import('node:crypto');
  const snapshot = await readSharedGoalRawSnapshot();
  assert.deepEqual(snapshot, await captureLegacySnapshot());
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) }; };
  Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { location: { replace() {} } }), fetch: () => { throw Error('No network'); } });
  const storage = await import('../src/db/index.ts'), api = await import('../src/services/apiClient.ts'), sync = await import('../src/services/syncEngine.ts');
  const service = await import('../src/services/sharedGoalRecovery.ts');
  const ownerId = 'synthetic-independent-native-hashes'; await storage.bindAccountDatabase(ownerId); api.setSessionActive(ownerId); sync.pauseSync();
  try {
    const receipt = await service.confirmSharedGoal(await service.previewSharedGoals(), sharedGoalFixture[0].id, { ownerId, belongsToMe: true });
    const row = { key: `shared-goal-recovery:v1:${receipt.intentId}`, value: receipt };
    assert.equal(fixtureGraphHash(snapshot), createHash('sha256').update(JSON.stringify(await encodeLegacyGraph(snapshot))).digest('hex'));
    const proof = verifySharedGoalReceiptHash(row, { ownerId, epoch: undefined, sourceSnapshot: snapshot }); assert.equal(proof.receiptDigest, receipt.receiptDigest);
    for (const field of ['snapshotDigest', 'rowDigest', 'intentId', 'receiptDigest'] as const) { const bad = structuredClone(row); bad.value[field] = 'f'.repeat(64); assert.throws(() => verifySharedGoalReceiptHash(bad, { ownerId, epoch: undefined, sourceSnapshot: snapshot })); }
    const bad = structuredClone(row); bad.value.original.description = 'changed'; bad.value.copy.description = 'changed'; assert.throws(() => verifySharedGoalReceiptHash(bad, { ownerId, epoch: undefined, sourceSnapshot: snapshot }));
    assert.throws(() => verifySharedGoalReceiptHash(row, { ownerId: 'different-owner', epoch: undefined, sourceSnapshot: snapshot }));
  } finally { sync.pauseSync(); storage.db.close(); }
});

test('readonly account-fact decoder retains undefined property identity and safe literal proto keys', async () => {
  const { decodeAccountFact } = await import('../scripts/audit-shared-goal-hashes.mjs');
  const value = decodeAccountFact({ type: 'object', entries: [['epoch', { type: 'undefined' }], ['__proto__', { type: 'object', entries: [['retained', 'raw']] }]] });
  assert.equal(Object.hasOwn(value, 'epoch'), true); assert.equal(value.epoch, undefined); assert.equal(Object.getPrototypeOf(value), Object.prototype); assert.deepEqual(value.__proto__, { retained: 'raw' });
  assert.equal(({} as { retained?: string }).retained, undefined); assert.throws(() => decodeAccountFact({ type: 'unimplemented' }));
});

test('native recovery pointer scrolls a covered bottom-bar target, checks the actual hit and never performs a guessed click', async () => {
  const { prepareSharedGoalPointer } = await import('../scripts/audit-shared-goal-recovery.mjs');
  const actions: unknown[] = [], wheels: number[] = [];
  let covered = true;
  const target = { scrollIntoView: async () => {}, evaluate: async () => ({ connected: true, enabled: true, x: 100, y: covered ? 868 : 450, width: 120, height: 32, viewportWidth: 360, viewportHeight: 900, hit: !covered, hitTag: covered ? 'NAV' : 'BUTTON', hitLabel: covered ? '日程' : null }) };
  const page = { bringToFront: async () => {}, mouse: { move: async () => {}, wheel: async ({ deltaY }: { deltaY: number }) => { wheels.push(deltaY); covered = false; } }, waitForFunction: async () => {} };
  assert.equal((await prepareSharedGoalPointer(page, target, actions, 'source:fixture')).hit, true); assert.deepEqual(wheels, [418]);
  assert.equal(actions.filter(row => (row as { kind: string }).kind === 'recovery-control-hit-test').length, 2);
  const blocked = { ...target, evaluate: async () => ({ ...await target.evaluate(), y: 450, hit: false }) };
  await assert.rejects(prepareSharedGoalPointer(page, blocked, [], 'overlay'), /covered in the viewport center/);
  const stale = { ...target, evaluate: async () => ({ ...await target.evaluate(), connected: false }) };
  await assert.rejects(prepareSharedGoalPointer(page, stale, [], 'stale'), /no longer available/);
  const permanentlyCovered = { ...target, evaluate: async () => ({ ...await target.evaluate(), y: 868, hit: false }) };
  const repeated: unknown[] = []; await assert.rejects(prepareSharedGoalPointer(page, permanentlyCovered, repeated, 'fixed'), /remains covered/);
  assert.equal(repeated.filter(row => (row as { kind: string }).kind === 'native-wheel-to-recovery-control').length, 4);
  const atScrollEnd = { ...page, waitForFunction: async () => { throw Error('No geometry movement at scroll limit'); } };
  await assert.rejects(prepareSharedGoalPointer(atScrollEnd, permanentlyCovered, [], 'scroll-end'), /scroll limit/);
});

test('all native recovery controls use the hit-tested pointer, and source selection cannot bypass it', async () => {
  const source = await readFile(new URL('../scripts/audit-shared-goal-recovery.mjs', import.meta.url), 'utf8');
  assert.match(source, /pointer: originalPointer/); assert.match(source, /prepareSharedGoalPointer\(page, element, actions/);
  assert.match(source, /prepareSharedGoalPointer\(page, target, actions, `source:\$\{sourceId\}`\)/);
  assert.match(source, /native-wheel-to-recovery-control/); assert.match(source, /elementFromPoint/);
  assert.match(source, /waitForSelector\('\[role=dialog\] input\[type=checkbox\]'/);
  assert.doesNotMatch(source, /force\s*:\s*true|\.evaluate\([^\n]*\.click\(/);
});
