import assert from 'node:assert/strict';
import { test } from 'node:test';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { captureReturnChecks as checks, decodeCaptureEvidence, installCaptureReturnQuota, runCaptureReturnOutcomes } from '../scripts/audit-capture-return-outcomes.mjs';
import type { CaptureDraft } from '../src/services/quickNoteIntegration.ts';

type Row = Record<string, unknown>;
type Setting = { key: string; value: unknown; [key: string]: unknown };
type Event = { seq: string; entity: string; entityId: string; operation: string; data: Row | null };
type Facts = { databaseName: string; version: number; schema: { name: string }[]; local: Record<string, Row[]> & { settings: Setting[]; quickNotes: Row[]; expenses: Row[]; todos: Row[]; outbox: Row[] }; allEvents: Event[] };
const clone = structuredClone, at = Date.parse('2026-10-07T04:00:05.000Z');
const body = checks.declared;
function reviewed(id = 'synthetic-B'): CaptureDraft {
  return { id, input: body.raw, inputKey: `capture-input:${id}`, ownerId: 'capture-contract', dataEpoch: 'initial', sessionRevision: 'synthetic-revision', sessionActive: true, context: { capturedAt: at - 5000, timeZone: 'Asia/Shanghai', date: '2026-10-07' }, expenses: [{ id: 'exp-0', name: body.name, amount: 1625, amountText: '16.25', category: 'food', confirmed: true, date: body.date, currency: 'CNY', isIncome: true }, { id: 'exp-1', name: '地铁', amount: 300, category: 'transport', confirmed: false, date: '2026-10-07', currency: 'CNY', isIncome: false }], todos: [{ id: 'todo-0', text: body.todo, confirmed: true, dueDate: body.dueDate, dateUncertain: false, dateConfirmed: true }, { id: 'todo-1', text: '取快递', confirmed: false, dueDate: '2026-10-09', dateUncertain: false }], habits: [], diary: null, diaryExcludedText: '合成原文尾记', diaryDate: '2026-10-07', mood: null, moodScore: null, moodConfirmed: false };
}
function sources(): { facts: Facts; a: CaptureDraft; b: CaptureDraft } {
  const a = reviewed('synthetic-A'), b = reviewed();
  const neighbor = { id: 'native-neighbor', text: '合成：保留邻居待办', dueDate: undefined, priority: 'medium', done: false, completedAt: null, diagnosticOwnUndefined: undefined, diagnosticMinusZero: -0 };
  const local: Facts['local'] = { quickNotes: [], expenses: [], todos: [neighbor], diary: [], habits: [], outbox: [], settings: [{ key: 'sync-version:todos:native-neighbor', value: '1' }, { key: 'quicknote_review', value: clone(b) }, ...[a, b].flatMap(value => [{ key: `capture-review:${value.id}`, value: clone(value) }, { key: value.inputKey!, value: value.input }, { key: `${value.inputKey}:context`, value: clone(value.context) }])], _accountGeneration: [{ id: 'existing-boundary', untouched: true }] };
  const remote = { id: neighbor.id, text: neighbor.text, dueDate: null, priority: 'medium', done: false, completedAt: null, userId: 'capture-contract', createdAt: '2026-10-06T11:00:00.000Z', updatedAt: '2026-10-06T11:00:00.000Z' };
  return { facts: { databaseName: 'youtrace:user:capture-contract:schedule-v1', version: 9, schema: Object.keys(local).map(name => ({ name })), local, allEvents: [{ seq: '1', entity: 'todos', entityId: neighbor.id, operation: 'upsert', data: remote }] }, a, b };
}
const putSetting = (facts: Facts, key: string, value: unknown) => { facts.local.settings = [...facts.local.settings.filter(row => row.key !== key), { key, value }]; };
function committedFixture() {
  const { facts: before, a, b } = sources(), after = clone(before);
  // A literal independently declared expected write, not a call to the oracle's
  // selectedNote helper. Candidate IDs stay only inside the parsed note.
  const note = { id: b.id, rawInput: body.raw, createdAt: at, expenses: [{ id: 'exp-0', name: body.name, amount: 1625, category: 'food', confirmed: true, date: body.date, currency: 'CNY', isIncome: true }], diary: null, mood: null, moodScore: null, habits: [], todos: [{ id: 'todo-0', text: body.todo, confirmed: true, dueDate: body.dueDate }], confirmed: true, captureContext: b.context };
  const expense = { id: 'durable-expense-ID', name: body.name, amount: 1625, category: 'food', date: body.date, isIncome: true, source: 'quicknote' };
  const todo = { id: 'durable-todo-ID', text: body.todo, dueDate: body.dueDate, priority: 'medium', done: false, createdAt: at, updatedAt: at };
  after.local.quickNotes.push(note); after.local.expenses.push(expense); after.local.todos.push(todo);
  const refs = [{ entity: 'quickNotes', id: b.id, label: '原始速记', effect: 'created' }, { entity: 'expenses', id: expense.id, label: body.name, date: body.date, effect: 'created' }, { entity: 'todos', id: todo.id, label: body.todo, date: body.dueDate, effect: 'created' }];
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const fingerprint = JSON.stringify(canonical({ input: b.input, context: b.context, expenses: b.expenses, habits: b.habits, todos: b.todos, diary: b.diary, diaryExcludedText: b.diaryExcludedText, diaryDate: b.diaryDate, mood: b.mood, moodScore: b.moodScore, moodConfirmed: b.moodConfirmed }));
  const receipt = { fingerprint, result: { expenseCount: 1, habitCount: 0, diaryCreated: false, diaryUpdated: false, todoCount: 1, records: refs, committedAt: at, captureContext: b.context }, input: b.input, ownerId: b.ownerId };
  after.local.settings = after.local.settings.filter(row => ![`capture-review:${b.id}`, 'quicknote_review', b.inputKey, `${b.inputKey}:context`].includes(row.key));
  putSetting(after, `capture-source:${b.id}`, clone(b)); putSetting(after, `capture-applied:${b.id}`, receipt);
  const serverTimes = { createdAt: '2026-10-06T11:05:00.000Z', updatedAt: '2026-10-06T11:05:00.000Z' };
  const server = [{ id: b.id, userId: b.ownerId, content: b.input, timestamp: String(at), parsed: { expenses: note.expenses, diary: null, mood: null, moodScore: null, habits: [], todos: note.todos, captureContext: b.context }, confirmed: true, ...serverTimes }, { ...expense, userId: b.ownerId, relatedMood: null, note: null, ...serverTimes }, { id: todo.id, userId: b.ownerId, text: body.todo, dueDate: body.dueDate, priority: 'medium', done: false, completedAt: null, ...serverTimes }];
  refs.forEach((ref, i) => { const seq = String(i + 2); after.allEvents.push({ seq, entity: ref.entity, entityId: ref.id, operation: 'upsert', data: server[i] }); putSetting(after, `sync-version:${ref.entity}:${ref.id}`, seq); });
  putSetting(after, 'lastPushAt', '2026-10-07T04:00:05.100Z');
  return { before, after, a, b, note, receipt, refs, window: { before: at - 100, after: at + 500 } };
}

