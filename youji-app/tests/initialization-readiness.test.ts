import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializationHookDriver as driver, deferred, tick } from './helpers/initializationHookDriver.ts';
import { initializationSnapshot } from '../src/services/initializationDiagnostics.ts';

for (const first of ['initial-success', 'recovery-failure'] as const) test(`current initial success survives recovery failure: ${first} first`, async () => {
  const app = driver(), settings = deferred<void>(), recovery = deferred<void>();
  let reads = 0;
  app.loaders.set('settings', () => settings.promise);
  app.loaders.set('expense', () => ++reads === 1 ? recovery.promise : Promise.resolve());
  app.render(true);
  assert.deepEqual(app.timeout(), { ready: false, failed: true });
  if (first === 'initial-success') { settings.resolve(); await app.settle(); recovery.reject(new Error('synthetic recovery failure')); }
  else { recovery.reject(new Error('synthetic recovery failure')); await app.settle(); settings.resolve(); }
  assert.deepEqual(await app.settle(), { ready: true, failed: true });
  assert.equal(reads, 2);
  assert.ok(initializationSnapshot().some(row => row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === 'error'));
  app.unmount();
});

for (const first of ['recovery-success', 'initial-failure'] as const) test(`current recovery success survives initial failure: ${first} first`, async () => {
  const app = driver(), settings = deferred<void>(), recovery = deferred<void>();
  app.loaders.set('settings', () => settings.promise);
  app.loaders.set('expense', () => recovery.promise);
  app.render(true); app.timeout();
  if (first === 'recovery-success') { recovery.resolve(); await app.settle(); settings.reject(new Error('synthetic initial failure')); }
  else { settings.reject(new Error('synthetic initial failure')); await app.settle(); recovery.resolve(); }
  assert.deepEqual(await app.settle(), { ready: true, failed: true });
  app.unmount();
});

test('no successful complete load stays failed, with one recovery and the real deadline', async () => {
  const app = driver(), settings = deferred<void>(), recovery = deferred<void>();
  app.loaders.set('settings', () => settings.promise);
  app.loaders.set('expense', () => recovery.promise);
  app.render(true); app.timeout(); settings.reject(new Error('synthetic initial failure')); recovery.reject(new Error('synthetic recovery failure'));
  assert.deepEqual(await app.settle(), { ready: false, failed: true });
  assert.equal(app.calls.filter(call => call === 'expense').length, 1);
  assert.equal(app.timers.size, 0); app.unmount();
});

for (const boundary of ['disabled', 'unmounted'] as const) for (const outcome of ['success', 'failure'] as const) test(`${boundary} recovery ${outcome} cannot publish or start new work`, async () => {
  const app = driver(), settings = deferred<void>(), recovery = deferred<void>();
  app.loaders.set('settings', () => settings.promise); app.loaders.set('expense', () => recovery.promise);
  app.render(true); app.timeout();
  if (boundary === 'disabled') app.render(false); else app.unmount();
  const calls = app.calls.length;
  app.events.dispatchEvent(new Event('youtrace:data-updated'));
  assert.equal(app.calls.length, calls);
  if (outcome === 'success') recovery.resolve(); else recovery.reject(new Error('synthetic recovery failure'));
  await tick();
  if (boundary === 'disabled') { assert.deepEqual(app.render(false), { ready: false, failed: false }); app.unmount(); }
  assert.equal(app.writesAfterUnmount, 0);
});

test('disabled render at the deadline prevents recovery before an effect can start', async () => {
  const app = driver(), settings = deferred<void>();
  app.loaders.set('settings', () => settings.promise); app.render(true);
  const timer = [...app.timers.values()][0]; timer.callback();
  app.render(false); await tick();
  assert.deepEqual(app.calls, ['settings']); app.unmount();
});

