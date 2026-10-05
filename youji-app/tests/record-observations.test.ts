import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
const values = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }, window: Object.assign(new EventTarget(), { location: { replace() {} }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }), document: { documentElement: { setAttribute() {} } } });
const storage = await import('../src/db/index.ts');
const session = await import('../src/services/apiClient.ts');
const { readRecordObservations, setObservationHidden, observationChoiceKey, observationPeriod, expenseObservationRows, whileObservationVisible, assertObservationDeliveryCurrent } = await import('../src/services/recordObservations.ts');
const today = '2026-10-05';
const expense = (id: string, date: string, amount: number, isIncome = false) => ({ id, date, name: `Synthetic ${id}`, amount, category: isIncome ? 'income' : 'food', isIncome });
before(async () => { await storage.bindAccountDatabase('synthetic-observation'); });
beforeEach(async () => { await storage.clearAllData({ allowPending: true }); session.setSessionActive('synthetic-observation'); await storage.db.expenses.bulkPut([expense('current', '2026-10-04', 5025), expense('previous', '2026-09-25', 2010), expense('income', '2026-10-03', 90000, true)]); });
after(() => { session.clearSession(); storage.db.close(); });

test('exact two-period cents, IDs, denominator and income exclusion derive from real records', async () => {
  const view = await readRecordObservations(storage.db, today);
  assert.deepEqual(view.period, { start: '2026-09-29', end: today, previousStart: '2026-09-22', previousEnd: '2026-09-28' });
  assert.equal(view.currentFen, 5025); assert.equal(view.previousFen, 2010); assert.equal(view.percent, 150);
  assert.deepEqual(view.current.map(row => row.id), ['current']); assert.deepEqual(view.previous.map(row => row.id), ['previous']); assert.deepEqual(view.income.map(row => row.id), ['income']);
  assert.equal(view.current[0].syncStatus, '本机已保存，云端确认未知');
});
test('content and valid sync versions change the current evidence without trusting updatedAt', async () => {
  const before = await readRecordObservations(storage.db, today);
  await storage.db.expenses.update('current', { amount: 4025 });
  await storage.db.settings.put({ key: 'sync-version:expenses:current', value: '5' });
  const after = await readRecordObservations(storage.db, today);
  assert.notEqual(after.signature, before.signature); assert.equal(after.currentFen, 4025); assert.equal(after.current[0].version, '5');
  assert.equal(after.current[0].syncStatus, '已收到云端版本确认'); assert.equal(Math.round(after.percent!), 100); assert.ok(after.percent! > 100 && after.percent! < 101);
  assert.equal(before.currentFen, 5025); assert.equal(before.percent, 150);
  await storage.db.outbox.add({ entity: 'expenses', op: 'upsert', payload: { id: 'current' }, queuedAt: Date.now(), status: 'pending' });
  assert.equal((await readRecordObservations(storage.db, today)).current[0].syncStatus, '本机修改等待云端确认');
  await storage.db.settings.put({ key: 'sync-conflict:expenses:current', value: { synthetic: true } });
  assert.equal((await readRecordObservations(storage.db, today)).current[0].syncStatus, '有版本冲突，需要比较');
});
test('same-period device hide survives source correction; explicit restore is compare-and-swap', async () => {
  const old = await readRecordObservations(storage.db, today); await setObservationHidden(old, 'spending-comparison', true);
  await storage.db.expenses.update('current', { amount: 4025 });
  const hidden = await readRecordObservations(storage.db, today); assert.equal(hidden.choices['spending-comparison'].hidden, true);
  await assert.rejects(setObservationHidden(old, 'spending-comparison', false), /刚有更新/);
  await setObservationHidden(hidden, 'spending-comparison', false); assert.equal((await readRecordObservations(storage.db, today)).choices['spending-comparison'].hidden, false);
});
test('a known local historical dismissal in this period is inherited without changing old history', async () => {
  const row = { id: 'old-local', type: 'suggestion' as const, title: '按适合你的节奏记录', description: 'synthetic original', dataSources: ['expense'], dismissed: true, significance: 0.7, createdAt: Date.parse(`${today}T10:00:00+08:00`), origin: 'local' as const };
  await storage.db.coachInsights.put(row); const snapshot = await readRecordObservations(storage.db, today);
  assert.equal(snapshot.choices['record-rhythm'].hidden, true); await setObservationHidden(snapshot, 'record-rhythm', false);
  assert.deepEqual(await storage.db.coachInsights.get(row.id), row); assert.equal((await readRecordObservations(storage.db, today)).choices['record-rhythm'].hidden, false);
});
test('signout, owner changes and clear epoch reject late choices without new settings', async () => {
  const snapshot = await readRecordObservations(storage.db, today), key = observationChoiceKey('record-rhythm', snapshot.period);
  session.setSessionActive('synthetic-other'); await assert.rejects(setObservationHidden(snapshot, 'record-rhythm', true), /账号/); assert.equal(await storage.db.settings.get(key), undefined);
  session.setSessionActive('synthetic-observation'); await storage.db.settings.put({ key: storage.LOCAL_DATA_EPOCH_KEY, value: 'new-epoch' });
  await assert.rejects(setObservationHidden(snapshot, 'record-rhythm', true), /资料/); assert.equal(await storage.db.settings.get(key), undefined);
});
test('session loss during final write rolls back the entire choice', async () => {
  const snapshot = await readRecordObservations(storage.db, today), key = observationChoiceKey('record-rhythm', snapshot.period);
  const logout = (_key: string, value: { key: string }) => { if (value.key === key) session.clearSession(); };
  storage.db.settings.hook('creating', logout);
  try { await assert.rejects(setObservationHidden(snapshot, 'record-rhythm', true), /账号/); } finally { storage.db.settings.hook('creating').unsubscribe(logout); }
  assert.equal(await storage.db.settings.get(key), undefined);
});
test('invalid amounts/dates and malformed choices fail visibly without fabricated zeros', async () => {
  assert.throws(() => expenseObservationRows([expense('bad', today, 12.3)], observationPeriod(today)), /字段/);
  assert.throws(() => expenseObservationRows([expense('bad', '2026-02-30', 1230)], observationPeriod(today)), /日期/);
  const key = observationChoiceKey('record-rhythm', observationPeriod(today)); await storage.db.settings.put({ key, value: { version: 1, revision: 1, hidden: 'false' } });
  await assert.rejects(readRecordObservations(storage.db, today), /偏好/); assert.deepEqual((await storage.db.settings.get(key))?.value, { version: 1, revision: 1, hidden: 'false' });
});

