import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { STARTUP_RECOVERY_CASES, STARTUP_RECOVERY_PATH, runStartupRecoveryOutcomes, startupGoalAcknowledged } from '../scripts/audit-startup-recovery-outcomes.mjs';
import { installStartupReadFault } from '../scripts/audit-startup-read-fault.mjs';
import { assertStartupChronology, assertStartupViewWitness } from '../scripts/audit-startup-chronology.mjs';
const exec = promisify(execFile);
const source = { todoId: 'synthetic-original-todo', databaseName: 'youtrace:user:synthetic-chronology:schedule-v1', epochPresent: true, epoch: 'synthetic-epoch' };
function chronology(branch = 'recovery-success') {
  const events: Array<Record<string, unknown>> = [];
  const add = (elapsedMs: number, kind: string, fields = {}) => events.push({ sequence: events.length + 1, elapsedMs, kind, ...fields });
  const app = (elapsedMs: number, phase: string, outcome: string) => add(elapsedMs, 'application-initialization', { phase, stage: 'initialization', outcome, attempt: phase === 'initial' ? 1 : 2, authChecked: true, isAuthenticated: true, boundOwner: true, verifiedOwner: true, ownersMatch: true, generationChanged: false, revisionChanged: false });
  app(5, 'initial', 'start');
  add(25, 'readonly-held', { target: 'initial', stores: branch === 'recovery-success' ? ['goalRecords', 'goals', 'outbox', 'settings'] : ['expenses', 'settings'], mode: 'readonly', sameSessionRevision: true, attempt: 1 });
  add(30, 'synthetic-business-fetch-rejected', { path: '/api/sync/pull', method: 'GET', hit: 1 });
  app(12010, 'initial', 'timeout'); app(12012, 'recovery', 'start');
  add(12014, 'readonly-held', { target: 'recovery', stores: ['expenses', 'settings'], mode: 'readonly', sameSessionRevision: true, attempt: 2 });
  const recovering = branch === 'recovery-success';
  add(12016, recovering ? 'readonly-release-requested' : 'readonly-abort-requested', { target: 'initial' });
  add(12017, 'readonly-terminal', { target: 'initial', outcome: recovering ? 'complete' : 'abort' });
  app(12018, 'initial', 'error');
  add(12500, recovering ? 'readonly-release-requested' : 'readonly-abort-requested', { target: 'recovery' });
  add(12501, 'readonly-terminal', { target: 'recovery', outcome: recovering ? 'complete' : 'abort' });
  add(12502, 'application-initialization', { phase: 'recovery', stage: 'goal', outcome: 'success', generationChanged: false, revisionChanged: false });
  app(12503, 'recovery', recovering ? 'success' : 'error');
  const visible = { readable: true, sequence: events.length, todoId: source.todoId, rowCount: 1, editorCount: 1, containerId: `todo-record-${source.todoId}`, editorContainerId: `todo-record-${source.todoId}`, rowVisible: true, editorVisible: true };
  const fault = { ...source, syntheticOnly: true, branch, violation: null, expired: false, initialTransactions: 1, recoveryTransactions: 1, initialAttempt: 1, recoveryAttempt: 2, businessRejected: 1, holds: [{ target: 'initial', terminal: recovering ? 'complete' : 'abort', keepaliveRequests: 2000, epochPresent: true, epoch: source.epoch }, { target: 'recovery', terminal: recovering ? 'complete' : 'abort', keepaliveRequests: 200, epochPresent: true, epoch: source.epoch }], events };
  return { fault, visible };
}

