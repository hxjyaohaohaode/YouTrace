import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { scheduleKeyboardChecks as checks, readScheduleSource } from '../scripts/audit-schedule-keyboard.mjs';

// Pure rejection witnesses and fake-IDB reads only. These do not establish real
// key delivery, painted focus, browser behavior, media acceptance or durability.
const stamp = Date.parse('2026-10-06T12:00:00.000Z');
const date = '2026-10-07', id = 'original', owner = 'synthetic-owner';
type Setting = { key: string; value: unknown };
const row = (key: string, start: string, end: string) => ({ id: key, title: 'Synthetic 第二页已核对', date, startTime: start, endTime: end, location: 'Synthetic 删除失败后仍需保留的草稿', type: 'other', repeat: 'none', remind: 0,
  createdAt: stamp - 1000, updatedAt: stamp - 1000, unknown: { preserve: ['all', 'old', 'fields'], nullable: null }, exceptions: [] as { occurrenceDate: string; date: string; cancelled: boolean; title: string }[] });
function sources() {
  const schedules = [row(id, '09:00', '10:00'), row('early', '06:15', '06:45'), row('late', '23:15', '23:45'), { ...row('weekly', '11:00', '12:00'), repeat: 'weekly', exceptions: [{ occurrenceDate: '2026-10-14', date: '2026-10-06', cancelled: true, title: 'old exception' }] }];
  const server = schedules.map(source => ({ ...structuredClone(source), userId: owner, createdAt: new Date(stamp - 900).toISOString(), updatedAt: new Date(stamp - 900).toISOString() }));
  const events = server.map((data, index) => ({ seq: String(index * 2 + 1), entity: 'schedules', entityId: data.id, operation: 'upsert', data: structuredClone(data) }));
  const settings: Setting[] = schedules.map((source, i) => ({ key: `sync-version:schedules:${source.id}`, value: events[i].seq }));
  settings.push({ key: 'syncV2Cursor', value: '7' }, { key: 'lastPullAt', value: new Date(stamp - 100).toISOString() }, { key: 'lastPushAt', value: new Date(stamp - 100).toISOString() },
    { key: 'record-draft:schedule:weekly@2026-10-14', value: { revision: 'b'.repeat(32), value: { old: 'retain this complete draft' } } }, { key: 'unrelated-setting', value: { a: ['retained'] } }, { key: 'sync-version:todos:old-todo', value: '8' });
  const unrelated = { seq: '8', entity: 'todos', entityId: 'old-todo', operation: 'upsert', data: { text: 'retain old all-entity ledger' } };
  return { owner, local: { schedules, settings, outbox: [] as { seq: number }[] }, server, events, allEvents: [...structuredClone(events), unrelated], sample: { driverStart: stamp, driverEnd: stamp + 20, browserStart: stamp, browserEnd: stamp + 20 } };
}
const key = `record-draft:schedule:${id}@${date}`;
function preparedSources() {
  const before = sources(), prepared = structuredClone(before);
  prepared.sample = { driverStart: stamp + 100, driverEnd: stamp + 120, browserStart: stamp + 100, browserEnd: stamp + 120 };
  prepared.local.settings.push({ key, value: { revision: 'a'.repeat(32), value: checks.expectedForm(before.local.schedules[0], true) } });
  return { before, prepared };
}
function save() {
  const { before, prepared } = preparedSources(), after = structuredClone(prepared);
  after.sample = { driverStart: stamp + 400, driverEnd: stamp + 500, browserStart: stamp + 400, browserEnd: stamp + 500 };
  Object.assign(after.local.schedules[0], { startTime: '09:15', endTime: '10:15', updatedAt: stamp + 300 });
  Object.assign(after.server[0], { startTime: '09:15', endTime: '10:15', updatedAt: new Date(stamp + 310).toISOString() });
  after.local.settings = after.local.settings.filter(row => row.key !== key);
  after.local.settings.find(row => row.key === `sync-version:schedules:${id}`)!.value = '12';
  after.local.settings.find(row => row.key === 'lastPushAt')!.value = new Date(stamp + 350).toISOString();
  const event = { seq: '12', entity: 'schedules', entityId: id, operation: 'upsert', data: structuredClone(after.server[0]) };
  after.events.push(event); after.allEvents.push(structuredClone(event));
  return { before, prepared, after };
}
const envelope = (facts: ReturnType<typeof sources>) => facts.local.settings.find(row => row.key === key)!.value as { revision: string; value: ReturnType<typeof checks.expectedForm> };

