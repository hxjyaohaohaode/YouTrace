import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import type { useSettingsStore as StoreType } from '../src/stores/settingsStore';

const memoryStorage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) }; };
Object.assign(globalThis, { localStorage: memoryStorage(), sessionStorage: memoryStorage(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const storage = await import('../src/db/index.ts');
const api = await import('../src/services/apiClient.ts');
const stateKey = 'accountPreferences:state:v1';
const pendingKey = 'pendingSetting:accountPreferences';
let modules = 0;
const disposers = new Set<() => void>();
const freshStore = async (): Promise<typeof StoreType> => { const module = await import(`../src/stores/settingsStore.ts?settings_case=${++modules}`); disposers.add(module.stopPreferenceSync); return module.useSettingsStore; };
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const defaults = { coachStyle: 'gentle', coachPushEnabled: false, pushLimit: 2, quietEnabled: true, quietStart: '23:00', quietEnd: '07:00', eveningReviewEnabled: false, eveningReviewTime: '21:00' };
interface Request { protocol: number; mutationId: string; baseRevision: string; changes: Record<string, unknown> }
function server() {
  let rev = 0;
  let settings = { ...defaults };
  const receipts = new Map<string, { request: string; response: unknown }>();
  const requests: Request[] = [];
  const snapshot = () => structuredClone({ protocol: 1, revision: String(rev), settings });
  const remote = (changes: Partial<typeof defaults>) => { settings = { ...settings, ...changes }; rev += 1; };
  const handle = async (_url: string | URL | globalThis.Request, init?: RequestInit) => {
    if (init?.method !== 'PATCH') return Response.json(snapshot());
    const request = JSON.parse(String(init.body)) as Request;
    requests.push(request);
    const prior = receipts.get(request.mutationId);
    if (prior) return prior.request === JSON.stringify(request) ? Response.json(prior.response) : Response.json({ code: 'SETTINGS_MUTATION_REUSED' }, { status: 409 });
    if (request.baseRevision !== String(rev)) return Response.json({ error: 'same field changed', code: 'SETTINGS_VERSION_CONFLICT', conflict: snapshot() }, { status: 409 });
    remote(request.changes);
    const response = { ...snapshot(), acknowledged: true, mutationId: request.mutationId };
    receipts.set(request.mutationId, { request: JSON.stringify(request), response });
    return Response.json(response);
  };
  return { snapshot, remote, handle, requests };
}
before(async () => { await storage.bindAccountDatabase('synthetic-preference-client'); });
beforeEach(async () => { await storage.db.settings.clear(); api.setSessionActive('synthetic-preference-client'); });
afterEach(async () => { for (const dispose of disposers) dispose(); disposers.clear(); api.clearSession(); await wait(30); });
after(() => { storage.db.close(); });
async function ready(store: typeof StoreType) { await store.getState().loadSettings(); await store.getState().syncPreferences(); }

test('all reminder account fields round-trip, while theme stays local', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  await store.getState().updateSetting('coachPushEnabled', true);
  await store.getState().updateSetting('quietHours', { enabled: false, start: '22:00', end: '08:00' });
  await store.getState().updateSetting('eveningReviewEnabled', true);
  await store.getState().updateSetting('eveningReviewTime', '20:30');
  await store.getState().updateSetting('theme', 'dark');
  await store.getState().syncPreferences();
  assert.deepEqual(cloud.snapshot().settings, { ...defaults, coachPushEnabled: true, quietEnabled: false, quietStart: '22:00', quietEnd: '08:00', eveningReviewEnabled: true, eveningReviewTime: '20:30' });
  assert.equal(cloud.requests.length, 1); assert.equal('theme' in cloud.requests[0].changes, false);
  assert.equal(await storage.db.settings.get(pendingKey), undefined);
  assert.equal(store.getState().preferenceSync.state, 'synced');
});

test('lost response retry keeps immutable request and cannot overwrite a later remote choice', { timeout: 15_000 }, async () => {
  const cloud = server(); let lose = true;
  globalThis.fetch = async (url, init) => { const response = await cloud.handle(url, init); if (init?.method === 'PATCH' && lose) { lose = false; throw new Error('synthetic response lost'); } return response; };
  const store = await freshStore(); await ready(store);
  await store.getState().updateSetting('coachStyle', 'strict'); await store.getState().syncPreferences();
  assert.ok(await storage.db.settings.get(pendingKey));
  cloud.remote({ coachStyle: 'data' });
  await store.getState().syncPreferences();
  assert.deepEqual(cloud.requests[1], cloud.requests[0]);
  assert.equal(cloud.snapshot().settings.coachStyle, 'data'); assert.equal(store.getState().coachStyle, 'data');
  assert.equal(await storage.db.settings.get(pendingKey), undefined);
});

test('same-field changes conflict, preserve both copies, and require a fresh explicit resolution', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  await store.getState().updateSetting('coachStyle', 'strict'); cloud.remote({ coachStyle: 'data' });
  await store.getState().syncPreferences();
  const conflict = store.getState().preferenceSync.conflict!;
  assert.equal(conflict.local.coachStyle, 'strict'); assert.equal(conflict.remote.coachStyle, 'data'); assert.equal(cloud.requests.length, 0);
  await store.getState().updateSetting('coachPushFrequency', 1);
  await assert.rejects(store.getState().resolvePreferenceConflict('server', conflict.id), /已变化/);
  const fresh = store.getState().preferenceSync.conflict!;
  await store.getState().resolvePreferenceConflict('server', fresh.id);
  assert.equal(store.getState().coachStyle, 'data'); assert.equal(await storage.db.settings.get(pendingKey), undefined);
  assert.equal(await storage.db.settings.where('key').startsWith('preferenceRecovery:').count(), 1);
});

test('disjoint remote updates are safely rebased without erasing the unrelated field', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  await store.getState().updateSetting('coachStyle', 'strict'); cloud.remote({ pushLimit: 3 });
  await store.getState().syncPreferences();
  assert.equal(cloud.snapshot().settings.coachStyle, 'strict'); assert.equal(cloud.snapshot().settings.pushLimit, 3);
  assert.equal(cloud.requests[0].baseRevision, '1'); assert.equal(store.getState().preferenceSync.state, 'synced');
});

