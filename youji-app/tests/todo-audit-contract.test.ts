import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { todoOutcomeChecks as checks, readTodoSource, installTodoQuota } from '../scripts/audit-todo-outcomes.mjs';
// Focused false-green counterexamples, not native/product acceptance.
type Row = Record<string, unknown>;
type Event = { seq: string; entity: string; entityId: string; operation: string; data: Row | null };
type Facts = { local: { todos: Row[]; settings: { key: string; value: unknown }[]; outbox: Row[] }; server: Row[]; events: Event[]; allEvents: Event[] };
const clone = structuredClone, completedAt = 1791345603000;
function sources(): Facts {
  const todos = [{ id: 'target', text: '合成：归还图书', dueDate: '2026-10-06', priority: 'high', done: false, completedAt: null, ownUndefined: undefined }, { id: 'neighbor', text: '合成：归还图书', dueDate: '2026-10-07', priority: 'low', done: false, completedAt: null }];
  const server = todos.map(row => ({ ...clone(row), userId: 'synthetic-owner', createdAt: '2026-10-06T04:00:00.000Z', updatedAt: '2026-10-06T04:00:00.000Z' }));
  const events = server.map((data, index) => ({ seq: String(index + 1), entity: 'todos', entityId: data.id, operation: 'upsert', data: clone(data) }));
  return { local: { todos, settings: [{ key: 'sync-version:todos:target', value: '1' }, { key: 'sync-version:todos:neighbor', value: '2' }], outbox: [] }, server, events, allEvents: clone(events) };
}
const local = (facts: Facts, id = 'target') => facts.local.todos.find(row => row.id === id)!;
const remote = (facts: Facts, id = 'target') => facts.server.find(row => row.id === id)!;
function advance(before: Facts, row: Row, server: Row, consumedDraft?: string): Facts {
  const after = clone(before), id = String(row.id), seq = String(Number(before.allEvents.at(-1)!.seq) + 1);
  after.local.todos = [...after.local.todos.filter(row => row.id !== id), clone(row)]; after.server = [...after.server.filter(row => row.id !== id), clone(server)];
  after.local.settings = after.local.settings.filter(row => row.key !== `sync-version:todos:${id}` && row.key !== consumedDraft); after.local.settings.push({ key: `sync-version:todos:${id}`, value: seq });
  const event = { seq, entity: 'todos', entityId: id, operation: 'upsert', data: clone(server) }; after.events.push(clone(event)); after.allEvents.push(event); return after;
}
function complete() {
  const before = sources(), after = advance(before, { ...local(before), done: true, completedAt }, { ...remote(before), done: true, completedAt: new Date(completedAt).toISOString(), updatedAt: '2026-10-06T04:01:00.000Z' }); return { before, after };
}
function editing() {
  const before = sources(), typed = { text: '合成：归还两本图书', priority: 'low', dueDate: '', done: false }, key = 'record-draft:todo:target';
  before.local.settings.push({ key, value: { revision: 'draft-revision', value: { id: 'target', ...typed, base: clone(local(before)) } } });
  const after = advance(before, { ...local(before), ...typed, dueDate: clone(checks.UNDEFINED) }, { ...remote(before), ...typed, dueDate: null, updatedAt: '2026-10-06T04:01:00.000Z' }, key); return { before, after, typed, key };
}
test('Creation binds declared input and draft ID; metadata/neighbor loss or extra history cannot pass', () => {
  const before = sources(), declared = { text: '合成：整理抽屉', priority: 'low', dueDate: '', done: false }, id = 'created';
  before.local.settings.push({ key: 'record-draft:todo:new', value: { revision: 'new-draft', value: { id, ...declared, base: null } } });
  const created = { ...declared, id, dueDate: clone(checks.UNDEFINED), completedAt: null }, server = { ...created, dueDate: null, userId: 'synthetic-owner', createdAt: '2026-10-06T04:02:00.000Z', updatedAt: '2026-10-06T04:02:00.000Z' };
  const after = advance(before, created, server, 'record-draft:todo:new'); assert.equal(checks.createdOnlyDeclared(before, after, declared), true);
  const variants = [clone(after), clone(after), clone(after), clone(after)]; delete local(variants[0]).ownUndefined; local(variants[1], id).createdAt = completedAt; local(variants[2], 'neighbor').text = 'corrupted'; variants[3].allEvents.push({ seq: '4', entity: 'expenses', entityId: 'unrelated', operation: 'upsert', data: { id: 'unrelated' } });
  for (const value of variants) assert.equal(checks.createdOnlyDeclared(before, value, declared), false);
  const wrongId = clone(before); (wrongId.local.settings.at(-1)!.value as { value: Row }).value.id = 'different';
  assert.equal(checks.createdOnlyDeclared(wrongId, after, declared), false); assert.equal(checks.createdOnlyDeclared(before, after, { ...declared, priority: 'high' }), false);
});
test('Completion requires native time bounds, numeric local versus canonical server time, exact version and ACK', () => {
  const { before, after } = complete(), window = { before: completedAt - 100, after: completedAt + 100 }; assert.equal(checks.completionOnly(before, after, 'target', window), true);
  const variants = [clone(after), clone(after), clone(after), clone(after), clone(after)]; local(variants[0]).completedAt = Date.parse('2026-10-06T00:00:00Z'); remote(variants[1]).completedAt = completedAt; local(variants[2]).updatedAt = completedAt; variants[3].local.settings.find(row => row.key === 'sync-version:todos:target')!.value = '2'; variants[4].local.outbox.push({ id: 'pending' });
  for (const value of variants) assert.equal(checks.completionOnly(before, value, 'target', window), false);
  assert.equal(checks.completionOnly(before, after, 'target', { before: completedAt + 1, after: completedAt + 100 }), false);
});
test('Completion undo restores full original facts; only legal server updatedAt and version may advance', () => {
  const { before, after } = complete(), undone = advance(after, local(before), { ...remote(before), updatedAt: '2026-10-06T04:02:00.000Z' }); assert.equal(checks.undoOnly(before, after, undone, 'target'), true);
  const variants = [clone(undone), clone(undone), clone(undone), clone(undone)]; delete local(variants[0]).ownUndefined; local(variants[1]).completedAt = completedAt; remote(variants[2]).createdAt = '2026-10-06T04:02:00.000Z'; variants[3].allEvents[0].data!.text = 'rewritten history';
  for (const value of variants) assert.equal(checks.undoOnly(before, after, value, 'target'), false);
});
test('Cancel/refusal preserve draft revision/base and own keys, with only explicitly named typing writes allowed', () => {
  const { before, key } = editing(); assert.equal(checks.sourcesPreserved(before, clone(before)), true);
  const variants = [clone(before), clone(before), clone(before), clone(before), clone(before)];
  (variants[0].local.settings.find(row => row.key === key)!.value as { revision: string }).revision = 'changed';
  (variants[1].local.settings.find(row => row.key === key)!.value as { value: { base: Row } }).value.base.text = 'lost';
  delete local(variants[2]).ownUndefined; variants[3].local.settings[1].value = '99'; variants[4].allEvents.push({ seq: '3', entity: 'diaries', entityId: 'other', operation: 'upsert', data: { id: 'other' } });
  for (const value of variants) assert.equal(checks.sourcesPreserved(before, value), false);
  const prepared = clone(before), envelope = prepared.local.settings.find(row => row.key === key)!.value as { revision: string; value: Row }; envelope.revision = 'next'; envelope.value.dueDate = '2026-10-09';
  const options = { writtenDraft: { key, value: clone(envelope.value) } }; assert.equal(checks.sourcesPreserved(before, prepared, options), true);
  local(prepared).text = 'changed while typing'; assert.equal(checks.sourcesPreserved(before, prepared, options), false);
});
test('Cleared-date retry consumes one draft on the same ID; wrong absence/null or extra consistent writes fail', () => {
  const { before, after, typed } = editing(); assert.equal(checks.editedOnlyDeclared(before, after, 'target', typed), true);
  const variants = [clone(after), clone(after), clone(after), clone(after), clone(after)]; delete local(variants[0]).dueDate; local(variants[1]).dueDate = null; remote(variants[2]).dueDate = ''; delete local(variants[3]).ownUndefined; variants[4].local.settings.push(clone(before.local.settings.at(-1)!));
  for (const value of variants) assert.equal(checks.editedOnlyDeclared(before, value, 'target', typed), false);
  const extra = advance(after, { ...local(after, 'neighbor'), text: 'changed' }, { ...remote(after, 'neighbor'), text: 'changed' }); assert.deepEqual(checks.rowsFromLedger(extra.allEvents), [...extra.server].sort((a, b) => String(a.id).localeCompare(String(b.id)))); assert.equal(checks.editedOnlyDeclared(before, extra, 'target', typed), false);
});
const globals = globalThis as unknown as { indexedDB: IDBFactory; IDBObjectStore: typeof IDBObjectStore; __todoFault?: { hits: { intendedValue: Row; originalCalled: boolean }[]; aborts: number; commits: number; restored: boolean; expired: boolean }; __restoreTodoFault?: () => void };
test('Readonly snapshot and exact put quota retain undefined deadline and refuse only this own synthetic target', async () => {
  globals.indexedDB = new IDBFactory(); globals.IDBObjectStore = IDBObjectStore;
  const request = indexedDB.open('youtrace:user:todo-contract:schedule-v1', 1); request.onupgradeneeded = () => { for (const name of ['todos', 'settings', 'outbox']) request.result.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' }); };
  const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const original = IDBObjectStore.prototype.put, source = { id: 'target', text: '原文', dueDate: undefined, completedAt: null };
  const write = (table: string, value: Row) => new Promise<void>((resolve, reject) => { const tx = db.transaction(table, 'readwrite'); tx.objectStore(table).put(value); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  try {
    await write('todos', source); installTodoQuota({ owner: 'todo-contract', id: 'target' }); await write('todos', { ...source, id: 'neighbor' }); await write('outbox', { id: 'target', text: 'other table' });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('todos', 'readwrite'); tx.onabort = () => resolve(); tx.oncomplete = () => reject(new Error('Refused transaction must not commit')); assert.throws(() => tx.objectStore('todos').put({ ...source, text: 'new' }), { name: 'QuotaExceededError' }); tx.abort(); });
    const fault = globals.__todoFault!; assert.equal(fault.hits.length, 1); assert.equal(fault.aborts, 1); assert.equal(fault.commits, 0); assert.equal(fault.hits[0].originalCalled, false); assert.deepEqual(fault.hits[0].intendedValue.dueDate, checks.UNDEFINED);
    const captured = JSON.parse(await readTodoSource('todo-contract')), target = captured.todos.find((value: Row) => value.id === 'target'); assert.equal(target.text, '原文'); assert.deepEqual(target.dueDate, checks.UNDEFINED); assert.equal(target.completedAt, null); assert.equal(Object.hasOwn(target, 'createdAt'), false); assert.equal(Object.hasOwn(target, 'updatedAt'), false);
    globals.__restoreTodoFault!(); assert.equal(IDBObjectStore.prototype.put, original); assert.equal(fault.restored, true); assert.equal(fault.expired, false);
    await write('todos', { ...source, text: 'retry' }); assert.equal(JSON.parse(await readTodoSource('todo-contract')).todos.find((value: Row) => value.id === 'target').text, 'retry');
  } finally { globals.__restoreTodoFault?.(); db.close(); }
});
