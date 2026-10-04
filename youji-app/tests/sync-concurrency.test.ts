import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
const values = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) }, window: new EventTarget() });
const storage = await import('../src/db/index.ts');
await storage.bindAccountDatabase('synthetic-concurrency');
const session = await import('../src/services/apiClient.ts');
session.setSessionActive('synthetic-concurrency');
const tabA = await import('../src/services/syncEngine.ts?context=a');
const tabB = await import('../src/services/syncEngine.ts?context=b');
const requests: Array<{ body: { mutationId: string }; resolve: (response: Response) => void }> = [];
const tick = () => new Promise((r) => setTimeout(r, 1));
async function waitForCount(count: number) { const until = Date.now() + 3000; while (requests.length < count && Date.now() < until) await tick(); assert.equal(requests.length, count); }
const ack = (request: typeof requests[number], seq: string) => Response.json({ protocol: 2, acknowledged: true, mutationId: request.body.mutationId, versions: [{ entity: 'todos', entityId: 'shared-record-001', seq }] });
after(() => { tabA.pauseSync(); tabB.pauseSync(); storage.db.close(); });

test('two runtime contexts: stale ACK cannot clear a successor frozen batch or rewind its version', async () => {
  globalThis.fetch = async (_url, options = {}) => new Promise<Response>((resolve) => requests.push({ body: JSON.parse(String(options.body)), resolve }));
  await storage.db.outbox.add({ entity: 'todos', op: 'upsert', payload: { id: 'shared-record-001', text: 'first' }, queuedAt: 1 });
  const first = tabA.flush(); await waitForCount(1);
  const duplicate = tabB.flush(); await waitForCount(2);
  assert.equal(requests[0].body.mutationId, requests[1].body.mutationId);
  requests[0].resolve(ack(requests[0], '1')); await first;
  await storage.db.outbox.add({ entity: 'todos', op: 'upsert', payload: { id: 'shared-record-001', text: 'next' }, queuedAt: 2 });
  const successor = tabA.flush(); await waitForCount(3);
  assert.notEqual(requests[2].body.mutationId, requests[0].body.mutationId);
  requests[1].resolve(ack(requests[1], '1')); await duplicate;
  assert.equal((await storage.db.settings.get('syncV2Batch'))?.value.mutationId, requests[2].body.mutationId);
  assert.equal(await storage.db.outbox.count(), 1);
  requests[2].resolve(ack(requests[2], '2')); await successor;
  assert.equal((await storage.db.settings.get('sync-version:todos:shared-record-001'))?.value, '2');
  assert.equal(await storage.db.outbox.count(), 0);
});

test('two runtime contexts: late older pull cannot replace newer conflict evidence or rewind cursor', async () => {
  const pulls: Array<(r: Response) => void> = [];
  globalThis.fetch = async () => new Promise<Response>((resolve) => pulls.push(resolve));
  await storage.db.outbox.add({ entity: 'todos', op: 'upsert', payload: { id: 'shared-record-001', text: 'pending' }, queuedAt: 3 });
  const oldPage = tabA.pullServerChanges();
  while (pulls.length < 1) await tick();
  const newPage = tabB.pullServerChanges();
  while (pulls.length < 2) await tick();
  const page = (seq: string) => Response.json({ protocol: 2, nextCursor: seq, hasMore: false, events: [{ seq, entity: 'todos', entityId: 'shared-record-001', operation: 'upsert', data: { id: 'shared-record-001', text: `version-${seq}`, done: false, priority: 'medium' } }] });
  pulls[1](page('20')); await newPage;
  pulls[0](page('10')); await oldPage;
  assert.equal((await storage.db.settings.get('syncV2Cursor'))?.value, '20');
  assert.equal((await storage.db.settings.get('sync-conflict:todos:shared-record-001'))?.value.event.seq, '20');
});
