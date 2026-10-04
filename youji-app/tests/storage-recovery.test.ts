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

test('fake IndexedDB: confirming old capture cannot erase or overwrite another tab new draft', async () => {
  const { applyCaptureDraft, saveCaptureDraft, loadCaptureDraft } = await import('../src/services/quickNoteIntegration.ts');
  const a = { id: 'capture-tab-a-001', input: 'tab A source', expenses: [], habits: [], todos: [], diary: null, mood: null, moodScore: 5 };
  const b = { ...a, id: 'capture-tab-b-001', input: 'tab B newer source' };
  await saveCaptureDraft(a, true);
  await saveCaptureDraft(b, true);
  await current.settings.put({ key: 'quicknote_draft', value: b.input });
  await saveCaptureDraft({ ...a, input: 'tab A edited source' });
  assert.equal((await loadCaptureDraft())?.id, b.id);
  assert.equal((await loadCaptureDraft(a.id))?.input, 'tab A edited source');
  await applyCaptureDraft(a);
  assert.equal((await loadCaptureDraft())?.id, b.id);
  assert.equal((await loadCaptureDraft(b.id))?.input, b.input);
  assert.equal((await current.settings.get('quicknote_draft'))?.value, b.input);
  await saveCaptureDraft(a);
  assert.equal(await loadCaptureDraft(a.id), null, 'late autosave cannot resurrect confirmed draft');
});

test('fake IndexedDB: raw composer recovery forks per mount and confirmation clears only its own input', async () => {
  const { forkCaptureInput, saveCaptureDraft, applyCaptureDraft } = await import('../src/services/quickNoteIntegration.ts');
  const a = await forkCaptureInput();
  await current.settings.put({ key: a.key, value: 'composer A' });
  const b = await forkCaptureInput();
  assert.notEqual(a.key, b.key);
  assert.equal(b.text, 'composer A');
  await current.settings.put({ key: b.key, value: 'composer B' });
  const draft = { id: 'capture-raw-a-001', input: 'composer A', inputKey: a.key, expenses: [], habits: [], todos: [], diary: null, mood: null, moodScore: 5 };
  await saveCaptureDraft(draft, true);
  await applyCaptureDraft(draft);
  assert.equal(await current.settings.get(a.key), undefined);
  assert.equal((await current.settings.get(b.key))?.value, 'composer B');
});

test('fake IndexedDB: delayed settings hydration cannot undo a newer choice or change its queued PATCH', async () => {
  const { useSettingsStore } = await import('../src/stores/settingsStore.ts');
  api.setSessionActive('synthetic-account-a');
  let release: (response: Response) => void = () => {};
  const patches: unknown[] = [];
  globalThis.fetch = async (_path, options) => {
    if (options?.method === 'PATCH') { patches.push(JSON.parse(String(options.body))); return Response.json({ settings: {} }); }
    return new Promise<Response>((resolve) => { release = resolve; });
  };
  await useSettingsStore.getState().loadSettings();
  await useSettingsStore.getState().updateSetting('coachPushFrequency', 5);
  release(Response.json({ settings: { coachStyle: 'gentle', pushLimit: 2, quietStart: '23:00', quietEnd: '07:00' } }));
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(useSettingsStore.getState().coachPushFrequency, 5);
  assert.equal((await current.settings.get('coachPushFrequency'))?.value, 5);
  assert.deepEqual(patches, [{ pushLimit: 5 }]);
  api.clearSession();
});

test('fake IndexedDB: same capture ID with edited content cannot falsely replay success', async () => {
  const { applyCaptureDraft, saveCaptureDraft, loadCaptureDraft, CaptureChangedError } = await import('../src/services/quickNoteIntegration.ts');
  const original = { id: 'same-id-different-content', input: 'version A', expenses: [], habits: [], todos: [], diary: null, mood: null, moodScore: 5 };
  await applyCaptureDraft(original);
  let forked = '';
  try { await applyCaptureDraft({ ...original, input: 'version B' }); assert.fail('edited content needs review'); }
  catch (error) { assert.ok(error instanceof CaptureChangedError); forked = error.draftId; }
  assert.equal((await current.quickNotes.get(original.id))?.rawInput, 'version A');
  assert.equal((await loadCaptureDraft(forked))?.input, 'version B');
  const autosaveId = await saveCaptureDraft({ ...original, input: 'version C' });
  assert.notEqual(autosaveId, original.id);
  assert.equal((await loadCaptureDraft(autosaveId))?.input, 'version C');
});
