import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as diagnostics from '../src/services/initializationDiagnostics.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const safeEvent = { attempt: 1, sequence: 1, elapsedMs: 0, phase: 'initial', stage: 'habit', outcome: 'error' };
const secret = 'SYNTHETIC_PRIVATE_VALUE_NEVER_IN_TRACE';
const unsafeEvent = { ...safeEvent, ownerId: secret, revision: secret, epoch: secret, message: secret, stack: secret, url: `/todo?token=${secret}`, headers: { authorization: secret }, content: secret, phone: secret, unknown: secret, errorName: secret, errorCategory: secret, transactionMode: secret, authChecked: true, dbOpen: secret };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('privacy projection rejects free-form fields, malformed counters, and nonboolean flags', () => {
  assert.deepEqual(diagnostics.projectInitializationEvent(unsafeEvent), { ...safeEvent, authChecked: true });
  for (const key of ['attempt', 'sequence', 'elapsedMs']) for (const value of [-1, 1.2, Infinity, NaN, 1_000_000_001, secret]) {
    assert.equal(diagnostics.projectInitializationEvent({ ...safeEvent, [key]: value }), null);
  }
  for (const key of ['phase', 'stage', 'outcome']) assert.equal(diagnostics.projectInitializationEvent({ ...safeEvent, [key]: secret }), null);
  assert.equal(diagnostics.projectInitializationEvent({ get phase() { throw new Error(secret); } }), null);
  assert.deepEqual(diagnostics.initializationError({ name: secret, message: secret, stack: secret }), { errorName: 'unknown', errorCategory: 'unknown' });
  assert.deepEqual(diagnostics.initializationError(new Error('账号或本机资料已变化，未写入旧修改。输入仍保留，请重新核对')), { errorName: 'Error', errorCategory: 'authority-changed' });
  assert.deepEqual(diagnostics.initializationError(new Error('本机资料已变化（已清除），未恢复旧修改。输入仍保留，请重新核对')), { errorName: 'Error', errorCategory: 'local-data-changed' });
  for (const name of ['SubTransactionError', 'NotFoundError', 'DatabaseClosedError', 'TransactionInactiveError', 'PrematureCommitError']) {
    assert.deepEqual(diagnostics.initializationError({ name, message: secret }), { errorName: name, errorCategory: 'storage' });
  }
});

test('memory and emitted events are bounded, copied, and free of raw snapshot values', () => {
  const priorWindow = globalThis.window, emitted: diagnostics.InitializationEvent[] = [];
  Object.assign(globalThis, { window: { dispatchEvent: (event: CustomEvent<diagnostics.InitializationEvent>) => { emitted.push(event.detail); return true; } } });
  try {
    const trace = diagnostics.beginInitializationTrace('recovery', () => ({ ...unsafeEvent, ambientTransactionPresent: true, ambientTransactionActive: false, transactionMode: 'readonly' }));
    for (let i = 0; i < diagnostics.INITIALIZATION_TRACE_LIMIT + 20; i++) trace.record('habit', 'error', { name: 'SubTransactionError', message: secret });
    const snapshot = diagnostics.initializationSnapshot();
    assert.equal(snapshot.length, diagnostics.INITIALIZATION_TRACE_LIMIT);
    assert.ok(snapshot.every(row => row.phase === 'recovery' && row.stage === 'habit' && row.errorName === 'SubTransactionError'));
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    assert.equal(JSON.stringify(emitted).includes(secret), false);
    assert.equal(emitted.at(-1)?.transactionMode, 'readonly');
    assert.equal(Object.isFrozen(emitted.at(-1)), true);
    snapshot[0].stage = 'sync';
    assert.equal(diagnostics.initializationSnapshot()[0].stage, 'habit');
    assert.ok(snapshot.every((row, i) => !i || row.sequence > snapshot[i - 1].sequence));
  } finally { Object.assign(globalThis, { window: priorWindow }); }
});

