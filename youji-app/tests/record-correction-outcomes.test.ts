import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
const memoryStorage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; };
Object.assign(globalThis, { localStorage: memoryStorage(), sessionStorage: memoryStorage(), window: Object.assign(new EventTarget(), { location: { replace() {} }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }) });
const storage = await import('../src/db/index.ts');
const sync = await import('../src/services/syncEngine.ts');
const api = await import('../src/services/apiClient.ts');
const { useTodoStore } = await import('../src/stores/todoStore.ts');
const { useExpenseStore, parseYuanToFen } = await import('../src/stores/expenseStore.ts');
const todos = await import('../src/components/todo/todoDraft.ts');
const expenses = await import('../src/components/expense/expenseDraft.ts');
const todoInput = { text: 'Synthetic repeated name', priority: 'medium' as const, dueDate: '2026-10-10' };
const expenseInput = { name: 'Synthetic repeated name', category: 'food', amount: 1234, date: '2026-10-03', isIncome: false };
before(async () => { await storage.bindAccountDatabase('synthetic-record-correction'); sync.pauseSync(); });
beforeEach(async () => {
  localStorage.removeItem(api.SIGNED_OUT_KEY); localStorage.removeItem(api.SESSION_REVISION_KEY); api.clearSession(); api.setSessionActive('synthetic-record-correction');
  await storage.db.todos.clear(); await storage.db.expenses.clear(); await storage.db.settings.clear(); await storage.db.outbox.clear();
  useTodoStore.setState({ undoStack: [] }); await useTodoStore.getState().loadFromDB(); await useExpenseStore.getState().loadFromDB();
});
after(() => { sync.pauseSync(); storage.db.close(); });

test('CNY parser keeps exact fen and rejects partial, exponent, excess precision and negative input', () => {
  for (const [raw, fen] of [['12.34', 1234], ['56.78', 5678], ['0.01', 1], ['1.1', 110], ['100000000', 10_000_000_000]] as const) assert.equal(parseYuanToFen(raw), fen);
  for (const raw of ['12oops', '1e3', '1.005', '-1', 'NaN', 'Infinity', '', '0', '100000000.01']) assert.equal(parseYuanToFen(raw), null, raw);
  assert.equal(parseYuanToFen('0', true), 0);
});

test('Todo exact record correction persists title, priority, done and clears wire date explicitly', async () => {
  const one = await useTodoStore.getState().addItem(todoInput);
  const two = await useTodoStore.getState().addItem(todoInput);
  await useTodoStore.getState().updateItem(one.id, { text: 'Corrected only one', dueDate: undefined, priority: 'high', done: true }, one);
  await useTodoStore.getState().loadFromDB();
  const updated = useTodoStore.getState().items.find((row) => row.id === one.id)!;
  assert.equal(updated.text, 'Corrected only one'); assert.equal(updated.dueDate, undefined); assert.equal(updated.done, true); assert.equal(updated.priority, 'high');
  assert.deepEqual(await storage.db.todos.get(two.id), two);
  assert.equal(((await storage.db.outbox.orderBy('seq').last())?.payload as { dueDate: unknown }).dueDate, null);
  await assert.rejects(useTodoStore.getState().updateItem(one.id, { dueDate: '2026-02-30' }, updated), /日期/);
});

test('Expense corrections retain cents and shift date/category/income without mutating same-name neighbor', async () => {
  const one = await useExpenseStore.getState().addItem(expenseInput);
  const two = await useExpenseStore.getState().addItem(expenseInput);
  const updated = await useExpenseStore.getState().updateItem(one.id, { name: 'Corrected income', amount: parseYuanToFen('56.78')!, category: 'study', isIncome: true, date: '2026-09-30' }, one);
  await useExpenseStore.getState().loadFromDB();
  assert.deepEqual(await storage.db.expenses.get(one.id), updated); assert.equal(updated.amount, 5678); assert.equal(updated.date, '2026-09-30');
  assert.deepEqual(await storage.db.expenses.get(two.id), two);
  await assert.rejects(useExpenseStore.getState().updateItem(one.id, { date: '2026-02-30' }, updated), /日期/);
  await assert.rejects(useExpenseStore.getState().updateItem(one.id, { amount: 1.5 }, updated), /金额/);
});

test('Todo stale snapshots and newly introduced metadata cannot be overwritten or deleted', async () => {
  const row = await useTodoStore.getState().addItem(todoInput);
  await storage.db.todos.put({ ...row, sourceProof: 'NEW_SYNTHETIC_PROOF' } as typeof row);
  const count = await storage.db.outbox.count();
  await assert.rejects(useTodoStore.getState().updateItem(row.id, { text: 'stale edit' }, row), /刚刚/);
  await assert.rejects(useTodoStore.getState().removeItem(row.id, row), /刚刚/);
  assert.equal(await storage.db.outbox.count(), count);
  assert.equal((await storage.db.todos.get(row.id) as typeof row & { sourceProof: string }).sourceProof, 'NEW_SYNTHETIC_PROOF');
});