test('Initial ACK binds canonical business fields, complete latest event and exact target version with distinct local/server timestamp shapes', () => {
  const before = sources(); assert.equal(checks.acknowledged(before, id), true);
  for (const mutate of [
    (copy: typeof before) => { copy.local.schedules[0].title = 'wrong title'; },
    (copy: typeof before) => { copy.server[0].date = '2026-10-08'; },
    (copy: typeof before) => { copy.local.settings[0].value = '2'; },
    (copy: typeof before) => { copy.local.settings[0].value = '01'; },
    (copy: typeof before) => { copy.local.schedules[0].updatedAt = NaN; },
    (copy: typeof before) => { copy.server[0].updatedAt = String(stamp); },
    (copy: typeof before) => { copy.server[0].userId = 'other'; },
    (copy: typeof before) => { copy.events[0].operation = 'delete'; },
    (copy: typeof before) => { copy.local.outbox.push({ seq: 1 }); },
    (copy: typeof before) => { copy.local.settings.push({ key: 'syncV2Batch', value: {} }); },
    (copy: typeof before) => { copy.local.settings.push({ key: 'sync-conflict:schedules:weekly', value: {} }); },
    (copy: typeof before) => { copy.local.schedules.push(copy.local.schedules[0]); },
    (copy: typeof before) => { copy.local.settings.push(copy.local.settings[0]); },
  ]) { const copy = structuredClone(before); mutate(copy); assert.equal(checks.acknowledged(copy, id), false); }
});

test('Typing adds only the exact full target envelope and untouched canonical base', () => {
  const { before, prepared } = preparedSources(); assert.equal(checks.draftWriteResult(before, prepared, id).pass, true);
  const invalid = (mutate: (copy: typeof prepared) => void) => { const copy = structuredClone(prepared); mutate(copy); assert.equal(checks.draftWriteResult(before, copy, id).pass, false); };
  for (const patch of [{ date: '2026-10-08' }, { occurrenceDate: '2026-10-08' }, { id: 'late' }, { title: 'stale native-created title' }, { location: 'stale location' }, { startTime: '09:00' }, { endTime: '10:00' }, { remind: 15 }, { repeat: 'weekly' }, { scope: 'occurrence' }, { extra: 'unknown draft addition' }]) invalid(copy => { Object.assign(envelope(copy).value, patch); });
  invalid(copy => { envelope(copy).value.base.title = 'wrong base'; });
  invalid(copy => { delete envelope(copy).value.base.unknown; });
  invalid(copy => { envelope(copy).revision = 'not-generated'; });
  invalid(copy => { Object.assign(envelope(copy), { revision: ['a'.repeat(32)] }); });
  invalid(copy => { Object.assign(envelope(copy), { extra: true }); });
  invalid(copy => { copy.local.settings.at(-1)!.key = 'record-draft:schedule:original@2026-10-08'; });
  invalid(copy => { copy.local.settings.push(copy.local.settings.at(-1)!); });
  invalid(copy => { copy.local.schedules[1].startTime = '07:15'; });
  invalid(copy => { copy.local.schedules[3].exceptions[0].cancelled = false; });
  invalid(copy => { copy.allEvents.at(-1)!.entityId = 'changed-old-todo'; });
  invalid(copy => { copy.local.settings.find(row => row.key === 'unrelated-setting')!.value = 'lost'; });
  invalid(copy => { copy.local.settings.find(row => row.key.startsWith('record-draft:schedule:weekly'))!.value = {}; });
  invalid(copy => { copy.server[0].unknown.preserve.pop(); });
  const oldDraft = structuredClone(before); oldDraft.local.settings.push(structuredClone(prepared.local.settings.at(-1)!));
  assert.equal(checks.draftWriteResult(oldDraft, prepared, id).pass, false);
  assert.equal(checks.sourcesPreserved(prepared, structuredClone(prepared)), true, 'Escape/reopen retain the exact full envelope');
  const changedRevision = structuredClone(prepared); envelope(changedRevision).revision = 'c'.repeat(32);
  assert.equal(checks.sourcesPreserved(prepared, changedRevision), false);
});