for (const oldOutcome of ['success', 'failure'] as const) test(`reenabled attempt ignores old ${oldOutcome} and owns a fresh deadline/recovery`, async () => {
  const app = driver(), oldSettings = deferred<void>(), oldRecovery = deferred<void>(), newSettings = deferred<void>(), newRecovery = deferred<void>();
  let starts = 0, reads = 0;
  app.loaders.set('settings', () => ++starts === 1 ? oldSettings.promise : newSettings.promise);
  app.loaders.set('expense', () => ++reads === 1 ? oldRecovery.promise : newRecovery.promise);
  app.render(true); app.timeout(); app.render(false);
  assert.deepEqual(app.render(true), { ready: false, failed: false });
  if (oldOutcome === 'success') oldRecovery.resolve(); else oldRecovery.reject(new Error('synthetic old failure'));
  assert.deepEqual(await app.settle(), { ready: false, failed: false });
  assert.deepEqual(app.timeout(), { ready: false, failed: true });
  newRecovery.resolve();
  assert.deepEqual(await app.settle(), { ready: true, failed: true });
  oldSettings.reject(new Error('synthetic old initial failure'));
  assert.deepEqual(await app.settle(), { ready: true, failed: true });
  app.unmount();
});

for (const changed of ['owner', 'generation', 'revision', 'database', 'signed-out', 'storage-error'] as const) for (const phase of ['initial', 'recovery'] as const) test(`${phase} old success cannot unlock after ${changed} changes before render`, async () => {
  const app = driver(), pending = deferred<void>(), settings = deferred<void>();
  if (phase === 'initial') app.loaders.set('settings', () => pending.promise);
  else { app.loaders.set('settings', () => settings.promise); app.loaders.set('expense', () => pending.promise); }
  app.render(true); if (phase === 'recovery') app.timeout();
  if (changed === 'owner') { app.authority.owner = 'synthetic-other'; app.databaseModule.db.ownerId = app.authority.owner; }
  if (changed === 'generation') app.authority.generation++;
  if (changed === 'revision') app.authority.revision = 'synthetic-new-revision';
  if (changed === 'database') app.databaseModule.db = { ...app.databaseModule.db };
  if (changed === 'signed-out') app.authority.signedOut = true;
  if (changed === 'storage-error') app.authority.storageThrows = true;
  pending.resolve(); await tick();
  // Hold the new attempt so only an old completion could incorrectly unlock it.
  app.loaders.set('settings', () => new Promise<void>(() => undefined));
  assert.equal(app.render(true).ready, false);
  app.unmount();
});

test('a previous ready result is hidden immediately across disable/reenable', async () => {
  const app = driver(); app.render(true); assert.equal((await app.settle()).ready, true);
  assert.deepEqual(app.render(false), { ready: false, failed: false });
  app.loaders.set('settings', () => new Promise<void>(() => undefined));
  assert.deepEqual(app.render(true), { ready: false, failed: false });
  app.unmount();
});

test('ordinary failure starts recovery without waiting for timeout and success needs every required store', async () => {
  const app = driver(), goal = deferred<void>();
  app.loaders.set('settings', () => Promise.reject(new Error('synthetic settings failure')));
  app.loaders.set('goal', () => goal.promise);
  app.render(true); await app.settle();
  assert.deepEqual(app.render(true), { ready: false, failed: true });
  assert.equal(app.timers.size, 0);
  goal.resolve(); assert.deepEqual(await app.settle(), { ready: true, failed: true });
  app.unmount();
});

