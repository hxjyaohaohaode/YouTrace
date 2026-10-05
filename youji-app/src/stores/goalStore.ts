import Dexie, { type ObservabilitySet } from 'dexie';
import { create } from 'zustand';
import { generateLocalId, LOCAL_DATA_EPOCH_KEY, type GoalRecord, type OutboxRecord, type SettingRecord } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { readLocalActor, captureLocalActor, assertLocalActor, assertLocalActorNow, type LocalActor } from '../services/localActor';
import { sameGoalSource } from '../services/goalSource';
import { isSequence } from '../services/syncIdentity';
import { recordDiagnostic } from '../services/diagnostics';
import { UNAUTHORIZED_EVENT } from '../services/apiClient';
import { enqueueSync, flush } from '../services/syncEngine';

export type GoalLevel = 'short' | 'medium' | 'long';
export type GoalPriority = 'low' | 'medium' | 'high';
export type GoalView = GoalRecord;
export type GoalStatus = '仅本机' | '待同步' | '需要比较版本' | '需要检查' | '已同步';
export interface GoalWriteResult {
  committed: true;
  alreadyCommitted: boolean;
  /** A commit to the captured context does not promise visibility after logout/clear. */
  view: 'current' | 'refreshing' | 'refresh-needed' | 'context-changed';
  /** A later successful publication at/after this revision resolves the notice. */
  refreshRevision: number;
}
export type GoalCreateResult = GoalRecord & GoalWriteResult;
type GoalInput = Pick<GoalRecord, 'title' | 'description' | 'level' | 'domain' | 'priority' | 'targetDate'>;
type GoalUpdates = Partial<GoalInput & Pick<GoalRecord, 'progress'>>;
export interface LegacyGoalChange {
  id: string;
  source: GoalRecord | null;
  previousSource: GoalRecord | null;
  current: GoalRecord | null;
  /** One opened review has one durable decision, even if its display refresh fails. */
  intentId?: string;
}
export type GoalRecoveryResult = GoalWriteResult & { copyId: string | null };

const levelLabels: Record<GoalLevel, string> = { short: '短期', medium: '中期', long: '长期' };
const priorityColors: Record<GoalPriority, string> = {
  low: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  medium: 'bg-[var(--warning)]/10 text-[var(--warning)]',
  high: 'bg-[var(--danger)]/10 text-[var(--danger)]',
};
export { levelLabels as goalLevelLabels, priorityColors as goalPriorityColors };

interface GoalState {
  items: GoalView[];
  statuses: Record<string, GoalStatus>;
  legacyChanges: LegacyGoalChange[];
  loaded: boolean;
  loading: boolean;
  readError: string | null;
  publishedRevision: number;
  loadFromDB: () => Promise<void>;
  addGoal: (goal: GoalInput, intentId?: string) => Promise<GoalCreateResult>;
  updateProgress: (id: string, progress: number) => Promise<GoalWriteResult>;
  updateGoal: (id: string, updates: GoalUpdates, expected?: GoalRecord) => Promise<GoalWriteResult>;
  removeGoal: (id: string, expected?: GoalRecord) => Promise<GoalWriteResult>;
  enableSync: (selected: GoalRecord[], expectedOwner: string) => Promise<GoalWriteResult>;
}

const SOURCE_CHANGED = '目标刚刚更新，已保留输入。请核对最新版本后重试';
const SOURCE_MISSING = '原目标已不存在，未恢复或删除其他目标。请刷新核对';
const RECOVERY_CHANGED = '旧窗口或当前目标刚刚变化，请重新比较';
const REFRESH_FAILED = '修改已保存在本机，列表暂未刷新，请刷新核对；无需重复提交';
const READ_FAILED = '暂时无法读取目标，原稿仍保留，请稍后刷新';
const sourceAuthority = new WeakMap<GoalRecord, { source: GoalRecord; actor: LocalActor }>();
const reviewAuthority = new WeakMap<LegacyGoalChange, { source: LegacyGoalChange; actor: LocalActor }>();
const pending = new Set<string>();
const creationActors = new Map<string, LocalActor>();
let loadSequence = 0;
let publishedActor: LocalActor | null = null;
let publishedRevision = 0;
let committedRevision = 0;
let publishedCommitRevision = 0;
const activeReads = new Map<number, Omit<LocalActor, 'epoch'>>();
interface CommitCoverage { revision?: number }
/** In-memory commit coverage only: no schema/outbox/record fields are added.
 * Register before writing; rollback never fires complete. A reader can therefore
 * prove visibility even when delivery of the writer promise is delayed. */
