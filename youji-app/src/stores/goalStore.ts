import { create } from 'zustand';
import { db, generateLocalId, type GoalRecord } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { enqueueSync, flush } from '../services/syncEngine';

export type GoalLevel = 'short' | 'medium' | 'long';
export type GoalPriority = 'low' | 'medium' | 'high';

export type GoalView = GoalRecord;

const levelLabels: Record<GoalLevel, string> = {
  short: '短期',
  medium: '中期',
  long: '长期',
};

const priorityColors: Record<GoalPriority, string> = {
  low: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  medium: 'bg-[var(--warning)]/10 text-[var(--warning)]',
  high: 'bg-[var(--danger)]/10 text-[var(--danger)]',
};

export { levelLabels as goalLevelLabels, priorityColors as goalPriorityColors };

interface GoalState {
  items: GoalView[];
  loaded: boolean;

  loadFromDB: () => Promise<void>;
  addGoal: (goal: Omit<GoalRecord, 'id' | 'createdAt' | 'updatedAt' | 'progress' | 'syncScope'>) => Promise<GoalRecord>;
  updateProgress: (id: string, progress: number) => Promise<void>;
  updateGoal: (id: string, updates: Partial<Omit<GoalRecord, 'id' | 'createdAt' | 'syncScope'>>, expected?: GoalRecord) => Promise<void>;
  removeGoal: (id: string, expected?: GoalRecord) => Promise<void>;
  enableSync: (selected: GoalRecord[], expectedOwner: string) => Promise<void>;
}

function validateGoal(goal: GoalRecord): GoalRecord {
  if (!Number.isFinite(goal.progress) || goal.progress < 0 || goal.progress > 100) throw new Error('目标进度须在 0 到 100 之间');
  if (!goal.title.trim() || goal.title.length > 100 || goal.description.length > 2000 || !goal.domain.trim() || goal.domain.length > 50) throw new Error('请检查目标标题、描述与领域');
  if (!['short', 'medium', 'long'].includes(goal.level) || !['low', 'medium', 'high'].includes(goal.priority)) throw new Error('目标类型或优先级无效');
  if (goal.targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(goal.targetDate) || Number.isNaN(Date.parse(goal.targetDate + 'T00:00:00Z')) || new Date(goal.targetDate + 'T00:00:00Z').toISOString().slice(0, 10) !== goal.targetDate)) throw new Error('请填写有效的目标日期');
  return { ...goal, title: goal.title.trim(), description: goal.description.trim(), domain: goal.domain.trim(), progress: Math.round(goal.progress) };
}

const sameGoal = (left: GoalRecord | undefined, right: GoalRecord) => left && [...new Set([...Object.keys(left), ...Object.keys(right)])].every((key) => JSON.stringify(left[key as keyof GoalRecord]) === JSON.stringify(right[key as keyof GoalRecord]));

async function writeGoal(existing: GoalRecord, replacement: GoalRecord | null) {
  const database = db;
  const write = () => replacement ? database.goalRecords.put(replacement) : database.goalRecords.delete(existing.id);
  if (existing.syncScope === 'account') {
    await commitLocalMutation('goals', replacement ? 'upsert' : 'delete', replacement ?? existing.id, write, [database.goalRecords], existing);
  } else {
    await database.transaction('rw', database.goalRecords, async () => {
      if (!sameGoal(await database.goalRecords.get(existing.id), existing)) throw new Error('目标刚刚更新，已保留输入。请核对最新版本后重试');
      await write();
    });
  }
}

