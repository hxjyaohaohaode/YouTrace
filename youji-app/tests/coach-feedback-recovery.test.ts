import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
};
Object.assign(globalThis, {
  localStorage: memoryStorage(), sessionStorage: memoryStorage(),
  window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }),
  document: { documentElement: { setAttribute() {} } },
});
const storage = await import('../src/db/index.ts');
const { useCoachStore } = await import('../src/stores/coachStore.ts');
const api = await import('../src/services/apiClient.ts');
const { pauseSync } = await import('../src/services/syncEngine.ts');
const newInsight = { type: 'suggestion' as const, title: 'synthetic insight', description: 'synthetic evidence', dataSources: ['expense'], dismissed: false, significance: 0.7, actionSuggested: 'review records' };
const newPush = { type: 'follow_up' as const, title: 'synthetic reminder', body: 'synthetic body', actions: [], read: false, acted: false };
const cloudInsight = { ...newInsight, id: 'cloud-insight', createdAt: '2026-10-04T06:00:00Z', actionTaken: false };
const cloudPush = { ...newPush, id: 'cloud-push', createdAt: '2026-10-04T06:00:00Z' };
const cloudFetch: typeof fetch = async (input) => Response.json(String(input).includes('/insights') ? { insights: [cloudInsight] } : { pushes: [cloudPush] });
before(async () => { await storage.bindAccountDatabase('synthetic-coach-feedback'); });
beforeEach(async () => {
  api.clearSession();
  pauseSync();
  await storage.db.coachInsights.clear();
  await storage.db.coachPushes.clear();
  await storage.db.settings.clear();
  useCoachStore.setState({ insights: [], pushes: [], loaded: false, dailyBrief: null });
  api.setSessionActive('synthetic-coach-feedback');
});
after(() => { pauseSync(); api.clearSession(); storage.db.close(); });

test('signed-in local insights and pushes survive reload and never PATCH invented cloud IDs', async () => {
  const insight = await useCoachStore.getState().addInsight(newInsight);
  const push = await useCoachStore.getState().addPush(newPush);
  assert.equal((await storage.db.coachInsights.get(insight.id))?.origin, 'local');
  assert.equal((await storage.db.coachPushes.get(push.id))?.origin, 'local');
  useCoachStore.setState({ insights: [], pushes: [] });
  globalThis.fetch = async (input, init) => {
    assert.ok(!init?.method || init.method === 'GET', 'local feedback must not contact server');
    return Response.json(String(input).includes('/insights') ? { insights: [] } : { pushes: [] });
  };
  await useCoachStore.getState().loadFromDB();
  assert.equal(useCoachStore.getState().insights[0]?.id, insight.id);
  assert.equal(useCoachStore.getState().pushes[0]?.id, push.id);
  await useCoachStore.getState().actOnInsight(insight.id);
  await useCoachStore.getState().dismissInsight(insight.id);
  await useCoachStore.getState().markPushRead(push.id);
  await useCoachStore.getState().markPushActed(push.id);
  assert.equal((await storage.db.coachInsights.get(insight.id))?.actionTaken, true);
  assert.equal((await storage.db.coachInsights.get(insight.id))?.dismissed, true);
  assert.equal((await storage.db.coachPushes.get(push.id))?.acted, true);
  await useCoachStore.getState().dismissPush(push.id);
  assert.equal(await storage.db.coachPushes.get(push.id), undefined);
});

test('local write failure never exposes an unpersisted insight or reminder', async () => {
  const fail = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  storage.db.coachInsights.hook('creating', fail);
  storage.db.coachPushes.hook('creating', fail);
  try {
    await assert.rejects(useCoachStore.getState().addInsight(newInsight), /quota/);
    await assert.rejects(useCoachStore.getState().addPush(newPush), /quota/);
  } finally {
    storage.db.coachInsights.hook('creating').unsubscribe(fail);
    storage.db.coachPushes.hook('creating').unsubscribe(fail);
  }
  assert.deepEqual(useCoachStore.getState().insights, []);
  assert.deepEqual(useCoachStore.getState().pushes, []);
});