function coverCommittedWrite(coverage: CommitCoverage) {
  const transaction = Dexie.currentTransaction;
  if (!transaction) throw new Error('目标写入需要完整事务');
  transaction.on('complete', () => { coverage.revision = ++committedRevision; });
}
class AlreadyCommitted extends Error {}

function bindSource(row: GoalRecord, actor: LocalActor): GoalRecord {
  const result = structuredClone(row);
  sourceAuthority.set(result, { source: structuredClone(row), actor });
  return result;
}
/** Use for opened edit/delete/enrollment dialogs; a spread loses the viewed actor. */
export function cloneGoalSnapshot(row: GoalRecord): GoalRecord {
  const known = sourceAuthority.get(row);
  return known ? bindSource(known.source, known.actor) : structuredClone(row);
}
function bindReview(row: LegacyGoalChange, actor: LocalActor): LegacyGoalChange {
  const result = structuredClone(row);
  reviewAuthority.set(result, { source: structuredClone(row), actor });
  return result;
}
/** Use instead of structuredClone when opening a legacy comparison. */
export function cloneLegacyGoalChange(row: LegacyGoalChange): LegacyGoalChange {
  const known = reviewAuthority.get(row);
  return known ? bindReview(known.source, known.actor) : structuredClone(row);
}
function freezeSource(row: GoalRecord) {
  const known = sourceAuthority.get(row);
  return { source: structuredClone(known?.source ?? row), viewedActor: known?.actor };
}
function validateGoal(goal: GoalRecord): GoalRecord {
  if (!Number.isFinite(goal.progress) || goal.progress < 0 || goal.progress > 100) throw new Error('目标进度须在 0 到 100 之间');
  if (typeof goal.title !== 'string' || typeof goal.description !== 'string' || typeof goal.domain !== 'string' || !goal.title.trim() || goal.title.length > 100 || goal.description.length > 2000 || !goal.domain.trim() || goal.domain.length > 50) throw new Error('请检查目标标题、描述与领域');
  if (!['short', 'medium', 'long'].includes(goal.level) || !['low', 'medium', 'high'].includes(goal.priority)) throw new Error('目标类型或优先级无效');
  if (goal.targetDate != null && goal.targetDate !== '' && (typeof goal.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(goal.targetDate) || Number.isNaN(Date.parse(goal.targetDate + 'T00:00:00Z')) || new Date(goal.targetDate + 'T00:00:00Z').toISOString().slice(0, 10) !== goal.targetDate)) throw new Error('请填写有效的目标日期');
  return { ...goal, title: goal.title.trim(), description: goal.description.trim(), domain: goal.domain.trim(), progress: Math.round(goal.progress) };
}
function inputFields(input: GoalInput): GoalInput {
  const { title, description, level, domain, priority, targetDate } = input;
  return { title, description, level, domain, priority, targetDate };
}
function updateFields(updates: GoalUpdates): GoalUpdates {
  const result: GoalUpdates = {};
  for (const key of ['title', 'description', 'level', 'domain', 'priority', 'targetDate', 'progress'] as const) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) Object.assign(result, { [key]: updates[key] });
  }
  return structuredClone(result);
}
async function assertAuthority(actor: LocalActor, viewedActor?: LocalActor): Promise<void> {
  await assertLocalActor(actor);
  if (viewedActor) await assertLocalActor(viewedActor);
  // The last read above is itself an asynchronous actor boundary.
  assertLocalActorNow(actor);
}
async function assertSource(actor: LocalActor, source: GoalRecord) {
  const current = await actor.database.goalRecords.get(source.id);
  if (!current) throw new Error(SOURCE_MISSING);
  if (!await sameGoalSource(current, source)) throw new Error(SOURCE_CHANGED);
}
async function actorState(actor: LocalActor): Promise<'current' | 'changed' | 'unknown'> {
  try { assertLocalActorNow(actor); } catch { return 'changed'; }
  try {
    const epoch = (await actor.database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value;
    try { assertLocalActorNow(actor); } catch { return 'changed'; }
    return epoch === actor.epoch ? 'current' : 'changed';
  } catch { return 'unknown'; }
}
function clearObsoleteView(actor?: LocalActor) {
  if (publishedActor && actor && (publishedActor.database !== actor.database || publishedActor.owner !== actor.owner || publishedActor.session !== actor.session || publishedActor.sessionGeneration !== actor.sessionGeneration || publishedActor.epoch !== actor.epoch)) {
    try { assertLocalActorNow(publishedActor); return; } catch { /* stale published actor */ }
  }
  publishedActor = null; publishedRevision = 0; publishedCommitRevision = 0;
  useGoalStore.setState({ items: [], statuses: {}, legacyChanges: [], loaded: false, loading: false, readError: null, publishedRevision: 0 });
}
function deriveStatuses(goals: GoalRecord[], outbox: OutboxRecord[], settings: SettingRecord[]): Record<string, GoalStatus> {
  const pendingIds = new Set<string>(), blocked = new Set<string>();
  for (const row of outbox) if (row.entity === 'goals') {
    const id = row.op === 'delete' ? String(row.payload) : (row.payload as { id: string }).id;
    pendingIds.add(id); if (row.status === 'blocked') blocked.add(id);
  }
  const metadata = new Map(settings.map(row => [row.key, row.value]));
  return Object.fromEntries(goals.map(goal => {
    const version = metadata.get(`sync-version:goals:${goal.id}`);
    return [goal.id, metadata.has(`sync-conflict:goals:${goal.id}`) ? '需要比较版本' : blocked.has(goal.id) ? '需要检查' : goal.syncScope !== 'account' ? '仅本机' : pendingIds.has(goal.id) || version === undefined || version === '0' ? '待同步' : isSequence(version) ? '已同步' : '需要检查'];
  }));
}
async function deriveChanges(sources: GoalRecord[], settings: SettingRecord[], goals: GoalRecord[], actor: LocalActor): Promise<LegacyGoalChange[]> {
  const sourceMap = new Map(sources.map(row => [row.id, row]));
  const previousMap = new Map(settings.filter(row => row.key.startsWith('goal-source-snapshot:')).map(row => [row.key.slice('goal-source-snapshot:'.length), row.value as GoalRecord | null]));
  const currentMap = new Map(goals.map(row => [row.id, row]));
  const changes: LegacyGoalChange[] = [];
  for (const id of new Set([...sourceMap.keys(), ...previousMap.keys()])) {
    const source = sourceMap.get(id) ?? null, previousSource = previousMap.get(id) ?? null;
    if (!await sameGoalSource(source, previousSource)) changes.push(bindReview({ id, source, previousSource, current: currentMap.get(id) ?? null, intentId: generateLocalId() }, actor));
  }
  return changes;
}
async function refresh(actor: LocalActor, sequence: number): Promise<boolean> {
  const database = actor.database;
  activeReads.set(sequence, actor);
  try {
    const snapshot = await database.transaction('r', [database.goalRecords, database.table('goals'), database.outbox, database.settings], async () => {
      await assertLocalActor(actor);
      const [goals, sources, outbox, settings] = await Promise.all([database.goalRecords.toArray(), database.table<GoalRecord>('goals').toArray(), database.outbox.toArray(), database.settings.toArray()]);
      const legacyChanges = await deriveChanges(sources, settings, goals, actor);
      const order = { short: 0, medium: 1, long: 2 };
      goals.sort((a, b) => order[a.level] - order[b.level] || b.createdAt - a.createdAt);
      const items = goals.map(row => bindSource(row, actor));
      await assertLocalActor(actor);
      return { items, statuses: deriveStatuses(goals, outbox, settings), legacyChanges, coveredCommit: committedRevision };
    });
    // The read can finish before its promise is delivered. Re-lock the clear epoch
    // and recheck the actor after the final await, immediately beside publication.
    return await database.transaction('r', database.settings, async () => {
      await assertLocalActor(actor);
      if (sequence !== loadSequence) return false;
      assertLocalActorNow(actor);
      publishedActor = actor; publishedRevision = sequence; publishedCommitRevision = snapshot.coveredCommit;
      const { items, statuses, legacyChanges } = snapshot;
      useGoalStore.setState({ items, statuses, legacyChanges, loaded: true, loading: false, readError: null, publishedRevision: sequence });
      return true;
    });
  } finally { activeReads.delete(sequence); }
}
function publicationCovers(actor: LocalActor, sequence: number, coverage: CommitCoverage): boolean {
  return Boolean(publishedActor && (publishedRevision >= sequence || coverage.revision !== undefined && publishedCommitRevision >= coverage.revision) && publishedActor.database === actor.database && publishedActor.owner === actor.owner && publishedActor.session === actor.session && publishedActor.sessionGeneration === actor.sessionGeneration && publishedActor.epoch === actor.epoch);
}
function newerReadPending(actor: LocalActor, sequence: number): boolean {
  return [...activeReads].some(([revision, reader]) => revision > sequence && reader.database === actor.database && reader.owner === actor.owner && reader.session === actor.session && reader.sessionGeneration === actor.sessionGeneration);
}

async function afterCommit(actor: LocalActor, alreadyCommitted = false, coverage: CommitCoverage = {}): Promise<GoalWriteResult> {
  const sequence = ++loadSequence;
  try {
    const updated = await refresh(actor, sequence);
    const state = await actorState(actor);
    if (state === 'changed') {
      if (sequence === loadSequence) clearObsoleteView(actor);
      return { committed: true, alreadyCommitted, view: 'context-changed', refreshRevision: sequence };
    }
    assertLocalActorNow(actor);
    return { committed: true, alreadyCommitted, view: state === 'current' && (updated || publicationCovers(actor, sequence, coverage)) ? 'current' : state === 'current' && newerReadPending(actor, sequence) ? 'refreshing' : 'refresh-needed', refreshRevision: sequence };
  } catch {
    const state = await actorState(actor);
    if (state === 'changed') {
      if (sequence === loadSequence) clearObsoleteView(actor);
      return { committed: true, alreadyCommitted, view: 'context-changed', refreshRevision: sequence };
    }
    try { assertLocalActorNow(actor); } catch {
      if (sequence === loadSequence) clearObsoleteView(actor);
      return { committed: true, alreadyCommitted, view: 'context-changed', refreshRevision: sequence };
    }
    recordDiagnostic('runtime-error', 'goals');
    if (state === 'current' && publicationCovers(actor, sequence, coverage)) return { committed: true, alreadyCommitted, view: 'current', refreshRevision: sequence };
    if (state === 'current' && newerReadPending(actor, sequence)) return { committed: true, alreadyCommitted, view: 'refreshing', refreshRevision: sequence };
    if (state === 'current' && sequence === loadSequence) {
      // Publish even the error only under the same final actor/epoch guard.
      try {
        await actor.database.transaction('r', actor.database.settings, async () => {
          await assertLocalActor(actor);
          assertLocalActorNow(actor);
          if (sequence === loadSequence) useGoalStore.setState({ loading: false, readError: REFRESH_FAILED });
        });
      } catch { /* no authority or readable storage to publish */ }
    }
    return { committed: true, alreadyCommitted, view: 'refresh-needed', refreshRevision: sequence };
  }
}
async function writeGoal(actor: LocalActor, existing: GoalRecord, replacement: GoalRecord | null, viewedActor?: LocalActor): Promise<CommitCoverage> {
  const database = actor.database, coverage: CommitCoverage = {};
  const write = async () => {
    coverCommittedWrite(coverage);
    await assertAuthority(actor, viewedActor);
    await assertSource(actor, existing);
    await assertAuthority(actor, viewedActor);
    if (replacement) await database.goalRecords.put(replacement);
    else await database.goalRecords.delete(existing.id);
    await assertAuthority(actor, viewedActor);
  };
  if (existing.syncScope === 'account') {
    // Full-source CAS belongs in write, not the shared helper's JSON comparator.
    await commitLocalMutation('goals', replacement ? 'upsert' : 'delete', replacement ?? existing.id, write, [database.goalRecords], undefined, actor);
  } else {
    await database.transaction('rw', [database.goalRecords, database.settings], write);
  }
  return coverage;
}

export const useGoalStore = create<GoalState>((set, get) => ({
  items: [], statuses: {}, legacyChanges: [], loaded: false, loading: false, readError: null, publishedRevision: 0,
  loadFromDB: async () => {
    const sequence = ++loadSequence;
    let actor: LocalActor | undefined;
    let captured: Omit<LocalActor, 'epoch'> | undefined;
    try {
      captured = captureLocalActor();
      activeReads.set(sequence, captured);
      actor = await readLocalActor();
      if (sequence !== loadSequence) return;
      assertLocalActorNow(actor);
      set({ loading: true });
      await refresh(actor, sequence);
      if (sequence === loadSequence && await actorState(actor) === 'changed') clearObsoleteView(actor);
    } catch (error) {
      if (sequence !== loadSequence) return;
      let changed = !captured;
      if (captured) { try { assertLocalActorNow(captured); } catch { changed = true; } }
      if (changed || actor && await actorState(actor) === 'changed') { clearObsoleteView(actor); return; }
      if (sequence !== loadSequence) return;
      if (actor) {
        try {
          await actor.database.transaction('r', actor.database.settings, async () => {
            await assertLocalActor(actor!);
            assertLocalActorNow(actor!);
            if (sequence === loadSequence) set({ loading: false, readError: READ_FAILED });
          });
        } catch { /* no readable current context in which to publish an error */ }
      } else if (captured) {
        // If even the initial epoch read failed, retain the last good snapshot.
        // Only a generic storage error can be shown without a readable epoch.
        assertLocalActorNow(captured);
        if (sequence === loadSequence) set({ loading: false, readError: READ_FAILED });
      }
      throw error;
    } finally { activeReads.delete(sequence); }
  },
  addGoal: async (goal, intentId = generateLocalId()) => {
    const readingActor = readLocalActor();
    const input = structuredClone(inputFields(goal));
    const actor = await readingActor, database = actor.database;
    const intentActor = creationActors.get(intentId) ?? actor;
    creationActors.set(intentId, intentActor);
    await assertAuthority(actor, intentActor);
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(intentId)) throw new Error('目标编号无效，请重新新建');
    const now = Date.now();
    let record = validateGoal({ ...input, id: intentId, progress: 0, createdAt: now, updatedAt: now, syncScope: actor.owner ? 'account' : 'local' });
    if (pending.has(intentId)) throw new Error('这个目标正在保存，请稍后');
    pending.add(intentId); ++loadSequence;
    let alreadyCommitted = false;
    const coverage: CommitCoverage = {};
    try {
      await commitLocalMutation('goals', 'upsert', record, async () => {
        coverCommittedWrite(coverage);
        await assertAuthority(actor, intentActor);
        const existing = await database.goalRecords.get(intentId);
        const key = `goal-create:${intentId}`;
        const receipt = (await database.settings.get(key))?.value as { input: GoalInput; original: GoalRecord } | undefined;
        if (receipt) {
          if (!existing) throw new Error('这次创建的目标已删除，未重复创建。请关闭后重新新建');
          if (!await sameGoalSource(receipt.input, input) || !await sameGoalSource(existing, receipt.original)) throw new Error(SOURCE_CHANGED);
          record = existing;
          await assertLocalActor(actor);
          throw new AlreadyCommitted();
        }
        if (existing) throw new Error('这个目标编号已存在，未覆盖原记录');
        await assertLocalActor(actor);
        await database.goalRecords.add(record);
        await database.settings.put({ key, value: { input, original: record } });
        await assertLocalActor(actor);
      }, [database.goalRecords], undefined, actor);
    } catch (error) {
      if (!(error instanceof AlreadyCommitted)) throw error;
      alreadyCommitted = true;
    } finally { pending.delete(intentId); }
    const result = Object.assign(bindSource(record, actor), await afterCommit(actor, alreadyCommitted, coverage));
    return result;
  },
  updateProgress: async (id, progress) => {
    if (!Number.isFinite(progress)) throw new Error('目标进度无效，请重新选择');
    return get().updateGoal(id, { progress: Math.max(0, Math.min(100, Math.round(progress))) });
  },
  updateGoal: async (id, updates, expected) => {
    const readingActor = readLocalActor();
    const original = expected ?? get().items.find(goal => goal.id === id);
    const frozen = original && freezeSource(original);
    const changes = updateFields(updates);
    const actor = await readingActor;
    if (!frozen || frozen.source.id !== id) throw new Error(SOURCE_MISSING);
    const updated = validateGoal({ ...frozen.source, ...changes, updatedAt: Date.now() });
    ++loadSequence;
    const coverage = await writeGoal(actor, frozen.source, updated, frozen.viewedActor);
    return afterCommit(actor, false, coverage);
  },
  removeGoal: async (id, expected) => {
    const readingActor = readLocalActor();
    const original = expected ?? get().items.find(goal => goal.id === id);
    const frozen = original && freezeSource(original);
    const actor = await readingActor;
    if (!frozen || frozen.source.id !== id) throw new Error(SOURCE_MISSING);
    ++loadSequence;
    const coverage = await writeGoal(actor, frozen.source, null, frozen.viewedActor);
    return afterCommit(actor, false, coverage);
  },
  enableSync: async (selected, expectedOwner) => {
    const readingActor = readLocalActor();
    const frozen = selected.map(freezeSource);
    const actor = await readingActor, database = actor.database;
    if (!expectedOwner || actor.owner !== expectedOwner || database.ownerId !== expectedOwner) throw new Error('当前账号已变化，未上传目标');
    if (!frozen.length || new Set(frozen.map(row => row.source.id)).size !== frozen.length) throw new Error('请选择要同步的目标');
    let alreadyCommitted = true;
    const coverage: CommitCoverage = {};
    ++loadSequence;
    await database.transaction('rw', [database.goalRecords, database.settings, database.outbox], async () => {
      coverCommittedWrite(coverage);
      for (const { source, viewedActor } of frozen) {
        await assertAuthority(actor, viewedActor);
        const current = await database.goalRecords.get(source.id);
        const key = `goal-local-copy:${source.id}`;
        const backup = (await database.settings.get(key))?.value as { ownerId: string; original: GoalRecord; enrolled?: GoalRecord } | undefined;
        if (current?.syncScope === 'account' && backup?.ownerId === expectedOwner && await sameGoalSource(backup.original, source) && await sameGoalSource(current, backup.enrolled ?? validateGoal({ ...backup.original, syncScope: 'account' }))) {
          await assertAuthority(actor, viewedActor);
          continue;
        }
        if (!current || current.syncScope === 'account' || backup || !await sameGoalSource(current, source)) throw new Error('目标刚刚更新，请重新检查所选内容；尚未上传');
        const record = validateGoal({ ...source, syncScope: 'account' });
        await assertAuthority(actor, viewedActor);
        await database.settings.put({ key, value: { ownerId: expectedOwner, original: source, enrolled: record, enrolledAt: Date.now() } });
        await database.goalRecords.put(record);
        await assertAuthority(actor, viewedActor);
        await enqueueSync('goals', 'upsert', record);
        await assertAuthority(actor, viewedActor);
        alreadyCommitted = false;
      }
      await assertLocalActor(actor);
    });
    void flush().catch(() => recordDiagnostic('runtime-error', 'sync'));
    return afterCommit(actor, alreadyCommitted, coverage);
  },
}));

