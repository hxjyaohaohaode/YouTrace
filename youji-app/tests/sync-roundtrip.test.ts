import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
const storage = await import('../src/db/index.ts');
const session = await import('../src/services/apiClient.ts');
const sync = await import('../src/services/syncEngine.ts');
const { commitLocalMutation } = await import('../src/services/localMutation.ts');
let cookie = '';
let loseResponse = false;
const requests: Array<Record<string, unknown>> = [];

before(async () => {
  const user = await prisma.user.create({ data: { id: 'synthetic-roundtrip-a', phone: 'synthetic-001', nickname: 'Synthetic' } });
  const issuer = new Hono();
  issuer.get('/', (c) => { issueSession(c, user); return c.text('ok'); });
  cookie = (await issuer.request('/')).headers.get('set-cookie')!.split(';')[0];
  await storage.bindAccountDatabase(user.id);
  session.setSessionActive(user.id);
  globalThis.fetch = async (path, init = {}) => {
    if (String(path).includes('/sync/push')) requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const response = await app.request(String(path), { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: cookie, Origin: 'http://roundtrip.invalid' } });
    if (loseResponse && String(path).includes('/sync/push') && response.ok) { loseResponse = false; throw new Error('synthetic lost response after commit'); }
    return response;
  };
});
after(async () => { sync.pauseSync(); storage.db.close(); await prisma.$disconnect(); await rm(scratch, { recursive: true, force: true }); });

async function createLocal(id: string, text: string) {
  sync.pauseSync();
  await commitLocalMutation('todos', 'upsert', { id, text, done: false, priority: 'medium' }, () => storage.db.todos.put({ id, text, done: false, priority: 'medium' }));
  await sync.retryBlockedSync();
}

test('real API + fake IndexedDB: lost response replays identical durable batch without duplicate events', async () => {
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

test('real API + fake IndexedDB: ACK rebases next local edit and remote deletion propagates', async () => {
  await createLocal('roundtrip-todo-001', 'next edit');
  assert.equal(await storage.db.outbox.count(), 0);
  assert.equal((await prisma.todo.findUnique({ where: { id: 'roundtrip-todo-001' } }))?.text, 'next edit');
  await prisma.todo.delete({ where: { id: 'roundtrip-todo-001' } });
  await sync.pullServerChanges();
  assert.equal(await storage.db.todos.get('roundtrip-todo-001'), undefined);
});

test('real API + fake IndexedDB: newer remote edit preserves pending local input and explicit resolution keeps recovery copy', async () => {
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

test('real API + fake IndexedDB: paginated equal-timestamp changefeed imports every ID', async () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const count = 2001;
  for (let offset = 0; offset < count; offset += 250) await prisma.todo.createMany({ data: Array.from({ length: Math.min(250, count - offset) }, (_, i) => ({ id: `bulk-client-${offset + i}`, userId: 'synthetic-roundtrip-a', text: 'synthetic', updatedAt: at })) });
  await sync.pullServerChanges();
  const actual = new Set((await storage.db.todos.toArray()).filter((row) => row.id.startsWith('bulk-client-')).map((row) => row.id));
  assert.equal(actual.size, count);
  for (let i = 0; i < count; i++) assert.ok(actual.has(`bulk-client-${i}`));
});

test('real API + fake IndexedDB: goal upload retries the exact lost-response batch and preserves original date', async () => {
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

test('real API + fake IndexedDB: goal conflict retains offline progress, adopts explicit remote, and delete cannot resurrect', async () => {
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

test('real API + fake IndexedDB: cloud ID collision never overwrites a still-local goal', async () => {
  const local = { id: 'roundtrip-goal-collision-001', title: 'Local-only original', description: '', level: 'short' as const, domain: '生活', priority: 'low' as const, progress: 0, targetDate: null, createdAt: 1, updatedAt: 1 };
  await storage.db.goalRecords.put(local);
  await prisma.goal.create({ data: { id: local.id, userId: 'synthetic-roundtrip-a', title: 'Cloud same ID', description: '', level: 'short', domain: '生活', priority: 'low' } });
  await sync.pullServerChanges();
  assert.deepEqual(await storage.db.goalRecords.get(local.id), local);
  assert.ok(await storage.db.settings.get(`sync-conflict:goals:${local.id}`));
  await sync.acceptRemoteConflict(`sync-conflict:goals:${local.id}`, (await sync.readConflictSnapshot(`sync-conflict:goals:${local.id}`))!);
  assert.equal((await storage.db.goalRecords.get(local.id))?.title, 'Cloud same ID');
});

test('real API + fake IndexedDB: accepting a stale goal comparison never consumes a newer version or local edit', async () => {
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

test('real API + fake IndexedDB: completion time survives event replay, clear rebuild and undo without inventing legacy dates', async () => {
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

test('real API + fake IndexedDB: original capture whitespace survives cloud replay exactly', async () => {
  const capture = await import('../src/services/quickNoteIntegration.ts');
  const input = await capture.forkCaptureInput(), original = '  Synthetic original line\n\tsecond line  \n';
  await capture.saveCaptureInput(input, original); const draft = await capture.createCaptureDraft(original, input); draft.diary = null;
  await capture.saveCaptureDraft(draft, true); sync.pauseSync(); await capture.applyCaptureDraft(draft); await sync.retryBlockedSync(); await sync.pullServerChanges();
  assert.equal((await storage.db.quickNotes.get(draft.id))?.rawInput, original);
  assert.equal((await prisma.quickNote.findUniqueOrThrow({ where: { id: draft.id } })).content, original);
  assert.equal(await storage.db.settings.get(input.key), undefined);
});

test('real API + fake IndexedDB: historical nullable expense fields remain editable without unexpected payload fields', async () => {
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
