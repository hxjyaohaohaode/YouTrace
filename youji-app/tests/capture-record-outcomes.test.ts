import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const capture = await import('../src/services/quickNoteIntegration.ts');
const { commitLocalMutation } = await import('../src/services/localMutation.ts');
const { timelineEntries, timelineTimeLabel } = await import('../src/services/timelineEntries.ts');
const basis = { capturedAt: Date.parse('2026-10-03T15:59:00Z'), timeZone: 'Asia/Shanghai', date: '2026-10-03' };
before(async () => { await storage.bindAccountDatabase('synthetic-capture-owner'); sync.pauseSync(); });
beforeEach(async () => { api.clearSession(); localStorage.clear(); sessionStorage.clear(); await storage.clearAllData({ allowPending: true }); sync.pauseSync(); });
after(() => { sync.pauseSync(); storage.db.close(); });
async function draft(text = '明天要交报销单；午饭15') {
  const input = await capture.forkCaptureInput(); await capture.saveCaptureInput(input, text, basis);
  const value = await capture.createCaptureDraft(text, input, basis); await capture.saveCaptureDraft(value, true); return value;
}
test('fake IDB: reviewed date/currency survive midnight; receipt links actual committed entities exactly once', async () => {
  const value = await draft(); const result = await capture.applyCaptureDraft(value);
  const expenses = await storage.db.expenses.toArray(), todos = await storage.db.todos.toArray();
  assert.equal(expenses[0].date, '2026-10-03'); assert.equal(expenses[0].amount, 1500); assert.equal(todos[0].dueDate, '2026-10-04');
  assert.deepEqual(result.records?.map(row => [row.entity, row.id]), [['quickNotes', value.id], ['expenses', expenses[0].id], ['todos', todos[0].id]]);
  assert.equal((await capture.loadCaptureReceipt(value.id))?.input, value.input);
  const counts = [await storage.db.expenses.count(), await storage.db.todos.count(), await storage.db.outbox.count()];
  assert.deepEqual(await capture.applyCaptureDraft(value), result); assert.deepEqual([await storage.db.expenses.count(), await storage.db.todos.count(), await storage.db.outbox.count()], counts);
  assert.equal((await storage.db.quickNotes.get(value.id))?.captureContext?.capturedAt, basis.capturedAt);
});
test('fake IDB: selection is the actual write boundary; optional emotion remains unknown and excluded extras stay local', async () => {
  const value = await draft('今天很开心；午饭15'); value.expenses[0].confirmed = false; value.diary = null; value.moodConfirmed = false;
  Object.assign(value, { privateMemo: 'SYNTHETIC_LOCAL_ONLY' }); Object.assign(value.expenses[0], { unknownField: 'SYNTHETIC_LOCAL_ONLY' });
  await capture.saveCaptureDraft(value); await capture.applyCaptureDraft(value);
  assert.equal(await storage.db.expenses.count(), 0); assert.equal(await storage.db.diary.count(), 0);
  const note = (await storage.db.quickNotes.get(value.id))!; assert.equal(note.mood, null); assert.equal(note.moodScore, null); assert.deepEqual(note.expenses, []);
  const wire = JSON.stringify(await storage.db.outbox.toArray()); assert.ok(!wire.includes('SYNTHETIC_LOCAL_ONLY'));
  assert.ok(JSON.stringify((await storage.db.settings.get(`capture-source:${value.id}`))?.value).includes('SYNTHETIC_LOCAL_ONLY'));
});
test('fake IDB: an old relative-date review cannot silently become today; explicit no-date can be confirmed', async () => {
  const old = { id: 'synthetic-old-review', input: '明天要交报告', expenses: [], habits: [], todos: [{ id: 'candidate', text: '交报告', confirmed: true }], diary: null, mood: null, moodScore: null };
  const value = capture.upgradeCaptureReview(old); assert.equal(value.context?.date, null); assert.equal(value.todos[0].dueDate, null);
  await assert.rejects(capture.applyCaptureDraft(value), /绝对截止日期/); value.todos[0].dateConfirmed = true;
  await capture.applyCaptureDraft(value); assert.equal((await storage.db.todos.toArray())[0].dueDate, undefined);
});
test('fake IDB: autosave CAS preserves both concurrent review revisions; stale apply cannot consume newer text', async () => {
  const value = await draft(), first = { ...value, diary: 'first choice', diaryDate: basis.date }, second = { ...value, diary: 'second choice', diaryDate: basis.date };
  await capture.saveCaptureDraft(first, true, capture.captureFingerprint(value));
  const secondId = await capture.saveCaptureDraft(second, true, capture.captureFingerprint(value)); assert.notEqual(secondId, value.id);
  assert.equal((await capture.loadCaptureDraft(value.id))?.diary, 'first choice'); assert.equal((await capture.loadCaptureDraft(secondId))?.diary, 'second choice');
  await assert.rejects(capture.applyCaptureDraft(value), capture.CaptureChangedError); assert.equal(await storage.db.quickNotes.count(), 0);
});
test('fake IDB: quota rolls back every record and receipt, preserving original input/review', async () => {
  const value = await draft(); const quota = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); }; storage.db.outbox.hook('creating', quota);
  try { await assert.rejects(capture.applyCaptureDraft(value), /quota/); } finally { storage.db.outbox.hook('creating').unsubscribe(quota); }
  assert.equal(await storage.db.quickNotes.count(), 0); assert.equal(await storage.db.todos.count(), 0); assert.equal(await storage.db.expenses.count(), 0); assert.equal(await capture.loadCaptureReceipt(value.id), null);
  assert.equal((await capture.loadCaptureDraft(value.id))?.input, value.input); assert.equal((await storage.db.settings.get(value.inputKey!))?.value, value.input);
});
test('fake IDB: clear, account revision and logout fence old capture and serial input writes', async () => {
  const input = await capture.forkCaptureInput(), value = await capture.createCaptureDraft('原文', input, basis);
  await storage.clearAllData({ allowPending: true }); await assert.rejects(capture.saveCaptureInput(input, 'late input'), /资料已变化/); await assert.rejects(capture.applyCaptureDraft(value), /版本已变化/);
  const current = await draft(); localStorage.setItem(api.SESSION_REVISION_KEY, 'another-session'); await assert.rejects(capture.applyCaptureDraft(current), /版本已变化/); assert.equal(await storage.db.quickNotes.count(), 0);
});
test('fake IDB: session change inside outbox enqueue rolls business and receipt back atomically', async () => {
  api.setSessionActive('synthetic-capture-owner'); const value = await draft(); const logout = () => api.clearSession(); storage.db.outbox.hook('creating', logout);
  try { await assert.rejects(capture.applyCaptureDraft(value), /账号或本机资料已变化/); } finally { storage.db.outbox.hook('creating').unsubscribe(logout); }
  assert.equal(await storage.db.quickNotes.count(), 0); assert.equal(await storage.db.outbox.count(), 0); assert.equal(await capture.loadCaptureReceipt(value.id), null);
});
test('fake IDB: shared mutation fence also rolls back a logout during enqueue', async () => {
  api.setSessionActive('synthetic-capture-owner'); const row = { id: 'mutation-fence-001', text: 'synthetic', done: false, priority: 'medium' as const };
  const logout = () => api.clearSession(); storage.db.outbox.hook('creating', logout);
  try { await assert.rejects(commitLocalMutation('todos', 'upsert', row, () => storage.db.todos.put(row)), /账号或本机资料已变化/); } finally { storage.db.outbox.hook('creating').unsubscribe(logout); }
  assert.equal(await storage.db.todos.count(), 0); assert.equal(await storage.db.outbox.count(), 0);
});
test('fake IDB: ambiguous same-date diaries and future habit completion cannot make partial records', async () => {
  const value = await draft('原文'); value.diary = '追加'; value.diaryDate = basis.date;
  for (const id of ['diary-first', 'diary-second']) await storage.db.diary.put({ id, date: basis.date, content: id, mood: null, moodScore: null, source: 'manual', quickNoteIds: [], createdAt: 1, updatedAt: 1 });
  await capture.saveCaptureDraft(value); await assert.rejects(capture.applyCaptureDraft(value), /多份日记/); assert.equal(await storage.db.quickNotes.count(), 0);
  await assert.rejects(capture.applyCaptureDraft({ ...value, diary: null, habits: [{ id: 'candidate', name: '阅读', confirmed: true, done: true, date: '2099-01-01' }] }), /打卡日期/);
});
test('timeline semantic evidence: no fake noon/completion, no 60-row cutoff, unknown and exact record links survive', () => {
  const entries = timelineEntries({ expenses: Array.from({ length: 78 }, (_, index) => ({ id: `same-${index}`, name: '同名', amount: 1500 + index, category: 'food', date: '2026-10-03' })), todos: [{ id: 'future-due', text: '已完成', dueDate: '2099-01-01', done: true, priority: 'medium' }], habits: [], checkins: [], diaries: [], schedules: [], notes: [] });
  assert.equal(entries.length, 79); const old = entries.find(row => row.recordId === 'future-due')!; assert.equal(old.date, null); assert.equal(old.occurredAt, null); assert.equal(timelineTimeLabel(old), '时间未知');
  const expense = entries.find(row => row.recordId === 'same-70')!; assert.equal(expense.occurredAt, null); assert.equal(expense.route, '/expense?record=same-70'); assert.equal(timelineTimeLabel(expense), '日期记录');
  assert.equal(timelineTimeLabel({ ...old, occurredAt: Date.now() + 60_000 }), '时间待核对');
});