/** Guarded standalone reader, useful outside the observed Goal workspace. */
export async function legacyGoalChanges(): Promise<LegacyGoalChange[]> {
  const actor = await readLocalActor(), database = actor.database;
  const changes = await database.transaction('r', [database.table('goals'), database.goalRecords, database.settings], async () => {
    await assertLocalActor(actor);
    const [sources, goals, settings] = await Promise.all([database.table<GoalRecord>('goals').toArray(), database.goalRecords.toArray(), database.settings.toArray()]);
    const result = await deriveChanges(sources, settings, goals, actor);
    await assertLocalActor(actor);
    return result;
  });
  return database.transaction('r', database.settings, async () => { await assertLocalActor(actor); return changes; });
}

export async function resolveLegacyGoalChange(preview: LegacyGoalChange, choice: 'copy' | 'keep', expectedOwner: string): Promise<GoalRecoveryResult> {
  const readingActor = readLocalActor();
  const known = reviewAuthority.get(preview);
  const frozen = structuredClone(known?.source ?? preview);
  const intentId = frozen.intentId ?? generateLocalId();
  // Also bind a caller-owned original preview so an immediate same-object retry
  // retains its intent; published previews already carry a serializable intent ID.
  frozen.intentId = intentId;
  const actor = await readingActor, database = actor.database;
  if (!known) reviewAuthority.set(preview, { source: structuredClone(frozen), actor });
  if (!expectedOwner || actor.owner !== expectedOwner || database.ownerId !== expectedOwner) throw new Error('账号已变化，旧目标未处理');
  if (!['copy', 'keep'].includes(choice) || !/^[a-zA-Z0-9_-]{8,64}$/.test(intentId)) throw new Error('请重新打开旧目标比较');
  let copyId: string | null = null, alreadyCommitted = false;
  const coverage: CommitCoverage = {};
  ++loadSequence;
  await database.transaction('rw', [database.table('goals'), database.goalRecords, database.settings], async () => {
    coverCommittedWrite(coverage);
    await assertAuthority(actor, known?.actor);
    const key = `goal-source-recovery:${intentId}`;
    const receipt = (await database.settings.get(key))?.value as (LegacyGoalChange & { choice: string; copyId: string | null; ownerId: string }) | undefined;
    if (receipt) {
      const { id, source, previousSource, current, intentId: receiptIntent } = receipt;
      if (receipt.ownerId !== expectedOwner || receipt.choice !== choice || !await sameGoalSource({ id, source, previousSource, current, intentId: receiptIntent }, frozen)) throw new Error(RECOVERY_CHANGED);
      copyId = receipt.copyId;
      alreadyCommitted = true;
      await assertAuthority(actor, known?.actor);
      return;
    }
    const source = await database.table<GoalRecord>('goals').get(frozen.id) ?? null;
    const previousSource = (await database.settings.get(`goal-source-snapshot:${frozen.id}`))?.value as GoalRecord | null | undefined ?? null;
    const current = await database.goalRecords.get(frozen.id) ?? null;
    if (await sameGoalSource(source, previousSource) || !await sameGoalSource({ id: frozen.id, source, previousSource, current, intentId }, frozen)) throw new Error(RECOVERY_CHANGED);
    const copy = choice === 'copy' && source ? validateGoal({ ...structuredClone(source), id: generateLocalId(), syncScope: 'local' }) : null;
    if (choice === 'copy' && !copy) throw new Error('旧窗口已删除这份目标，没有新内容可以复制');
    await assertAuthority(actor, known?.actor);
    copyId = copy?.id ?? null;
    await database.settings.put({ key, value: { ...frozen, ownerId: expectedOwner, choice, copyId, resolvedAt: Date.now() } });
    if (copy) await database.goalRecords.add(copy);
    await database.settings.put({ key: `goal-source-snapshot:${frozen.id}`, value: source });
    await assertAuthority(actor, known?.actor);
  });
  return { ...await afterCommit(actor, alreadyCommitted, coverage), copyId };
}

