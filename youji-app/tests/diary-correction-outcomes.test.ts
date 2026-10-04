import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { DiaryRecord } from '../src/db/index.ts';
import type { DiaryForm } from '../src/components/diary/diaryDraft.ts';
const memoryStorage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; };
Object.assign(globalThis, { localStorage: memoryStorage(), sessionStorage: memoryStorage(), window: Object.assign(new EventTarget(), { location: { replace() {} } }) });
const storage = await import('../src/db/index.ts');
const sync = await import('../src/services/syncEngine.ts');
const api = await import('../src/services/apiClient.ts');
const { useDiaryStore, DiaryDateConflict, sameDiarySnapshot } = await import('../src/stores/diaryStore.ts');
const drafts = await import('../src/components/diary/diaryDraft.ts');
const input = { date: '2026-10-01', content: 'SYNTHETIC diary original', mood: null, moodScore: null, source: 'manual' as const, quickNoteIds: [] };
const formOf = (row: DiaryRecord): DiaryForm => ({ id: row.id, date: row.date, content: row.content, mood: row.mood, moodScore: row.moodScore, base: row });
const newForm = (patch: Partial<DiaryForm> = {}): DiaryForm => ({ ...input, id: 'synthetic-draft-id', base: null, ...patch });
before(async () => { await storage.bindAccountDatabase('synthetic-diary-correction'); sync.pauseSync(); });
beforeEach(async () => {
  localStorage.removeItem(api.SIGNED_OUT_KEY); localStorage.removeItem(api.SESSION_REVISION_KEY); api.clearSession();
  await storage.db.diary.clear(); await storage.db.settings.clear(); await storage.db.outbox.clear();
  useDiaryStore.setState({ items: [], loaded: false, loadError: '' }); await useDiaryStore.getState().loadFromDB();
});
after(() => { sync.pauseSync(); storage.db.close(); });

test('Exact old Diary correction preserves ID, unknown creation time and source evidence; omitted mood remains null', async () => {
  const first: DiaryRecord = { ...input, id: 'synthetic-old', createdAt: 0, updatedAt: 0, source: 'quicknote_aggregated', quickNoteIds: ['synthetic-source'] };
  const neighbor: DiaryRecord = { ...first, id: 'synthetic-neighbor', date: '2026-10-02' };
  await storage.db.diary.bulkAdd([first, neighbor]); await useDiaryStore.getState().loadFromDB();
  const opened = await drafts.openDiaryDraft(first.id);
  const context = await drafts.saveDiaryDraft(opened.context, { ...formOf(first), content: 'SYNTHETIC corrected content' });
  const saved = await useDiaryStore.getState().updateItem(first.id, { content: 'SYNTHETIC corrected content' }, first, context);
  assert.equal(saved.id, first.id); assert.equal(saved.date, first.date); assert.equal(saved.createdAt, 0);
  assert.equal(saved.source, first.source); assert.deepEqual(saved.quickNoteIds, first.quickNoteIds);
  assert.equal(saved.mood, null); assert.equal(saved.moodScore, null); assert.deepEqual(await storage.db.diary.get(neighbor.id), neighbor);
  assert.equal(await storage.db.settings.get(context.key), undefined);
  const payload = (await storage.db.outbox.orderBy('seq').last())?.payload as DiaryRecord;
  assert.equal(payload.mood, null); assert.equal(payload.moodScore, null); assert.equal(payload.date, first.date);
});

test('Explicit valid date and mood correction persists, and clearing mood explicitly clears the wire score', async () => {
  const first = await useDiaryStore.getState().addItem(input);
  const updated = await useDiaryStore.getState().updateItem(first.id, { date: '2026-09-30', mood: 'happy', moodScore: 8 }, first);
  assert.equal(updated.date, '2026-09-30'); assert.equal(updated.moodScore, 8);
  const cleared = await useDiaryStore.getState().updateItem(first.id, { mood: null, moodScore: null }, updated);
  assert.equal(cleared.moodScore, null);
  assert.equal(((await storage.db.outbox.orderBy('seq').last())?.payload as DiaryRecord).mood, null);
  await assert.rejects(useDiaryStore.getState().updateItem(first.id, { date: '2026-02-30' }, cleared), /日期/);
  await assert.rejects(useDiaryStore.getState().updateItem(first.id, { mood: 'happy', moodScore: 11 }, cleared), /评分/);
  await assert.rejects(useDiaryStore.getState().updateItem(first.id, { mood: 'happy', moodScore: 7.5 }, cleared), /评分/);
  await assert.rejects(useDiaryStore.getState().updateItem(first.id, { content: ' ' }, cleared), /内容/);
  assert.deepEqual(await storage.db.diary.get(first.id), cleared);
});

