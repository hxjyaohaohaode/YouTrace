import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import Dexie from 'dexie';
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k), clear: () => m.clear() }; };
let network = 0;
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { location: { replace() {} } }), fetch: () => { network++; throw new Error('Network forbidden in shared Goal tests'); } });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { prepareAccountGeneration } = await import('../src/db/accountGeneration.ts');
const { previewSharedGoals, confirmSharedGoal, listSharedGoalReviews, SHARED_GOAL_AUTOMATIC_UNDO } = await import('../src/services/sharedGoalRecovery.ts');
const { useGoalStore, cloneGoalSnapshot } = await import('../src/stores/goalStore.ts');
const owner = 'synthetic-shared-owner-a', other = 'synthetic-shared-owner-b';
// Historical native30 source, not the current account schema.
const schema = { schedules: 'id,date,type', expenses: 'id,date,category', todos: 'id,done,dueDate,priority', habits: 'id', habitCheckins: 'id,habitId,date,[habitId+date]', quickNotes: 'id,createdAt', diary: 'id,date', settings: 'key', coachInsights: 'id,type,dismissed,createdAt', coachPushes: 'id,type,read,createdAt', goals: 'id,level,domain,priority', outbox: '++seq,entity,queuedAt' };
const original = { id: 'old-goal-a', title: '  原始同名目标  ', description: '  原文\n末尾  ', level: 'short', domain: ' 学习 ', priority: 'medium', progress: 25.5, targetDate: '', createdAt: 1000, updatedAt: 1001 };
const confirm = { ownerId: owner, belongsToMe: true };
let shared: Dexie, otherDb: InstanceType<typeof storage.YoujiDatabase>;
async function source() { return (await storage.exportLegacyData()).rawSnapshot; }
async function all(db: Dexie) { return db.transaction('r', db.tables, async () => Promise.all(db.tables.map(async t => [t.name, await t.toArray()]))); }
before(async () => { await storage.bindAccountDatabase(owner); await prepareAccountGeneration(other); otherDb = new storage.YoujiDatabase(other, true); await otherDb.open(); await otherDb.goalRecords.add({ ...original, id: 'other-private', title: 'Other owner private goal', level: 'short', priority: 'medium', syncScope: 'local' }); });
beforeEach(async () => { api.setSessionActive(owner); sync.pauseSync(); await storage.clearAllData({ allowPending: true }); shared?.close(); await Dexie.delete('youtrace'); shared = new Dexie('youtrace'); shared.version(3).stores(schema); await shared.open(); await shared.table('goals').bulkAdd([original, { ...original, id: 'old-goal-b', description: '第二份不同原文', targetDate: null }]); network = 0; });
after(() => { shared?.close(); otherDb.close(); sync.pauseSync(); storage.db.close(); assert.equal(network, 0); });