test('Expense stale correction is rejected and remote conflict evidence survives a later valid local amendment', async () => {
  const row = await useExpenseStore.getState().addItem(expenseInput);
  await storage.db.expenses.update(row.id, { amount: 2000 });
  await assert.rejects(useExpenseStore.getState().updateItem(row.id, { amount: 1000 }, row), /刚刚/);
  const conflict = { event: { entity: 'expenses', entityId: row.id, seq: '91', operation: 'delete', data: null }, receivedAt: 123 };
  const key = `sync-conflict:expenses:${row.id}`;
  await storage.db.settings.put({ key, value: conflict });
  await useExpenseStore.getState().loadFromDB();
  const latest = useExpenseStore.getState().items[0];
  await useExpenseStore.getState().updateItem(row.id, { name: 'amended local' }, latest);
  assert.deepEqual((await storage.db.settings.get(key))?.value, conflict);
});

test('Quota during Todo mutation keeps record, exact draft and outbox unchanged', async () => {
  const row = await useTodoStore.getState().addItem(todoInput);
  const opened = await todos.openTodoDraft<{ text: string }>(row.id);
  const context = await todos.saveTodoDraft(opened.context, { text: 'unsaved correction' });
  const before = await storage.db.settings.get(context.key); const count = await storage.db.outbox.count();
  const fail = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', fail);
  try { await assert.rejects(useTodoStore.getState().updateItem(row.id, { text: 'unsaved correction' }, row, context), /quota/); }
  finally { storage.db.outbox.hook('creating').unsubscribe(fail); }
  assert.deepEqual(await storage.db.todos.get(row.id), row); assert.deepEqual(await storage.db.settings.get(context.key), before); assert.equal(await storage.db.outbox.count(), count);
  await useTodoStore.getState().updateItem(row.id, { text: 'unsaved correction' }, row, context);
  assert.equal(await storage.db.settings.get(context.key), undefined); assert.equal(await storage.db.outbox.count(), count + 1);
});

test('Quota during Expense save preserves draft and supports one successful retry', async () => {
  const opened = await expenses.openExpenseDraft<{ amount: string }>('new');
  const context = await expenses.saveExpenseDraft(opened.context, { amount: '12.34' });
  const fail = () => { throw new DOMException('synthetic expense quota', 'QuotaExceededError'); };
  storage.db.outbox.hook('creating', fail);
  try { await assert.rejects(useExpenseStore.getState().addItem(expenseInput, 'synthetic-fixed-id', context), /quota/); }
  finally { storage.db.outbox.hook('creating').unsubscribe(fail); }
  assert.equal(await storage.db.expenses.count(), 0); assert.ok(await storage.db.settings.get(context.key));
  await useExpenseStore.getState().addItem(expenseInput, 'synthetic-fixed-id', context);
  assert.equal(await storage.db.expenses.count(), 1); assert.equal(await storage.db.settings.get(context.key), undefined);
  await assert.rejects(useExpenseStore.getState().addItem(expenseInput, 'synthetic-fixed-id', context));
  assert.equal(await storage.db.expenses.count(), 1);
});

