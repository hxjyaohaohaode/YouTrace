import { expandScheduleRows } from '../utils/scheduleOccurrences';
import { create } from 'zustand';
import { db, generateLocalId, type ScheduleRecord, type ScheduleException } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { readLocalActor, assertLocalActor } from '../services/localActor';
import { assertScheduleContext, consumeScheduleDraft, type ScheduleContext } from '../components/schedule/scheduleDraft';
import { getToday, parseBusinessDate, daysBetween } from '../utils/date';

export type ScheduleOccurrence = ScheduleRecord & { virtualId: string; occurrenceDate: string; source: ScheduleRecord };
export type ScheduleScope = 'occurrence' | 'series';
export const sameScheduleSnapshot = (a: ScheduleRecord | undefined, b: ScheduleRecord) => Boolean(a) && [...new Set([...Object.keys(a!), ...Object.keys(b)])].every(key => JSON.stringify(a![key as keyof ScheduleRecord]) === JSON.stringify(b[key as keyof ScheduleRecord]));
const pending = new Set<string>();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSchedule<T extends Pick<ScheduleRecord, 'title' | 'date' | 'startTime' | 'endTime' | 'location' | 'type' | 'remind'>>(row: T): T {
  try { parseBusinessDate(row.date); } catch { throw new Error('请选择有效的日程日期'); }
  if (!row.title.trim() || row.title.trim().length > 100 || row.location.length > 100) throw new Error('日程标题和地点最多100字，标题不能为空');
  if (!TIME.test(row.startTime) || !TIME.test(row.endTime) || row.startTime >= row.endTime) throw new Error('结束时间必须晚于开始时间；跨午夜请分成两条日程');
  if (!['class', 'study', 'work', 'social', 'other'].includes(row.type) || !Number.isInteger(row.remind) || row.remind < 0 || row.remind > 1440) throw new Error('日程类型或提醒设置无效');
  return { ...row, title: row.title.trim() };
}
function assertOccurrence(source: ScheduleRecord, date: string) {
  try { parseBusinessDate(date); } catch { throw new Error('未找到这一次重复日程'); }
  if (source.repeat !== 'weekly' || date < source.date || daysBetween(source.date, date) % 7 !== 0) throw new Error('未找到这一次重复日程');
}
export function expandRecurringForRange(items: ScheduleRecord[], startDate: string, endDate: string): ScheduleOccurrence[] {
  return expandScheduleRows(items, startDate, endDate).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}
export function schedulePayload(record: ScheduleRecord): Record<string, unknown> {
  const { id, title, date, startTime, endTime, type, location, repeat, remind } = record;
  return { id, title, date, startTime, endTime, type, location, repeat, remind, ...(record.exceptions === undefined ? {} : { exceptions: record.exceptions.map(({ occurrenceDate, cancelled, date, startTime, endTime, title, location, type, remind }) => ({ occurrenceDate, ...(cancelled === undefined ? {} : { cancelled }), date, startTime, endTime, title, location, type, remind })) }) };
}
async function writeSchedule(expected: ScheduleRecord | null, replacement: ScheduleRecord | null, draft?: ScheduleContext, preserveDraft = false) {
  const id = (replacement ?? expected)!.id;
  if (pending.has(id)) throw new Error('这条日程正在保存，请稍后');
  pending.add(id);
  const database = db;
  try {
    await commitLocalMutation('schedules', replacement ? 'upsert' : 'delete', replacement ? schedulePayload(replacement) : id, async () => {
      if (draft) { if (replacement && !preserveDraft) await consumeScheduleDraft(draft); else await assertScheduleContext(draft); }
      return replacement ? expected ? database.schedules.put(replacement) : database.schedules.add(replacement) : database.schedules.delete(id);
    }, [database.schedules], expected);
  } finally { pending.delete(id); }
}
interface ScheduleState {
  items: ScheduleRecord[]; loaded: boolean; selectedDate: string;
  loadFromDB: () => Promise<void>; setSelectedDate: (date: string) => void;
  addItem: (item: Omit<ScheduleRecord, 'id' | 'createdAt' | 'updatedAt'>, id?: string, draft?: ScheduleContext) => Promise<ScheduleRecord>;
  updateItem: (id: string, updates: Partial<ScheduleRecord>, expected?: ScheduleRecord, draft?: ScheduleContext, preserveDraft?: boolean) => Promise<ScheduleRecord>;
  updateOccurrence: (expected: ScheduleRecord, occurrenceDate: string, updates: Omit<ScheduleException, 'occurrenceDate'>, draft?: ScheduleContext) => Promise<ScheduleRecord>;
  removeItem: (id: string, expected?: ScheduleRecord, draft?: ScheduleContext) => Promise<void>;
  getItemsByDate: (date: string) => ScheduleOccurrence[];
  getItemsByDateRange: (startDate: string, endDate: string) => ScheduleOccurrence[];
}
export const useScheduleStore = create<ScheduleState>((set, get) => ({
  items: [], loaded: false, selectedDate: getToday(),
  loadFromDB: async () => {
    const actor = await readLocalActor();
    const items = await actor.database.schedules.toArray();
    await assertLocalActor(actor);
    set({ items, loaded: true });
  },
  setSelectedDate: date => { parseBusinessDate(date); set({ selectedDate: date }); },
  addItem: async (item, id = generateLocalId(), draft) => {
    const now = Date.now(), record = validateSchedule({ ...item, id, createdAt: now, updatedAt: now });
    if (!['none', 'weekly'].includes(record.repeat)) throw new Error('重复规则无效');
    await writeSchedule(null, record, draft);
    set(state => ({ items: [...state.items, record] })); return record;
  },
  updateItem: async (id, updates, expected, draft, preserveDraft = false) => {
    const existing = expected ?? get().items.find(row => row.id === id);
    if (!existing || existing.id !== id) throw new Error('原日程已不存在，未保存旧修改。编辑稿仍保留');
    if ((existing.exceptions?.length ?? 0) > 0 && (updates.date !== undefined && updates.date !== existing.date || updates.repeat !== undefined && updates.repeat !== existing.repeat)) throw new Error('这组日程已有单次调整，暂不能更改起始日期或重复规则；请逐次调整或新建日程');
    const updated = validateSchedule({ ...existing, ...updates, id, updatedAt: Date.now() });
    await writeSchedule(existing, updated, draft, preserveDraft);
    set(state => ({ items: state.items.map(row => row.id === id ? updated : row) })); return updated;
  },
  updateOccurrence: async (expected, occurrenceDate, updates, draft) => {
    assertOccurrence(expected, occurrenceDate);
    const exception: ScheduleException = validateSchedule({ ...updates, occurrenceDate });
    const exceptions = [...(expected.exceptions ?? []).filter(row => row.occurrenceDate !== occurrenceDate), exception];
    if (exceptions.length > 500) throw new Error('单次调整已达到500条，请先导出并整理这组日程');
    return get().updateItem(expected.id, { exceptions }, expected, draft, updates.cancelled === true);
  },
  removeItem: async (id, expected, draft) => {
    const existing = expected ?? get().items.find(row => row.id === id);
    if (!existing || existing.id !== id) throw new Error('原日程已不存在，未删除其他记录');
    await writeSchedule(existing, null, draft);
    set(state => ({ items: state.items.filter(row => row.id !== id) }));
  },
  getItemsByDate: date => expandRecurringForRange(get().items, date, date),
  getItemsByDateRange: (start, end) => expandRecurringForRange(get().items, start, end),
}));