test('observation preserves awaited Promise identity, call order, values, rejection reasons and synchronous throws', async () => {
  const trace = diagnostics.beginInitializationTrace('initial', () => { throw new Error(secret); });
  const order: string[] = [], value = { synthetic: true }, settled = Promise.resolve(value);
  void settled.then(() => { order.push('before'); });
  const observed = trace.run('settings', () => { order.push('call'); return settled; });
  assert.equal(observed, settled);
  void observed.then(() => { order.push('after'); });
  queueMicrotask(() => { order.push('checkpoint'); });
  assert.equal(await observed, value);
  assert.deepEqual(order, ['call', 'before', 'after', 'checkpoint']);
  const reason = new Error(secret), pending = deferred<void>();
  const rejected = trace.run('habit', () => pending.promise);
  assert.equal(rejected, pending.promise);
  pending.reject(reason);
  await assert.rejects(rejected, error => error === reason);
  assert.throws(() => trace.run('todo', () => { throw reason; }), error => error === reason);
  const priorWindow = globalThis.window;
  // This covers the dispatcher itself throwing synchronously. EventTarget
  // listener exceptions are reported by the host, not swallowed by this trace.
  Object.assign(globalThis, { window: { dispatchEvent() { throw new Error(secret); } } });
  try { assert.equal(await trace.run('goal', () => settled), value); }
  finally { Object.assign(globalThis, { window: priorWindow }); }
});

