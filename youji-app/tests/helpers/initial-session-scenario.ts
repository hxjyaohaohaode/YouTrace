import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import Dexie from 'dexie';
import ts from 'typescript';

const scenario = process.argv[2];
const startupScenario = scenario.startsWith('startup-required-');
const trustedStartup = scenario === 'startup-required-trusted-late-failure';
const goalRequired = scenario.startsWith('goal-required-');
const goalScenario = scenario.startsWith('goal-initial-') || goalRequired || startupScenario;
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() }; };
const events = Object.assign(new EventTarget(), { matchMedia: () => Object.assign(new EventTarget(), { matches: false }) });
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: events, document: { documentElement: { setAttribute: () => undefined } } });
const { installStartupReadFault } = await import('../../scripts/audit-startup-read-fault.mjs');
let startupFault: ReturnType<typeof installStartupReadFault> | undefined;
const storage = await import('../../src/db/index.ts');
const session = await import('../../src/services/apiClient.ts');
const auth = await import('../../src/stores/authStore.ts');
const settings = await import('../../src/stores/settingsStore.ts');
const sync = await import('../../src/services/syncEngine.ts');
const diagnostics = await import('../../src/services/diagnostics.ts');
const initialization = await import('../../src/services/initializationDiagnostics.ts');
const actor = await import('../../src/services/localActor.ts');
const goals = await import('../../src/stores/goalStore.ts');
const { sameGoalSource } = await import('../../src/services/goalSource.ts');
const owner = 'synthetic-initial-owner-a', newerOwner = 'synthetic-initial-owner-b';
const user = { id: owner, phone: '13900009902', nickname: 'Synthetic A', avatar: '', identity: 'other', city: '', coachStyle: 'gentle', quietStart: '23:00', quietEnd: '07:00', pushLimit: 2 };
const requests: string[] = [], loads: string[] = [];
const heldRecovery = deferred<void>();
let raceExpenseReads = 0, goalReadFailures = 0, goalFaultArmed = true, goalReadStarted = false, reloadRequests = 0;
const heldGoalFailure = deferred<void>();
const requiredEntered = deferred<void>(), releaseRequired = deferred<void>();
let requiredGoalCalls = 0;
const extraDatabases: Dexie[] = [];
Object.assign(events, { location: { reload() { reloadRequests++; } } });
const imports: Record<string, unknown> = {
  dexie: { default: Dexie }, '../db': storage, '../services/apiClient': session,
  '../services/diagnostics': diagnostics, '../services/initializationDiagnostics': initialization,
  '../services/syncEngine': sync, '../stores/settingsStore': settings, '../services/localActor': actor,
};
for (const name of ['Expense', 'Todo', 'Habit', 'QuickNote', 'Schedule', 'Diary', 'Coach', 'Goal']) {
  const file = `${name[0].toLowerCase()}${name.slice(1)}Store`;
  const module = await import(`../../src/stores/${file}.ts`);
  imports[`../stores/${file}`] = module;
  const store = module[`use${name}Store`], original = store.getState().loadFromDB;
  store.setState({ loadFromDB: async () => {
    loads.push(name);
    if (scenario.startsWith('initial-race-') && name === 'Expense' && ++raceExpenseReads === 1) await heldRecovery.promise;
    if (scenario === 'store-failure' && name === 'Habit') throw Object.assign(new Error('Synthetic retained storage failure'), { name: 'DatabaseClosedError' });
    if (goalScenario && name === 'Goal') goalReadStarted = true;
    if (trustedStartup && name === 'Expense' && ++raceExpenseReads === 2) await heldRecovery.promise;
    const firstPublished = (scenario === 'goal-required-published-success-new-failure' || trustedStartup) && name === 'Goal' && ++requiredGoalCalls === 1;
    try {
      await original();
      if (firstPublished) { requiredEntered.resolve(); await releaseRequired.promise; }
    } catch (error) {
      if (goalScenario && name === 'Goal') {
        goalReadFailures++;
        if (scenario === 'goal-initial-recovers') goalFaultArmed = false;
        if (goalReadFailures === 1 && ['goal-initial-new-owner', 'goal-initial-newer-read'].includes(scenario)) await heldGoalFailure.promise;
      }
      throw error;
    }
  } });
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await tick();
  assert.ok(predicate(), 'Synthetic async work did not reach the asserted state');
}
globalThis.fetch = async input => {
  const path = String(input); requests.push(path);
  if (path === '/api/auth/me') {
    if (['unauthorized', 'revoked-guest-bind-login', 'guest-bind-failure'].includes(scenario)) return Response.json({ error: 'Synthetic unauthorized' }, { status: 401 });
    if (scenario === 'offline-unverified') throw new TypeError('Synthetic offline identity');
    return Response.json({ user });
  }
  if (scenario === 'offline-verified' || goalScenario && path.startsWith('/api/sync/')) throw new TypeError('Synthetic offline after identity verification');
  if (path === '/api/user/settings') return Response.json({ protocol: 1, revision: '0', settings: { coachStyle: 'gentle', coachPushEnabled: false, pushLimit: 2, quietEnabled: true, quietStart: '23:00', quietEnd: '07:00', eveningReviewEnabled: false, eveningReviewTime: '21:00' } });
  if (path.startsWith('/api/sync/pull?')) return Response.json({ protocol: 2, features: ['goals-v1'], events: [], nextCursor: '0', hasMore: false });
  if (path.startsWith('/api/coach/insights')) return Response.json({ insights: [] });
  if (path === '/api/coach/pushes') return Response.json({ pushes: [] });
  throw new Error(`Unexpected synthetic endpoint: ${path}`);
};