test('cloud records are cached with origin and limited later pages cannot delete local history', async () => {
  const local = await useCoachStore.getState().addInsight(newInsight);
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  assert.equal((await storage.db.coachInsights.get(cloudInsight.id))?.origin, 'cloud');
  assert.equal((await storage.db.coachPushes.get(cloudPush.id))?.origin, 'cloud');
  globalThis.fetch = async (input) => Response.json(String(input).includes('/insights') ? { insights: [] } : { pushes: [] });
  await useCoachStore.getState().loadFromDB();
  assert.equal(useCoachStore.getState().insights.length, 2);
  assert.ok(useCoachStore.getState().insights.some((item) => item.id === local.id));
  globalThis.fetch = async () => { throw new TypeError('synthetic offline'); };
  useCoachStore.setState({ insights: [], pushes: [] });
  await useCoachStore.getState().loadFromDB();
  assert.equal(useCoachStore.getState().insights.length, 2);
  assert.equal(useCoachStore.getState().pushes[0]?.id, cloudPush.id);
});

test('rejected cloud feedback throws and leaves visible, persisted, and reminder-control state untouched', async () => {
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  await storage.setSetting('consecutiveIgnores', 3);
  globalThis.fetch = async () => Response.json({ error: 'synthetic rejection' }, { status: 503 });
  for (const action of [
    () => useCoachStore.getState().actOnInsight(cloudInsight.id),
    () => useCoachStore.getState().dismissInsight(cloudInsight.id),
    () => useCoachStore.getState().markPushRead(cloudPush.id),
    () => useCoachStore.getState().markPushActed(cloudPush.id),
    () => useCoachStore.getState().dismissPush(cloudPush.id),
  ]) await assert.rejects(action(), /synthetic rejection/);
  assert.equal(useCoachStore.getState().insights[0]?.actionTaken, false);
  assert.equal(useCoachStore.getState().insights[0]?.dismissed, false);
  assert.equal(useCoachStore.getState().pushes[0]?.read, false);
  assert.equal(useCoachStore.getState().pushes[0]?.acted, false);
  assert.equal((await storage.db.coachInsights.get(cloudInsight.id))?.actionTaken, false);
  assert.equal((await storage.db.coachPushes.get(cloudPush.id))?.acted, false);
  assert.equal(await storage.getSetting('consecutiveIgnores', 0), 3);
});

test('acknowledged cloud feedback persists and repeated act is idempotent', async () => {
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  const calls: string[] = [];
  globalThis.fetch = async (input) => { calls.push(String(input)); return Response.json({ success: true }); };
  await Promise.all([useCoachStore.getState().actOnInsight(cloudInsight.id), useCoachStore.getState().actOnInsight(cloudInsight.id)]);
  await useCoachStore.getState().actOnInsight(cloudInsight.id);
  assert.equal(calls.length, 1);
  assert.equal((await storage.db.coachInsights.get(cloudInsight.id))?.actionTaken, true);
  await useCoachStore.getState().markPushActed(cloudPush.id);
  assert.equal((await storage.db.coachPushes.get(cloudPush.id))?.acted, true);
  assert.equal(useCoachStore.getState().pushes[0]?.read, true);
});

test('stale cloud load cannot overwrite an acknowledged feedback change', async () => {
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  const pending: Array<() => void> = [];
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') return Response.json({ success: true });
    return new Promise<Response>((resolve) => { pending.push(() => resolve(Response.json(String(input).includes('/insights') ? { insights: [cloudInsight] } : { pushes: [cloudPush] }))); });
  };
  const loading = useCoachStore.getState().loadFromDB();
  await useCoachStore.getState().actOnInsight(cloudInsight.id);
  for (const complete of pending) complete();
  await loading;
  assert.equal(useCoachStore.getState().insights[0]?.actionTaken, true);
  assert.equal((await storage.db.coachInsights.get(cloudInsight.id))?.actionTaken, true);
});

test('concurrent local reminder creation is deduplicated durably', async () => {
  const [first, second] = await Promise.all([useCoachStore.getState().addPush(newPush), useCoachStore.getState().addPush(newPush)]);
  assert.equal(first.id, second.id);
  assert.equal(await storage.db.coachPushes.count(), 1);
  assert.equal(useCoachStore.getState().pushes.length, 1);
});

test('outer reminder transaction rollback cannot leave a visible ghost', async () => {
  await assert.rejects(storage.db.transaction('rw', storage.db.coachPushes, storage.db.settings, async () => {
    await useCoachStore.getState().addPush(newPush);
    throw new Error('synthetic counter failure');
  }), /counter failure/);
  assert.equal(await storage.db.coachPushes.count(), 0);
  assert.deepEqual(useCoachStore.getState().pushes, []);
});

