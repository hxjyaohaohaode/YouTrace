import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { INITIAL_SESSION_CASES, INITIAL_SESSION_PATH, initialSessionChecks as checks, runInitialSessionOutcomes } from '../scripts/audit-initial-session-outcomes.mjs';
import { createInitializationObserver } from '../scripts/audit-initialization-observer.mjs';

const clone = value => structuredClone(value);
function fixture() {
  const todo = { id: 'synthetic-todo-1', text: 'Synthetic 保留', dueDate: undefined, priority: 'medium', done: false, completedAt: null };
  const server = { ...todo, dueDate: null, userId: 'synthetic-owner', createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' };
  const local = { databaseName: 'youtrace:user:synthetic-owner:schedule-v1', version: 110, schema: [{ name: 'todos', keyPath: 'id', autoIncrement: false, indexes: [] }], tables: [
    { name: 'todos', keys: ['synthetic-todo-1'], rows: [todo], losslessRows: { todo, unknownMetadata: { preserved: true } } },
    { name: 'outbox', keys: [], rows: [], losslessRows: [] },
    { name: 'settings', keys: ['sync-version:todos:synthetic-todo-1'], rows: [{ key: 'sync-version:todos:synthetic-todo-1', value: '9' }], losslessRows: [] },
  ] };
  return { owner: 'synthetic-owner', local, events: [{ seq: '9', entity: 'todos', entityId: todo.id, operation: 'upsert', data: server }] };
}
test('four independent scenarios cover both widths and use a distinct synthetic phone range', () => {
  assert.deepEqual(INITIAL_SESSION_CASES.map(row => [row.branch, row.width]), [['auth401', 1280], ['logout', 1280], ['auth401', 360], ['logout', 360]]);
  assert.equal(new Set(INITIAL_SESSION_CASES.map(row => row.phone)).size, 4);
  assert.ok(INITIAL_SESSION_CASES.every(row => /^1390000860[1-4]$/.test(row.phone)));
  assert.equal(INITIAL_SESSION_PATH, '/todo?view=all');
});
test('same-ID ACK requires every intended Todo field, owner, version, full queue and no conflict', () => {
  const source = fixture(); assert.equal(checks.acknowledged(source, 'Synthetic 保留'), true);
  for (const key of ['id', 'text', 'dueDate', 'priority', 'done', 'completedAt', 'userId', 'createdAt', 'updatedAt']) {
    const wrong = clone(source); delete wrong.events[0].data[key];
    if (key === 'id') assert.throws(() => checks.acknowledged(wrong, 'Synthetic 保留'), /record ID/);
    else assert.equal(checks.acknowledged(wrong, 'Synthetic 保留'), false, key);
  }
  for (const mutate of [
    value => { value.local.tables[0].rows[0].priority = value.events[0].data.priority = 'high'; },
    value => { value.local.tables[0].rows[0].done = value.events[0].data.done = true; },
    value => { value.local.tables[1].rows.push({ entity: 'expenses', status: 'pending' }); },
    value => { value.local.tables[2].rows[0].value = '8'; },
    value => { value.local.tables[2].rows.push({ key: 'sync-conflict:todos:synthetic-todo-1', value: {} }); },
    value => { value.local.tables[0].rows[0].unknownPrivateMetadata = 'must-not-disappear'; },
    value => { value.events[0].data.userId = 'different-owner'; },
  ]) { const wrong = clone(source); mutate(wrong); assert.equal(checks.acknowledged(wrong, 'Synthetic 保留'), false); }
});
test('retention compares full original local rows, unknown metadata, keys, schema, queue and receipts', () => {
  const source = fixture().local; assert.equal(checks.retained(source, clone(source)), true);
  for (const mutate of [
    value => { value.databaseName += '-replacement'; },
    value => { value.version++; },
    value => { value.schema[0].keyPath = 'other'; },
    value => { delete value.tables[0].rows[0].completedAt; },
    value => { value.tables[0].losslessRows.unknownMetadata.preserved = false; },
    value => { value.tables[0].keys = ['other']; },
    value => { value.tables[1].rows = [{ seq: 9, entity: 'todos', payload: 'synthetic-todo-1' }]; },
    value => { value.tables[2].rows[0].value = '10'; },
  ]) { const wrong = clone(source); mutate(wrong); assert.equal(checks.retained(source, wrong), false); }
});
test('canonical ledger rejects duplicate/out-of-order versions and mismatched IDs, retaining tombstones', () => {
  const events = fixture().events;
  assert.throws(() => checks.todoRowsFromLedger([...events, ...events]), /strictly ordered/);
  assert.throws(() => checks.todoRowsFromLedger([{ ...events[0], entityId: 'other' }]), /record ID/);
  assert.throws(() => checks.todoRowsFromLedger([{ ...events[0], operation: 'unknown' }]), /operation/);
  assert.deepEqual(checks.todoRowsFromLedger([...events, { seq: '10', entity: 'todos', entityId: events[0].entityId, operation: 'delete' }]), []);
});
test('copied safe initialization observer remains byte-identical to the tested e2e collector body', async () => {
  const source = await readFile(new URL('../scripts/e2e-recovery.mjs', import.meta.url), 'utf8');
  const body = source.split('// BEGIN safe initialization capture (also exercised without a browser in unit tests).\n')[1].split('// END safe initialization capture.')[0];
  const observer = await readFile(new URL('../scripts/audit-initialization-observer.mjs', import.meta.url), 'utf8');
  assert.equal(observer.split('export function createInitializationObserver() {\n')[1].split('\nreturn { observeInitialization, boundary, firstFailureTrace };')[0], body);
});
test('observer projection drops untrusted free-form fields and observers stay scenario-isolated', async () => {
  const trace = createInitializationObserver(), page = new EventEmitter();
  let exposed;
  page.exposeFunction = async (_name, callback) => { exposed = callback; };
  page.evaluateOnNewDocument = async () => undefined;
  await trace.observeInitialization(page);
  const secret = 'SYNTHETIC_PRIVATE_MUST_NOT_ENTER_CHRONOLOGY';
  exposed({ attempt: 1, sequence: 1, elapsedMs: 1, phase: 'initial', stage: 'initialization', outcome: 'error', authChecked: false, isAuthenticated: false, errorName: 'AuthError', ownerId: secret, message: secret, url: `/${secret}`, token: secret });
  exposed({ attempt: -1, sequence: 1, elapsedMs: 1, phase: 'initial', stage: 'initialization', outcome: 'error' });
  const saved = trace.firstFailureTrace(new Error(secret));
  assert.equal(saved.chronology.length, 1); assert.equal(saved.chronology[0].event.errorName, 'AuthError');
  assert.equal(JSON.stringify(saved).includes(secret), false);
  assert.equal(createInitializationObserver().firstFailureTrace(null).chronology.length, 0);
});
test('importing the module is inert and attempting execution outside hosted CI fails before services or controls', async () => {
  const prior = process.env.GITHUB_ACTIONS; delete process.env.GITHUB_ACTIONS;
  try { await assert.rejects(runInitialSessionOutcomes({}), /hosted-CI only/); }
  finally { if (prior === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prior; }
});