test('exact native30 snapshot, explicit one-row confirmation preserves original fields/source/other owner and queues nothing', async () => {
  const before = await source(), otherBefore = await all(otherDb), preview = await previewSharedGoals();
  assert.equal(preview.items.length, 2); assert.equal(await storage.db.goalRecords.count(), 0);
  const receipt = await confirmSharedGoal(preview, original.id, confirm);
  assert.notEqual(receipt.copyId, original.id); assert.deepEqual(receipt.original, original);
  assert.deepEqual(await storage.db.goalRecords.get(receipt.copyId), { ...original, id: receipt.copyId, syncScope: 'local' });
  assert.deepEqual(await source(), before); assert.deepEqual(await all(otherDb), otherBefore); assert.equal(await storage.db.outbox.count(), 0); assert.equal(network, 0);
  assert.equal(receipt.automaticUndoProof, 'unavailable-unfenced-writers');
});
test('no confirmation, wrong owner, forged/cloned preview, rejected row and cancel do not write', async () => {
  const preview = await previewSharedGoals(), before = await all(storage.db);
  await assert.rejects(confirmSharedGoal(preview, original.id, { ...confirm, belongsToMe: false }));
  await assert.rejects(confirmSharedGoal(preview, original.id, { ...confirm, ownerId: other }));
  await assert.rejects(confirmSharedGoal(structuredClone(preview), original.id, confirm));
  await assert.rejects(confirmSharedGoal(preview, 'missing', confirm));
  assert.deepEqual(await all(storage.db), before);
});
test('tampering the public preview cannot change frozen copied raw values', async () => {
  const preview = await previewSharedGoals(); preview.items[0].original!.title = 'forged'; preview.snapshotDigest = 'forged';
  const receipt = await confirmSharedGoal(preview, original.id, confirm);
  assert.equal(receipt.original.title, original.title); assert.match(receipt.snapshotDigest, /^[a-f0-9]{64}$/);
});
test('same-name rows remain distinct, including empty and null target dates', async () => {
  const preview = await previewSharedGoals();
  const a = await confirmSharedGoal(preview, original.id, confirm), b = await confirmSharedGoal(preview, 'old-goal-b', confirm);
  assert.notEqual(a.copyId, b.copyId); assert.equal(a.copy.targetDate, ''); assert.equal(b.copy.targetDate, null); assert.equal(await storage.db.goalRecords.count(), 2);
});
test('concurrent confirmations and a fresh preview replay use one durable receipt and ID', async () => {
  const preview = await previewSharedGoals();
  const [a, b] = await Promise.all([confirmSharedGoal(preview, original.id, confirm), confirmSharedGoal(preview, original.id, confirm)]);
  assert.deepEqual(a, b); const again = await confirmSharedGoal(await previewSharedGoals(), original.id, confirm); assert.deepEqual(a, again);
  assert.equal(await storage.db.goalRecords.count(), 1); assert.equal((await listSharedGoalReviews()).length, 1);
});
test('frozen preview copies precisely its displayed revision; later changed source is a separate non-overwriting intent', async () => {
  const preview = await previewSharedGoals(); await shared.table('goals').put({ ...original, description: 'later original version' });
  const a = await confirmSharedGoal(preview, original.id, confirm); assert.equal(a.original.description, original.description);
  const b = await confirmSharedGoal(await previewSharedGoals(), original.id, confirm); assert.notEqual(a.copyId, b.copyId); assert.equal(b.original.description, 'later original version');
  assert.equal(await storage.db.goalRecords.count(), 2);
});
test('unrelated source changes do not duplicate an identical already copied row', async () => {
  const a = await confirmSharedGoal(await previewSharedGoals(), original.id, confirm);
  await shared.table('settings').put({ key: 'unrelated', value: 'later' });
  const preview = await previewSharedGoals(); assert.notEqual(preview.snapshotDigest, a.snapshotDigest);
  assert.deepEqual(await confirmSharedGoal(preview, original.id, confirm), a); assert.equal(await storage.db.goalRecords.count(), 1);
});
for (const [name, mutate] of Object.entries({ owner: () => api.setSessionActive(other), reauthentication: () => { api.clearSession(); api.setSessionActive(owner); }, clear: () => storage.clearAllData({ allowPending: true }) })) {
  test(`stale preview after ${name} refuses without adding or resurrecting`, async () => {
    const preview = await previewSharedGoals(); await mutate(); const before = await all(storage.db);
    await assert.rejects(confirmSharedGoal(preview, original.id, confirm)); assert.deepEqual(await all(storage.db), before);
  });
}
test('quota/receipt failure rolls back both current copy and receipt, then original confirmation retries safely', async () => {
  const preview = await previewSharedGoals(), before = await all(storage.db), add = storage.db.settings.add;
  storage.db.settings.add = async () => { throw new DOMException('Synthetic disk full', 'QuotaExceededError'); };
  try { await assert.rejects(confirmSharedGoal(preview, original.id, confirm), /disk full/); } finally { storage.db.settings.add = add; }
  assert.deepEqual(await all(storage.db), before); await confirmSharedGoal(preview, original.id, confirm); assert.equal(await storage.db.goalRecords.count(), 1);
});
test('lost result after transaction commit does not duplicate when repeated or when reopened', async () => {
  const preview = await previewSharedGoals(); const database = storage.db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> }, prior = database.transaction;
  let drop = true; database.transaction = function (...args) { const result = prior.apply(this, args); if (args[0] !== 'rw' || !drop) return result; drop = false; return result.then(() => { throw Error('Synthetic lost commit response'); }); };
  try { await assert.rejects(confirmSharedGoal(preview, original.id, confirm), /lost commit response/); } finally { database.transaction = prior; }
  const receipts = await listSharedGoalReviews(); assert.equal(receipts.length, 1); assert.deepEqual(await confirmSharedGoal(await previewSharedGoals(), original.id, confirm), receipts[0].receipt); assert.equal(await storage.db.goalRecords.count(), 1);
});
test('delete and same-ID replacement are preserved; receipt replay never recreates or overwrites and never auto-undoes', async () => {
  const preview = await previewSharedGoals(), receipt = await confirmSharedGoal(preview, original.id, confirm);
  await storage.db.goalRecords.delete(receipt.copyId); await confirmSharedGoal(preview, original.id, confirm); assert.equal(await storage.db.goalRecords.count(), 0);
  let review = (await listSharedGoalReviews())[0]; assert.equal(review.current, null); assert.equal(review.automaticUndoAvailable, false);
  const replacement = { ...receipt.copy, description: 'User replaced this same ID later' }; await storage.db.goalRecords.add(replacement);
  await confirmSharedGoal(await previewSharedGoals(), original.id, confirm); review = (await listSharedGoalReviews())[0]; assert.deepEqual(review.current, replacement); assert.equal(review.currentEqualsCopy, false); assert.equal(SHARED_GOAL_AUTOMATIC_UNDO, false);
});
test('real GoalStore ABA edits still cannot grant automatic undo even when every field becomes equal', async () => {
  const plain = { ...original, title: 'plain', description: 'plain', domain: 'study', progress: 25, updatedAt: 1000 }; await shared.table('goals').put(plain);
  const receipt = await confirmSharedGoal(await previewSharedGoals(), original.id, confirm); await useGoalStore.getState().loadFromDB(); const now = Date.now;
  try { Date.now = () => 1000; for (const title of ['edited', 'plain']) { const view = cloneGoalSnapshot(useGoalStore.getState().items.find(r => r.id === receipt.copyId)!); await useGoalStore.getState().updateGoal(receipt.copyId, { title }, view); } } finally { Date.now = now; }
  const review = (await listSharedGoalReviews())[0]; assert.equal(review.currentEqualsCopy, true); assert.equal(review.automaticUndoAvailable, false); assert.match(review.reason, /无法确认/); assert.equal(await storage.db.goalRecords.count(), 1);
});
for (const [name, value] of Object.entries({ owner: { ...original, ownerId: owner }, missing: { ...original, createdAt: undefined }, unknown: { ...original, custom: new Map([['raw', 1n]]) }, malformed: { ...original, targetDate: '2026-02-30' }, numericId: { ...original, id: 42 } })) {
  test(`unsupported ${name} stays in source with an explicit per-row refusal`, async () => {
    await shared.table('goals').clear(); await shared.table('goals').add(value); const before = await source(); const preview = await previewSharedGoals();
    assert.equal(preview.items.length, 1); assert.equal(preview.items[0].original, undefined); assert.ok(preview.items[0].blockedReason); await assert.rejects(confirmSharedGoal(preview, preview.items[0].key, confirm)); assert.deepEqual(await source(), before); assert.equal(await storage.db.goalRecords.count(), 0);
  });
}
test('unknown native version/schema does not become accepted merely because it contains a goals table', async () => {
  shared.close(); shared = new Dexie('youtrace'); shared.version(4).stores({ extra: 'id' }); await shared.open(); const before = await source();
  await assert.rejects(previewSharedGoals(), /版本|结构/); assert.deepEqual(await source(), before); assert.equal(await storage.db.goalRecords.count(), 0);
});
test('corrupted existing receipt is preserved and refuses replacement rather than picking a winner', async () => {
  const preview = await previewSharedGoals(), receipt = await confirmSharedGoal(preview, original.id, confirm);
  const key = `shared-goal-recovery:v1:${receipt.intentId}`; await storage.db.settings.put({ key, value: { ...receipt, original: { ...receipt.original, description: 'corrupted raw' } } });
  const before = await all(storage.db); await assert.rejects(confirmSharedGoal(preview, original.id, confirm), /收据/); await assert.rejects(listSharedGoalReviews(), /收据/); assert.deepEqual(await all(storage.db), before);
});