test('Ordinary re-entry cannot pass A continuity by opening an identical B; old A retention is separately checked', () => {
  const { facts, a, b } = sources(), before = clone(facts); putSetting(before, 'quicknote_review', a);
  assert.equal(checks.continuity(before, before, a.id, a.id), true);
  assert.equal(checks.continuity(before, facts, a.id, b.id), false);
  assert.deepEqual(checks.draft(facts, a.id), a); assert.equal(checks.draftBound(facts, b.id, b), true);
  const wrongOriginal = clone(facts); putSetting(wrongOriginal, a.inputKey!, 'changed raw');
  assert.equal(checks.preserved(facts, wrongOriginal), false);
  const wrongBody = clone(before); putSetting(wrongBody, `capture-review:${a.id}`, { ...a, expenses: [{ ...a.expenses[0], amount: 1500 }, a.expenses[1]] });
  assert.equal(checks.continuity(before, wrongBody, a.id, a.id), false);
});

test('Raw-only and date-only branches require new literal parses, fresh choices and complete preservation of old drafts and receipts', () => {
  const { after: saved, b: committed } = committedFixture();
  const raw18 = '明天要交报销单；午饭18；地铁3；后天要取快递；合成原文尾记';
  const context = { capturedAt: at + 1000, timeZone: 'Asia/Shanghai', date: '2026-10-07' };
  const original: CaptureDraft = { id: 'O', inputKey: 'capture-input:O', input: body.raw, ownerId: 'capture-contract', dataEpoch: 'initial', sessionRevision: 'synthetic-revision', sessionActive: true, context,
    expenses: [{ id: 'exp-0', name: '午饭', amount: 1500, category: 'food', confirmed: true, date: '2026-10-07', currency: 'CNY', isIncome: false }, { id: 'exp-1', name: '地铁', amount: 300, category: 'transport', confirmed: true, date: '2026-10-07', currency: 'CNY', isIncome: false }],
    todos: [{ id: 'todo-0', text: '交报销单', confirmed: true, dueDate: '2026-10-08', dateUncertain: false }, { id: 'todo-1', text: '取快递', confirmed: true, dueDate: '2026-10-09', dateUncertain: false }],
    habits: [], diary: '合成原文尾记', diaryDate: '2026-10-07', mood: null, moodScore: null, moodConfirmed: false };
  assert.deepEqual(checks.freshBranchDraft('O', original.inputKey, context, committed, 'original'), original);
  const oldO = { ...original, expenses: [{ ...original.expenses[0], amount: 1625, amountText: '16.25' }, { ...original.expenses[1], confirmed: false }] };
  const retained = [oldO]; let previous = clone(saved);
  for (const [key, value] of [[`capture-review:O`, oldO], [oldO.inputKey!, oldO.input], [`${oldO.inputKey}:context`, context], ['quicknote_review', oldO]] as [string, unknown][]) putSetting(previous, key, value);
  for (const [branch, id, day, due1, due2] of [['raw', 'R', '2026-10-07', '2026-10-08', '2026-10-09'], ['date', 'D', '2026-10-06', '2026-10-07', '2026-10-08']]) {
    const nextContext = { ...context, date: day }, inputKey = `capture-input:${id}`, before = clone(previous);
    // The composer has already made exactly one input/context fork and changed
    // raw or date. Creation may write only a new review and its current pointer.
    putSetting(before, inputKey, raw18); putSetting(before, `${inputKey}:context`, nextContext);
    const expected: CaptureDraft = { id, inputKey, input: raw18, ownerId: 'capture-contract', dataEpoch: 'initial', sessionRevision: 'synthetic-revision', sessionActive: true, context: nextContext,
      expenses: [{ id: 'exp-0', name: '午饭', amount: 1800, category: 'food', confirmed: true, date: day, currency: 'CNY', isIncome: false }, { id: 'exp-1', name: '地铁', amount: 300, category: 'transport', confirmed: true, date: day, currency: 'CNY', isIncome: false }],
      todos: [{ id: 'todo-0', text: '交报销单', confirmed: true, dueDate: due1, dateUncertain: false }, { id: 'todo-1', text: '取快递', confirmed: true, dueDate: due2, dateUncertain: false }],
      habits: [], diary: '合成原文尾记', diaryDate: day, mood: null, moodScore: null, moodConfirmed: false };
    assert.deepEqual(checks.freshBranchDraft(id, inputKey, nextContext, committed, branch), expected);
    const after = clone(before); putSetting(after, `capture-review:${id}`, expected); putSetting(after, 'quicknote_review', expected);
    assert.equal(checks.newReviewExactly(before, after, expected), true);
    for (const old of retained) assert.deepEqual(checks.draft(after, old.id), old);
    assert.equal(checks.draftBound(after, oldO.id, oldO), false, 'An old retained review is not the current review; requiring its current pointer would misstate retention');
    const wrongParses: ((draft: CaptureDraft) => void)[] = [
      value => { value.expenses[0].amount = 1625; value.expenses[0].amountText = '16.25'; },
      value => { value.expenses[1].confirmed = false; },
      value => { value.todos[0].text = '合成：改文后的报销单'; value.todos[1].confirmed = false; },
      value => { value.expenses[0].date = '2026-10-05'; },
      value => { value.todos[0].dueDate = '2026-10-09'; },
      value => { value.diaryDate = '2026-10-05'; },
      value => { value.diary = null; value.moodConfirmed = true; },
      value => { value.context!.capturedAt = at + 2000; },
    ];
    for (const mutate of wrongParses) {
      const wrong = clone(after), value = clone(expected); mutate(value); putSetting(wrong, `capture-review:${id}`, value); putSetting(wrong, 'quicknote_review', value);
      assert.equal(checks.newReviewExactly(before, wrong, expected), false);
    }
    const corruptions: ((facts: Facts) => void)[] = [
      value => putSetting(value, `capture-review:O`, { ...oldO, expenses: original.expenses }),
      value => putSetting(value, oldO.inputKey!, raw18),
      value => putSetting(value, `${oldO.inputKey}:context`, { ...context, capturedAt: context.capturedAt + 1 }),
      value => { value.local.settings.find(row => row.key === `capture-review:${retained.at(-1)!.id}`)!.unexpected = undefined; },
      value => putSetting(value, `capture-applied:${committed.id}`, { lostReceipt: true }),
      value => putSetting(value, `capture-source:${committed.id}`, { ...committed, input: raw18 }),
      value => { value.local.outbox.push({ entity: 'quickNotes', id }); },
      value => { value.allEvents[0].data!.text = 'changed old ledger'; },
    ];
    for (const corrupt of corruptions) { const wrong = clone(after); corrupt(wrong); assert.equal(checks.newReviewExactly(before, wrong, expected), false); }
    for (const reusedId of [...retained.map(value => value.id), committed.id]) {
      const wrong = clone(before), reused = { ...expected, id: reusedId }; putSetting(wrong, `capture-review:${reusedId}`, reused); putSetting(wrong, 'quicknote_review', reused);
      assert.equal(checks.newReviewExactly(before, wrong, reused), false, 'Replacing an old draft or reusing a committed ID is never creation');
    }
    const occupied = clone(before); putSetting(occupied, `capture-review:${id}`, undefined);
    assert.equal(checks.newReviewExactly(occupied, after, expected), false, 'An existing physical key cannot become a declared new review even if its value is undefined');
    if (branch === 'raw') {
      const corrected = { ...expected, todos: [{ ...expected.todos[0], text: '合成：改文后的报销单' }, { ...expected.todos[1], confirmed: false }] };
      previous = clone(after); putSetting(previous, `capture-review:${id}`, corrected); putSetting(previous, 'quicknote_review', corrected); retained.push(corrected);
    }
  }
});

