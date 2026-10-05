/** Memory-only initialization observation. No content, identifiers or free-form errors. */
export const INITIALIZATION_EVENT = 'youtrace:initialization-diagnostic';
export const INITIALIZATION_TRACE_LIMIT = 160;
export const INITIALIZATION_PHASES = ['initial', 'recovery', 'data-updated'] as const;
export const INITIALIZATION_STAGES = ['initialization', 'settings', 'sync', 'sync-offline', 'stores', 'expense', 'todo', 'habit', 'quick-note', 'schedule', 'diary', 'coach', 'goal'] as const;
export const INITIALIZATION_OUTCOMES = ['start', 'success', 'error', 'timeout', 'cancel'] as const;
export const INITIALIZATION_FLAGS = ['authChecked', 'isAuthenticated', 'identityUnavailable', 'signedOut', 'boundOwner', 'verifiedOwner', 'ownersMatch', 'generationChanged', 'revisionChanged', 'dbOpen', 'dbBlocked', 'recoveryErrorPresent', 'ambientTransactionPresent', 'ambientTransactionActive'] as const;
export const INITIALIZATION_ERROR_NAMES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AuthError', 'AbortError', 'TimeoutError', 'DatabaseClosedError', 'TransactionInactiveError', 'PrematureCommitError', 'SubTransactionError', 'QuotaExceededError', 'UpgradeError', 'VersionError', 'InvalidStateError', 'NotFoundError', 'ConstraintError', 'DataError', 'ReadOnlyError', 'UnknownError', 'SecurityError', 'NetworkError', 'OpenFailedError', 'MissingAPIError', 'BulkError', 'ModifyError', 'unknown'] as const;
export const INITIALIZATION_ERROR_CATEGORIES = ['authority-changed', 'local-data-changed', 'auth', 'storage', 'abort', 'timeout', 'unknown'] as const;
type Phase = typeof INITIALIZATION_PHASES[number];
type Stage = typeof INITIALIZATION_STAGES[number];
type Outcome = typeof INITIALIZATION_OUTCOMES[number];
type Flags = Partial<Record<typeof INITIALIZATION_FLAGS[number], boolean>>;
export interface InitializationEvent extends Flags {
  attempt: number;
  phase: Phase;
  stage: Stage;
  outcome: Outcome;
  sequence: number;
  elapsedMs: number;
  transactionMode?: 'readonly' | 'readwrite';
  errorName?: typeof INITIALIZATION_ERROR_NAMES[number];
  errorCategory?: typeof INITIALIZATION_ERROR_CATEGORIES[number];
}
const records: InitializationEvent[] = [];
let attempt = 0, sequence = 0;
const startedAt = performance.now();
const isMember = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && values.includes(value as T);
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;

/** Treat even diagnostic inputs as untrusted; never spread a caller's object. */
export function projectInitializationEvent(input: unknown): InitializationEvent | null {
  try {
    if (!input || typeof input !== 'object') return null;
    const value = input as Record<string, unknown>;
    // Read once: a getter can return an allowed value and then private content.
    const attempt = value.attempt, sequence = value.sequence, elapsedMs = value.elapsedMs;
    const phase = value.phase, stage = value.stage, outcome = value.outcome;
    if (!counter(attempt) || !counter(sequence) || !counter(elapsedMs)
      || !isMember(INITIALIZATION_PHASES, phase) || !isMember(INITIALIZATION_STAGES, stage)
      || !isMember(INITIALIZATION_OUTCOMES, outcome)) return null;
    const safe: InitializationEvent = { attempt, phase, stage, outcome, sequence, elapsedMs };
    for (const key of INITIALIZATION_FLAGS) { const flag = value[key]; if (typeof flag === 'boolean') safe[key] = flag; }
    const mode = value.transactionMode, name = value.errorName, category = value.errorCategory;
    if (mode === 'readonly' || mode === 'readwrite') safe.transactionMode = mode;
    if (isMember(INITIALIZATION_ERROR_NAMES, name)) safe.errorName = name;
    if (isMember(INITIALIZATION_ERROR_CATEGORIES, category)) safe.errorCategory = category;
    return safe;
  } catch { return null; }
}

