import Dexie from 'dexie';
import { api, isLoggedIn } from './apiClient';
import { generateLocalId, type YoujiDatabase, type OutboxRecord, type SyncEntity } from '../db';
import { readLocalActor, assertLocalActor, assertLocalActorNow, captureLocalActor, type LocalActor } from './localActor';
import { toast } from './toastBus';
import { recordKey, isSequence } from './syncIdentity';
import { recordSyncPayload, isSafeFrozenPayload } from './recordPayloads';
import { goalSyncPayload } from './goalPayload';
import { sameGoalSource } from './goalSource';

const CURSOR_KEY = 'syncV2Cursor';
const BATCH_KEY = 'syncV2Batch';
const ENTITIES: SyncEntity[] = ['schedules', 'expenses', 'todos', 'habits', 'quickNotes', 'diaries', 'habitCheckins', 'goals'];
const DELETE_KEYS: Record<SyncEntity, string> = { goals: 'goalIds', schedules: 'scheduleIds', expenses: 'expenseIds', todos: 'todoIds', habits: 'habitIds', quickNotes: 'quickNoteIds', diaries: 'diaryIds', habitCheckins: 'habitCheckinIds' };
let flushing = false;
// A writer or timer can arrive while the last ACK is still unwinding.
// Remember that demand until finally releases the single-flight lock.
const requestedContexts = new Set<Promise<SyncContext | null>>();
let paused = false;
let generation = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const retryContexts = new Set<Promise<SyncContext | null>>();
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
interface Ack { features?: string[]; protocol: 2; mutationId: string; acknowledged: true; versions: Version[] }
interface FrozenBatch { mutationId: string; seqs: number[]; keys: string[]; payload: Record<string, unknown> }
export interface SyncConflict { event: SyncEvent; receivedAt: number }
const versionKey = (key: string) => `sync-version:${key}`;
const conflictKey = (key: string) => `sync-conflict:${key}`;
const tableName = (entity: SyncEntity) => entity === 'diaries' ? 'diary' : entity === 'goals' ? 'goalRecords' : entity;


interface SyncContext { actor: LocalActor; generation: number }
class SyncContextChanged extends Error {}
function syncAvailable(): boolean {
  if (paused || !isLoggedIn()) return false;
  try { return Boolean(captureLocalActor().owner); } catch { return false; }
}
function readSyncContext(): Promise<SyncContext | null> {
  if (!syncAvailable()) return Promise.resolve(null);
  const current = generation;
  return readLocalActor().then(actor => ({ actor, generation: current })).catch(() => null);
}
function assertSyncNow(context: SyncContext): void {
  if (paused || generation !== context.generation || !context.actor.owner) throw new SyncContextChanged('同步身份已变化，原修改保留');
  try { assertLocalActorNow(context.actor); } catch { throw new SyncContextChanged('同步身份已变化，原修改保留'); }
}
async function assertSync(context: SyncContext): Promise<void> {
  assertSyncNow(context);
  try { await assertLocalActor(context.actor); } catch { throw new SyncContextChanged('同步身份或本机资料已变化，原修改保留'); }
  assertSyncNow(context);
}
async function currentSync(context: SyncContext): Promise<boolean> {
  try { await assertSync(context); return true; } catch { return false; }
}
async function setting<T>(database: YoujiDatabase, key: string, fallback: T): Promise<T> {
  return (await database.settings.get(key))?.value as T ?? fallback;
}
/** Start the request beside the final authority check while the clear-epoch
 * read lock is held. Never await HTTP inside an IndexedDB transaction. */
async function sendFor<T>(context: SyncContext, send: () => Promise<T>): Promise<T> {
  let response: Promise<T> | undefined;
  await context.actor.database.transaction('r', context.actor.database.settings, async () => {
    await assertSync(context);
    assertSyncNow(context);
    response = Dexie.ignoreTransaction(send);
    // The real response remains awaited below; attach a rejection handler now
    // in case its delivery precedes completion of the local read transaction.
    void response.catch(() => undefined);
  });
  if (!response) throw new SyncContextChanged('同步身份已变化，尚未发送');
  return response;
}
/** A stale timer can arrive after a newer writer while a flight unwinds.
 * Preserve all demand until release; select a still-authorized context then,
 * rather than allowing the last (possibly old) request to erase the new one. */
