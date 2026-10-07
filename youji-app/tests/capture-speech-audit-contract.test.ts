import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { captureSpeechChecks as checks, installCaptureSpeechFixture, runCaptureSpeechTail } from '../scripts/audit-capture-speech.mjs';
import type { CaptureDraft } from '../src/services/quickNoteIntegration.ts';

type Row = Record<string, unknown>;
type Setting = { key: string; value: unknown; [key: string]: unknown };
type Facts = { databaseName: string; version: number; schema: { name: string }[]; local: Record<string, Row[]> & { settings: Setting[]; quickNotes: Row[] }; allEvents: { seq: string; entity: string; entityId: string; operation: string; data: Row | null }[] };
const clone = structuredClone;
const context = { capturedAt: Date.parse('2026-10-07T04:00:05Z'), timeZone: 'Asia/Shanghai', date: '2026-10-06' };
const actor = { ownerId: 'synthetic-speech-contract', dataEpoch: 'initial', sessionRevision: 'synthetic-revision', sessionActive: true };
const raw = '明天交报销单；午饭15元；合成语音尾句', key = 'capture-input:speech-fork';
function expected(): CaptureDraft {
  return { id: 'speech-review', inputKey: key, input: raw, context, ...actor,
    expenses: [{ id: 'exp-0', name: '午饭', amount: 1500, category: 'food', confirmed: true, date: '2026-10-06', currency: 'CNY', isIncome: false }],
    todos: [{ id: 'todo-0', text: '交报销单', confirmed: true, dueDate: '2026-10-07', dateUncertain: false }],
    habits: [], diary: '合成语音尾句', diaryDate: '2026-10-06', mood: null, moodScore: null, moodConfirmed: false };
}
function put(facts: Facts, name: string, value: unknown) { facts.local.settings = [...facts.local.settings.filter(row => row.key !== name), { key: name, value }]; }
function fixture() {
  const names = ['_accountGeneration', 'schedules', 'expenses', 'todos', 'habits', 'habitCheckins', 'quickNotes', 'diary', 'settings', 'coachInsights', 'coachPushes', 'goals', 'goalRecords', 'outbox'];
  const local = Object.fromEntries(names.map(name => [name, []])) as Facts['local'];
  local.todos.push({ id: 'old-todo', text: '合成邻居', ownUndefined: undefined, minusZero: -0 });
  local.quickNotes.push({ id: 'already-saved', rawInput: '合成旧原文' });
  const before: Facts = { databaseName: 'youtrace:user:synthetic-speech-contract:schedule-v1', version: 1, schema: names.map(name => ({ name })), local,
    allEvents: [{ seq: '7', entity: 'todos', entityId: 'old-todo', operation: 'upsert', data: { id: 'old-todo', text: '合成邻居', unknown: { preserved: true } } }] };
  for (const id of ['O', 'R', 'D']) {
    const draft = { ...expected(), id, inputKey: `capture-input:${id}`, input: `合成旧${id}原文`, unknownOwn: undefined, expenses: [{ ...expected().expenses[0], amount: 1625, amountText: '16.25' }] };
    put(before, `capture-review:${id}`, draft); put(before, draft.inputKey, draft.input); put(before, `${draft.inputKey}:context`, context); put(before, 'quicknote_review', draft);
  }
  put(before, 'capture-source:already-saved', { original: 'kept' }); put(before, 'capture-applied:already-saved', { receipt: 'kept' });
  put(before, key, '明天交报销单；'); put(before, `${key}:context`, context);
  const after = clone(before), draft = expected(); put(after, key, raw); put(after, `capture-review:${draft.id}`, draft); put(after, 'quicknote_review', draft);
  return { before, after, draft };
}