// Execute the actual App, useAppInit, ReadyRoutes and RequireAuth functions.
// Only React scheduling/router navigation and presentation are replaced; the
// auth/API/sync/settings/DB/eight store implementations below are real imports.
// This is a deterministic module/hook test, not React DOM or browser evidence.
type Effect = { deps: unknown[]; cleanup?: () => void };
type Frame = { state: unknown[]; effects: Effect[] };
type Element = { type: unknown; props: Record<string, unknown> };
function driver() {
  const frames = new Map<string, Frame>(), pending: Array<() => void> = [];
  const timers = new Map<number, { delay: number; callback: () => void }>();
  let current!: Frame, stateIndex = 0, effectIndex = 0, timer = 0, rendering = false, renderAgain = false;
  const hooks = {
    ...React,
    useState: (initial: unknown) => {
      const frame = current, index = stateIndex++;
      if (!(index in frame.state)) frame.state[index] = typeof initial === 'function' ? initial() : initial;
      return [frame.state[index], (value: unknown) => {
        const next = typeof value === 'function' ? value(frame.state[index]) : value;
        if (Object.is(next, frame.state[index])) return;
        frame.state[index] = next;
        if (rendering) renderAgain = true;
      }];
    },
    useEffect: (callback: () => (() => void) | undefined, deps: unknown[]) => {
      const frame = current, index = effectIndex++, previous = frame.effects[index];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      pending.push(() => { previous?.cleanup?.(); frame.effects[index] = { deps, cleanup: callback() }; });
    },
  };
  const authHook = Object.assign((selector: (state: ReturnType<typeof auth.useAuthStore.getState>) => unknown) => selector(auth.useAuthStore.getState()), { getState: auth.useAuthStore.getState });
  const authShim = { ...auth, useAuthStore: authHook, useUnauthedRedirect: () => auth.useAuthStore.getState().isAuthenticated };
  function compile(source: string, modules: Record<string, unknown>) {
    const exports: Record<string, (...args: never[]) => unknown> = {};
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(code, {
      exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; },
      window: events, localStorage, sessionStorage, React,
      setTimeout: (callback: () => void, delay: number) => { const id = ++timer; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id: number) => timers.delete(id),
    });
    return exports;
  }
  const common = { react: hooks, 'react/jsx-runtime': jsx };
  const placeholder = () => null;
  const router = { BrowserRouter: placeholder, Routes: placeholder, Route: placeholder, Navigate: 'SyntheticNavigate', useLocation: () => ({ pathname: goalScenario ? '/goal' : '/todo', search: '?view=all' }), useNavigate: () => placeholder };
  async function setup() {
    const hook = compile(await readFile(new URL('../../src/hooks/useAppInit.ts', import.meta.url), 'utf8'), { ...common, ...imports, '../stores/authStore': authShim });
    let initializationState = { ready: false, failed: false };
    const observedHook = { useAppInit: (enabled: boolean) => { initializationState = Reflect.apply(hook.useAppInit, undefined, [enabled]) as typeof initializationState; return initializationState; } };
    const routes = compile(await readFile(new URL('../../src/routes/index.tsx', import.meta.url), 'utf8'), { ...common, 'react-router-dom': router, '../stores/authStore': authShim, '../components/layout/StaticPageEntry': { StaticPageEntry: placeholder }, '../components/layout/AppLayout': { AppLayout: placeholder } });
    const app = compile((await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8')) + '\nexports.ReadyRoutes = ReadyRoutes;', {
      ...common, 'react-router-dom': router, 'framer-motion': { MotionConfig: placeholder }, './routes': routes,
      './hooks/useAppInit': observedHook, './stores/authStore': authShim, './db': storage,
      './components/ui/SplashScreen': { default: placeholder }, './components/ui/Toast': { ToastHost: placeholder },
      './components/ui/ErrorBoundary': { ErrorBoundary: placeholder }, './components/layout/RuntimeObserver': { RuntimeObserver: placeholder },
    });
    function render<T>(name: string, operation: () => T): T {
      current = frames.get(name) ?? { state: [], effects: [] }; frames.set(name, current);
      let value!: T, renders = 0;
      do {
        assert.ok(++renders < 20, 'render-phase update must converge');
        stateIndex = 0; effectIndex = 0; pending.length = 0; renderAgain = false; rendering = true;
        value = operation(); rendering = false;
      } while (renderAgain);
      for (const effect of pending.splice(0)) effect(); return value;
    }
    return {
      timers,
      render: () => render('App', () => app.default()),
      state: () => { render('App', () => app.default()); return { ...initializationState }; },
      route: () => {
        render('App', () => app.default());
        const gate = render('ReadyRoutes', () => Reflect.apply(app.ReadyRoutes, undefined, [initializationState])) as Element;
        if (gate.type !== routes.AppRoutes) return { gate: 'loading-or-error', tree: gate };
        const routeTree = routes.AppRoutes() as Element;
        const entries = (routeTree.props.children as Element).props.children as Element[];
        const protectedRoute = entries.find(entry => !entry.props.path)!;
        const element = protectedRoute.props.element as Element;
        const result = render('RequireAuth', () => Reflect.apply(element.type as (...args: unknown[]) => unknown, undefined, [element.props])) as Element;
        return { gate: result.type === 'SyntheticNavigate' ? 'redirect' : 'protected', tree: result };
      },
      cleanup: () => { for (const frame of frames.values()) for (const effect of frame.effects) effect?.cleanup?.(); },
    };
  }
  return setup();
}

