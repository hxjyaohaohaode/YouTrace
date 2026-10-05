import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import Dexie from 'dexie';
import ts from 'typescript';

const scenario = process.argv[2];
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() }; };
const events = Object.assign(new EventTarget(), { matchMedia: () => Object.assign(new EventTarget(), { matches: false }) });
Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory(), window: events, document: { documentElement: { setAttribute: () => undefined } } });
const storage = await import('../../src/db/index.ts');
const session = await import('../../src/services/apiClient.ts');
const auth = await import('../../src/stores/authStore.ts');
const settings = await import('../../src/stores/settingsStore.ts');
const sync = await import('../../src/services/syncEngine.ts');
const diagnostics = await import('../../src/services/diagnostics.ts');
const initialization = await import('../../src/services/initializationDiagnostics.ts');
const actor = await import('../../src/services/localActor.ts');
const owner = 'synthetic-initial-owner-a', newerOwner = 'synthetic-initial-owner-b';
const user = { id: owner, phone: '13900009902', nickname: 'Synthetic A', avatar: '', identity: 'other', city: '', coachStyle: 'gentle', quietStart: '23:00', quietEnd: '07:00', pushLimit: 2 };
const requests: string[] = [], loads: string[] = [];
const imports: Record<string, unknown> = {
  dexie: { default: Dexie }, '../db': storage, '../services/apiClient': session,
  '../services/diagnostics': diagnostics, '../services/initializationDiagnostics': initialization,
  '../services/syncEngine': sync, '../stores/settingsStore': settings,
};
for (const name of ['Expense', 'Todo', 'Habit', 'QuickNote', 'Schedule', 'Diary', 'Coach', 'Goal']) {
  const file = `${name[0].toLowerCase()}${name.slice(1)}Store`;
  const module = await import(`../../src/stores/${file}.ts`);
  imports[`../stores/${file}`] = module;
  const store = module[`use${name}Store`], original = store.getState().loadFromDB;
  store.setState({ loadFromDB: async () => {
    loads.push(name);
    if (scenario === 'store-failure' && name === 'Habit') throw Object.assign(new Error('Synthetic retained storage failure'), { name: 'DatabaseClosedError' });
    await original();
  } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
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
  if (scenario === 'offline-verified') throw new TypeError('Synthetic offline after identity verification');
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
  let current!: Frame, stateIndex = 0, effectIndex = 0, timer = 0;
  const hooks = {
    ...React,
    useState: (initial: unknown) => {
      const frame = current, index = stateIndex++;
      if (!(index in frame.state)) frame.state[index] = typeof initial === 'function' ? initial() : initial;
      return [frame.state[index], (value: unknown) => { frame.state[index] = value; }];
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
  const router = { BrowserRouter: placeholder, Routes: placeholder, Route: placeholder, Navigate: 'SyntheticNavigate', useLocation: () => ({ pathname: '/todo', search: '?view=all' }), useNavigate: () => placeholder };
  async function setup() {
    const hook = compile(await readFile(new URL('../../src/hooks/useAppInit.ts', import.meta.url), 'utf8'), { ...common, ...imports, '../stores/authStore': authShim });
    const routes = compile(await readFile(new URL('../../src/routes/index.tsx', import.meta.url), 'utf8'), { ...common, 'react-router-dom': router, '../stores/authStore': authShim, '../components/layout/StaticPageEntry': { StaticPageEntry: placeholder }, '../components/layout/AppLayout': { AppLayout: placeholder } });
    const app = compile((await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8')) + '\nexports.ReadyRoutes = ReadyRoutes;', {
      ...common, 'react-router-dom': router, 'framer-motion': { MotionConfig: placeholder }, './routes': routes,
      './hooks/useAppInit': hook, './stores/authStore': authShim, './db': storage,
      './components/ui/SplashScreen': { default: placeholder }, './components/ui/Toast': { ToastHost: placeholder },
      './components/ui/ErrorBoundary': { ErrorBoundary: placeholder }, './components/layout/RuntimeObserver': { RuntimeObserver: placeholder },
    });
    function render<T>(name: string, operation: () => T): T {
      current = frames.get(name) ?? { state: [], effects: [] }; frames.set(name, current); stateIndex = 0; effectIndex = 0;
      const value = operation(); for (const effect of pending.splice(0)) effect(); return value;
    }
    return {
      timers,
      render: () => render('App', () => app.default()),
      state: () => ({ ready: frames.get('App')?.state[0], failed: frames.get('App')?.state[1] }),
      route: () => {
        const gate = render('ReadyRoutes', () => Reflect.apply(app.ReadyRoutes, undefined, [{ ready: frames.get('App')?.state[0], failed: frames.get('App')?.state[1] }])) as Element;
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
    app = await driver(); app.render();
    await auth.useAuthStore.getState().loadUser();
    const offlineTodo = { id: 'synthetic-retained-todo', text: 'Synthetic saved offline work', priority: 'medium' as const, done: false };
    if (scenario === 'offline-verified') {
      await storage.db.todos.put(offlineTodo);
      await storage.db.outbox.add({ entity: 'todos', op: 'upsert', payload: offlineTodo, baseVersion: '0', queuedAt: 1, status: 'pending', attempts: 0 });
    }
    app.render();
    if (scenario === 'signed-out' || scenario === 'unauthorized') {
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
  app?.cleanup(); settings.stopPreferenceSync(); sync.pauseSync(); session.clearSession(); storage.db.close();
}
