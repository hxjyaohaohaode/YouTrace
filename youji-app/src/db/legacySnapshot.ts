import { LEGACY_LIMITS, verifiedLegacyGraph } from './legacySnapshotCodec';

export interface LegacyTableSnapshot {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
  rows: { key: IDBValidKey; value: unknown }[];
}
export interface LegacySnapshot { name: 'youtrace'; idbVersion: number; tables: LegacyTableSnapshot[] }

function existingLegacy(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const opening = indexedDB.open('youtrace');
    opening.onupgradeneeded = () => opening.transaction!.abort(); // never create a missing source
    opening.onerror = () => reject(new Error('旧版本地资料无法只读打开；原库未修改'));
    opening.onblocked = () => { abandoned = true; reject(new Error('请关闭旧版窗口后重试；原库未修改')); };
    opening.onsuccess = () => { if (abandoned) { opening.result.close(); return; } opening.result.onversionchange = () => opening.result.close(); resolve(opening.result); };
  });
}

/** One native readonly transaction covers every store. Binary encoding starts after completion. */
export async function captureLegacySnapshot(): Promise<LegacySnapshot> {
  const database = await existingLegacy();
  try {
    const names = Array.from(database.objectStoreNames);
    const result: LegacySnapshot = { name: 'youtrace', idbVersion: database.version, tables: [] };
    if (!names.length) return result;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(names, 'readonly');
      let rows = 0, failure: Error | null = null;
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure ?? new Error('旧版快照读取中断，未生成备份；原库未修改'));
      transaction.onerror = () => { /* abort handler rejects the entire snapshot */ };
      for (const name of names) {
        const store = transaction.objectStore(name);
        const table: LegacyTableSnapshot = { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes: Array.from(store.indexNames, name => {
          const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
        }), rows: [] };
        result.tables.push(table);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          try {
          if (!cursor.result) return;
          if (++rows > LEGACY_LIMITS.rows) { failure = new Error('旧版记录超过100000条安全导出上限，未生成截断备份；请保留原库并联系恢复支持'); transaction.abort(); return; }
          table.rows.push({ key: cursor.result.primaryKey, value: cursor.result.value });
          cursor.result.continue();
          } catch { failure = new Error('旧版快照读取失败或内存不足，未生成备份；原库未修改'); transaction.abort(); }
        };
      }
    });
    return result;
  } finally { database.close(); }
}

export async function exportLegacySnapshot() {
  const snapshot = await captureLegacySnapshot();
  return {
    format: 'youtrace-legacy-quarantine-v2' as const,
    exportVersion: 2,
    exportedAt: new Date().toISOString(),
    ownership: 'unverified' as const,
    idbVersion: snapshot.idbVersion,
    scope: 'records-and-structure',
    keyGeneratorState: 'not-captured-readonly-api-does-not-expose-nextKey',
    restoreStatus: 'no-product-import-or-ownership-assignment',
    limits: LEGACY_LIMITS,
    summary: snapshot.tables.map(table => ({ name: table.name, rows: table.rows.length, autoIncrement: table.autoIncrement })),
    rawSnapshot: await verifiedLegacyGraph(snapshot),
  };
}