test('Refusal source checks reject neighbor/old-review/metadata/outbox/receipt/prior-ledger changes; no capture-prefix exemption', () => {
  const { facts, a, b } = sources(); assert.equal(checks.preserved(facts, clone(facts)), true);
  const mutations: ((value: Facts) => void)[] = [
    value => { value.local.todos[0].text = 'corrupted neighbor'; },
    value => { delete value.local.todos[0].diagnosticOwnUndefined; },
    value => { value.local.todos[0].diagnosticMinusZero = 0; },
    value => putSetting(value, `capture-review:${a.id}`, { ...a, input: 'lost A' }),
    value => putSetting(value, `capture-review:${b.id}`, { ...b, sessionRevision: 'metadata changed' }),
    value => { value.local.settings.find(row => row.key === `capture-review:${b.id}`)!.unexpected = true; },
    value => { value.local.outbox.push({ entity: 'expenses', payload: { id: 'partial' } }); },
    value => putSetting(value, `capture-applied:${b.id}`, { falseReceipt: true }),
    value => { value.allEvents[0].data!.text = 'rewritten prior history'; },
    value => { value.allEvents.push({ seq: '2', entity: 'expenses', entityId: 'partial', operation: 'upsert', data: { id: 'partial' } }); },
  ];
  for (const change of mutations) { const after = clone(facts); change(after); assert.equal(checks.preserved(facts, after), false); }
  const sameBody = clone(facts); putSetting(sameBody, 'lastPullAt', '2026-10-07T04:00:06.000Z'); assert.equal(checks.preserved(facts, sameBody), true);
  const edited = clone(facts), next = { ...b, diaryExcludedText: 'explicit newly typed value' }; putSetting(edited, `capture-review:${b.id}`, next); putSetting(edited, 'quicknote_review', next);
  const writes = { [`capture-review:${b.id}`]: next, quicknote_review: next }; assert.equal(checks.preserved(facts, edited, { writes }), true);
  putSetting(edited, `capture-review:${a.id}`, next); assert.equal(checks.preserved(facts, edited, { writes }), false);
});