test('Single Save changes only target times and bounded timestamp, consumes its draft, and appends one exact acknowledged upsert', () => {
  const { before, prepared, after } = save(); assert.equal(checks.savedResult(before, prepared, after, id).pass, true, 'Sequence may have a gap; never require global +1');
  const invalid = (mutate: (copy: typeof after) => void) => { const copy = structuredClone(after); mutate(copy); assert.equal(checks.savedResult(before, prepared, copy, id).pass, false); };
  invalid(copy => { copy.local.schedules[0].date = '2026-10-08'; });
  invalid(copy => { copy.local.schedules[0].title = 'renamed'; });
  invalid(copy => { copy.local.schedules[0].startTime = '09:30'; });
  invalid(copy => { copy.local.schedules[0].unknown.preserve.pop(); });
  invalid(copy => { copy.local.schedules[1].endTime = '06:50'; });
  invalid(copy => { copy.local.schedules[3].exceptions = []; });
  invalid(copy => { copy.local.schedules[0].updatedAt = stamp - 1; });
  invalid(copy => { copy.local.schedules[0].updatedAt = stamp + 501; });
  invalid(copy => { copy.server[0].updatedAt = '2026-10-07T12:00:00.000Z'; copy.allEvents.at(-1)!.data = structuredClone(copy.server[0]); copy.events.at(-1)!.data = structuredClone(copy.server[0]); });
  invalid(copy => { copy.local.settings[0].value = '11'; });
  invalid(copy => { copy.local.settings.push(structuredClone(prepared.local.settings.at(-1)!)); });
  invalid(copy => { copy.local.settings.find(row => row.key.startsWith('record-draft:schedule:weekly'))!.value = {}; });
  invalid(copy => { copy.allEvents[0].operation = 'delete'; });
  invalid(copy => { copy.allEvents.splice(4, 1); });
  invalid(copy => { copy.allEvents.push({ ...structuredClone(copy.allEvents.at(-1)!), seq: '13' }); });
  invalid(copy => { copy.events.at(-1)!.entityId = 'late'; });
  invalid(copy => { copy.local.outbox.push({ seq: 1 }); });
  invalid(copy => { copy.local.settings.find(row => row.key === 'lastPushAt')!.value = new Date(stamp + 99).toISOString(); });
  const arrayRevision = structuredClone(prepared); Object.assign(envelope(arrayRevision), { revision: ['a'.repeat(32)] });
  assert.equal(checks.savedResult(before, arrayRevision, after, id).pass, false, 'A string-coercible array is not a persisted revision string');
  const poisonedBase = structuredClone(before); poisonedBase.local.schedules[0].title = 'post-typed replacement baseline';
  assert.equal(checks.savedResult(poisonedBase, prepared, after, id).pass, false);
});

