import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexedDB } from 'fake-indexeddb';
import { habitRecapChecks as checks, readHabitRecap, readHabitRecapLocal } from '../scripts/audit-habit-recap.mjs';

// Pure oracle/read-only snapshot controls. No browser, business fixture, listener,
// provider or native acceptance is created by these tests.
const monday = '2026-10-05', tuesday = '2026-10-06';
const target = { id: 'original-a', name: 'Synthetic 同名', icon: '🏃', frequency: 'weekly', sortOrder: 0 };
const neighbor = { ...target, id: 'original-b', icon: '📚', sortOrder: 1 };
function fixture(phase = 'recorded') {
  const parents = [target, neighbor].map(row => ({ ...row, userId: 'synthetic-owner', createdAt: '2026-10-06T22:00:00.000Z', updatedAt: '2026-10-06T22:00:00.000Z' }));
  const pair = (habitId: string, date: string, done: boolean) => ({ id: `${habitId}|${date}`, habitId, date, done, source: 'manual', confirmed: true, createdAt: Date.parse('2026-10-07T04:00:00.000Z'), updatedAt: Date.parse('2026-10-07T04:00:00.000Z'), unknown: { kept: 'original', ownUndefined: { __habitRecapUndefined: true } } });
  const pairs = [pair(target.id, tuesday, true), pair(neighbor.id, monday, true)];
  const events = [
    ...parents.map((row, index) => ({ seq: String(index + 1), entity: 'habits', entityId: row.id, operation: 'upsert', data: { ...row } })),
    ...pairs.map((row, index) => ({ seq: String(index + 3), entity: 'habitCheckins', entityId: row.id, operation: 'upsert', data: { ...row, id: `canonical-${index}`, updatedAt: new Date(row.updatedAt).toISOString() } })),
  ];
  if (phase === 'undone') {
    pairs.push(pair(target.id, monday, true)); pairs[0].done = false; pairs[0].updatedAt += 1000;
    for (const [index, row] of [pairs[2], pairs[0]].entries()) events.push({ seq: String(index + 5), entity: 'habitCheckins', entityId: row.id, operation: 'upsert', data: { ...row, id: index === 0 ? 'canonical-2' : 'canonical-0', updatedAt: new Date(row.updatedAt).toISOString() } });
  }
  const versions = new Map(events.map(event => [`sync-version:${event.entity}:${event.entityId}`, event.seq]));
  return { local: { habits: structuredClone([target, neighbor]), habitCheckins: structuredClone(pairs), settings: [...versions].map(([key, value]) => ({ key, value })), outbox: [] }, server: structuredClone(parents), events };
}
const sourceOptions = (phase: string) => ({ target, neighbor, phase, ownerId: 'synthetic-owner' });

test('Retained dated true facts deduplicate parents and exclude false, orphans and other dates', () => {
  const rows = [
    { habitId: target.id, date: tuesday, done: true }, { habitId: target.id, date: tuesday, done: true },
    { habitId: neighbor.id, date: monday, done: true }, { habitId: neighbor.id, date: tuesday, done: false },
    { habitId: 'missing-parent', date: tuesday, done: true }, { habitId: neighbor.id, date: tuesday, done: 'true' },
  ];
  assert.deepEqual(checks.recordedFacts([target, neighbor], rows, tuesday), { reviewDate: tuesday, done: 1, habitIds: [target.id] });
  assert.equal(checks.recordedFacts([neighbor], rows, tuesday).done, 0);
  assert.equal(checks.recordedFacts([target, neighbor], rows.map(row => ({ ...row, done: false })), tuesday).done, 0);
  assert.throws(() => checks.recordedFacts([target], rows, '2026-02-30'));
});

