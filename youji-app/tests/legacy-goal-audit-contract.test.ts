import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyGoalOutcomeChecks as checks } from '../scripts/audit-legacy-goal-outcomes.mjs';

// Pure audit-oracle contracts. These are not native browser acceptance results.
test('historical fixture retains absent date, same name, distinct visible identities and arbitrary private originals', () => {
  const [a, b] = checks.fixture('pure');
  assert.equal(a.title, b.title);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.description, b.description);
  assert.notEqual(a.domain, b.domain);
  assert.notEqual(a.progress, b.progress);
  assert.equal(b.targetDate, '');
  assert.doesNotMatch(b.description, /日期|未设置|清空|校正/);
  assert.deepEqual(b.privateMemo.nested, [0, false, { preserve: 'B' }]);
});

test('download decoder preserves original fields, empty strings, references and own undefined keys', () => {
  const source = { $id: 0, $type: 'Object', entries: [
    ['targetDate', ''], ['privateMemo', { $id: 1, $type: 'Object', entries: [['unknown', { $type: 'undefined' }], ['text', 'original']] }],
    ['alias', { $ref: 1 }], ['self', { $ref: 0 }], ['items', { $id: 2, $type: 'Array', length: 3, entries: [['2', null]] }],
  ] };
  const decoded = checks.decodeRecovery(source);
  assert.equal(decoded.targetDate, '');
  assert.equal(decoded.privateMemo, decoded.alias);
  assert.equal(decoded.self, decoded);
  assert.equal(Object.hasOwn(decoded.privateMemo, 'unknown'), true);
  assert.equal(decoded.privateMemo.unknown, undefined);
  assert.equal(decoded.items.length, 3);
  assert.equal(0 in decoded.items, false);
  assert.equal(decoded.items[2], null);
  assert.throws(() => checks.decodeRecovery({ $ref: 45 }));
  assert.throws(() => checks.decodeRecovery({ $id: 0, $type: 'Unrecognized', data: {} }));
});

test('wire oracle rejects unpreviewed fields, nested values and exact private sentinels', () => {
  const originals = checks.fixture('wire'), a = originals[0];
  const request = (goal: object) => [{ path: '/api/sync/push', body: JSON.stringify({ goals: [goal] }) }];
  const safe = { id: a.id, title: a.title, description: a.description, level: a.level, domain: a.domain, priority: a.priority, progress: a.progress, targetDate: a.targetDate, createdAt: a.createdAt, baseVersion: '0' };
  assert.equal(checks.wireSafe(request(safe), originals), true);
  assert.equal(checks.wireSafe(request({ ...safe, privateMemo: a.privateMemo }), originals), false);
  assert.equal(checks.wireSafe(request({ ...safe, unknown: 'other-hidden-content' }), originals), false);
  assert.equal(checks.wireSafe(request({ ...safe, description: a.privateMemo.sentinel }), originals), false);
  assert.equal(checks.wireSafe(request({ ...safe, domain: { hidden: 'metadata' } }), originals), false);
  assert.equal(checks.wireSafe([{ path: '/api/sync/push', body: '{' }], originals), false);
});

test('lossless backup proof rejects changed/missing keys even when record values match', () => {
  const originals = checks.fixture('keys');
  const table = { name: 'goals', keys: originals.map(row => row.id), rows: originals };
  assert.equal(checks.rawTableMatches([table], 'goals', originals), true);
  assert.equal(checks.rawTableMatches([{ ...table, keys: ['wrong', originals[1].id] }], 'goals', originals), false);
  assert.equal(checks.rawTableMatches([{ name: 'goals', rows: originals }], 'goals', originals), false);
  const physical = { tables: [{ name: 'goals', keyPath: 'id', rows: originals.map(row => ({ key: row.id, value: row })) }] };
  assert.equal(checks.physicalRowsMatch(physical, originals), true);
  const broken = structuredClone(physical); broken.tables[0].rows[0].key = 'wrong';
  assert.equal(checks.physicalRowsMatch(broken, originals), false);
});

test('server oracle verifies actual identity, owner, date and original creation timestamp without source normalization', () => {
  const a = checks.fixture('cloud')[0];
  const server = { id: a.id, userId: 'owner', title: a.title, description: a.description, level: a.level, domain: a.domain, priority: a.priority, progress: a.progress, targetDate: a.targetDate, createdAt: new Date(a.createdAt).toISOString(), updatedAt: '2026-10-05T00:00:00.000Z' };
  assert.equal(checks.serverMatches(a, server, 'owner'), true);
  for (const changed of [{ ...server, id: 'wrong' }, { ...server, userId: 'other' }, { ...server, targetDate: null }, { ...server, createdAt: new Date(a.createdAt + 1).toISOString() }, { ...server, privateMemo: a.privateMemo }]) assert.equal(checks.serverMatches(a, changed, 'owner'), false);
  assert.equal(a.createdAt, 1000);
  assert.ok(Object.hasOwn(a, 'privateMemo'));
});

test('cancel and quota oracle includes full private fields, source database, receipts, queue and cloud ledger', () => {
  const [a, b] = checks.fixture('preserve');
  const before = { current: { goals: [a, b], goalRecords: [{ ...a, syncScope: 'local' }, { ...b, syncScope: 'local' }], settings: [{ key: `goal-source-snapshot:${a.id}`, value: a }], outbox: [] }, physical: { databaseName: 'synthetic', version: 10, goals: [a, b] }, server: [], events: [] };
  assert.equal(checks.preserved(before, structuredClone(before)), true);
  const changes = [
    (after: typeof before) => { after.current.goalRecords[1].targetDate = null; },
    (after: typeof before) => { after.current.goals[0].privateMemo.text = 'lost'; },
    (after: typeof before) => { after.physical.version = 30; },
    (after: typeof before) => { after.current.settings[0].value.updatedAt += 1; },
  ];
  for (const mutate of changes) { const after = structuredClone(before); mutate(after); assert.equal(checks.preserved(before, after), false); }
  assert.equal(checks.neighborUnchanged(before, structuredClone(before), b.id), true);
  const changed = structuredClone(before); changed.current.goalRecords[1].updatedAt += 1;
  assert.equal(checks.neighborUnchanged(before, changed, b.id), false);
});