async function currentDemand(candidates: Array<Promise<SyncContext | null>>): Promise<SyncContext | null> {
  for (const candidate of candidates.reverse()) {
    const context = await candidate;
    if (context && await currentSync(context)) return context;
  }
  return null;
}
function scheduleFlush(delay: number, context = readSyncContext()) {
  if (!syncAvailable()) return;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryContexts.clear(); retryContexts.add(context);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    const candidates = [...retryContexts]; retryContexts.clear();
    void flushContext(currentDemand(candidates));
  }, delay);
}

export async function enqueueSync(entity: SyncEntity, op: 'upsert' | 'delete', payload: unknown): Promise<void> {
  const actor = await readLocalActor(), database = actor.database;
  if (!actor.owner) throw new Error('账号尚未验证，未加入同步队列');
  await database.transaction('rw', database.outbox, database.settings, async () => {
    await assertLocalActor(actor);
    const row: OutboxRecord = { entity, op, payload: op === 'upsert' ? entity === 'goals' ? goalSyncPayload(payload) : entity === 'expenses' || entity === 'todos' ? recordSyncPayload(entity, payload) : payload : payload, queuedAt: Date.now(), status: 'pending', attempts: 0 };
    const key = recordKey(row);
    row.baseVersion = await setting<string>(database, versionKey(key), '0');
    row.predecessorSeq = (await database.outbox.orderBy('seq').toArray()).filter((previous) => recordKey(previous) === key).at(-1)?.seq;
    await database.outbox.add(row);
    await assertLocalActor(actor);
  });
  const context = Promise.resolve({ actor, generation });
  if (flushing) requestedContexts.add(context);
  else if (retryTimer === null) scheduleFlush(300, context);
  else retryContexts.add(context);
}

export function pauseSync(): void {
  paused = true;
  generation += 1;
  requestedContexts.clear();
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  retryContexts.clear();
}

async function prepareBatch(context: SyncContext): Promise<FrozenBatch | null> {
  const database = context.actor.database;
  return database.transaction('rw', database.outbox, database.settings, async () => {
    await assertSync(context);
    const frozen = await setting<FrozenBatch | null>(database, BATCH_KEY, null);
    if (frozen) {
      if (!isSafeFrozenPayload(frozen.payload)) {
        await database.settings.put({ key: 'syncV2LocalBlock', value: { reason: 'unreviewed-fields', at: Date.now() } });
        for (const seq of frozen.seqs) if (await database.outbox.get(seq)) await database.outbox.update(seq, { status: 'blocked', lastStatus: 400 });
        await assertSync(context); return null;
      }
      await database.settings.delete('syncV2LocalBlock');
      await assertSync(context); return frozen;
    }
    const ops = await database.outbox.orderBy('seq').toArray();
    const latest = new Map<string, OutboxRecord>();
    for (const row of ops) latest.set(recordKey(row), row);
    const mutationId = generateLocalId();
    const payload: Record<string, unknown> = { protocol: 2, mutationId };
    const keys: string[] = [];
    for (const [key, row] of latest) {
      if (keys.length >= 100) break;
      if (row.status === 'blocked') continue;
      if (!ENTITIES.includes(row.entity)) {
        await database.outbox.update(row.seq!, { status: 'blocked', lastStatus: 400 });
        continue;
      }
      const baseVersion = row.baseVersion ?? '0';
      const candidate = structuredClone(payload);
      if (row.op === 'upsert') {
        try {
          ((candidate[row.entity] ??= []) as unknown[]).push({ ...(row.entity === 'goals' ? goalSyncPayload(row.payload) : row.entity === 'expenses' || row.entity === 'todos' ? recordSyncPayload(row.entity, row.payload) : row.payload as object), baseVersion });
        } catch { await database.outbox.update(row.seq!, { status: 'blocked', lastStatus: 400 }); continue; }
      } else {
        const deletions = (candidate.deletions ??= {}) as Record<string, unknown[]>;
        (deletions[DELETE_KEYS[row.entity]] ??= []).push({ id: String(row.payload), baseVersion });
      }
      if (new TextEncoder().encode(JSON.stringify(candidate)).length > 64_000) {
        if (keys.length) break;
        await database.outbox.update(row.seq!, { status: 'blocked', lastStatus: 413 });
        continue;
      }
      if (row.entity === 'schedules') candidate.scheduleExceptionsVersion = 1;
      Object.assign(payload, candidate);
      keys.push(key);
    }
    if (!keys.length) { await assertSync(context); return null; }
    const selected = new Set(keys);
    const batch = { mutationId, keys, payload, seqs: ops.filter((row) => selected.has(recordKey(row))).map((row) => row.seq!) };
    await database.settings.put({ key: BATCH_KEY, value: batch });
    await assertSync(context); return batch;
  });
}

