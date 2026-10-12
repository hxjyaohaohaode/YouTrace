import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(import.meta.url);
const { deletionFixture: f, fixtureDatabase, addHistoricalPushes, serverPushFacts, preservedBusiness, preservedInsightsAndSettings, separateOwner, deletionConverged, installLostDeleteAck, readAuthenticatedEntry, finishAuthenticatedEntry } = await import('../scripts/audit-coach-deletion.mjs');

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'youtrace-outcomes-')), path = join(dir, 'synthetic.db');
  const db = new DatabaseSync(path, { enableDoubleQuotedStringLiterals: true });
  const migrations = resolve('server/prisma/migrations');
  for (const name of (await readdir(migrations)).filter(name => /^\d/.test(name)).sort()) db.exec(await readFile(join(migrations, name, 'migration.sql'), 'utf8'));
  db.prepare('INSERT INTO User(id,phone,nickname,createdAt,updatedAt) VALUES(?,?,?,0,0)').run('owner', 'synthetic-native-fixture', 'Synthetic'); db.close();
  return { path, close: () => rm(dir, { recursive: true, force: true }) };
}
const model = () => {
  const victim = { id: f.victim, origin: 'cloud', body: 'original' }, local = { id: 'local', origin: 'local', body: 'local original' }, live = { id: f.live, origin: 'cloud', body: 'live original' };
  const added = { id: f.added, origin: 'cloud', type: 'follow_up', title: f.addedTitle, body: f.body, actions: [], read: false, acted: false, createdAt: 12345 };
  const before = { databaseName: 'a', version: 1, schema: ['schema'], local: { todos: [{ id: 'todo', text: '原文' }], outbox: [], settings: [], coachInsights: [], coachPushes: [victim, local, live] }, keys: { todos: ['todo'], outbox: [] } };
  const after = structuredClone(before); after.local.coachPushes = [local, live, added]; after.local.settings = [{ key: `coachPushDismissed:${f.victim}`, value: true }];
  const rawAdded = { ...added, actions: '[]', read: 0, acted: 0 }; delete rawAdded.origin;
  const original = { pushes: [{ id: f.victim }, { id: f.live }, rawAdded], feed: [{ seq: 7, entity: 'todos' }], tombstones: [{ entityId: f.victim, userId: 'owner' }] };
  const remote = { ...structuredClone(original), pushes: original.pushes.filter(row => row.id !== f.victim) };
  return { before, after, original, remote };
};