export function initializationError(error: unknown): Pick<InitializationEvent, 'errorName' | 'errorCategory'> {
  let errorName: InitializationEvent['errorName'] = 'unknown';
  let errorCategory: InitializationEvent['errorCategory'] = 'unknown';
  try {
    if (error && typeof error === 'object') {
      const value = error as { name?: unknown; message?: unknown };
      const name = value.name;
      if (isMember(INITIALIZATION_ERROR_NAMES, name)) errorName = name;
      // Exact application-owned literals classify generic Errors without emitting messages.
      const message = value.message;
      if (message === '账号或本机资料已变化，未写入旧修改。输入仍保留，请重新核对') errorCategory = 'authority-changed';
      else if (message === '本机资料已变化（已清除），未恢复旧修改。输入仍保留，请重新核对') errorCategory = 'local-data-changed';
      else if (errorName === 'AuthError') errorCategory = 'auth';
      else if (errorName === 'AbortError') errorCategory = 'abort';
      else if (errorName === 'TimeoutError') errorCategory = 'timeout';
      else if (['DatabaseClosedError', 'TransactionInactiveError', 'PrematureCommitError', 'SubTransactionError', 'QuotaExceededError', 'UpgradeError', 'VersionError', 'InvalidStateError', 'NotFoundError', 'ConstraintError', 'DataError', 'ReadOnlyError', 'UnknownError', 'OpenFailedError', 'MissingAPIError', 'BulkError', 'ModifyError'].includes(errorName)) errorCategory = 'storage';
    }
  } catch { /* Diagnostic inspection must never change the original failure. */ }
  return { errorName, errorCategory };
}

export function initializationSnapshot(): InitializationEvent[] { return records.map(row => ({ ...row })); }

export function beginInitializationTrace(phase: Phase, snapshot: () => unknown = () => ({})) {
  const id = attempt = Math.min(attempt + 1, 1_000_000_000);
  function record(stage: Stage, outcome: Outcome, error?: unknown) {
    try {
      let flags: unknown;
      try { flags = snapshot(); } catch { flags = {}; }
      const safe = projectInitializationEvent({
        // Projection copies only boolean flags from this internal snapshot.
        ...(flags && typeof flags === 'object' ? flags : {}),
        attempt: id, phase, stage, outcome,
        sequence: sequence = Math.min(sequence + 1, 1_000_000_000),
        elapsedMs: Math.min(1_000_000_000, Math.max(0, Math.round(performance.now() - startedAt))),
        ...(outcome === 'error' ? initializationError(error) : {}),
      });
      if (!safe) return;
      records.push(Object.freeze(safe));
      if (records.length > INITIALIZATION_TRACE_LIMIT) records.splice(0, records.length - INITIALIZATION_TRACE_LIMIT);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(INITIALIZATION_EVENT, { detail: safe }));
    } catch { /* Ignore synchronous diagnostic inspection/dispatch failures. */ }
  }
  function run<T>(stage: Stage, operation: () => Promise<T>, detached = false): Promise<T> {
    record(stage, 'start');
    try {
      const original = operation();
      const success = (value: T) => { record(stage, 'success'); return value; };
      // Return the identical awaited Promise, without adding an await/microtask to
      // the application chain. A detached caller must still expose its rejection.
      if (detached) return original.then(success, error => { record(stage, 'error', error); throw error; });
      void original.then(success, error => { record(stage, 'error', error); });
      return original;
    } catch (error) { record(stage, 'error', error); throw error; }
  }
  record('initialization', 'start');
  return { record, run };
}
export type InitializationTrace = ReturnType<typeof beginInitializationTrace>;