test('Both original endpoints need two owned parents and exact pair ACKs, including retained false undo', () => {
  const first = fixture(), second = fixture('undone');
  assert.equal(checks.assertSources(first, sourceOptions('recorded')).done, 1);
  const expected = checks.assertSources(second, sourceOptions('undone'));
  assert.equal(expected.done, 0); assert.deepEqual(expected.currentWeek, { done: 2, total: 2, from: monday, through: '2026-10-11' });
  assert.equal(checks.undoTransition(first, second, target.id), true);
  const wrongOwner = structuredClone(first); wrongOwner.events[0].data.userId = 'different-owner';
  const wrongVersion = structuredClone(first); wrongVersion.local.settings.at(-1)!.value = '88';
  const wrongDate = structuredClone(first); wrongDate.local.habitCheckins[0].date = monday;
  const wrongParent = structuredClone(first); wrongParent.local.habitCheckins[0].habitId = neighbor.id;
  const falseCounted = structuredClone(first); falseCounted.local.habitCheckins[0].done = false;
  for (const bad of [wrongOwner, wrongVersion, wrongDate, wrongParent, falseCounted]) assert.throws(() => checks.assertSources(bad, sourceOptions('recorded')));
  const lostFalse = structuredClone(second); lostFalse.local.habitCheckins.shift();
  assert.throws(() => checks.assertSources(lostFalse, sourceOptions('undone')));
  const changedMonday = structuredClone(second); changedMonday.local.habitCheckins[1].unknown.kept = 'changed';
  assert.equal(checks.undoTransition(first, changedMonday, target.id), false);
  const lostTuesdayField = structuredClone(second); delete (lostTuesdayField.local.habitCheckins[0] as Partial<typeof lostTuesdayField.local.habitCheckins[0]>).unknown;
  const changedTuesdayField = structuredClone(second); changedTuesdayField.local.habitCheckins[0].unknown.kept = 'changed';
  const changedCanonical = structuredClone(second); changedCanonical.events.at(-1)!.data.unknown = { kept: 'changed' };
  const invalidTime = structuredClone(second); invalidTime.local.habitCheckins[0].updatedAt = 0;
  const backwardTime = structuredClone(second); backwardTime.events.at(-1)!.data.updatedAt = '2026-10-06T04:00:00.000Z';
  const changedCreatedAt = structuredClone(second); changedCreatedAt.local.habitCheckins[0].createdAt++;
  const changedCanonicalCreatedAt = structuredClone(second); changedCanonicalCreatedAt.events.at(-1)!.data.createdAt++;
  const changedCanonicalId = structuredClone(second); changedCanonicalId.events.at(-1)!.data.id = 'replacement-canonical-id';
  for (const changed of [lostTuesdayField, changedTuesdayField, changedCanonical, invalidTime, backwardTime, changedCreatedAt, changedCanonicalCreatedAt, changedCanonicalId]) assert.equal(checks.undoTransition(first, changed, target.id), false);
});

test('Full source preservation rejects unknown-field, false-row, Monday, version, outbox and ledger changes', () => {
  const before = fixture('undone'); assert.equal(checks.sourcesPreserved(before, structuredClone(before)), true);
  const unknown = structuredClone(before); unknown.local.habitCheckins[0].unknown.kept = 'changed';
  const falseRow = structuredClone(before); falseRow.local.habitCheckins[0].done = true;
  const mondayRow = structuredClone(before); mondayRow.local.habitCheckins[2].done = false;
  const version = structuredClone(before); version.local.settings[0].value = '88';
  const ledger = structuredClone(before); ledger.events[0].data.name = 'changed';
  const extraEvent = structuredClone(before); extraEvent.events.push({ ...extraEvent.events[0], seq: '7', entity: 'todos' });
  for (const changed of [unknown, falseRow, mondayRow, version, ledger, extraEvent]) assert.equal(checks.sourcesPreserved(before, changed), false);
  assert.equal(checks.sourcesPreserved(before, { ...before, local: { ...before.local, outbox: [{ entity: 'habits' }] } }), false);
});