test('fake IDB: actor change in the final receipt write rolls all side effects back', async () => {
  api.setSessionActive('synthetic-capture-owner'); const value = await draft();
  const logout = (_key: unknown, row: { key?: string }) => { if (row.key === `capture-applied:${value.id}`) api.clearSession(); }; storage.db.settings.hook('creating', logout);
  try { await assert.rejects(capture.applyCaptureDraft(value), /账号或本机资料已变化/); } finally { storage.db.settings.hook('creating').unsubscribe(logout); }
  assert.equal(await storage.db.quickNotes.count(), 0); assert.equal(await storage.db.outbox.count(), 0);
});
test('fake IDB: explicitly opening a legacy review binds its epoch; clear cannot revive the old preview', async () => {
  const value = { id: 'unbound-old-review', input: 'old source', expenses: [], habits: [], todos: [], diary: null, mood: null, moodScore: null };
  await storage.db.settings.put({ key: `capture-review:${value.id}`, value }); const opened = (await capture.loadCaptureDraft(value.id))!;
  assert.equal(opened.ownerId, storage.db.ownerId); assert.ok(opened.dataEpoch); assert.deepEqual((await storage.db.settings.get(`capture-unbound-source:${value.id}`))?.value, value);
  await storage.clearAllData({ allowPending: true }); await assert.rejects(capture.applyCaptureDraft(opened), /版本已变化/); assert.equal(await storage.db.quickNotes.count(), 0);
});
test('fake IDB: malformed selected leaf cannot leak through parsed JSON; normalization matches visible category', async () => {
  const value = await draft(); Object.assign(value.expenses[0], { id: { privateMemo: 'SYNTHETIC_HIDDEN' } });
  await assert.rejects(capture.applyCaptureDraft(value), /编号格式/); assert.equal(await storage.db.outbox.count(), 0);
  value.expenses[0].id = 'candidate'; value.expenses[0].category = 'unknown-legacy-category'; await capture.saveCaptureDraft(value); await capture.applyCaptureDraft(value);
  assert.equal((await storage.db.quickNotes.get(value.id))?.expenses[0].category, 'other');
});
test('fake IDB: correcting an old record keeps unknown source fields locally and sends only known scalar fields', async () => {
  const { useExpenseStore } = await import('../src/stores/expenseStore.ts');
  const row = { id: 'legacy-expense-fields', name: 'Synthetic old', amount: 100, category: 'food', date: basis.date, privateMemo: 'SYNTHETIC_NOT_CHOSEN' }; await storage.db.expenses.put(row); await useExpenseStore.getState().loadFromDB();
  await useExpenseStore.getState().updateItem(row.id, { name: 'Edited' }, row);
  assert.equal((await storage.db.expenses.get(row.id) as typeof row).privateMemo, row.privateMemo);
  assert.ok(!JSON.stringify(await storage.db.outbox.toArray()).includes(row.privateMemo));
});

