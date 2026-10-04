import { api, isLoggedIn } from './apiClient';
import { db, generateLocalId, getSetting, LOCAL_DATA_EPOCH_KEY, type OutboxRecord, type SyncEntity } from '../db';
import { toast } from './toastBus';
import { recordSyncPayload, isSafeFrozenPayload } from './recordPayloads';
import { goalSyncPayload } from './goalPayload';

const CURSOR_KEY = 'syncV2Cursor';
const BATCH_KEY = 'syncV2Batch';
const ENTITIES: SyncEntity[] = ['schedules', 'expenses', 'todos', 'habits', 'quickNotes', 'diaries', 'habitCheckins', 'goals'];
const DELETE_KEYS: Record<SyncEntity, string> = { goals: 'goalIds', schedules: 'scheduleIds', expenses: 'expenseIds', todos: 'todoIds', habits: 'habitIds', quickNotes: 'quickNoteIds', diaries: 'diaryIds', habitCheckins: 'habitCheckinIds' };
let flushing = false;
let paused = false;
let generation = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let onlineListenerAttached = false;
let pulling: Promise<void> | null = null;

export interface SyncEvent {
  seq: string;
  entity: SyncEntity;
  entityId: string;
  operation: 'upsert' | 'delete';
  data: Record<string, unknown> | null;
}
interface PullPage { protocol: 2; features: string[]; events: SyncEvent[]; nextCursor: string; hasMore: boolean }
interface Version { entity: SyncEntity; entityId: string; seq: string }
interface Ack { protocol: 2; mutationId: string; acknowledged: true; versions: Version[] }
interface FrozenBatch { mutationId: string; seqs: number[]; keys: string[]; payload: Record<string, unknown> }
export interface SyncConflict { event: SyncEvent; receivedAt: number }
const versionKey = (key: string) => `sync-version:${key}`;
const conflictKey = (key: string) => `sync-conflict:${key}`;
const tableName = (entity: SyncEntity) => entity === 'diaries' ? 'diary' : entity === 'goals' ? 'goalRecords' : entity;
const isSequence = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value);

function recordKey(record: OutboxRecord): string {
  if (record.op === 'delete') return `${record.entity}:${String(record.payload)}`;
  const row = record.payload as { id?: string; habitId?: string; date?: string };
  return `${record.entity}:${record.entity === 'habitCheckins' ? `${row.habitId}|${row.date}` : row.id}`;
}

function scheduleFlush(delay: number) {
  if (paused || !isLoggedIn()) return;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; void flush(); }, delay);
}

export async function enqueueSync(entity: SyncEntity, op: 'upsert' | 'delete', payload: unknown): Promise<void> {
  const row: OutboxRecord = { entity, op, payload: op === 'upsert' ? entity === 'goals' ? goalSyncPayload(payload) : entity === 'expenses' || entity === 'todos' ? recordSyncPayload(entity, payload) : payload : payload, queuedAt: Date.now(), status: 'pending', attempts: 0 };
  const key = recordKey(row);
  row.baseVersion = await getSetting<string>(versionKey(key), '0');
  row.predecessorSeq = (await db.outbox.orderBy('seq').toArray()).filter((previous) => recordKey(previous) === key).at(-1)?.seq;
  await db.outbox.add(row);
  if (retryTimer === null && !flushing) scheduleFlush(300);
}