test('One acknowledged Save requires actual receipt-generated IDs, exact selection/source and intact full prior history', () => {
  const { before, after, b, a, window } = committedFixture(); assert.equal(checks.committedExactly(before, after, b, window), true);
  const mutations: ((value: Facts) => void)[] = [
    value => { (checks.setting(value, `capture-applied:${b.id}`).value.result.records as Row[])[1].id = 'exp-0'; },
    value => { value.local.expenses[0].id = 'exp-0'; },
    value => { value.local.expenses[0].amount = 1500; },
    value => { value.local.expenses[0].isIncome = false; },
    value => { value.local.todos[1].dueDate = '2026-10-08'; },
    value => { value.local.todos[0].text = 'neighbor damaged'; },
    value => putSetting(value, `capture-review:${a.id}`, { ...a, diaryExcludedText: 'damaged old A' }),
    value => putSetting(value, `capture-source:${b.id}`, { ...b, inputKey: a.inputKey }),
    value => { value.allEvents[0].data!.text = 'old ledger damaged'; },
    value => { value.allEvents.push({ seq: '5', entity: 'expenses', entityId: 'extra', operation: 'upsert', data: { id: 'extra' } }); },
    value => { value.local.diary.push({ id: 'unselected', content: '合成原文尾记' }); },
    value => putSetting(value, 'sync-version:expenses:durable-expense-ID', '1'),
    value => { value.local.outbox.push({ entity: 'quickNotes', payload: { id: b.id } }); },
    value => { value.allEvents[2].data!.unexplainedMetadata = true; },
  ];
  for (const change of mutations) { const result = clone(after); change(result); assert.equal(checks.committedExactly(before, result, b, window), false); }
  assert.equal(checks.committedExactly(before, after, b, { before: at + 1, after: at + 500 }), false);
});