test('Ordinary sync timestamps are bounded; natural cursor advancement derives every consumed event from the full observed ledger', () => {
  const before = sources(), after = structuredClone(before); after.sample.browserEnd += 100;
  after.local.settings.find(row => row.key === 'lastPullAt')!.value = new Date(stamp + 50).toISOString();
  after.local.settings.find(row => row.key === 'syncV2Cursor')!.value = '8';
  assert.equal(checks.sourcesPreserved(before, after), true);
  for (const value of ['9', '6', 8, '08', '9223372036854775808']) {
    const copy = structuredClone(after); copy.local.settings.find(row => row.key === 'syncV2Cursor')!.value = value; assert.equal(checks.sourcesPreserved(before, copy), false);
  }
  const unproven = structuredClone(after); unproven.local.settings.find(row => row.key === 'sync-version:todos:old-todo')!.value = '7';
  assert.equal(checks.cursorDerived(before, unproven, '8'), false);
  for (const value of ['invalid', new Date(stamp - 200).toISOString(), new Date(stamp + 121).toISOString()]) {
    const copy = structuredClone(after); copy.local.settings.find(row => row.key === 'lastPullAt')!.value = value; assert.equal(checks.sourcesPreserved(before, copy), false);
  }
  const unknown = structuredClone(after); unknown.local.settings.push({ key: 'sync-anything', value: 'whitelist nothing' }); assert.equal(checks.sourcesPreserved(before, unknown), false);
});

const reading = () => {
  const source = sources().local.schedules[0], identity = checks.identity(source);
  return { schedule: { url: '/schedule', present: true, loading: false, selectedTabs: ['日'], heading: '10月7日' }, modalCount: 0, modalAnimations: 0,
    anchor: { ...identity, matches: 1, node: 9, geometry: { visible: true }, titleGeometry: { visible: true }, timeGeometry: { visible: true } },
    active: { node: 9, tag: 'DIV', role: 'button', tabIndex: 0, disabled: false, id: '', text: `${source.title}09:00-10:00`, ariaLabel: identity.ariaLabel, logicalCard: identity }, geometry: { visible: true } };
};
const samples = () => [0, 100, 250, 500, 650, 700, 750, 800, 850, 900, 950].map(elapsedMs => ({ elapsedMs, ...reading() }));
test('Calendar identity requires actual year/month membership and one exact four-schedule original date cell', () => {
  const cells = Array.from({ length: 35 }, (_, i) => { const day = new Date(Date.UTC(2026, 8, i + 28)); const m = day.getUTCMonth() + 1, d = day.getUTCDate(); return { ariaLabel: `${m}月${d}日，${m === 10 && d === 7 ? 4 : 0}个日程`, text: String(d) }; });
  const surface = { schedule: { url: '/schedule', selectedTabs: ['月'], heading: '2026年10月', cells } };
  assert.equal(checks.calendarResult(surface, date, 4).pass, true);
  for (const patch of [{ heading: '2027年10月' }, { selectedTabs: ['周'] }, { cells: cells.slice(1) }, { cells: [...cells, cells[9]] }, { cells: cells.map(row => row.ariaLabel === '10月7日，4个日程' ? { ...row, ariaLabel: '10月7日，3个日程' } : row) }]) assert.equal(checks.calendarResult({ schedule: { ...surface.schedule, ...patch } }, date, 4).pass, false);
});

test('Native DIV card activation binds visible full title/time and actual selected day, with fresh node/geometry revalidation', () => {
  const before = reading(), source = sources().local.schedules[0]; assert.equal(checks.activationResult(before, structuredClone(before), source).pass, true);
  for (const patch of [{ node: 10 }, { role: null }, { disabled: true }, { tabIndex: -1 }, { text: 'wrong title' }, { tag: 'BODY' }]) assert.equal(checks.activationResult(before, { ...structuredClone(before), active: { ...before.active, ...patch } }, source).pass, false);
  for (const patch of [{ title: 'wrong title' }, { time: '23:15-23:45' }, { matches: 2 }, { titleGeometry: { visible: false } }, { timeGeometry: { visible: false } }]) assert.equal(checks.activationResult(before, { ...structuredClone(before), anchor: { ...before.anchor, ...patch } }, source).pass, false);
  const wrongDate = reading(); wrongDate.schedule.heading = '10月8日'; assert.equal(checks.activationResult(wrongDate, structuredClone(wrongDate), source).pass, false);
});