test('new edits during an in-flight save keep their causal base and drain after its ACK', { timeout: 15_000 }, async () => {
  const cloud = server(); let release: () => void = () => {}; let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let block = true;
  globalThis.fetch = async (url, init) => { if (init?.method === 'PATCH' && block) { block = false; entered(); await gate; } return cloud.handle(url, init); };
  const store = await freshStore(); await ready(store);
  await store.getState().updateSetting('coachStyle', 'strict'); const sending = store.getState().syncPreferences(); await started;
  await store.getState().updateSetting('coachStyle', 'data'); await store.getState().updateSetting('coachPushFrequency', 1);
  release(); await sending;
  assert.equal(cloud.requests.length, 2); assert.equal(cloud.requests[1].baseRevision, '1');
  assert.equal(cloud.snapshot().settings.coachStyle, 'data'); assert.equal(cloud.snapshot().settings.pushLimit, 1);
  assert.equal(await storage.db.settings.get(pendingKey), undefined);
});

test('a late GET in another tab cannot undo an ACKed preference; both tabs refresh', { timeout: 15_000 }, async () => {
  const cloud = server(); const old = cloud.snapshot(); let release: (response: Response) => void = () => {};
  let block = true;
  globalThis.fetch = (url, init) => { if (init?.method !== 'PATCH' && block) { block = false; return new Promise<Response>((resolve) => { release = resolve; }); } return cloud.handle(url, init); };
  const tabA = await freshStore(); await tabA.getState().loadSettings();
  const tabB = await freshStore(); await ready(tabB);
  await tabB.getState().updateSetting('coachStyle', 'strict'); await tabB.getState().syncPreferences();
  release(Response.json(old)); await tabA.getState().syncPreferences(); await wait();
  assert.equal((await storage.db.settings.get('coachStyle'))?.value, 'strict'); assert.equal(tabA.getState().coachStyle, 'strict'); assert.equal(tabB.getState().coachStyle, 'strict');
});

