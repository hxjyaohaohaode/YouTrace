import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; };
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const storage = await import('../src/db/index.ts');
const { useCoachStore } = await import('../src/stores/coachStore.ts');
const api = await import('../src/services/apiClient.ts');
const { pauseSync } = await import('../src/services/syncEngine.ts');
const owner = 'synthetic-coach-deletion-client';
const push = (id: string, origin?: 'cloud' | 'local') => ({ id, origin, type: 'follow_up' as const, title: 'Synthetic', body: 'Synthetic', actions: [], read: false, acted: false, createdAt: 1 });
const empty = (path: unknown) => Response.json(String(path).includes('/insights') ? { insights: [] } : { pushes: [] });
before(async () => { await storage.bindAccountDatabase(owner); });
beforeEach(async () => {
  api.clearSession(); pauseSync();
  await storage.db.coachInsights.clear(); await storage.db.coachPushes.clear(); await storage.db.settings.clear();
  api.setSessionActive(owner); useCoachStore.setState({ insights: [], pushes: [], loaded: false });
});
after(() => { pauseSync(); api.clearSession(); storage.db.close(); });

test('all 2105 cloud IDs are checked sequentially in batches <=100 without touching local/legacy/paged-out live rows', async () => {
  const ids = Array.from({ length: 2105 }, (_, i) => `cloud-${i}`);
  await storage.db.coachPushes.bulkPut([...ids.map(id => push(id, 'cloud')), push('local-only', 'local'), push('untagged-legacy'), push('paged-out-live', 'cloud')]);
  const requested: string[] = []; let active = 0, maximum = 0;
  globalThis.fetch = async (path, init) => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    const { ids: batch } = JSON.parse(String(init?.body)) as { ids: string[] };
    assert.ok(batch.length <= 100); active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve)); requested.push(...batch); active--;
    return Response.json({ protocol: 1, deletedIds: batch.filter(id => id !== 'paged-out-live') });
  };
  await useCoachStore.getState().loadFromDB();
  assert.deepEqual(requested, [...ids, 'paged-out-live'].sort()); assert.equal(maximum, 1);
  assert.deepEqual((await storage.db.coachPushes.toArray()).map(p => p.id).sort(), ['local-only', 'paged-out-live', 'untagged-legacy']);
  assert.equal((await storage.db.settings.toArray()).filter(row => row.key.startsWith('coachPushDismissed:')).length, 2105);
});

test('partial batch failure keeps unconfirmed rows and safely retries only remaining cached rows', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => `cloud-${i.toString().padStart(3, '0')}`);
  await storage.db.coachPushes.bulkPut(ids.map(id => push(id, 'cloud'))); let calls = 0;
  globalThis.fetch = async (path, init) => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    if (++calls === 2) throw new TypeError('synthetic network interruption');
    return Response.json({ protocol: 1, deletedIds: JSON.parse(String(init?.body)).ids });
  };
  await useCoachStore.getState().loadFromDB();
  assert.equal(calls, 2); assert.equal(await storage.db.coachPushes.count(), 105);
  const retry: string[] = [];
  globalThis.fetch = async (path, init) => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    const batch = JSON.parse(String(init?.body)).ids as string[]; retry.push(...batch); return Response.json({ protocol: 1, deletedIds: batch });
  };
  await useCoachStore.getState().loadFromDB();
  assert.deepEqual(retry, ids.slice(100)); assert.equal(await storage.db.coachPushes.count(), 0);
});