for (const phase of ['initial', 'recovery'] as const) for (const changed of ['owner', 'generation', 'revision', 'database'] as const) test(`${phase} old failure does not replace new ${changed} success`, async () => {
  const app = driver(), pending = deferred<void>(), settings = deferred<void>();
  if (phase === 'initial') app.loaders.set('settings', () => pending.promise);
  else { app.loaders.set('settings', () => settings.promise); app.loaders.set('expense', () => pending.promise); }
  app.render(true); if (phase === 'recovery') app.timeout();
  if (changed === 'owner') { app.authority.owner = 'synthetic-other'; app.databaseModule.db.ownerId = app.authority.owner; }
  if (changed === 'generation') app.authority.generation++;
  if (changed === 'revision') app.authority.revision = 'synthetic-new-revision';
  if (changed === 'database') app.databaseModule.db = { ...app.databaseModule.db };
  app.loaders.clear();
  assert.deepEqual(app.render(true), { ready: false, failed: false });
  assert.deepEqual(await app.settle(), { ready: true, failed: false });
  pending.reject(new Error('synthetic old attempt failure'));
  assert.deepEqual(await app.settle(), { ready: true, failed: false });
  app.unmount();
});

test('a queued old deadline cannot fail a new successful session', async () => {
  const app = driver(), pending = deferred<void>();
  app.loaders.set('settings', () => pending.promise); app.render(true);
  const oldTimer = [...app.timers.values()][0];
  app.authority.generation++; app.loaders.clear(); app.render(true);
  assert.deepEqual(await app.settle(), { ready: true, failed: false });
  oldTimer.callback();
  assert.deepEqual(app.render(true), { ready: true, failed: false });
  app.unmount();
});

for (const offline of [false, true]) test(`${offline ? 'offline' : 'online'} initial load waits for the required goal read`, async () => {
  const app = driver(offline), goal = deferred<void>();
  app.loaders.set('goal', () => goal.promise); app.render(true);
  assert.deepEqual(await app.settle(), { ready: false, failed: false });
  assert.deepEqual([...app.timers.values()].map(value => value.delay), [12_000]);
  goal.resolve(); assert.deepEqual(await app.settle(), { ready: true, failed: false });
  app.unmount();
});

test('offline initial load also waits for Coach; data-updated failure cannot revoke readiness', async () => {
  const app = driver(true), coach = deferred<void>();
  app.loaders.set('coach', () => coach.promise); app.render(true);
  assert.equal((await app.settle()).ready, false);
  coach.resolve(); assert.equal((await app.settle()).ready, true);
  app.loaders.set('expense', () => Promise.reject(new Error('synthetic refresh failure')));
  app.events.dispatchEvent(new Event('youtrace:data-updated'));
  assert.deepEqual(await app.settle(), { ready: true, failed: false });
  assert.ok(initializationSnapshot().some(row => row.phase === 'data-updated' && row.stage === 'initialization' && row.outcome === 'error'));
  app.unmount();
});

for (const invalid of ['storage-error', 'signed-out', 'owner-mismatch'] as const) test(`${invalid} at start stays visibly failed and does not pretend recovery succeeded`, async () => {
  const app = driver();
  if (invalid === 'storage-error') app.authority.storageThrows = true;
  if (invalid === 'signed-out') app.authority.signedOut = true;
  if (invalid === 'owner-mismatch') app.databaseModule.db.ownerId = 'synthetic-other';
  app.render(true); await app.settle();
  assert.deepEqual(await app.settle(), { ready: false, failed: true });
  assert.deepEqual(app.calls, []);
  assert.ok(initializationSnapshot().some(row => row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === 'error'));
  app.unmount();
});

test('initial completion after unmount produces diagnostics but no state update', async () => {
  const app = driver(), pending = deferred<void>();
  app.loaders.set('settings', () => pending.promise); app.render(true); app.unmount();
  pending.resolve(); await tick();
  assert.equal(app.writesAfterUnmount, 0);
  assert.equal(app.timers.size, 0);
  assert.ok(initializationSnapshot().some(row => row.phase === 'initial' && row.stage === 'initialization' && row.outcome === 'success'));
});


