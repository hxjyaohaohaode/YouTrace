// Declared bounded native-IDB diagnostic. Never replaces app promises, state,
// auth or request responses. Corroborating all-table getAll reads stay intact.
export function installPreferenceFault({ databaseName, originalRevision, originalEpoch, desiredTime, kind, durationMs = 25000 }) {
  if (!['write', 'read'].includes(kind) || !/^youtrace:user:[a-zA-Z0-9_-]+:schedule-v1$/.test(databaseName) || !Number.isInteger(originalRevision) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(desiredTime)) throw new Error('Invalid declared preference fault');
  if (globalThis.__youtracePreferenceFault) throw new Error('Preference fault already exists');
  const originalPut = IDBObjectStore.prototype.put, originalGet = IDBObjectStore.prototype.get;
  const started = performance.now(), evidence = { kind, databaseName, originalRevision, originalEpoch, desiredTime, deadlineMs: durationMs, puts: 0, commits: 0, writeHits: 0, readHits: 0, armed: false, released: false, expired: false, events: [] };
  let sequence = 0, timer;
  const event = (name, extra = {}) => evidence.events.push({ sequence: ++sequence, elapsedMs: performance.now() - started, name, ...extra });
  const matches = store => store.name === 'settings' && store.transaction.db.name === databaseName;
  const release = reason => {
    if (evidence.released) return structuredClone(evidence);
    evidence.released = true; clearTimeout(timer); IDBObjectStore.prototype.put = originalPut; IDBObjectStore.prototype.get = originalGet; event('release', { reason }); return structuredClone(evidence);
  };
  IDBObjectStore.prototype.put = function (value, ...args) {
    const state = value?.value;
    if (matches(this) && this.transaction.mode === 'readwrite' && value?.key === 'accountPreferences:state:v1' && state?.epoch === originalEpoch && state.localRevision === originalRevision + 1 && state.queued?.changes?.eveningReviewTime === desiredTime) {
      evidence.puts++; event('matching-put', { revision: state.localRevision, changes: structuredClone(state.queued.changes) });
      this.transaction.addEventListener('abort', () => event('matching-write-abort'), { once: true });
      this.transaction.addEventListener('complete', () => { evidence.commits++; evidence.armed = kind === 'read'; event('matching-write-complete'); }, { once: true });
      if (kind === 'write') { evidence.writeHits++; event('write-quota'); throw new DOMException('Synthetic preference storage quota', 'QuotaExceededError'); }
    }
    return originalPut.call(this, value, ...args);
  };
  IDBObjectStore.prototype.get = function (key) {
    if (!evidence.released && kind === 'read' && evidence.armed && matches(this) && this.transaction.mode === 'readonly' && [...this.transaction.objectStoreNames].length === 1 && key === 'theme') {
      evidence.readHits++; event('display-theme-read-abort', { mode: this.transaction.mode, stores: [...this.transaction.objectStoreNames] });
      this.transaction.abort(); throw new DOMException('Synthetic preference display read interrupted', 'AbortError');
    }
    return originalGet.call(this, key);
  };
  timer = setTimeout(() => { evidence.expired = true; release('deadline'); }, durationMs);
  event('installed');
  globalThis.__youtracePreferenceFault = { snapshot: () => structuredClone(evidence), release };
  return structuredClone(evidence);
}
