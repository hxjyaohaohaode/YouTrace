// Hosted-CI Goal first-read acceptance only. App code never imports this file.
import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { readExistingAccount } from './audit-initial-session-outcomes.mjs';
import { legacyBackupFacts } from './audit-legacy-backup.mjs';
import { decodeAccountFact } from './audit-shared-goal-hashes.mjs';
import { createInitializationObserver } from './audit-initialization-observer.mjs';

/** Browser-evaluated, exact native boundary only. The real getAll request is
 * issued and its actual readonly transaction aborted; no fabricated requests,
 * completion events, application promises, settings faults or keepalive work. */
export function installGoalInitialReadFault({ databaseName }) {
  if (!/^youtrace:user:[a-zA-Z0-9_-]{1,128}:schedule-v1$/.test(databaseName)) throw new Error('Invalid synthetic Goal database scope');
  const wanted = ['goalRecords', 'goals', 'outbox', 'settings'].sort().join('|');
  const nativeGetAll = IDBObjectStore.prototype.getAll, observers = [], seen = new WeakSet();
  const state = { syntheticOnly: true, databaseName, timeOrigin: performance.timeOrigin, installedAt: performance.now(), released: false, restored: false, expired: false, violation: null, hits: [], writes: [], initialization: [] };
  let timer;
  const recordWrite = (store, method) => {
    if (state.writes.length >= 512) { state.violation ??= 'write-observation-budget-exceeded'; return; }
    state.writes.push({ at: performance.now(), table: store.name, method, mode: store.transaction.mode });
  };
  function getAll(...args) {
    const transaction = this.transaction;
    const targeted = !state.released && transaction.db.name === databaseName && transaction.mode === 'readonly' && this.name === 'goalRecords' && [...transaction.objectStoreNames].sort().join('|') === wanted;
    const request = Reflect.apply(nativeGetAll, this, args);
    if (targeted && !seen.has(transaction)) {
      seen.add(transaction);
      if (state.hits.length >= 16) { state.violation ??= 'goal-read-abort-budget-exceeded'; release('budget-exceeded'); throw new Error('Synthetic Goal read fault budget exceeded'); }
      const hit = { databaseName: transaction.db.name, timeOrigin: performance.timeOrigin, at: performance.now(), stores: [...transaction.objectStoreNames].sort(), table: this.name, mode: transaction.mode, requestIssued: true, terminal: null };
      state.hits.push(hit);
      transaction.addEventListener('abort', () => { hit.terminal = 'abort'; }, { once: true });
      transaction.addEventListener('complete', () => { hit.terminal = 'complete'; state.violation ??= 'targeted-goal-read-completed'; }, { once: true });
      transaction.abort();
    }
    return request;
  }
  function observe(event) {
    const row = event.detail;
    if (!row || !['initial', 'recovery', 'data-updated'].includes(row.phase) || !['goal', 'initialization'].includes(row.stage) || !['start', 'success', 'error', 'timeout', 'cancel'].includes(row.outcome) || !Number.isSafeInteger(row.attempt)) return;
    if (state.initialization.length >= 128) { state.violation ??= 'initialization-observation-budget-exceeded'; return; }
    state.initialization.push({ at: performance.now(), attempt: row.attempt, phase: row.phase, stage: row.stage, outcome: row.outcome });
  }
  function release(reason = 'explicit-release') {
    if (state.released) return;
    state.released = true; clearTimeout(timer);
    if (IDBObjectStore.prototype.getAll === getAll) IDBObjectStore.prototype.getAll = nativeGetAll;
    else state.violation ??= 'getAll-interceptor-replaced';
    for (const { prototype, name, original, wrapper } of observers) {
      if (prototype[name] === wrapper) prototype[name] = original;
      else state.violation ??= 'write-observer-replaced';
    }
    state.restored = IDBObjectStore.prototype.getAll === nativeGetAll && observers.every(({ prototype, name, original }) => prototype[name] === original);
    state.releasedBy = reason;
    window.removeEventListener('youtrace:initialization-diagnostic', observe);
  }
  for (const name of ['put', 'add', 'delete', 'clear']) {
    const prototype = IDBObjectStore.prototype, original = prototype[name];
    const wrapper = function (...args) { if (!state.released && this.transaction.db.name === databaseName) recordWrite(this, name); return Reflect.apply(original, this, args); };
    observers.push({ prototype, name, original, wrapper }); prototype[name] = wrapper;
  }
  for (const name of ['update', 'delete']) {
    const prototype = IDBCursor.prototype, original = prototype[name];
    const wrapper = function (...args) { const store = this.source.objectStore ?? this.source; if (!state.released && store.transaction.db.name === databaseName) recordWrite(store, `cursor.${name}`); return Reflect.apply(original, this, args); };
    observers.push({ prototype, name, original, wrapper }); prototype[name] = wrapper;
  }
  IDBObjectStore.prototype.getAll = getAll;
  window.addEventListener('youtrace:initialization-diagnostic', observe);
  timer = setTimeout(() => { state.expired = true; state.violation ??= '45-second-fault-deadline'; release('deadline'); }, 45000);
  return { snapshot: () => structuredClone(state), release };
}