test('a second tab disabling reminders wins over stale in-memory controls at delivery time', { timeout: 15_000 }, async () => {
  const cloud = server(); cloud.remote({ coachPushEnabled: true, quietEnabled: false }); globalThis.fetch = cloud.handle;
  const { useSettingsStore: tabA, stopPreferenceSync } = await import('../src/stores/settingsStore');
  disposers.add(stopPreferenceSync);
  const control = await import('../src/services/pushControl');
  await ready(tabA);
  const tabB = await freshStore(); await ready(tabB);
  await tabB.getState().updateSetting('coachPushEnabled', false);
  tabA.setState({ coachPushEnabled: true }); // Deliberately emulate an observer delivery delay.
  let deliveries = 0;
  assert.equal(await control.deliverControlledPush('anomaly', 'stale-tab', async () => { deliveries += 1; }), false);
  assert.equal(deliveries, 0);
});

test('legacy local-only switches and pending drafts become a reviewable recoverable proposal', { timeout: 15_000 }, async () => {
  await storage.db.settings.bulkPut([{ key: 'coachPushEnabled', value: true }, { key: 'quietHours', value: { enabled: false, start: '23:00', end: '07:00' } }, { key: 'pendingSetting:quietHours', value: { id: 'old-id', body: { quietStart: '23:00', quietEnd: '07:00' } } }]);
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  const conflict = store.getState().preferenceSync.conflict!;
  assert.equal(conflict.local.coachPushEnabled, true); assert.equal(conflict.local.quietHours.enabled, false);
  assert.equal(store.getState().coachPushEnabled, false); assert.equal(cloud.requests.length, 0);
  assert.ok(await storage.db.settings.get('preferenceRecovery:legacy:quietHours'));
  await store.getState().resolvePreferenceConflict('local', conflict.id);
  assert.equal(cloud.snapshot().settings.coachPushEnabled, true); assert.equal(cloud.snapshot().settings.quietEnabled, false);
});

test('invalid server schema and missing ACK preserve pending edits and never report synced', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  globalThis.fetch = async (url, init) => init?.method === 'PATCH' ? Response.json({ ...cloud.snapshot(), acknowledged: true, mutationId: 'wrong-request' }) : cloud.handle(url, init);
  await store.getState().updateSetting('coachStyle', 'strict'); await store.getState().syncPreferences();
  assert.ok(await storage.db.settings.get(pendingKey)); assert.notEqual(store.getState().preferenceSync.state, 'synced');
  const raw = (await storage.db.settings.get(stateKey))?.value;
  assert.ok(raw.active); assert.equal(raw.active.changes.coachStyle, 'strict');
});

test('local quota failure rolls back preference and pending mutation together', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  const fail = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.settings.hook('updating', fail);
  try { await assert.rejects(store.getState().updateSetting('coachStyle', 'strict'), /quota/); }
  finally { storage.db.settings.hook('updating').unsubscribe(fail); }
  assert.equal((await storage.db.settings.get('coachStyle'))?.value, 'gentle'); assert.equal(await storage.db.settings.get(pendingKey), undefined);
  assert.equal(cloud.requests.length, 0);
});