let app: Awaited<ReturnType<typeof driver>> | undefined;
try {
  if (scenario.startsWith('late-401-') || scenario === 'revocation-listener-login') {
    const response = deferred<Response>();
    globalThis.fetch = async () => response.promise;
    if (scenario === 'late-401-same-owner') session.setSessionActive(owner);
    const pending = auth.useAuthStore.getState().loadUser();
    const next = () => {
      if (scenario === 'late-401-revision') localStorage.setItem(session.SESSION_REVISION_KEY, 'synthetic-new-revision');
      else if (scenario === 'late-401-signed-out') localStorage.setItem(session.SIGNED_OUT_KEY, 'true');
      else if (scenario === 'late-401-clear') session.clearSession();
      else session.setSessionActive(scenario === 'late-401-same-owner' ? owner : newerOwner);
      auth.useAuthStore.setState({ user: { ...user, id: session.getVerifiedSessionOwner() ?? newerOwner }, isAuthenticated: true, authChecked: true });
    };
    if (scenario === 'revocation-listener-login') events.addEventListener(session.UNAUTHORIZED_EVENT, next, { once: true }); else next();
    const snapshot = auth.useAuthStore.getState();
    response.resolve(Response.json({ error: 'Synthetic expired request' }, { status: 401 }));
    await pending;
    assert.equal(auth.useAuthStore.getState().isAuthenticated, true);
    assert.equal(auth.useAuthStore.getState().authChecked, true);
    if (scenario !== 'revocation-listener-login') assert.equal(auth.useAuthStore.getState().user, snapshot.user);
    assert.equal(storage.db.isOpen(), false, 'obsolete rejection must not bind even the guest database');
  } else if (scenario === 'guest-bind-login' || scenario === 'revoked-guest-bind-login') {
    if (scenario === 'guest-bind-login') localStorage.setItem(session.SIGNED_OUT_KEY, 'true');
    const opened = deferred<void>(), release = deferred<void>(), original = storage.db.open;
    storage.db.open = function (...args: Parameters<typeof original>) {
      return original.apply(this, args).then(async value => { opened.resolve(); await release.promise; return value; });
    } as typeof original;
    const pending = auth.useAuthStore.getState().loadUser();
    // The old 401 bug returns before open; avoid turning the expected red into a hang.
    await Promise.race([opened.promise, pending]);
    assert.equal(storage.db.isOpen(), true, 'current signed-out result should bind guest storage');
    session.setSessionActive(newerOwner);
    auth.useAuthStore.setState({ user: { ...user, id: newerOwner }, isAuthenticated: true, authChecked: true });
    release.resolve(); await pending.catch(() => undefined); storage.db.open = original;
    assert.equal(auth.useAuthStore.getState().user?.id, newerOwner);
    assert.equal(auth.useAuthStore.getState().isAuthenticated, true);
    assert.equal(session.getVerifiedSessionOwner(), newerOwner);
  } else if (scenario === 'guest-bind-failure') {
    storage.db.open = (() => Promise.reject(Object.assign(new Error('Synthetic guest database unavailable'), { name: 'DatabaseClosedError' }))) as typeof storage.db.open;
    await auth.useAuthStore.getState().loadUser();
    assert.equal(auth.useAuthStore.getState().authChecked, false);
    assert.equal(auth.useAuthStore.getState().identityUnavailable, true);
    assert.equal(session.getVerifiedSessionOwner(), null);
    assert.match(storage.getDatabaseRecoveryError() ?? '', /Synthetic guest database unavailable/);
  } else {
    if (scenario === 'signed-out') localStorage.setItem(session.SIGNED_OUT_KEY, 'true');
    const heldSettings = deferred<void>();
    if (scenario === 'timeout') settings.useSettingsStore.setState({ loadSettings: () => heldSettings.promise });
    if (scenario.startsWith('initial-race-')) {
      const original = settings.useSettingsStore.getState().loadSettings;
      settings.useSettingsStore.setState({ loadSettings: async () => { await heldSettings.promise; await original(); } });
    }
    if (startupScenario && !trustedStartup) {
      Object.assign(globalThis, { location: { origin: 'http://127.0.0.1:4173' } });
      startupFault = installStartupReadFault({ databaseName: `youtrace:user:${owner}:schedule-v1`, branch: 'recovery-success' });
    }
    app = await driver(); app.render();
    await auth.useAuthStore.getState().loadUser();
    if (startupScenario) session.announceSessionChange();
    const offlineTodo = { id: 'synthetic-retained-todo', text: 'Synthetic saved offline work', priority: 'medium' as const, done: false };
    if (scenario === 'offline-verified') {
      await storage.db.todos.put(offlineTodo);
      await storage.db.outbox.add({ entity: 'todos', op: 'upsert', payload: offlineTodo, baseVersion: '0', queuedAt: 1, status: 'pending', attempts: 0 });
    }
    const exactGoal = { id: 'synthetic-initial-goal-exact-id', title: 'Synthetic original goal', description: 'Exact multiline\nretained description', level: 'medium' as const, domain: '学习', priority: 'high' as const, progress: 75, targetDate: '2027-03-14', createdAt: 17, updatedAt: 29, syncScope: 'local' as const, unknown: new Map([['keep', 'exact original']]) };
    const sourceGoal = { ...exactGoal, description: 'Exact old source, no automatic recovery' };
    let retainedOthers: unknown;
    const rawSnapshot = async (database: Dexie) => Object.fromEntries(await Promise.all(database.tables.map(async table => [table.name, { keys: await table.toCollection().primaryKeys(), values: await table.toCollection().toArray() }])));
    if (goalScenario) {
      await storage.db.goalRecords.put(exactGoal); await storage.db.table('goals').put(sourceGoal);
      const other = new storage.YoujiDatabase(newerOwner); await other.open(); await other.goalRecords.put({ ...exactGoal, id: 'synthetic-owner-b-goal' });
      const shared = new Dexie('youtrace'); shared.version(30).stores({ goals: 'id' }); await shared.open(); await shared.table('goals').put({ ...sourceGoal, id: 17 });
      extraDatabases.push(other, shared); retainedOthers = await Promise.all(extraDatabases.map(rawSnapshot));
    }
    if (scenario.startsWith('goal-initial-')) {
      const get = storage.db.settings.get;
      storage.db.settings.get = function (...args: Parameters<typeof get>) {
        const tables = Dexie.currentTransaction?.storeNames ?? [];
        // The actual initial actor read succeeds. Only epoch reads inside the
        // Goal snapshot and error-publication transactions reject. This reaches
        // the generic-memory-error fallback while preserving the rejected load.
        if (goalReadStarted && goalFaultArmed && args[0] === storage.LOCAL_DATA_EPOCH_KEY && (tables.includes('goalRecords') || tables.length === 1 && tables[0] === 'settings')) return Promise.reject(new DOMException('Synthetic Goal epoch transaction read failure', 'AbortError'));
        return get.apply(this, args);
      } as typeof get;
    }
    if (goalRequired) {
      const originalRead = storage.db.goalRecords.toArray;
      let reads = 0;
      storage.db.goalRecords.toArray = function () {
        const first = ++reads === 1;
        const fail = scenario === 'goal-required-double-failure'
          || (scenario === 'goal-required-old-failure-new-success' ? first : !first);
        return fail ? Promise.reject(new DOMException('Synthetic Goal-only snapshot failure', 'AbortError')) : originalRead.call(this);
      };
      if (scenario !== 'goal-required-published-success-new-failure') {
        const transaction = storage.db.transaction;
        let held = false;
        storage.db.transaction = function (...args: Parameters<typeof transaction>) {
          const result = transaction.apply(this, args);
          if (!held && args[0] === 'r' && Array.isArray(args[1]) && args[1].some(table => typeof table !== 'string' && table.name === 'goalRecords')) {
            held = true;
            // Delay delivery only after the real transaction has settled. A
            // successful but superseded snapshot has never been published.
            return result.then(value => Dexie.ignoreTransaction(async () => {
              requiredEntered.resolve(); await releaseRequired.promise; return value;
            }), error => Dexie.ignoreTransaction(async () => {
              requiredEntered.resolve(); await releaseRequired.promise; throw error;
            }));
          }
          return result;
        } as typeof transaction;
      }
    }
    if (scenario === 'initialization-closed-db') storage.db.close();
    const startupActor = startupScenario ? await actor.readLocalActor() : undefined;
    app.render();
    if (startupScenario) {
      const report = (stage: string) => console.log('ACTUAL_APP_STARTUP', JSON.stringify({ stage, state: app!.state(), gate: app!.route().gate, goal: { loaded: goals.useGoalStore.getState().loaded, readError: goals.useGoalStore.getState().readError, revision: goals.useGoalStore.getState().publishedRevision }, sameOwner: session.getVerifiedSessionOwner() === startupActor!.owner, sameGeneration: session.getSessionGeneration() === startupActor!.sessionGeneration }));
      if (trustedStartup) {
        await requiredEntered.promise;
        assert.deepEqual(goals.useGoalStore.getState().items, [exactGoal]);
        assert.equal(goals.useGoalStore.getState().loaded, true); assert.ok(goals.useGoalStore.getState().publishedRevision > 0);
        await actor.assertLocalActor(startupActor!);
        report('actual-Goal-publication-before-held-initial-delivery');
      } else await until(() => startupFault!.snapshot().holds.some((row: { target: string }) => row.target === 'initial'));
      const deadline = [...app.timers.values()][0]; assert.equal(deadline.delay, 12_000);
      // Real elapsed 12s, then the existing driver invokes the original hook
      // callback. This is a deterministic App module contract, not browser time.
      await new Promise(resolve => setTimeout(resolve, 12_000)); deadline.callback(); app.render();
      if (trustedStartup) {
        await until(() => raceExpenseReads === 2);
        releaseRequired.resolve(); await until(() => app!.state().ready);
        assert.deepEqual(app.state(), { ready: true, failed: true }); assert.equal(app.route().gate, 'protected');
        report('complete-initial-attempt-ready-with-trusted-Goal');
        heldRecovery.reject(new Error('Synthetic late Expense read delivery failure'));
      } else {
        await until(() => startupFault!.snapshot().holds.some((row: { target: string }) => row.target === 'recovery'));
        startupFault!.finish('initial', 'complete');
        await until(() => initialization.initializationSnapshot().some(row => row.phase === 'initial' && row.stage === 'initialization' && row.outcome === 'error'));
        assert.deepEqual(app.state(), { ready: false, failed: true }); assert.equal(app.route().gate, 'loading-or-error');
        assert.equal(goals.useGoalStore.getState().loaded, false); assert.equal(goals.useGoalStore.getState().publishedRevision, 0);
        report('initial-transaction-complete-without-publication-stays-locked');
        startupFault!.finish('recovery', scenario === 'startup-required-goal-held-complete' ? 'complete' : 'abort');
      }
      const recoverySuccess = scenario === 'startup-required-goal-held-complete';
      await until(() => initialization.initializationSnapshot().some(row => row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === (recoverySuccess ? 'success' : 'error')));
      await until(() => goals.useGoalStore.getState().loaded);
      assert.deepEqual(app.state(), { ready: recoverySuccess || trustedStartup, failed: true });
      assert.equal(app.route().gate, recoverySuccess || trustedStartup ? 'protected' : 'loading-or-error');
      assert.deepEqual(goals.useGoalStore.getState().items, [exactGoal]); assert.equal(goals.useGoalStore.getState().readError, null);
      await actor.assertLocalActor(startupActor!);
      assert.equal((await storage.db.settings.get(storage.LOCAL_DATA_EPOCH_KEY))?.value, startupActor!.epoch, 'Exact same clear epoch after all awaited reads');
      assert.deepEqual(await storage.db.goalRecords.toArray(), [exactGoal]); assert.deepEqual(await storage.db.table('goals').toArray(), [sourceGoal]);
      assert.equal(await storage.db.outbox.count(), 0);
      assert.ok(await sameGoalSource(await Promise.all(extraDatabases.map(rawSnapshot)), retainedOthers));
      if (startupFault) { assert.equal(startupFault.snapshot().violation, null); startupFault.release('explicit-module-test-release'); }
      report('final-complete-attempt-result-with-exact-Goal-and-epoch');
    } else if (goalRequired) {
      await requiredEntered.promise;
      await until(() => ['expense', 'todo', 'habit', 'quick-note', 'schedule', 'diary', 'coach'].every(stage => initialization.initializationSnapshot().some(row => row.phase === 'initial' && row.stage === stage && row.outcome === 'success')));
      const before = await rawSnapshot(storage.db);
      const writes: string[] = [];
      for (const table of storage.db.tables) {
        table.hook('creating', () => { writes.push(`${table.name}:create`); });
        table.hook('updating', () => { writes.push(`${table.name}:update`); });
        table.hook('deleting', () => { writes.push(`${table.name}:delete`); });
      }
      const hadPublished = scenario === 'goal-required-published-success-new-failure';
      assert.equal(goals.useGoalStore.getState().loaded, hadPublished);
      assert.equal(goals.useGoalStore.getState().publishedRevision > 0, hadPublished);
      window.dispatchEvent(new Event('youtrace:data-updated'));
      await until(() => initialization.initializationSnapshot().some(row => row.phase === 'data-updated' && row.stage === 'initialization' && ['success', 'error'].includes(row.outcome)));
      const usable = hadPublished || scenario === 'goal-required-old-failure-new-success';
      assert.equal(goals.useGoalStore.getState().loaded, usable);
      releaseRequired.resolve();
      await until(() => app!.state().ready || app!.state().failed);
      console.log('REQUIRED_GOAL_RESULT', JSON.stringify({ scenario, state: app.state(), gate: app.route().gate, loaded: goals.useGoalStore.getState().loaded, publishedRevision: goals.useGoalStore.getState().publishedRevision }));
      assert.equal(app.state().ready, usable, 'Required initialization needs a truly published current Goal snapshot');
      assert.equal(app.route().gate, usable ? 'protected' : 'loading-or-error');
      if (usable) {
        assert.deepEqual(goals.useGoalStore.getState().items, [exactGoal]);
        assert.equal(Boolean(goals.useGoalStore.getState().readError), hadPublished, 'A failed refresh stays a failed refresh even when trusted cached data allows entry');
      } else {
        await until(() => initialization.initializationSnapshot().some(row => row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === 'error'));
        assert.deepEqual(app.state(), { ready: false, failed: true });
        assert.deepEqual(goals.useGoalStore.getState().items, []);
        assert.ok(goals.useGoalStore.getState().readError);
      }
      if (scenario !== 'goal-required-old-failure-new-success') assert.ok(initialization.initializationSnapshot().some(row => row.phase === 'data-updated' && row.stage === 'goal' && row.outcome === 'error'), 'Real rejected refresh remains an error diagnostic even when a cache is available');
      assert.ok(await sameGoalSource(await rawSnapshot(storage.db), before), 'All current-owner physical keys/values, including settings/outbox/receipts, stay unchanged after bootstrap');
      assert.deepEqual(writes, [], 'Required-read window makes zero writes to any current-owner table');
      assert.ok(await sameGoalSource(await Promise.all(extraDatabases.map(rawSnapshot)), retainedOthers), 'Other owner and shared source remain exact');
    } else if (scenario.startsWith('goal-initial-')) {
      await until(() => goalReadFailures > 0);
      assert.equal(goals.useGoalStore.getState().loading, false, 'Failed Goal read must stop loading even when its error-publication epoch read fails');
      assert.ok(goals.useGoalStore.getState().readError);
      if (scenario === 'goal-initial-persistent') {
        await until(() => app!.state().failed && goalReadFailures >= 2);
        assert.deepEqual(app.state(), { ready: false, failed: true });
        const route = app.route(); assert.equal(route.gate, 'loading-or-error');
        const children = (route.tree.props.children as Element).props.children as Element;
        const errorChildren = children.props.children as Element[];
        assert.equal(errorChildren[0].props.children, '加载遇到问题');
        const retry = errorChildren.find(child => child.type === 'button')!;
        assert.equal(retry.props.children, '重试'); (retry.props.onClick as () => void)();
        assert.equal(reloadRequests, 1, 'The original global retry asks for a document reload; this driver does not emulate a real browser reload');
        assert.equal(goals.useGoalStore.getState().loaded, false);
      } else if (scenario === 'goal-initial-new-owner') {
        session.clearSession(); session.setSessionActive(newerOwner);
        auth.useAuthStore.setState({ user: { ...user, id: newerOwner }, isAuthenticated: true, authChecked: true });
        app.render(); heldGoalFailure.resolve();
        await until(() => app!.state().failed);
        assert.equal(app.route().gate, 'loading-or-error'); assert.equal(app.state().ready, false);
        assert.equal(session.getVerifiedSessionOwner(), newerOwner); assert.deepEqual(goals.useGoalStore.getState().items, []);
      } else {
        if (scenario === 'goal-initial-newer-read') {
          goalFaultArmed = false;
          const deadline = [...app.timers.values()][0]; assert.equal(deadline.delay, 12_000); deadline.callback();
        }
        await until(() => app!.state().ready);
        const revision = goals.useGoalStore.getState().publishedRevision;
        heldGoalFailure.resolve(); await tick(); await tick();
        assert.deepEqual(app.state(), { ready: true, failed: true }); assert.equal(app.route().gate, 'protected');
        assert.equal(goals.useGoalStore.getState().publishedRevision, revision);
        assert.deepEqual(goals.useGoalStore.getState().items, [exactGoal]); assert.equal(goals.useGoalStore.getState().readError, null);
      }
      assert.deepEqual(await storage.db.goalRecords.toArray(), [exactGoal]); assert.deepEqual(await storage.db.table('goals').toArray(), [sourceGoal]);
      assert.equal(await storage.db.outbox.count(), 0);
      assert.equal(await storage.db.settings.where('key').startsWith('goal-source-recovery:').count(), 0);
      assert.equal(await storage.db.settings.where('key').startsWith('shared-goal-recovery:v1:').count(), 0);
      assert.ok(await sameGoalSource(await Promise.all(extraDatabases.map(rawSnapshot)), retainedOthers));
      assert.ok(initialization.initializationSnapshot().some(row => row.stage === 'goal' && row.outcome === 'error'), 'Required Goal failure is still propagated to initialization diagnostics');
    } else if (scenario === 'signed-out' || scenario === 'unauthorized') {
      assert.equal(auth.useAuthStore.getState().authChecked, true);
      assert.equal(auth.useAuthStore.getState().isAuthenticated, false);
      assert.equal(auth.useAuthStore.getState().identityUnavailable, false);
      await tick();
      const route = app.route();
      assert.equal(route.gate, 'redirect');
      assert.equal(route.tree.props.to, '/login');
      assert.equal(route.tree.props.replace, true);
      assert.equal(sessionStorage.getItem('youtrace:return-to'), '/todo?view=all');
      assert.deepEqual(loads, [], 'signed-out routes must not initialize actor-guarded stores');
      assert.equal(app.timers.size, 0);
      assert.equal(session.getVerifiedSessionOwner(), null); assert.equal(storage.db.ownerId, null);
      assert.deepEqual(requests, scenario === 'signed-out' ? [] : ['/api/auth/me']);
      if (scenario === 'signed-out') assert.throws(() => actor.captureLocalActor(), /账号或本机资料已变化/);
    } else if (scenario === 'offline-unverified') {
      assert.equal(auth.useAuthStore.getState().authChecked, false);
      assert.equal(auth.useAuthStore.getState().identityUnavailable, true);
      assert.equal(app.route().gate, 'loading-or-error'); assert.deepEqual(loads, []);
      assert.equal(storage.db.ownerId, null); assert.equal(session.getVerifiedSessionOwner(), null);
    } else if (scenario === 'initialization-closed-db') {
      await until(() => app!.state().failed === true);
      await until(() => initialization.initializationSnapshot().some(row => row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === 'error'));
      assert.deepEqual(app.state(), { ready: false, failed: true });
      assert.equal(app.route().gate, 'loading-or-error');
      assert.equal(storage.db.isOpen(), false);
      assert.ok(initialization.initializationSnapshot().some(row => row.phase === 'initial' && row.errorName === 'DatabaseClosedError'));
      assert.ok(initialization.initializationSnapshot().some(row => row.phase === 'recovery' && row.errorName === 'DatabaseClosedError'));
    } else if (scenario.startsWith('initial-race-')) {
      const deadline = [...app.timers.values()][0]; assert.equal(deadline.delay, 12_000); deadline.callback();
      assert.deepEqual(app.state(), { ready: false, failed: true });
      await until(() => raceExpenseReads === 1);
      const failRecovery = () => heldRecovery.reject(Object.assign(new Error('Synthetic held recovery read failure'), { name: 'DatabaseClosedError' }));
      if (scenario === 'initial-race-success-first') {
        heldSettings.resolve(); await until(() => app!.state().ready === true);
        failRecovery();
      } else {
        failRecovery(); await until(() => initialization.initializationSnapshot().some(row => row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === 'error'));
        assert.deepEqual(app.state(), { ready: false, failed: true });
        heldSettings.resolve(); await until(() => app!.state().ready === true);
      }
      await until(() => initialization.initializationSnapshot().some(row => row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === 'error'));
      await tick();
      assert.deepEqual(app.state(), { ready: true, failed: true });
      assert.equal(app.route().gate, 'protected');
      // Real bootstrapSync emits data-updated in addition to initial/recovery.
      assert.equal(raceExpenseReads, 3);
      assert.deepEqual(initialization.initializationSnapshot().filter(row => row.stage === 'expense' && row.outcome === 'start').map(row => row.phase).sort(), ['data-updated', 'initial', 'recovery']);
      assert.equal(storage.db.ownerId, owner); assert.equal(session.getVerifiedSessionOwner(), owner);
    } else if (scenario === 'timeout') {
      const deadline = [...app.timers.values()][0]; assert.equal(deadline.delay, 12_000); deadline.callback();
      assert.deepEqual(app.state(), { ready: false, failed: true });
      assert.ok(initialization.initializationSnapshot().some(row => row.outcome === 'timeout'));
      heldSettings.resolve(); await until(() => app!.state().ready === true);
    } else {
      await until(() => scenario === 'store-failure' ? app!.state().failed === true : app!.state().ready === true);
      if (scenario === 'store-failure') {
        assert.equal(app.route().gate, 'loading-or-error');
        assert.ok(initialization.initializationSnapshot().some(row => row.stage === 'habit' && row.errorName === 'DatabaseClosedError'));
        assert.ok(diagnostics.diagnosticSnapshot().some(row => row.kind === 'runtime-error'));
      } else {
        assert.equal(app.route().gate, 'protected');
        assert.equal(storage.db.ownerId, owner); assert.equal(session.getVerifiedSessionOwner(), owner);
        assert.deepEqual([...new Set(loads)].sort(), ['Coach', 'Diary', 'Expense', 'Goal', 'Habit', 'QuickNote', 'Schedule', 'Todo']);
        assert.ok(initialization.initializationSnapshot().some(row => row.stage === 'sync-offline'));
        const { useTodoStore } = await import('../../src/stores/todoStore.ts');
        assert.deepEqual(useTodoStore.getState().items, [offlineTodo]);
        assert.deepEqual(await storage.db.todos.toArray(), [offlineTodo]);
        const queue = await storage.db.outbox.toArray();
        assert.equal(queue.length, 1); assert.deepEqual(queue[0].payload, offlineTodo);
        const previous = await actor.readLocalActor(); await storage.clearAllData({ allowPending: true });
        await assert.rejects(actor.assertLocalActor(previous), /已清除/);
      }
    }
  }
  console.log(JSON.stringify({ scenario, outcome: 'passed', authChecked: auth.useAuthStore.getState().authChecked, authenticated: auth.useAuthStore.getState().isAuthenticated, loads, requestCount: requests.length }));
} finally {
  startupFault?.dispose(); app?.cleanup(); settings.stopPreferenceSync(); sync.pauseSync(); session.clearSession(); storage.db.close(); for (const database of extraDatabases) database.close();
}