export function assertGoalInitialFault(fault, expected) {
  assert.equal(fault?.databaseName, expected.databaseName); assert.equal(fault?.timeOrigin, expected.timeOrigin);
  assert.equal(fault?.syntheticOnly, true); assert.equal(fault.released, false); assert.equal(fault.expired, false); assert.equal(fault.violation, null);
  assert.ok(fault.hits.length > 0 && fault.hits.length <= 16);
  for (const hit of fault.hits) {
    assert.equal(hit.databaseName, expected.databaseName); assert.equal(hit.timeOrigin, expected.timeOrigin);
    assert.deepEqual(hit.stores, ['goalRecords', 'goals', 'outbox', 'settings']);
    assert.equal(hit.table, 'goalRecords'); assert.equal(hit.mode, 'readonly'); assert.equal(hit.requestIssued, true); assert.equal(hit.terminal, 'abort');
  }
  // A superseded data-updated reader may resolve without publishing anything.
  // Required initial/recovery errors plus the actual route gate are the oracle.
  for (const phase of ['initial', 'recovery']) assert.ok(fault.initialization.some(row => row.phase === phase && row.stage === 'initialization' && row.outcome === 'error'), `${phase} required attempt must actually reject`);
  assert.ok(fault.initialization.some(row => row.stage === 'goal' && row.outcome === 'error'), 'At least one real Goal rejection is recorded; superseded ordinary reads may resolve without publishing');
  assert.ok(!fault.initialization.some(row => row.stage === 'initialization' && row.phase !== 'data-updated' && row.outcome === 'success'));
  return true;
}
export function assertGoalInitialGate(view) {
  assert.equal(view.path, '/goal'); assert.equal(view.errorCount, 1); assert.equal(view.retryCount, 1);
  assert.equal(view.workspaceCount, 0); assert.equal(view.cardCount, 0); assert.equal(view.privateGoalText, false);
  assert.equal(view.emptyOrZeroGoalView, false);
  assert.ok(Number.isFinite(view.timeOrigin) && view.timeOrigin > 0); return true;
}
export function assertGoalRetryDocuments(documents, retries) {
  assert.deepEqual(retries, ['fault-retained', 'fault-released']);
  assert.equal(documents.length, 3); assert.equal(new Set(documents.map(row => row.timeOrigin)).size, 3);
  assert.ok(documents.every(row => Number.isFinite(row.timeOrigin) && row.timeOrigin > 0));
  assertGoalInitialGate(documents[0]); assertGoalInitialGate(documents[1]);
  assert.equal(documents[0].faultInstalled, true); assert.equal(documents[1].faultInstalled, true);
  assert.equal(documents[2].path, '/goal'); assert.equal(documents[2].faultInstalled, false);
  assert.equal(documents[2].workspaceCount, 1); assert.equal(documents[2].cardCount, 2);
  assert.equal(documents[2].errorCount, 0); assert.equal(documents[2].retryCount, 0);
  return true;
}

