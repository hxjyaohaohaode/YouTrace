import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { readExistingAccount } from '../scripts/audit-initial-session-outcomes.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createNavigationFailureLatch, measureNavigation, diagnosticEndpoint, assertNavigationData, navigationCases, projectNavigationEvent, createNavigationLedger, installNavigationObserver, classifyNavigationFailure, runNavigationDiagnostic } from '../scripts/diagnose-startup-navigation.mjs';
const event = (origin: number, transaction: number, outcome: string, request = 0) => ({ kind: 'storage-progress', timeOrigin: origin, event: { timeOrigin: origin, database: 2, transaction, request, outcome, mode: 'readonly', stores: ['todos'], elapsedMs: 1, documentElapsedMs: 10, ...(request ? { method: 'getAll', store: 'todos' } : {}) } });
test('four frozen once-only arms differ only by native navigation and storage observation', () => {
  assert.equal(navigationCases.length, 4); assert.equal(new Set(navigationCases.map(v => `${v.navigation}:${v.storageObserver}`)).size, 4);
  for (const arm of navigationCases) { assert.equal(arm.width, 1280); assert.equal(arm.height, 900); assert.equal(arm.reducedMotion, 'reduce'); assert.equal(arm.attempts, 1); assert.ok(Object.isFrozen(arm)); }
});
test('transaction ledger scopes equal numeric IDs by original timeOrigin and retains first unfinished proof when event ring rolls', () => {
  const ledger = createNavigationLedger(3);
  ledger.record(event(100, 7, 'transaction-start')); ledger.record(event(100, 7, 'request-start', 1)); ledger.record(event(200, 7, 'transaction-start')); ledger.record(event(200, 7, 'request-start', 1)); ledger.record(event(200, 7, 'transaction-complete'));
  const state = ledger.snapshot(); assert.equal(state.dropped, 2); assert.equal(state.transactions.length, 2);
  assert.equal(state.transactions[0].timeOrigin, 100); assert.equal(state.transactions[0].terminal, null); assert.equal(state.transactions[0].startObserved, true);
  assert.equal(state.transactions[1].timeOrigin, 200); assert.equal(state.transactions[1].terminal.outcome, 'transaction-complete');
  state.transactions[0].stores.push('private'); assert.deepEqual(ledger.snapshot().transactions[0].stores, ['todos']);
  ledger.record(event(300, 8, 'transaction-start')); ledger.record(event(400, 9, 'transaction-start')); assert.equal(ledger.snapshot().transactionDropped, 1);
});
test('strict observer projection rejects mixed document identity/private arbitrary fields and nonterminal error never claims released lock', () => {
  const original = { ...event(100, 1, 'transaction-start'), token: 'private' }; Object.assign(original.event, { value: 'private' });
  assert.ok(!JSON.stringify(projectNavigationEvent(original)).includes('private')); assert.equal(projectNavigationEvent({ ...original, timeOrigin: 101 }), null);
  assert.equal(projectNavigationEvent({ kind: 'application', timeOrigin: 100, event: { attempt: 1, sequence: 1, elapsedMs: 1, phase: 'initial', stage: 'arbitrary', outcome: 'success' } }), null);
  const ledger = createNavigationLedger(); ledger.record(original); ledger.record(event(100, 1, 'transaction-error')); assert.equal(ledger.snapshot().transactions[0].terminal, null);
  ledger.record(event(100, 1, 'transaction-abort')); assert.equal(ledger.snapshot().transactions[0].terminal.outcome, 'transaction-abort');
});
test('disabled storage arm does not install IDB wrapper; low-volume observer remains identical across independent pages', async () => {
  for (const enabled of [false, true]) {
    const calls: string[] = []; const page = { exposeFunction: async (name: string) => calls.push(name), evaluateOnNewDocument: async (fn: (...args: unknown[]) => unknown) => calls.push(fn.name || 'application-lifecycle') };
    await installNavigationObserver(page, createNavigationLedger(), enabled); assert.deepEqual(calls, ['__youtraceInitializationDiagnostic', 'application-lifecycle', ...(enabled ? ['installStorageProgress'] : [])]);
  }
});
test('bounded diagnostic labels visible product failure separately from setup/inconclusive block; a no-reproduction result is not pass', () => {
  assert.equal(classifyNavigationFailure('existing-a-navigation', { text: '加载遇到问题\n重试' }, 'TimeoutError'), 'observed-failure');
  assert.equal(classifyNavigationFailure('preparation', { text: '加载遇到问题\n重试' }, 'TimeoutError'), 'infra-blocked'); assert.equal(classifyNavigationFailure('existing-a-navigation', null, 'ProtocolError'), 'infra-blocked');
  assert.equal(classifyNavigationFailure('post-observation-data-read', {}, 'AssertionError'), 'observed-failure');
});
test('import is inert and local execution rejects before services or browser; original twelve-second product deadline is untouched', async () => {
  if (process.env.GITHUB_ACTIONS !== 'true') await assert.rejects(runNavigationDiagnostic(), /Hosted CI only/);
  const source = await readFile(new URL('../scripts/diagnose-startup-navigation.mjs', import.meta.url), 'utf8');
  assert.match(source, /applicationInitializationDeadlineMs: 12000/); assert.match(source, /status: 'not-reproduced'/); assert.doesNotMatch(source, /observed-pass|indexedDB\.deleteDatabase|localStorage\.setItem|\.abort\(|keepAlive|\.reload\(/);
  const measured = source.split("await measureNavigation(measurement, async assertActive => {")[1].split("phase = 'post-observation-data-read'")[0]; assert.doesNotMatch(measured, /setTimeout|snapshot\(|waitForNetworkIdle/); assert.match(measured, /await route\('\/todo'\)/); assert.match(measured, /await click\('aside nav button', '待办'\)/);
  assert.ok(source.indexOf("'first-failure.json'") < source.indexOf("capture('first-failure-visible')"));
});
test('actual injected lifecycle listener preserves source origin on late delivery and never awaits its transport', async () => {
  const installed: { source: string, args: unknown[] }[] = [];
  const page = { exposeFunction: async () => undefined, evaluateOnNewDocument: async (fn: (...args: never[]) => unknown, ...args: unknown[]) => { installed.push({ source: fn.toString(), args }); } };
  await installNavigationObserver(page, createNavigationLedger(), false);
  const sent: unknown[] = [], listeners = new Map<string, (event: unknown) => unknown>();
  const pending = new Promise(() => undefined);
  const window = { __youtraceInitializationDiagnostic: (value: unknown) => { sent.push(value); return pending; }, addEventListener: (name: string, fn: (event: unknown) => unknown) => listeners.set(name, fn) };
  const document = { visibilityState: 'visible', wasDiscarded: false, addEventListener: window.addEventListener };
  vm.runInNewContext(`(${installed[0].source})(...args)`, { window, document, location: { pathname: '/todo' }, performance: { timeOrigin: 100, now: () => 10 }, args: installed[0].args });
  assert.equal(listeners.get('pagehide')?.({ isTrusted: true, persisted: true }), undefined);
  listeners.get('youtrace:initialization-diagnostic')?.({ detail: { attempt: 1, sequence: 2, elapsedMs: 3, phase: 'initial', stage: 'sync', outcome: 'start', token: 'PRIVATE', value: 'PRIVATE' } });
  assert.equal(sent.length, 3); assert.ok(!JSON.stringify(sent).includes('PRIVATE'));
  const ledger = createNavigationLedger(); ledger.record({ kind: 'lifecycle', timeOrigin: 200, event: 'document-start', elapsedMs: 0 }); for (const e of sent) ledger.record(e);
  const events = ledger.snapshot().events; assert.deepEqual(events.map(e => e.timeOrigin), [200, 100, 100, 100]);
  assert.equal(events[2].event, 'pagehide'); assert.equal(events[2].persisted, true); assert.equal(events[3].event.stage, 'sync');
  assert.equal(diagnosticEndpoint('https://fixture.invalid/api/auth/me?token=PRIVATE'), 'auth-me'); assert.equal(diagnosticEndpoint('https://fixture.invalid/api/private-owner'), 'other-api'); assert.equal(diagnosticEndpoint('not-url'), null);
});
test('exact account oracle uses real synthetic readonly IDB snapshots and rejects schema, additional Todo, undefined loss, queue and ledger changes', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'); const indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
  let database: IDBDatabase | undefined;
  try {
    const req = indexedDB.open('youtrace:user:synthetic-navigation:schedule-v1', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('todos', { keyPath: 'id' }); req.result.createObjectStore('outbox', { keyPath: 'id' }); req.result.createObjectStore('settings', { keyPath: 'key' }); };
    database = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const tx = database.transaction(['todos', 'settings'], 'readwrite'); tx.objectStore('todos').put({ id: 'synthetic-todo', text: ' original \n', dueDate: undefined, completedAt: null, done: false }); tx.objectStore('settings').put({ key: 'sync-version:todos:synthetic-todo', value: '1' });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); database.close(); database = undefined;
    const before = await readExistingAccount('synthetic-navigation'), after = await readExistingAccount('synthetic-navigation'), ledger = [{ seq: '1', entityId: 'synthetic-todo' }];
    assert.doesNotThrow(() => assertNavigationData(before, after, 'synthetic-todo', ledger, structuredClone(ledger)));
    for (const mutate of [
      (v: typeof after) => { v.databaseName = 'other-owner'; },
      (v: typeof after) => { v.version++; },
      (v: typeof after) => { v.schema.pop(); },
      (v: typeof after) => { v.tables.find(t => t.name === 'todos').rows.push({ id: 'extra' }); },
      (v: typeof after) => { v.tables.find(t => t.name === 'todos').losslessRows.entries[0][1].entries = v.tables.find(t => t.name === 'todos').losslessRows.entries[0][1].entries.filter(([key]: [string]) => key !== 'dueDate'); },
      (v: typeof after) => { v.tables.find(t => t.name === 'outbox').rows.push({ id: 'queued' }); },
      (v: typeof after) => { v.tables.find(t => t.name === 'settings').rows[0].value = '2'; },
    ]) { const corrupted = structuredClone(after); mutate(corrupted); assert.throws(() => assertNavigationData(before, corrupted, 'synthetic-todo', ledger, ledger)); }
    assert.throws(() => assertNavigationData(before, after, 'synthetic-todo', ledger, []));
    assert.deepEqual(await readExistingAccount('synthetic-navigation'), before);
  } finally { database?.close(); if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else Reflect.deleteProperty(globalThis, 'indexedDB'); }
});
test('first initialization timeout freezes the measured source document and later recovery success cannot become no-reproduction', async () => {
  const saved: unknown[] = [], latch = createNavigationFailureLatch(100, row => saved.push(row));
  const app = (origin: number, outcome: string) => ({ kind: 'application', timeOrigin: origin, event: { attempt: 1, sequence: 1, elapsedMs: 12000, phase: 'initial', stage: 'initialization', outcome } });
  let continueTask!: () => void; let laterNativeActions = 0;
  const measured = measureNavigation(latch, async assertActive => { await new Promise<void>(resolve => { continueTask = resolve; }); assertActive(); laterNativeActions++; });
  const rejected = assert.rejects(measured, { name: 'StartupObservationError' });
  const ledger = createNavigationLedger(10, row => latch.observe(row));
  ledger.record(app(100, 'timeout')); assert.equal(latch.failure, null);
  ledger.record(app(200, 'timeout')); ledger.record(app(200, 'success')); continueTask(); await rejected;
  assert.equal(saved.length, 1); assert.equal(latch.failure.event.outcome, 'timeout'); assert.equal(laterNativeActions, 0);
  assert.equal(classifyNavigationFailure('existing-a-navigation', { text: 'Recovered Todo' }, 'StartupObservationError'), 'observed-failure');
});
test('successful measured boundary ends the latch; later unrelated initialization is not retrospectively attributed', async () => {
  const latch = createNavigationFailureLatch(100); await measureNavigation(latch, async assertActive => assertActive());
  latch.observe({ kind: 'application', timeOrigin: 200, event: { phase: 'recovery', stage: 'initialization', outcome: 'error' } }); assert.equal(latch.failure, null);
});
