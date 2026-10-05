import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { location: { replace() {} } }) });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { useScheduleStore: store, expandRecurringForRange, schedulePayload } = await import('../src/stores/scheduleStore.ts');
const drafts = await import('../src/components/schedule/scheduleDraft.ts');
const actor = await import('../src/services/localActor.ts');
const todoDrafts = await import('../src/components/todo/todoDraft.ts');
const expenseDrafts = await import('../src/components/expense/expenseDraft.ts');
const { commitLocalMutation } = await import('../src/services/localMutation.ts');
const owner = 'synthetic-schedule-outcomes';
const input = { title: 'Synthetic work', date: '2026-10-06', startTime: '09:00', endTime: '10:00', location: 'Original place', type: 'work' as const, repeat: 'weekly' as const, remind: 0 };
before(async () => { await storage.bindAccountDatabase(owner); });
beforeEach(async () => { localStorage.clear(); api.setSessionActive(owner); sync.pauseSync(); await storage.clearAllData({ allowPending: true }); store.setState({ items: [], loaded: false }); });
after(() => { sync.pauseSync(); api.clearSession(); storage.db.close(); });

test('full-day records and future weekly occurrences retain canonical source snapshots', async () => {
  const original = await store.getState().addItem(input);
  await store.getState().addItem({ ...input, repeat: 'none', startTime: '06:15', endTime: '06:45' });
  await store.getState().addItem({ ...input, repeat: 'none', startTime: '23:15', endTime: '23:45' });
  assert.deepEqual(store.getState().getItemsByDate(input.date).map(row => row.startTime), ['06:15', '09:00', '23:15']);
  const occurrence = store.getState().getItemsByDate('2026-10-13')[0];
  assert.equal(occurrence.date, '2026-10-13'); assert.equal(occurrence.occurrenceDate, '2026-10-13'); assert.deepEqual(occurrence.source, original);
  assert.equal(store.getState().getItemsByDate('2026-09-29').length, 0);
});

test('single occurrence move/cancel preserves series, follows moved range, and shares canonical CAS', async () => {
  const original = await store.getState().addItem(input);
  const updated = await store.getState().updateOccurrence(original, '2026-10-13', { ...input, date: '2026-10-15', startTime: '12:15', endTime: '13:15', location: 'Only this place' });
  assert.equal(updated.date, original.date); assert.equal(updated.startTime, original.startTime);
  assert.equal(expandRecurringForRange([updated], '2026-10-13', '2026-10-13').length, 0);
  const moved = expandRecurringForRange([updated], '2026-10-15', '2026-10-15')[0]; assert.equal(moved.location, 'Only this place'); assert.equal(moved.occurrenceDate, '2026-10-13');
  assert.equal(expandRecurringForRange([updated], '2026-10-20', '2026-10-20')[0].location, original.location);
  await assert.rejects(store.getState().updateOccurrence(original, '2026-10-20', { ...input }), /刚刚/);
  await assert.rejects(store.getState().updateItem(updated.id, { date: '2026-10-07' }, updated), /已有单次/);
  const cancelled = await store.getState().updateOccurrence(updated, '2026-10-13', { ...input, date: '2026-10-15', cancelled: true });
  assert.equal(expandRecurringForRange([cancelled], '2026-10-15', '2026-10-15').length, 0);
  await assert.rejects(store.getState().updateOccurrence(cancelled, '2026-10-14', { ...input }), /未找到/);
});

test('opened stale schedule cannot overwrite/delete peer even after store refresh or resurrect absent source', async () => {
  const opened = await store.getState().addItem(input);
  const peer = { ...opened, title: 'Peer title', location: 'Peer place', unknownProof: { private: true } };
  await storage.db.schedules.put(peer); await store.getState().loadFromDB();
  const count = await storage.db.outbox.count();
  await assert.rejects(store.getState().updateItem(opened.id, { title: 'stale' }, opened), /刚刚/);
  await assert.rejects(store.getState().removeItem(opened.id, opened), /刚刚/);
  assert.deepEqual(await storage.db.schedules.get(opened.id), peer); assert.equal(await storage.db.outbox.count(), count);
  const updated = await store.getState().updateItem(peer.id, { title: 'Reviewed' }, peer);
  assert.deepEqual((updated as typeof peer).unknownProof, peer.unknownProof); assert.equal('unknownProof' in schedulePayload(updated), false);
  await storage.db.schedules.delete(opened.id); await store.getState().loadFromDB();
  await assert.rejects(store.getState().updateItem(opened.id, { title: 'resurrect' }, updated), /刚刚/);
  await assert.rejects(store.getState().updateItem(opened.id, { title: 'missing' }), /不存在/);
});