test('invalid/deceptive deletion responses and an old server never authorize cache deletion', async () => {
  await storage.db.coachPushes.bulkPut([push('cloud-one', 'cloud'), push('local-only', 'local'), push('untagged-legacy')]);
  for (const response of [{}, { protocol: 2, deletedIds: ['cloud-one'] }, { protocol: 1, deletedIds: ['not-requested'] }, { protocol: 1, deletedIds: ['local-only'] }, { protocol: 1, deletedIds: ['cloud-one', 'cloud-one'] }, { protocol: 1, deletedIds: [1] }]) {
    globalThis.fetch = async path => String(path).includes('/deletion-status') ? Response.json(response) : empty(path);
    await useCoachStore.getState().loadFromDB(); assert.equal(await storage.db.coachPushes.count(), 3);
  }
  globalThis.fetch = async path => String(path).includes('/deletion-status') ? Response.json({ error: 'old server' }, { status: 404 }) : empty(path);
  await useCoachStore.getState().loadFromDB(); assert.equal(await storage.db.coachPushes.count(), 3);
});

test('authoritative tombstone defeats a late old page and remains effective on repeated loads', async () => {
  await storage.db.coachPushes.put(push('cloud-deleted', 'cloud'));
  globalThis.fetch = async path => String(path).includes('/deletion-status') ? Response.json({ protocol: 1, deletedIds: ['cloud-deleted'] }) : String(path).includes('/insights') ? Response.json({ insights: [] }) : Response.json({ pushes: [{ ...push('cloud-deleted'), createdAt: '2026-10-01T00:00:00Z' }] });
  await useCoachStore.getState().loadFromDB(); await useCoachStore.getState().loadFromDB();
  assert.equal(await storage.db.coachPushes.get('cloud-deleted'), undefined); assert.deepEqual(useCoachStore.getState().pushes, []);
  assert.equal((await storage.db.settings.get('coachPushDismissed:cloud-deleted'))?.value, true);
});

test('session replacement cancels authority, stops later batches and leaves old account cache untouched', async () => {
  await storage.db.coachPushes.bulkPut(Array.from({ length: 205 }, (_, i) => push(`cloud-${i}`, 'cloud')));
  let release!: () => void, seen!: () => void; const started = new Promise<void>(resolve => { seen = resolve; }); let calls = 0;
  globalThis.fetch = async (path, init) => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    calls++; seen(); await new Promise<void>(resolve => { release = resolve; });
    return Response.json({ protocol: 1, deletedIds: JSON.parse(String(init?.body)).ids });
  };
  const loading = useCoachStore.getState().loadFromDB(); await started; api.setSessionActive('different-account'); release(); await loading;
  assert.equal(calls, 1); assert.equal(await storage.db.coachPushes.count(), 205); assert.equal(await storage.db.settings.count(), 0); assert.deepEqual(useCoachStore.getState().pushes, []);
});

test('newer load and data-clear epoch invalidate delayed deletion authority', async () => {
  await storage.db.coachPushes.put(push('cloud-one', 'cloud'));
  let release!: () => void, seen!: () => void; const started = new Promise<void>(resolve => { seen = resolve; }); let calls = 0;
  globalThis.fetch = async path => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    if (++calls === 1) { seen(); await new Promise<void>(resolve => { release = resolve; }); return Response.json({ protocol: 1, deletedIds: ['cloud-one'] }); }
    return Response.json({ protocol: 1, deletedIds: [] });
  };
  const first = useCoachStore.getState().loadFromDB(); await started; await useCoachStore.getState().loadFromDB(); release(); await first;
  assert.ok(await storage.db.coachPushes.get('cloud-one')); assert.equal(await storage.db.settings.get('coachPushDismissed:cloud-one'), undefined);
  globalThis.fetch = async path => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    await storage.setSetting(storage.LOCAL_DATA_EPOCH_KEY, 'changed-during-request');
    return Response.json({ protocol: 1, deletedIds: ['cloud-one'] });
  };
  await useCoachStore.getState().loadFromDB(); assert.ok(await storage.db.coachPushes.get('cloud-one'));
});