test('native Push fixtures run all exact migrations and only add declared same-owner historical rows', async () => {
  const x = await fixture(); try {
    addHistoricalPushes(x.path, 'owner', 'initial'); addHistoricalPushes(x.path, 'owner', 'page'); addHistoricalPushes(x.path, 'owner', 'concurrent');
    const rows = serverPushFacts(x.path, 'owner'); assert.equal(rows.pushes.length, 58); assert.equal(rows.feed.length, 0); assert.deepEqual(rows.tombstones, []);
    assert.ok(rows.pushes.every(row => row.userId === 'owner' && row.body === f.body)); assert.equal(rows.pushes.filter(row => row.read === 1).length, 55);
    assert.throws(() => addHistoricalPushes(x.path, 'missing', 'initial')); assert.throws(() => addHistoricalPushes(x.path, 'owner', 'unknown')); assert.throws(() => addHistoricalPushes(x.path, 'owner', 'initial'));
    assert.deepEqual(serverPushFacts(x.path, 'owner'), rows, 'invalid/duplicate setup cannot select winners or mutate existing rows');
  } finally { await x.close(); }
});
test('native fixture boundary refuses arbitrary paths and missing database', () => {
  for (const path of ['/tmp/live.db', '/data/youtrace-outcomes-user/synthetic.db', '/tmp/youtrace-outcomes-missing/synthetic.db']) assert.throws(() => fixtureDatabase(path));
});
test('native deletion contract accepts only exact target removal with original data preserved', () => {
  const x = model(), frozen = structuredClone(x); assert.ok(deletionConverged(x.before, x.after, x.remote, x.original)); assert.deepEqual(x, frozen);
});
test('native deletion contract rejects absence-only, missing tombstone, local/live loss or unrelated edit', () => {
  const changes = [
    x => { x.after.local.settings = []; }, x => { x.after.local.coachPushes.push(x.before.local.coachPushes[0]); },
    x => { x.after.local.coachPushes = x.after.local.coachPushes.filter(row => row.id !== 'local'); },
    x => { x.after.local.coachPushes = x.after.local.coachPushes.filter(row => row.id !== f.live); },
    x => { x.after.local.todos[0].text = 'corrupted'; }, x => { x.after.databaseName = 'other'; },
    x => { x.remote.pushes.pop(); }, x => { x.remote.feed.push({ seq: 8 }); },
    x => { x.after.local.coachInsights = []; x.before.local.coachInsights = [{ id: 'original-insight' }]; },
    x => { x.after.local.settings.push({ key: 'coachPushEnabled', value: false }); },
    x => { x.remote.tombstones = []; }, x => { x.after.local.coachPushes.find(row => row.id === f.added).body = 'wrong'; },
  ];
  for (const mutate of changes) { const x = model(); mutate(x); assert.equal(deletionConverged(x.before, x.after, x.remote, x.original), false); }
  const x = model(); x.after.local.outbox.push({ seq: 1 }); assert.equal(preservedBusiness(x.before, x.after), false);
});
test('lost ACK hook waits for actual successful DELETE and requires an explicit second request', async () => {
  const win = Object.getOwnPropertyDescriptor(globalThis, 'window'), loc = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const calls: Array<[unknown, unknown]> = [];
  const window = { fetch: async (...args: [unknown, unknown]) => { calls.push(args); return new Response('{"ok":true}', { status: 200 }); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window }); Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://127.0.0.1:5289/' } });
  try {
    const original = window.fetch; installLostDeleteAck(f.victim);
    const url = '/api/coach/pushes/' + f.victim;
    await assert.rejects(window.fetch(url, { method: 'DELETE' }), /acknowledgment loss/); assert.equal(calls.length, 1);
    await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(calls.length, 1, 'hook must never auto-retry');
    assert.equal((await window.fetch(url, { method: 'DELETE' })).status, 200); assert.equal(calls.length, 2);
    const state = globalThis.window as unknown as { __coachDeleteAck: { lossCount: number; calls: unknown[] }; __restoreCoachDeleteAck: () => void };
    assert.equal(state.__coachDeleteAck.lossCount, 1); assert.equal(state.__coachDeleteAck.calls.length, 2); state.__restoreCoachDeleteAck(); assert.equal(window.fetch, original);
  } finally { if (win) Object.defineProperty(globalThis, 'window', win); else Reflect.deleteProperty(globalThis, 'window'); if (loc) Object.defineProperty(globalThis, 'location', loc); else Reflect.deleteProperty(globalThis, 'location'); }
});
test('hosted native task is explicitly bounded and has no production app imports or new UI', async () => {
  const module = await readFile(new URL('../scripts/audit-coach-deletion.mjs', import.meta.url), 'utf8'), runner = await readFile(new URL('../scripts/audit-user-outcomes.mjs', import.meta.url), 'utf8');
  assert.match(module, /process\.env\.GITHUB_ACTIONS, 'true'/); assert.doesNotMatch(module, /from ['"].*src\//); assert.doesNotMatch(module, /INCOMPLETE: remove/);
  assert.match(runner, /runCoachDeletionOutcomes/); assert.match(runner, /'coach-deletion'/); assert.match(module, /createBrowserContext\(\)/); assert.match(module, /Same rendered operation/);
  assert.ok(require.resolve('tsx'));
});

test('new account may have its own legal local reminder but never old owner IDs or private cloud content', () => {
  const x = model(); const other = structuredClone(x.before); other.databaseName = 'youtrace:user:other:schedule-v1'; other.local.todos = []; other.local.coachPushes = [{ id: 'new-owner-local', origin: 'local', title: '今天还有什么想记录的吗？', body: '合法本机提醒' }];
  assert.ok(separateOwner(x.before, other, 'other'));
  assert.equal(separateOwner(x.before, other, 'wrong'), false);
  for (const row of [{ id: 'local', origin: 'local' }, { id: 'fresh', origin: 'cloud' }, { id: 'fresh', origin: 'local', body: f.body }]) { other.local.coachPushes = [row]; assert.equal(separateOwner(x.before, other, 'other'), false); }
});
test('all original insights/settings retained except exact bounded cursor and tombstone metadata', () => {
  const x = model(); x.before.databaseName = x.after.databaseName = 'youtrace:user:owner:schedule-v1';
  x.before.local.coachInsights = [{ id: 'old', body: '原文' }]; x.after.local.coachInsights = [{ id: 'old', body: '原文' }, { id: 'new-brief' }];
  x.before.local.settings = [{ key: 'coachPushEnabled', value: true }, { key: 'lastPullAt', value: '2026-10-07T04:00:00.000Z' }];
  x.after.local.settings.push(...structuredClone(x.before.local.settings), { key: 'coachPushDeletionScan:v1', value: { owner: 'owner', dataEpoch: 'initial', afterId: 'valid-id' } });
  assert.ok(preservedInsightsAndSettings(x.before, x.after));
  const modified = structuredClone(x.after); modified.local.settings.find(row => row.key === 'coachPushEnabled').value = false; assert.equal(preservedInsightsAndSettings(x.before, modified), false);
  const lost = structuredClone(x.after); lost.local.settings = lost.local.settings.filter(row => row.key !== 'coachPushEnabled'); assert.equal(preservedInsightsAndSettings(x.before, lost), false);
  const wrong = structuredClone(x.after); wrong.local.settings.find(row => row.key === 'coachPushDeletionScan:v1').value.owner = 'other'; assert.equal(preservedInsightsAndSettings(x.before, wrong), false);
});


test('login entry rejects transient route-only home and waits for visible navigation or native onboarding', async () => {
  const doc = Object.getOwnPropertyDescriptor(globalThis, 'document'), loc = Object.getOwnPropertyDescriptor(globalThis, 'location');
  let path = '/', shown = ''; const button = { textContent: '跳过', getBoundingClientRect: () => ({ width: 60, height: 44 }) };
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { get pathname() { return path; } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelectorAll: (selector: string) => shown === 'onboarding' && selector === 'button' ? [button] : shown === 'home' && selector.includes('主导航') ? [button] : [] } });
  try {
    assert.equal(readAuthenticatedEntry(), false, 'transient / without ready nav is not authenticated entry');
    path = '/onboarding'; shown = 'onboarding'; assert.equal(readAuthenticatedEntry(), 'onboarding');
    const calls: string[] = [];
    const target = { waitForFunction: async (fn: () => unknown, options: { timeout: number }) => { assert.equal(options.timeout, 15000); const value = fn(); assert.ok(value); return { jsonValue: async () => value }; } };
    await finishAuthenticatedEntry(target, async (_: unknown, selector: string, text: string) => { assert.equal(selector, 'button'); assert.equal(text, '跳过'); calls.push('native-skip'); path = '/'; shown = 'home'; }, async (_: unknown, expected: string) => { assert.equal(expected, path); calls.push('route'); });
    assert.deepEqual(calls, ['native-skip', 'route']); assert.equal(readAuthenticatedEntry(), 'home');
    calls.length = 0; await finishAuthenticatedEntry(target, async () => { throw new Error('must not skip twice'); }, async () => { calls.push('route'); }); assert.deepEqual(calls, ['route']);
    await assert.rejects(finishAuthenticatedEntry({ waitForFunction: async () => { throw new Error('bounded timeout'); } }, () => {}, () => {}), /bounded timeout/);
  } finally { if (doc) Object.defineProperty(globalThis, 'document', doc); else Reflect.deleteProperty(globalThis, 'document'); if (loc) Object.defineProperty(globalThis, 'location', loc); else Reflect.deleteProperty(globalThis, 'location'); }
});
