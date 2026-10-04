import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
const memoryStorage = () => { const entries = new Map<string, string>(); return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) }; };
Object.assign(globalThis, { localStorage: memoryStorage(), sessionStorage: memoryStorage(), window: Object.assign(new EventTarget(), { location: { replace() {} } }) });
const storage = await import('../src/db/index.ts');
const sync = await import('../src/services/syncEngine.ts');
const { useGoalStore } = await import('../src/stores/goalStore.ts');
const goalInput = { title: 'Synthetic goal', description: 'Private draft', level: 'short' as const, domain: '生活', priority: 'medium' as const, targetDate: null };
before(async () => { await storage.bindAccountDatabase('synthetic-goal-account'); sync.pauseSync(); });
beforeEach(async () => { await storage.db.table('goals').clear(); await storage.db.goalRecords.clear(); await storage.db.outbox.clear(); await storage.db.settings.clear(); await useGoalStore.getState().loadFromDB(); });
after(() => { sync.pauseSync(); storage.db.close(); });

test('goal lifecycle: new account goal and retryable mutation share one transaction', async () => {
  const row = await useGoalStore.getState().addGoal(goalInput);
  assert.equal((await storage.db.outbox.toArray())[0]?.entity, 'goals');
  assert.equal((await storage.db.goalRecords.get(row.id))?.title, goalInput.title);
  const fail = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', fail);
  await assert.rejects(useGoalStore.getState().addGoal({ ...goalInput, title: 'must roll back' }), /quota/);
  storage.db.outbox.hook('creating').unsubscribe(fail);
  assert.equal(await storage.db.goalRecords.count(), 1);
  assert.equal(useGoalStore.getState().items.length, 1);
});

test('goal lifecycle: stale visible progress cannot overwrite a newer goal', async () => {
  const row = await useGoalStore.getState().addGoal(goalInput);
  await storage.db.goalRecords.update(row.id, { title: 'Newer remote content' });
  const pending = await storage.db.outbox.count();
  await assert.rejects(useGoalStore.getState().updateProgress(row.id, 50), /刚刚/);
  assert.equal((await storage.db.goalRecords.get(row.id))?.title, 'Newer remote content');
  assert.equal(await storage.db.outbox.count(), pending);
});

test('goal lifecycle: invalid progress cannot become NaN or a misleading completion', async () => {
  const row = await useGoalStore.getState().addGoal(goalInput);
  await assert.rejects(useGoalStore.getState().updateProgress(row.id, NaN), /进度/);
  assert.equal((await storage.db.goalRecords.get(row.id))?.progress, 0);
});

test('goal lifecycle: pre-sync goals stay local until selected content and account are confirmed', async () => {
  const original = { ...goalInput, id: 'legacy-local-goal-001', createdAt: 1, updatedAt: 2, progress: 25 };
  await storage.db.goalRecords.put(original);
  await useGoalStore.getState().loadFromDB();
  await useGoalStore.getState().updateProgress(original.id, 50);
  assert.equal(await storage.db.outbox.count(), 0);
  const selected = useGoalStore.getState().items[0];
  await assert.rejects(useGoalStore.getState().enableSync([selected], 'wrong-account'), /账号/);
  assert.equal(await storage.db.outbox.count(), 0);
  await useGoalStore.getState().enableSync([selected], 'synthetic-goal-account');
  assert.equal((await storage.db.goalRecords.get(original.id))?.syncScope, 'account');
  assert.equal(await storage.db.outbox.count(), 1);
  const receipt = (await storage.db.settings.get(`goal-local-copy:${original.id}`))?.value as { original: unknown };
  assert.deepEqual(receipt.original, selected);
  await useGoalStore.getState().enableSync([selected], 'synthetic-goal-account');
  assert.equal(await storage.db.outbox.count(), 1, 'repeated confirmation does not enqueue twice');
});