export const useGoalStore = create<GoalState>((set, get) => ({
  items: [],
  loaded: false,

  loadFromDB: async () => {
    const items = await db.goalRecords.toArray();
    items.sort((a, b) => {
      const levelOrder = { short: 0, medium: 1, long: 2 };
      return levelOrder[a.level] - levelOrder[b.level] || b.createdAt - a.createdAt;
    });
    set({ items, loaded: true });
  },

  addGoal: async (goal) => {
    const database = db;
    const now = Date.now();
    const record = validateGoal({ ...goal, id: generateLocalId(), progress: 0, createdAt: now, updatedAt: now, syncScope: database.ownerId ? 'account' : 'local' });
    await commitLocalMutation('goals', 'upsert', record, () => database.goalRecords.add(record), [database.goalRecords], null);
    set((state) => ({ items: state.items.some((goal) => goal.id === record.id) ? state.items : [...state.items, record] }));
    return record;
  },

  updateProgress: async (id, progress) => {
    if (!Number.isFinite(progress)) throw new Error('目标进度无效，请重新选择');
    await get().updateGoal(id, { progress: Math.max(0, Math.min(100, Math.round(progress))) });
  },

  updateGoal: async (id, updates, expected) => {
    const existing = expected ?? get().items.find((goal) => goal.id === id);
    if (!existing) throw new Error('目标已变化，请刷新后重试');
    const updated = validateGoal({ ...existing, ...updates, id: existing.id, createdAt: existing.createdAt, syncScope: existing.syncScope, updatedAt: Date.now() });
    await writeGoal(existing, updated);
    set((state) => ({ items: state.items.map((goal) => goal.id === id && sameGoal(goal, existing) ? updated : goal) }));
  },

  removeGoal: async (id, expected) => {
    const existing = expected ?? get().items.find((goal) => goal.id === id);
    if (!existing) throw new Error('目标已变化，请刷新后重试');
    await writeGoal(existing, null);
    set((state) => ({ items: state.items.filter((goal) => goal.id !== id || !sameGoal(goal, existing)) }));
  },

  enableSync: async (selected, expectedOwner) => {
    const database = db;
    if (!expectedOwner || database.ownerId !== expectedOwner) throw new Error('当前账号已变化，未上传目标');
    if (!selected.length || new Set(selected.map((goal) => goal.id)).size !== selected.length) throw new Error('请选择要同步的目标');
    await database.transaction('rw', database.goalRecords, database.settings, database.outbox, async () => {
      for (const snapshot of selected) {
        const current = await database.goalRecords.get(snapshot.id);
        if (current?.syncScope === 'account' && sameGoal({ ...current, syncScope: snapshot.syncScope }, snapshot)) continue;
        if (!sameGoal(current, snapshot) || current?.syncScope === 'account') throw new Error('目标刚刚更新，请重新检查所选内容；尚未上传');
        const record = validateGoal({ ...snapshot, syncScope: 'account' });
        // Original account-local copy survives adoption and is included in export.
        await database.settings.put({ key: `goal-local-copy:${snapshot.id}`, value: { ownerId: expectedOwner, original: snapshot, enrolledAt: Date.now() } });
        await database.goalRecords.put(record);
        await enqueueSync('goals', 'upsert', record);
      }
    });
    await get().loadFromDB();
    void flush();
  },
}));


export interface LegacyGoalChange { id: string; source: GoalRecord | null; previousSource: GoalRecord | null; current: GoalRecord | null }

/** Current-account old-table changes are quarantined, not silently merged. */
export async function legacyGoalChanges(): Promise<LegacyGoalChange[]> {
  const database = db;
  return database.transaction('r', database.table('goals'), database.goalRecords, database.settings, async () => {
    const sources = new Map((await database.table<GoalRecord>('goals').toArray()).map((row) => [row.id, row]));
    const snapshots = new Map((await database.settings.where('key').startsWith('goal-source-snapshot:').toArray()).map((row) => [row.key.slice('goal-source-snapshot:'.length), row.value as GoalRecord | null]));
    const changes: LegacyGoalChange[] = [];
    for (const id of new Set([...sources.keys(), ...snapshots.keys()])) {
      const source = sources.get(id) ?? null, previousSource = snapshots.get(id) ?? null;
      if (JSON.stringify(source) !== JSON.stringify(previousSource)) changes.push({ id, source, previousSource, current: await database.goalRecords.get(id) ?? null });
    }
    return changes;
  });
}

export async function resolveLegacyGoalChange(preview: LegacyGoalChange, choice: 'copy' | 'keep', expectedOwner: string) {
  const database = db;
  if (!expectedOwner || database.ownerId !== expectedOwner) throw new Error('账号已变化，旧目标未处理');
  await database.transaction('rw', database.table('goals'), database.goalRecords, database.settings, async () => {
    const current = (await legacyGoalChanges()).find((row) => row.id === preview.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(preview)) throw new Error('旧窗口或当前目标刚刚变化，请重新比较');
    const copy = choice === 'copy' && current.source ? validateGoal({ ...current.source, id: generateLocalId(), syncScope: 'local' }) : null;
    if (choice === 'copy' && !copy) throw new Error('旧窗口已删除这份目标，没有新内容可以复制');
    await database.settings.put({ key: `goal-source-recovery:${generateLocalId()}`, value: { ...current, choice, copyId: copy?.id ?? null, resolvedAt: Date.now() } });
    if (copy) await database.goalRecords.add(copy);
    await database.settings.put({ key: `goal-source-snapshot:${current.id}`, value: current.source });
  });
  await useGoalStore.getState().loadFromDB();
}