export function assertGoalInitialSourcePreserved(before, after, allowPullTime = false) {
  assert.deepEqual(after.catalog, before.catalog, 'No DB is created, deleted or upgraded by a failed read or Retry');
  assert.deepEqual(after.otherDatabases, before.otherDatabases, 'Every actually present non-current source stays exact');
  assert.deepEqual(after.events, before.events, 'The complete server event ledger remains exact');
  const left = before.account, right = after.account;
  assert.equal(right.databaseName, left.databaseName); assert.equal(right.version, left.version); assert.deepEqual(right.schema, left.schema);
  assert.deepEqual(right.tables.map(table => table.name), left.tables.map(table => table.name));
  const changes = [];
  for (const original of left.tables) {
    const current = right.tables.find(table => table.name === original.name);
    assert.deepEqual(current.keys, original.keys, `All ${original.name} primary keys remain exact`);
    const oldRows = decodeAccountFact(original.losslessRows), newRows = decodeAccountFact(current.losslessRows);
    if (original.name !== 'settings') { assert.deepEqual(newRows, oldRows, `Complete ${original.name} values remain exact`); continue; }
    assert.equal(newRows.length, oldRows.length);
    for (let index = 0; index < oldRows.length; index++) {
      const old = oldRows[index], now = newRows[index];
      if (equal(old, now)) continue;
      assert.ok(allowPullTime && old.key === 'lastPullAt' && now.key === old.key, 'No blanket settings exclusion');
      assert.deepEqual(Object.keys(now).sort(), ['key', 'value']); assert.deepEqual(Object.keys(old).sort(), ['key', 'value']);
      assert.ok(typeof old.value === 'string' && typeof now.value === 'string' && Number.isFinite(Date.parse(old.value)) && Number.isFinite(Date.parse(now.value)) && Date.parse(now.value) >= Date.parse(old.value));
      changes.push({ table: 'settings', key: old.key, before: old.value, after: now.value, scope: 'Normal bootstrap pull across documents, outside the settled failure zero-write window' });
    }
  }
  return changes;
}

/** Uses an existing native-created Goal pair/profile, never seeds business
 * records. A failure escapes to the profile's isolation boundary; no later
 * quota/edit/delete step is permitted to disguise or repair this first result. */