for (const outcome of ['reject', 'hang'] as const) test(`lost storage access during ${outcome} surfaces failure without unrelated renders`, async () => {
  const app = driver(), settings = deferred<void>();
  app.loaders.set('settings', () => settings.promise); app.render(true);
  await app.flushScheduled();
  assert.deepEqual(app.lastResult, { ready: false, failed: false });
  app.authority.storageThrows = true;
  if (outcome === 'reject') settings.reject(Object.assign(new Error('Synthetic storage access revoked'), { name: 'SecurityError' }));
  await app.flushScheduled();
  if (app.timers.size > 0) app.fireDeadline();
  assert.deepEqual(await app.flushScheduled(), { ready: false, failed: true });
  assert.ok(app.stateUpdates > 0, 'the failed load or deadline must itself request a render');
  if (outcome === 'hang') assert.ok(initializationSnapshot().some(row => row.phase === 'initial' && row.stage === 'initialization' && row.outcome === 'timeout'));
  app.unmount();
});

for (const phase of ['initial', 'recovery'] as const) for (const changed of ['owner', 'generation', 'database'] as const) test(`${phase} old failure cannot publish after ${changed} changes with storage unreadable`, async () => {
  const app = driver(), pending = deferred<void>(), settings = deferred<void>();
  if (phase === 'initial') app.loaders.set('settings', () => pending.promise);
  else { app.loaders.set('settings', () => settings.promise); app.loaders.set('expense', () => pending.promise); }
  app.render(true); if (phase === 'recovery') app.timeout();
  await app.flushScheduled();
  if (changed === 'owner') { app.authority.owner = 'synthetic-other'; app.databaseModule.db.ownerId = app.authority.owner; }
  if (changed === 'generation') app.authority.generation++;
  if (changed === 'database') app.databaseModule.db = { ...app.databaseModule.db };
  app.authority.storageThrows = true;
  const updates = app.stateUpdates;
  pending.reject(new Error('Synthetic obsolete failure'));
  await app.flushScheduled();
  assert.equal(app.stateUpdates, updates, 'old callbacks must not request a result update for a different known session');
  app.unmount();
});

test('storage loss during late recovery failure hides an earlier ready result without unrelated renders', async () => {
  const app = driver(), settings = deferred<void>(), recovery = deferred<void>();
  let reads = 0;
  app.loaders.set('settings', () => settings.promise);
  app.loaders.set('expense', () => ++reads === 1 ? recovery.promise : Promise.resolve());
  app.render(true); app.timeout(); settings.resolve();
  assert.deepEqual(await app.flushScheduled(), { ready: true, failed: true });
  app.authority.storageThrows = true; recovery.reject(new Error('Synthetic storage access revoked'));
  assert.deepEqual(await app.flushScheduled(), { ready: false, failed: true });
  app.unmount();
});


test('transient storage failure restored before its rejection handler starts a fresh complete load', async () => {
  const app = driver();
  app.authority.storageThrows = true; app.render(true);
  app.authority.storageThrows = false;
  assert.deepEqual(await app.flushScheduled(), { ready: true, failed: false });
  assert.deepEqual(app.calls, ['settings', 'sync', 'expense', 'todo', 'habit', 'quick-note', 'schedule', 'diary', 'goal', 'coach']);
  assert.equal(app.timers.size, 0);
  assert.ok(app.stateUpdates > 0, 'a real rejection must request the render that starts the new load');
  app.unmount();
});

for (const changed of ['owner', 'generation', 'database'] as const) test(`restored storage cannot publish an old unavailable ${changed} attempt`, async () => {
  const app = driver();
  app.authority.storageThrows = true; app.render(true);
  if (changed === 'owner') { app.authority.owner = 'synthetic-other'; app.databaseModule.db.ownerId = app.authority.owner; }
  if (changed === 'generation') app.authority.generation++;
  if (changed === 'database') app.databaseModule.db = { ...app.databaseModule.db };
  app.authority.storageThrows = false;
  await app.flushScheduled();
  assert.equal(app.stateUpdates, 0);
  assert.deepEqual(app.calls, []);
  app.render(true);
  assert.deepEqual(await app.flushScheduled(), { ready: true, failed: false });
  app.unmount();
});
