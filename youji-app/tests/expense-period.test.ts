import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { useExpenseStore, type ExpenseItem } from '../src/stores/expenseStore.ts';
import { db } from '../src/db/index.ts';
import { getExpensePeriodTotals, sumExpensePeriod } from '../src/utils/expensePeriod.ts';

const expense = (id: string, date: string, amount: number, isIncome = false): ExpenseItem => ({
  id, date, amount, isIncome, name: 'Synthetic ordinary record', category: 'other',
});
after(() => { db.close(); });

test('inclusive period sums retain cents at both boundaries and keep income separate', () => {
  const items = Object.freeze([
    Object.freeze({ date: '2026-09-30', amount: 11 }),
    Object.freeze({ date: '2026-10-01', amount: 22 }),
    Object.freeze({ date: '2026-10-07', amount: 33 }),
    Object.freeze({ date: '2026-10-08', amount: 44 }),
    Object.freeze({ date: '2026-10-07', amount: 55, isIncome: true }),
  ]);
  assert.equal(sumExpensePeriod(items, '2026-10-01', '2026-10-07'), 55);
  assert.equal(sumExpensePeriod(items, '2026-10-01', '2026-10-07', true), 55);
  assert.equal(sumExpensePeriod(items, '2026-09-01', '2026-09-30'), 11);
  assert.equal(sumExpensePeriod(items, '2026-10-08', '2026-10-07'), 0);
  assert.deepEqual(getExpensePeriodTotals([], '2026-10-07'), { today: 0, week: 0, month: 0, monthIncome: 0 });
});

test('Expense selectors count recorded cents through today without changing any listed row', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T04:00:00Z') });
  const items = [
    expense('today', '2026-10-07', 1234), expense('tuesday', '2026-10-06', 1234),
    expense('sunday', '2026-10-04', 321), expense('previous-month', '2026-09-30', 456),
    expense('future', '2026-10-08', 567), expense('today-income', '2026-10-07', 10001, true),
    expense('tuesday-income', '2026-10-06', 1002, true), expense('future-income', '2026-10-08', 2222, true),
  ];
  const before = structuredClone(items);
  for (const row of items) Object.freeze(row);
  Object.freeze(items);
  useExpenseStore.setState({ items });
  const state = useExpenseStore.getState();
  assert.deepEqual([state.todayTotal(), state.weekTotal(), state.monthTotal(), state.monthIncome()], [1234, 2468, 2789, 11003]);
  assert.equal(state.items, items);
  assert.deepEqual(state.items, before);
});

test('Expense selectors roll over at Shanghai midnight and keep Monday-to-today distinct from rolling seven days', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T15:59:59.999Z') });
  useExpenseStore.setState({ items: [
    expense('last-monday', '2026-09-28', 101), expense('sunday', '2026-10-04', 202),
    expense('monday', '2026-10-05', 303), expense('tuesday', '2026-10-06', 404),
  ] });
  const state = useExpenseStore.getState();
  assert.deepEqual([state.todayTotal(), state.weekTotal(), state.monthTotal()], [202, 303, 202]);
  t.mock.timers.setTime(new Date('2026-10-04T16:00:00Z').getTime());
  assert.deepEqual([state.todayTotal(), state.weekTotal(), state.monthTotal()], [303, 303, 505]);
});

test('Expense selectors preserve explicit direction semantics across the year boundary', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-31T16:00:00Z') });
  useExpenseStore.setState({ items: [
    expense('monday', '2026-12-28', 101), expense('previous-sunday', '2026-12-27', 202),
    { ...expense('january', '2027-01-01', 303), category: 'income' },
    expense('january-income', '2027-01-01', 404, true), expense('future', '2027-01-02', 505),
  ] });
  const state = useExpenseStore.getState();
  assert.deepEqual([state.todayTotal(), state.weekTotal(), state.monthTotal(), state.monthIncome()], [303, 404, 303, 404]);
});