test('legacy untagged local records remain local when signed in', async () => {
  await storage.db.coachInsights.put({ ...newInsight, id: 'legacy-local', createdAt: 1 });
  globalThis.fetch = async (input, init) => {
    assert.ok(!init?.method || init.method === 'GET');
    return Response.json(String(input).includes('/insights') ? { insights: [] } : { pushes: [] });
  };
  await useCoachStore.getState().loadFromDB();
  await useCoachStore.getState().actOnInsight('legacy-local');
  assert.equal((await storage.db.coachInsights.get('legacy-local'))?.actionTaken, true);
});

test('local feedback update failure rolls back state and feedback counters together', async () => {
  const insight = await useCoachStore.getState().addInsight(newInsight);
  const push = await useCoachStore.getState().addPush(newPush);
  await storage.setSetting('consecutiveIgnores', 3);
  const fail = () => { throw new DOMException('synthetic update quota', 'QuotaExceededError'); };
  storage.db.coachInsights.hook('updating', fail);
  storage.db.coachPushes.hook('updating', fail);
  try {
    await assert.rejects(useCoachStore.getState().actOnInsight(insight.id), /quota/);
    await assert.rejects(useCoachStore.getState().markPushActed(push.id), /quota/);
  } finally {
    storage.db.coachInsights.hook('updating').unsubscribe(fail);
    storage.db.coachPushes.hook('updating').unsubscribe(fail);
  }
  assert.equal(useCoachStore.getState().insights[0]?.actionTaken, undefined);
  assert.equal(useCoachStore.getState().pushes[0]?.acted, false);
  assert.equal((await storage.db.coachInsights.get(insight.id))?.actionTaken, undefined);
  assert.equal((await storage.db.coachPushes.get(push.id))?.acted, false);
  assert.equal(await storage.getSetting('consecutiveIgnores', 0), 3);
});

test('concurrent feedback on one record preserves both changes', async () => {
  const insight = await useCoachStore.getState().addInsight(newInsight);
  await Promise.all([
    useCoachStore.getState().actOnInsight(insight.id),
    useCoachStore.getState().dismissInsight(insight.id),
  ]);
  const persisted = await storage.db.coachInsights.get(insight.id);
  assert.equal(persisted?.actionTaken, true);
  assert.equal(persisted?.dismissed, true);
  assert.equal(useCoachStore.getState().insights[0]?.actionTaken, true);
  assert.equal(useCoachStore.getState().insights[0]?.dismissed, true);
});

test('late cloud page cannot resurrect a dismissed reminder or double-count dismissal', async () => {
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  const pending: Array<() => void> = [];
  let deleted = 0;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'DELETE') { deleted += 1; return Response.json({ success: true }); }
    return new Promise<Response>((resolve) => { pending.push(() => resolve(Response.json(String(input).includes('/insights') ? { insights: [cloudInsight] } : { pushes: [cloudPush] }))); });
  };
  const loading = useCoachStore.getState().loadFromDB();
  await Promise.all([useCoachStore.getState().dismissPush(cloudPush.id), useCoachStore.getState().dismissPush(cloudPush.id)]);
  for (const complete of pending) complete();
  await loading;
  assert.equal(deleted, 1);
  assert.equal(await storage.getSetting('consecutiveIgnores', 0), 1);
  assert.equal(await storage.db.coachPushes.get(cloudPush.id), undefined);
  assert.deepEqual(useCoachStore.getState().pushes, []);
});

test('an independent store with no shared revision cannot roll back another tab feedback', async () => {
  const moduleUrl = new URL('../src/stores/coachStore.ts?feedback-tab', import.meta.url).href;
  const { useCoachStore: otherStore } = await import(moduleUrl) as typeof import('../src/stores/coachStore.ts');
  assert.notEqual(otherStore, useCoachStore);
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  await otherStore.getState().loadFromDB();
  const pending: Array<() => void> = [];
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST' || init?.method === 'DELETE') return Response.json({ success: true });
    return new Promise<Response>((resolve) => { pending.push(() => resolve(Response.json(String(input).includes('/insights') ? { insights: [cloudInsight] } : { pushes: [cloudPush] }))); });
  };
  const loading = otherStore.getState().loadFromDB();
  await useCoachStore.getState().actOnInsight(cloudInsight.id);
  await useCoachStore.getState().dismissInsight(cloudInsight.id);
  await useCoachStore.getState().dismissPush(cloudPush.id);
  for (const complete of pending) complete();
  await loading;
  assert.equal(otherStore.getState().insights[0]?.actionTaken, true);
  assert.equal(otherStore.getState().insights[0]?.dismissed, true);
  assert.deepEqual(otherStore.getState().pushes, []);
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  assert.deepEqual(useCoachStore.getState().pushes, [], 'persisted tombstone also protects later reloads');
});