export async function runGoalInitialReadRecovery(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Goal first-read native journey is hosted-CI only');
  const { page, owner, target, neighbor, label, tap, read, exactSelector, readLedger, verifyPair, capture, actions, writeFile, join, artifacts } = h;
  const origin = new URL(page.url()).origin; assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const databaseName = `youtrace:user:${owner}:schedule-v1`, controller = '__youtraceSyntheticGoalInitialRead';
  const trace = createInitializationObserver(), documents = [], retries = [];
  const preservationFailures = [];
  let script, installed = false, stage = 'capture-original-pair', firstFailure = false;
  const save = (suffix, value) => writeFile(join(artifacts, `${label}-${suffix}.json`), JSON.stringify(value, null, 2));
  const preserve = async (step, operation) => {
    try { await operation(); return true; }
    catch (error) { preservationFailures.push({ step, name: error?.name ?? 'unknown' }); return false; }
  };
  const fault = () => page.evaluate(key => globalThis[key]?.snapshot() ?? null, controller);
  const view = () => page.evaluate(({ descriptions, controller }) => ({ path: location.pathname, timeOrigin: performance.timeOrigin, faultInstalled: typeof globalThis[controller] !== 'undefined', errorCount: [...document.querySelectorAll('p')].filter(el => el.textContent === '加载遇到问题').length, retryCount: [...document.querySelectorAll('button')].filter(el => el.textContent.trim() === '重试').length, workspaceCount: document.querySelectorAll('[data-component="goal-workspace"]').length, cardCount: document.querySelectorAll('[data-component="goal-card"]').length, privateGoalText: descriptions.some(text => document.body.innerText.includes(text)), emptyOrZeroGoalView: ['还没有目标', '创建第一个目标', '平均进度 0%'].some(text => document.body.innerText.includes(text)) }), { descriptions: [target.description, neighbor.description], controller });
  const snapshot = async () => {
    const catalog = await page.evaluate(async () => (await indexedDB.databases()).filter(row => row.name === 'youtrace' || row.name.startsWith('youtrace:user:')).map(row => ({ name: row.name, version: row.version })).sort((a, b) => a.name.localeCompare(b.name)));
    assert.ok(catalog.some(row => row.name === databaseName), 'Current verified account database must already exist');
    const otherDatabases = [];
    for (const entry of catalog.filter(row => row.name !== databaseName)) otherDatabases.push({ name: entry.name, snapshot: await page.evaluate(legacyBackupFacts, undefined, entry.name) });
    return { catalog, account: await page.evaluate(readExistingAccount, owner), otherDatabases, events: await readLedger() };
  };
  const gate = async suffix => {
    await page.waitForFunction(key => {
      const state = globalThis[key]?.snapshot();
      return state && (state.violation || ['initial', 'recovery'].every(phase => state.initialization.some(row => row.phase === phase && row.stage === 'initialization' && row.outcome === 'error')));
    }, { timeout: 18000 }, controller);
    const current = await view(), expected = { databaseName, timeOrigin: current.timeOrigin };
    const observation = await fault(); assertGoalInitialFault(observation, expected);
    const error = await exactSelector(page, 'p', '加载遇到问题'), retry = await exactSelector(page, 'button', '重试');
    assert.ok((await read(page, error)).visible && (await read(page, retry)).visible);
    assertGoalInitialGate(current);
    const before = await snapshot(), writes = (await fault()).writes.length;
    await capture(page, `${label}-${suffix}`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await snapshot(), ending = await fault();
    assertGoalInitialFault(ending, expected); const finalView = await view(); assertGoalInitialGate(finalView);
    assert.equal(finalView.timeOrigin, current.timeOrigin, 'A stable failure observation must stay in the same document');
    assert.deepEqual(ending.writes.slice(writes), [], 'Settled visible failure window must attempt zero current-owner writes, including settings/outbox');
    assertGoalInitialSourcePreserved(before, after);
    await save(suffix, { view: current, fault: ending, before, after, zeroWriteWindow: { startsAtWriteCount: writes, endsAtWriteCount: ending.writes.length }, note: 'Zero write covers this settled error window only; ordinary startup metadata operations are separately recorded, never hidden.' });
    return { view: current, facts: after };
  };
  const nativeRetry = async purpose => {
    assert.ok(retries.length < 2 && purpose === (retries.length ? 'fault-released' : 'fault-retained'), 'No additional or out-of-order Retry');
    retries.push(purpose);
    const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 18000 }).then(value => ({ value }), error => ({ error }));
    await tap(page, 'button', '重试'); actions.push({ kind: 'native-goal-first-read-global-Retry', label, purpose, ordinal: retries.length });
    const result = await navigation; if (result.error) throw result.error;
  };
  const release = async () => {
    let failure;
    try { if (script) { await page.removeScriptToEvaluateOnNewDocument(script.identifier); script = null; } }
    catch (error) { failure = error; }
    if (installed) {
      try {
        const released = await page.evaluate(key => { const value = globalThis[key]; if (!value) throw Error('Missing current Goal fault controller'); value.release('explicit-before-recovery-Retry'); return value.snapshot(); }, controller);
        assert.equal(released.restored, true); assert.equal(released.violation, null); assert.equal(released.expired, false);
        installed = false; await save('explicit-fault-release', released);
      } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  };
  let before;
  try {
    await trace.observeInitialization(page);
    before = await snapshot();
    const rows = decodeAccountFact(before.account.tables.find(row => row.name === 'goalRecords').losslessRows);
    assert.equal(rows.length, 2); assert.equal(rows.find(row => row.id === target.id)?.progress, 25); assert.equal(rows.find(row => row.id === neighbor.id)?.progress, 50);
    assert.equal(decodeAccountFact(before.account.tables.find(row => row.name === 'outbox').losslessRows).length, 0);
    await save('scope-and-original', { syntheticOnly: true, owner, targetId: target.id, neighborId: neighbor.id, before, limitations: ['No new foreign-owner or legacy-source fixture is seeded: preservation applies only to databases/tables actually present in this recorded catalog', 'Exact four-table snapshot abort tests the required App gate and real reload recovery; neither the narrower error-publication catch nor the controlled overlapping-read matrix is awarded native coverage', 'Normal lastPullAt refresh across documents is disclosed exactly, not counted as a zero-write startup', 'No third Retry, no provider/production claim; no startup queue or timeout modification'] });
    script = await page.evaluateOnNewDocument(`globalThis.${controller} = (${installGoalInitialReadFault.toString()})(${JSON.stringify({ databaseName })});`);
    stage = 'first-new-document-failure'; installed = true;
    actions.push({ kind: 'declared-goal-first-read-new-document', label, path: '/goal', fault: 'exact-owner-four-table-readonly-native-abort' });
    await page.goto(`${origin}/goal`, { waitUntil: 'domcontentloaded', timeout: 18000 });
    const first = await gate(stage); documents.push(first.view); await save('first-startup-metadata-delta', assertGoalInitialSourcePreserved(before, first.facts, true));
    stage = 'persistent-fault-original-Retry'; await nativeRetry('fault-retained');
    const persistent = await gate(stage); documents.push(persistent.view);
    assert.notEqual(documents[1].timeOrigin, documents[0].timeOrigin, 'First Retry must really create a new document');
    await save('persistent-startup-metadata-delta', assertGoalInitialSourcePreserved(before, persistent.facts, true));
    stage = 'release-only-before-second-Retry'; await release(); assertGoalInitialGate(await view());
    stage = 'original-recovery-Retry'; await nativeRetry('fault-released');
    await page.waitForSelector('[data-component="goal-workspace"]', { timeout: 18000 });
    const recovered = await view(); documents.push(recovered); assertGoalRetryDocuments(documents, retries);
    await verifyPair(rows);
    const after = await snapshot(); const metadataDelta = assertGoalInitialSourcePreserved(before, after, true);
    await save('exact-recovery', { documents, retries, before, after, metadataDelta, originalIds: [target.id, neighbor.id], sourceClaim: 'Complete original rows/unknown fields, all queue entries, server events and present non-current source databases are compared, not reconstructed or reseeded' });
    await capture(page, `${label}-exact-original-pair-after-second-Retry`);
  } catch (error) {
    firstFailure = true;
    // Catch the whole operation, including awaited argument evaluation. A
    // missing artifact must not skip the remaining evidence or replace cause.
    await preserve('FIRST-FAILURE', () => save('FIRST-FAILURE', { stage, name: error.name, detail: error.message, retries, documents, initialization: trace.firstFailureTrace(error) }));
    await preserve('FIRST-FAILURE-fault-before-cleanup', async () => save('FIRST-FAILURE-fault-before-cleanup', await fault()));
    await preserve('FIRST-FAILURE-screenshot', () => capture(page, `${label}-FIRST-FAILURE`));
    // Snapshot while still faulted: this uses an all-table read, never the four
    // table Goal query. No business control follows a failed assertion.
    const fullAccountSaved = await preserve('FIRST-FAILURE-full-account', async () => save('FIRST-FAILURE-full-account', { before, after: await snapshot() }));
    if (!fullAccountSaved) await preserve('FIRST-FAILURE-server-ledger', async () => save('FIRST-FAILURE-server-ledger', { before: before?.events, after: await readLedger() }));
    throw error;
  } finally {
    let finalError;
    try { await release(); }
    catch (error) { finalError = error; await preserve('cleanup-failure', () => save('cleanup-failure', { name: error.name, firstFailure })); }
    try { await save('initialization-chronology', { ...trace.firstFailureTrace(null), preservationFailures }); }
    catch (error) { finalError ??= error; }
    // Existing business/read failure wins; otherwise cleanup/evidence failure
    // must still prevent this profile from being awarded a successful result.
    if (!firstFailure && finalError) throw finalError;
  }
}