test('Home allows only its exact new local two-day observation, never broad Coach or source exemptions', () => {
  const { after: before, b } = committedFixture();
  before.local.coachInsights = [{ id: 'old-cloud-insight', title: 'Original', dismissed: false, unknownOriginal: { present: undefined, value: -0 } }];
  before.schema.push({ name: 'coachInsights' });
  const after = clone(before), createdAt = at + 100, row = { id: `ins-${createdAt}-abc1`, type: 'suggestion', title: '按适合你的节奏记录', description: '近7天有2天留下了花销、打卡、日记或速记。记录是为了帮助你回顾，不需要每天完成。', dataSources: ['habit', 'expense', 'diary', 'quicknote'], actionSuggested: '有想留下的事时，再写一句速记', dismissed: false, significance: 0.7, origin: 'local', createdAt };
  after.local.coachInsights.push(row);
  const window = { before: at + 50, after: at + 500 };
  assert.equal(checks.preserved(before, after), false, 'The original whole-source predicate keeps rejecting undeclared writes');
  assert.equal(checks.preservedAfterHome(before, after, b, window), true);
  for (const mutation of [
    (value: Facts) => { value.local.coachInsights[0].title = 'old changed'; },
    (value: Facts) => { delete value.local.coachInsights[0].unknownOriginal; },
    (value: Facts) => { value.local.coachInsights[1].description = row.description.replace('2天', '3天'); },
    (value: Facts) => { value.local.coachInsights[1].unexplained = true; },
    (value: Facts) => { value.local.coachInsights[1].origin = 'cloud'; },
    (value: Facts) => { value.local.coachInsights[1].createdAt = at + 501; },
    (value: Facts) => { value.local.coachInsights.push({ ...row, id: 'extra' }); },
    (value: Facts) => { value.local.todos[0].text = 'neighbor changed'; },
    (value: Facts) => { value.allEvents[0].data!.text = 'history changed'; },
    (value: Facts) => { value.local.settings.push({ key: 'unexplained-setting', value: true }); },
  ]) { const wrong = clone(after); mutation(wrong); assert.equal(checks.preservedAfterHome(before, wrong, b, window), false); }
  const changedBasis = clone(before); changedBasis.local.expenses[0].date = '2026-10-04';
  assert.equal(checks.preservedAfterHome(changedBasis, after, b, window), false);
});

