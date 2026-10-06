import { isDeepStrictEqual } from 'node:util';

// The same deliberately bounded value domain as the existing native account
// snapshot reader. Unsupported values fail instead of becoming lossy JSON.
export function encodePreferenceEvidence(value) {
  if (value === undefined) return { type: 'undefined' };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : { type: 'number', value: String(Object.is(value, -0) ? '-0' : value) };
  if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (Array.isArray(value)) return { type: 'array', length: value.length, entries: Object.keys(value).map(key => [key, encodePreferenceEvidence(value[key])]) };
  if (value && Object.getPrototypeOf(value) === Object.prototype) return { type: 'object', entries: Object.keys(value).sort().map(key => [key, encodePreferenceEvidence(value[key])]) };
  throw new Error('Unsupported snapshot value; do not claim lossless retention');
}

// Evaluated only after the last corroborating read and before the one native
// Export click. It issues no transaction/request and never changes their result.
export function installPreferenceExportObserver({ databaseName, stores, durationMs = 15000 }) {
  if (globalThis.__youtracePreferenceExportObserver || !/^youtrace:user:[a-zA-Z0-9_-]+:schedule-v1$/.test(databaseName) || !Array.isArray(stores) || new Set(stores).size !== stores.length || !stores.includes('settings') || !stores.includes('_accountGeneration')) throw new Error('Invalid declared preference export observation');
  const expected = [...stores].sort(), original = IDBObjectStore.prototype.getAll, transactions = new WeakMap();
  const evidence = { version: 1, databaseName, stores: expected, released: false, expired: false, errors: [], transactions: [] };
  const started = performance.now();
  let timer;
  // Keep native unsupported values visible as observer errors, never omit them.
  const encode = value => {
    if (value === undefined) return { type: 'undefined' };
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : { type: 'number', value: String(Object.is(value, -0) ? '-0' : value) };
    if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
    if (value instanceof Date) return { type: 'date', value: value.toISOString() };
    if (Array.isArray(value)) return { type: 'array', length: value.length, entries: Object.keys(value).map(key => [key, encode(value[key])]) };
    if (value && Object.getPrototypeOf(value) === Object.prototype) return { type: 'object', entries: Object.keys(value).sort().map(key => [key, encode(value[key])]) };
    throw new Error('Unsupported snapshot value; do not claim lossless retention');
  };
  const observe = callback => { try { callback(); } catch { evidence.errors.push('observation-failed'); } };
  const wrapped = function (...args) {
    const request = original.apply(this, args);
    observe(() => {
      const tx = this.transaction;
      if (evidence.released || this.name !== 'settings' || tx.db.name !== databaseName || tx.mode !== 'readonly' || JSON.stringify([...tx.objectStoreNames].sort()) !== JSON.stringify(expected)) return;
      let item = transactions.get(tx);
      if (!item) {
        item = { sequence: evidence.transactions.length + 1, databaseName: tx.db.name, mode: tx.mode, stores: [...tx.objectStoreNames].sort(), startedAtMs: performance.now() - started, complete: false, aborted: false, reads: [] };
        transactions.set(tx, item); evidence.transactions.push(item);
        tx.addEventListener('complete', () => observe(() => { item.complete = true; item.completedAtMs = performance.now() - started; }), { once: true });
        tx.addEventListener('abort', () => observe(() => { item.aborted = true; }), { once: true });
      }
      const read = { sequence: item.reads.length + 1, success: false, failed: false }; item.reads.push(read);
      request.addEventListener('success', () => observe(() => { read.rows = encode(request.result); read.success = true; read.readAtMs = performance.now() - started; }), { once: true });
      request.addEventListener('error', () => observe(() => { read.failed = true; }), { once: true });
    });
    return request;
  };
  const release = () => {
    if (!evidence.released) {
      evidence.released = true; clearTimeout(timer);
      if (IDBObjectStore.prototype.getAll === wrapped) IDBObjectStore.prototype.getAll = original;
      else evidence.errors.push('observer-replaced');
    }
    return structuredClone(evidence);
  };
  IDBObjectStore.prototype.getAll = wrapped;
  timer = setTimeout(() => { evidence.expired = true; release(); }, durationMs);
  globalThis.__youtracePreferenceExportObserver = { release };
}

export function releasePreferenceExportObserver() {
  const current = globalThis.__youtracePreferenceExportObserver;
  if (!current) throw new Error('Preference export observer is missing');
  const result = current.release(); delete globalThis.__youtracePreferenceExportObserver; return result;
}

export function preferenceExportKeepsFrozenIntent(states) {
  let frozen = null;
  for (const state of states) {
    if (!state.active) { if (frozen) return false; continue; }
    const active = state.active;
    if (typeof active.id !== 'string' || !active.id) return false;
    const request = { id: active.id, baseRevision: active.baseRevision, base: active.base, changes: active.changes };
    if (frozen && !isDeepStrictEqual(frozen, request)) return false;
    frozen = request;
  }
  return true;
}

export function preferenceExportMatchesObservation(evidence, raw, before, after) {
  if (!evidence?.released || evidence.expired || evidence.errors.length || evidence.transactions.length !== 1) return false;
  const tx = evidence.transactions[0], settings = raw.find(row => row.name === 'settings');
  if (evidence.databaseName !== before.databaseName || tx.databaseName !== before.databaseName || !tx.complete || tx.aborted || tx.mode !== 'readonly' || tx.reads.length !== 1 || !tx.reads[0].success || tx.reads[0].failed || !settings) return false;
  if (!isDeepStrictEqual(tx.stores, before.schema.map(row => row.name).sort()) || !isDeepStrictEqual(tx.stores, evidence.stores) || before.databaseName !== after.databaseName || before.version !== after.version || !isDeepStrictEqual(before.schema, after.schema)) return false;
  if (!isDeepStrictEqual(tx.reads[0].rows, encodePreferenceEvidence(settings.rows)) || !isDeepStrictEqual(settings.keys, settings.rows.map(row => row.key))) return false;
  if (!isDeepStrictEqual(before.tables.find(row => row.name === '_accountGeneration'), after.tables.find(row => row.name === '_accountGeneration'))) return false;
  const names = before.tables.filter(row => row.name !== '_accountGeneration').map(row => row.name).sort();
  if (!isDeepStrictEqual(raw.map(row => row.name).sort(), names)) return false;
  for (const table of raw) for (const snapshot of [before, after]) {
    const source = snapshot.tables.find(row => row.name === table.name);
    if (!source || !isDeepStrictEqual(encodePreferenceEvidence(table.keys), source.keys)) return false;
    if (table.name !== 'settings') { if (!isDeepStrictEqual(encodePreferenceEvidence(table.rows), source.losslessRows)) return false; }
    else {
      const retained = table.rows.filter(row => row.key !== 'accountPreferences:state:v1');
      const entries = source.losslessRows.entries.filter(([index]) => source.rows[Number(index)].key !== 'accountPreferences:state:v1').map(([, row], index) => [String(index), row]);
      if (!isDeepStrictEqual(encodePreferenceEvidence(retained), { type: 'array', length: entries.length, entries })) return false;
    }
  }
  return true;
}
