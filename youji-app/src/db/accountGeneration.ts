/**
 * A physical database boundary, not a Dexie version bump: old JavaScript can
 * reopen newer schemas and would otherwise ACK a lossy schedule payload.
 * The previous account database is never deleted, upgraded or used for writes.
 */
export const GENERATION_STORE = '_accountGeneration';
export const GENERATION_ID = 'schedule-v1';
const MARKER_KEY = 'cutover';

export const ACCOUNT_SCHEMA: Record<string, string> = {
  schedules: 'id, date, type', expenses: 'id, date, category',
  todos: 'id, done, dueDate, priority', habits: 'id',
  habitCheckins: 'id, habitId, date, [habitId+date]', quickNotes: 'id, createdAt',
  diary: 'id, date', settings: 'key', coachInsights: 'id, type, dismissed, createdAt',
  coachPushes: 'id, type, read, createdAt', goals: 'id, level, domain, priority',
  goalRecords: 'id, level, domain, priority', outbox: '++seq, entity, queuedAt',
};

type StoredRow = { key: IDBValidKey; value: unknown };
type IndexDefinition = { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean };
export interface StoredTable {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: IndexDefinition[];
  rows: StoredRow[];
  // Native IndexedDB doesn't expose a key generator. An aborted probe captures
  // its next key, including deleted keys, without committing any source write.
  nextKey?: number;
}
export interface GenerationSnapshot { version: number; tables: StoredTable[] }
interface GenerationMarker {
  key: typeof MARKER_KEY;
  ownerId: string;
  generation: typeof GENERATION_ID;
  sourceName: string;
  state: 'copied' | 'ready';
  source: GenerationSnapshot | null;
  cleared?: boolean;
}
export interface GenerationRecovery {
  sourcePresent: boolean;
  changedTables: string[];
  cleared: boolean;
}

export function accountDatabaseName(ownerId: string, previous = false): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) throw new Error('账号标识无效，未打开数据');
  return `youtrace:user:${ownerId}${previous ? '' : `:${GENERATION_ID}`}`;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new DOMException('Database transaction interrupted', 'AbortError')); tx.onerror = () => { /* onabort reports failure */ }; });
}
async function existing(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name);
    let absent = false;
    opening.onupgradeneeded = () => { absent = true; opening.transaction!.abort(); };
    opening.onerror = () => { if (absent) resolve(null); else reject(opening.error); };
    opening.onsuccess = () => { opening.result.onversionchange = () => opening.result.close(); resolve(opening.result); };
    opening.onblocked = () => reject(new Error('请关闭其他旧版窗口后重试，本地原始资料仍保留'));
  });
}

function describe(store: IDBObjectStore): StoredTable {
  return {
    name: store.name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
    indexes: Array.from(store.indexNames, (name) => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; }), rows: [],
  };
}

async function snapshot(database: IDBDatabase, probeGenerators = false): Promise<GenerationSnapshot> {
  const names = Array.from(database.objectStoreNames);
  if (!names.length) return { version: database.version, tables: [] };
  const tx = database.transaction(names, probeGenerators ? 'readwrite' : 'readonly');
  const done = completed(tx);
  // Attach an error handler immediately; a failed read may precede awaiting done.
  void done.catch(() => undefined);
  let probing = false;
  try {
    const tables = await Promise.all(names.map(async (name) => {
      const store = tx.objectStore(name), table = describe(store);
      const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
      table.rows = keys.map((key, index) => ({ key, value: values[index] }));
      if (probeGenerators && table.autoIncrement) {
        const key = await request(store.add({}));
        if (typeof key !== 'number') throw new Error('无法校验原始自动编号，未切换数据库');
        table.nextKey = key;
      }
      return table;
    }));
    if (probeGenerators) { probing = true; tx.abort(); await done.catch(() => undefined); }
    else await done;
    return { version: database.version, tables };
  } catch (error) {
    if (!probing) { try { tx.abort(); } catch { /* already aborted */ } }
    throw error;
  }
}