test('lost cloud DELETE response recovers on a 404 retry without false success or double counters', async () => {
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  globalThis.fetch = async () => { throw new TypeError('synthetic lost response after DELETE'); };
  await assert.rejects(useCoachStore.getState().dismissPush(cloudPush.id), /lost response/);
  assert.ok(await storage.db.coachPushes.get(cloudPush.id));
  assert.equal(await storage.getSetting('consecutiveIgnores', 0), 0);
  globalThis.fetch = async () => Response.json({ error: 'already absent' }, { status: 404 });
  await useCoachStore.getState().dismissPush(cloudPush.id);
  assert.equal(await storage.db.coachPushes.get(cloudPush.id), undefined);
  assert.equal(await storage.getSetting('consecutiveIgnores', 0), 1);
  assert.deepEqual(useCoachStore.getState().pushes, []);
});

test('cloud DELETE acknowledgment followed by local quota failure remains retryable', async () => {
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  globalThis.fetch = async () => Response.json({ success: true });
  const fail = () => { throw new DOMException('synthetic delete quota', 'QuotaExceededError'); };
  storage.db.coachPushes.hook('deleting', fail);
  try { await assert.rejects(useCoachStore.getState().dismissPush(cloudPush.id), /quota/); }
  finally { storage.db.coachPushes.hook('deleting').unsubscribe(fail); }
  assert.ok(await storage.db.coachPushes.get(cloudPush.id));
  globalThis.fetch = async () => Response.json({ error: 'already absent' }, { status: 404 });
  await useCoachStore.getState().dismissPush(cloudPush.id);
  assert.equal(await storage.db.coachPushes.get(cloudPush.id), undefined);
});

test('cloud load completing after local clear cannot repopulate cleared coaching caches', async () => {
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  const pending: Array<() => void> = [];
  let started: () => void = () => undefined;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = async (input) => new Promise<Response>((resolve) => {
    pending.push(() => resolve(Response.json(String(input).includes('/insights') ? { insights: [cloudInsight] } : { pushes: [cloudPush] })));
    if (pending.length === 2) started();
  });
  const loading = useCoachStore.getState().loadFromDB();
  await requested;
  await storage.clearAllData();
  useCoachStore.setState({ insights: [], pushes: [] });
  for (const complete of pending) complete();
  await loading;
  assert.equal(await storage.db.coachInsights.count(), 0);
  assert.equal(await storage.db.coachPushes.count(), 0);
  assert.deepEqual(useCoachStore.getState().insights, []);
  assert.deepEqual(useCoachStore.getState().pushes, []);
});

test('feedback acknowledgment after local clear cannot reconstruct cleared records', async () => {
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  let started: () => void = () => undefined;
  let complete: (response: Response) => void = () => assert.fail('request not started');
  const requested = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = async () => new Promise<Response>((resolve) => { complete = resolve; started(); });
  const acting = useCoachStore.getState().actOnInsight(cloudInsight.id);
  await requested;
  await storage.clearAllData();
  useCoachStore.setState({ insights: [], pushes: [] });
  complete(Response.json({ success: true }));
  await assert.rejects(acting, /本机数据已清理/);
  assert.equal(await storage.db.coachInsights.count(), 0);
  assert.deepEqual(useCoachStore.getState().insights, []);
});

test('rule snapshot completing after local clear cannot refill the local cache or brief', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T06:30:00Z') });
  let started: () => void = () => undefined;
  let complete: (response: Response) => void = () => assert.fail('request not started');
  const requested = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = async (input) => {
    assert.ok(String(input).endsWith('generate-brief'), 'cancelled snapshot must not start a later brief load');
    return new Promise<Response>((resolve) => { complete = resolve; started(); });
  };
  const generating = useCoachStore.getState().generateDailyBrief();
  await requested;
  await storage.clearAllData();
  complete(Response.json({ insight: cloudInsight }));
  assert.equal(await generating, null);
  assert.equal(await storage.db.coachInsights.count(), 0);
  assert.deepEqual(useCoachStore.getState().insights, []);
  assert.equal(useCoachStore.getState().dailyBrief, null);
});