test('Lossless source decoder keeps present undefined, negative zero and extended-array keys distinct', () => {
  const value = decodeCaptureEvidence({ type: 'object', entries: [['present', { type: 'undefined' }], ['minusZero', { type: 'number', value: '-0' }], ['array', { type: 'array', length: 2, entries: [['1', 'kept'], ['extra', 'metadata']] }]] });
  assert.ok(Object.hasOwn(value, 'present')); assert.equal(value.present, undefined); assert.ok(Object.is(value.minusZero, -0));
  assert.equal(Object.hasOwn(value.array, 0), false); assert.equal(value.array.extra, 'metadata'); assert.equal(value.array.length, 2);
  assert.throws(() => decodeCaptureEvidence({ type: 'unknown' }), /Unknown source encoding/);
});

type Fault = { owner: string; id: string; table: string; method: string; hits: { originalCalled: boolean; intendedValue: unknown }[]; aborts: number; commits: number; restored: boolean; expired: boolean; restoredBy: string | null };
const globals = globalThis as unknown as { IDBObjectStore: typeof IDBObjectStore; __captureReturnFault?: Fault; __releaseCaptureReturnQuota?: () => Fault };
test('Real Dexie/IDB abort rolls back a preceding write; quota matches exact DB/table/id and releases before one native retry', async () => {
  const factory = new IDBFactory(); globals.IDBObjectStore = IDBObjectStore;
  const db = new Dexie('youtrace:user:capture-contract:schedule-v1', { indexedDB: factory, IDBKeyRange }); db.version(1).stores({ quickNotes: 'id', expenses: 'id', todos: 'id', settings: 'key', outbox: '++seq' });
  const other = new Dexie('youtrace:user:other-contract:schedule-v1', { indexedDB: factory, IDBKeyRange }); other.version(1).stores({ quickNotes: 'id' });
  await db.open(); await other.open(); const original = IDBObjectStore.prototype.put, value = reviewed(), intended = checks.selectedNote(value, at);
  let originalTargetCalls = 0;
  const observedOriginal: typeof original = function (...args) { if (this.transaction.db.name === db.name && this.name === 'quickNotes' && (args[0] as Row).id === value.id) originalTargetCalls++; return original.apply(this, args); };
  IDBObjectStore.prototype.put = observedOriginal;
  try {
    await db.table('todos').put({ id: 'neighbor', text: 'preserved' }); installCaptureReturnQuota({ owner: 'capture-contract', id: value.id });
    await db.table('quickNotes').put({ id: 'different', note: 'passes' }); await db.table('expenses').put({ id: value.id, note: 'different table passes' }); await other.table('quickNotes').put({ id: value.id, note: 'different account DB passes' });
    const before = await Promise.all(db.tables.map(table => table.toArray()));
    await assert.rejects(db.transaction('rw', db.tables, async () => { await db.table('todos').put({ id: 'neighbor', text: 'must roll back' }); await db.table('quickNotes').put(intended); await db.table('outbox').add({ payload: 'must never queue' }); }), /Synthetic exact QuickNote precommit put quota/);
    // Dexie's rejected promise can precede the queued native abort event.
    // Observe its real terminal callback; never manually abort to manufacture it.
    for (let i = 0; i < 40 && !globals.__captureReturnFault?.aborts; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await Promise.all(db.tables.map(table => table.toArray())), before);
    const fault = globals.__captureReturnFault!; assert.equal(fault.hits.length, 1); assert.equal(originalTargetCalls, 0); assert.equal(fault.aborts, 1); assert.equal(fault.commits, 0); assert.equal(fault.hits[0].originalCalled, false);
    assert.equal(checks.refusalExact(fault, value, { before: at - 1, after: at + 1 }), true);
    assert.equal(checks.refusalExact(fault, { ...value, expenses: [{ ...value.expenses[0], amount: 1500 }, value.expenses[1]] }, { before: at - 1, after: at + 1 }), false);
    for (const mutation of [(x: Fault) => { x.commits = 1; }, (x: Fault) => { x.hits.push(clone(x.hits[0])); }, (x: Fault) => { x.hits[0].originalCalled = true; }, (x: Fault) => { x.expired = true; }, (x: Fault) => { x.id = 'wrong-current-draft'; }]) { const changed = clone(fault); mutation(changed); assert.equal(checks.refusalExact(changed, value, { before: at - 1, after: at + 1 }), false); }
    const released = globals.__releaseCaptureReturnQuota!(); assert.equal(released.restored, true); assert.equal(released.expired, false); assert.equal(released.restoredBy, 'explicit-harness-release'); assert.equal(IDBObjectStore.prototype.put, observedOriginal);
    await db.table('quickNotes').put(intended); assert.equal(originalTargetCalls, 1); assert.deepEqual(await db.table('quickNotes').get(value.id), intended);
  } finally { globals.__releaseCaptureReturnQuota?.(); IDBObjectStore.prototype.put = original; db.close(); other.close(); }
});

