import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() };
};
Object.assign(globalThis, {
  localStorage: memoryStorage(), sessionStorage: memoryStorage(),
  window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }),
  document: { documentElement: { setAttribute() {} } },
});
const storage = await import('../src/db/index.ts');
const { db, YoujiDatabase, bindAccountDatabase, exportAllData, clearAllData, exportLegacyData } = storage;
const api = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { useTodoStore } = await import('../src/stores/todoStore.ts');
const { commitLocalMutation } = await import('../src/services/localMutation.ts');
const { default: Dexie } = await import('dexie');
let current = db;

before(async () => { await bindAccountDatabase('synthetic-account-a'); current = storage.db; });
after(() => { sync.pauseSync(); current.close(); });

test('fake IndexedDB: per-account databases survive A/B/A without shared reads', async () => {
  await current.todos.put({ id: 'a-only-001', text: 'synthetic A', done: false, priority: 'medium' });
  const other = new YoujiDatabase('synthetic-account-b');
  await other.open();
  assert.equal(await other.todos.count(), 0);
  await other.todos.put({ id: 'b-only-001', text: 'synthetic B', done: false, priority: 'medium' });
  assert.equal(await current.todos.get('b-only-001'), undefined);
  assert.ok(await current.todos.get('a-only-001'));
  await assert.rejects(bindAccountDatabase('synthetic-account-b'), /重新加载/);
  other.close();
});

test('fake IndexedDB: account mutation and outbox roll back together on quota failure', async () => {
  const throwQuota = () => { throw new DOMException('synthetic quota failure', 'QuotaExceededError'); };
  current.outbox.hook('creating', throwQuota);
  const beforeCount = await current.todos.count();
  await assert.rejects(useTodoStore.getState().addItem({ text: 'must not survive', priority: 'medium' }), /quota/i);
  current.outbox.hook('creating').unsubscribe(throwQuota);
  assert.equal(await current.todos.count(), beforeCount);
  assert.equal(useTodoStore.getState().items.some((row) => row.text === 'must not survive'), false);
});

test('fake IndexedDB: unacknowledged work survives every HTTP rejection and session clearing', async () => {
  for (const status of [400, 401, 403, 409, 413, 429, 500]) {
    await current.outbox.clear();
    await commitLocalMutation('todos', 'upsert', { id: 'retained-001', text: 'synthetic', done: false, priority: 'medium' }, () => current.todos.put({ id: 'retained-001', text: 'synthetic', done: false, priority: 'medium' }));
    globalThis.fetch = async () => Response.json({ error: 'synthetic failure' }, { status });
    api.setSessionActive('synthetic-account-a');
    await sync.retryBlockedSync();
    api.clearSession();
    assert.equal(await current.outbox.count(), 1, `HTTP ${status}`);
  }
});

test('fake IndexedDB: export includes goal/draft/outbox and clear rejects pending work atomically', async () => {
  await current.goals.put({ id: 'goal-001', title: 'synthetic', description: '', level: 'short', domain: '学习', priority: 'low', progress: 0, targetDate: null, createdAt: 1, updatedAt: 1 });
  await current.settings.put({ key: 'quicknote_draft', value: 'synthetic draft' });
  const backup = await exportAllData();
  assert.equal(backup.ownerId, 'synthetic-account-a');
  assert.equal(backup.tables.goals.length, 1);
  assert.equal(backup.tables.outbox.length, 1);
  assert.ok(backup.tables.settings.some((row) => (row as { key: string }).key === 'quicknote_draft'));
  await assert.rejects(clearAllData(), /未同步/);
  assert.equal(await current.goals.count(), 1);
  await current.outbox.clear();
  await clearAllData();
  for (const table of current.tables) assert.equal(await table.count(), table.name === 'settings' ? 1 : 0, table.name);
});

test('fake IndexedDB: old v2 autoincrement records and unknown note fields remain readable without upgrade', async () => {
  const legacy = new Dexie('youtrace');
  legacy.version(2).stores({ diary: '++id, date', quickNotes: 'id, timestamp' });
  await legacy.open();
  await legacy.table('diary').bulkAdd([{ date: '2026-01-01', content: 'first' }, { date: '2026-01-01', content: 'second' }]);
  await legacy.table('quickNotes').add({ id: 'old-note', timestamp: 1, content: 'no rawInput field' });
  legacy.close();
  const backup = await exportLegacyData();
  assert.equal(backup.schemaVersion, 2);
  assert.equal(backup.tables.diary.length, 2);
  assert.equal((backup.tables.quickNotes[0] as { content: string }).content, 'no rawInput field');
  assert.equal(await current.diary.count(), 0, 'unknown-ownership source not claimed');
  const reopened = new Dexie('youtrace');
  await reopened.open();
  assert.equal(reopened.verno, 2);
  assert.equal(await reopened.table('diary').count(), 2);
  reopened.close();
});

test('fake IndexedDB: stale visible todo cannot overwrite newly pulled text under a newer version', async () => {
  api.clearSession();
  const original = { id: 'stale-snapshot-001', text: 'old visible text', done: false, priority: 'medium' as const };
  await current.todos.put(original);
  await useTodoStore.getState().loadFromDB();
  await current.todos.put({ ...original, text: 'remote new text' });
  await current.settings.put({ key: 'sync-version:todos:stale-snapshot-001', value: '100' });
  const pending = await current.outbox.count();
  await assert.rejects(useTodoStore.getState().toggleTodo(original.id), /刚刚/);
  assert.equal((await current.todos.get(original.id))?.text, 'remote new text');
  assert.equal(await current.outbox.count(), pending);
});

test('fake IndexedDB: capture confirmation is atomic, idempotent and appends diary without replacing originals', async () => {
  api.clearSession();
  sync.pauseSync();
  const { applyCaptureDraft } = await import('../src/services/quickNoteIntegration.ts');
  const { getToday } = await import('../src/utils/date.ts');
  await current.diary.put({ id: 'capture-diary-001', date: getToday(), content: 'original diary', mood: null, moodScore: 5, source: 'manual', quickNoteIds: [], createdAt: 1, updatedAt: 1 });
  const draft = { id: 'capture-idempotent-001', input: 'unreviewed input', expenses: [{ id: 'expense-draft-001', name: 'edited name', amount: 1234, category: 'food', confirmed: true }], habits: [], todos: [{ id: 'todo-draft-001', text: 'edited task', confirmed: true }], diary: 'reviewed addition', mood: null, moodScore: 5 };
  const first = await applyCaptureDraft(draft);
  assert.equal(first.expenseCount, 1);
  assert.equal((await current.quickNotes.get(draft.id))?.expenses[0].name, 'edited name');
  assert.equal((await current.diary.get('capture-diary-001'))?.content, 'original diary\n\nreviewed addition');
  const counts = [await current.expenses.count(), await current.todos.count(), await current.outbox.count()];
  await applyCaptureDraft(draft);
  assert.deepEqual([await current.expenses.count(), await current.todos.count(), await current.outbox.count()], counts);
  const throwQuota = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  current.outbox.hook('creating', throwQuota);
  await assert.rejects(applyCaptureDraft({ ...draft, id: 'capture-rollback-001' }), /quota/);
  current.outbox.hook('creating').unsubscribe(throwQuota);
  assert.equal(await current.quickNotes.get('capture-rollback-001'), undefined);
  assert.deepEqual([await current.expenses.count(), await current.todos.count(), await current.outbox.count()], counts);
});
