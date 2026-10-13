import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readGoalInitialPullProof, assertGoalInitialPullProof, assertGoalInitialSourcePreserved } from '../scripts/audit-goal-initial-read.mjs';

const owner = 'synthetic-cursor-owner';
const encode = (value: unknown): unknown => value === undefined ? { type: 'undefined' } : value === null || typeof value !== 'object' ? value : { type: Array.isArray(value) ? 'array' : 'object', ...(Array.isArray(value) ? { length: value.length } : {}), entries: Object.keys(value).sort().map(key => [key, encode(Reflect.get(value, key))]) };
const goals = [25, 50].map((progress, index) => ({ id: `goal-${index}`, title: 'Exact same name', description: `Exact original ${index}`, level: 'short', domain: '学习', priority: 'medium', progress, targetDate: null, syncScope: 'account', createdAt: 17, updatedAt: 29, unknown: undefined }));
const path = (cursor: string) => `/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`;
function fixture(cursor = '0', sequences = ['5', '6', '7', '8']) {
  const events = sequences.map((seq, index) => ({ seq, entity: 'goals', operation: 'upsert', entityId: goals[index % 2].id, data: { ...goals[index % 2], progress: index < 2 ? 0 : goals[index % 2].progress, userId: owner, createdAt: new Date(17).toISOString(), updatedAt: new Date(31).toISOString() } }));
  const settings = [
    { key: 'lastPullAt', value: '2026-10-13T01:00:00.000Z' },
    { key: 'sync-version:goals:goal-0', value: sequences[2] },
    { key: 'sync-version:goals:goal-1', value: sequences[3] },
    { key: 'syncV2Cursor', value: cursor },
  ];
  const account = { databaseName: `youtrace:user:${owner}:schedule-v1`, version: 1, schema: [{ name: 'goalRecords', keyPath: 'id' }], tables: [
    { name: 'goalRecords', keys: encode(goals.map(row => row.id)), losslessRows: encode(goals) },
    { name: 'outbox', keys: encode([]), losslessRows: encode([]) },
    { name: 'settings', keys: encode(settings.map(row => row.key)), losslessRows: encode(settings) },
  ] };
  const pages = [
    { method: 'GET', path: path('0'), account: owner, response: { protocol: 2, features: ['goals-v1'], events: events.slice(0, 2), nextCursor: sequences[1], hasMore: true } },
    { method: 'GET', path: path(sequences[1]), account: owner, response: { protocol: 2, features: ['goals-v1'], events: events.slice(2), nextCursor: sequences[3], hasMore: false } },
  ];
  return { catalog: [{ name: account.databaseName, version: 1 }], account, otherDatabases: [], events, pullProof: { owner, pages, events: structuredClone(events), tip: sequences[3] } };
}
function cursor(value: ReturnType<typeof fixture>, next: string) {
  const reference = fixture(next); value.account.tables.find(row => row.name === 'settings')!.losslessRows = reference.account.tables.find(row => row.name === 'settings')!.losslessRows;
}

test('only exact complete same-owner ACKed tip advancement is allowed across documents; sequence gaps are legal', () => {
  const before = fixture(), after = fixture('8');
  assert.equal(assertGoalInitialPullProof(before.pullProof, before.account), '8');
  const changes = assertGoalInitialSourcePreserved(before, after, true);
  assert.equal(changes.length, 1); assert.equal(changes[0].key, 'syncV2Cursor');
  assert.equal(changes[0].before, '0'); assert.equal(changes[0].after, '8'); assert.equal(changes[0].owner, owner);
  assert.throws(() => assertGoalInitialSourcePreserved(before, after), 'The settled failure window still has no metadata exemption');
  assert.deepEqual(assertGoalInitialSourcePreserved(after, structuredClone(after)), []);
});

test('cursor comparison uses BigInt beyond Number safe precision', () => {
  const seq = ['9007199254740993', '9007199254740995', '9007199254740997', '9007199254740999'];
  const before = fixture('0', seq), after = fixture(seq[3], seq);
  assert.equal(assertGoalInitialSourcePreserved(before, after, true)[0].after, seq[3]);
});

test('wrong owner, omitted events, incomplete pages, bad nextCursor, unACKed history and arbitrary cursors fail closed', () => {
  const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
    value => { value.pullProof.owner = 'other'; },
    value => { value.pullProof.pages[0].account = 'other'; },
    value => { value.pullProof.pages[0].response.events[0].data.userId = 'other'; },
    value => { value.pullProof.pages[0].method = 'POST'; },
    value => { value.pullProof.pages[1].path = path('5'); },
    value => { value.pullProof.pages[1].response.hasMore = true; },
    value => { value.pullProof.pages[0].response.nextCursor = '8'; },
    value => { value.pullProof.pages[0].response.events.pop(); },
    value => { value.pullProof.events.pop(); },
    value => { value.pullProof.pages[1].response.events[1].seq = '7'; },
    value => { value.pullProof.pages[1].response.features = []; },
    value => { value.pullProof.pages[1].response.protocol = 1; },
    value => { value.pullProof.pages[1].response.events[0].operation = 'delete'; },
    value => { value.pullProof.pages[1].response.events[0].data.id = 'replacement'; },
    value => { value.pullProof.pages[1].response.events[0].data.createdAt = 'invalid'; },
    value => { value.pullProof.pages[0].response.events[0].data.progress = 2; },
    value => { value.account.tables.find(row => row.name === 'settings')!.losslessRows = encode([{ key: 'syncV2Cursor', value: '0' }, { key: 'sync-version:goals:goal-0', value: '5' }, { key: 'sync-version:goals:goal-1', value: '8' }]); },
    value => { value.account.tables.find(row => row.name === 'outbox')!.losslessRows = encode([{ entity: 'goals', payload: 'pending original' }]); },
  ];
  for (const mutate of mutations) { const before = fixture(), after = fixture('8'); mutate(after); assert.throws(() => assertGoalInitialSourcePreserved(before, after, true)); }
  for (const next of ['7', '9', '-1', '08', '9223372036854775808', 'bad']) {
    const before = fixture(), after = fixture('8'); cursor(after, next); assert.throws(() => assertGoalInitialSourcePreserved(before, after, true), next);
  }
  const rollbackBefore = fixture('8'), rollbackAfter = fixture('0'); assert.throws(() => assertGoalInitialSourcePreserved(rollbackBefore, rollbackAfter, true));
  const missingProof = fixture('8'); Reflect.deleteProperty(missingProof, 'pullProof'); assert.throws(() => assertGoalInitialSourcePreserved(fixture(), missingProof, true));
});

test('raw GET collector retains both complete pages without credentials, writes or cursor invention', async () => {
  const expected = fixture(), seen: string[] = [];
  const api = Object.assign(async (requestPath: string) => { seen.push(requestPath); return expected.pullProof.pages[seen.length - 1].response; }, { ownerId: owner });
  const proof = await readGoalInitialPullProof(api);
  assert.deepEqual(proof, expected.pullProof); assert.deepEqual(seen, [path('0'), path('6')]);
  assert.equal(assertGoalInitialPullProof(proof, expected.account), '8');
  const stalled = Object.assign(async () => ({ protocol: 2, features: ['goals-v1'], events: [], nextCursor: '0', hasMore: true }), { ownerId: owner });
  await assert.rejects(readGoalInitialPullProof(stalled));
});