test('Escape retains exact original node; Save may remount the same logical card, but partial-ready, late focus and hidden title/time stay red', () => {
  const source = sources().local.schedules[0], origin = reading(), original = samples();
  assert.equal(checks.returnResult(original, origin, source).pass, true);
  const remounted = original.map(row => ({ ...structuredClone(row), active: { ...row.active, node: 10 }, anchor: { ...row.anchor, node: 10 } }));
  assert.equal(checks.returnResult(remounted, origin, source).pass, false);
  assert.equal(checks.returnResult(remounted, origin, source, { afterSave: true }).pass, true);
  const invalid = (mutate: (copy: typeof original[number]) => void) => { const copy = structuredClone(original); mutate(copy.at(-1)!); assert.equal(checks.returnResult(copy, origin, source).pass, false); };
  invalid(row => { row.active.tag = 'BODY'; }); invalid(row => { row.active.node = 20; }); invalid(row => { row.schedule.heading = '10月8日'; });
  invalid(row => { row.anchor.title = 'wrong title'; }); invalid(row => { row.anchor.time = '09:15-10:15'; });
  invalid(row => { row.anchor.geometry.visible = false; }); invalid(row => { row.anchor.titleGeometry.visible = false; }); invalid(row => { row.anchor.timeGeometry.visible = false; });
  invalid(row => { row.modalCount = 1; }); invalid(row => { row.modalAnimations = 1; });
  const late = [0, 3500, 3650, 3700, 3750, 3800, 3850, 3900, 3950, 4000].map(elapsedMs => ({ ...reading(), elapsedMs, modalAnimations: elapsedMs < 3750 ? 1 : 0 }));
  assert.equal(checks.readinessResult(late).readyMs, 250); assert.equal(checks.returnResult(late, origin, source).pass, false);
  const enough = late.map(row => ({ ...row, modalAnimations: row.elapsedMs < 3650 ? 1 : 0 })); assert.equal(checks.returnResult(enough, origin, source).pass, true);
  assert.equal(checks.returnResult(enough.map(row => row.elapsedMs === 3750 ? { ...row, modalAnimations: 1 } : row), origin, source).pass, false);
  assert.equal(checks.returnResult([...enough, { ...reading(), elapsedMs: 4001 }], origin, source).pass, false);
  assert.equal(checks.returnResult(original.filter(row => row.elapsedMs < 900), origin, source).pass, false);
  assert.equal(checks.returnResult(original.map(row => ({ ...row, active: { ...row.active, tag: 'BODY' } })), origin, source).pass, false, 'Waiting or later recovery never turns natural BODY focus into success');
});

test('Readonly source sampling preserves all named-table JSON fields and stops on unsupported values instead of losing them', async () => {
  const previous = globalThis.indexedDB; Object.assign(globalThis, { indexedDB: new IDBFactory() });
  let db: IDBDatabase | undefined;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`); request.onupgradeneeded = () => { for (const table of ['schedules', 'settings', 'outbox']) request.result.createObjectStore(table, { keyPath: table === 'settings' ? 'key' : 'id' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const put = async (value: unknown) => new Promise<void>((resolve, reject) => { const transaction = db!.transaction('settings', 'readwrite'); transaction.objectStore('settings').put({ key: 'all-fields', value }); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    const original = { nested: [null, 0, false, { text: 'unchanged' }], complete: true }; await put(original);
    assert.deepEqual(JSON.parse(await readScheduleSource(owner)), { schedules: [], settings: [{ key: 'all-fields', value: original }], outbox: [] });
    for (const unsupported of [undefined, { presentUndefined: undefined }, NaN, Infinity, -0, 2n, new Date(stamp), new Map([['a', 1]]), new Set([1]), new Uint8Array([1]), new Array(2)]) { await put(unsupported); await assert.rejects(readScheduleSource(owner), /Unsupported|Sparse/); }
    await put(original); assert.deepEqual(JSON.parse(await readScheduleSource(owner)).settings[0].value, original, 'Rejected observations do not mutate stored source');
    await assert.rejects(readScheduleSource('missing-owner'), /does not exist/);
  } finally { db?.close(); Object.assign(globalThis, { indexedDB: previous }); }
});