export function pauseSync(): void {
  paused = true;
  generation += 1;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

async function prepareBatch(): Promise<FrozenBatch | null> {
  return db.transaction('rw', db.outbox, db.settings, async () => {
    const frozen = await getSetting<FrozenBatch | null>(BATCH_KEY, null);
    if (frozen) {
      if (!isSafeFrozenPayload(frozen.payload)) {
        await db.settings.put({ key: 'syncV2LocalBlock', value: { reason: 'unreviewed-fields', at: Date.now() } });
        for (const seq of frozen.seqs) if (await db.outbox.get(seq)) await db.outbox.update(seq, { status: 'blocked', lastStatus: 400 });
        return null;
      }
      await db.settings.delete('syncV2LocalBlock');
      return frozen;
    }
    const ops = await db.outbox.orderBy('seq').toArray();
    const latest = new Map<string, OutboxRecord>();
    for (const row of ops) latest.set(recordKey(row), row);
    const mutationId = generateLocalId();
    const payload: Record<string, unknown> = { protocol: 2, mutationId };
    const keys: string[] = [];
    for (const [key, row] of latest) {
      if (keys.length >= 100) break;
      if (row.status === 'blocked') continue;
      if (!ENTITIES.includes(row.entity)) {
        await db.outbox.update(row.seq!, { status: 'blocked', lastStatus: 400 });
        continue;
      }
      const baseVersion = row.baseVersion ?? '0';
      const candidate = structuredClone(payload);
      if (row.op === 'upsert') {
        try {
          ((candidate[row.entity] ??= []) as unknown[]).push({ ...(row.entity === 'goals' ? goalSyncPayload(row.payload) : row.entity === 'expenses' || row.entity === 'todos' ? recordSyncPayload(row.entity, row.payload) : row.payload as object), baseVersion });
        } catch { await db.outbox.update(row.seq!, { status: 'blocked', lastStatus: 400 }); continue; }
      } else {
        const deletions = (candidate.deletions ??= {}) as Record<string, unknown[]>;
        (deletions[DELETE_KEYS[row.entity]] ??= []).push({ id: String(row.payload), baseVersion });
      }
      if (new TextEncoder().encode(JSON.stringify(candidate)).length > 64_000) {
        if (keys.length) break;
        await db.outbox.update(row.seq!, { status: 'blocked', lastStatus: 413 });
        continue;
      }
      Object.assign(payload, candidate);
      keys.push(key);
    }
    if (!keys.length) return null;
    const selected = new Set(keys);
    const batch = { mutationId, keys, payload, seqs: ops.filter((row) => selected.has(recordKey(row))).map((row) => row.seq!) };
    await db.settings.put({ key: BATCH_KEY, value: batch });
    return batch;
  });
}

function validAck(response: Ack, batch: FrozenBatch): boolean {
  if (response.protocol !== 2 || response.acknowledged !== true || response.mutationId !== batch.mutationId || !Array.isArray(response.versions)) return false;
  const received = new Set(response.versions.filter((v) => ENTITIES.includes(v.entity) && isSequence(v.seq)).map((v) => `${v.entity}:${v.entityId}`));
  return batch.keys.every((key) => received.has(key));
}

export async function flush(): Promise<boolean> {
  if (flushing || paused || !isLoggedIn()) return false;
  flushing = true;
  const epoch = generation;
  try {
    const batch = await prepareBatch();
    if (!batch) return await db.outbox.count() === 0;
    try {
      const response = await api.post<Ack>('/sync/push', batch.payload, 30_000);
      if (!validAck(response, batch)) throw new Error('同步回执不完整，修改已保留');
      if (paused || !isLoggedIn()) return false;
      await db.transaction('rw', db.outbox, db.settings, async () => {
        const frozen = await getSetting<FrozenBatch | null>(BATCH_KEY, null);
        if (epoch !== generation || paused || frozen?.mutationId !== batch.mutationId) return;
        for (const version of response.versions) {
          await db.settings.put({ key: versionKey(`${version.entity}:${version.entityId}`), value: version.seq });
          const conflict = await getSetting<SyncConflict | null>(conflictKey(`${version.entity}:${version.entityId}`), null);
          if (conflict && BigInt(conflict.event.seq) <= BigInt(version.seq)) await db.settings.delete(conflictKey(`${version.entity}:${version.entityId}`));
        }
        const successors = (await db.outbox.orderBy('seq').toArray()).filter((row) => !batch.seqs.includes(row.seq!));
        const proven = new Set(batch.seqs);
        for (const row of successors) {
          if (row.predecessorSeq === undefined || !proven.has(row.predecessorSeq)) continue;
          const version = response.versions.find((entry) => `${entry.entity}:${entry.entityId}` === recordKey(row));
          if (version) { await db.outbox.update(row.seq!, { baseVersion: version.seq }); proven.add(row.seq!); }
        }
        await db.outbox.bulkDelete(batch.seqs);
        await db.settings.delete(BATCH_KEY);
        await db.settings.put({ key: 'lastPushAt', value: new Date().toISOString() });
      });
      failures = 0;
      if (await db.outbox.count() > 0) scheduleFlush(1100);
      return await db.outbox.count() === 0;
    } catch (error) {
      if (paused || !isLoggedIn()) return false;
      const failure = error as { status?: number; code?: string; conflict?: { entity: SyncEntity; entityId: string } };
      const failedKey = failure.conflict ? `${failure.conflict.entity}:${failure.conflict.entityId}` : null;
      const blocked = failure.status !== undefined && failure.status >= 400 && failure.status < 500 && failure.status !== 401 && failure.status !== 429;
      await db.transaction('rw', db.outbox, db.settings, async () => {
        const frozen = await getSetting<FrozenBatch | null>(BATCH_KEY, null);
        if (epoch !== generation || paused || frozen?.mutationId !== batch.mutationId) return;
        for (const seq of batch.seqs) {
          const row = await db.outbox.get(seq);
          if (row) await db.outbox.update(seq, { status: blocked && (!failedKey || recordKey(row) === failedKey) ? 'blocked' : 'pending', lastStatus: failure.status, attempts: (row.attempts ?? 0) + 1, lastAttemptAt: Date.now() });
        }
        // Known protocol rejection is an atomic rollback. An unknown response,
        // timeout or lost connection keeps the exact frozen batch for replay.
        if (blocked && failure.code) await db.settings.delete(BATCH_KEY);
      });
      if (blocked) { toast.warning('部分修改需要检查，原稿已保留。请在设置中处理或导出'); if (failedKey) scheduleFlush(1100); }
      else { failures += 1; scheduleFlush(Math.min(60_000, (failure.status === 429 ? 5000 : 2000) * 2 ** Math.min(failures, 5))); }
      return false;
    }
  } finally { flushing = false; }
}

function millis(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function localRow(event: SyncEvent): Record<string, unknown> {
  const row: Record<string, unknown> = { ...event.data, id: event.entityId };
  delete row.userId;
  for (const field of ['createdAt', 'updatedAt']) if (field in row) row[field] = millis(row[field]);
  if (event.entity === 'goals') row.syncScope = 'account';
  if (event.entity === 'todos') { if (!row.dueDate) row.dueDate = undefined; row.completedAt = row.completedAt == null ? null : millis(row.completedAt, NaN); if (!Number.isFinite(row.completedAt)) row.completedAt = null; }
  if (event.entity === 'habitCheckins') { row.confirmed = row.confirmed ?? true; row.aiReason = row.aiReason ?? undefined; }
  if (event.entity === 'diaries') { row.quickNoteIds = []; row.moodScore = row.moodScore ?? null; row.aiInsight = row.aiInsight ?? undefined; }
  if (event.entity === 'quickNotes') {
    const parsed = (row.parsed && typeof row.parsed === 'object' ? row.parsed : {}) as Record<string, unknown>;
    return {
      id: event.entityId, rawInput: row.content, confirmed: row.confirmed === true, captureContext: parsed.captureContext, createdAt: typeof row.timestamp === 'string' && /^\d+$/.test(row.timestamp) ? Number(row.timestamp) : millis(row.timestamp),
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [], diary: typeof parsed.diary === 'string' ? parsed.diary : null,
      mood: parsed.mood ?? null, moodScore: parsed.moodScore ?? null, habits: Array.isArray(parsed.habits) ? parsed.habits : [],
      todos: Array.isArray(parsed.todos) ? parsed.todos.map((item: unknown, index: number) => typeof item === 'string' ? { id: `todo-${index}`, text: item, confirmed: row.confirmed === true } : item) : [],
      legacyParsed: parsed.legacyRaw,
    };
  }
  return row;
}

async function applyEvent(event: SyncEvent) {
  const table = db.table(tableName(event.entity));
  if (event.operation === 'delete') {
    await table.delete(event.entityId);
    if (event.entity === 'habits') await db.habitCheckins.where('habitId').equals(event.entityId).delete();
  } else {
    if (!event.data || typeof event.data !== 'object') throw new Error('同步记录不完整，未推进游标');
    const row = localRow(event);
    // Server diary payloads do not carry device provenance. Preserve the local
    // source links on same-record pulls instead of silently erasing them.
    if (event.entity === 'diaries') { const previous = await table.get(event.entityId); row.quickNoteIds = Array.isArray(previous?.quickNoteIds) ? previous.quickNoteIds : []; }
    await table.put(row);
  }
  await db.settings.put({ key: versionKey(`${event.entity}:${event.entityId}`), value: event.seq });
}

async function pullPages(): Promise<void> {
  if (paused || !isLoggedIn()) return;
  const epoch = generation;
  const dataEpoch = await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial');
  let cursor = await getSetting<string>(CURSOR_KEY, '0');
  for (;;) {
    const page = await api.get<PullPage>(`/sync/pull?protocol=2&features=goals-v1&cursor=${encodeURIComponent(cursor)}&limit=500`, 30_000);
    if (paused || !isLoggedIn()) return;
    if (page.protocol !== 2 || !Array.isArray(page.features) || !page.features.includes('goals-v1') || !Array.isArray(page.events) || !isSequence(page.nextCursor) || typeof page.hasMore !== 'boolean') throw new Error('同步协议不兼容，保留本地修改');
    let previous = BigInt(cursor);
    for (const event of page.events) {
      if (!ENTITIES.includes(event.entity) || !isSequence(event.seq) || BigInt(event.seq) <= previous || typeof event.entityId !== 'string' || !['upsert', 'delete'].includes(event.operation)) throw new Error('同步顺序无效，未推进游标');
      previous = BigInt(event.seq);
    }
    if (page.nextCursor !== previous.toString() || (page.hasMore && page.events.length === 0)) throw new Error('同步游标无效，未推进游标');
    await db.transaction('rw', db.tables, async () => {
      if (paused || epoch !== generation || await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== dataEpoch) return;
      const pending = new Set((await db.outbox.toArray()).map(recordKey));
      for (const event of page.events) {
        const key = `${event.entity}:${event.entityId}`;
        const known = await getSetting<string>(versionKey(key), '0');
        if (BigInt(event.seq) <= BigInt(known)) continue;
        const localOnlyGoal = event.entity === 'goals' && (await db.goalRecords.get(event.entityId));
        if ((localOnlyGoal && localOnlyGoal.syncScope !== 'account') || pending.has(key) || (event.entity === 'habits' && event.operation === 'delete' && [...pending].some((id) => id.startsWith(`habitCheckins:${event.entityId}|`)))) {
          const previous = await getSetting<SyncConflict | null>(conflictKey(key), null);
          if (!previous || BigInt(previous.event.seq) < BigInt(event.seq)) await db.settings.put({ key: conflictKey(key), value: { event, receivedAt: Date.now() } satisfies SyncConflict });
          continue;
        }
        await applyEvent(event);
      }
      const committed = await getSetting<string>(CURSOR_KEY, '0');
      await db.settings.put({ key: CURSOR_KEY, value: BigInt(committed) > BigInt(page.nextCursor) ? committed : page.nextCursor });
      await db.settings.put({ key: 'lastPullAt', value: new Date().toISOString() });
    });
    if (paused || epoch !== generation || await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== dataEpoch) return;
    cursor = page.nextCursor;
    if (!page.hasMore) { window.dispatchEvent(new CustomEvent('youtrace:data-updated')); return; }
  }
}

export function pullServerChanges(): Promise<void> {
  if (!pulling) pulling = pullPages().finally(() => { pulling = null; });
  return pulling;
}

export function resumeSync(): void { paused = false; scheduleFlush(500); }

export async function retryBlockedSync(): Promise<void> {
  await db.outbox.toCollection().modify({ status: 'pending' });
  paused = false;
  await flush();
}

export interface ConflictSnapshot { event: SyncEvent; local: unknown; pendingSeqs: number[] }

function relatedOperation(record: OutboxRecord, event: SyncEvent): boolean {
  return recordKey(record) === `${event.entity}:${event.entityId}` || (event.entity === 'habits' && event.operation === 'delete' && recordKey(record).startsWith(`habitCheckins:${event.entityId}|`));
}

export async function readConflictSnapshot(key: string): Promise<ConflictSnapshot | null> {
  const database = db;
  return database.transaction('r', database.tables, async () => {
    const conflict = await getSetting<SyncConflict | null>(key, null);
    if (!key.startsWith('sync-conflict:') || !conflict) return null;
    return { event: conflict.event, local: await database.table(tableName(conflict.event.entity)).get(conflict.event.entityId), pendingSeqs: (await database.outbox.toArray()).filter((row) => relatedOperation(row, conflict.event)).map((row) => row.seq!) };
  });
}

export async function acceptRemoteConflict(key: string, expected: ConflictSnapshot): Promise<void> {
  if (flushing || await getSetting(BATCH_KEY, null)) throw new Error('还有结果未确认的同步请求，请先重试同步');
  await db.transaction('rw', db.tables, async () => {
    if (await getSetting(BATCH_KEY, null)) throw new Error('同步请求结果尚未确认，请先重试');
    const conflict = await getSetting<SyncConflict | null>(key, null);
    if (!key.startsWith('sync-conflict:') || !conflict) throw new Error('冲突已变化，请刷新');
    const snapshot = await readConflictSnapshot(key);
    if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(expected)) throw new Error('比较中的版本刚刚变化，尚未处理。请重新打开比较，核对最新内容');
    const recordId = `${conflict.event.entity}:${conflict.event.entityId}`;
    const currentVersion = await getSetting<string>(versionKey(recordId), '0');
    if (BigInt(currentVersion) >= BigInt(conflict.event.seq)) { await db.settings.delete(key); return; }
    const ops = (await db.outbox.toArray()).filter((row) => relatedOperation(row, conflict.event));
    const local = await db.table(tableName(conflict.event.entity)).get(conflict.event.entityId);
    // A recovery copy survives resolution and is included in the local export.
    await db.settings.put({ key: `sync-recovery:${generateLocalId()}`, value: { local, mutations: ops, remote: conflict, resolvedAt: Date.now() } });
    await applyEvent(conflict.event);
    await db.outbox.bulkDelete(ops.map((row) => row.seq!));
    await db.settings.delete(key);
  });
}

export async function bootstrapSync(): Promise<{ offline: boolean }> {
  if (!onlineListenerAttached && typeof window !== 'undefined') {
    onlineListenerAttached = true;
    window.addEventListener('online', () => { scheduleFlush(500); void pullServerChanges().catch(() => undefined); });
  }
  if (!isLoggedIn()) return { offline: false };
  paused = false;
  try { await flush(); await pullServerChanges(); return { offline: false }; }
  catch { toast.warning('同步暂未完成，展示当前账号本地记录'); return { offline: true }; }
}

export async function resetSyncCursor(): Promise<void> { await db.settings.put({ key: CURSOR_KEY, value: '0' }); }
export async function clearPendingSync(): Promise<void> { throw new Error('未确认修改不能自动清除，请先导出并处理'); }