let observation: { unsubscribe: () => void } | null = null;
let observers = 0;
function requestRefresh() { void Dexie.ignoreTransaction(() => useGoalStore.getState().loadFromDB()).catch(() => undefined); }
/** Both Goal and Settings recovery use this one coherent, actor-guarded reader.
 * A read fault keeps the existing snapshot/error visible and does not terminate
 * observation, so an explicit retry or later real DB change can recover it.
 */
export function startGoalObservation(): () => void {
  observers += 1;
  if (!observation) {
    // A cancelled or failed load may read only the epoch. Using that load as a
    // liveQuery would replace its dynamic dependencies with epoch-only reads,
    // silently losing later outbox/version ACK updates. Observe committed table
    // mutations independently; all publication still uses the guarded reader.
    const onMutation = (parts: ObservabilitySet) => {
      let prefix: string;
      try { prefix = `idb://${captureLocalActor().database.name}/`; }
      catch { requestRefresh(); return; }
      if (Object.keys(parts).some(key => ['goalRecords', 'goals', 'outbox', 'settings'].some(table => key.startsWith(`${prefix}${table}/`)))) requestRefresh();
    };
    Dexie.on('storagemutated', onMutation);
    observation = { unsubscribe: () => Dexie.on.storagemutated.unsubscribe(onMutation) };
    requestRefresh();
    window.addEventListener('storage', requestRefresh);
    window.addEventListener(UNAUTHORIZED_EVENT, requestRefresh);
    window.addEventListener('youtrace:data-updated', requestRefresh);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true; observers -= 1;
    if (observers === 0) {
      observation?.unsubscribe(); observation = null;
      window.removeEventListener('storage', requestRefresh);
      window.removeEventListener(UNAUTHORIZED_EVENT, requestRefresh);
      window.removeEventListener('youtrace:data-updated', requestRefresh);
    }
  };
}
