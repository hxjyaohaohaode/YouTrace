import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expenseOutcomeChecks as checks } from '../scripts/audit-expense-outcomes.mjs';

// Pure evidence-oracle negatives. These do not exercise the native application
// or award product acceptance to an unrun Expense/Budget journey.
const record = (id: string, amount: number, date: string, isIncome = false) => ({ id, name: 'Synthetic 同名记账', amount, date, isIncome, category: 'food', note: null as string | null, unknownPresent: undefined });
function sources() {
  const target = record('one', 1234, '2026-10-07'), neighbor = record('two', 1234, '2026-10-06');
  const canonical = (row: ReturnType<typeof record>) => ({ ...row, userId: 'synthetic-owner', source: 'manual', createdAt: '2026-10-06T04:00:00.000Z', updatedAt: '2026-10-06T04:00:00.000Z' });
  const server = [canonical(target), canonical(neighbor)];
  const events = server.map((row, index) => ({ seq: String(index + 1), entity: 'expenses', entityId: row.id, operation: 'upsert', data: structuredClone(row) }));
  return { local: { expenses: [target, neighbor], settings: [{ key: 'sync-version:expenses:one', value: '1' }, { key: 'sync-version:expenses:two', value: '2' }, { key: 'record-draft:expense:one', value: { revision: 'synthetic-revision', value: { amount: '9.87' } } }], outbox: [] }, server, events, allEvents: structuredClone(events) };
}
function correction() {
  const before = sources(), after = structuredClone(before);
  after.local.expenses[0].amount = 987; after.server[0].amount = 987; after.server[0].updatedAt = '2026-10-06T04:01:00.000Z';
  after.local.settings = after.local.settings.filter(row => row.key !== 'record-draft:expense:one');
  after.local.settings.find(row => row.key === 'sync-version:expenses:one')!.value = '3';
  after.events.push({ seq: '3', entity: 'expenses', entityId: 'one', operation: 'upsert', data: structuredClone(after.server[0]) });
  after.allEvents.push(structuredClone(after.events.at(-1)!));
  return { before, after };
}
function creation() {
  const before = sources(), after = structuredClone(before), declared = record('three', 321, '2026-10-04');
  after.local.expenses.push(structuredClone(declared));
  after.server.push({ ...structuredClone(before.server[0]), ...declared });
  after.local.settings.push({ key: 'sync-version:expenses:three', value: '3' });
  after.events.push({ seq: '3', entity: 'expenses', entityId: 'three', operation: 'upsert', data: structuredClone(after.server.at(-1)!) });
  after.allEvents.push(structuredClone(after.events.at(-1)!));
  return { before, after, declared };
}
test('Actual spending oracle separates income, natural-week boundary, previous month and visible future records', () => {
  const rows = [record('today', 1234, '2026-10-07'), record('neighbor', 1234, '2026-10-06'), record('sunday', 321, '2026-10-04'), record('previous-month', 456, '2026-09-30'), record('future', 567, '2026-10-08'), record('income', 10001, '2026-10-07', true), record('income-neighbor', 1002, '2026-10-06', true)];
  assert.deepEqual(checks.expectedTotals(rows), { today: 1234, week: 2468, month: 2789, monthIncome: 11003, weekStart: '2026-10-05', through: '2026-10-07' });
  assert.equal(rows.find(row => row.id === 'future')?.amount, 567, 'Excluding a future item from 已花 does not remove or mutate it');
  rows[0].amount = 987;
  assert.deepEqual(checks.expectedTotals(rows), { today: 987, week: 2221, month: 2542, monthIncome: 11003, weekStart: '2026-10-05', through: '2026-10-07' });
});
test('Natural week arithmetic crosses a year boundary without treating rolling seven days as the week', () => {
  const rows = [record('monday', 101, '2026-12-28'), record('sunday', 202, '2026-12-27'), record('friday', 303, '2027-01-01'), record('future', 404, '2027-01-02')];
  assert.deepEqual(checks.expectedTotals(rows, '2027-01-01'), { today: 303, week: 404, month: 303, monthIncome: 0, weekStart: '2026-12-28', through: '2027-01-01' });
  assert.throws(() => checks.expectedTotals([record('fractional-cent', 1.1, '2026-10-07')]));
});
test('Expense ledger preserves raw payload fields and tombstones while rejecting malformed order/identity', () => {
  const events = sources().events;
  assert.equal(checks.expenseRowsFromLedger(events)[0], events[0].data, 'Original payload object is retained');
  assert.equal(Object.hasOwn(checks.expenseRowsFromLedger(events)[0], 'unknownPresent'), true);
  const deleted = [...events, { seq: '4', entity: 'expenses', entityId: 'one', operation: 'delete', data: null }];
  assert.deepEqual(checks.expenseRowsFromLedger(deleted), [events[1].data]);
  for (const bad of [[events[0], events[0]], [{ ...events[0], seq: '01' }], [{ ...events[0], operation: 'replace' }], [{ ...events[0], data: { id: 'wrong' } }]]) assert.throws(() => checks.expenseRowsFromLedger(bad));
});
test('Complete source preservation includes real record-draft key, own undefined fields, version and outbox', () => {
  const before = sources(); assert.equal(checks.businessSourcesPreserved(before, structuredClone(before)), true);
  const missingOwn = structuredClone(before); delete (missingOwn.local.expenses[0] as Partial<typeof missingOwn.local.expenses[0]>).unknownPresent;
  const changedDraft = structuredClone(before); changedDraft.local.settings.pop();
  const changedVersion = structuredClone(before); changedVersion.local.settings[1].value = '9';
  const changedUnknown = structuredClone(before); changedUnknown.local.expenses[0].note = 'changed';
  const changedLedger = structuredClone(before); changedLedger.events[0].data.amount = 555;
  for (const after of [missingOwn, changedDraft, changedVersion, changedUnknown, changedLedger, { ...before, local: { ...before.local, outbox: [{ seq: 1, entity: 'expenses', payload: { id: 'one' } }] } }]) assert.equal(checks.businessSourcesPreserved(before, after), false);
});
test('ACK needs the same ID, exact fields, exact canonical positive version, no conflict and empty queue', () => {
  const facts = sources(); assert.equal(checks.acknowledged(facts, 'one'), true);
  const wrongAmount = structuredClone(facts); wrongAmount.server[0].amount++;
  const staleVersion = structuredClone(facts); staleVersion.local.settings[0].value = '2';
  const changedIdentity = structuredClone(facts); changedIdentity.server[0].id = 'replacement';
  for (const altered of [wrongAmount, staleVersion, changedIdentity, { ...facts, local: { ...facts.local, outbox: [{ seq: 1 }] } }, { ...facts, local: { ...facts.local, settings: [...facts.local.settings, { key: 'sync-conflict:expenses:one', value: {} }] } }]) assert.equal(checks.acknowledged(altered, 'one'), false);
});
test('One exact correction permits server audit time change but preserves local unknown fields and every neighbor', () => {
  const { before, after } = correction(); assert.equal(checks.changedOnlyTarget(before, after, 'one', 987), true);
  const variants = [structuredClone(after), structuredClone(after), structuredClone(after), structuredClone(after), structuredClone(after)];
  variants[0].local.expenses[1].amount++;
  variants[1].server[1].updatedAt = '2026-10-06T04:01:00.000Z';
  variants[2].local.settings.find(row => row.key === 'sync-version:expenses:two')!.value = '9';
  delete (variants[3].local.expenses[0] as Partial<typeof variants[3]['local']['expenses'][0]>).unknownPresent;
  variants[4].server[0].createdAt = '2026-10-07T04:00:00.000Z';
  for (const changed of variants) assert.equal(checks.changedOnlyTarget(before, changed, 'one', 987), false);
});
test('Correction rejects extra commits and rewriting an earlier ledger fact even when latest amount matches', () => {
  const { before, after } = correction(), duplicate = structuredClone(after), alteredHistory = structuredClone(after);
  duplicate.events.push({ ...structuredClone(after.events.at(-1)!), seq: '4' }); duplicate.local.settings[0].value = '4';
  alteredHistory.events[0].data.amount = 9999;
  assert.equal(checks.changedOnlyTarget(before, duplicate, 'one', 987), false);
  assert.equal(checks.changedOnlyTarget(before, alteredHistory, 'one', 987), false);
});
test('Device budget oracle distinguishes no rows, explicit zero, configured marker and exact cents', () => {
  assert.deepEqual(checks.budgetRows({ settings: [] }), []);
  const rows = [{ key: 'monthBudget', value: 0 }, { key: 'monthBudgetConfigured', value: true }];
  assert.deepEqual(checks.budgetRows({ settings: [...rows, { key: 'unrelated', value: 1202 }] }), rows);
  assert.equal(checks.sameRows(rows, [{ key: 'monthBudget', value: 0 }]), false);
  assert.equal(checks.sameRows(rows, [{ key: 'monthBudget', value: 1 }, { key: 'monthBudgetConfigured', value: true }]), false);
  for (const value of ['1', '9223372036854775807']) assert.equal(checks.validVersion(value), true);
  for (const value of ['0', '01', '1.1', '-1', '9223372036854775808', 1, null]) assert.equal(checks.validVersion(value), false);
});