test('The speech oracle requires a complete literal A+B draft with inherited D date, source and fresh choices', () => {
  const { before, after, draft } = fixture(); assert.equal(Object.keys(before.local).length, 14);
  assert.deepEqual(checks.expectedDraft(draft.id, key, context, actor), expected()); assert.equal(checks.reviewExactly(before, after, draft), true);
  const mutations: ((value: CaptureDraft) => void)[] = [
    value => { value.input = '明天交报销单；'; value.expenses = []; value.diary = null; },
    value => { value.input += '午饭15元；合成语音尾句'; },
    value => { value.inputKey = 'capture-input:D'; },
    value => { value.context = { ...context, capturedAt: context.capturedAt + 1 }; },
    value => { value.expenses[0].amount = 1625; },
    value => { value.expenses[0].date = '2026-10-07'; },
    value => { value.expenses[0].currency = undefined; },
    value => { value.expenses[0].confirmed = false; },
    value => { value.todos[0].dueDate = '2026-10-08'; },
    value => { value.diary = null; },
    value => { value.diaryDate = '2026-10-07'; },
    value => { value.sessionRevision = 'different-session'; },
  ];
  for (const mutate of mutations) {
    const wrong = clone(after), observed = clone(draft); mutate(observed); put(wrong, `capture-review:${draft.id}`, observed); put(wrong, 'quicknote_review', observed);
    assert.equal(checks.reviewExactly(before, wrong, draft), false);
  }
  const lostRaw = clone(after); put(lostRaw, key, '明天交报销单；'); assert.equal(checks.reviewExactly(before, lostRaw, draft), false);
  const occupied = clone(before); put(occupied, `capture-review:${draft.id}`, undefined); assert.equal(checks.reviewExactly(occupied, after, draft), false);
});

test('Every prior table, physical setting and full ledger remains protected while only final raw and the new review may change', () => {
  const { before, after, draft } = fixture();
  for (const name of Object.keys(before.local).filter(name => name !== 'settings')) {
    const wrong = clone(after); wrong.local[name].push({ id: 'undeclared-write', extra: undefined }); assert.equal(checks.reviewExactly(before, wrong, draft), false, name);
  }
  const mutations: ((value: Facts) => void)[] = [
    value => put(value, 'capture-review:O', { lostOriginal: true }),
    value => put(value, 'capture-input:R', raw),
    value => put(value, 'capture-input:D:context', { ...context, date: '2026-10-07' }),
    value => put(value, `${key}:context`, { ...context, capturedAt: context.capturedAt + 1 }),
    value => put(value, 'capture-input:extra', raw),
    value => put(value, 'capture-source:already-saved', { altered: true }),
    value => put(value, 'capture-applied:already-saved', { altered: true }),
    value => put(value, `capture-source:${draft.id}`, draft),
    value => put(value, `capture-applied:${draft.id}`, { accidentalSave: true }),
    value => put(value, 'quicknote_review', { id: 'D' }),
    value => { value.local.settings.find(row => row.key === key)!.undeclaredOwn = undefined; },
    value => { delete value.local.todos[0].ownUndefined; },
    value => { value.local.todos[0].minusZero = 0; },
    value => { value.allEvents[0].data!.text = 'rewritten history'; },
    value => { value.allEvents.push({ seq: '9', entity: 'quickNotes', entityId: draft.id, operation: 'upsert', data: { id: draft.id } }); },
  ];
  for (const mutate of mutations) { const wrong = clone(after); mutate(wrong); assert.equal(checks.reviewExactly(before, wrong, draft), false); }
});

type TraceEvent = { sequence: number; kind: string; instance: number; at: number; configuration?: Row; result?: { resultIndex: number; results: { isFinal: boolean; transcript: string }[]; callbackPresent: boolean }; callbackPresent?: boolean };
type Trace = { kind: string; finalText: string; instances: number; events: TraceEvent[]; observedAt: number };
function traces() {
  const events: TraceEvent[] = ['construct', 'start', 'stop', 'stop-return', 'result', 'result-return', 'end', 'end-return'].map((kind, index) => ({ sequence: index + 1, kind, instance: 1, at: index + 1 }));
  events[1].configuration = { lang: 'zh-CN', continuous: true, interimResults: true, resultHandler: true, endHandler: true, errorHandler: true };
  events[4].result = { resultIndex: 0, results: [{ isFinal: true, transcript: '午饭15元；合成语音尾句' }], callbackPresent: true }; events[6].callbackPresent = true;
  const after: Trace = { kind: 'synthetic-stop-final-end', finalText: '午饭15元；合成语音尾句', instances: 1, events, observedAt: 9 };
  return { before: { ...clone(after), events: clone(events.slice(0, 2)), observedAt: 2.5 }, after };
}
test('Callback evidence rejects early/missing/duplicate results, extra stops, mismatched instances and false timing or callback claims', () => {
  const { before, after } = traces(); assert.equal(checks.preSubmitExactly(before), true); assert.equal(checks.eventsExactly(before, after), true);
  const early = clone(after); early.events = early.events.slice(0, 5); assert.equal(checks.preSubmitExactly(early), false);
  const mutations: ((value: Trace) => void)[] = [
    value => { value.events.splice(4, 2); },
    value => { value.events.splice(4, 0, clone(value.events[4])); },
    value => { value.events.push({ ...value.events[2], sequence: 9, at: 8.5 }); },
    value => { [value.events[4], value.events[6]] = [value.events[6], value.events[4]]; },
    value => { value.events[4].instance = 2; },
    value => { value.instances = 2; },
    value => { value.events[2].at = 2.4; },
    value => { value.events[4].at = Number.NaN; },
    value => { value.events[4].result!.results[0].transcript = ''; },
    value => { value.events[4].result!.results[0].isFinal = false; },
    value => { value.events[4].result!.callbackPresent = false; },
    value => { value.events[6].callbackPresent = false; },
  ];
  for (const mutate of mutations) { const wrong = clone(after); mutate(wrong); assert.equal(checks.eventsExactly(before, wrong), false); }
});