function keyPath(value: string): string | string[] { return value.startsWith('[') ? value.slice(1, -1).split('+') : value; }
function defaults(): StoredTable[] {
  return Object.entries(ACCOUNT_SCHEMA).map(([name, schema]) => {
    const [primary, ...indexes] = schema.split(',').map((part) => part.trim());
    return { name, keyPath: keyPath(primary.replace(/^\+\+/, '')), autoIncrement: primary.startsWith('++'), rows: [], indexes: indexes.map((name) => ({ name, keyPath: keyPath(name), unique: false, multiEntry: false })) };
  });
}
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function validateOwner(ownerId: string, source: GenerationSnapshot): void {
  for (const table of source.tables) for (const row of table.rows) {
    const value = record(row.value);
    // Named old account stores predate a persisted owner marker. Their exact
    // verified account name is the ownership boundary; contradictory row facts
    // still fail closed instead of being relabelled or automatically uploaded.
    for (const key of ['ownerId', 'userId']) if (typeof value?.[key] === 'string' && value[key] !== ownerId) throw new Error('本地资料的账号归属不一致，原始资料已保留，未自动迁移');
  }
}
function targetSnapshot(source: GenerationSnapshot | null): GenerationSnapshot {
  if (source?.tables.some((table) => table.name === GENERATION_STORE)) throw new Error('原始数据库含未知升级标记，未自动迁移');
  const tables = structuredClone(source?.tables ?? []);
  for (const required of defaults()) {
    const prior = tables.find((table) => table.name === required.name);
    if (!prior) tables.push(required);
    else if (JSON.stringify(prior.keyPath) !== JSON.stringify(required.keyPath) || prior.autoIncrement !== required.autoIncrement) throw new Error('本地数据库结构不兼容，原始资料已保留，未自动迁移');
  }
  // The earlier goal migration remains explicit: original goals and all fields
  // survive, and old local goals never acquire account upload permission.
  if (source && !source.tables.some((table) => table.name === 'goalRecords')) {
    const goals = tables.find((table) => table.name === 'goals')!;
    const current = tables.find((table) => table.name === 'goalRecords')!;
    const settings = tables.find((table) => table.name === 'settings')!;
    for (const row of goals.rows) {
      const goal = record(row.value);
      if (!goal || typeof goal.id !== 'string') throw new Error('旧目标格式需要人工恢复，未自动迁移');
      current.rows.push({ key: row.key, value: { ...goal, syncScope: 'local' } });
      const key = `goal-source-snapshot:${goal.id}`;
      if (settings.rows.some((row) => row.key === key)) throw new Error('旧目标恢复记录冲突，未自动迁移');
      settings.rows.push({ key, value: { key, value: row.value } });
    }
  }
  return { version: 30, tables };
}

/** JSON-safe lossless recovery encoding; IDs, undefined, dates and binary values
 * are not silently converted by the download's JSON.stringify call. */