test('Native runner refuses local execution before reading a harness or opening a browser', async () => {
  const previous = process.env.GITHUB_ACTIONS; delete process.env.GITHUB_ACTIONS;
  try { await assert.rejects(runCaptureReturnOutcomes({}), /only in authorized hosted CI/); }
  finally { if (previous === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = previous; }
});


test('Complete ledger pages require protocol, boolean termination and exact cursor handoff without assuming globally consecutive IDs', () => {
  const event = (seq: string) => ({ seq, entity: 'todos', entityId: `id-${seq}`, operation: 'upsert', data: { id: `id-${seq}` } });
  const page = { protocol: 2, features: ['goals-v1'], events: [event('1'), event('7')], nextCursor: '7', hasMore: true };
  assert.equal(checks.completeLedgerPage(page, '0'), true);
  assert.equal(checks.completeLedgerPage({ ...page, events: [event('10')], nextCursor: '10', hasMore: false }, '7'), true);
  for (const hasMore of [undefined, null, 0, '', 'false']) assert.equal(checks.completeLedgerPage({ ...page, hasMore }, '0'), false);
  for (const nextCursor of ['0', '1', '9', 7]) assert.equal(checks.completeLedgerPage({ ...page, nextCursor }, '0'), false);
  assert.equal(checks.completeLedgerPage({ ...page, protocol: 99 }, '0'), false);
  assert.equal(checks.completeLedgerPage({ ...page, features: [] }, '0'), false);
  assert.equal(checks.completeLedgerPage({ ...page, events: [], nextCursor: '7', hasMore: false }, '7'), true);
  assert.equal(checks.completeLedgerPage({ ...page, events: [], nextCursor: '7', hasMore: true }, '7'), false);
  assert.equal(checks.completeLedgerPage({ ...page, events: [], nextCursor: '9', hasMore: false }, '7'), false);
  assert.equal(checks.completeLedgerPage(page, '7'), false);
  const { facts, b } = sources(), altered = clone(facts);
  putSetting(altered, 'lastPullAt', 'October 7, 2026'); assert.equal(checks.preserved(facts, altered), false);
  altered.local.settings = clone(facts.local.settings);
  altered.local.settings.find(row => row.key === `capture-review:${b.id}`)!.unrecognizedWrapper = true;
  assert.equal(checks.draftBound(altered, b.id, b), false, 'An unknown review wrapper cannot be silently authorized for whole-row consumption');
});

test('Recovery meaning must be in the read error paragraph; autosave button text cannot supply a retained-draft promise', () => {
  assert.equal(checks.refusalExplained('本机空间不足，所选记录未保存。确认稿已保留在本机，释放空间后请核对并重试保存。'), true);
  assert.equal(checks.refusalExplained('本机空间不足，保存失败。'), false);
  assert.equal(checks.refusalExplained('本机空间不足，保存失败。重试保留修改'), false);
  assert.equal(checks.refusalExplained('本机空间不足，保存失败，确认稿尚未保留。'), false);
  assert.equal(checks.refusalExplained('空间不足，保存失败，修改仍未保留'), false);
  assert.equal(checks.refusalExplained('QuotaExceededError，确认稿仍保留。'), false);
  assert.equal(checks.refusalExplained('确认稿仍保留，请重试保存。'), false);
});