test('goal lifecycle: enrollment rolls back all selected records and backups on failure', async () => {
  const first = { ...goalInput, id: 'legacy-first-goal-001', createdAt: 1, updatedAt: 2, progress: 25 };
  const second = { ...first, id: 'legacy-second-goal-002' };
  await storage.db.goalRecords.bulkPut([first, second]);
  const fail = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', fail);
  await assert.rejects(useGoalStore.getState().enableSync([first, second], 'synthetic-goal-account'), /quota/);
  storage.db.outbox.hook('creating').unsubscribe(fail);
  assert.deepEqual(await storage.db.goalRecords.toArray(), [first, second]);
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal(await storage.db.settings.count(), 0);
});

test('goal lifecycle: stale enrollment and old local-only tab cannot erase account enrollment', async () => {
  const original = { ...goalInput, id: 'legacy-race-goal-001', createdAt: 1, updatedAt: 2, progress: 25 };
  await storage.db.goalRecords.put(original);
  await useGoalStore.getState().loadFromDB();
  await storage.db.goalRecords.update(original.id, { progress: 75 });
  await assert.rejects(useGoalStore.getState().enableSync([original], 'synthetic-goal-account'), /刚刚/);
  assert.equal(await storage.db.outbox.count(), 0);
  await storage.db.goalRecords.put({ ...original, syncScope: 'account' });
  await assert.rejects(useGoalStore.getState().updateProgress(original.id, 100), /刚刚/);
  assert.equal((await storage.db.goalRecords.get(original.id))?.syncScope, 'account');
});

test('goal lifecycle: edit and delete remain durable with manual progress reversed', async () => {
  const row = await useGoalStore.getState().addGoal(goalInput);
  await useGoalStore.getState().updateProgress(row.id, 100);
  await useGoalStore.getState().updateProgress(row.id, 25);
  await useGoalStore.getState().updateGoal(row.id, { title: 'Edited goal', targetDate: '2026-10-30' });
  assert.equal((await storage.db.goalRecords.get(row.id))?.progress, 25);
  await assert.rejects(useGoalStore.getState().updateGoal(row.id, { targetDate: '2026-02-30' }), /有效/);
  await useGoalStore.getState().removeGoal(row.id);
  assert.equal(await storage.db.goalRecords.get(row.id), undefined);
  assert.equal((await storage.db.outbox.orderBy('seq').last())?.op, 'delete');
});

test('goal lifecycle: arbitrary legacy fields remain in recovery copy, never enter upload payload', async () => {
  const original = { ...goalInput, id: 'private-extra-goal-001', createdAt: 1, updatedAt: 2, progress: 25, privateMemo: 'SYNTHETIC_UNSELECTED_PRIVATE_FIELD' };
  await storage.db.goalRecords.put(original);
  await useGoalStore.getState().enableSync([original], 'synthetic-goal-account');
  assert.equal(JSON.stringify((await storage.db.outbox.toArray())[0]?.payload).includes(original.privateMemo), false);
  const backup = (await storage.db.settings.get(`goal-local-copy:${original.id}`))?.value;
  assert.ok(JSON.stringify(backup).includes(original.privateMemo), 'original data stays recoverable locally');
});

test('goal lifecycle: actual old Dexie writes stay isolated and recoverable after upgrade', async () => {
  const { default: Dexie } = await import('dexie');
  const old = new Dexie('youtrace:user:synthetic-upgrade-goal');
  old.version(1).stores({ goals: 'id, level, domain, priority', settings: 'key' });
  await old.open();
  const original = { ...goalInput, id: 'upgrade-goal-001', createdAt: 1, updatedAt: 2, progress: 25 };
  await old.table('goals').put(original);
  const upgraded = new storage.YoujiDatabase('synthetic-upgrade-goal');
  await upgraded.open();
  assert.deepEqual(await upgraded.goalRecords.get(original.id), { ...original, syncScope: 'local' }, 'upgrade preserves source fields without inferring upload permission');
  await old.table('goals').update(original.id, { progress: 100 });
  assert.equal((await old.table('goals').get(original.id)).progress, 100, 'old source is preserved rather than discarded');
  assert.equal((await upgraded.settings.get(`goal-source-snapshot:${original.id}`))?.value && ((await upgraded.settings.get(`goal-source-snapshot:${original.id}`))?.value as { progress: number }).progress, 25);
  assert.equal((await upgraded.goalRecords.get(original.id))?.progress, 25);
  upgraded.close(); old.close();
});

