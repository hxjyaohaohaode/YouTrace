import { create } from 'zustand';
import { generateLocalId, type HabitCheckinRecord } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { readLocalActor, assertLocalActor, assertLocalActorNow, type LocalActor } from '../services/localActor';
import { sameHabitSource, habitPayload, habitCheckinPayload } from '../services/habitSource';
import { recordKey } from '../services/syncIdentity';
import { recordDiagnostic } from '../services/diagnostics';
import { addDays, getToday, parseBusinessDate } from '../utils/date';
import { normalizeHabitFrequency } from '../utils/icons';

export interface HabitCheckinDay {
  date: string;
  done: boolean;
  source: HabitCheckinRecord | null;
}

export interface HabitItem {
  id: string;
  name: string;
  icon: string;
  frequency: 'daily' | 'weekly';
  sortOrder: number;
  createdAt: number;
  updatedAt?: number;
}

export interface HabitView extends HabitItem {
  /** Complete canonical snapshots. Neither derived fields nor these wrappers go on the wire. */
  source: HabitItem;
  checkinSources: HabitCheckinRecord[];
  done: boolean;
  streak: number;
  recentCheckins: HabitCheckinDay[];
}

export interface HabitWriteResult {
  status: 'committed-local' | 'already-achieved';
  viewUpdated: boolean;
}
export type HabitCreateResult = HabitView & HabitWriteResult;
type HabitInput = Pick<HabitItem, 'name' | 'icon' | 'frequency'>;

interface HabitState {
  items: HabitView[];
  loaded: boolean;
  refreshError: string | null;
  loadFromDB: () => Promise<void>;
  addHabit: (habit: HabitInput, id?: string) => Promise<HabitCreateResult>;
  setHabitDone: (expected: HabitView, date: string, done: boolean) => Promise<HabitWriteResult>;
  toggleHabit: (id: string, date?: string) => Promise<void>;
  removeHabit: (id: string, expected?: HabitItem) => Promise<HabitWriteResult>;
}

const sourceActors = new WeakMap<HabitItem, LocalActor>();
const pending = new Set<string>();
let loadSequence = 0;
const SOURCE_CHANGED = '这条习惯或打卡刚刚在其他位置更新，原记录保留。请刷新核对后重试';
const SOURCE_MISSING = '原习惯已不存在，未写入或删除其他记录。请刷新核对';
const DELETE_PENDING = '这条习惯或打卡还有未确认修改，请同步后重试；原记录保留';
const REFRESH_FAILED = '修改已保存在本机，列表暂未刷新，请刷新核对；无需重复提交';

/** The transaction can report a verified no-op without enqueuing a second mutation. */
class AlreadyAchieved extends Error {}

function deriveViews(habits: HabitItem[], checkins: HabitCheckinRecord[], actor: LocalActor): HabitView[] {
  const today = getToday();
  const byHabit = new Map<string, HabitCheckinRecord[]>();
  for (const checkin of checkins) {
    const rows = byHabit.get(checkin.habitId) ?? [];
    rows.push(checkin);
    byHabit.set(checkin.habitId, rows);
  }
  const recentDates = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  return [...habits].sort((a, b) => a.sortOrder - b.sortOrder).map((habit) => {
    const source = structuredClone(habit);
    sourceActors.set(source, actor);
    const checkinSources = structuredClone(byHabit.get(habit.id) ?? []);
    const doneDates = new Set(checkinSources.filter(row => row.done === true).map(row => row.date));
    const done = doneDates.has(today);
    let streak = 0, cursor = done ? today : addDays(today, -1);
    while (doneDates.has(cursor)) { streak += 1; cursor = addDays(cursor, -1); }
    return {
      ...structuredClone(habit), source, checkinSources, done, streak,
      recentCheckins: recentDates.map(date => ({ date, done: doneDates.has(date), source: structuredClone(checkinSources.find(row => row.date === date) ?? null) })),
    };
  });
}

async function assertParent(actor: LocalActor, expected: HabitItem): Promise<void> {
  const current = await actor.database.habits.get(expected.id);
  if (!current) throw new Error(SOURCE_MISSING);
  if (!await sameHabitSource(current, expected)) throw new Error(SOURCE_CHANGED);
}