test('detached Coach failure is still unhandled with the original rejection reason', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { beginInitializationTrace } from './src/services/initializationDiagnostics.ts';
    const reason = new Error('synthetic detached failure');
    let observed = 0;
    process.on('unhandledRejection', error => { assert.equal(error, reason); observed++; });
    void beginInitializationTrace('initial').run('coach', () => Promise.reject(reason), true);
    setImmediate(() => { assert.equal(observed, 1); });
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

// Execute the actual hook with a minimal effect/timer driver. This is a unit
// observation test, not React mounting or a substitute for native Chromium QA.
const hookSource = await readFile(new URL('../src/hooks/useAppInit.ts', import.meta.url), 'utf8');
function hookDriver(offline = false) {
  const calls: string[] = [], state = [false, false], effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  const pendingEffects: Array<() => void> = [], timers = new Map<number, { delay: number; callback: () => void }>();
  const loaders = new Map<string, () => Promise<void>>(), events = new EventTarget();
  let stateIndex = 0, effectIndex = 0, timer = 0, generation = 1, revision = secret;
  const load = (name: string) => { calls.push(name); return loaders.get(name)?.() ?? Promise.resolve(); };
  const imports: Record<string, unknown> = {
    react: {
      useState: () => { const index = stateIndex++; return [state[index], (value: boolean) => { state[index] = value; }]; },
      useEffect: (callback: () => (() => void) | undefined, deps: unknown[]) => {
        const index = effectIndex++, previous = effects[index];
        if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
        pendingEffects.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; });
      },
    },
    dexie: { default: { currentTransaction: undefined } },
    '../services/initializationDiagnostics': diagnostics,
    '../services/diagnostics': { recordDiagnostic: () => undefined },
    '../services/syncEngine': { bootstrapSync: () => { calls.push('sync'); return Promise.resolve({ offline }); } },
    '../db': { db: { ownerId: secret, isOpen: () => true }, getDatabaseRecoveryError: () => null, isDatabaseUpgradeBlocked: () => false },
    '../services/apiClient': { getSessionGeneration: () => generation, getVerifiedSessionOwner: () => secret, SESSION_REVISION_KEY: 'revision', SIGNED_OUT_KEY: 'signed-out' },
    '../stores/authStore': { useAuthStore: { getState: () => ({ authChecked: true, isAuthenticated: true, identityUnavailable: false }) } },
    '../stores/settingsStore': { useSettingsStore: { getState: () => ({ loadSettings: () => load('settings') }) } },
  };
  for (const [module, name] of [['Expense', 'expense'], ['Todo', 'todo'], ['Habit', 'habit'], ['QuickNote', 'quick-note'], ['Schedule', 'schedule'], ['Diary', 'diary'], ['Coach', 'coach'], ['Goal', 'goal']]) {
    imports[`../stores/${module[0].toLowerCase()}${module.slice(1)}Store`] = { [`use${module}Store`]: { getState: () => ({ loadFromDB: () => load(name) }) } };
  }
  const exports = {} as { useAppInit: (enabled: boolean) => { ready: boolean; failed: boolean }; loadAllStores: (trace?: diagnostics.InitializationTrace) => Promise<void> };
  const compiled = ts.transpileModule(hookSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  runInNewContext(compiled, {
    exports, require: (key: string) => { assert.ok(key in imports, key); return imports[key]; }, window: events,
    localStorage: { getItem: (key: string) => key === 'revision' ? revision : null },
    setTimeout: (callback: () => void, delay: number) => { const id = ++timer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
  });
  return {
    calls, state, timers, loaders, events, exports,
    changeSession: () => { generation++; revision = 'synthetic-new-revision'; },
    render: (enabled: boolean) => { stateIndex = 0; effectIndex = 0; const value = exports.useAppInit(enabled); for (const effect of pendingEffects.splice(0)) effect(); return value; },
    cleanup: () => { for (const effect of effects) effect.cleanup?.(); },
  };
}

for (const offline of [false, true]) test(`actual hook keeps ${offline ? 'offline' : 'online'} store order and readiness`, async () => {
  const app = hookDriver(offline);
  app.render(true);
  assert.deepEqual(app.calls, ['settings']);
  assert.deepEqual([...app.timers.values()].map(timer => timer.delay), [12_000]);
  await tick();
  assert.deepEqual(app.calls, ['settings', 'sync', 'expense', 'todo', 'habit', 'quick-note', 'schedule', 'diary', ...(offline ? ['coach', 'goal'] : ['goal', 'coach'])]);
  assert.deepEqual(app.state, [true, false]);
  assert.equal(app.timers.size, 0);
  app.events.dispatchEvent(new Event('youtrace:data-updated')); await tick();
  assert.deepEqual(app.calls.slice(-8), ['expense', 'todo', 'habit', 'quick-note', 'schedule', 'diary', 'coach', 'goal']);
  assert.ok(diagnostics.initializationSnapshot().some(row => row.phase === 'data-updated' && row.stage === 'initialization' && row.outcome === 'success'));
  app.cleanup();
});

test('original timeout/recovery race remains visible without changing readiness or retry behavior', async () => {
  const app = hookDriver(), settings = deferred<void>(), recovery = deferred<void>();
  app.loaders.set('settings', () => settings.promise);
  let reads = 0;
  app.loaders.set('expense', () => ++reads === 1 ? recovery.promise : Promise.resolve());
  app.render(true);
  const deadline = [...app.timers.values()][0];
  assert.equal(deadline.delay, 12_000); deadline.callback();
  assert.deepEqual(app.state, [false, true]);
  app.render(true); await tick();
  assert.equal(reads, 1);
  settings.resolve(); await tick();
  assert.deepEqual(app.state, [true, true]);
  const reason = Object.assign(new Error(secret), { name: 'DatabaseClosedError' });
  recovery.reject(reason); await tick();
  assert.deepEqual(app.state, [false, true]);
  assert.equal(reads, 2);
  const rows = diagnostics.initializationSnapshot();
  assert.ok(rows.some(row => row.phase === 'initial' && row.outcome === 'timeout'));
  assert.ok(rows.some(row => row.phase === 'recovery' && row.stage === 'expense' && row.errorName === 'DatabaseClosedError'));
  assert.equal(JSON.stringify(rows).includes(secret), false);
  app.cleanup();
});

test('effect cancellation preserves unfinished work and suppresses its readiness update', async () => {
  const app = hookDriver(), settings = deferred<void>();
  app.loaders.set('settings', () => settings.promise);
  app.render(true); app.changeSession(); app.render(false);
  assert.equal(app.timers.size, 0);
  settings.resolve(); await tick();
  assert.deepEqual(app.state, [false, false]);
  assert.equal(app.calls.length, 10);
  const cancelled = diagnostics.initializationSnapshot().findLast(row => row.phase === 'initial' && row.outcome === 'cancel');
  assert.equal(cancelled?.generationChanged, true);
  assert.equal(cancelled?.revisionChanged, true);
  app.cleanup();
});

const captureSource = await readFile(new URL('../scripts/e2e-recovery.mjs', import.meta.url), 'utf8');
function captureDriver() {
  const section = captureSource.split('// BEGIN safe initialization capture')[1].split('// END safe initialization capture.')[0];
  // The marker's trailing comment belongs to the first line and is excluded.
  return runInNewContext(section.slice(section.indexOf('\n')) + '\n({ traceSchema, traceFlags, traceLimit, projectTrace, safeRoute, safeEndpoint, safeExceptionName, boundary, observeInitialization, firstFailureTrace })', { performance, URL });
}
class FakePage {
  handlers = new Map<string, (event: unknown) => void>();
  binding!: (value: unknown) => void;
  install!: (...args: unknown[]) => void;
  installArgs: unknown[] = [];
  on(name: string, callback: (event: unknown) => void) { this.handlers.set(name, callback); }
  url() { return `http://synthetic.invalid/todo?owner=${secret}`; }
  async exposeFunction(_name: string, callback: (value: unknown) => void) { this.binding = callback; }
  async evaluateOnNewDocument(callback: (...args: unknown[]) => void, ...args: unknown[]) { this.install = callback; this.installArgs = args; }
}

function alternatingField(key: string, allowed: unknown) {
  let reads = 0;
  return {
    value: Object.defineProperty({ ...safeEvent }, key, { enumerable: true, get: () => reads++ === 0 ? allowed : secret }),
    reads: () => reads,
  };
}

test('app, Node and browser projections read each counter, enum and flag exactly once before transmission', async () => {
  const capture = captureDriver(), page = new FakePage(), sent: Record<string, unknown>[] = [];
  await capture.observeInitialization(page);
  let listener!: (event: { detail: unknown }) => void;
  const window = {
    // Deliberately do not call the Node projection here: inspect the actual
    // browser-to-Node payload, before any second boundary could hide a leak.
    __youtraceInitializationDiagnostic: async (value: Record<string, unknown>) => { sent.push(value); },
    addEventListener: (_name: string, callback: typeof listener) => { listener = callback; },
  };
  Object.assign(window, { top: window });
  runInNewContext(`(${page.install.toString()})(...args)`, { args: page.installArgs, window, location: { pathname: '/todo' } });
  const fields = { ...safeEvent, errorName: 'SubTransactionError', errorCategory: 'storage', transactionMode: 'readonly', ...Object.fromEntries(diagnostics.INITIALIZATION_FLAGS.map(key => [key, true])) };
  for (const [key, allowed] of Object.entries(fields)) {
    const appValue = alternatingField(key, allowed), nodeValue = alternatingField(key, allowed), browserValue = alternatingField(key, allowed);
    const appResult = diagnostics.projectInitializationEvent(appValue.value);
    assert.equal(Reflect.get(appResult!, key), allowed, `app ${key}`);
    assert.equal(appValue.reads(), 1, `app ${key} reads`);
    assert.equal(capture.projectTrace(nodeValue.value)[key], allowed, `Node ${key}`);
    assert.equal(nodeValue.reads(), 1, `Node ${key} reads`);
    listener({ detail: browserValue.value });
    assert.equal(sent.at(-1)?.[key], allowed, `browser ${key}`);
    assert.equal(browserValue.reads(), 1, `browser ${key} reads`);
    const throwing = Object.defineProperty({ ...safeEvent }, key, { get() { throw new Error(secret); } });
    assert.equal(diagnostics.projectInitializationEvent(throwing), null, `app throwing ${key}`);
    assert.equal(capture.projectTrace(throwing), null, `Node throwing ${key}`);
    const before = sent.length;
    assert.doesNotThrow(() => listener({ detail: throwing }));
    assert.equal(sent.length, before, `browser throwing ${key} must not publish`);
  }
  assert.equal(JSON.stringify(sent).includes(secret), false);
});

test('exception classification and emitted app events tolerate changing and throwing name getters', () => {
  const capture = captureDriver(), emitted: unknown[] = [], priorWindow = globalThis.window;
  Object.assign(globalThis, { window: { dispatchEvent: (event: CustomEvent) => { emitted.push(event.detail); return true; } } });
  try {
    const classified = alternatingField('name', 'Error');
    assert.deepEqual(diagnostics.initializationError(classified.value), { errorName: 'Error', errorCategory: 'unknown' });
    assert.equal(classified.reads(), 1);
    const observed = alternatingField('name', 'SubTransactionError');
    diagnostics.beginInitializationTrace('initial').record('habit', 'error', observed.value);
    assert.equal(observed.reads(), 1);
    assert.equal(JSON.stringify(emitted).includes(secret), false);
    const failure = alternatingField('name', 'TimeoutError');
    assert.equal(capture.firstFailureTrace(failure.value).failureName, 'TimeoutError');
    assert.equal(failure.reads(), 1);
    const throwing = { get name() { throw new Error(secret); } };
    assert.deepEqual(diagnostics.initializationError(throwing), { errorName: 'unknown', errorCategory: 'unknown' });
    assert.equal(capture.firstFailureTrace(throwing).failureName, 'unknown');
    assert.equal(capture.safeExceptionName(throwing), 'unknown');
  } finally { Object.assign(globalThis, { window: priorWindow }); }
});

test('actual first-failure catch keeps screenshot, body, original failure and nonzero exit if diagnostic writing fails', async () => {
  const capture = captureDriver(), artifacts: string[] = [], report: unknown[] = [], process = { exitCode: 0 }, logs: unknown[] = [];
  const start = captureSource.indexOf('  // Freeze the first failure');
  const body = captureSource.slice(start, captureSource.indexOf('} finally {', start));
  const original = { message: 'Synthetic original failure', stack: 'Synthetic original stack', get name() { throw new Error(secret); } };
  const writeError = { get name() { throw new Error(secret); } };
  const page = {
    screenshot: async ({ path }: { path: string }) => { artifacts.push(path); },
    evaluate: async () => ({ path: '/todo', text: 'Synthetic original failure body', checkboxes: [] }),
  };
  const handleFailure = runInNewContext(`(async function(error) { ${body} })`, {
    browser: { pages: async () => [page] }, artifactDir: 'synthetic-artifacts', join: (...parts: string[]) => parts.join('/'),
    writeFile: async (path: string, value: string) => {
      if (path.endsWith('first-failure-initialization.json')) { assert.equal(JSON.parse(value).failureName, 'unknown'); throw writeError; }
      assert.equal(JSON.parse(value).text, 'Synthetic original failure body'); artifacts.push(path);
    },
    firstFailureTrace: capture.firstFailureTrace, safeExceptionName: capture.safeExceptionName,
    report, currentScenario: 'Synthetic failing scenario', console: { error: (...values: unknown[]) => { logs.push(values); } }, process,
  });
  await handleFailure(original);
  assert.deepEqual(artifacts, ['synthetic-artifacts/failure-0.png', 'synthetic-artifacts/failure-0.json']);
  assert.deepEqual(clone(report), [{ name: 'Synthetic failing scenario', passed: false, error: 'Synthetic original failure' }]);
  assert.equal(process.exitCode, 1);
  assert.equal(JSON.stringify(logs).includes(secret), false);
});

test('pre-navigation capture projects both browser and Node inputs and retains bounded cross-document chronology', async () => {
  const capture = captureDriver(), page = new FakePage();
  assert.deepEqual(clone(capture.traceSchema.phase), [...diagnostics.INITIALIZATION_PHASES]);
  assert.deepEqual(clone(capture.traceSchema.stage), [...diagnostics.INITIALIZATION_STAGES]);
  assert.deepEqual(clone(capture.traceSchema.outcome), [...diagnostics.INITIALIZATION_OUTCOMES]);
  assert.deepEqual(clone(capture.traceSchema.errorName), [...diagnostics.INITIALIZATION_ERROR_NAMES]);
  assert.deepEqual(clone(capture.traceSchema.errorCategory), [...diagnostics.INITIALIZATION_ERROR_CATEGORIES]);
  assert.deepEqual(clone(capture.traceFlags), [...diagnostics.INITIALIZATION_FLAGS]);
  assert.deepEqual(clone(capture.projectTrace(unsafeEvent)), clone(diagnostics.projectInitializationEvent(unsafeEvent)));
  assert.equal(capture.safeEndpoint(`https://synthetic.invalid/api/auth/me?token=${secret}`), 'auth-me');
  assert.equal(capture.safeEndpoint(`https://synthetic.invalid/api/user/${secret}`), 'api');
  assert.equal(capture.safeRoute(`https://synthetic.invalid/todo?token=${secret}`), '/todo');
  assert.equal(capture.safeRoute(`https://synthetic.invalid/${secret}`), 'unknown');
  await capture.observeInitialization(page);
  const sent: unknown[] = [], listeners = new Map<string, (event: { detail: unknown }) => void>();
  const window = {
    __youtraceInitializationDiagnostic: async (value: unknown) => { sent.push(clone(value)); page.binding(value); },
    addEventListener: (name: string, callback: (event: { detail: unknown }) => void) => { listeners.set(name, callback); },
  };
  Object.assign(window, { top: window });
  const document = (path: string) => runInNewContext(`(${page.install.toString()})(...args)`, { args: page.installArgs, window, location: { pathname: path } });
  document('/');
  listeners.get(diagnostics.INITIALIZATION_EVENT)!({ detail: unsafeEvent });
  capture.boundary(page, 'account-b-login-root-ready', '/');
  capture.boundary(page, 'route-start', '/todo');
  const request = { url: () => `https://synthetic.invalid/api/auth/me?token=${secret}`, method: () => 'GET' };
  page.handlers.get('request')!(request);
  document('/todo');
  page.binding({ ...safeEvent, sequence: 2, errorName: 'SubTransactionError', message: secret });
  page.handlers.get('pageerror')!({ name: secret, message: secret });
  page.handlers.get('response')!({ request: () => request, status: () => 401 });
  page.handlers.get('requestfailed')!(request);
  const first = capture.firstFailureTrace({ name: 'TimeoutError', message: secret });
  assert.equal(JSON.stringify(sent).includes(secret), false);
  assert.equal(JSON.stringify(first).includes(secret), false);
  assert.equal(first.chronology.find((row: { kind: string }) => row.kind === 'initialization').document, 1);
  assert.equal(first.chronology.find((row: { event?: { sequence: number } }) => row.event?.sequence === 2).document, 2);
  assert.ok(first.chronology.some((row: { status: number; endpoint: string; document: number; documentAtRequestStart: number }) => row.status === 401 && row.endpoint === 'auth-me' && row.document === 2 && row.documentAtRequestStart === 1));
  assert.deepEqual(clone(first.pageErrorNames), ['unknown']);
  const frozenLength = first.chronology.length;
  for (let index = 0; index < capture.traceLimit + 20; index++) page.binding(safeEvent);
  const last = capture.firstFailureTrace(new Error(secret));
  assert.equal(last.chronology.length, capture.traceLimit);
  assert.ok(last.dropped > 0);
  assert.equal(first.chronology.length, frozenLength);
  assert.ok(last.chronology.every((row: { sequence: number }, i: number) => !i || row.sequence > last.chronology[i - 1].sequence));
});