test('storage write failure retains exact schedule, draft and outbox for one retry', async () => {
  const row = await store.getState().addItem(input), opened = await drafts.openScheduleDraft(row.id);
  const context = await drafts.saveScheduleDraft(opened.context, { title: 'Not yet saved', base: row });
  const originalDraft = await storage.db.settings.get(context.key), count = await storage.db.outbox.count();
  const fault = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', fault);
  try { await assert.rejects(store.getState().updateItem(row.id, { title: 'Not yet saved' }, row, context), /quota/); } finally { storage.db.outbox.hook('creating').unsubscribe(fault); }
  assert.deepEqual(await storage.db.schedules.get(row.id), row); assert.deepEqual(await storage.db.settings.get(context.key), originalDraft); assert.equal(await storage.db.outbox.count(), count);
  await store.getState().updateItem(row.id, { title: 'Not yet saved' }, row, context); assert.equal(await storage.db.settings.get(context.key), undefined); assert.equal(await storage.db.outbox.count(), count + 1);
});

test('last awaited epoch read catches logout, owner replacement and same-owner reauthentication', async () => {
  const row = await store.getState().addItem(input), count = await storage.db.outbox.count();
  for (const change of [() => api.clearSession(), () => api.setSessionActive('another-owner'), () => { api.clearSession(); api.setSessionActive(owner); }]) {
    api.setSessionActive(owner); const original = storage.db.settings.get; let epochs = 0;
    storage.db.settings.get = (function (key: string) { return original.call(storage.db.settings, key).then(value => { if (key === storage.LOCAL_DATA_EPOCH_KEY && ++epochs === 3) change(); return value; }); }) as typeof original;
    try { await assert.rejects(store.getState().updateItem(row.id, { title: 'Late write' }, row), /账号/); } finally { storage.db.settings.get = original; }
    assert.deepEqual(await storage.db.schedules.get(row.id), row); assert.equal(await storage.db.outbox.count(), count);
  }
});

test('late schedule load after clear cannot republish erased rows', async () => {
  const row = await store.getState().addItem(input), original = storage.db.schedules.toArray;
  let release: (() => void) | undefined, entered: (() => void) | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  storage.db.schedules.toArray = (() => original.call(storage.db.schedules).then(async rows => { entered!(); await new Promise<void>(resolve => { release = resolve; }); return rows; })) as typeof original;
  const loading = store.getState().loadFromDB(); await started; await storage.clearAllData({ allowPending: true }); store.setState({ items: [] }); release!();
  try { await assert.rejects(loading, /已变化/); } finally { storage.db.schedules.toArray = original; }
  assert.equal(await storage.db.schedules.get(row.id), undefined); assert.deepEqual(store.getState().items, []);
});

test('draft final put-hook logout rolls back every supported editor draft', async () => {
  for (const [open, save] of [[todoDrafts.openTodoDraft, todoDrafts.saveTodoDraft], [expenseDrafts.openExpenseDraft, expenseDrafts.saveExpenseDraft], [drafts.openScheduleDraft, drafts.saveScheduleDraft]] as const) {
    api.setSessionActive(owner); const { context } = await open('synthetic-draft');
    const fault = (_key: unknown, value: { key: string }) => { if (value.key === context.key) api.clearSession(); };
    storage.db.settings.hook('creating', fault);
    try { await assert.rejects(save(context, { text: 'private draft' }), /账号/); } finally { storage.db.settings.hook('creating').unsubscribe(fault); }
    assert.equal(await storage.db.settings.get(context.key), undefined);
  }
});

test('mismatched verified owner rejects new local mutation before any business write', async () => {
  api.setSessionActive('other-verified-owner');
  await assert.rejects(commitLocalMutation('schedules', 'upsert', { id: 'do-not-write' }, () => storage.db.schedules.put({ ...input, id: 'do-not-write', createdAt: 1, updatedAt: 1 })), /账号/);
  assert.equal(await storage.db.schedules.count(), 0);
  api.setSessionActive(owner); const captured = await actor.readLocalActor(); api.clearSession(); api.setSessionActive(owner); await assert.rejects(actor.assertLocalActor(captured), /账号/);
});

test('schedule storage failure copy gives a Chinese remedy without exposing raw engine errors', async () => {
  const { scheduleFailureMessage } = await import('../src/components/schedule/scheduleErrors.ts');
  const quota = scheduleFailureMessage(new DOMException('raw quota', 'QuotaExceededError'), true);
  assert.ok(quota.includes('删除失败')); assert.ok(quota.includes('存储空间不足')); assert.ok(quota.includes('输入仍保留')); assert.equal(quota.includes('QuotaExceededError'), false);
  assert.equal(scheduleFailureMessage(new Error('raw native engine unavailable')).includes('raw native'), false);
  assert.ok(scheduleFailureMessage(new Error('记录刚刚更新，请核对')).includes('记录刚刚更新，请核对'));
});