test('local transaction failure cannot publish unpersisted deletion or leave a half-written tombstone', async () => {
  const original = push('cloud-one', 'cloud'); await storage.db.coachPushes.put(original); useCoachStore.setState({ pushes: [original] });
  globalThis.fetch = async path => String(path).includes('/deletion-status') ? Response.json({ protocol: 1, deletedIds: ['cloud-one'] }) : empty(path);
  const fail = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.settings.hook('creating', fail);
  try { await assert.rejects(useCoachStore.getState().loadFromDB(), /quota/); }
  finally { storage.db.settings.hook('creating').unsubscribe(fail); }
  assert.ok(await storage.db.coachPushes.get('cloud-one')); assert.equal(await storage.db.settings.get('coachPushDismissed:cloud-one'), undefined); assert.deepEqual(useCoachStore.getState().pushes, [original]);
  await useCoachStore.getState().loadFromDB(); assert.equal(await storage.db.coachPushes.count(), 0);
});

test('persisted fair scan reaches a deleted tail beyond 12000 live IDs across rate windows and reloads', async () => {
  const ids = Array.from({ length: 12001 }, (_, i) => `cloud-${i.toString().padStart(5, '0')}`);
  await storage.db.coachPushes.bulkPut(ids.map(id => push(id, 'cloud')));
  let requests = 0; let windowCalls = 0; const batches: string[][] = [];
  globalThis.fetch = async (path, init) => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    requests++; const batch = JSON.parse(String(init?.body)).ids as string[]; batches.push(batch);
    if (++windowCalls > 120) return Response.json({ error: 'synthetic rate window' }, { status: 429 });
    return Response.json({ protocol: 1, deletedIds: batch.filter(id => id === ids.at(-1)) });
  };
  await useCoachStore.getState().loadFromDB();
  assert.equal(requests, 100); assert.ok(await storage.db.coachPushes.get(ids.at(-1)!));
  const checkpoint = (await storage.db.settings.get('coachPushDeletionScan:v1'))?.value;
  assert.deepEqual(checkpoint, { owner, dataEpoch: 'initial', afterId: ids[9999] });
  // Simulate a view/module state reload while keeping the actual IndexedDB checkpoint.
  useCoachStore.setState({ pushes: [], loaded: false });
  await useCoachStore.getState().loadFromDB();
  assert.equal(requests, 121); assert.ok(await storage.db.coachPushes.get(ids.at(-1)!));
  const failedBatchFirstId = batches.at(-1)![0]; assert.equal(failedBatchFirstId, ids.at(-1));
  windowCalls = 0; requests = 0; batches.length = 0;
  await useCoachStore.getState().loadFromDB();
  assert.ok(requests <= 100); assert.equal(batches[0][0], ids.at(-1));
  assert.equal(await storage.db.coachPushes.get(ids.at(-1)!), undefined);
  assert.equal(await storage.db.coachPushes.count(), 12000);
});

test('scan resumes after a removed cursor, wraps to newly inserted lower IDs, and ignores foreign/old-epoch checkpoints', async () => {
  await storage.db.coachPushes.bulkPut([push('a-new', 'cloud'), push('m-live', 'cloud'), push('z-live', 'cloud'), push('x'.repeat(257), 'cloud')]);
  await storage.setSetting('coachPushDeletionScan:v1', { owner, dataEpoch: 'initial', afterId: 'n-already-removed' });
  const seen: string[][] = [];
  globalThis.fetch = async (path, init) => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    const ids = JSON.parse(String(init?.body)).ids as string[]; seen.push(ids);
    return Response.json({ protocol: 1, deletedIds: ids.filter(id => id === 'a-new') });
  };
  await useCoachStore.getState().loadFromDB(); assert.deepEqual(seen[0], ['z-live', 'a-new', 'm-live']);
  assert.equal(await storage.db.coachPushes.get('a-new'), undefined); assert.ok(await storage.db.coachPushes.get('x'.repeat(257)));
  for (const checkpoint of [{ owner: 'other-owner', dataEpoch: 'initial', afterId: 'n' }, { owner, dataEpoch: 'stale-epoch', afterId: 'n' }]) {
    seen.length = 0; await storage.setSetting('coachPushDeletionScan:v1', checkpoint); await useCoachStore.getState().loadFromDB(); assert.deepEqual(seen[0], ['m-live', 'z-live']);
  }
});