test('delayed generation response preserves another tab acknowledged adoption and dismissal', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T06:30:00Z') });
  const moduleUrl = new URL('../src/stores/coachStore.ts?generation-feedback-tab', import.meta.url).href;
  const { useCoachStore: otherStore } = await import(moduleUrl) as typeof import('../src/stores/coachStore.ts');
  let started: () => void = () => undefined;
  let complete: (response: Response) => void = () => assert.fail('request not started');
  const requested = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/generate-brief')) return new Promise<Response>((resolve) => { complete = resolve; started(); });
    if (init?.method === 'POST') return Response.json({ success: true });
    if (String(input).endsWith('/brief')) return Response.json({ brief: { greeting: '', date: '', weeklyInsights: [], todayActions: [], todaySchedule: [], yesterdayReview: { spent: 0, spentDiff: null, habits: { done: 0, total: 0 }, moodScore: null } } });
    return cloudFetch(input, init);
  };
  const generating = useCoachStore.getState().generateDailyBrief();
  await requested;
  await otherStore.getState().loadFromDB();
  await otherStore.getState().actOnInsight(cloudInsight.id, 'synthetic acknowledged feedback');
  await otherStore.getState().dismissInsight(cloudInsight.id);
  complete(Response.json({ insight: cloudInsight }));
  await generating;
  const persisted = await storage.db.coachInsights.get(cloudInsight.id);
  assert.equal(persisted?.actionTaken, true);
  assert.equal(persisted?.dismissed, true);
  assert.equal(persisted?.actionResult, 'synthetic acknowledged feedback');
  assert.equal(useCoachStore.getState().insights[0]?.actionTaken, true);
  assert.equal(useCoachStore.getState().insights[0]?.dismissed, true);
});

for (const action of ['markPushRead', 'markPushActed'] as const) {
  test(`late ${action} acknowledgment cannot resurrect a reminder closed in another tab`, async () => {
    const moduleUrl = new URL(`../src/stores/coachStore.ts?dismiss-race-${action}`, import.meta.url).href;
    const { useCoachStore: otherStore } = await import(moduleUrl) as typeof import('../src/stores/coachStore.ts');
    globalThis.fetch = cloudFetch;
    await useCoachStore.getState().loadFromDB();
    await otherStore.getState().loadFromDB();
    let started: () => void = () => undefined;
    let complete: (response: Response) => void = () => assert.fail('request not started');
    const requested = new Promise<void>((resolve) => { started = resolve; });
    globalThis.fetch = async (_input, init) => {
      if (init?.method === 'PATCH') return new Promise<Response>((resolve) => { complete = resolve; started(); });
      return Response.json({ success: true });
    };
    const marking = useCoachStore.getState()[action](cloudPush.id);
    await requested;
    await otherStore.getState().dismissPush(cloudPush.id);
    complete(Response.json({ success: true }));
    await marking;
    assert.equal(await storage.db.coachPushes.get(cloudPush.id), undefined);
    assert.deepEqual(useCoachStore.getState().pushes, []);
    assert.equal(await storage.getSetting('consecutiveIgnores', 0), 1);
  });
}

test('a persisted dismissal also clears a stale tab card without another request or ignore count', async () => {
  const moduleUrl = new URL('../src/stores/coachStore.ts?dismissed-visible-tab', import.meta.url).href;
  const { useCoachStore: otherStore } = await import(moduleUrl) as typeof import('../src/stores/coachStore.ts');
  globalThis.fetch = cloudFetch;
  await useCoachStore.getState().loadFromDB();
  await otherStore.getState().loadFromDB();
  globalThis.fetch = async () => Response.json({ success: true });
  await otherStore.getState().dismissPush(cloudPush.id);
  assert.equal(useCoachStore.getState().pushes.length, 1);
  globalThis.fetch = async () => { assert.fail('already dismissed reminder must not send another request'); };
  await useCoachStore.getState().dismissPush(cloudPush.id);
  assert.deepEqual(useCoachStore.getState().pushes, []);
  assert.equal(await storage.getSetting('consecutiveIgnores', 0), 1);
});