test('four isolated branches at both widths have a separate synthetic phone range', () => {
  assert.deepEqual(STARTUP_RECOVERY_CASES.map(row => [row.branch, row.width]), [['recovery-success', 1280], ['both-fail', 1280], ['recovery-success', 360], ['both-fail', 360]]);
  assert.equal(new Set(STARTUP_RECOVERY_CASES.map(row => row.phone)).size, 4);
  assert.ok(STARTUP_RECOVERY_CASES.every(row => /^1390000870[1-4]$/.test(row.phone)));
  assert.equal(STARTUP_RECOVERY_PATH, '/todo?view=all');
  assert.ok(STARTUP_RECOVERY_CASES.every(row => row.nickname.length > 0 && row.nickname.length <= 20), 'Synthetic registration names respect the existing 20-character product limit');
  assert.equal(new Set(STARTUP_RECOVERY_CASES.map(row => row.nickname)).size, 4);
});
test('visible original-row witness binds the actual unique editor to the original rendered ID', () => {
  const { visible } = chronology();
  assert.equal(assertStartupViewWitness(visible, source.todoId), true);
  for (const change of [{ todoId: 'other' }, { containerId: 'todo-record-other' }, { editorContainerId: 'todo-record-other' }, { rowCount: 0 }, { rowCount: 2 }, { editorCount: 2 }, { rowVisible: false }, { editorVisible: false }, { readable: false }]) {
    assert.throws(() => assertStartupViewWitness({ ...visible, ...change }, source.todoId));
  }
});
test('chronology requires 12s overlap, initial non-readiness, full recovery terminal and a later readable original view', () => {
  for (const branch of ['recovery-success', 'both-fail']) { const { fault, visible } = chronology(branch); assert.equal(assertStartupChronology(fault, visible, source), true); }
  const mutations = [
    value => { value.fault.initialTransactions = 0; },
    value => { value.fault.recoveryTransactions = 2; },
    value => { value.fault.events[3].elapsedMs = 100; },
    value => { value.fault.events[3].elapsedMs = 20000; },
    value => { value.fault.events[5].sequence = 2; },
    value => { value.fault.events[6].sequence = 1; },
    value => { value.fault.events[7].sequence = 20; },
    value => { value.fault.events[10].sequence = 20; },
    value => { value.fault.events[8].outcome = 'success'; },
    value => { value.fault.events[11].outcome = 'error'; },
    value => { value.fault.events[12].outcome = 'error'; },
    value => { value.visible.readable = false; },
    value => { value.visible.sequence = 20; },
    value => { value.visible.sequence = 3; },
    value => { value.fault.holds[1].epoch = 'new-source'; },
    value => { value.fault.holds[0].epochPresent = false; },
    value => { value.fault.holds[1].terminal = 'abort'; },
    value => { value.fault.events[2].method = 'POST'; },
    value => { value.fault.events[4].ownersMatch = false; },
    value => { value.fault.events[11].generationChanged = true; },
    value => { value.fault.events[11].revisionChanged = true; },
    value => { value.fault.databaseName += '-other'; },
    value => { value.fault.violation = 'budget-exceeded'; },
    value => { value.fault.expired = true; },
    value => { value.fault.events.push({ ...value.fault.events[3] }); },
    value => { value.fault.businessRejected = 0; },
  ];
  for (const mutate of mutations) { const value = chronology(); mutate(value); assert.throws(() => assertStartupChronology(value.fault, value.visible, source)); }
  const failed = chronology('both-fail'); failed.fault.events[8].outcome = 'success'; assert.throws(() => assertStartupChronology(failed.fault, failed.visible, source));
});
for (const branch of ['recovery-success', 'both-fail']) test(`real store modules with native readonly completion/abort preserve source: ${branch}`, async () => {
  const result = await exec(process.execPath, ['--import', 'tsx', new URL('./helpers/startup-native-boundary-scenario.ts', import.meta.url).pathname, branch, '12000'], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const report = JSON.parse(result.stdout);
  assert.equal(report.branch, branch); assert.equal(report.facts.violation, null); assert.equal(report.facts.released, true);
  assert.deepEqual(report.settled, { initial: 'error', recovery: branch === 'recovery-success' ? 'success' : 'error' });
  assert.equal(report.facts.holds.length, 2);
});
test('the startup Goal prerequisite needs one real exact record, complete business fields and matching ACK', () => {
  const goal = { id: 'synthetic-native-goal', title: 'Synthetic Goal', description: 'Complete original description', progress: 0, targetDate: null, level: 'short', domain: '学习', priority: 'medium', syncScope: 'account', createdAt: 17, updatedAt: 29 };
  const facts = { owner: 'synthetic-owner', local: { tables: [{ name: 'goalRecords', rows: [goal] }, { name: 'outbox', rows: [] }, { name: 'settings', rows: [{ key: `sync-version:goals:${goal.id}`, value: '1' }] }] }, events: [{ seq: '1', entity: 'goals', entityId: goal.id, operation: 'upsert', data: { ...goal, userId: 'synthetic-owner', createdAt: new Date(goal.createdAt).toISOString(), updatedAt: new Date(42).toISOString() } }] };
  assert.equal(startupGoalAcknowledged(facts, goal.title, goal.description), true);
  for (const change of [{ id: 'different' }, { description: 'partial' }, { progress: 25 }, { userId: 'other' }, { targetDate: '' }]) {
    const changed = structuredClone(facts); Object.assign(changed.events[0].data, change);
    assert.equal(startupGoalAcknowledged(changed, goal.title, goal.description), false);
  }
  for (const key of ['id', 'title', 'description', 'level', 'domain', 'priority', 'progress', 'targetDate', 'createdAt', 'updatedAt']) {
    const missing = structuredClone(facts); Reflect.deleteProperty(missing.events[0].data, key);
    assert.equal(startupGoalAcknowledged(missing, goal.title, goal.description), false, `Missing server ${key} is not a full ACK`);
  }
  for (const change of [{ createdAt: new Date(18).toISOString() }, { createdAt: 'bad' }, { updatedAt: 'bad' }, { updatedAt: new Date(1).toISOString() }, { updatedAt: 42 }]) {
    const corrupt = structuredClone(facts); Object.assign(corrupt.events[0].data, change);
    assert.equal(startupGoalAcknowledged(corrupt, goal.title, goal.description), false);
  }
  const absent = structuredClone(facts); absent.local.tables[0].rows = [];
  assert.equal(startupGoalAcknowledged(absent, goal.title, goal.description), false, 'Empty/unread data cannot satisfy the original Goal prerequisite');
  const stale = structuredClone(facts); stale.events[0].seq = '2'; assert.equal(startupGoalAcknowledged(stale, goal.title, goal.description), false);
});
test('new native runner is inert outside hosted CI and no source timer/fix is bundled', async () => {
  const prior = process.env.GITHUB_ACTIONS; delete process.env.GITHUB_ACTIONS;
  try { await assert.rejects(runStartupRecoveryOutcomes({}), /hosted-CI only/); }
  finally { if (prior === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prior; }
  const hook = await readFile(new URL('../src/hooks/useAppInit.ts', import.meta.url), 'utf8');
  assert.match(hook, /const INIT_TIMEOUT_MS = 12_000;/);
  const journey = await readFile(new URL('../scripts/audit-startup-recovery-outcomes.mjs', import.meta.url), 'utf8');
  assert.ok(journey.includes("await tap('button', '重试')"));
  assert.ok(journey.includes("await tap('button[aria-label=\"新建目标\"]')"));
  assert.ok(journey.includes("await waitApp('initial', 'error')"));
  assert.ok(journey.includes("await faultCommand('finish', 'recovery', 'complete'); await waitApp('recovery', 'success')"));
  assert.ok(!journey.includes("await waitApp('initial', 'success')"));
  assert.ok(journey.includes("await tap('[role=dialog] button', '取消（保留草稿）')"));
  assert.ok(journey.indexOf("await save('first-failure-faults-before-release'") < journey.indexOf("await releaseFaults('first-failure-cleanup')"));
});
test('fault scope excludes foreign DB/readwrite and has an explicit bounded fetch tripwire with restoration', async () => {
  const originals = { window: globalThis.window, location: globalThis.location, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  const transaction = IDBDatabase.prototype.transaction;
  const successful = Response.json({ user: { id: 'synthetic' } }); let passed = 0;
  const originalFetch = async () => { passed++; return successful; };
  Object.assign(globalThis, { window: new EventTarget(), location: { origin: 'http://127.0.0.1:4173' }, localStorage: { getItem: () => 'synthetic-revision' }, fetch: originalFetch });
  const opened = async (name: string) => new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onupgradeneeded = () => { request.result.createObjectStore('expenses'); request.result.createObjectStore('settings'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const foreign = await opened('synthetic-foreign-database'), account = await opened(source.databaseName);
  const fault = installStartupReadFault({ databaseName: source.databaseName, branch: 'both-fail' });
  try {
    assert.equal(await fetch('/api/auth/me'), successful, 'Auth response is the actual supplied response object');
    for (const [database, mode] of [[foreign, 'readonly'], [account, 'readwrite']] as const) {
      const tx = database.transaction(['expenses', 'settings'], mode);
      assert.ok(tx instanceof IDBTransaction); assert.equal(tx.mode, mode);
      await new Promise<void>((resolve, reject) => { tx.objectStore('expenses').count(); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    }
    assert.equal(fault.snapshot().holds.length, 0);
    for (let hit = 1; hit <= 65; hit++) await assert.rejects(fetch('/api/sync/pull'), /Synthetic bounded business API offline fault/);
    const result = fault.snapshot();
    assert.equal(result.businessRejected, 65); assert.equal(result.violation, 'business-fetch-budget-exceeded'); assert.equal(result.released, true);
    assert.equal(result.events.filter(row => row.kind === 'synthetic-business-fetch-rejected').length, 65);
    assert.equal(passed, 1, 'Every declared synthetic rejection occurs before real network');
    assert.equal(globalThis.fetch, originalFetch); assert.equal(IDBDatabase.prototype.transaction, transaction);
    assert.throws(() => fault.finish('initial', 'complete'), /Invalid synthetic/);
  } finally { fault.dispose(); foreign.close(); account.close(); Object.assign(globalThis, originals); }
});
test('45-second safety deadline is installed unchanged and expires closed', () => {
  const originals = { window: globalThis.window, location: globalThis.location, localStorage: globalThis.localStorage, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let deadline = 0, expire: (() => void) | undefined;
  Object.assign(globalThis, { window: new EventTarget(), location: { origin: 'http://127.0.0.1:4173' }, localStorage: { getItem: () => 'synthetic' }, fetch: async () => Response.json({}), setTimeout: (callback: () => void, delay: number) => { deadline = delay; expire = callback; return 17; }, clearTimeout: () => undefined });
  const fault = installStartupReadFault({ databaseName: source.databaseName, branch: 'recovery-success' });
  try {
    assert.equal(deadline, 45000); expire!();
    const result = fault.snapshot(); assert.equal(result.expired, true); assert.equal(result.released, true); assert.equal(result.violation, '45-second-fault-deadline');
  } finally { fault.dispose(); Object.assign(globalThis, originals); }
});