test('Serialized fixture emits nothing until actual stop, schedules a later task, logs every duplicate and restores accessor/absence exactly', () => {
  type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: (event: { results: { 0: { transcript: string } }[] }) => void; onerror: () => void; onend: () => void; start(): void; stop(): void };
  const tasks = new Map<number, () => void>(); let timer = 0, now = 0;
  const sandbox = { EventTarget, performance: { now: () => ++now }, setTimeout: (job: () => void) => { tasks.set(++timer, job); return timer; }, clearTimeout: (id: number) => tasks.delete(id) } as Record<string, unknown>;
  const getter = () => 'original browser constructor'; Object.defineProperty(sandbox, 'SpeechRecognition', { configurable: true, enumerable: true, get: getter });
  const prior = Object.getOwnPropertyDescriptor(sandbox, 'SpeechRecognition');
  runInNewContext(`(${installCaptureSpeechFixture.toString()})({ finalText: '午饭15元；合成语音尾句' })`, sandbox);
  const scope = sandbox as unknown as { SpeechRecognition: new () => Recognition; __captureSpeechFixture: { snapshot(): Trace }; __releaseCaptureSpeechFixture(): Trace & { restored: boolean; pendingTimers: number; descriptorRestoration: { exact: boolean }[] } };
  const received: string[] = [], recognition = new scope.SpeechRecognition();
  recognition.lang = 'zh-CN'; recognition.continuous = true; recognition.interimResults = true;
  recognition.onresult = event => received.push(event.results[0][0].transcript); recognition.onerror = () => received.push('error'); recognition.onend = () => received.push('end');
  recognition.start(); const before = clone(scope.__captureSpeechFixture.snapshot()); assert.equal(checks.preSubmitExactly(before), true); assert.equal(tasks.size, 0);
  recognition.stop(); assert.deepEqual(received, []); assert.equal(tasks.size, 1);
  const [id, job] = [...tasks][0]; tasks.delete(id); job(); const after = clone(scope.__captureSpeechFixture.snapshot());
  assert.deepEqual(received, ['午饭15元；合成语音尾句', 'end']); assert.equal(checks.eventsExactly(before, after), true);
  recognition.stop(); assert.equal(checks.eventsExactly(before, clone(scope.__captureSpeechFixture.snapshot())), false);
  const restored = scope.__releaseCaptureSpeechFixture(); assert.equal(restored.pendingTimers, 1); assert.equal(tasks.size, 0); assert.equal(restored.restored, true); assert.ok(restored.descriptorRestoration.every(row => row.exact));
  assert.deepEqual(Object.getOwnPropertyDescriptor(sandbox, 'SpeechRecognition'), prior); assert.equal(Object.hasOwn(sandbox, 'webkitSpeechRecognition'), false);
  assert.equal(Object.hasOwn(sandbox, '__captureSpeechFixture'), false); assert.equal(Object.hasOwn(sandbox, '__releaseCaptureSpeechFixture'), false);
});

test('The speech tail rejects local native execution before touching its harness', async () => {
  const previous = process.env.GITHUB_ACTIONS; delete process.env.GITHUB_ACTIONS;
  try { await assert.rejects(runCaptureSpeechTail({}), /only in authorized hosted CI/); }
  finally { if (previous === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = previous; }
});
