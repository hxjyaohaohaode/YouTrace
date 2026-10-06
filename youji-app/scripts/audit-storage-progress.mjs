// Browser-only metadata observation for the ordinary startup regression.
// No keys, values, database names, owners, requests or responses are copied.
export const storageProgressSchema = {
  outcomes: ['transaction-start', 'transaction-complete', 'transaction-abort', 'transaction-error', 'request-start', 'request-success', 'request-error', 'connection-seen', 'connection-close-requested', 'connection-close-event', 'document-pagehide', 'document-pageshow', 'document-freeze', 'document-resume', 'document-visibilitychange'],
  modes: ['readonly', 'readwrite', 'versionchange', 'none'],
  stores: ['todos', 'expenses', 'quickNotes', 'diary', 'habits', 'habitCheckins', 'schedules', 'goals', 'goalRecords', 'coachInsights', 'settings', 'outbox', 'other'],
  methods: ['get', 'getAll', 'getAllKeys', 'getKey', 'put', 'add', 'delete', 'clear', 'count', 'openCursor', 'openKeyCursor'],
};
export function projectStorageProgress(value, schema = storageProgressSchema) {
  try {
    if (!value) return null;
    const outcome = value.outcome, mode = value.mode;
    if (!schema.outcomes.includes(outcome) || !schema.modes.includes(mode)) return null;
    const safe = { outcome, mode };
    for (const key of ['database', 'transaction', 'request', 'elapsedMs']) {
      const number = value[key];
      if (!Number.isSafeInteger(number) || number < 0 || number > 1_000_000_000) return null;
      safe[key] = number;
    }
    const stores = value.stores, method = value.method, store = value.store, timeOrigin = value.timeOrigin;
    if (!Array.isArray(stores) || !Number.isFinite(timeOrigin) || timeOrigin < 0 || timeOrigin > Number.MAX_SAFE_INTEGER) return null;
    safe.stores = [];
    for (const name of stores) { if (!schema.stores.includes(name)) return null; safe.stores.push(name); }
    safe.timeOrigin = timeOrigin;
    if (schema.methods.includes(method)) safe.method = method;
    if (schema.stores.includes(store)) safe.store = store;
    for (const key of ['observedTransactions', 'observedUnfinished', 'observedComplete', 'observedAbort', 'connectionVersion', 'documentElapsedMs']) {
      const number = value[key];
      if (Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000_000) safe[key] = number;
    }
    for (const key of ['persisted', 'trusted', 'wasDiscarded']) { const flag = value[key]; if (typeof flag === 'boolean') safe[key] = flag; }
    const visibility = value.visibility; if (['visible', 'hidden'].includes(visibility)) safe.visibility = visibility;
    return safe;
  } catch { return null; }
}
export function installStorageProgress(schema) {
  if (window !== window.top || typeof IDBDatabase === 'undefined') return;
  const databases = new WeakMap(), transactions = new WeakMap(), originals = [], connections = [], lifecycleCleanups = [];
  let observing = true;
  let databaseSerial = 0, transactionSerial = 0, requestSerial = 0;
  const send = value => { if (!observing) return; try { void window.__youtraceInitializationDiagnostic({ kind: 'storage-progress', event: { ...value, documentElapsedMs: Math.min(1_000_000_000, Math.max(0, Math.round(performance.now()))) } }).catch(() => undefined); } catch { /* Observation failure must not change storage. */ } };
  const elapsed = start => Math.min(1_000_000_000, Math.max(0, Math.round(performance.now() - start)));
  const table = name => schema.stores.includes(name) ? name : 'other';
  const counter = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
  const connectionEvent = (info, outcome, extra = {}) => send({
    outcome, mode: 'none', database: info?.id ?? 0, transaction: 0, request: 0,
    elapsedMs: elapsed(info?.started ?? performance.now()), timeOrigin: performance.timeOrigin,
    stores: info?.stores ?? [], observedTransactions: info?.startedTransactions ?? 0,
    observedUnfinished: info?.unfinished ?? 0, observedComplete: info?.complete ?? 0,
    observedAbort: info?.abort ?? 0, ...(info ? { connectionVersion: info.version } : {}), ...extra,
  });
  // Listener factories retain only numeric metadata, never the DB connection.
  const nativeConnectionEvent = (info, outcome) => event => {
    try {
      const extra = { trusted: event.isTrusted === true };
      connectionEvent(info, outcome, extra);
    } catch { /* Observation failure cannot change native event handling. */ }
  };
  const connection = database => {
    if (!database.name.startsWith('youtrace:user:')) return null;
    if (databases.has(database)) return databases.get(database);
    const version = database.version;
    const info = { id: ++databaseSerial, version: counter(version) ? version : undefined, started: performance.now(), stores: [...database.objectStoreNames].map(table).sort(), startedTransactions: 0, unfinished: 0, complete: 0, abort: 0 };
    databases.set(database, info); connections.push(info);
    // Do not add versionchange/abort/error listeners to the database: they
    // change the specification's connection garbage-collection condition.
    database.addEventListener('close', nativeConnectionEvent(info, 'connection-close-event'));
    connectionEvent(info, 'connection-seen');
    return info;
  };
  const attach = transaction => {
    if (transactions.has(transaction)) return transactions.get(transaction);
    const conn = connection(transaction.db);
    if (!conn) return null;
    conn.startedTransactions++; conn.unfinished++;
    const start = performance.now(), metadata = { database: conn.id, transaction: ++transactionSerial, request: 0, mode: transaction.mode, timeOrigin: performance.timeOrigin, stores: [...transaction.objectStoreNames].map(table).sort() };
    const event = (outcome, extra = {}) => send({ ...metadata, outcome, elapsedMs: elapsed(start), ...extra });
    const info = { event }; transactions.set(transaction, info); event('transaction-start');
    let terminal = false;
    for (const [native, observed] of [['complete', 'transaction-complete'], ['abort', 'transaction-abort'], ['error', 'transaction-error']]) transaction.addEventListener(native, () => {
      try {
        if (native !== 'error' && !terminal) { terminal = true; conn.unfinished--; conn[native]++; }
        event(observed);
      } catch { /* The app's original completion/error handlers still run. */ }
    }, { once: true });
    return info;
  };
  const replace = (prototype, method, wrap) => {
    const original = prototype[method];
    if (typeof original !== 'function') return;
    const replacement = wrap(original); prototype[method] = replacement;
    originals.push(() => { if (prototype[method] === replacement) prototype[method] = original; });
  };
  replace(IDBDatabase.prototype, 'transaction', original => function (...args) {
    const transaction = Reflect.apply(original, this, args);
    try { attach(transaction); } catch { /* Preserve the original transaction. */ }
    return transaction;
  });
  replace(IDBDatabase.prototype, 'close', original => function (...args) {
    const result = Reflect.apply(original, this, args);
    try { const info = connection(this); if (info) connectionEvent(info, 'connection-close-requested'); } catch { /* Preserve the original close return. */ }
    return result;
  });
  for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) for (const method of schema.methods) replace(prototype, method, original => function (...args) {
    const request = Reflect.apply(original, this, args);
    try {
      const store = this instanceof IDBIndex ? this.objectStore : this, info = attach(store.transaction);
      if (info) {
        const metadata = { request: ++requestSerial, method, store: table(store.name) };
        info.event('request-start', metadata);
        request.addEventListener('success', () => info.event('request-success', metadata), { once: true });
        request.addEventListener('error', () => info.event('request-error', metadata), { once: true });
      }
    } catch { /* Preserve the original request and its error behavior. */ }
    return request;
  });
  const listen = (target, name) => {
    if (typeof target?.addEventListener !== 'function') return;
    const listener = event => {
      try {
        const details = { trusted: event.isTrusted === true };
        if (name === 'pagehide' || name === 'pageshow') { const persisted = event.persisted; if (typeof persisted === 'boolean') details.persisted = persisted; }
        if (typeof document !== 'undefined') { const visibility = document.visibilityState, discarded = document.wasDiscarded; if (['visible', 'hidden'].includes(visibility)) details.visibility = visibility; if (typeof discarded === 'boolean') details.wasDiscarded = discarded; }
        for (const info of connections.length ? connections : [null]) connectionEvent(info, `document-${name}`, details);
      } catch { /* No lifecycle event is dispatched, canceled, or prolonged. */ }
    };
    target.addEventListener(name, listener);
    lifecycleCleanups.push(() => target.removeEventListener(name, listener));
  };
  for (const name of ['pagehide', 'pageshow']) listen(window, name);
  if (typeof document !== 'undefined') for (const name of ['freeze', 'resume', 'visibilitychange']) listen(document, name);
  // Used only by the in-process collector contract tests; page lifetime owns
  // browser cleanup. Cursor success means the first event, not all rows read.
  return () => { observing = false; for (const remove of lifecycleCleanups) remove(); for (const restore of originals.reverse()) restore(); };
}