test('same raw field values with different insertion order have one canonical row identity, not a second copy', async () => {
  const first = await confirmSharedGoal(await previewSharedGoals(), original.id, confirm);
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  await shared.table('goals').put(reordered);
  const second = await confirmSharedGoal(await previewSharedGoals(), original.id, confirm);
  assert.deepEqual(second, first); assert.equal(await storage.db.goalRecords.count(), 1);
  assert.deepEqual((await shared.table('goals').get(original.id)), reordered);
});
for (const field of ['coherent-text', 'snapshotDigest', 'rowDigest', 'sourceKey', 'schemaId', 'intentId', 'confirmedAt', 'copyId', 'receiptDigest'] as const) {
  test(`receipt ${field} corruption refuses read/retry and preserves every stored byte/value`, async () => {
    const preview = await previewSharedGoals(), receipt = await confirmSharedGoal(preview, original.id, confirm);
    const altered = structuredClone(receipt);
    if (field === 'coherent-text') { altered.original.description = 'coherently corrupted'; altered.copy.description = 'coherently corrupted'; }
    else if (field === 'confirmedAt') altered.confirmedAt++;
    else if (field === 'copyId') { altered.copyId = 'replacement-id'; altered.copy.id = altered.copyId; }
    else if (field === 'sourceKey') { altered.sourceKey = 'another-original'; altered.original.id = altered.sourceKey; }
    else altered[field] = 'f'.repeat(64);
    const key = `shared-goal-recovery:v1:${receipt.intentId}`; await storage.db.settings.put({ key, value: altered });
    const before = await all(storage.db); await assert.rejects(listSharedGoalReviews(), /收据/); await assert.rejects(confirmSharedGoal(preview, original.id, confirm), /收据/); assert.deepEqual(await all(storage.db), before);
  });
}