test('a reopened store retries its persisted frozen request with the same ID and body', { timeout: 15_000 }, async () => {
  const cloud = server(); let failed = false;
  globalThis.fetch = async (url, init) => { if (init?.method === 'PATCH' && !failed) { failed = true; cloud.requests.push(JSON.parse(String(init.body)) as Request); return Response.json({ code: 'SETTINGS_RETRY_REQUIRED' }, { status: 503 }); } return cloud.handle(url, init); };
  const first = await freshStore(); await ready(first);
  await first.getState().updateSetting('eveningReviewTime', '20:15'); await first.getState().syncPreferences();
  assert.ok(await storage.db.settings.get(pendingKey));
  const reopened = await freshStore(); await ready(reopened);
  assert.deepEqual(cloud.requests[1], cloud.requests[0]); assert.equal(cloud.snapshot().settings.eveningReviewTime, '20:15');
  assert.equal(reopened.getState().preferenceSync.state, 'synced');
});

test('concurrent senders without Web Locks share one frozen request and one server effect', { timeout: 15_000 }, async () => {
  const cloud = server(); let count = 0; let both: () => void = () => {}; let release: () => void = () => {};
  const entered = new Promise<void>((resolve) => { both = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async (url, init) => { if (init?.method === 'PATCH') { count += 1; if (count === 2) both(); await gate; } return cloud.handle(url, init); };
  const tabA = await freshStore(); await ready(tabA);
  await tabA.getState().updateSetting('coachPushFrequency', 1); const sendingA = tabA.getState().syncPreferences();
  const tabB = await freshStore(); await tabB.getState().loadSettings(); const sendingB = tabB.getState().syncPreferences();
  await entered; release(); await Promise.all([sendingA, sendingB]);
  assert.equal(cloud.requests.length, 2); assert.deepEqual(cloud.requests[0], cloud.requests[1]);
  assert.equal(cloud.snapshot().revision, '1'); assert.equal(await storage.db.settings.get(pendingKey), undefined);
});

test('a disjoint rejected request cannot rebase a successor over a newly changed field', { timeout: 15_000 }, async () => {
  const cloud = server(); let release: () => void = () => {}; let entered: () => void = () => {}; let block = true;
  const started = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async (url, init) => { if (init?.method === 'PATCH' && block) { block = false; entered(); await gate; } return cloud.handle(url, init); };
  const store = await freshStore(); await ready(store);
  await store.getState().updateSetting('coachStyle', 'strict'); const sending = store.getState().syncPreferences(); await started;
  await store.getState().updateSetting('coachPushFrequency', 1); cloud.remote({ pushLimit: 3 }); release(); await sending;
  assert.equal(store.getState().preferenceSync.state, 'conflict'); assert.equal(cloud.requests.length, 1);
  assert.equal(cloud.snapshot().settings.pushLimit, 3); assert.equal(store.getState().preferenceSync.conflict?.local.coachPushFrequency, 1);
});

test('schema unavailable blocks mutation without deleting its draft or pretending success', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  globalThis.fetch = async (url, init) => init?.method === 'PATCH' ? Response.json({ error: 'schema unavailable', code: 'SETTINGS_SCHEMA_UNAVAILABLE' }, { status: 503 }) : cloud.handle(url, init);
  await store.getState().updateSetting('coachStyle', 'strict'); await store.getState().syncPreferences();
  assert.equal(store.getState().preferenceSync.state, 'blocked'); assert.ok(await storage.db.settings.get(pendingKey));
  assert.equal((await storage.db.settings.get(stateKey))?.value.active.status, 'blocked');
  globalThis.fetch = cloud.handle; await store.getState().syncPreferences();
  assert.equal(cloud.snapshot().settings.coachStyle, 'strict'); assert.equal(store.getState().preferenceSync.state, 'synced');
});

test('a pre-clear GET cannot recreate cleared preference state after the durable epoch changes', { timeout: 15_000 }, async () => {
  const cloud = server(); let release: (response: Response) => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  globalThis.fetch = async () => new Promise<Response>((resolve) => { release = resolve; entered(); });
  const store = await freshStore(); await store.getState().loadSettings();
  const pending = store.getState().syncPreferences(); await started;
  await storage.clearAllData({ allowPending: true });
  release(Response.json(cloud.snapshot())); await pending;
  assert.equal(await storage.db.settings.get(stateKey), undefined); assert.equal(await storage.db.settings.get(pendingKey), undefined);
});

test('clear between active extraction and request admission prevents any obsolete PATCH', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  await store.getState().updateSetting('coachPushFrequency', 1);
  const original = storage.db.settings.get.bind(storage.db.settings);
  let armed = true;
  storage.db.settings.get = (async (key: string) => {
    const row = await original(key);
    if (armed && key === stateKey && row?.value.active && new Error().stack?.includes('refreshView')) { armed = false; await storage.clearAllData({ allowPending: true }); }
    return row;
  }) as typeof storage.db.settings.get;
  try { await store.getState().syncPreferences(); }
  finally { storage.db.settings.get = original; }
  assert.equal(armed, false); assert.equal(cloud.requests.length, 0); assert.equal(await storage.db.settings.get(stateKey), undefined);
});

