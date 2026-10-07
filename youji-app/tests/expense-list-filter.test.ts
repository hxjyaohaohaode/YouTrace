import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseListMonth, filterExpenseList, UNKNOWN_EXPENSE_MONTH } from '../src/components/expense/expenseListFilter';

const all = { month: null, category: null };
const records = Object.freeze([
  Object.freeze({ id: 'prior-year', date: '2025-10-07', category: 'food', amount: 1234, note: null, unknownPresent: undefined }),
  Object.freeze({ id: 'prior-month', date: '2026-09-30', category: 'food', amount: 456 }),
  Object.freeze({ id: 'current', date: '2026-10-07', category: 'food', amount: 1234 }),
  Object.freeze({ id: 'income', date: '2026-10-07', category: 'food', amount: 10001, isIncome: true }),
  Object.freeze({ id: 'future', date: '2026-10-08', category: 'other', amount: 567 }),
  Object.freeze({ id: 'unknown-category', date: '2026-10-07', category: '餐饮', amount: 222 }),
  Object.freeze({ id: 'unknown-date', date: '2026-02-30', category: 'legacy', amount: 333 }),
  Object.freeze({ id: 'empty-date', date: '', category: '', amount: 444 }),
]);
const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

test('default and cleared view retain every loaded row, income, future and unknown fields without mutating sources', () => {
  const before = structuredClone(records);
  const view = filterExpenseList(records, all);
  assert.deepEqual(view.items, records);
  for (const [index, row] of view.items.entries()) assert.equal(row, records[index]);
  assert.ok(Object.hasOwn(view.items[0], 'unknownPresent'));
  filterExpenseList(records, { month: '2026-10', category: 'food' });
  assert.deepEqual(filterExpenseList(records, all).items, records);
  assert.deepEqual(records, before);
});

test('months distinguish years, validate complete business dates and keep unknown dates reachable', () => {
  assert.deepEqual(filterExpenseList(records, all).months, ['2026-10', '2026-09', '2025-10', UNKNOWN_EXPENSE_MONTH]);
  assert.deepEqual(ids(filterExpenseList(records, { month: '2025-10', category: null }).items), ['prior-year']);
  assert.equal(expenseListMonth('2024-02-29'), '2024-02');
  for (const date of ['2026-02-29', '2026-13-01', '2026-10', '2026-10-01extra', '']) assert.equal(expenseListMonth(date), UNKNOWN_EXPENSE_MONTH);
  assert.deepEqual(ids(filterExpenseList(records, { month: UNKNOWN_EXPENSE_MONTH, category: null }).items), ['unknown-date', 'empty-date']);
});

test('category matching uses exact raw keys, including empty and prototype-like unknown keys', () => {
  assert.deepEqual(ids(filterExpenseList(records, { month: null, category: '餐饮' }).items), ['unknown-category']);
  assert.deepEqual(ids(filterExpenseList(records, { month: null, category: 'other' }).items), ['future']);
  assert.deepEqual(ids(filterExpenseList(records, { month: null, category: '' }).items), ['empty-date']);
  const special = [{ id: 'prototype-key', date: '2026-10-07', category: '__proto__' }];
  assert.deepEqual(filterExpenseList(special, { month: null, category: '__proto__' }).items, special);
});

test('month and category intersect without narrowing options or excluding income and future records', () => {
  const view = filterExpenseList(records, { month: '2026-10', category: 'food' });
  assert.deepEqual(ids(view.items), ['current', 'income']);
  assert.deepEqual(view.months, filterExpenseList(records, all).months);
  assert.deepEqual(view.categories, filterExpenseList(records, all).categories);
  assert.ok(ids(filterExpenseList(records, { month: '2026-10', category: null }).items).includes('future'));
  assert.deepEqual(filterExpenseList(records, { month: '2026-09', category: 'other' }).items, []);
});

test('recomputing after a saved edit changes membership while keeping a now-empty active selection', () => {
  const filters = Object.freeze({ month: '2026-09', category: 'food' });
  const before = filterExpenseList(records, filters);
  assert.deepEqual(ids(before.items), ['prior-month']);
  assert.deepEqual(filterExpenseList(records, filters), before, 'Cancel leaves the unchanged source view intact');
  const saved = records.map((row) => row.id === 'prior-month' ? { ...row, date: '2026-10-01', category: 'transport' } : row);
  const after = filterExpenseList(saved, filters);
  assert.deepEqual(after.items, []);
  assert.ok(after.months.includes('2026-09'));
  assert.deepEqual(ids(filterExpenseList(saved, { month: '2026-10', category: 'transport' }).items), ['prior-month']);
  const removedCategory = filterExpenseList([{ date: '2026-10-01', category: 'transport' }], filters);
  assert.ok(removedCategory.categories.includes('food'));
  assert.deepEqual(filterExpenseList(saved, all).items, saved);
  assert.deepEqual(filters, { month: '2026-09', category: 'food' });
});
