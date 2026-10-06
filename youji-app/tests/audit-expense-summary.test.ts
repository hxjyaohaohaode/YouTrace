import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { indexedDB } from 'fake-indexeddb';
import { expenseSummaryChecks as checks } from '../scripts/audit-expense-summary.mjs';

// Pure diagnostic-oracle controls only. No browser, listener, route substitute,
// provider, or product acceptance. Native source remains the existing 3-row API fixture.
const rows = [
  { id: 'lunch', name: 'Synthetic 本期核对午饭', amount: 5025, date: '2026-10-06', category: 'food', isIncome: false, ownUndefined: undefined },
  { id: 'prior', name: 'Synthetic 前期核对午饭', amount: 2010, date: '2026-09-27', category: 'food', isIncome: false },
  { id: 'income', name: 'Synthetic 非支出收入反例', amount: 90000, date: '2026-10-05', category: 'income', isIncome: true },
];
function snapshot() {
  const server = rows.map(row => ({ ...row, createdAt: '2026-10-06T21:00:00.000Z', updatedAt: '2026-10-06T21:00:00.000Z' }));
  const events = server.map((row, index) => ({ seq: String(index + 1), entity: 'expenses', entityId: row.id, operation: 'upsert', data: structuredClone(row) }));
  return { local: { expenses: structuredClone(rows), settings: rows.map((row, index) => ({ key: `sync-version:expenses:${row.id}`, value: String(index + 1) })), outbox: [] }, server, events, allEvents: structuredClone(events), history: { local: [{ id: 'old-local', title: '150%', ownUndefined: undefined }], remote: [{ id: 'old-cloud', title: 'original', description: 'unchanged' }] } };
}
const all = (checks: Record<string, unknown>) => Object.entries(checks).filter(([key]) => key !== 'expected').every(([, value]) => value === true);

test('Original three sources give exact cents, distinct Wednesday bounds but equal totals; both kinds exclude income', () => {
  const week = checks.expectedSummary(rows, '2026-10-07', 'week'), seven = checks.expectedSummary(rows, '2026-10-07', 'seven');
  assert.equal(week.from, '2026-10-05'); assert.equal(seven.from, '2026-10-01');
  for (const expected of [week, seven]) { assert.equal(expected.total, 5025); assert.equal(expected.count, 1); assert.deepEqual(expected.categories, { 餐饮: 5025 }); assert.deepEqual(expected.sourceIds, ['lunch']); }
  const legacy = [...rows, { ...rows[2], id: 'legacy-income', isIncome: false }];
  assert.equal(checks.expectedSummary(legacy, '2026-10-07', 'seven').total, 5025, 'Pure legacy-category oracle only; no fourth native fixture');
  const corrected = structuredClone(rows); corrected[0].amount = 4025;
  assert.equal(checks.expectedSummary(corrected, '2026-10-07', 'yesterday').total, 4025);
  assert.equal(checks.expectedSummary(corrected, '2026-10-07', 'seven').total, 4025);
  const mondayRows = [{ ...rows[0], date: '2026-10-11' }];
  assert.equal(checks.expectedSummary(mondayRows, '2026-10-12', 'week').total, 0);
  assert.equal(checks.expectedSummary(mondayRows, '2026-10-12', 'seven').total, 5025);
  assert.equal(checks.expectedSummary(rows, '2026-10-11', 'week').from, checks.expectedSummary(rows, '2026-10-11', 'seven').from);
});

test('Readable summary binds exact money, count, actual named period and Chinese categories in the current answer', () => {
  const expected = checks.expectedSummary(rows, '2026-10-07', 'week');
  const text = '本周（自然周）2026-10-05 至 2026-10-07\n支出合计 ¥50.25，共1笔支出\n餐饮 ¥50.25';
  assert.equal(all(checks.summaryReading(text, expected, { categories: true })), true);
  for (const bad of [
    text.replace('支出合计 ¥50.25', '支出合计 ¥50.25万元'), text.replace('餐饮 ¥50.25', '餐饮 ¥50.25万元'),
    text.replace('共1笔', '共-1笔'), text.replace('共1笔', '共1.1笔'), text.replace('2026-10-07', '2026-10-070'),
    text.replace('支出合计', '上月支出合计'),
    '本周（自然周）2026-10-01 至 2026-10-07\n近7天：2026-10-05 至 2026-10-07\n支出合计 ¥50.25，共1笔支出\n餐饮 ¥50.25',
    text.replace('50.25', '50'), text.replace('50.25', '950.25'), text.replace('50.25', '50.250'),
    text.replace('10-05', '10-01'), text.replace('本周（自然周）', '近7天'), text.replace('共1笔', '共2笔'),
    text.replace('餐饮', 'food'), text.replace('餐饮 ¥50.25', '餐饮 ¥50.24'), `${text}\n支出 ¥50`,
    `${text}\n收入 ¥900.00`, `${text}\n交通 ¥1.00`, text.replace('支出合计 ¥50.25', '支出合计 €50.25'),
  ]) assert.equal(all(checks.summaryReading(bad, expected, { categories: true })), false, bad);
  assert.equal(all(checks.summaryReading(text.replaceAll('¥50.25', '￥50.25元'), expected, { categories: true })), true);
  const nearSeven = '近7天回顾\n2026-10-01 至 2026-10-07\n消费\n¥50.25，共1笔支出\n餐饮 ¥50.25';
  assert.equal(all(checks.summaryReading(nearSeven, checks.expectedSummary(rows, '2026-10-07', 'seven'), { categories: true })), true, 'Separately read Home title, period and amount remain supported');
  assert.equal(all(checks.summaryReading('2026-10-06 记录回顾\n已记录支出 ¥50.25，共1笔支出', checks.expectedSummary(rows, '2026-10-07', 'yesterday'), { period: false })), true);
  assert.equal(checks.exactMoney('已记录支出 ¥40.25（较近几日日均高100%）', 4025, '已记录支出'), true);
  assert.equal(all(checks.summaryReading('近7天回顾\n消费\n¥50', checks.expectedSummary(rows, '2026-10-07', 'seven'))), false);
});