test('Existing same-day Diary rejects a new source and a moved date without consuming either draft or overwriting content', async () => {
  const first = await useDiaryStore.getState().addItem(input);
  const opened = await drafts.openDiaryDraft('new');
  const context = await drafts.saveDiaryDraft(opened.context, newForm());
  const count = await storage.db.outbox.count();
  await assert.rejects(useDiaryStore.getState().addItem({ ...input, content: 'SYNTHETIC second source' }, context), (reason: unknown) => reason instanceof DiaryDateConflict && reason.records[0].id === first.id);
  assert.deepEqual(await storage.db.diary.get(first.id), first); assert.equal(await storage.db.diary.count(), 1);
  assert.equal(await storage.db.outbox.count(), count); assert.ok(await storage.db.settings.get(context.key));
  const other = await useDiaryStore.getState().addItem({ ...input, date: '2026-10-02' });
  await assert.rejects(useDiaryStore.getState().updateItem(other.id, { date: first.date }, other), DiaryDateConflict);
  assert.deepEqual(await storage.db.diary.get(other.id), other);
});

test('Legacy duplicated date stops precise correction and returns all other source rows without rewriting the date', async () => {
  const rows = ['synthetic-duplicate-1', 'synthetic-duplicate-2', 'synthetic-duplicate-3'].map((id) => ({ ...input, id, createdAt: 0, updatedAt: 0 }));
  await storage.db.diary.bulkAdd(rows); await useDiaryStore.getState().loadFromDB();
  await assert.rejects(useDiaryStore.getState().updateItem(rows[0].id, { content: 'edited duplicate source' }, rows[0]), (reason: unknown) => reason instanceof DiaryDateConflict && reason.records.length === 2);
  assert.deepEqual(await storage.db.diary.toArray(), rows); assert.equal(await storage.db.outbox.count(), 0);
});

test('Stale Diary CAS checks the complete snapshot including newly added metadata, and cannot resurrect deletion', async () => {
  const row = await useDiaryStore.getState().addItem(input);
  const newer = { ...row, sourceProof: 'SYNTHETIC proof' };
  await storage.db.diary.put(newer);
  assert.equal(sameDiarySnapshot(newer, row), false);
  await assert.rejects(useDiaryStore.getState().updateItem(row.id, { content: 'stale replacement' }, row), /刚刚/);
  await assert.rejects(useDiaryStore.getState().removeItem(row.id, row), /刚刚/);
  assert.deepEqual(await storage.db.diary.get(row.id), newer);
  await useDiaryStore.getState().loadFromDB(); await useDiaryStore.getState().removeItem(row.id, newer);
  await assert.rejects(useDiaryStore.getState().updateItem(row.id, { content: 'resurrection' }, newer));
  assert.equal(await storage.db.diary.get(row.id), undefined);
});

test('Cancelled edits remain durable on reopening with base snapshot for explicit stale comparison', async () => {
  const row = await useDiaryStore.getState().addItem(input);
  const opened = await drafts.openDiaryDraft(row.id);
  const edited = { ...formOf(row), content: 'SYNTHETIC cancelled input', date: '2026-09-30', mood: 'happy', moodScore: 8 };
  await drafts.saveDiaryDraft(opened.context, edited); // Cancel waits for this durable result and does not commit the row.
  assert.deepEqual(await storage.db.diary.get(row.id), row);
  assert.deepEqual((await drafts.openDiaryDraft(row.id)).value, edited);
  const latest = await useDiaryStore.getState().updateItem(row.id, { content: 'SYNTHETIC concurrent revision' }, row);
  const restored = await drafts.openDiaryDraft(row.id);
  assert.equal(sameDiarySnapshot(latest, restored.value!.base!), false);
  await assert.rejects(useDiaryStore.getState().updateItem(row.id, { content: edited.content }, restored.value!.base!, restored.context), /刚刚/);
  assert.deepEqual((await drafts.openDiaryDraft(row.id)).value, edited);
});

