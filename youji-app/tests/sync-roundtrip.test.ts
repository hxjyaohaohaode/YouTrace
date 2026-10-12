import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const scratch = await mkdtemp(join(tmpdir(), 'youtrace-roundtrip-'));
const file = join(scratch, 'synthetic.db');
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `file:${file}`, JWT_SECRET: 'synthetic-roundtrip-secret-32-characters-min', ALLOWED_ORIGINS: 'http://roundtrip.invalid', DEV_OTP_EXPOSE: 'false', LLM_API_KEY: '' });
const store = () => { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) }; };
Object.assign(globalThis, { localStorage: store(), sessionStorage: store(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const database = new DatabaseSync(file, { enableDoubleQuotedStringLiterals: true });
for (const directory of (await readdir(resolve('server/prisma/migrations'))).filter((name) => /^\d/.test(name)).sort()) database.exec(await readFile(resolve('server/prisma/migrations', directory, 'migration.sql'), 'utf8'));
database.close();
const { prisma } = await import('../server/src/utils/db.ts');
const { app } = await import('../server/src/app.ts');
const { issueSession } = await import('../server/src/utils/session.ts');
const { Hono } = await import('../server/node_modules/hono/dist/index.js');
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const { serve } = await import(serverRequire.resolve('@hono/node-server'));
const storage = await import('../src/db/index.ts');
const session = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { commitLocalMutation } = await import('../src/services/localMutation.ts');
// This is real TCP HTTP against the production app with synthetic cookie sessions.
// IndexedDB, window and document remain explicit Node fixtures, not a browser E2E.
const nativeFetch = globalThis.fetch;
const ownerA = 'synthetic-roundtrip-a';
const ownerB = 'synthetic-roundtrip-b';
let server: ReturnType<typeof serve> | undefined;
let baseUrl = '';
let cookie = '';
let cookieA = '';
let cookieB = '';
let offline = false;
let loseResponse = false;
let wrongMutationId = false;
let ackBeforeRewrite: Record<string, unknown> | undefined;
let batchBeforeRewrite: unknown;
const requests: Array<Record<string, unknown>> = [];
const httpRequests: Array<{ path: string; method: string; account: string | null; cookieOwner: string | null; status: number; accountMismatch: string | null; body: string | null }> = [];

async function requestOverHttp(path: string | URL | Request, init: RequestInit = {}, sessionCookie = cookie) {
  const url = new URL(path instanceof Request ? path.url : String(path), baseUrl);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.origin, baseUrl, 'synthetic requests must stay on the ephemeral fixture listener');
  const headers = new Headers(init.headers);
  if (sessionCookie) headers.set('Cookie', sessionCookie);
  headers.set('Origin', 'http://roundtrip.invalid');
  const response = await nativeFetch(url, { ...init, headers, redirect: 'error' });
  httpRequests.push({
    path: url.pathname, method: init.method ?? 'GET', account: headers.get('X-YouTrace-Account'),
    cookieOwner: sessionCookie === cookieA && cookieA ? ownerA : sessionCookie === cookieB && cookieB ? ownerB : null,
    status: response.status, accountMismatch: response.headers.get('X-YouTrace-Account-Mismatch'),
    body: init.body === undefined ? null : String(init.body),
  });
  if (url.pathname === '/api/sync/push') requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
  return response;
}

before(async () => {
  const userA = await prisma.user.create({ data: { id: ownerA, phone: 'synthetic-001', nickname: 'Synthetic A' } });
  const userB = await prisma.user.create({ data: { id: ownerB, phone: 'synthetic-002', nickname: 'Synthetic B' } });
  const fixture = new Hono();
  fixture.get('/__test/session/a', (c) => { issueSession(c, userA); return c.text('ok'); });
  fixture.get('/__test/session/b', (c) => { issueSession(c, userB); return c.text('ok'); });
  fixture.route('/', app);
  server = serve({ fetch: fixture.fetch, hostname: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  assert.equal(address.address, '127.0.0.1');
  assert.ok(address.port > 0);
  baseUrl = `http://127.0.0.1:${address.port}`;
  cookieA = (await requestOverHttp('/__test/session/a')).headers.get('set-cookie')!.split(';')[0];
  cookieB = (await requestOverHttp('/__test/session/b')).headers.get('set-cookie')!.split(';')[0];
  cookie = cookieA;
  await storage.bindAccountDatabase(ownerA);
  session.setSessionActive(ownerA);
  globalThis.fetch = async (path, init = {}) => {
    if (offline) throw new TypeError('synthetic offline transport before HTTP');
    const response = await requestOverHttp(path, init);
    const isPush = String(path).includes('/sync/push');
    if (loseResponse && isPush && response.ok) {
      loseResponse = false;
      await response.arrayBuffer();
      throw new Error('synthetic lost response after real HTTP commit');
    }
    if (wrongMutationId && isPush && response.ok) {
      wrongMutationId = false;
      ackBeforeRewrite = await response.json() as Record<string, unknown>;
      batchBeforeRewrite = (await storage.db.settings.get('syncV2Batch'))?.value;
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      return Response.json({ ...ackBeforeRewrite, mutationId: `wrong-${ackBeforeRewrite.mutationId}` }, { status: response.status, headers });
    }
    return response;
  };
});
after(async () => {
  sync.pauseSync();
  globalThis.fetch = nativeFetch;
  storage.db.close();
  if (server) await new Promise<void>((resolve, reject) => server!.close((error?: Error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
  await rm(scratch, { recursive: true, force: true });
});

async function createLocal(id: string, text: string) {
  sync.pauseSync();
  await commitLocalMutation('todos', 'upsert', { id, text, done: false, priority: 'medium' }, () => storage.db.todos.put({ id, text, done: false, priority: 'medium' }));
  await sync.retryBlockedSync();
}

test('real TCP HTTP + fake IndexedDB: lost response replays identical durable batch without duplicate events', async () => {
  loseResponse = true;
  await createLocal('roundtrip-todo-001', 'original');
  assert.equal(await storage.db.outbox.count(), 1);
  assert.equal(await prisma.todo.count({ where: { id: 'roundtrip-todo-001' } }), 1);
  const beforeCount = await prisma.syncChange.count();
  await sync.flush();
  assert.equal(await storage.db.outbox.count(), 0);
  assert.deepEqual(requests.at(-1), requests.at(-2));
  assert.equal(await prisma.syncChange.count(), beforeCount);
  assert.equal(await prisma.syncReceipt.count(), 1);
});

test('real TCP HTTP + fake IndexedDB: ACK rebases next local edit and remote deletion propagates', async () => {
  await createLocal('roundtrip-todo-001', 'next edit');
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal((await prisma.todo.findUnique({ where: { id: 'roundtrip-todo-001' } }))?.text, 'next edit');
  await prisma.todo.delete({ where: { id: 'roundtrip-todo-001' } });
  await sync.pullServerChanges();
  assert.equal(await storage.db.todos.get('roundtrip-todo-001'), undefined);
});

test('real TCP HTTP + fake IndexedDB: newer remote edit preserves pending local input and explicit resolution keeps recovery copy', async () => {
  await createLocal('roundtrip-todo-002', 'base');
  sync.pauseSync();
  await commitLocalMutation('todos', 'upsert', { id: 'roundtrip-todo-002', text: 'offline local draft', done: false, priority: 'medium' }, () => storage.db.todos.put({ id: 'roundtrip-todo-002', text: 'offline local draft', done: false, priority: 'medium' }));
  await prisma.todo.update({ where: { id: 'roundtrip-todo-002' }, data: { text: 'remote edit' } });
  await sync.retryBlockedSync();
  assert.equal(await storage.db.outbox.count(), 1);
  await sync.pullServerChanges();
  assert.equal((await storage.db.todos.get('roundtrip-todo-002'))?.text, 'offline local draft');
  const key = 'sync-conflict:todos:roundtrip-todo-002';
  assert.ok(await storage.db.settings.get(key));
  await sync.acceptRemoteConflict(key, (await sync.readConflictSnapshot(key))!);
  assert.equal((await storage.db.todos.get('roundtrip-todo-002'))?.text, 'remote edit');
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal((await storage.db.settings.toArray()).filter((row) => row.key.startsWith('sync-recovery:')).length, 1);
});

test('real TCP HTTP + fake IndexedDB: paginated equal-timestamp changefeed imports every ID', async () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const count = 2001;
  for (let offset = 0; offset < count; offset += 250) await prisma.todo.createMany({ data: Array.from({ length: Math.min(250, count - offset) }, (_, i) => ({ id: `bulk-client-${offset + i}`, userId: 'synthetic-roundtrip-a', text: 'synthetic', updatedAt: at })) });
  await sync.pullServerChanges();
  const actual = new Set((await storage.db.todos.toArray()).filter((row) => row.id.startsWith('bulk-client-')).map((row) => row.id));
  assert.equal(actual.size, count);
  for (let i = 0; i < count; i++) assert.ok(actual.has(`bulk-client-${i}`));
});

test('real TCP HTTP + fake IndexedDB: goal upload retries the exact lost-response batch and preserves original date', async () => {
  const { useGoalStore } = await import('../src/stores/goalStore.ts');
  sync.pauseSync();
  const legacy = { id: 'roundtrip-goal-legacy-001', title: 'Synthetic selected goal', description: 'Preserved original', level: 'medium' as const, domain: '生活', priority: 'high' as const, progress: 25, targetDate: '2026-12-01', createdAt: 1000, updatedAt: 2000 };
  await storage.db.goalRecords.put(legacy);
  await useGoalStore.getState().enableSync([legacy], 'synthetic-roundtrip-a');
  loseResponse = true;
  await sync.retryBlockedSync();
  assert.equal(await storage.db.outbox.count(), 1);
  const row = await prisma.goal.findUnique({ where: { id: legacy.id } });
  assert.equal(row?.createdAt.getTime(), 1000);
  assert.equal(row?.progress, 25);
  const events = await prisma.syncChange.count({ where: { entity: 'goals' } });
  await sync.flush();
  assert.equal(await storage.db.outbox.count(), 0);
  assert.deepEqual(requests.at(-1), requests.at(-2));
  assert.equal(await prisma.syncChange.count({ where: { entity: 'goals' } }), events);
});

test('real TCP HTTP + fake IndexedDB: goal conflict retains offline progress, adopts explicit remote, and delete cannot resurrect', async () => {
  const { useGoalStore } = await import('../src/stores/goalStore.ts');
  await useGoalStore.getState().loadFromDB();
  sync.pauseSync();
  await useGoalStore.getState().updateProgress('roundtrip-goal-legacy-001', 75);
  await prisma.goal.update({ where: { id: 'roundtrip-goal-legacy-001' }, data: { progress: 50 } });
  await sync.retryBlockedSync();
  assert.equal(await storage.db.outbox.count(), 1);
  await sync.pullServerChanges();
  assert.equal((await storage.db.goalRecords.get('roundtrip-goal-legacy-001'))?.progress, 75);
  await sync.acceptRemoteConflict('sync-conflict:goals:roundtrip-goal-legacy-001', (await sync.readConflictSnapshot('sync-conflict:goals:roundtrip-goal-legacy-001'))!);
  assert.equal((await storage.db.goalRecords.get('roundtrip-goal-legacy-001'))?.progress, 50);
  assert.equal((await storage.db.goalRecords.get('roundtrip-goal-legacy-001'))?.syncScope, 'account');
  await useGoalStore.getState().loadFromDB();
  sync.pauseSync();
  await useGoalStore.getState().updateProgress('roundtrip-goal-legacy-001', 100);
  await prisma.goal.delete({ where: { id: 'roundtrip-goal-legacy-001' } });
  await sync.retryBlockedSync();
  assert.equal(await storage.db.outbox.count(), 1);
  assert.equal(await prisma.goal.count({ where: { id: 'roundtrip-goal-legacy-001' } }), 0);
  await sync.pullServerChanges();
  await sync.acceptRemoteConflict('sync-conflict:goals:roundtrip-goal-legacy-001', (await sync.readConflictSnapshot('sync-conflict:goals:roundtrip-goal-legacy-001'))!);
  assert.equal(await storage.db.goalRecords.get('roundtrip-goal-legacy-001'), undefined);
  assert.equal(await storage.db.outbox.count(), 0);
});

test('real TCP HTTP + fake IndexedDB: cloud ID collision never overwrites a still-local goal', async () => {
  const local = { id: 'roundtrip-goal-collision-001', title: 'Local-only original', description: '', level: 'short' as const, domain: '生活', priority: 'low' as const, progress: 0, targetDate: null, createdAt: 1, updatedAt: 1 };
  await storage.db.goalRecords.put(local);
  await prisma.goal.create({ data: { id: local.id, userId: 'synthetic-roundtrip-a', title: 'Cloud same ID', description: '', level: 'short', domain: '生活', priority: 'low' } });
  await sync.pullServerChanges();
  assert.deepEqual(await storage.db.goalRecords.get(local.id), local);
  assert.ok(await storage.db.settings.get(`sync-conflict:goals:${local.id}`));
  await sync.acceptRemoteConflict(`sync-conflict:goals:${local.id}`, (await sync.readConflictSnapshot(`sync-conflict:goals:${local.id}`))!);
  assert.equal((await storage.db.goalRecords.get(local.id))?.title, 'Cloud same ID');
});

test('real TCP HTTP + fake IndexedDB: accepting a stale goal comparison never consumes a newer version or local edit', async () => {
  const { useGoalStore } = await import('../src/stores/goalStore.ts');
  await useGoalStore.getState().loadFromDB();
  const goalId = 'roundtrip-goal-collision-001';
  sync.pauseSync();
  await useGoalStore.getState().updateProgress(goalId, 75);
  await prisma.goal.update({ where: { id: goalId }, data: { progress: 25 } });
  await sync.retryBlockedSync(); await sync.pullServerChanges();
  const key = `sync-conflict:goals:${goalId}`;
  const viewed = (await sync.readConflictSnapshot(key))!;
  await prisma.goal.update({ where: { id: goalId }, data: { progress: 50 } });
  await sync.pullServerChanges();
  await assert.rejects(sync.acceptRemoteConflict(key, viewed), /刚刚变化/);
  assert.equal((await storage.db.goalRecords.get(goalId))?.progress, 75);
  assert.equal(await storage.db.outbox.count(), 1);
  const newerView = (await sync.readConflictSnapshot(key))!;
  sync.pauseSync();
  await useGoalStore.getState().updateProgress(goalId, 100);
  await assert.rejects(sync.acceptRemoteConflict(key, newerView), /刚刚变化/);
  assert.equal((await storage.db.goalRecords.get(goalId))?.progress, 100);
  assert.equal(await storage.db.outbox.count(), 2);
});

test('real TCP HTTP + fake IndexedDB: completion time survives event replay, clear rebuild and undo without inventing legacy dates', async () => {
  const { useTodoStore } = await import('../src/stores/todoStore.ts');
  // Resolve the previous test's deliberately preserved conflict before this independent fixture.
  const oldConflict = 'sync-conflict:goals:roundtrip-goal-collision-001';
  await sync.acceptRemoteConflict(oldConflict, (await sync.readConflictSnapshot(oldConflict))!);
  const id = 'completion-time-todo-001'; await createLocal(id, 'Synthetic completion time');
  await useTodoStore.getState().loadFromDB(); sync.pauseSync(); await useTodoStore.getState().toggleTodo(id);
  const completedAt = (await storage.db.todos.get(id))!.completedAt; assert.equal(typeof completedAt, 'number');
  await sync.retryBlockedSync(); await sync.pullServerChanges();
  assert.equal((await storage.db.todos.get(id))?.completedAt, completedAt);
  const sql = await prisma.syncChange.findFirstOrThrow({ where: { entity: 'todos', entityId: id }, orderBy: { seq: 'desc' } });
  assert.equal(Number(JSON.parse(sql.payload!).completedAt), completedAt);
  sync.pauseSync(); await storage.clearAllData(); await sync.retryBlockedSync(); await sync.pullServerChanges();
  assert.equal((await storage.db.todos.get(id))?.completedAt, completedAt, 'clean client rebuild uses the persisted change payload');
  await useTodoStore.getState().loadFromDB(); sync.pauseSync(); await useTodoStore.getState().toggleTodo(id); await sync.retryBlockedSync(); await sync.pullServerChanges();
  assert.equal((await storage.db.todos.get(id))?.done, false); assert.equal((await storage.db.todos.get(id))?.completedAt, null);
  assert.equal((await prisma.todo.findUniqueOrThrow({ where: { id } })).completedAt, null);
});

test('real TCP HTTP + fake IndexedDB: original capture whitespace survives cloud replay exactly', async () => {
  const capture = await import('../src/services/quickNoteIntegration.ts');
  const input = await capture.forkCaptureInput(), original = '  Synthetic original line\n\tsecond line  \n';
  await capture.saveCaptureInput(input, original); const draft = await capture.createCaptureDraft(original, input); draft.diary = null;
  await capture.saveCaptureDraft(draft, true); sync.pauseSync(); await capture.applyCaptureDraft(draft); await sync.retryBlockedSync(); await sync.pullServerChanges();
  assert.equal((await storage.db.quickNotes.get(draft.id))?.rawInput, original);
  assert.equal((await prisma.quickNote.findUniqueOrThrow({ where: { id: draft.id } })).content, original);
  assert.equal(await storage.db.settings.get(input.key), undefined);
});

test('real TCP HTTP + fake IndexedDB: historical nullable expense fields remain editable without unexpected payload fields', async () => {
  const { useExpenseStore } = await import('../src/stores/expenseStore.ts');
  const id = 'expense-nullable-compat';
  await prisma.expense.create({ data: { id, userId: 'synthetic-roundtrip-a', name: 'Synthetic historical expense', amount: 1065, category: 'food', date: '2026-09-29', source: 'manual', note: null, relatedMood: null } });
  await sync.pullServerChanges(); await useExpenseStore.getState().loadFromDB();
  const original = useExpenseStore.getState().items.find(row => row.id === id)!; assert.equal((original as { note?: unknown }).note, null);
  sync.pauseSync(); await useExpenseStore.getState().updateItem(id, { name: 'Synthetic corrected historical expense' }, original);
  await sync.retryBlockedSync(); await sync.pullServerChanges();
  assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id } })).name, 'Synthetic corrected historical expense');
  assert.equal(await prisma.expense.count({ where: { id } }), 1); assert.equal(await storage.db.outbox.count(), 0);
});


test('real TCP HTTP + fake IndexedDB: wrong mutation ID ACK retains the exact frozen batch after server commit', async () => {
  const id = 'roundtrip-wrong-ack-001';
  const requestStart = requests.length;
  const eventStart = await prisma.syncChange.count();
  assert.equal(await storage.db.outbox.count(), 0);
  sync.pauseSync();
  await commitLocalMutation('todos', 'upsert', { id, text: 'preserve despite wrong ACK', done: false, priority: 'medium' }, () => storage.db.todos.put({ id, text: 'preserve despite wrong ACK', done: false, priority: 'medium' }));
  const originalQueue = await storage.db.outbox.toArray();
  wrongMutationId = true;
  await sync.retryBlockedSync();
  sync.pauseSync();

  const pending = await storage.db.outbox.toArray();
  const frozen = (await storage.db.settings.get('syncV2Batch'))?.value as { mutationId: string; payload: Record<string, unknown>; seqs: number[] };
  assert.ok(frozen);
  assert.deepEqual(frozen, batchBeforeRewrite, 'a mismatched ACK cannot replace or consume the frozen batch');
  assert.equal(ackBeforeRewrite?.acknowledged, true);
  assert.equal(ackBeforeRewrite?.mutationId, frozen.mutationId, 'the real server committed and returned the matching ACK before transport corruption');
  assert.deepEqual(frozen.payload, requests[requestStart]);
  assert.deepEqual(frozen.seqs, originalQueue.map(row => row.seq));
  assert.equal(pending.length, 1);
  assert.equal(typeof pending[0].lastAttemptAt, 'number');
  assert.equal(pending[0].lastStatus, undefined);
  assert.deepEqual(pending[0], { ...originalQueue[0], status: 'pending', attempts: 1, lastAttemptAt: pending[0].lastAttemptAt });
  assert.equal((await prisma.todo.findUniqueOrThrow({ where: { id } })).text, 'preserve despite wrong ACK');
  assert.equal(await prisma.syncChange.count(), eventStart + 1);
  assert.equal(await prisma.syncReceipt.count({ where: { userId: ownerA, mutationId: frozen.mutationId } }), 1);

  await sync.retryBlockedSync();
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal(await storage.db.settings.get('syncV2Batch'), undefined);
  assert.deepEqual(requests.slice(requestStart), [frozen.payload, frozen.payload]);
  const wireBodies = httpRequests.filter(request => request.path === '/api/sync/push').slice(-2);
  assert.equal(wireBodies.length, 2);
  assert.equal(wireBodies[0].body, wireBodies[1].body, 'retry sends the exact serialized frozen payload');
  assert.ok(wireBodies.every(request => request.status === 200 && request.account === ownerA && request.cookieOwner === ownerA));
  assert.equal(await prisma.syncChange.count(), eventStart + 1, 'receipt replay must not emit another event');
  assert.equal(await prisma.syncReceipt.count({ where: { userId: ownerA, mutationId: frozen.mutationId } }), 1);
});

test('real TCP HTTP + fake IndexedDB: A/B/A sessions preserve offline A work and enforce the account-document reload guard', async () => {
  const idA = 'roundtrip-offline-owner-a';
  const originalText = 'original offline A draft';
  const databaseA = storage.db;
  const requestStart = requests.length;
  const httpStart = httpRequests.length;
  offline = true;
  await createLocal(idA, originalText);
  sync.pauseSync();
  const queuedA = await storage.db.outbox.toArray();
  const frozenA = (await storage.db.settings.get('syncV2Batch'))?.value as { mutationId: string; payload: Record<string, unknown> };
  assert.equal(queuedA.length, 1);
  assert.ok(frozenA);
  assert.equal(httpRequests.length, httpStart, 'offline failure occurs before any real HTTP request');
  assert.equal(await prisma.todo.count({ where: { id: idA } }), 0);

  // A stale document still advertises A after another tab has replaced its cookie with B.
  offline = false;
  cookie = cookieB;
  await sync.retryBlockedSync();
  const ownerMismatch = httpRequests.at(-1)!;
  assert.equal(ownerMismatch.path, '/api/sync/push');
  assert.equal(ownerMismatch.account, ownerA);
  assert.equal(ownerMismatch.cookieOwner, ownerB);
  assert.equal(ownerMismatch.status, 409);
  assert.equal(ownerMismatch.accountMismatch, 'true');
  assert.equal(session.getVerifiedSessionOwner(), null, 'mismatched cookie revokes the stale frontend authority');
  assert.deepEqual(await storage.db.outbox.toArray(), queuedA);
  assert.deepEqual((await storage.db.settings.get('syncV2Batch'))?.value, frozenA);
  assert.equal(await prisma.syncReceipt.count({ where: { mutationId: frozenA.mutationId } }), 0);
  assert.equal(await prisma.todo.count({ where: { id: idA } }), 0);

  session.setSessionActive(ownerB);
  await assert.rejects(storage.bindAccountDatabase(ownerB), /切换账号需要重新加载页面/);
  assert.equal(storage.db, databaseA, 'the existing document never rebinds its local database to B');
  assert.equal(storage.db.ownerId, ownerA);
  const beforeGuardedCalls = httpRequests.length;
  await assert.rejects(sync.retryBlockedSync(), /账号或本机资料已变化/);
  assert.equal(await sync.flush(), false);
  await sync.pullServerChanges();
  await assert.rejects(commitLocalMutation('todos', 'upsert', { id: 'must-not-enter-a', text: 'B stale document', done: false, priority: 'medium' }, () => storage.db.todos.put({ id: 'must-not-enter-a', text: 'B stale document', done: false, priority: 'medium' })), /账号或本机资料已变化/);
  assert.equal(httpRequests.length, beforeGuardedCalls, 'the owner/document guard prevents sync or local writes under B');
  assert.equal(await storage.db.todos.get('must-not-enter-a'), undefined);

  // Exercise B through real authenticated HTTP without bypassing the production DB binding guard.
  const bHttpStart = httpRequests.length;
  const bBefore = await session.api.get<{ todos: Array<{ id: string; userId: string }> }>('/todos');
  assert.deepEqual(bBefore.todos, [], 'B cannot read any already-committed A fixture');
  const bCreated = await session.api.post<{ todo: { id: string; userId: string; text: string } }>('/todos', { text: 'B HTTP-only record', priority: 'low' });
  const idB = bCreated.todo.id;
  assert.equal(bCreated.todo.userId, ownerB);
  const bFeed = await session.api.get<{ events: Array<{ entityId: string }>; hasMore: boolean }>('/sync/pull?protocol=2&features=goals-v1&cursor=0&limit=2000');
  assert.equal(bFeed.hasMore, false);
  assert.deepEqual(bFeed.events.map(event => event.entityId), [idB]);
  assert.deepEqual(httpRequests.slice(bHttpStart).map(request => [request.path, request.method, request.status, request.account, request.cookieOwner]), [
    ['/api/todos', 'GET', 200, ownerB, ownerB],
    ['/api/todos', 'POST', 201, ownerB, ownerB],
    ['/api/sync/pull', 'GET', 200, ownerB, ownerB],
  ]);
  assert.deepEqual(await storage.db.outbox.toArray(), queuedA);
  assert.deepEqual((await storage.db.settings.get('syncV2Batch'))?.value, frozenA);
  assert.equal(await storage.db.todos.get(idB), undefined);
  assert.equal(await prisma.todo.count({ where: { userId: ownerB } }), 1);

  sync.pauseSync();
  session.clearSession();
  cookie = cookieA;
  session.setSessionActive(ownerA);
  await storage.bindAccountDatabase(ownerA);
  assert.equal(storage.db, databaseA);
  assert.deepEqual(await storage.db.outbox.toArray(), queuedA);
  await sync.retryBlockedSync();
  await sync.pullServerChanges();
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal(await storage.db.settings.get('syncV2Batch'), undefined);
  assert.deepEqual(requests.slice(requestStart), [frozenA.payload, frozenA.payload]);
  assert.equal((await storage.db.todos.get(idA))?.text, originalText);
  assert.equal(await storage.db.todos.get(idB), undefined, 'B data must not enter A through the resumed pull');
  const savedA = await prisma.todo.findUniqueOrThrow({ where: { id: idA } });
  assert.equal(savedA.userId, ownerA);
  assert.equal(savedA.text, originalText);
  assert.equal(await prisma.syncChange.count({ where: { entity: 'todos', entityId: idA } }), 1);
  assert.equal(await prisma.syncReceipt.count({ where: { userId: ownerA, mutationId: frozenA.mutationId } }), 1);
  assert.equal(await prisma.syncReceipt.count({ where: { userId: ownerB, mutationId: frozenA.mutationId } }), 0);
  const bAfterResponse = await requestOverHttp('/api/todos', { headers: { 'X-YouTrace-Account': ownerB } }, cookieB);
  assert.equal(bAfterResponse.status, 200);
  const bAfter = await bAfterResponse.json() as { todos: Array<{ id: string; userId: string }> };
  assert.deepEqual(bAfter.todos.map(todo => [todo.id, todo.userId]), [[idB, ownerB]], 'A resumption cannot upload the original queue into B');
});