test('A current real response binds zero to yesterday; ratio, cached dates and local/placeholder labels stay red', () => {
  const expected = checks.assertSources(fixture('undone'), sourceOptions('undone'));
  const config = { instant: '2026-10-07T04:00:00.000Z', wallMs: 100, kind: 'controlled-test-Date-v1' };
  const before = { instant: '2026-10-07T04:00:10.000Z', config }, after = { instant: '2026-10-07T04:00:12.000Z', config };
  const brief = { generatedAt: '2026-10-07T04:00:11.000Z', reviewDate: tuesday, yesterdayReview: { habits: { done: 0, total: 2 } } };
  const fields = { date: { visible: true, text: `${tuesday} 记录回顾` }, provenance: { visible: true, text: '云端已同步记录 · 读取于 2026/10/07 12:00（北京时间）' }, habits: { visible: true, text: '已记录支出 ¥0.00，共0笔 · 该日记为已打卡的习惯 0 项' } };
  assert.equal(checks.responseMatches(brief, expected, before, after, config), true);
  assert.equal(checks.responseAttributed({ ...brief, yesterdayReview: { habits: { done: 1, total: 2 } } }, expected, before, after, config), true, 'Wrong count is content RED after response ownership/date is established');
  for (const changed of [undefined, {}, { ...brief, reviewDate: monday }, { ...brief, generatedAt: '2026-10-07T03:58:00.000Z' }]) assert.equal(checks.responseAttributed(changed, expected, before, after, config), false);
  assert.equal(checks.responseMatches({ ...brief, yesterdayReview: { habits: { done: 0, total: 999 } } }, expected, before, after, config), true, 'total is context only, never a historical denominator');
  assert.equal(checks.readingMatches(fields, expected, brief, true), true);
  for (const text of ['习惯完成 0/2', '习惯完成 1/2', '该日记为已打卡的习惯 1 项', '该日记为已打卡的习惯 0.1 项', '该日记为已打卡的习惯 0 项，习惯完成0/2']) assert.equal(checks.readingMatches({ ...fields, habits: { visible: true, text } }, expected, brief, true), false);
  assert.equal(checks.readingMatches(fields, expected, brief, false), false);
  assert.equal(checks.readingMatches({ ...fields, date: { visible: true, text: '2026-10-05 记录回顾' } }, expected, brief, true), false);
  for (const text of ['正在读取记录…', '本机记录 · 读取于 2026/10/07 12:00（北京时间）']) assert.equal(checks.readingMatches({ ...fields, provenance: { visible: true, text } }, expected, brief, true), false);
  for (const changed of [{ ...brief, reviewDate: monday }, { ...brief, generatedAt: '2026-10-07T03:58:00.000Z' }, { ...brief, yesterdayReview: { habits: { done: 1, total: 2 } } }]) assert.equal(checks.responseMatches(changed, expected, before, after, config), false);
  assert.equal(checks.responseMatches(brief, expected, before, { ...after, config: { ...config, wallMs: 101 } }, config), false);
});