test('an edit arriving during the empty terminal pass cannot lose its retry wakeup', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  const original = storage.db.settings.get.bind(storage.db.settings);
  let entered: () => void = () => {}; let release: () => void = () => {}; let armed = true;
  const started = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
  storage.db.settings.get = (async (key: string) => {
    const row = await original(key);
    if (armed && key === stateKey && !row?.value.active && new Error().stack?.includes('refreshView')) { armed = false; entered(); await gate; }
    return row;
  }) as typeof storage.db.settings.get;
  try {
    const syncing = store.getState().syncPreferences(); await started;
    await store.getState().updateSetting('coachStyle', 'strict'); await wait(); release(); await syncing;
  } finally { storage.db.settings.get = original; }
  assert.equal(cloud.requests.length, 1); assert.equal(cloud.snapshot().settings.coachStyle, 'strict'); assert.equal(await storage.db.settings.get(pendingKey), undefined);
});

test('a stale failed GET cannot override another tab newer successful ACK with an error', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const tabA = await freshStore(); await ready(tabA);
  let entered: () => void = () => {}; let reject: (error: Error) => void = () => {}; let armed = true;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  globalThis.fetch = (url, init) => { if (armed && init?.method !== 'PATCH') { armed = false; entered(); return new Promise<Response>((_resolve, fail) => { reject = fail; }); } return cloud.handle(url, init); };
  const reading = tabA.getState().syncPreferences(); await started;
  const tabB = await freshStore(); await ready(tabB); await tabB.getState().updateSetting('coachStyle', 'strict'); await tabB.getState().syncPreferences();
  reject(new Error('old synthetic GET failed')); await reading; await wait();
  assert.equal(tabA.getState().preferenceSync.state, 'synced'); assert.equal(tabB.getState().preferenceSync.state, 'synced');
  assert.equal((await storage.db.settings.get(stateKey))?.value.readError, undefined);
});

test('an old receipt preserves a successor newer observed base on fields its parent did not change', { timeout: 15_000 }, async () => {
  const cloud = server(); let lose = true;
  globalThis.fetch = async (url, init) => { const response = await cloud.handle(url, init); if (init?.method === 'PATCH' && lose) { lose = false; throw new Error('synthetic lost ACK'); } return response; };
  const store = await freshStore(); await ready(store); await store.getState().updateSetting('coachStyle', 'strict'); await store.getState().syncPreferences();
  cloud.remote({ pushLimit: 3 });
  let entered: () => void = () => {}; let release: () => void = () => {}; let armed = true;
  const started = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async (url, init) => { const response = await cloud.handle(url, init); if (init?.method === 'PATCH' && armed) { armed = false; entered(); await gate; } return response; };
  const retry = store.getState().syncPreferences(); await started;
  assert.equal(store.getState().coachPushFrequency, 3);
  await store.getState().updateSetting('coachPushFrequency', 1); release(); await retry;
  assert.equal(cloud.requests.length, 3); assert.equal(cloud.requests.at(-1)?.baseRevision, '2'); assert.equal(cloud.snapshot().settings.pushLimit, 1);
  assert.equal(store.getState().preferenceSync.state, 'synced');
});