async function assertViewedActor(actor: LocalActor, viewedActor: LocalActor | undefined) {
  await assertLocalActor(actor);
  if (viewedActor) await assertLocalActor(viewedActor);
}

export const useHabitStore = create<HabitState>((set, get) => {
  async function refresh(actor: LocalActor, sequence: number): Promise<boolean> {
    const database = actor.database;
    // One IndexedDB read transaction binds the two tables and epoch to one snapshot.
    const items = await database.transaction('r', [database.habits, database.habitCheckins, database.settings], async () => {
      await assertLocalActor(actor);
      const [habits, checkins] = await Promise.all([database.habits.toArray(), database.habitCheckins.toArray()]);
      await assertLocalActor(actor);
      return deriveViews(habits, checkins, actor);
    });
    // The read transaction may have finished before its promise reaches this turn.
    // Revalidate under an epoch read lock before publishing, and reject old loads.
    return database.transaction('r', database.settings, async () => {
      await assertLocalActor(actor);
      if (sequence !== loadSequence) return false;
      assertLocalActorNow(actor);
      set({ items, loaded: true, refreshError: null });
      return true;
    });
  }

  async function afterCommit(actor: LocalActor, status: HabitWriteResult['status']): Promise<HabitWriteResult> {
    const sequence = ++loadSequence;
    try { return { status, viewUpdated: await refresh(actor, sequence) }; }
    catch {
      recordDiagnostic('runtime-error', 'habits');
      // A failed refresh is not a failed write, and old authority must not publish even an error.
      try { await assertLocalActor(actor); assertLocalActorNow(actor); if (sequence === loadSequence) set({ refreshError: REFRESH_FAILED }); } catch { /* changed authority or unreadable storage */ }
      return { status, viewUpdated: false };
    }
  }

  return {
    items: [], loaded: false, refreshError: null,
    loadFromDB: async () => {
      const sequence = ++loadSequence;
      const actor = await readLocalActor();
      await refresh(actor, sequence);
    },
    addHabit: async (habit, id = generateLocalId()) => {
      // Read/capture begins before the first awaited source boundary.
      const readingActor = readLocalActor();
      const input: HabitInput = { name: habit.name.trim(), icon: habit.icon || '✨', frequency: normalizeHabitFrequency(habit.frequency) };
      const actor = await readingActor, database = actor.database;
      if (!input.name || input.name.length > 100 || input.icon.length > 16 || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) throw new Error('请检查习惯名称、图标和编号');
      if (pending.has(id)) throw new Error('这条习惯正在保存，请稍后');
      pending.add(id); ++loadSequence;
      let item: HabitItem | undefined, status: HabitWriteResult['status'] = 'committed-local';
      let returnedCheckins: HabitCheckinRecord[] = [];
      const payload = { id, ...input, sortOrder: 0 };
      const key = `habit-create:${id}`;
      try {
        // Use the same ID and durable receipt for retries. An ID cannot resurrect a deleted creation.
        await commitLocalMutation('habits', 'upsert', payload, async () => {
          const existing = await database.habits.get(id);
          const receipt = (await database.settings.get(key))?.value as { input: HabitInput } | undefined;
          if (receipt) {
            if (!existing) throw new Error('这次创建的习惯已删除，未重复创建。请关闭后重新新建');
            if (!await sameHabitSource(receipt.input, input)) throw new Error('这次创建的内容已变化，请核对已保存的习惯后重新新建');
            if (!await sameHabitSource({ name: existing.name, icon: existing.icon, frequency: existing.frequency }, input)) throw new Error(SOURCE_CHANGED);
            item = existing;
            returnedCheckins = await database.habitCheckins.where('habitId').equals(id).toArray();
            await assertLocalActor(actor);
            throw new AlreadyAchieved();
          }
          if (existing) throw new Error('这个习惯编号已存在，未覆盖原记录');
          const rows = await database.habits.toArray();
          const sortOrder = Math.min(10000, rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1);
          const now = Date.now();
          item = { id, ...input, sortOrder, createdAt: now, updatedAt: now };
          Object.assign(payload, habitPayload(item));
          await database.habits.add(item);
          await database.settings.put({ key, value: { input } });
        }, [database.habits, database.habitCheckins], undefined, actor);
      } catch (error) {
        if (!(error instanceof AlreadyAchieved)) throw error;
        status = 'already-achieved';
      } finally { pending.delete(id); }
      const result = await afterCommit(actor, status);
      // Returning the committed source never depends on a post-commit read succeeding.
      return { ...deriveViews([item!], returnedCheckins, actor)[0], ...result };
    },
    setHabitDone: async (expected, date, done) => {
      const readingActor = readLocalActor();
      const viewedActor = expected?.source && sourceActors.get(expected.source);
      const source = expected?.source && structuredClone(expected.source);
      const evidence = expected?.checkinSources && structuredClone(expected.checkinSources.find(row => row.date === date) ?? null);
      const actor = await readingActor, database = actor.database;
      if (!source || source.id !== expected.id || !Array.isArray(expected.checkinSources)) throw new Error('没有可核对的原习惯和打卡记录，请刷新后重试');
      try { parseBusinessDate(date); } catch { throw new Error('请选择有效的打卡日期'); }
      if (date > getToday() || typeof done !== 'boolean') throw new Error('请选择今天或之前的实际打卡日期');
      const id = `${source.id}|${date}`;
      if (evidence && (evidence.id !== id || evidence.habitId !== source.id)) throw new Error('打卡来源与所选习惯或日期不一致，请刷新核对');
      if (pending.has(source.id)) throw new Error('这条习惯正在保存，请稍后');
      pending.add(source.id); ++loadSequence;
      const record: HabitCheckinRecord = { ...(evidence ?? {}), id, habitId: source.id, date, done, source: evidence?.source ?? 'manual', confirmed: true, updatedAt: Date.now() };
      let status: HabitWriteResult['status'] = 'committed-local';
      try {
        await commitLocalMutation('habitCheckins', 'upsert', habitCheckinPayload(record), async () => {
          await assertViewedActor(actor, viewedActor);
          await assertParent(actor, source);
          const current = await database.habitCheckins.get(id) ?? null;
          if (current && (current.id !== id || current.habitId !== source.id || current.date !== date)) throw new Error(SOURCE_CHANGED);
          // An already-achieved intent never changes the peer's provenance or timestamp.
          if ((current?.done ?? false) === done) { await assertLocalActor(actor); throw new AlreadyAchieved(); }
          if (!await sameHabitSource(current, evidence)) throw new Error(SOURCE_CHANGED);
          await database.habitCheckins.put(record);
        }, [database.habits, database.habitCheckins], undefined, actor);
      } catch (error) {
        if (!(error instanceof AlreadyAchieved)) throw error;
        status = 'already-achieved';
      } finally { pending.delete(source.id); }
      return afterCommit(actor, status);
    },
    toggleHabit: async (id, date = getToday()) => {
      // Compatibility only: capture the displayed intent synchronously, never invert a newer DB read.
      const expected = get().items.find(row => row.id === id);
      if (!expected) throw new Error(SOURCE_MISSING);
      const done = !(expected.checkinSources.find(row => row.date === date)?.done ?? false);
      await get().setHabitDone(expected, date, done);
    },
    removeHabit: async (id, expected) => {
      const readingActor = readLocalActor();
      const original = expected ?? get().items.find(row => row.id === id)?.source;
      const viewedActor = original && sourceActors.get(original);
      const source = original && structuredClone(original);
      const actor = await readingActor, database = actor.database;
      if (!source || source.id !== id) throw new Error(SOURCE_MISSING);
      if (pending.has(id)) throw new Error('这条习惯正在保存，请稍后');
      pending.add(id); ++loadSequence;
      try {
        await commitLocalMutation('habits', 'delete', id, async () => {
          await assertViewedActor(actor, viewedActor);
          await assertParent(actor, source);
          const related = (key: string) => key === `habits:${id}` || key.startsWith(`habitCheckins:${id}|`);
          const operations = await database.outbox.toArray();
          const frozen = (await database.settings.get('syncV2Batch'))?.value as { keys?: string[] } | undefined;
          if (operations.some(row => related(recordKey(row))) || frozen && (!Array.isArray(frozen.keys) || frozen.keys.some(related))) throw new Error(DELETE_PENDING);
          await database.habitCheckins.where('habitId').equals(id).delete();
          await database.habits.delete(id);
        }, [database.habits, database.habitCheckins], undefined, actor);
      } finally { pending.delete(id); }
      return afterCommit(actor, 'committed-local');
    },
  };
});
