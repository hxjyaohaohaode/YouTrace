import assert from 'node:assert/strict';

// This witness comes from the actual rendered record and its visible editor.
export function assertStartupViewWitness(witness, todoId) {
  assert.ok(typeof todoId === 'string' && todoId.length > 0);
  assert.equal(witness?.rowCount, 1); assert.equal(witness?.editorCount, 1);
  assert.equal(witness?.containerId, `todo-record-${todoId}`);
  assert.equal(witness?.editorContainerId, witness?.containerId);
  assert.equal(witness?.todoId, todoId);
  assert.equal(witness?.rowVisible, true); assert.equal(witness?.editorVisible, true);
  assert.equal(witness?.readable, true);
  return true;
}

// Pure evidence oracle. A missing boundary is a failure, never a passing skip.
export function assertStartupChronology(fault, beforeVisible, source) {
  assert.equal(fault.syntheticOnly, true);
  assert.equal(fault.violation, null, 'Synthetic fault contract was not proven');
  assert.equal(fault.expired, false, 'Fault deadline is an infrastructure failure');
  assert.equal(fault.initialTransactions, 1); assert.equal(fault.recoveryTransactions, 1);
  assert.equal(fault.holds.length, 2);
  assert.equal(fault.databaseName, source.databaseName);
  assert.ok(Number.isSafeInteger(fault.initialAttempt) && Number.isSafeInteger(fault.recoveryAttempt) && fault.initialAttempt !== fault.recoveryAttempt);
  const find = predicate => { const rows = fault.events.filter(predicate); assert.equal(rows.length, 1, 'Required chronology boundary must occur exactly once'); return rows[0]; };
  const app = (phase, outcome) => find(row => row.kind === 'application-initialization' && row.phase === phase && row.stage === 'initialization' && row.outcome === outcome);
  const start = app('initial', 'start'), timeout = app('initial', 'timeout'), recoveryStart = app('recovery', 'start');
  // The native app remains at 12_000ms. Ten milliseconds only accommodates
  // independently sampled event timestamps; it is never a shortened timer.
  assert.ok(timeout.elapsedMs - start.elapsedMs >= 11990 && timeout.elapsedMs - start.elapsedMs <= 18000, 'Observe the real twelve-second initialization deadline');
  assert.ok(recoveryStart.sequence > timeout.sequence);
  const firstHold = find(row => row.kind === 'readonly-held' && row.target === 'initial');
  const nextHold = find(row => row.kind === 'readonly-held' && row.target === 'recovery');
  assert.ok(start.sequence < firstHold.sequence && firstHold.sequence < timeout.sequence && nextHold.sequence > recoveryStart.sequence);
  assert.deepEqual(firstHold.stores, fault.branch === 'recovery-success' ? ['goalRecords', 'goals', 'outbox', 'settings'] : ['expenses', 'settings']);
  assert.deepEqual(nextHold.stores, ['expenses', 'settings']);
  const initialTerminal = find(row => row.kind === 'readonly-terminal' && row.target === 'initial');
  const recoveryTerminal = find(row => row.kind === 'readonly-terminal' && row.target === 'recovery');
  for (const row of [firstHold, nextHold]) { assert.equal(row.mode, 'readonly'); assert.equal(row.sameSessionRevision, true); }
  for (const row of [start, recoveryStart]) for (const key of ['authChecked', 'isAuthenticated', 'boundOwner', 'verifiedOwner', 'ownersMatch']) assert.equal(row[key], true, `Real ${row.phase} identity flag ${key}`);
  for (const row of [start, recoveryStart]) for (const key of ['generationChanged', 'revisionChanged']) assert.equal(row[key], false);
  assert.equal(firstHold.attempt, fault.initialAttempt); assert.equal(nextHold.attempt, fault.recoveryAttempt);
  const [first, next] = ['initial', 'recovery'].map(target => fault.holds.find(row => row.target === target));
  assert.ok(first.keepaliveRequests > 0 && next.keepaliveRequests > 0);
  assert.equal(first.epochPresent, next.epochPresent); assert.deepEqual(first.epoch, next.epoch);
  assert.equal(first.epochPresent, source.epochPresent); assert.deepEqual(first.epoch, source.epoch);
  for (const row of fault.events.filter(row => row.kind === 'application-initialization')) for (const key of ['generationChanged', 'revisionChanged']) assert.equal(row[key], false, 'Later meaningful authority changes are outside this invariant-source case');
  assert.ok(['recovery-success', 'both-fail'].includes(fault.branch));
  assert.ok(fault.businessRejected > 0 && fault.businessRejected <= 64);
  assert.equal(fault.events.filter(row => row.kind === 'synthetic-business-fetch-rejected').length, fault.businessRejected);
  assert.ok(fault.events.some(row => row.kind === 'synthetic-business-fetch-rejected' && row.path === '/api/sync/pull' && row.method === 'GET'));
  assert.ok(fault.events.filter(row => row.kind === 'synthetic-business-fetch-rejected').every(row => row.method === 'GET'), 'No new business write request may be attempted in this startup fixture');
  assert.equal(fault.events.filter(row => row.kind === 'application-initialization' && row.phase === 'initial' && row.stage === 'initialization' && row.outcome === 'success').length, 0, 'An unpublished cancelled Goal read is not initial readiness');
  const initialError = app('initial', 'error');
  assert.ok(initialError.sequence > initialTerminal.sequence);
  if (fault.branch === 'recovery-success') {
    const initialRelease = find(row => row.kind === 'readonly-release-requested' && row.target === 'initial');
    const recoveryRelease = find(row => row.kind === 'readonly-release-requested' && row.target === 'recovery');
    const success = app('recovery', 'success');
    assert.equal(first.terminal, 'complete'); assert.equal(next.terminal, 'complete');
    assert.ok(initialRelease.sequence > nextHold.sequence && initialError.sequence > initialRelease.sequence);
    assert.ok(recoveryRelease.sequence > initialError.sequence && success.sequence > recoveryRelease.sequence);
    const goalRead = find(row => row.kind === 'application-initialization' && row.phase === 'recovery' && row.stage === 'goal' && row.outcome === 'success');
    assert.ok(recoveryTerminal.sequence > recoveryRelease.sequence && goalRead.sequence > recoveryStart.sequence && success.sequence > recoveryTerminal.sequence && success.sequence > goalRead.sequence);
    assert.equal(fault.events.filter(row => row.kind === 'application-initialization' && row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === 'error').length, 0);
    assertStartupViewWitness(beforeVisible, source.todoId);
    assert.ok(beforeVisible.sequence >= success.sequence && beforeVisible.sequence <= fault.events.at(-1).sequence, 'Readable original view must follow the whole recovery success, not initial transaction completion');
  } else {
    const initialAbort = find(row => row.kind === 'readonly-abort-requested' && row.target === 'initial');
    const recoveryAbort = find(row => row.kind === 'readonly-abort-requested' && row.target === 'recovery');
    assert.equal(first.terminal, 'abort'); assert.equal(next.terminal, 'abort');
    assert.ok(initialAbort.sequence > nextHold.sequence && initialError.sequence > initialAbort.sequence);
    assert.ok(recoveryAbort.sequence > initialError.sequence && recoveryTerminal.sequence > recoveryAbort.sequence && app('recovery', 'error').sequence > recoveryTerminal.sequence);
    assert.equal(fault.events.filter(row => row.kind === 'application-initialization' && row.phase === 'recovery' && row.stage === 'initialization' && row.outcome === 'success').length, 0);
  }
  return true;
}