test('stopping during an accepted request preserves its frozen draft for safe receipt recovery', { timeout: 15_000 }, async () => {
  const cloud = server(); let entered: () => void = () => {}; let release: () => void = () => {}; let armed = true;
  const started = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async (url, init) => { const response = await cloud.handle(url, init); if (init?.method === 'PATCH' && armed) { armed = false; entered(); await gate; } return response; };
  const store = await freshStore(); await ready(store); await store.getState().updateSetting('coachPushFrequency', 1);
  const saving = store.getState().syncPreferences(); await started;
  const before = (await storage.db.settings.get(stateKey))?.value;
  Array.from(disposers).at(-1)!(); release(); await saving;
  const after = (await storage.db.settings.get(stateKey))?.value;
  assert.equal(after.localRevision, before.localRevision); assert.equal(after.active.id, before.active.id);
  const reopened = await freshStore(); await ready(reopened);
  assert.deepEqual(cloud.requests[1], cloud.requests[0]); assert.equal(cloud.snapshot().revision, '1'); assert.equal(reopened.getState().preferenceSync.state, 'synced');
});

test('missing durable account policy after clear fails closed despite stale enabled UI', { timeout: 15_000 }, async () => {
  const cloud = server(); cloud.remote({ coachPushEnabled: true, quietEnabled: false }); globalThis.fetch = cloud.handle;
  const { useSettingsStore: store, stopPreferenceSync } = await import('../src/stores/settingsStore'); disposers.add(stopPreferenceSync);
  const control = await import('../src/services/pushControl'); await ready(store);
  await storage.clearAllData({ allowPending: true }); store.setState({ coachPushEnabled: true, quietHours: { enabled: false, start: '23:00', end: '07:00' } });
  let deliveries = 0;
  assert.equal(await control.deliverControlledPush('anomaly', 'cleared-policy', async () => { deliveries += 1; }), false); assert.equal(deliveries, 0);
});

test('stop during the initial epoch read survives immediate DB close without waiting for timers', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  const original = storage.db.settings.get.bind(storage.db.settings);
  let entered: () => void = () => {}; let reject: (error: Error) => void = () => {}; let armed = true;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  storage.db.settings.get = (async (key: string) => {
    if (armed && key === storage.LOCAL_DATA_EPOCH_KEY) { armed = false; entered(); return new Promise((_resolve, fail) => { reject = fail; }); }
    return original(key);
  }) as typeof storage.db.settings.get;
  try {
    const syncing = store.getState().syncPreferences(); await started;
    Array.from(disposers).at(-1)!(); storage.db.close(); reject(new Error('synthetic DatabaseClosedError'));
    await syncing; // Must resolve as cancellation, without a cleanup delay or swallowed active error.
  } finally { storage.db.settings.get = original; await storage.db.open(); }
  assert.equal(cloud.requests.length, 0);
});

test('an active initial epoch read failure remains visibly blocked rather than falsely synced', { timeout: 15_000 }, async () => {
  const cloud = server(); globalThis.fetch = cloud.handle;
  const store = await freshStore(); await ready(store);
  const original = storage.db.settings.get.bind(storage.db.settings); let armed = true;
  storage.db.settings.get = (async (key: string) => {
    if (armed && key === storage.LOCAL_DATA_EPOCH_KEY) { armed = false; throw new Error('synthetic storage read failed'); }
    return original(key);
  }) as typeof storage.db.settings.get;
  try { await store.getState().syncPreferences(); }
  finally { storage.db.settings.get = original; }
  assert.equal(store.getState().preferenceSync.state, 'blocked'); assert.match(store.getState().preferenceSync.error ?? '', /storage read failed/);
});