test('Native request credit requires completed rule SSE and exactly its new assistant bubble', () => {
  const content = '【规则回复 · 在线模型当前不可用】\n最近7天消费了¥50，共1笔。\nfood ¥50';
  const normal = { content, source: 'rule_fallback' }, actions = [{ type: 'navigate', path: '/expense', label: '查看花销明细' }, { type: 'navigate', path: '/insights', label: '看看餐饮相关洞察' }];
  const data = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  const raw = data(normal) + data({ actions }) + 'data: [DONE]\n\n', completed = checks.completeRuleSse(raw);
  assert.deepEqual(completed.events[1].actions, actions, 'Actual unchanged financial reply actions retained for evidence, never clicked');
  for (const bad of [{ error: 'synthetic stream failed' }, {}, { source: false }, { content: 9 }, { content: { error: 'synthetic' } }, { actions: '' }, { actions: { length: 0, type: 'log_expense', amountFen: 123 } }, { actions: [{ type: 'log_expense', amountFen: 123 }] }, { actions: [{ type: 'navigate', path: '/expense', label: 3 }] }, null, []]) assert.throws(() => checks.completeRuleSse(data(normal) + data(bad) + 'data: [DONE]\n\n'));
  assert.equal(checks.completeRuleSse(data(normal) + 'data: [DONE]\n\n').content, content);
  assert.equal(checks.newAssistantMatches(['older'], ['older', content], completed), true, 'Old wrong content remains diagnostic evidence, not protocol failure');
  assert.equal(checks.newAssistantMatches([content], [content], completed), false);
  assert.equal(checks.newAssistantMatches(['older'], [content, 'unrelated'], completed), false);
  assert.equal(checks.newAssistantMatches(['older'], ['changed-old', content], completed), false);
  for (const bad of [raw.replace('data: [DONE]\n\n', ''), raw.replace('rule_fallback', 'provider'), `${raw}data: [DONE]\n\n`]) assert.throws(() => checks.completeRuleSse(bad));
});

