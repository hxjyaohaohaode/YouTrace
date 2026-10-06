import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { diaryOutcomeChecks as checks, readDiarySource, installDiaryQuota } from '../scripts/audit-diary-outcomes.mjs';
// Pure oracle/fakeIDB contracts. No browser, listener, app implementation or product acceptance.
const clone = structuredClone;
const row = (id: string, date: string) => ({ id, date, content: '合成原文\n第二行\n第三行\n末行', mood: null, moodScore: null, source: 'manual', quickNoteIds: [] as string[], createdAt: 1791345600000, updatedAt: 1791345600000, unknownPresent: undefined, note: null as string | null });
const form = (source: ReturnType<typeof row>, content = source.content) => ({ id: source.id, date: source.date, content, mood: source.mood, moodScore: source.moodScore, base: clone(source) as ReturnType<typeof row> | null });
type Setting = { key: string; value: unknown };
function sources() {
  const local = [row('original-id', '2026-10-07'), row('neighbor-id', '2026-10-06')];
  const server = local.map(value => ({ ...clone(value), userId: 'synthetic-owner', createdAt: '2026-10-06T04:00:00.000Z', updatedAt: '2026-10-06T04:00:00.000Z' }));
  const events: { seq: string; entity: string; entityId: string; operation: string; data: typeof server[number] | null }[] = server.map((data, index) => ({ seq: String(index + 1), entity: 'diaries', entityId: data.id, operation: 'upsert', data: clone(data) }));
  const settings: Setting[] = [{ key: 'sync-version:diaries:original-id', value: '1' }, { key: 'sync-version:diaries:neighbor-id', value: '2' }, { key: 'record-draft:diary:original-id', value: { revision: 'revision-a', value: form(local[0], '合成更正\n最后一行') } }];
  return { local: { diary: local, settings, outbox: [] as { seq: number }[] }, server, events, allEvents: clone(events) };
}
const draft = (facts: ReturnType<typeof sources>, id = 'original-id') => facts.local.settings.find(value => value.key === `record-draft:diary:${id}`)!.value as { revision: string; value: ReturnType<typeof form>; extra?: string };
function correction() {
  const before = sources(), after = clone(before), content = draft(before).value.content;
  after.local.diary[0].content = content; after.local.diary[0].updatedAt += 1000; after.server[0].content = content; after.server[0].updatedAt = '2026-10-06T04:01:00.000Z';
  after.local.settings = after.local.settings.filter(value => value.key !== 'record-draft:diary:original-id'); after.local.settings[0].value = '3';
  const event = { seq: '3', entity: 'diaries', entityId: 'original-id', operation: 'upsert', data: clone(after.server[0]) }; after.events.push(event); after.allEvents.push(clone(event)); return { before, after, content };
}
function creation() {
  const before = sources(), after = clone(before), value = row('new-id', '2026-10-05');
  before.local.settings.push({ key: 'record-draft:diary:new', value: { revision: 'new-revision', value: { ...form(value), base: null } } });
  after.local.diary.push(clone(value)); after.server.push({ ...clone(before.server[0]), ...value, userId: 'synthetic-owner', createdAt: '2026-10-06T04:01:00.000Z', updatedAt: '2026-10-06T04:01:00.000Z' }); after.local.settings.push({ key: 'sync-version:diaries:new-id', value: '3' });
  const event = { seq: '3', entity: 'diaries', entityId: 'new-id', operation: 'upsert', data: clone(after.server.at(-1)!) }; after.events.push(event); after.allEvents.push(clone(event)); return { before, after, value };
}
function deletion() {
  const before = sources(), after = clone(before); draft(before).value = form(before.local.diary[0]); draft(after).value = form(before.local.diary[0]); draft(after).revision = 'revision-b'; after.local.diary.shift(); after.server.shift(); after.local.settings[0].value = '3';
  const event = { seq: '3', entity: 'diaries', entityId: 'original-id', operation: 'delete', data: null }; after.events.push(event); after.allEvents.push(clone(event)); return { before, after };
}
function copied() {
  const deleted = deletion(), before = deleted.after, after = clone(before), original = deleted.before.local.diary[0], value = { ...clone(original), id: 'copy-id', createdAt: original.createdAt + 3000, updatedAt: original.updatedAt + 3000 };
  after.local.diary.push(value); after.server.push({ ...clone(deleted.before.server[0]), id: 'copy-id', createdAt: '2026-10-06T04:02:00.000Z', updatedAt: '2026-10-06T04:02:00.000Z' }); after.local.settings = after.local.settings.filter(value => value.key !== 'record-draft:diary:original-id'); after.local.settings.push({ key: 'sync-version:diaries:copy-id', value: '4' });
  const event = { seq: '4', entity: 'diaries', entityId: 'copy-id', operation: 'upsert', data: clone(after.server.at(-1)!) }; after.events.push(event); after.allEvents.push(clone(event)); return { before, after, value };
}
test('Two independent tasks have four disposable short-nickname profiles and optional mood choices', () => {
  assert.equal(checks.profiles.length, 4); assert.equal(new Set(checks.profiles.map((value: { phone: string }) => value.phone)).size, 4);
  for (const profile of checks.profiles) { assert.ok(profile.nickname.length <= 20); assert.ok([360, 1280].includes(profile.width)); assert.ok(['records', 'recovery'].includes(profile.scenarioSet)); }
  assert.equal(checks.profiles.filter((value: { mood: string | null }) => value.mood === null).length, 2);
});
test('Full ledger reconstructs rows while retaining raw unknown fields and tombstones', () => {
  const { before, after } = deletion(); assert.deepEqual(checks.rowsFromLedger(before.allEvents), [...before.server].sort((a, b) => a.id.localeCompare(b.id))); assert.deepEqual(checks.rowsFromLedger(after.allEvents), after.server); assert.equal(Object.hasOwn(checks.rowsFromLedger(before.allEvents)[0], 'unknownPresent'), true);
  for (const events of [[before.events[0], before.events[0]], [{ ...before.events[0], seq: '01' }], [{ ...before.events[0], data: { id: 'wrong' } }], [{ ...before.events[0], operation: 'restore' }]]) assert.throws(() => checks.rowsFromLedger(events));
});
test('Cancel/put refusal preserve exact draft revision/base, own keys, outbox and all-entity ledger', () => {
  const before = sources(); assert.equal(checks.sourcesPreserved(before, clone(before)), true);
  const revision = clone(before); draft(revision).revision = 'changed'; const base = clone(before); draft(base).value.base!.note = 'changed'; const own = clone(before); delete (own.local.diary[0] as Partial<ReturnType<typeof row>>).unknownPresent; const queue = clone(before); queue.local.outbox.push({ seq: 1 }); const other = clone(before); other.allEvents.push({ ...clone(other.allEvents[0]), seq: '3', entity: 'todos' });
  for (const after of [revision, base, own, queue, other]) assert.equal(checks.sourcesPreserved(before, after), false);
});
test('Delete refresh permits only exact draft revision, with full envelope/form/base preservation', () => {
  const before = sources(), after = clone(before); draft(after).revision = 'revision-b'; assert.equal(Boolean(checks.sourcesPreserved(before, after, { refreshedDraft: 'record-draft:diary:original-id' })), true);
  const variants = [clone(after), clone(after), clone(after), clone(after)]; draft(variants[0]).value.content = 'changed'; draft(variants[1]).extra = 'added'; draft(variants[2]).value.base!.note = 'changed'; draft(variants[3]).revision = '';
  for (const value of variants) assert.equal(Boolean(checks.sourcesPreserved(before, value, { refreshedDraft: 'record-draft:diary:original-id' })), false);
  assert.equal(checks.sourcesPreserved(before, after, { refreshedDraft: 'record-draft:diary:neighbor-id' }), false);
});
test('ACK needs exact ID/content, positive canonical version, no conflict and empty queue', () => {
  const facts = sources(); assert.equal(checks.acknowledged(facts, 'original-id'), true); const changed = clone(facts); changed.server[0].content = 'wrong'; const stale = clone(facts); stale.local.settings[0].value = '2'; const conflict = clone(facts); conflict.local.settings.push({ key: 'sync-conflict:diaries:original-id', value: {} }); const queued = clone(facts); queued.local.outbox.push({ seq: 3 });
  for (const value of [changed, stale, conflict, queued]) assert.equal(checks.acknowledged(value, 'original-id'), false);
});
test('Native creation freezes declaration and preserves old full rows/versions while consuming exact new draft', () => {
  const { before, after, value } = creation(); assert.equal(Boolean(checks.createdOnlyDeclared(before, after, value)), true);
  const variants = [clone(after), clone(after), clone(after), clone(after), clone(after)]; variants[0].local.diary[0].content = 'corrupted'; variants[1].local.settings[1].value = '90'; variants[2].server[1].createdAt = '2026-10-07T04:00:00.000Z'; variants[3].allEvents.push({ ...clone(variants[3].allEvents[0]), seq: '4', entity: 'todos' }); variants[4].local.settings.push(clone(before.local.settings.at(-1)!));
  for (const changed of variants) assert.equal(Boolean(checks.createdOnlyDeclared(before, changed, value)), false); assert.equal(Boolean(checks.createdOnlyDeclared(before, after, { ...value, content: 'wrong declaration' })), false);
});
test('Content correction preserves ID, original creation/audit fields, own unknown keys and every neighbor', () => {
  const { before, after, content } = correction(); assert.equal(checks.correctedOnlyContent(before, after, 'original-id', content), true);
  const variants = [clone(after), clone(after), clone(after), clone(after), clone(after)]; variants[0].local.diary[0].createdAt++; variants[1].server[0].createdAt = '2026-10-07T04:00:00.000Z'; variants[2].local.diary[0].updatedAt = before.local.diary[0].updatedAt - 1; delete (variants[3].local.diary[0] as Partial<ReturnType<typeof row>>).unknownPresent; variants[4].server[1].note = 'changed neighbor';
  for (const changed of variants) assert.equal(checks.correctedOnlyContent(before, changed, 'original-id', content), false);
});
test('Deletion requires acknowledged tombstone and full retained draft/neighbors', () => {
  const { before, after } = deletion(); assert.equal(Boolean(checks.deletedOnlyTarget(before, after, 'original-id')), true); const lost = clone(after); lost.local.settings = lost.local.settings.filter(value => value.key !== 'record-draft:diary:original-id'); const present = clone(after); present.local.diary.push(clone(before.local.diary[0])); const neighbor = clone(after); neighbor.local.diary[0].note = 'changed';
  for (const value of [lost, present, neighbor]) assert.equal(Boolean(checks.deletedOnlyTarget(before, value, 'original-id')), false);
});
test('Copy has new ID, consumes old editor draft and leaves original tombstone/history/version intact', () => {
  const { before, after, value } = copied(); assert.equal(Boolean(checks.copiedAsNew(before, after, 'original-id', value)), true); const resurrect = clone(after); resurrect.local.diary.at(-1)!.id = 'original-id'; const tombstone = clone(after); Object.assign(tombstone.events[2], { rewritten: true }); Object.assign(tombstone.allEvents[2], { rewritten: true }); const oldVersion = clone(after); oldVersion.local.settings[0].value = '4'; const oldDraft = clone(after); oldDraft.local.settings.push(clone(before.local.settings.find(row => row.key === 'record-draft:diary:original-id')!));
  for (const changed of [resurrect, tombstone, oldVersion, oldDraft]) assert.equal(Boolean(checks.copiedAsNew(before, changed, 'original-id', value)), false);
});
test('Self-consistent changed neighbor plus extra event cannot satisfy the frozen creation contract', () => {
  const { before, after, value } = creation(); after.local.diary[1].content = 'changed'; after.server[1].content = 'changed'; after.local.settings[1].value = '4'; const event = { seq: '4', entity: 'diaries', entityId: 'neighbor-id', operation: 'upsert', data: clone(after.server[1]) }; after.events.push(event); after.allEvents.push(clone(event)); assert.deepEqual(checks.rowsFromLedger(after.allEvents), [...after.server].sort((a, b) => a.id.localeCompare(b.id))); assert.equal(Boolean(checks.createdOnlyDeclared(before, after, value)), false);
});
async function database(owner: string, record: object) {
  const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`, 1); request.onupgradeneeded = () => { for (const name of ['diary', 'settings', 'outbox']) request.result.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' }); };
  const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('diary', 'readwrite'); tx.objectStore('diary').add(record); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); return db;
}
const globals = globalThis as unknown as { indexedDB: IDBFactory; IDBObjectStore: typeof IDBObjectStore; __diaryFault?: { hits: { key: string; originalCalled: boolean }[]; aborts: number; commits: number; restored: boolean; expired: boolean }; __restoreDiaryFault?: () => void };
test('Read-only fakeIDB codec retains own undefined, dates, BigInt, special numbers, Map and Set', async () => {
  globals.indexedDB = new IDBFactory(); globals.IDBObjectStore = IDBObjectStore;
  const db = await database('codec', { id: 'codec-id', ownUndefined: undefined, date: new Date('2026-10-06T04:00:00.000Z'), big: 4n, minusZero: -0, nan: NaN, map: new Map([['a', undefined]]), set: new Set([1]) });
  try { const result = JSON.parse(await readDiarySource('codec')).diary[0]; assert.deepEqual(result.ownUndefined, { __diaryEvidenceType: 'undefined' }); assert.deepEqual(result.date, { __diaryEvidenceType: 'date', value: '2026-10-06T04:00:00.000Z' }); assert.deepEqual(result.big, { __diaryEvidenceType: 'bigint', value: '4' }); assert.deepEqual(result.minusZero, { __diaryEvidenceType: 'number', value: '-0' }); assert.deepEqual(result.nan, { __diaryEvidenceType: 'number', value: 'NaN' }); assert.deepEqual(result.map, { __diaryEvidenceType: 'Map', entries: [['a', { __diaryEvidenceType: 'undefined' }]] }); assert.deepEqual(result.set, { __diaryEvidenceType: 'Set', values: [1] }); } finally { db.close(); }
});
test('Codec rejects marker collisions, sparse/extended arrays and unsupported typed arrays', async () => {
  globals.indexedDB = new IDBFactory(); globals.IDBObjectStore = IDBObjectStore;
  const sparse: unknown[] = []; sparse.length = 2; sparse[0] = 'first'; Object.assign(sparse, { extra: 'balances a missing index' });
  for (const [index, value] of [{ __diaryEvidenceType: 'undefined' }, sparse, new Uint8Array([1])].entries()) { const owner = `invalid-${index}`, db = await database(owner, { id: 'invalid-id', value }); try { await assert.rejects(readDiarySource(owner)); } finally { db.close(); } }
});
for (const method of ['put', 'delete'] as const) test(`Exact precommit ${method} fault preserves target, permits other keys and restores native method`, async () => {
  globals.indexedDB = new IDBFactory(); globals.IDBObjectStore = IDBObjectStore;
  const owner = `fault-${method}`, db = await database(owner, { id: 'target-id', content: 'original' }), original = IDBObjectStore.prototype[method];
  try {
    installDiaryQuota({ owner, id: 'target-id', method });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('diary', 'readwrite'); tx.objectStore('diary').put({ id: 'neighbor-id', content: 'neighbor' }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('diary', 'readwrite'); tx.onabort = () => resolve(); tx.oncomplete = () => reject(new Error('Refusal must not commit')); assert.throws(() => { if (method === 'put') tx.objectStore('diary').put({ id: 'target-id', content: 'changed' }); else tx.objectStore('diary').delete('target-id'); }, { name: 'QuotaExceededError' }); tx.abort(); });
    assert.equal(globals.__diaryFault!.hits.length, 1); assert.equal(globals.__diaryFault!.aborts, 1); assert.equal(globals.__diaryFault!.commits, 0); assert.equal(globals.__diaryFault!.hits[0].originalCalled, false); const snapshot = JSON.parse(await readDiarySource(owner)); assert.equal(snapshot.diary.find((value: { id: string }) => value.id === 'target-id').content, 'original'); globals.__restoreDiaryFault!(); assert.equal(IDBObjectStore.prototype[method], original); assert.equal(globals.__diaryFault!.restored, true); assert.equal(globals.__diaryFault!.expired, false);
  } finally { globals.__restoreDiaryFault?.(); db.close(); }
});
test('Reading rejects zero-rect omitted glyphs and a fourth clipped line, while allowing complete multi-frame reading', () => {
  const glyphs = Array.from('甲乙丙丁').map((char, index) => ({ id: `0:${index}`, char, rectCount: 1 }));
  const lines = glyphs.map(glyph => ({ text: glyph.char, glyphIds: [glyph.id], visible: true }));
  const opened = { text: '甲\n乙\n丙\n丁', glyphs, lines }, observed = lines.map((line, index) => ({ index, line }));
  assert.equal(checks.bodyReadingComplete(opened, observed), true, 'Separate real visible observations can cover a tall body over multiple frames');
  const noRect = clone(opened); noRect.glyphs[3].rectCount = 0; noRect.lines.pop();
  assert.equal(checks.bodyReadingComplete(noRect, observed.slice(0, 3)), false, 'Omitted character cannot disappear from the oracle denominator');
  const clipped = clone(observed); clipped[3].line.visible = false;
  assert.equal(checks.bodyReadingComplete(opened, clipped), false);
  const missing = clone(observed); missing[3].line.glyphIds = [];
  assert.equal(checks.bodyReadingComplete(opened, missing), false);
});
test('Creation and copy audit timestamps are real new fields and the original persisted draft ID binds creation', () => {
  const made = creation(), wrongId = clone(made.before); draft(wrongId, 'new').value.id = 'another-id';
  assert.equal(Boolean(checks.createdOnlyDeclared(wrongId, made.after, made.value)), false);
  const invalid = clone(made.after); invalid.local.diary.at(-1)!.createdAt = NaN;
  assert.equal(Boolean(checks.createdOnlyDeclared(made.before, invalid, made.value)), false);
  const copy = copied(), reused = clone(copy.after); reused.local.diary.at(-1)!.createdAt = draft(copy.before).value.base!.createdAt;
  assert.equal(Boolean(checks.copiedAsNew(copy.before, reused, 'original-id', copy.value)), false);
  const remote = clone(copy.after); remote.server.at(-1)!.createdAt = '2026-10-06T04:00:00.000Z'; remote.events.at(-1)!.data!.createdAt = remote.server.at(-1)!.createdAt; remote.allEvents.at(-1)!.data!.createdAt = remote.server.at(-1)!.createdAt;
  assert.equal(Boolean(checks.copiedAsNew(copy.before, remote, 'original-id', copy.value)), false);
});
test('Backup feedback must be actually read, and a present fallback cannot bypass complete byte comparison', () => {
  const expected = '2026-10-07\n未记录心情\n\n合成完整正文';
  const success = { fallbackValue: null, copyReported: true }, shown = { visible: true, text: '已复制，关闭' };
  assert.equal(checks.backupFeedbackReadable(success, expected, shown), true);
  assert.equal(checks.backupFeedbackReadable(success, expected, { ...shown, visible: false }), false);
  assert.equal(checks.backupFeedbackReadable({ ...success, copyReported: false }, expected, shown), false);
  const fallback = { fallbackValue: expected, copyReported: true }, label = { visible: true, text: '完整输入备份' };
  assert.equal(checks.backupFeedbackReadable(fallback, expected, label, { visible: true }), true);
  assert.equal(checks.backupFeedbackReadable({ ...fallback, fallbackValue: '截断正文' }, expected, label, { visible: true }), false);
  assert.equal(checks.backupFeedbackReadable(fallback, expected, label, { visible: false }), false);
  assert.equal(checks.backupFeedbackReadable(fallback, expected, { ...label, visible: false }, { visible: true }), false);
});
test('Editor preparation permits only the exact draft write, preserving the pre-open original and full old ledger', () => {
  const before = sources(); before.allEvents.push({ ...clone(before.allEvents[0]), seq: '3', entity: 'todos' });
  const prepared = clone(before); draft(prepared).revision = 'input-revision'; draft(prepared).value.content = '新的可见输入';
  const options = { writtenDraft: { key: 'record-draft:diary:original-id', value: clone(draft(prepared).value) } };
  assert.equal(checks.sourcesPreserved(before, prepared, options), true);
  const variants = [clone(prepared), clone(prepared), clone(prepared)]; variants[0].local.diary[0].note = 'changed during open'; variants[1].local.diary[1].note = 'changed during input'; variants[2].allEvents.at(-1)!.data!.note = 'rewritten old unrelated event';
  for (const value of variants) assert.equal(checks.sourcesPreserved(before, value, options), false);
});
test('Canonical Diary deletion ledger requires explicit null payload, never a live or malformed row', () => {
  const { after } = deletion(); assert.deepEqual(checks.rowsFromLedger(after.allEvents), after.server);
  for (const data of [undefined, 'wrong', { id: 'wrong-id' }, sources().server[0]]) {
    const events = [...after.allEvents.slice(0, -1), { ...after.allEvents.at(-1), data }];
    assert.throws(() => checks.rowsFromLedger(events), /Canonical Diary tombstone data must be null/);
  }
});