test('visible budget amount tolerates paragraph whitespace but keeps exact label, currency and cents', () => {
  for (const text of ['本月已花\n¥15.58', '100%\n\n本月已花\n\n¥15.58\n\n月预算 ¥12.02', '本月已花 ¥15.58']) assert.equal(checks.budgetSpentMatches(text, 1558), true, text);
  for (const text of ['本月已花\n\n¥15.59', '本月已花\n\n¥15.580', '本月已花\n\n€15.58', '本月收入 ¥15.58', '本月已花\n历史记录\n¥15.58', '本月已花 ¥15.58\n本月已花 ¥99.99']) assert.equal(checks.budgetSpentMatches(text, 1558), false, text);
});
test('All four native accounts have explicit unique short registration nicknames and phones', () => {
  assert.equal(checks.profiles.length, 4);
  assert.equal(new Set(checks.profiles.map(row => row.nickname)).size, 4);
  assert.equal(new Set(checks.profiles.map(row => row.phone)).size, 4);
  for (const profile of checks.profiles) {
    assert.ok(profile.nickname.trim().length > 0 && profile.nickname.length <= 20, 'Must meet actual registration max(20), not derive a long scenario label');
    assert.match(profile.phone, /^139000088\d{2}$/);
    assert.ok([1280, 360].includes(profile.width)); assert.ok(['records', 'budget'].includes(profile.scenarioSet));
  }
});
test('Source preservation compares unrelated settings and logs only legitimate timestamp or explicit budget differences', () => {
  const before = sources(), unknown = { ...structuredClone(before), local: { ...structuredClone(before.local), settings: [...before.local.settings, { key: 'unknown-source-key', value: 'original' }] } };
  const changedUnknown = structuredClone(unknown); changedUnknown.local.settings.find(row => row.key === 'unknown-source-key')!.value = 'changed';
  assert.equal(checks.businessSourcesPreserved(unknown, changedUnknown), false);
  const timestamp = { ...structuredClone(before), local: { ...structuredClone(before.local), settings: [...before.local.settings, { key: 'lastPullAt', value: '2026-10-07T04:02:00.000Z' }] } };
  assert.equal(checks.businessSourcesPreserved(before, timestamp), true);
  assert.equal(checks.settingsDifferences(before, timestamp)[0].key, 'lastPullAt');
  const badTime = structuredClone(timestamp); badTime.local.settings.at(-1)!.value = 'unknown-time';
  assert.equal(checks.businessSourcesPreserved(before, badTime), false);
  const budget = { ...structuredClone(before), local: { ...structuredClone(before.local), settings: [...before.local.settings, { key: 'monthBudget', value: 1202 }, { key: 'monthBudgetConfigured', value: true }] } };
  assert.equal(checks.businessSourcesPreserved(before, budget), false);
  assert.equal(checks.businessSourcesPreserved(before, budget, { allowBudgetChange: true }), true);
  assert.equal(checks.businessSourcesPreserved(unknown, changedUnknown, { allowBudgetChange: true }), false);
});
test('Only explicit reload can advance a valid cursor to the exact unchanged ledger end', () => {
  const base = sources();
  const before = { ...base, local: { ...base.local, settings: [...base.local.settings, { key: 'syncV2Cursor', value: '0' }] } }, after = structuredClone(before);
  after.local.settings.at(-1)!.value = '2';
  assert.equal(checks.businessSourcesPreserved(before, after), false);
  assert.equal(checks.businessSourcesPreserved(before, after, { reload: true }), true);
  for (const invalid of ['1', '3', '02', '-1', '9223372036854775808']) {
    const broken = structuredClone(after); broken.local.settings.at(-1)!.value = invalid;
    assert.equal(checks.businessSourcesPreserved(before, broken, { reload: true }), false);
  }
  const rewrittenLedger = structuredClone(after); rewrittenLedger.events[0].data.amount++;
  assert.equal(checks.businessSourcesPreserved(before, rewrittenLedger, { reload: true }), false);
  const invalidPrior = structuredClone(before); invalidPrior.local.settings.at(-1)!.value = '02';
  assert.equal(checks.businessSourcesPreserved(invalidPrior, after, { reload: true }), false);
});
test('Later creation cannot change any prior local/server row, old version or prior ledger payload', () => {
  const { before, after, declared } = creation(); assert.equal(checks.createdOnlyDeclared(before, after, declared), true);
  const variants = Array.from({ length: 7 }, () => structuredClone(after));
  variants[0].local.expenses[0].amount++;
  variants[1].server[1].date = '2026-09-30';
  variants[2].local.settings.find(row => row.key === 'sync-version:expenses:two')!.value = '9';
  variants[3].events[0].data.amount++;
  variants[4].allEvents[0].data.amount++;
  variants[5].local.expenses.splice(0, 1);
  variants[6].allEvents.push({ ...structuredClone(after.allEvents.at(-1)!), seq: '4', entity: 'todos', entityId: 'unrequested' });
  for (const altered of variants) assert.equal(checks.createdOnlyDeclared(before, altered, declared), false);
  assert.equal(checks.createdOnlyDeclared(before, after, { ...declared, amount: 999 }), false);
});
test('Final declared-ID binding rejects self-consistent changed values even if display totals use those wrong rows', () => {
  const { after } = creation(), ids = ['one', 'two', 'three'], declared = after.local.expenses.map(row => structuredClone(row));
  assert.equal(checks.declaredRecordsMatch(after, ids, declared), true);
  const altered = structuredClone(after); altered.local.expenses[2].amount = 999; altered.server[2].amount = 999;
  assert.equal(checks.acknowledged(altered, 'three'), true, 'Merely agreeing current local/cloud amounts is insufficient');
  assert.equal(checks.declaredRecordsMatch(altered, ids, declared), false);
  assert.equal(checks.declaredRecordsMatch(after, ['one', 'two', 'two'], declared), false);
  assert.equal(checks.declaredRecordsMatch(after, ['one', 'three', 'two'], declared), false);
});
test('Full-ledger preservation rejects non-Expense changes and correction rejects unrelated new events', () => {
  const before = sources(), after = structuredClone(before);
  after.allEvents.push({ ...structuredClone(before.allEvents[0]), seq: '3', entity: 'todos', entityId: 'another-entity' });
  assert.equal(checks.businessSourcesPreserved(before, after), false);
  const corrected = correction(); corrected.after.allEvents.push({ ...structuredClone(corrected.after.allEvents[0]), seq: '4', entity: 'todos', entityId: 'unrequested' });
  assert.equal(checks.changedOnlyTarget(corrected.before, corrected.after, 'one', 987), false);
  const rewritten = correction(); rewritten.before.allEvents.unshift({ ...structuredClone(before.allEvents[0]), seq: '0', entity: 'todos', entityId: 'existing' }); rewritten.after.allEvents.unshift({ ...structuredClone(before.allEvents[0]), seq: '0', entity: 'todos', entityId: 'changed' });
  assert.equal(checks.changedOnlyTarget(rewritten.before, rewritten.after, 'one', 987), false);
});
test('Daily net summary binds exact currency, amount and cashflow direction instead of accepting a label alone', () => {
  for (const text of ['今天\n净收入 ¥87.67', '今天\n净额 +¥87.67', '今天\n结余 CNY +87.67', '今天\n收支差额 人民币87.67元']) assert.equal(checks.dailySummaryMatches(text, 1234, 10001), true, text);
  for (const text of ['今天\n净额 ¥0.01', '今天\n净额', '今天\n净额 87.67', '今天\n净额 -¥87.67', '今天\n净支出 ¥87.67', '今天\n净收入 ¥-87.67', '今天\n净收入 ¥87.670', '今天\n净收入 +¥-87.67']) assert.equal(checks.dailySummaryMatches(text, 1234, 10001), false, text);
  assert.equal(checks.dailySummaryMatches('净额 -¥5.00', 1000, 500), true);
  assert.equal(checks.dailySummaryMatches('净支出 ¥5.00', 1000, 500), true);
  assert.equal(checks.dailySummaryMatches('净额 +¥5.00', 1000, 500), false);
});
test('Daily gross summary binds each labeled amount separately and rejects swaps, wrong signs and absent currency', () => {
  for (const text of ['支出 ¥12.34 · 收入 ¥100.01', '收入 +¥100.01\n支出 -¥12.34']) assert.equal(checks.dailySummaryMatches(text, 1234, 10001), true, text);
  for (const text of ['支出 ¥100.01 · 收入 ¥12.34', '支出 ¥12.34 · 收入 ¥99.99', '支出 12.34 · 收入 100.01', '支出 +¥12.34 · 收入 ¥100.01', '支出 ¥12.34 · 收入 -¥100.01', '支出 ¥12.34 · 支出 ¥100.01', '支出 收入 ¥12.34 ¥100.01']) assert.equal(checks.dailySummaryMatches(text, 1234, 10001), false, text);
  assert.equal(checks.dailySummaryMatches('支出 ¥12.34 · 收入 ¥100.01 · 净额 ¥0.01', 1234, 10001), false, 'Correct gross copy cannot excuse a contradictory net amount');
  for (const malformed of ['净额 999.99', '净额 €999.99']) assert.equal(checks.dailySummaryMatches(`支出 ¥12.34 · 收入 ¥100.01 · ${malformed}`, 1234, 10001), false, 'An unparsed visible net statement cannot be ignored');
});
test('Independent witness: creating a previous-month row while rewriting Sunday to 999 cents is rejected despite internally consistent ACK/ledger', () => {
  const sunday = record('sunday', 321, '2026-10-04'), previousMonth = record('previous-month', 456, '2026-09-30');
  const canonical = (row: ReturnType<typeof record>) => ({ ...row, userId: 'synthetic-owner', createdAt: '2026-10-06T04:00:00Z', updatedAt: '2026-10-06T04:00:00Z' });
  const event = (seq: string, row: ReturnType<typeof record>) => ({ seq, entity: 'expenses', entityId: row.id, operation: 'upsert', data: canonical(row) });
  const before = { local: { expenses: [sunday], settings: [{ key: 'sync-version:expenses:sunday', value: '1' }], outbox: [] }, server: [canonical(sunday)], events: [event('1', sunday)], allEvents: [event('1', sunday)] };
  const altered = { ...sunday, amount: 999 }, events = [event('1', sunday), event('2', altered), event('3', previousMonth)];
  const after = { local: { expenses: [altered, previousMonth], settings: [{ key: 'sync-version:expenses:sunday', value: '2' }, { key: 'sync-version:expenses:previous-month', value: '3' }], outbox: [] }, server: [canonical(altered), canonical(previousMonth)], events, allEvents: structuredClone(events) };
  assert.equal(checks.sameRows(after.server, checks.expenseRowsFromLedger(after.allEvents)), true);
  assert.equal(checks.acknowledged(after, previousMonth.id), true);
  assert.equal(checks.expectedTotals(after.local.expenses).month, 999);
  assert.equal(checks.expectedTotals([sunday, previousMonth]).month, 321);
  assert.equal(checks.createdOnlyDeclared(before, after, previousMonth), false);
});