function validAck(response: Ack, batch: FrozenBatch): boolean {
  if (batch.payload.scheduleExceptionsVersion === 1 && !response.features?.includes('schedule-exceptions-v1')) return false;
  if (response.protocol !== 2 || response.acknowledged !== true || response.mutationId !== batch.mutationId || !Array.isArray(response.versions)) return false;
  const received = new Set(response.versions.filter((v) => ENTITIES.includes(v.entity) && isSequence(v.seq)).map((v) => `${v.entity}:${v.entityId}`));
  return batch.keys.every((key) => received.has(key));
}

export function flush(): Promise<boolean> { return flushContext(readSyncContext()); }
async function flushContext(requested: Promise<SyncContext | null>): Promise<boolean> {
  if (!syncAvailable()) return false;
  if (flushing) { requestedContexts.add(requested); return false; }
  flushing = true;
  let requestedDelay = 300;
  try {
    const context = await requested;
    if (!context || !await currentSync(context)) return false;
    const database = context.actor.database;
    const batch = await prepareBatch(context);
    if (!batch) { const empty = await database.outbox.count() === 0; return await currentSync(context) && empty; }
    try {
      if (batch.payload.scheduleExceptionsVersion === 1) {
        const capability = await sendFor(context, () => api.get<{ protocol: number; features: string[] }>('/sync/capabilities'));
        if (capability.protocol !== 2 || !capability.features?.includes('schedule-exceptions-v1')) throw new Error('服务器暂不支持单次日程调整，原稿保留在本机');
      }
      await assertSync(context);
      const response = await sendFor(context, () => api.post<Ack>('/sync/push', batch.payload, 30_000));
      if (!validAck(response, batch)) throw new Error('同步回执不完整，修改已保留');
      if (!await currentSync(context)) { requestedDelay = 1100; return false; }
      await database.transaction('rw', database.outbox, database.settings, async () => {
        await assertSync(context);
        const frozen = await setting<FrozenBatch | null>(database, BATCH_KEY, null);
        if (frozen?.mutationId !== batch.mutationId) throw new SyncContextChanged('同步批次已变化，未消费旧回执');
        for (const version of response.versions) {
          await database.settings.put({ key: versionKey(`${version.entity}:${version.entityId}`), value: version.seq });
          const conflict = await setting<SyncConflict | null>(database, conflictKey(`${version.entity}:${version.entityId}`), null);
          if (conflict && BigInt(conflict.event.seq) <= BigInt(version.seq)) await database.settings.delete(conflictKey(`${version.entity}:${version.entityId}`));
        }
        const successors = (await database.outbox.orderBy('seq').toArray()).filter((row) => !batch.seqs.includes(row.seq!));
        const proven = new Set(batch.seqs);
        for (const row of successors) {
          if (row.predecessorSeq === undefined || !proven.has(row.predecessorSeq)) continue;
          const version = response.versions.find((entry) => `${entry.entity}:${entry.entityId}` === recordKey(row));
          if (version) { await database.outbox.update(row.seq!, { baseVersion: version.seq }); proven.add(row.seq!); }
        }
        await database.outbox.bulkDelete(batch.seqs);
        await database.settings.delete(BATCH_KEY);
        await database.settings.put({ key: 'lastPushAt', value: new Date().toISOString() });
        await assertSync(context);
      });
      failures = 0;
      const hasPending = await database.outbox.count() > 0;
      const empty = await database.outbox.count() === 0;
      const current = await currentSync(context);
      // Arm only after the final awaited check: a timer firing at this boundary
      // must see the single-flight lock released, not become a lost busy wake.
      if (current && hasPending) scheduleFlush(1100, Promise.resolve(context));
      return current && empty;
    } catch (error) {
      if (error instanceof SyncContextChanged || !await currentSync(context)) return false;
      const failure = error as { status?: number; code?: string; conflict?: { entity: SyncEntity; entityId: string } };
      const failedKey = failure.conflict ? `${failure.conflict.entity}:${failure.conflict.entityId}` : null;
      const blocked = failure.status !== undefined && failure.status >= 400 && failure.status < 500 && failure.status !== 401 && failure.status !== 429;
      await database.transaction('rw', database.outbox, database.settings, async () => {
        await assertSync(context);
        const frozen = await setting<FrozenBatch | null>(database, BATCH_KEY, null);
        if (frozen?.mutationId !== batch.mutationId) throw new SyncContextChanged('同步批次已变化，未消费旧回执');
        for (const seq of batch.seqs) {
          const row = await database.outbox.get(seq);
          if (row) await database.outbox.update(seq, { status: blocked && (!failedKey || recordKey(row) === failedKey) ? 'blocked' : 'pending', lastStatus: failure.status, attempts: (row.attempts ?? 0) + 1, lastAttemptAt: Date.now() });
        }
        // Known protocol rejection is an atomic rollback. An unknown response,
        // timeout or lost connection keeps the exact frozen batch for replay.
        if (blocked && failure.code) await database.settings.delete(BATCH_KEY);
        await assertSync(context);
      });
      if (!await currentSync(context)) return false;
      if (blocked) { toast.warning('部分修改需要检查，原稿已保留。请在设置中处理或导出'); if (failedKey) scheduleFlush(1100, Promise.resolve(context)); }
      else { failures += 1; scheduleFlush(Math.min(60_000, (failure.status === 429 ? 5000 : 2000) * 2 ** Math.min(failures, 5)), Promise.resolve(context)); }
      return false;
    }
  } catch { return false; } finally {
    flushing = false;
    const requested = [...requestedContexts];
    requestedContexts.clear();
    // Keep an existing retry/backoff deadline; do not turn a server rejection
    // into a tight retry loop. Pause invalidates requests from the old session.
    if (requested.length) {
      if (retryTimer === null) scheduleFlush(requestedDelay, currentDemand(requested));
      else for (const context of requested) retryContexts.add(context);
    }
  }
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

async function applyEvent(database: YoujiDatabase, event: SyncEvent) {
  const table = database.table(tableName(event.entity));
  if (event.operation === 'delete') {
    await table.delete(event.entityId);
    if (event.entity === 'habits') await database.habitCheckins.where('habitId').equals(event.entityId).delete();
  } else {
    if (!event.data || typeof event.data !== 'object') throw new Error('同步记录不完整，未推进游标');
    const row = localRow(event);
    // Server diary payloads do not carry device provenance. Preserve the local
    // source links on same-record pulls instead of silently erasing them.
    if (event.entity === 'diaries') { const previous = await table.get(event.entityId); row.quickNoteIds = Array.isArray(previous?.quickNoteIds) ? previous.quickNoteIds : []; }
    await table.put(row);
  }
  await database.settings.put({ key: versionKey(`${event.entity}:${event.entityId}`), value: event.seq });
}

async function pullPages(context: SyncContext): Promise<void> {
  if (!await currentSync(context)) return;
  const database = context.actor.database;
  let cursor = await setting<string>(database, CURSOR_KEY, '0');
  for (;;) {
    const page = await sendFor(context, () => api.get<PullPage>(`/sync/pull?protocol=2&features=goals-v1&cursor=${encodeURIComponent(cursor)}&limit=500`, 30_000));
    if (!await currentSync(context)) return;
    if (page.protocol !== 2 || !Array.isArray(page.features) || !page.features.includes('goals-v1') || !Array.isArray(page.events) || !isSequence(page.nextCursor) || typeof page.hasMore !== 'boolean') throw new Error('同步协议不兼容，保留本地修改');
    let previous = BigInt(cursor);
    for (const event of page.events) {
      if (!ENTITIES.includes(event.entity) || !isSequence(event.seq) || BigInt(event.seq) <= previous || typeof event.entityId !== 'string' || !['upsert', 'delete'].includes(event.operation)) throw new Error('同步顺序无效，未推进游标');
      previous = BigInt(event.seq);
    }
    if (page.nextCursor !== previous.toString() || (page.hasMore && page.events.length === 0)) throw new Error('同步游标无效，未推进游标');
    await database.transaction('rw', database.tables, async () => {
      await assertSync(context);
      const pending = new Set((await database.outbox.toArray()).map(recordKey));
      for (const event of page.events) {
        const key = `${event.entity}:${event.entityId}`;
        const known = await setting<string>(database, versionKey(key), '0');
        if (BigInt(event.seq) <= BigInt(known)) continue;
        const localOnlyGoal = event.entity === 'goals' && (await database.goalRecords.get(event.entityId));
        if ((localOnlyGoal && localOnlyGoal.syncScope !== 'account') || pending.has(key) || (event.entity === 'habits' && event.operation === 'delete' && [...pending].some((id) => id.startsWith(`habitCheckins:${event.entityId}|`)))) {
          const previous = await setting<SyncConflict | null>(database, conflictKey(key), null);
          if (!previous || BigInt(previous.event.seq) < BigInt(event.seq)) await database.settings.put({ key: conflictKey(key), value: { event, receivedAt: Date.now() } satisfies SyncConflict });
          continue;
        }
        await applyEvent(database, event);
      }
      const committed = await setting<string>(database, CURSOR_KEY, '0');
      await database.settings.put({ key: CURSOR_KEY, value: BigInt(committed) > BigInt(page.nextCursor) ? committed : page.nextCursor });
      await database.settings.put({ key: 'lastPullAt', value: new Date().toISOString() });
      await assertSync(context);
    });
    await assertSync(context);
    cursor = page.nextCursor;
    if (!page.hasMore) { window.dispatchEvent(new CustomEvent('youtrace:data-updated')); return; }
  }
}

let pullingContext: SyncContext | null = null;
function sameContext(a: SyncContext, b: SyncContext): boolean {
  return a.generation === b.generation && a.actor.database === b.actor.database && a.actor.owner === b.actor.owner && a.actor.session === b.actor.session && a.actor.sessionGeneration === b.actor.sessionGeneration && a.actor.epoch === b.actor.epoch;
}
async function pullContext(context: SyncContext): Promise<void> {
  if (!await currentSync(context)) return;
  if (pulling) {
    if (pullingContext && sameContext(pullingContext, context)) return pulling;
    await pulling.catch(() => undefined);
    return pullContext(context);
  }
  pullingContext = context;
  pulling = pullPages(context).catch(async error => { if (!(error instanceof SyncContextChanged) && await currentSync(context)) throw error; }).finally(() => { pulling = null; pullingContext = null; });
  return pulling;
}
export async function pullServerChanges(): Promise<void> {
  const context = await readSyncContext();
  if (context) await pullContext(context);
}

export function resumeSync(): void { paused = false; scheduleFlush(500); }

export async function retryBlockedSync(): Promise<void> {
  const requestedGeneration = generation;
  const actor = await readLocalActor(), database = actor.database;
  if (!actor.owner) throw new Error('账号尚未验证');
  await database.transaction('rw', database.outbox, database.settings, async () => {
    await assertLocalActor(actor);
    await database.outbox.toCollection().modify({ status: 'pending' });
    await assertLocalActor(actor);
    if (requestedGeneration !== generation) throw new SyncContextChanged('同步已暂停，未改动重试状态');
  });
  await assertLocalActor(actor);
  if (requestedGeneration !== generation) throw new SyncContextChanged('同步已暂停，尚未重试');
  paused = false;
  await flushContext(Promise.resolve({ actor, generation }));
}

export interface ConflictSnapshot { event: SyncEvent; local: unknown; pendingSeqs: number[] }

function relatedOperation(record: OutboxRecord, event: SyncEvent): boolean {
  return recordKey(record) === `${event.entity}:${event.entityId}` || (event.entity === 'habits' && event.operation === 'delete' && recordKey(record).startsWith(`habitCheckins:${event.entityId}|`));
}

const conflictActors = new WeakMap<ConflictSnapshot, LocalActor>();
export async function readConflictSnapshot(key: string): Promise<ConflictSnapshot | null> {
  const actor = await readLocalActor(), database = actor.database;
  const snapshot = await database.transaction('r', database.tables, async () => {
    await assertLocalActor(actor);
    const conflict = await setting<SyncConflict | null>(database, key, null);
    if (!key.startsWith('sync-conflict:') || !conflict) return null;
    const result = { event: conflict.event, local: await database.table(tableName(conflict.event.entity)).get(conflict.event.entityId), pendingSeqs: (await database.outbox.toArray()).filter((row) => relatedOperation(row, conflict.event)).map((row) => row.seq!) };
    await assertLocalActor(actor);
    return result;
  });
  return database.transaction('r', database.settings, async () => {
    await assertLocalActor(actor);
    if (snapshot) conflictActors.set(snapshot, actor);
    return snapshot;
  });
}

export async function acceptRemoteConflict(key: string, expected: ConflictSnapshot): Promise<void> {
  const readingActor = readLocalActor(), viewedActor = conflictActors.get(expected);
  const frozen = structuredClone(expected);
  const actor = await readingActor, database = actor.database;
  if (viewedActor) await assertLocalActor(viewedActor);
  if (flushing || await setting(database, BATCH_KEY, null)) throw new Error('还有结果未确认的同步请求，请先重试同步');
  await database.transaction('rw', database.tables, async () => {
    await assertLocalActor(actor);
    if (await setting(database, BATCH_KEY, null)) throw new Error('同步请求结果尚未确认，请先重试');
    const conflict = await setting<SyncConflict | null>(database, key, null);
    if (!key.startsWith('sync-conflict:') || !conflict) throw new Error('冲突已变化，请刷新');
    const snapshot = await readConflictSnapshot(key);
    if (!snapshot || !await sameGoalSource(snapshot, frozen)) throw new Error('比较中的版本刚刚变化，尚未处理。请重新打开比较，核对最新内容');
    const recordId = `${conflict.event.entity}:${conflict.event.entityId}`;
    const currentVersion = await setting<string>(database, versionKey(recordId), '0');
    if (BigInt(currentVersion) >= BigInt(conflict.event.seq)) { await database.settings.delete(key); await assertLocalActor(actor); return; }
    const ops = (await database.outbox.toArray()).filter((row) => relatedOperation(row, conflict.event));
    const local = await database.table(tableName(conflict.event.entity)).get(conflict.event.entityId);
    // A recovery copy survives resolution and is included in the local export.
    await database.settings.put({ key: `sync-recovery:${generateLocalId()}`, value: { local, mutations: ops, remote: conflict, resolvedAt: Date.now() } });
    await applyEvent(database, conflict.event);
    await database.outbox.bulkDelete(ops.map((row) => row.seq!));
    await database.settings.delete(key);
    if (viewedActor) await assertLocalActor(viewedActor);
    await assertLocalActor(actor);
  });
}

export async function bootstrapSync(): Promise<{ offline: boolean }> {
  if (!onlineListenerAttached && typeof window !== 'undefined') {
    onlineListenerAttached = true;
    window.addEventListener('online', () => { scheduleFlush(500); void pullServerChanges().catch(() => undefined); });
  }
  if (!isLoggedIn()) return { offline: false };
  paused = false;
  try {
    const context = await readSyncContext();
    if (!context) return { offline: true };
    await flushContext(Promise.resolve(context));
    await assertSync(context);
    await pullContext(context);
    return { offline: false };
  }
  catch { toast.warning('同步暂未完成，展示当前账号本地记录'); return { offline: true }; }
}

export async function resetSyncCursor(): Promise<void> {
  const actor = await readLocalActor(), database = actor.database;
  await database.transaction('rw', database.settings, async () => {
    await assertLocalActor(actor);
    await database.settings.put({ key: CURSOR_KEY, value: '0' });
    await assertLocalActor(actor);
  });
}
export async function clearPendingSync(): Promise<void> { throw new Error('未确认修改不能自动清除，请先导出并处理'); }