export async function encodeRecovery(value: unknown): Promise<unknown> {
  const seen = new Map<object, number>();
  const encode = async (item: unknown): Promise<unknown> => {
    if (item === undefined) return { $type: 'undefined' };
    if (typeof item === 'bigint') return { $type: 'bigint', value: String(item) };
    if (typeof item === 'number' && (!Number.isFinite(item) || Object.is(item, -0))) return { $type: 'number', value: Object.is(item, -0) ? '-0' : String(item) };
    if (item === null || typeof item !== 'object') return item;
    const previous = seen.get(item); if (previous !== undefined) return { $ref: previous };
    const id = seen.size; seen.set(item, id);
    if (item instanceof Error) return { $id: id, $type: 'Error', name: item.name, message: item.message, stack: item.stack, cause: await encode(item.cause), entries: await Promise.all(Object.keys(item).sort().map(async key => [key, await encode((item as unknown as Record<string, unknown>)[key])])) };
    if (typeof DOMException !== 'undefined' && item instanceof DOMException) return { $id: id, $type: 'DOMException', name: item.name, message: item.message, code: item.code };
    if (item instanceof Date) return { $id: id, $type: 'Date', value: await encode(item.getTime()) };
    if (item instanceof RegExp) return { $id: id, $type: 'RegExp', source: item.source, flags: item.flags };
    if (typeof File !== 'undefined' && item instanceof File) return { $id: id, $type: 'File', name: item.name, lastModified: item.lastModified, type: item.type, bytes: Array.from(new Uint8Array(await item.arrayBuffer())) };
    if (item instanceof Blob) return { $id: id, $type: 'Blob', type: item.type, bytes: Array.from(new Uint8Array(await item.arrayBuffer())) };
    if (item instanceof ArrayBuffer) return { $id: id, $type: 'ArrayBuffer', bytes: Array.from(new Uint8Array(item)) };
    if (ArrayBuffer.isView(item)) return { $id: id, $type: item.constructor.name, buffer: await encode(item.buffer), byteOffset: item.byteOffset, byteLength: item.byteLength }; 
    if (item instanceof Map) return { $id: id, $type: 'Map', entries: await Promise.all(Array.from(item.entries(), async ([key, value]) => [await encode(key), await encode(value)])) };
    if (item instanceof Set) return { $id: id, $type: 'Set', values: await Promise.all(Array.from(item.values(), encode)) };
    if (Array.isArray(item)) return { $id: id, $type: 'Array', length: item.length, entries: await Promise.all(Object.keys(item).map(async (key) => [key, await encode((item as unknown as Record<string, unknown>)[key])])) };
    return { $id: id, $type: 'Object', entries: await Promise.all(Object.keys(item).sort().map(async (key) => [key, await encode((item as Record<string, unknown>)[key])])) };
  };
  return encode(value);
}
async function equal(a: unknown, b: unknown): Promise<boolean> { return JSON.stringify(await encodeRecovery(a)) === JSON.stringify(await encodeRecovery(b)); }
function validateMarker(value: unknown, ownerId: string): GenerationMarker {
  const marker = value as GenerationMarker | undefined;
  if (!marker || marker.ownerId !== ownerId || marker.generation !== GENERATION_ID || marker.sourceName !== accountDatabaseName(ownerId, true) || !['copied', 'ready'].includes(marker.state)) throw new Error('本地升级记录的账号或版本不一致，未打开数据');
  return marker;
}
async function readMarker(database: IDBDatabase, ownerId: string): Promise<GenerationMarker | undefined> {
  if (!database.objectStoreNames.contains(GENERATION_STORE)) throw new Error('目标库缺少升级凭据，原库保留，未自动覆盖');
  const tx = database.transaction(GENERATION_STORE, 'readonly');
  const done = completed(tx);
  const value = await request(tx.objectStore(GENERATION_STORE).get(MARKER_KEY)); await done;
  return value === undefined ? undefined : validateMarker(value, ownerId);
}
async function createTarget(name: string, expected: GenerationSnapshot): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 30);
    opening.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) { opening.transaction!.abort(); return; }
      const database = opening.result;
      for (const table of expected.tables) {
        const store = database.createObjectStore(table.name, { keyPath: table.keyPath, autoIncrement: table.autoIncrement });
        for (const index of table.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
      }
      database.createObjectStore(GENERATION_STORE, { keyPath: 'key' });
    };
    opening.onsuccess = () => { opening.result.onversionchange = () => opening.result.close(); resolve(opening.result); };
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => reject(new Error('请关闭其他窗口后重试，本地原始资料仍保留'));
  });
}
function putRaw(store: IDBObjectStore, row: StoredRow): IDBRequest<IDBValidKey> { return store.keyPath === null ? store.put(row.value, row.key) : store.put(row.value); }

