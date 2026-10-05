// Browser-only metadata observation for the ordinary startup regression.
// No keys, values, database names, owners, requests or responses are copied.
export const storageProgressSchema = {
  outcomes: ['transaction-start', 'transaction-complete', 'transaction-abort', 'transaction-error', 'request-start', 'request-success', 'request-error'],
  modes: ['readonly', 'readwrite', 'versionchange'],
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
    return safe;
  } catch { return null; }
}
export function installStorageProgress(schema) {
  if (window !== window.top || typeof IDBDatabase === 'undefined') return;
  const databases = new WeakMap(), transactions = new WeakMap(), originals = [];
  let databaseSerial = 0, transactionSerial = 0, requestSerial = 0;
  const send = value => { try { void window.__youtraceInitializationDiagnostic({ kind: 'storage-progress', event: value }).catch(() => undefined); } catch { /* Observation failure must not change storage. */ } };
  const elapsed = start => Math.min(1_000_000_000, Math.max(0, Math.round(performance.now() - start)));
  const table = name => schema.stores.includes(name) ? name : 'other';
  const attach = transaction => {
    if (transactions.has(transaction)) return transactions.get(transaction);
    const database = transaction.db;
    if (!database.name.startsWith('youtrace:user:')) return null;
    if (!databases.has(database)) databases.set(database, ++databaseSerial);
    const start = performance.now(), metadata = { database: databases.get(database), transaction: ++transactionSerial, request: 0, mode: transaction.mode, timeOrigin: performance.timeOrigin, stores: [...transaction.objectStoreNames].map(table).sort() };
    const event = (outcome, extra = {}) => send({ ...metadata, outcome, elapsedMs: elapsed(start), ...extra });
    const info = { event }; transactions.set(transaction, info); event('transaction-start');
    for (const [native, observed] of [['complete', 'transaction-complete'], ['abort', 'transaction-abort'], ['error', 'transaction-error']]) transaction.addEventListener(native, () => event(observed), { once: true });
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
  // Used only by the in-process collector contract tests; page lifetime owns
  // browser cleanup. Cursor success means the first event, not all rows read.
  return () => { for (const restore of originals.reverse()) restore(); };
}
