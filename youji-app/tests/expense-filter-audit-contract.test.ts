import assert from 'node:assert/strict';
import test from 'node:test';
import { expenseFilterAuditChecks as checks } from '../scripts/audit-expense-filters.mjs';
import { expenseOutcomeChecks as expense } from '../scripts/audit-expense-outcomes.mjs';
import { timelineKeyboardChecks } from '../scripts/audit-timeline-keyboard.mjs';

// Finite false-green controls for the native evidence, not browser acceptance.
const rows = [
  { id: 'one', name: '同名', amount: 456, date: '2026-09-30', category: 'other', isIncome: false, existing: undefined },
  { id: 'two', name: '同名', amount: 222, date: '2026-09-08', category: 'food', isIncome: false, existing: undefined },
  { id: 'three', name: '收入', amount: 10001, date: '2026-10-07', category: 'other', isIncome: true, existing: undefined },
];
const paint = () => ({ rect: { x: 0, y: 1500, width: 150, height: 30 }, styles: [{ opacity: '1', display: 'block', visibility: 'visible', contentVisibility: 'visible' }] });
const member = (row: typeof rows[number]) => ({ ...checks.identity(row), paint: { button: paint(), name: paint(), detail: paint(), amount: paint() } });
function surface() {
  return { heading: '花销明细', month: { label: '月份', value: '2026-09', selected: '2026-09' }, category: { label: '类别', value: 'category:other', selected: '其他' }, status: '当前明细：2026-09 · 其他，显示 1 / 3 笔', clear: { disabled: false }, empty: null as string | null, rows: [member(rows[0])] };
}
test('Filter evidence binds exact selected labels, intersection, numerator/denominator and painted dated identities', () => {
  const selection = { month: '2026-09', category: 'other' };
  assert.equal(checks.scopeResult(surface(), rows, selection).pass, true, 'Normal offscreen members count as rendered, not as separately read in the viewport');
  const bad = [surface(), surface(), surface(), surface(), surface(), surface(), surface(), surface()];
  bad[0].month.selected = '2026-10'; bad[1].category.label = '月份'; bad[2].status = '当前明细：2026-09 · 其他，显示 1 / 1 笔';
  bad[3].rows.push(member(rows[1])); bad[4].rows.push(member(rows[0])); bad[5].rows[0].detail = '其他 · 2026-10-01 · 编辑';
  bad[6].rows[0].amount = '-¥4.57'; bad[7].empty = '没有符合当前筛选的记录';
  for (const wrong of bad) assert.equal(checks.scopeResult(wrong, rows, selection).pass, false);
  for (const part of ['button', 'name', 'detail', 'amount'] as const) {
    const missing = surface(); missing.rows[0].paint[part].rect.height = 0; assert.equal(checks.scopeResult(missing, rows, selection).pass, false);
    const hidden = surface(); hidden.rows[0].paint[part].styles[0].visibility = 'hidden'; assert.equal(checks.scopeResult(hidden, rows, selection).pass, false);
  }
});
test('Zero results keep the chosen combination and enabled clear control; all restores income and other months', () => {
  const zero = { ...surface(), category: { label: '类别', value: 'category:transport', selected: '交通' }, status: '当前明细：2026-09 · 交通，显示 0 / 3 笔', rows: [], empty: '没有符合当前筛选的记录' };
  assert.equal(checks.scopeResult(zero, rows, { month: '2026-09', category: 'transport' }).pass, true);
  assert.equal(checks.scopeResult({ ...zero, clear: { disabled: true } }, rows, { month: '2026-09', category: 'transport' }).pass, false);
  assert.equal(checks.scopeResult({ ...zero, empty: '没有已保存数据' }, rows, { month: '2026-09', category: 'transport' }).pass, false);
  const all = { ...surface(), month: { label: '月份', value: '', selected: '所有月份' }, category: { label: '类别', value: '', selected: '所有类别' }, status: '当前明细：所有月份 · 所有类别，显示 3 / 3 笔', clear: { disabled: true }, rows: rows.map(member) };
  assert.equal(checks.scopeResult(all, rows).pass, true);
  assert.equal(checks.scopeResult({ ...all, rows: all.rows.slice(0, 2) }, rows).pass, false);
});
function sources() {
  const server = rows.map(row => ({ ...row, userId: 'synthetic-owner', note: null as string | null, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' }));
  const events = server.map((row, index) => ({ seq: String(index + 1), entity: 'expenses', entityId: row.id, operation: 'upsert', data: structuredClone(row) }));
  return { local: { expenses: structuredClone(rows), outbox: [], settings: rows.map((row, index) => ({ key: `sync-version:expenses:${row.id}`, value: String(index + 1) })) }, server, events, allEvents: structuredClone(events) };
}
function saved() {
  const before = sources(), after = structuredClone(before);
  after.local.expenses[0].category = 'food'; after.server[0].category = 'food'; after.server[0].updatedAt = '2026-10-07T00:01:00.000Z';
  after.local.settings[0].value = '4'; after.events.push({ seq: '4', entity: 'expenses', entityId: 'one', operation: 'upsert', data: structuredClone(after.server[0]) }); after.allEvents.push(structuredClone(after.events.at(-1)!));
  return { before, after };
}
test('Category-only save preserves every other field, neighbor, version and complete old ledger', () => {
  const { before, after } = saved(); assert.equal(checks.categorySaveResult(before, after, 'one', 'food', expense), true);
  const bad = Array.from({ length: 7 }, () => structuredClone(after));
  bad[0].local.expenses[0].amount++; bad[1].server[0].date = '2026-10-01'; bad[2].server[0].createdAt = '2026-10-07T00:01:00.000Z';
  delete (bad[3].local.expenses[0] as Partial<typeof rows[number]>).existing;
  bad[4].local.expenses[1].name = 'changed neighbor'; bad[5].local.settings[1].value = '4'; bad[6].allEvents[0].data.note = 'changed history';
  for (const value of bad) assert.equal(checks.categorySaveResult(before, value, 'one', 'food', expense), false);
  const unknownTail = structuredClone(after); Object.assign(unknownTail.allEvents.at(-1)!.data, { unexpected: true }); Object.assign(unknownTail.events.at(-1)!.data, { unexpected: true });
  assert.equal(checks.categorySaveResult(before, unknownTail, 'one', 'food', expense), false, 'Latest ledger payload must equal the original full server row');
});
test('The reused draft predicate binds preparation to the pre-open full original, including its base and unknown fields', () => {
  const before = sources(), typed = { name: rows[0].name, date: rows[0].date, amount: '4.56', category: 'food', isIncome: false };
  const prepared = { ...structuredClone(before), local: { ...structuredClone(before.local), settings: [...before.local.settings, { key: 'record-draft:expense:one', value: { revision: 'a'.repeat(32), value: { id: 'one', ...typed, base: structuredClone(before.local.expenses[0]) } } }] } };
  assert.equal(timelineKeyboardChecks.draftWriteResult(before, prepared, 'one', typed, expense).pass, true);
  const changed = structuredClone(prepared); delete (changed.local.expenses[0] as Partial<typeof rows[number]>).existing;
  assert.equal(timelineKeyboardChecks.draftWriteResult(before, changed, 'one', typed, expense).pass, false);
  const wrongBase = structuredClone(prepared); const value = wrongBase.local.settings.at(-1)!.value; assert.equal(typeof value, 'object');
  if (typeof value === 'object') value.value.base.amount++;
  assert.equal(timelineKeyboardChecks.draftWriteResult(before, wrongBase, 'one', typed, expense).pass, false);
});
