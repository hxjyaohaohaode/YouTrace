// SYNTHETIC TEST FAULT, never imported by application code. Only native fetch
// and real readonly IDB transactions are intercepted. Requests/results/events
// are never replaced, and no persistent/auth/business state is written.
export function installStartupReadFault(config) {
  const { databaseName, branch } = config;
  if (!/^youtrace:user:[^:]+:schedule-v1$/.test(databaseName) || !['late-recovery', 'both-fail'].includes(branch)) throw new Error('Invalid synthetic startup fault scope');
  const root = globalThis, nativeFetch = root.fetch, nativeTransaction = IDBDatabase.prototype.transaction;
  const started = performance.now(), events = [], holds = new Map();
  const state = { syntheticOnly: true, branch, databaseName, released: false, expired: false, violation: null, authenticated: false, businessRejected: 0, initialAttempt: null, recoveryAttempt: null, initialStartedAt: null, timeoutAt: null, initialTransactions: 0, recoveryTransactions: 0 };
  const revision = () => localStorage.getItem('youtrace:session-revision');
  let initialRevision, timer;
  const record = (kind, fields = {}) => { if (events.length < 256) events.push({ sequence: events.length + 1, elapsedMs: performance.now() - started, kind, ...fields }); else state.violation ??= 'fault-chronology-overflow'; };
  const fail = reason => { state.violation ??= reason; record('fault-contract-violation', { reason }); };
  const same = (actual, expected) => actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  function endHold(hold, abort, reason) {
    if (!hold || hold.ended) return false;
    hold.ended = true; hold.keepalive = false;
    record(abort ? 'readonly-abort-requested' : 'readonly-release-requested', { target: hold.target, reason, keepaliveRequests: hold.keepaliveRequests });
    if (abort) { try { hold.transaction.abort(); } catch { fail('captured-readonly-transaction-not-active'); } }
    return true;
  }
  function release(reason = 'explicit-cleanup') {
    if (state.released) return;
    state.released = true; clearTimeout(timer);
    // Every captured transaction must be explicitly resolved/aborted by the
    // scenario. Cleanup aborts anything still held without changing stored data.
    for (const hold of holds.values()) if (!hold.ended) endHold(hold, true, reason);
    if (root.fetch === interceptedFetch) root.fetch = nativeFetch; else fail('fetch-interceptor-replaced');
    if (IDBDatabase.prototype.transaction === interceptedTransaction) IDBDatabase.prototype.transaction = nativeTransaction; else fail('transaction-interceptor-replaced');
    record('all-faults-released', { reason });
  }
  function onInitialization(event) {
    const row = event.detail;
    if (!row || !['initial', 'recovery'].includes(row.phase) || !['initialization', 'stores', 'expense', 'goal', 'sync-offline'].includes(row.stage) || !['start', 'success', 'error', 'timeout', 'cancel'].includes(row.outcome) || !Number.isSafeInteger(row.attempt)) return;
    const fields = { attempt: row.attempt, phase: row.phase, stage: row.stage, outcome: row.outcome };
    for (const key of ['authChecked', 'isAuthenticated', 'boundOwner', 'verifiedOwner', 'ownersMatch', 'generationChanged', 'revisionChanged']) if (typeof row[key] === 'boolean') fields[key] = row[key];
    record('application-initialization', fields);
    if (row.stage !== 'initialization') return;
    if (row.phase === 'initial' && row.outcome === 'start') {
      if (state.initialAttempt !== null) fail('multiple-initial-attempts-in-fault-document');
      state.initialAttempt = row.attempt; state.initialStartedAt = performance.now() - started; initialRevision = revision();
    }
    if (row.phase === 'initial' && row.outcome === 'timeout') state.timeoutAt = performance.now() - started;
    if (row.phase === 'recovery' && row.outcome === 'start') {
      if (state.recoveryAttempt !== null) fail('multiple-recovery-attempts-in-fault-document');
      state.recoveryAttempt = row.attempt;
    }
  }
  window.addEventListener('youtrace:initialization-diagnostic', onInitialization);
  async function interceptedFetch(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    if (!state.released && url.origin === location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
      if (!state.authenticated) fail('business-request-before-valid-identity');
      state.businessRejected++;
      record('synthetic-business-fetch-rejected', { path: url.pathname, method, hit: state.businessRejected });
      if (state.businessRejected > 64) { fail('business-fetch-budget-exceeded'); release('budget-exceeded'); }
      throw new TypeError('Synthetic bounded business API offline fault');
    }
    const response = await Reflect.apply(nativeFetch, this, [input, init]);
    if (url.origin === location.origin && url.pathname === '/api/auth/me' && method === 'GET') {
      state.authenticated = response.status === 200;
      record('actual-auth-response', { status: response.status });
    }
    return response;
  }
  function interceptedTransaction(names, mode, options) {
    const transaction = Reflect.apply(nativeTransaction, this, arguments);
    if (state.released || this.name !== databaseName || transaction.mode !== 'readonly') return transaction;
    const stores = [...transaction.objectStoreNames].sort();
    const initialStores = branch === 'late-recovery' ? ['goalRecords', 'goals', 'outbox', 'settings'] : ['expenses', 'settings'];
    let target;
    if (same(stores, initialStores) && state.recoveryAttempt === null) {
      state.initialTransactions++;
      if (state.initialTransactions === 1 && state.initialAttempt !== null) target = 'initial';
      else fail('unexpected-extra-initial-target-transaction');
    } else if (same(stores, ['expenses', 'settings']) && state.recoveryAttempt !== null) {
      state.recoveryTransactions++;
      if (state.recoveryTransactions === 1) target = 'recovery';
      else fail('unexpected-extra-recovery-target-transaction');
    }
    if (!target) return transaction;
    if (!state.authenticated || !initialRevision || revision() !== initialRevision) fail('identity-or-session-revision-changed');
    const hold = { target, transaction, keepalive: true, keepaliveRequests: 0, ended: false, terminal: null, epochPresent: false, epoch: null };
    holds.set(target, hold);
    record('readonly-held', { target, stores, mode: transaction.mode, attempt: target === 'initial' ? state.initialAttempt : state.recoveryAttempt, sameSessionRevision: revision() === initialRevision });
    const epochRead = transaction.objectStore('settings').get('localDataEpoch');
    epochRead.addEventListener('success', () => { hold.epochPresent = epochRead.result !== undefined; hold.epoch = epochRead.result?.value ?? null; record('readonly-source-epoch', { target, present: hold.epochPresent, epoch: hold.epoch }); });
    const terminal = outcome => { hold.terminal = outcome; hold.keepalive = false; record('readonly-terminal', { target, outcome, keepaliveRequests: hold.keepaliveRequests }); };
    transaction.addEventListener('complete', () => terminal('complete'), { once: true });
    transaction.addEventListener('abort', () => terminal('abort'), { once: true });
    const keepalive = () => {
      if (!hold.keepalive) return;
      if (hold.keepaliveRequests >= 30_000_000) { fail('readonly-request-budget-exceeded'); endHold(hold, true, 'budget-exceeded'); return; }
      // These are ordinary native readonly requests. Holding transaction
      // completion postpones Dexie's explicit transaction promise naturally.
      hold.keepaliveRequests++;
      const request = transaction.objectStore(stores[0]).count();
      request.addEventListener('success', keepalive, { once: true });
    };
    keepalive();
    return transaction;
  }
  root.fetch = interceptedFetch; IDBDatabase.prototype.transaction = interceptedTransaction;
  timer = setTimeout(() => { state.expired = true; fail('45-second-fault-deadline'); release('deadline'); }, 45000);
  record('synthetic-fault-installed', { deadlineMs: 45000, allowedBusinessRejections: 64, maximumIncludingTripwire: 65, maximumKeepaliveRequestsPerTransaction: 30_000_000 });
  return {
    snapshot: () => ({ ...state, holds: [...holds.values()].map(({ target, keepaliveRequests, ended, terminal, epochPresent, epoch }) => ({ target, keepaliveRequests, ended, terminal, epochPresent, epoch })), events: events.map(row => ({ ...row })) }),
    finish: (target, outcome) => {
      if (state.released || !['initial', 'recovery'].includes(target) || !['complete', 'abort'].includes(outcome)) throw new Error('Invalid synthetic readonly release');
      if (!holds.has(target) || holds.get(target).ended) throw new Error('Synthetic readonly target is not held');
      return endHold(holds.get(target), outcome === 'abort', 'explicit-scenario-release');
    },
    release,
    dispose: () => { release(); window.removeEventListener('youtrace:initialization-diagnostic', onInitialization); },
  };
}
