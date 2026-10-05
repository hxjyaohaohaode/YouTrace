import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';

const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: new EventTarget() });
const storage = await import('../src/db/index.ts');
const session = await import('../src/services/apiClient.ts');
type Engine = typeof import('../src/services/syncEngine.ts');
let engine: Engine, context = 0;
const owner = 'synthetic-sync-wakeup';
const row = (id: string) => ({ id, text: `Synthetic ${id}`, priority: 'medium', done: false });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function waitFor(predicate: () => boolean | Promise<boolean>) { const until = Date.now() + 3000; while (!await predicate()) { if (Date.now() > until) throw new Error('Synthetic scheduler condition timed out'); await tick(); } }

interface Request { body: { mutationId: string; todos?: Array<{ id: string }> }; resolve: (response: Response) => void; reject: (error: Error) => void }
const requests: Request[] = [];
const timers = new Map<number, { delay: number; callback: () => void }>();
const realTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
let timerId = 100_000;
const originalCount = storage.db.outbox.count;
function installTimers() {
  // Only syncEngine's timer is controlled; Dexie and ordinary runtime timers remain real.
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (!new Error().stack?.includes('scheduleFlush')) return Reflect.apply(realTimeout, globalThis, [callback, delay, ...args]);
    const id = ++timerId; timers.set(id, { delay: delay ?? 0, callback: () => callback(...args) }); return id;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    if (typeof id === 'number' && timers.delete(id)) return;
    Reflect.apply(realClearTimeout, globalThis, [id]);
  }) as typeof globalThis.clearTimeout;
}
function fire(delay: number) {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
  assert.ok(entry, `Expected one ${delay}ms sync timer`); timers.delete(entry[0]); entry[1].callback();
}
function ack(index: number, seq = String(index + 1)) {
  const request = requests[index]; request.resolve(Response.json({ protocol: 2, acknowledged: true, mutationId: request.body.mutationId, versions: (request.body.todos ?? []).map(todo => ({ entity: 'todos', entityId: todo.id, seq })) }));
}
async function seed(id = 'synthetic-initial-todo') {
  await storage.db.outbox.add({ entity: 'todos', op: 'upsert', payload: row(id), queuedAt: Date.now(), baseVersion: '0', status: 'pending' });
}
async function enqueue(id = 'synthetic-successor-todo') {
  await storage.db.transaction('rw', storage.db.outbox, storage.db.settings, async () => { await engine.enqueueSync('todos', 'upsert', row(id)); });
}
function delayCount(which: number) {
  const original = storage.db.outbox.count; let reads = 0, enter!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { enter = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  storage.db.outbox.count = (() => original.call(storage.db.outbox).then(async count => { if (++reads === which) { enter(); await waiting; } return count; })) as typeof original;
  return { started, release, restore: () => { storage.db.outbox.count = original; } };
}
async function finishAutomatic(index: number) {
  await waitFor(() => requests.length === index + 1); ack(index);
  await waitFor(async () => await storage.db.outbox.count() === 0); await tick(); await tick();
}

before(async () => { await storage.bindAccountDatabase(owner); });
beforeEach(async () => {
  session.setSessionActive(owner); await storage.clearAllData({ allowPending: true });
  // Fresh actual runtime context keeps backoff and generation state independent per case.
  engine = await import(`../src/services/syncEngine.ts?wakeup=${++context}`) as Engine;
  requests.length = 0; timers.clear(); installTimers();
  globalThis.fetch = async (_path, init = {}) => new Promise<Response>((resolve, reject) => requests.push({ body: JSON.parse(String(init.body)), resolve, reject }));
});
afterEach(() => { engine.pauseSync(); storage.db.outbox.count = originalCount; globalThis.setTimeout = realTimeout; globalThis.clearTimeout = realClearTimeout; session.clearSession(); });
after(() => { storage.db.close(); });

test('successor arriving after the final empty count receives a new drain timer', async () => {
  await seed(); const held = delayCount(2), flushing = engine.flush();
  await waitFor(() => requests.length === 1); ack(0); await held.started;
  await enqueue(); assert.equal(await engine.flush(), false); assert.equal(timers.size, 0);
  held.release(); await flushing; held.restore();
  assert.deepEqual([...timers.values()].map(timer => timer.delay), [300]);
  fire(300); await finishAutomatic(1); assert.equal(requests.length, 2);
});

test('enqueue during a no-batch final empty count also receives a drain timer', async () => {
  const held = delayCount(1), flushing = engine.flush(); await held.started;
  await enqueue(); assert.equal(await engine.flush(), false); held.release(); await flushing; held.restore();
  assert.deepEqual([...timers.values()].map(timer => timer.delay), [300]); fire(300); await finishAutomatic(0);
});

test('pause cancels old queued demand and leaves the uncertain frozen request untouched', async () => {
  await seed(); const flushing = engine.flush(); await waitFor(() => requests.length === 1);
  const frozen = await storage.db.settings.get('syncV2Batch');
  assert.equal(await engine.flush(), false); engine.pauseSync(); ack(0); assert.equal(await flushing, false);
  assert.equal(timers.size, 0); assert.equal(await storage.db.outbox.count(), 1); assert.deepEqual(await storage.db.settings.get('syncV2Batch'), frozen);
});

test('logout suppresses a requested wakeup and a later resume retries the same frozen bytes', async () => {
  await seed(); const flushing = engine.flush(); await waitFor(() => requests.length === 1);
  const frozen = await storage.db.settings.get('syncV2Batch'); assert.equal(await engine.flush(), false);
  session.clearSession(); ack(0); assert.equal(await flushing, false);
  assert.equal(timers.size, 0); assert.equal(await storage.db.outbox.count(), 1); assert.deepEqual(await storage.db.settings.get('syncV2Batch'), frozen);
  session.setSessionActive(owner); engine.resumeSync(); fire(500); await finishAutomatic(1);
  assert.deepEqual(requests[1].body, requests[0].body);
});

test('old finalization preserves new-generation demand after its resume timer already fired busy', async () => {
  await seed(); const held = delayCount(2), flushing = engine.flush();
  await waitFor(() => requests.length === 1); ack(0); await held.started;
  assert.equal(await engine.flush(), false); engine.pauseSync(); engine.resumeSync();
  fire(500); await tick(); assert.equal(timers.size, 0);
  await enqueue(); assert.equal(await engine.flush(), false);
  held.release(); await flushing; held.restore();
  assert.deepEqual([...timers.values()].map(timer => timer.delay), [300]);
  fire(300); await finishAutomatic(1); assert.equal(requests.length, 2);
});

test('new-generation demand survives an old HTTP response, retaining its frozen replay and drain deadline', async () => {
  await seed(); const flushing = engine.flush(); await waitFor(() => requests.length === 1);
  engine.pauseSync(); engine.resumeSync(); fire(500); await tick(); await enqueue();
  ack(0); assert.equal(await flushing, false);
  assert.equal(await storage.db.outbox.count(), 2); assert.deepEqual([...timers.values()].map(timer => timer.delay), [1100]);
  fire(1100); await waitFor(() => requests.length === 2); assert.deepEqual(requests[1].body, requests[0].body); ack(1, '1');
  await waitFor(() => [...timers.values()].some(timer => timer.delay === 1100));
  fire(1100); await finishAutomatic(2); assert.equal(requests[2].body.todos?.[0].id, 'synthetic-successor-todo');
});

for (const failure of ['network', '429'] as const) test(`busy demand preserves the existing ${failure} retry backoff rather than replacing it with 300ms`, async () => {
  await seed(); const flushing = engine.flush(); await waitFor(() => requests.length === 1);
  await enqueue(); assert.equal(await engine.flush(), false);
  if (failure === 'network') requests[0].reject(new Error('Synthetic temporary network failure'));
  else requests[0].resolve(Response.json({ error: 'Synthetic rate limit', code: 'RATE_LIMITED' }, { status: 429 }));
  assert.equal(await flushing, false);
  const delay = failure === 'network' ? 4000 : 10000;
  assert.deepEqual([...timers.values()].map(timer => timer.delay), [delay]);
  assert.equal(await storage.db.outbox.count(), 2); assert.equal(requests.length, 1);
  engine.pauseSync(); assert.equal(timers.size, 0);
});

test('blocked mutation does not become an unbounded short retry loop when one demand was recorded', async () => {
  await seed(); const flushing = engine.flush(); await waitFor(() => requests.length === 1);
  assert.equal(await engine.flush(), false);
  requests[0].resolve(Response.json({ error: 'Synthetic conflict', code: 'VERSION_CONFLICT' }, { status: 409 }));
  assert.equal(await flushing, false); assert.deepEqual([...timers.values()].map(timer => timer.delay), [300]);
  const held = delayCount(1); fire(300); await held.started; held.release(); held.restore(); await tick(); await tick();
  assert.equal(timers.size, 0); assert.equal(requests.length, 1); assert.equal((await storage.db.outbox.toArray())[0].status, 'blocked');
});
