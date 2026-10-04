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
  await sync.acceptRemoteConflict(key);
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
