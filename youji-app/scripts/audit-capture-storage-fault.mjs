// Test-only native IDB fault. It is installed after real authentication and never
// changes application records. The exact owner, table, key and RW mode are fenced.
export function installCaptureStorageFault(databaseName) {
  if (typeof databaseName !== 'string' || !/^youtrace:user:[^:]+:schedule-v1$/.test(databaseName) || globalThis.__captureStorageFault) throw new Error('Invalid or duplicate synthetic Capture fault');
  const proto = IDBObjectStore.prototype, saved = {}, wrappers = {}, hits = []; let dropped = 0;
  const snapshot = () => ({ databaseName, timeOrigin: performance.timeOrigin, hits: hits.map(row => ({ ...row })), dropped });
  const release = () => {
    for (const method of ['add', 'put']) if (saved[method]) Object.defineProperty(proto, method, saved[method]);
    const restored = ['add', 'put'].every(method => { const d = Object.getOwnPropertyDescriptor(proto, method), s = saved[method]; return d.value === s.value && d.configurable === s.configurable && d.enumerable === s.enumerable && d.writable === s.writable; });
    delete globalThis.__captureStorageFault; return { ...snapshot(), restored };
  };
  try {
    for (const method of ['add', 'put']) {
      saved[method] = Object.getOwnPropertyDescriptor(proto, method);
      if (typeof saved[method]?.value !== 'function') throw new Error('Native IDB descriptor missing');
      wrappers[method] = function (value, ...args) {
        if (this.transaction.db.name === databaseName && this.transaction.mode === 'readwrite' && this.name === 'settings' && typeof value?.key === 'string' && /^capture-input:[a-f0-9]{32}(?::context)?$/.test(value.key)) {
          if (hits.length < 64) hits.push({ method, databaseName, store: this.name, mode: this.transaction.mode, key: value.key, timeOrigin: performance.timeOrigin, at: performance.now() }); else dropped++;
          throw new DOMException('Synthetic quota', 'QuotaExceededError');
        }
        return saved[method].value.call(this, value, ...args);
      };
      Object.defineProperty(proto, method, { ...saved[method], value: wrappers[method] });
    }
    globalThis.__captureStorageFault = { snapshot, release };
    return snapshot();
  } catch (error) {
    for (const method of ['add', 'put']) if (saved[method]?.value) Object.defineProperty(proto, method, saved[method]);
    throw error;
  }
}
export async function collectCaptureStorageFailure(h, original) {
  const failures = [];
  for (const [name, work] of Object.entries(h)) {
    try { await work(original); } catch (error) { failures.push({ part: name, message: String(error?.message ?? error) }); }
  }
  return failures;
}