async function copy(database: IDBDatabase, marker: GenerationMarker, expected: GenerationSnapshot): Promise<void> {
  const tx = database.transaction(Array.from(database.objectStoreNames), 'readwrite'), done = completed(tx); void done.catch(() => undefined);
  try {
    const markers = tx.objectStore(GENERATION_STORE);
    const prior = await request(markers.get(MARKER_KEY));
    if (prior !== undefined) { validateMarker(prior, marker.ownerId); await done; return; }
    for (const name of Array.from(database.objectStoreNames)) if (await request(tx.objectStore(name).count()) !== 0) throw new Error('目标库已有未确认资料，未自动覆盖');
    for (const table of expected.tables) {
      const store = tx.objectStore(table.name);
      for (const row of table.rows) await request(putRaw(store, row));
      if (table.nextKey !== undefined && table.nextKey > 1) {
        // Raise the target generator to exactly the source high-water mark even
        // if the source's highest rows were already ACKed/deleted.
        const key = table.nextKey - 1, original = table.rows.find((row) => row.key === key);
        if (!original) {
          if (store.keyPath === null) await request(store.put({}, key));
          else {
            const value: Record<string, unknown> = {}, path = String(store.keyPath).split('.'); let cursor = value;
            for (const component of path.slice(0, -1)) { const next = {}; cursor[component] = next; cursor = next; }
            cursor[path.at(-1)!] = key; await request(store.put(value));
          }
          await request(store.delete(key));
        }
      }
    }
    await request(markers.put(marker)); await done;
  } catch (error) { try { tx.abort(); } catch { /* already aborted */ } await done.catch(() => undefined); throw error; }
}
async function verifyAndActivate(database: IDBDatabase, ownerId: string): Promise<void> {
  const current = await snapshot(database);
  const value = current.tables.find((table) => table.name === GENERATION_STORE)?.rows.find((row) => row.key === MARKER_KEY)?.value;
  const marker = validateMarker(value, ownerId);
  if (marker.state === 'ready') return;
  const actual = current.tables.filter((table) => table.name !== GENERATION_STORE);
  const expectedSnapshot = targetSnapshot(marker.source);
  for (const expected of expectedSnapshot.tables) {
    const found = actual.find((table) => table.name === expected.name);
    if (!found || !await equal(found.rows, [...expected.rows].sort((a, b) => indexedDB.cmp(a.key, b.key)))) throw new Error('数据库复制校验未通过，原始资料仍保留，未切换');
  }
  if (actual.length !== expectedSnapshot.tables.length) throw new Error('数据库表校验未通过，未切换');
  const tx = database.transaction(GENERATION_STORE, 'readwrite'), done = completed(tx); void done.catch(() => undefined);
  const latest = validateMarker(await request(tx.objectStore(GENERATION_STORE).get(MARKER_KEY)), ownerId);
  if (latest.state === 'copied') await request(tx.objectStore(GENERATION_STORE).put({ ...latest, state: 'ready' }));
  await done;
}

/** Call only with the owner just verified by /auth/me. No shared or guest source
 * can be selected, even by supplying a database name. Failure never opens empty. */
export async function prepareAccountGeneration(verifiedOwnerId: string): Promise<void> {
  const name = accountDatabaseName(verifiedOwnerId), sourceName = accountDatabaseName(verifiedOwnerId, true);
  let target = await existing(name);
  try {
    if (target) {
      const marker = await readMarker(target, verifiedOwnerId);
      if (marker) { await verifyAndActivate(target, verifiedOwnerId); return; }
      const partial = await snapshot(target);
      if (partial.tables.some((table) => table.rows.length)) throw new Error('目标库存在未确认资料，未自动覆盖');
    }
    const previous = await existing(sourceName);
    let source: GenerationSnapshot | null = null;
    try { if (previous) source = await snapshot(previous, true); } finally { previous?.close(); }
    if (source) validateOwner(verifiedOwnerId, source);
    const expected = targetSnapshot(source);
    if (!target) target = await createTarget(name, expected);
    const marker: GenerationMarker = { key: MARKER_KEY, ownerId: verifiedOwnerId, generation: GENERATION_ID, sourceName, state: 'copied', source };
    await copy(target, marker, expected);
    await verifyAndActivate(target, verifiedOwnerId);
  } finally { target?.close(); }
}

export async function generationRecovery(ownerId: string): Promise<{ status: GenerationRecovery; source: GenerationSnapshot | null; baseline: GenerationSnapshot | null }> {
  const target = await existing(accountDatabaseName(ownerId));
  if (!target) throw new Error('当前账号本地数据库不可用');
  let marker: GenerationMarker;
  try { marker = validateMarker(await readMarker(target, ownerId), ownerId); } finally { target.close(); }
  const previous = await existing(marker.sourceName);
  let source: GenerationSnapshot | null = null;
  try { if (previous) source = await snapshot(previous); } finally { previous?.close(); }
  const changedTables: string[] = [];
  const names = new Set([...(marker.source?.tables ?? []).map((table) => table.name), ...(source?.tables ?? []).map((table) => table.name)]);
  for (const name of names) {
    const before = marker.source?.tables.find((table) => table.name === name), after = source?.tables.find((table) => table.name === name);
    if (!await equal(before?.rows ?? [], after?.rows ?? [])) changedTables.push(name);
  }
  return { status: { sourcePresent: source !== null, changedTables, cleared: marker.cleared === true }, source, baseline: marker.source };
}