test('fake IDB: unsafe frozen request stays byte-identical with zero send, while known legacy timestamps remain valid', async () => {
  const { isSafeFrozenPayload } = await import('../src/services/recordPayloads.ts');
  const safe = { protocol: 2, mutationId: 'frozen-legacy-safe', todos: [{ id: 'legacy-safe-todo', text: 'Synthetic', done: false, priority: 'medium', createdAt: 1, updatedAt: 2, baseVersion: '0' }] };
  assert.equal(isSafeFrozenPayload(safe), true);
  const body = { protocol: 2, mutationId: 'frozen-sensitive-001', expenses: [{ id: 'frozen-old-expense', name: 'Synthetic', amount: 100, category: 'food', date: basis.date, baseVersion: '0', privateMemo: 'SYNTHETIC_UNREVIEWED' }] };
  const seq = await storage.db.outbox.add({ entity: 'expenses', op: 'upsert', payload: body.expenses[0], queuedAt: 1 });
  const frozen = { mutationId: body.mutationId, payload: body, keys: ['expenses:frozen-old-expense'], seqs: [seq] }; await storage.db.settings.put({ key: 'syncV2Batch', value: frozen });
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({}); }; api.setSessionActive('synthetic-capture-owner');
  await sync.retryBlockedSync(); assert.equal(calls, 0); assert.deepEqual((await storage.db.settings.get('syncV2Batch'))?.value, frozen); assert.equal(await storage.db.outbox.count(), 1); assert.ok(await storage.db.settings.get('syncV2LocalBlock'));
});