test('goal lifecycle: old source create/edit/delete is previewed, CAS protected and recoverable without upload', async () => {
  const { legacyGoalChanges, resolveLegacyGoalChange } = await import('../src/stores/goalStore.ts');
  const original = { ...goalInput, id: 'source-edit-goal-001', createdAt: 1, updatedAt: 2, progress: 25 };
  await storage.db.goalRecords.put({ ...original, syncScope: 'account' });
  await storage.db.settings.put({ key: `goal-source-snapshot:${original.id}`, value: original });
  const edited = { ...original, progress: 75, privateMemo: 'SYNTHETIC_LOCAL_ONLY' };
  await storage.db.table('goals').put(edited);
  const first = (await legacyGoalChanges())[0];
  assert.equal(first.source?.progress, 75);
  await storage.db.table('goals').put({ ...edited, progress: 100 });
  await assert.rejects(resolveLegacyGoalChange(first, 'copy', 'synthetic-goal-account'), /刚刚变化/);
  const second = (await legacyGoalChanges())[0];
  await resolveLegacyGoalChange(second, 'copy', 'synthetic-goal-account');
  assert.equal((await storage.db.goalRecords.get(original.id))?.progress, 25);
  const copies = (await storage.db.goalRecords.toArray()).filter((row) => row.id !== original.id);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].progress, 100);
  assert.equal(copies[0].syncScope, 'local');
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal((await legacyGoalChanges()).length, 0);
  await storage.db.table('goals').delete(original.id);
  const deleted = (await legacyGoalChanges())[0];
  assert.equal(deleted.source, null);
  await resolveLegacyGoalChange(deleted, 'keep', 'synthetic-goal-account');
  assert.ok(await storage.db.goalRecords.get(original.id));
  assert.equal((await legacyGoalChanges()).length, 0);
  assert.equal((await storage.db.settings.where('key').startsWith('goal-source-recovery:').count()), 2);
  const backup = await storage.exportAllData();
  assert.equal(backup.tables.goals.length, 2);
  assert.ok(JSON.stringify(backup).includes('SYNTHETIC_LOCAL_ONLY'));
  const newOldRow = { ...original, id: 'source-new-goal-002' };
  await storage.db.table('goals').put(newOldRow);
  assert.equal((await legacyGoalChanges())[0].previousSource, null);
});

test('goal lifecycle: interrupted IndexedDB copy rolls back source, destination and metadata together', async () => {
  const { default: Dexie } = await import('dexie');
  const old = new Dexie('youtrace:user:synthetic-goal-upgrade-quota');
  old.version(1).stores({ goals: 'id, level, domain, priority', settings: 'key' });
  await old.open();
  const source = { ...goalInput, id: 'quota-upgrade-goal-001', createdAt: 1, updatedAt: 2, progress: 25, unknownOriginal: 'preserve' };
  await old.table('goals').put(source);
  old.close();
  const upgraded = new storage.YoujiDatabase('synthetic-goal-upgrade-quota');
  const fail = () => { throw new DOMException('synthetic upgrade quota', 'QuotaExceededError'); };
  upgraded.goalRecords.hook('creating', fail);
  await assert.rejects(upgraded.open(), /quota/i);
  const inspect = new Dexie('youtrace:user:synthetic-goal-upgrade-quota');
  await inspect.open();
  assert.equal(inspect.verno, 1);
  assert.deepEqual(await inspect.table('goals').get(source.id), source);
  assert.equal(inspect.tables.some((table) => table.name === 'goalRecords'), false);
  assert.equal(await inspect.table('settings').count(), 0);
  inspect.close(); upgraded.goalRecords.hook('creating').unsubscribe(fail);
  await upgraded.open();
  assert.deepEqual(await upgraded.goalRecords.get(source.id), { ...source, syncScope: 'local' });
  upgraded.close();
});