test('External freeze survives derived additions but rejects any Expense field/version/outbox/ledger/history change', async () => {
  const before = snapshot(), after = structuredClone(before);
  after.history.remote.push({ id: 'new-derived', title: 'new', description: 'new current snapshot' });
  assert.equal(checks.sourcesPreserved(before, after), true);
  const lostOwn = structuredClone(after); delete lostOwn.local.expenses[0].ownUndefined;
  const amount = structuredClone(after); amount.local.expenses[1].amount++;
  const version = structuredClone(after); version.local.settings[1].value = '99';
  const history = structuredClone(after); history.history.remote[0].description = 'rewritten';
  const oldLedger = structuredClone(after); oldLedger.allEvents[0].data.name = 'rewritten';
  const extraEntity = structuredClone(after); extraEntity.allEvents.push({ ...structuredClone(extraEntity.allEvents[0]), seq: '4', entity: 'todos' });
  for (const invalid of [lostOwn, amount, version, history, oldLedger, extraEntity]) assert.equal(checks.sourcesPreserved(before, invalid), false);
  assert.equal(checks.sourcesPreserved(before, { ...after, local: { ...after.local, outbox: [{ seq: 1 }] } }), false);
  // Replay the independent hole+extra-key witness through the exact readonly
  // callback, using disposable fake-indexeddb only, in each sampled table.
  const source = await readFile(new URL('../scripts/audit-expense-summary.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const serialized = await page.evaluate(') + 'const serialized = await page.evaluate('.length;
  const callback = source.slice(start, source.indexOf('}), api.ownerId);', start) + 2);
  assert.ok(callback.startsWith('owner => new Promise'));
  const capture = new Function('indexedDB', `return (${callback});`)(indexedDB) as (owner: string) => Promise<string>;
  const owner = 'independent-array-witness', name = `youtrace:user:${owner}:schedule-v1`, tables = ['expenses', 'settings', 'outbox', 'coachInsights'];
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { for (const table of tables) request.result.createObjectStore(table, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const put = (table: string, metadata: unknown) => new Promise<void>((resolve, reject) => { const tx = db.transaction(table, 'readwrite'); tx.objectStore(table).put({ id: 'synthetic', metadata }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  try {
    for (const table of tables) {
      const original = Object.assign(new Array(2), { 0: 'kept', extra: 'original hidden value' });
      await put(table, original); await assert.rejects(capture(owner), /sparse or extended/);
      const changed = structuredClone(original); changed.extra = 'changed hidden value';
      assert.notDeepEqual(original, changed);
      await put(table, changed); await assert.rejects(capture(owner), /sparse or extended/);
      await put(table, ['kept', undefined]);
      assert.deepEqual(JSON.parse(await capture(owner))[table][0].metadata, ['kept', { __expenseSummaryUndefined: true }]);
    }
    for (const malformed of [new Array(2), Object.assign(['kept'], { extra: 'hidden' }), { __expenseSummaryUndefined: true }, new Date('2026-10-06T21:00:00Z'), -0]) {
      await put('expenses', malformed); await assert.rejects(capture(owner), /Unsupported/);
    }
  } finally {
    db.close(); await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  }

});

test('The same-ID correction is checked against the untouched original freeze, not a recaptured baseline', () => {
  const before = snapshot(), after = structuredClone(before);
  after.local.expenses[0].amount = 4025; after.server[0].amount = 4025; after.server[0].updatedAt = '2026-10-06T21:01:00.000Z';
  after.local.settings[0].value = '4';
  const event = { seq: '4', entity: 'expenses', entityId: 'lunch', operation: 'upsert', data: structuredClone(after.server[0]) };
  after.events.push(event); after.allEvents.push(structuredClone(event));
  assert.equal(checks.correctionMatches(before, after, 'lunch'), true);
  assert.equal(checks.correctionMatches(after, after, 'lunch'), false, 'An already altered capture cannot become the original source');
  const rewritten = structuredClone(after); rewritten.server[1].updatedAt = after.server[0].updatedAt;
  const extra = structuredClone(after); extra.events.push({ ...event, seq: '5' }); extra.allEvents.push({ ...event, seq: '5' });
  for (const invalid of [rewritten, extra]) assert.equal(checks.correctionMatches(before, invalid, 'lunch'), false);
});

test('Actual driver/browser/server Shanghai dates must agree; midnight is context blockage, not reclocking', () => {
  const clock = { driverInstant: '2026-10-06T21:00:00.000Z', browser: { instant: '2026-10-06T21:00:00.100Z', day: '2026-10-07', timeZone: 'Asia/Shanghai' } };
  const brief = { generatedAt: '2026-10-06T21:00:00.050Z', reviewDate: '2026-10-06' };
  assert.equal(checks.clocksMatch('2026-10-07', clock, brief), true);
  const expected = checks.expectedSummary(rows, '2026-10-07', 'yesterday'), ui = '已记录支出 ¥50.25，共1笔支出';
  assert.deepEqual(checks.briefMatches({ ...brief, yesterdayReview: { spent: 50.25 } }, expected, ui), { apiReviewDate: true, apiAmount: true, uiAmountMatchesActualApi: true, actualSpentYuan: 50.25, expectedSpentYuan: 50.25 });
  const staleUi = checks.briefMatches({ ...brief, yesterdayReview: { spent: 999 } }, expected, ui);
  assert.equal(staleUi.apiAmount, false); assert.equal(staleUi.uiAmountMatchesActualApi, false, 'Matching minute/date cannot credit a stale correct-looking UI against a wrong actual response');
  assert.equal(checks.briefMatches({ ...brief, yesterdayReview: { spent: 50 } }, expected, '已记录支出 ¥50').apiAmount, false, 'Current rounded API is a product red result, not a thrown mechanical blocker');

  assert.equal(checks.clocksMatch('2026-10-07', clock, { ...brief, reviewDate: '2026-10-05' }), false);
  assert.equal(checks.clocksMatch('2026-10-07', clock, { ...brief, generatedAt: '2026-10-07T16:00:00.000Z' }), false);
  assert.equal(checks.clocksMatch('2026-10-07', { ...clock, browser: { ...clock.browser, day: '2026-10-08' } }, brief), false);
  assert.equal(checks.clocksMatch('2026-10-07', { ...clock, driverInstant: '2026-10-07T16:00:00.000Z' }, brief), false);
});