test('256/257-code-unit Unicode and dirty legacy IDs are preserved or queried exactly, with content-free diagnostics', async () => {
  const diagnostics = await import('../src/services/diagnostics'); diagnostics.clearDiagnostics();
  const valid = ['v'.repeat(256), '中'.repeat(256), '😀'.repeat(128), 'good'];
  const invalid: Array<string | number | string[]> = ['', 'v'.repeat(257), '中'.repeat(257), '😀'.repeat(128) + 'a', 123, ['legacy-array-key']];
  await storage.db.coachPushes.bulkPut([...valid.map(id => push(id, 'cloud')), ...invalid.map(id => ({ ...push('unused', 'cloud'), id }) as never)]);
  const seen: string[] = [];
  globalThis.fetch = async (path, init) => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    const ids = JSON.parse(String(init?.body)).ids as string[]; seen.push(...ids); return Response.json({ protocol: 1, deletedIds: ids });
  };
  await useCoachStore.getState().loadFromDB();
  assert.deepEqual(seen, [...valid].sort());
  assert.equal(await storage.db.coachPushes.count(), invalid.length);
  for (const key of invalid) assert.ok(await storage.db.coachPushes.get(key as string));
  assert.ok(diagnostics.diagnosticSnapshot().some(row => row.kind === 'runtime-error' && row.area === 'coach'));
  assert.ok(!JSON.stringify(diagnostics.diagnosticSnapshot()).includes('legacy-array-key'));
  // Null/missing IDs cannot be ordinary IndexedDB primary keys, but a corrupt
  // legacy reader response still must not throw before reaching valid records.
  const original = storage.db.coachPushes.toArray.bind(storage.db.coachPushes);
  storage.db.coachPushes.toArray = async () => [{ ...push('unused', 'cloud'), id: null }, { ...push('unused', 'cloud'), id: undefined }, ...(await original())] as never;
  try { await useCoachStore.getState().loadFromDB(); }
  finally { storage.db.coachPushes.toArray = original; }
  assert.equal(await storage.db.coachPushes.count(), invalid.length);
});

test('long Unicode and JSON-escaped valid IDs stay below the minimum server body limit', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => '\u0000'.repeat(250) + i.toString().padStart(6, '0'));
  await storage.db.coachPushes.bulkPut(ids.map(id => push(id, 'cloud')));
  const seen: string[] = []; let requests = 0;
  globalThis.fetch = async (path, init) => {
    if (!String(path).includes('/deletion-status')) return empty(path);
    requests++; const body = String(init?.body); assert.ok(new TextEncoder().encode(body).byteLength <= 12 * 1024);
    const batch = JSON.parse(body).ids as string[]; seen.push(...batch); return Response.json({ protocol: 1, deletedIds: batch });
  };
  await useCoachStore.getState().loadFromDB(); assert.deepEqual(seen, ids); assert.ok(requests > 3); assert.equal(await storage.db.coachPushes.count(), 0);
});

test('session change during IndexedDB deletion rolls back rows, tombstones and scan checkpoint together', async () => {
  await storage.db.coachPushes.put(push('cloud-one', 'cloud'));
  globalThis.fetch = async path => String(path).includes('/deletion-status') ? Response.json({ protocol: 1, deletedIds: ['cloud-one'] }) : empty(path);
  const changeSession = () => { api.setSessionActive('different-account'); };
  storage.db.coachPushes.hook('deleting', changeSession);
  try { await useCoachStore.getState().loadFromDB(); }
  finally { storage.db.coachPushes.hook('deleting').unsubscribe(changeSession); }
  assert.ok(await storage.db.coachPushes.get('cloud-one'));
  assert.equal(await storage.db.settings.get('coachPushDismissed:cloud-one'), undefined);
  assert.equal(await storage.db.settings.get('coachPushDeletionScan:v1'), undefined);
  assert.deepEqual(useCoachStore.getState().pushes, []);
});