test('Quota during atomic Diary save keeps original row, outbox and exact draft; retry consumes only that revision', async () => {
  const row = await useDiaryStore.getState().addItem(input);
  const opened = await drafts.openDiaryDraft(row.id);
  const context = await drafts.saveDiaryDraft(opened.context, { ...formOf(row), content: 'SYNTHETIC after quota' });
  const draftBefore = await storage.db.settings.get(context.key); const count = await storage.db.outbox.count();
  const fail = () => { throw new DOMException('SYNTHETIC quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', fail);
  try { await assert.rejects(useDiaryStore.getState().updateItem(row.id, { content: 'SYNTHETIC after quota' }, row, context), /quota/); }
  finally { storage.db.outbox.hook('creating').unsubscribe(fail); }
  assert.deepEqual(await storage.db.diary.get(row.id), row); assert.deepEqual(await storage.db.settings.get(context.key), draftBefore); assert.equal(await storage.db.outbox.count(), count);
  await useDiaryStore.getState().updateItem(row.id, { content: 'SYNTHETIC after quota' }, row, context);
  assert.equal(await storage.db.settings.get(context.key), undefined); assert.equal(await storage.db.outbox.count(), count + 1);
});

test('Quota retaining a draft rejects durability confirmation, preserves prior durable draft, and can retry the same input', async () => {
  const first = await drafts.openDiaryDraft('new'); const saved = await drafts.saveDiaryDraft(first.context, newForm());
  const fail = () => { throw new DOMException('SYNTHETIC draft quota', 'QuotaExceededError'); };
  storage.db.settings.hook('updating', fail);
  try { await assert.rejects(drafts.saveDiaryDraft(saved, newForm({ content: 'SYNTHETIC visible uncommitted input' })), /quota/); }
  finally { storage.db.settings.hook('updating').unsubscribe(fail); }
  assert.deepEqual((await drafts.openDiaryDraft('new')).value, newForm());
  await drafts.saveDiaryDraft(saved, newForm({ content: 'SYNTHETIC visible uncommitted input' }));
  assert.equal((await drafts.openDiaryDraft('new')).value?.content, 'SYNTHETIC visible uncommitted input'); assert.equal(await storage.db.diary.count(), 0);
});

test('A newer tab draft cannot be overwritten or consumed by stale save, and unrelated drafts survive commit', async () => {
  const row = await useDiaryStore.getState().addItem(input);
  const first = await drafts.openDiaryDraft(row.id); const second = await drafts.openDiaryDraft(row.id);
  const latest = await drafts.saveDiaryDraft(first.context, { ...formOf(row), content: 'new tab draft' });
  await assert.rejects(drafts.saveDiaryDraft(second.context, formOf(row)), /另一页/);
  await assert.rejects(useDiaryStore.getState().updateItem(row.id, { content: 'stale draft' }, row, second.context), /草稿/);
  const other = await drafts.openDiaryDraft('new'); await drafts.saveDiaryDraft(other.context, newForm());
  await useDiaryStore.getState().updateItem(row.id, { content: 'new tab draft' }, row, latest);
  assert.equal((await drafts.openDiaryDraft('new')).value?.content, input.content);
});

test('Clear epoch, account handle, session revision and sign-out fence old Diary draft and business writes', async () => {
  const opened = await drafts.openDiaryDraft('new'); const context = await drafts.saveDiaryDraft(opened.context, newForm());
  await storage.clearAllData({ allowPending: true });
  await assert.rejects(drafts.saveDiaryDraft(context, newForm()), /已变化/);
  await assert.rejects(useDiaryStore.getState().addItem(input, context), /已变化/);
  assert.equal(await storage.db.diary.count(), 0); assert.equal(await storage.db.outbox.count(), 0);
  const current = await drafts.openDiaryDraft('new');
  localStorage.setItem(api.SESSION_REVISION_KEY, 'SYNTHETIC changed session');
  await assert.rejects(drafts.saveDiaryDraft(current.context, newForm()), /已变化/);
  await assert.rejects(useDiaryStore.getState().addItem(input, current.context), /已变化/);
  localStorage.removeItem(api.SESSION_REVISION_KEY); localStorage.setItem(api.SIGNED_OUT_KEY, 'true');
  await assert.rejects(drafts.saveDiaryDraft(current.context, newForm()), /已变化/);
  localStorage.removeItem(api.SIGNED_OUT_KEY);
  await assert.rejects(drafts.saveDiaryDraft({ ...current.context, owner: 'SYNTHETIC wrong owner' }, newForm()), /已变化/);
  api.setSessionActive('synthetic-diary-correction');
  await assert.rejects(drafts.saveDiaryDraft(current.context, newForm()), /已变化/);
  assert.equal(await storage.db.diary.count(), 0);
});

test('Rapid duplicate creation/correction cannot create two Diary rows or two correction mutations', async () => {
  const results = await Promise.allSettled([useDiaryStore.getState().addItem({ ...input, id: 'SYNTHETIC repeated id' }), useDiaryStore.getState().addItem({ ...input, id: 'SYNTHETIC repeated id' })]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1); assert.equal(await storage.db.diary.count(), 1);
  const row = useDiaryStore.getState().items[0]; const count = await storage.db.outbox.count();
  const corrections = await Promise.allSettled([useDiaryStore.getState().updateItem(row.id, { content: 'first correction' }, row), useDiaryStore.getState().updateItem(row.id, { content: 'second correction' }, row)]);
  assert.equal(corrections.filter((result) => result.status === 'fulfilled').length, 1); assert.equal(await storage.db.outbox.count(), count + 1);
});

test('Deleted Diary keeps its editable draft; new-copy recovery uses a fresh ID and original valid date', async () => {
  const row = await useDiaryStore.getState().addItem(input);
  const opened = await drafts.openDiaryDraft(row.id); const context = await drafts.saveDiaryDraft(opened.context, formOf(row));
  await useDiaryStore.getState().removeItem(row.id, row, context);
  assert.deepEqual((await drafts.openDiaryDraft(row.id)).value, formOf(row));
  await useDiaryStore.getState().addItem({ ...input, id: 'SYNTHETIC new copy' }, context);
  assert.equal(await storage.db.diary.get(row.id), undefined); assert.equal((await storage.db.diary.get('SYNTHETIC new copy'))?.date, input.date);
});

test('Malformed stored Diary draft is retained and rejects loading explicitly instead of inventing a replacement', async () => {
  const key = 'record-draft:diary:new'; const malformed = { revision: 'SYNTHETIC bad draft', value: { content: 7 } };
  await storage.db.settings.put({ key, value: malformed });
  await assert.rejects(drafts.openDiaryDraft('new'), /格式异常/);
  assert.deepEqual((await storage.db.settings.get(key))?.value, malformed);
});

test('Session revision change during outbox enqueue rolls back Diary business write and draft consumption', async () => {
  const row = await useDiaryStore.getState().addItem(input);
  const opened = await drafts.openDiaryDraft(row.id); const context = await drafts.saveDiaryDraft(opened.context, { ...formOf(row), content: 'SYNTHETIC late session input' });
  const before = await storage.db.settings.get(context.key); const count = await storage.db.outbox.count();
  const changeSession = () => { localStorage.setItem(api.SESSION_REVISION_KEY, 'SYNTHETIC changed during outbox'); };
  storage.db.outbox.hook('creating', changeSession);
  try { await assert.rejects(useDiaryStore.getState().updateItem(row.id, { content: 'SYNTHETIC late session input' }, row, context), /账号|会话|身份|变化/); }
  finally { storage.db.outbox.hook('creating').unsubscribe(changeSession); }
  assert.deepEqual(await storage.db.diary.get(row.id), row); assert.deepEqual(await storage.db.settings.get(context.key), before); assert.equal(await storage.db.outbox.count(), count);
});