for (const operation of ['read', 'write'] as const) test(`logout during final awaited epoch read rejects ${operation}`, async () => {
  const snapshot = await readRecordObservations(storage.db, today), original = storage.db.settings.get;
  let epochs = 0;
  storage.db.settings.get = (function (key: string) { return original.call(storage.db.settings, key).then(row => { if (key === storage.LOCAL_DATA_EPOCH_KEY && ++epochs === 2) session.clearSession(); return row; }); }) as typeof original;
  try { await assert.rejects(operation === 'read' ? readRecordObservations(storage.db, today) : setObservationHidden(snapshot, 'record-rhythm', true), /账号|变化/); }
  finally { storage.db.settings.get = original; }
  assert.equal(await storage.db.settings.get(observationChoiceKey('record-rhythm', snapshot.period)), undefined);
});
test('Home and source evidence both exclude explicit income category when old isIncome is false', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-05T06:00:00Z') });
  await storage.db.expenses.put({ ...expense('legacy-income', today, 50000), category: 'income', isIncome: false });
  const { computeWeeklyStats } = await import('../src/services/lifeIntelligence.ts');
  const statistics = await computeWeeklyStats(), evidence = await readRecordObservations(storage.db, today);
  assert.equal(statistics.expenseTotalFen, evidence.currentFen); assert.equal(statistics.lastWeekExpenseTotalFen, evidence.previousFen);
});


test('a Home snapshot read before another tab hides cannot create the managed insight later', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-05T06:00:00Z') });
  const old = await readRecordObservations(storage.db, today);
  await setObservationHidden(old, 'record-rhythm', true);
  let called = false;
  assert.equal(await whileObservationVisible(old, 'record-rhythm', async () => { called = true; return 'created'; }), null);
  assert.equal(called, false); assert.equal(await storage.db.coachInsights.count(), 0);
});
test('generation may win first, but a later hide prevents delivery without deleting the old snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-05T06:00:00Z') });
  const old = await readRecordObservations(storage.db, today);
  const { useCoachStore } = await import('../src/stores/coachStore.ts');
  const created = await whileObservationVisible(old, 'record-rhythm', () => useCoachStore.getState().addInsight({ type: 'suggestion', title: '按适合你的节奏记录', description: 'Synthetic immutable evidence', dataSources: ['expense'], dismissed: false, significance: 0.7 }));
  assert.ok(created); await setObservationHidden(await readRecordObservations(storage.db, today), 'record-rhythm', true);
  let delivered = false; assert.equal(await whileObservationVisible(old, 'record-rhythm', async () => { delivered = true; return 'delivered'; }), null);
  assert.equal(delivered, false); assert.deepEqual(await storage.db.coachInsights.get(created.id), created);
});


test('managed reminder validates the session after outer budget writes and rolls back memory too', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-05T06:00:00Z') });
  const settings = await import('../src/stores/settingsStore.ts');
  const { useCoachStore } = await import('../src/stores/coachStore.ts');
  const { deliverControlledPush } = await import('../src/services/pushControl.ts');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ protocol: 1, revision: '0', settings: { coachStyle: 'gentle', coachPushEnabled: true, pushLimit: 4, quietEnabled: false, quietStart: '23:00', quietEnd: '07:00', eveningReviewEnabled: true, eveningReviewTime: '21:00' } });
  await settings.useSettingsStore.getState().loadSettings(); await settings.useSettingsStore.getState().syncPreferences();
  assert.equal((await settings.readPersistedReminderSettings()).coachPushEnabled, true, 'Real preference verification is required before this delivery probe');
  useCoachStore.setState({ pushes: [] });
  const snapshot = await readRecordObservations(storage.db, today), marker = 'synthetic-final-delivery', key = `pushDelivery:follow_up:${marker}`;
  let hit = 0;
  const logout = (_key: string, value: { key: string }) => { if (value.key === key) { hit += 1; session.clearSession(); } };
  storage.db.settings.hook('creating', logout);
  try {
    await assert.rejects(deliverControlledPush('follow_up', marker, async () => await whileObservationVisible(snapshot, 'record-rhythm', () => useCoachStore.getState().addPush({ type: 'follow_up', title: '按适合你的节奏记录', body: 'Synthetic source', actions: [], read: false, acted: false })) !== null, () => assertObservationDeliveryCurrent(snapshot)), /账号|变化/);
  } finally { storage.db.settings.hook('creating').unsubscribe(logout); settings.stopPreferenceSync(); globalThis.fetch = previousFetch; }
  assert.equal(hit, 1, 'Final write hook must actually execute');
  assert.equal(await storage.db.coachPushes.count(), 0); assert.equal(await storage.db.settings.get(key), undefined); assert.equal(await storage.db.settings.get('pushControlCount'), undefined); assert.equal(useCoachStore.getState().pushes.length, 0);
});