test('Readonly browser-side capture keeps own undefined and separate Coach rows, rejects unsupported source shapes', async () => {
  const capture = new Function('indexedDB', `return (${readHabitRecapLocal.toString()});`)(indexedDB) as (owner: string) => Promise<string>;
  const owner = 'synthetic-recap-test', name = `youtrace:user:${owner}:schedule-v1`, tables = ['habits', 'habitCheckins', 'settings', 'outbox', 'coachInsights', 'coachPushes'];
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { for (const table of tables) request.result.createObjectStore(table, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const put = (table: string, metadata: unknown) => new Promise<void>((resolve, reject) => { const tx = db.transaction(table, 'readwrite'); tx.objectStore(table).put({ id: 'synthetic', metadata }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  try {
    for (const table of tables) await put(table, { own: undefined, nested: ['kept', undefined] });
    const captured = JSON.parse(await capture(owner));
    for (const table of tables) assert.deepEqual(captured[table][0].metadata, { own: { __habitRecapUndefined: true }, nested: ['kept', { __habitRecapUndefined: true }] });
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    for (const bad of [Object.assign(new Array(2), { 0: 'kept', extra: 'hidden' }), new Date(), -0, { __habitRecapUndefined: true }, cyclic]) {
      await put('habitCheckins', bad); await assert.rejects(capture(owner), /Unsupported/);
    }
  } finally {
    db.close(); await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  }
});

test('Attribution failures retain original responses and stop return; attributed reader RED still returns to the original journey', async () => {
  const config = { kind: 'controlled-test-Date-v1', instant: '2026-10-07T04:00:00.000Z', wallMs: 100 };
  const brief = { generatedAt: '2026-10-07T04:00:10.000Z', reviewDate: tuesday, yesterdayReview: { habits: { done: 1, total: 2 } } };
  for (const scenario of [
    { name: 'HTTP failure', status: 500, text: JSON.stringify({ brief }), blocked: true },
    { name: 'Incomplete body', status: 200, text: '', bodyError: true, blocked: true },
    { name: 'Malformed JSON', status: 200, text: '{', blocked: true },
    { name: 'Wrong response date', status: 200, text: JSON.stringify({ brief: { ...brief, reviewDate: monday } }), blocked: true },
    { name: 'No native request', status: 200, text: '', navigationError: true, blocked: true },
    { name: 'Old reader content', status: 200, text: JSON.stringify({ brief }), blocked: false },
    { name: 'Wrong response count', status: 200, text: JSON.stringify({ brief: { ...brief, yesterdayReview: { habits: { done: 9, total: 2 } } } }), blocked: false },
    { name: 'Source changes during return', status: 200, text: JSON.stringify({ brief }), returnMutation: true, blocked: true },
  ]) {
    const source = fixture();
    const listeners = new Map<string, (event: unknown) => void>(), saved = new Map<string, string>(); let returned = 0, consumed = 0;
    const request = { method: () => 'GET', url: () => 'https://synthetic.invalid/api/coach/brief' };
    const response = { request: () => request, status: () => scenario.status, text: () => { consumed++; return scenario.bodyError ? Promise.reject(new Error('Synthetic truncated body')) : Promise.resolve(scenario.text); } };
    const page = {
      evaluate: async (fn: unknown) => fn === readHabitRecapLocal ? JSON.stringify({ ...source.local, coachInsights: [], coachPushes: [] }) : { instant: '2026-10-07T04:00:10.000Z', config },
      on: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), off: (name: string) => listeners.delete(name),
      waitForFunction: async () => { throw new Error('Synthetic reader paragraphs unavailable'); },
    };
    const h = { habitClock: config, artifacts: 'synthetic', join: (...parts: string[]) => parts.join('/'), writeFile: async (path: string, value: string) => { saved.set(path, value); }, observe: async () => undefined, capture: async () => undefined, pointer: async () => undefined };
    const operation = readHabitRecap(h, { page, api: { ownerId: 'synthetic-owner' }, target, neighbor, label: 'test', phase: 'recorded', originalFacts: source, facts: async () => source,
      home: async () => { if (scenario.navigationError) throw new Error('Synthetic navigation produced no native request'); listeners.get('request')!(request); listeners.get('response')!(response); assert.equal(consumed, 1, 'Response body consumption starts at the response event'); },
      enter: async () => { returned++; if (scenario.returnMutation) source.local.habitCheckins[0].unknown.kept = 'changed during return'; }, readControl: async () => undefined, readable: async () => undefined,
    });
    if (scenario.blocked) await assert.rejects(operation); else await operation;
    assert.equal(returned, scenario.blocked && !scenario.returnMutation ? 0 : 1, scenario.name);
    assert.equal(listeners.size, 0); assert.ok([...saved.keys()].some(path => path.endsWith('-after-sources.json')));
    if (scenario.blocked && !scenario.returnMutation) {
      const failure = [...saved].find(([path]) => path.endsWith('-request-attribution-blocked.json'));
      assert.ok(failure, scenario.name);
      const evidence = JSON.parse(failure[1]);
      if (!scenario.navigationError && !scenario.bodyError) assert.equal(evidence.responses[0].text, scenario.text, 'Retain the actual malformed/error response unchanged');
    }
  }
});

test('A missing required local table rejects promptly and closes the audit connection', async () => {
  const owner = 'synthetic-recap-missing-table', name = `youtrace:user:${owner}:schedule-v1`; let closed = 0;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('habits', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  db.close();
  const countedIDB = { open: (database: string) => {
    const request = indexedDB.open(database);
    request.addEventListener('success', () => { const close = request.result.close.bind(request.result); request.result.close = () => { closed++; close(); }; });
    return request;
  } };
  const capture = new Function('indexedDB', `return (${readHabitRecapLocal.toString()});`)(countedIDB) as (owner: string) => Promise<string>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = new Promise<string>((_, reject) => { timer = setTimeout(() => reject(new Error('Audit snapshot hung instead of rejecting its missing table')), 250); });
    await assert.rejects(Promise.race([capture(owner), limit]), { name: 'NotFoundError' }); assert.equal(closed, 1);
  } finally {
    clearTimeout(timer); await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  }
});