test('Rapid duplicate Todo toggle creates one mutation and undo survives store refresh and group movement', async () => {
  const row = await useTodoStore.getState().addItem(todoInput); const count = await storage.db.outbox.count();
  const results = await Promise.allSettled([useTodoStore.getState().toggleTodo(row.id), useTodoStore.getState().toggleTodo(row.id)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await storage.db.outbox.count(), count + 1); assert.equal((await storage.db.todos.get(row.id))?.done, true);
  await useTodoStore.getState().loadFromDB(); assert.equal(useTodoStore.getState().undoStack.length, 1);
  await useTodoStore.getState().undoLast(); assert.equal((await storage.db.todos.get(row.id))?.done, false); assert.equal(useTodoStore.getState().undoStack.length, 0);
});

test('Undo never erases a correction made after completing the Todo', async () => {
  const row = await useTodoStore.getState().addItem(todoInput); await useTodoStore.getState().toggleTodo(row.id);
  await useTodoStore.getState().updateItem(row.id, { text: 'newer title' });
  await assert.rejects(useTodoStore.getState().undoLast(), /刚刚/);
  assert.equal((await storage.db.todos.get(row.id))?.text, 'newer title');
});

test('Expense double save or delete cannot duplicate mutations, and deleted ID cannot be edited back', async () => {
  const row = await useExpenseStore.getState().addItem(expenseInput); const count = await storage.db.outbox.count();
  const results = await Promise.allSettled([useExpenseStore.getState().updateItem(row.id, { amount: 2000 }, row), useExpenseStore.getState().updateItem(row.id, { amount: 2000 }, row)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1); assert.equal(await storage.db.outbox.count(), count + 1);
  const latest = useExpenseStore.getState().items[0]; await useExpenseStore.getState().removeItem(row.id, latest);
  await assert.rejects(useExpenseStore.getState().updateItem(row.id, { amount: 3000 }, latest));
  assert.equal(await storage.db.expenses.get(row.id), undefined); assert.equal((await storage.db.outbox.orderBy('seq').last())?.op, 'delete');
});

test('Cancelled domain drafts survive reload, but stale tab cannot replace or consume a newer revision', async () => {
  const first = await expenses.openExpenseDraft<{ amount: string }>('new');
  const second = await expenses.openExpenseDraft<{ amount: string }>('new');
  const latest = await expenses.saveExpenseDraft(first.context, { amount: '56.78' });
  await assert.rejects(expenses.saveExpenseDraft(second.context, { amount: '12.34' }), /另一页/);
  await assert.rejects(useExpenseStore.getState().addItem(expenseInput, 'synthetic-stale-draft', second.context), /草稿/);
  assert.equal(await storage.db.expenses.count(), 0);
  const reopened = await expenses.openExpenseDraft<{ amount: string }>('new'); assert.deepEqual(reopened.value, { amount: '56.78' }); assert.equal(reopened.context.revision, latest.revision);
});

test('Clear epoch, sign-out, session revision and owner handle block late domain draft writes', async () => {
  const opened = await todos.openTodoDraft('new');
  await storage.clearAllData({ allowPending: true });
  await assert.rejects(todos.saveTodoDraft(opened.context, { text: 'stale after clear' }), /已变化/);
  assert.equal(await storage.db.settings.where('key').startsWith('record-draft:').count(), 0);
  const current = await expenses.openExpenseDraft('new');
  localStorage.setItem(api.SESSION_REVISION_KEY, 'new-revision'); await assert.rejects(expenses.saveExpenseDraft(current.context, {}), /已变化/);
  localStorage.removeItem(api.SESSION_REVISION_KEY); localStorage.setItem(api.SIGNED_OUT_KEY, 'true'); await assert.rejects(expenses.saveExpenseDraft(current.context, {}), /已变化/);
  localStorage.removeItem(api.SIGNED_OUT_KEY); await assert.rejects(expenses.saveExpenseDraft({ ...current.context, owner: 'another-account' }, {}), /已变化/);
});

test('Deleting retains a usable local draft, while a copy must use a fresh ID', async () => {
  const row = await useExpenseStore.getState().addItem(expenseInput);
  const opened = await expenses.openExpenseDraft<typeof expenseInput>(row.id); const context = await expenses.saveExpenseDraft(opened.context, expenseInput);
  await useExpenseStore.getState().removeItem(row.id, row, context);
  assert.deepEqual((await expenses.openExpenseDraft<typeof expenseInput>(row.id)).value, expenseInput);
  await useExpenseStore.getState().addItem(expenseInput, 'synthetic-copy-id', context);
  assert.equal(await storage.db.expenses.get(row.id), undefined); assert.ok(await storage.db.expenses.get('synthetic-copy-id'));
});

test('Budget unset, unknown legacy 2500 and explicit zero are distinct without rewriting historical values', async () => {
  assert.equal(useExpenseStore.getState().budgetStatus, 'unset'); assert.equal(useExpenseStore.getState().monthBudget, 0);
  await storage.db.settings.put({ key: 'monthBudget', value: 250000 }); await useExpenseStore.getState().loadFromDB();
  assert.equal(useExpenseStore.getState().budgetStatus, 'unknown'); assert.equal(useExpenseStore.getState().monthBudget, 250000); assert.equal((await storage.db.settings.get('monthBudget'))?.value, 250000);
  await useExpenseStore.getState().setMonthBudget(0, { monthBudget: 250000, budgetStatus: 'unknown' }); await useExpenseStore.getState().loadFromDB();
  assert.equal(useExpenseStore.getState().budgetStatus, 'configured'); assert.equal(useExpenseStore.getState().monthBudget, 0); assert.equal((await storage.db.settings.get('monthBudgetConfigured'))?.value, true);
  await assert.rejects(useExpenseStore.getState().setMonthBudget(100, { monthBudget: 250000, budgetStatus: 'unknown' }), /刚刚/);
  assert.equal((await storage.db.settings.get('monthBudget'))?.value, 0);
});

test('Budget quota rollback preserves legacy value and does not manufacture configured status', async () => {
  await storage.db.settings.put({ key: 'monthBudget', value: 250000 }); await useExpenseStore.getState().loadFromDB();
  const fail = (_: unknown, value: { key: string }) => { if (value.key === 'monthBudgetConfigured') throw new DOMException('synthetic budget quota', 'QuotaExceededError'); };
  storage.db.settings.hook('creating', fail);
  try { await assert.rejects(useExpenseStore.getState().setMonthBudget(50000), /quota/); }
  finally { storage.db.settings.hook('creating').unsubscribe(fail); }
  assert.equal((await storage.db.settings.get('monthBudget'))?.value, 250000); assert.equal(useExpenseStore.getState().budgetStatus, 'unknown');
});
