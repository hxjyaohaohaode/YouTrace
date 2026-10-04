import { create } from 'zustand';
import { db, generateLocalId, LOCAL_DATA_EPOCH_KEY, type DiaryRecord } from '../db';
import { commitLocalMutation } from '../services/localMutation';
import { isLoggedIn, SESSION_REVISION_KEY, SIGNED_OUT_KEY } from '../services/apiClient';
import { parseBusinessDate } from '../utils/date';
import { assertDiaryContext, consumeDiaryDraft, openDiaryDraft, sameDiarySnapshot, type DiaryContext } from '../components/diary/diaryDraft';

export { sameDiarySnapshot } from '../components/diary/diaryDraft';
export class DiaryDateConflict extends Error {
  readonly records: DiaryRecord[];
  constructor(records: DiaryRecord[]) {
    super('这个日期已有日记，未覆盖原文。请先查看、核对已有记录');
    this.name = 'DiaryDateConflict'; this.records = records;
  }
}
const pending = new Set<string>();

interface DiaryState {
  items: DiaryRecord[];
  loaded: boolean;
  loadError: string;
  loadFromDB: () => Promise<void>;
  addItem: (item: Omit<DiaryRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }, draft?: DiaryContext) => Promise<DiaryRecord>;
  updateItem: (id: string, updates: Partial<Omit<DiaryRecord, 'id'>>, expected?: DiaryRecord, draft?: DiaryContext) => Promise<DiaryRecord>;
  removeItem: (id: string, expected?: DiaryRecord, draft?: DiaryContext) => Promise<void>;
  getItemsByDate: (date: string) => DiaryRecord[];
}

function validateDiary(record: DiaryRecord): DiaryRecord {
  try { parseBusinessDate(record.date); } catch { throw new Error('请选择真实有效的日记日期'); }
  const content = record.content.trim();
  if (!content || content.length > 10000) throw new Error('日记内容需为 1–10000 个字符');
  if (record.moodScore !== null && (!Number.isInteger(record.moodScore) || record.moodScore < 1 || record.moodScore > 10)) throw new Error('心情评分需为 1–10 分，也可以不记录心情');
  return { ...record, content, mood: record.mood || null, moodScore: record.mood ? record.moodScore : null };
}
function toServerShape(record: DiaryRecord): Record<string, unknown> {
  return { id: record.id, date: record.date, content: record.content, mood: record.mood, moodScore: record.moodScore, source: record.source, ...(record.aiInsight ? { aiInsight: record.aiInsight } : {}) };
}
async function assertAvailableDate(record: DiaryRecord, context: DiaryContext) {
  const others = (await context.database.diary.where('date').equals(record.date).toArray()).filter((item) => item.id !== record.id);
  if (others.length) throw new DiaryDateConflict(others);
}
async function writeDiary(existing: DiaryRecord, replacement: DiaryRecord | null, supplied?: DiaryContext) {
  if (pending.has(existing.id)) throw new Error('这篇日记正在保存，请稍后');
  pending.add(existing.id);
  try {
    const context = supplied ?? (await openDiaryDraft(existing.id)).context;
    const database = context.database;
    await commitLocalMutation('diaries', replacement ? 'upsert' : 'delete', replacement ? toServerShape(replacement) : existing.id, async () => {
      await assertDiaryContext(context);
      if (!sameDiarySnapshot(await database.diary.get(existing.id), existing)) throw new Error('日记刚刚更新，输入已保留。请核对最新记录后重试');
      if (replacement) await assertAvailableDate(replacement, context);
      if (supplied && replacement) await consumeDiaryDraft(context);
      if (replacement) await database.diary.put(replacement); else await database.diary.delete(existing.id);
      await assertDiaryContext(context);
    }, [database.diary], existing);
    await assertDiaryContext(context);
  } finally { pending.delete(existing.id); }
}

export const useDiaryStore = create<DiaryState>((set, get) => ({
  items: [], loaded: false, loadError: '',
  loadFromDB: async () => {
    const database = db;
    const session = localStorage.getItem(SESSION_REVISION_KEY); const sessionActive = isLoggedIn();
    try {
      const { items, epoch } = await database.transaction('r', database.diary, database.settings, async () => ({ items: await database.diary.toArray(), epoch: (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value }));
      if (database !== db || session !== localStorage.getItem(SESSION_REVISION_KEY) || sessionActive !== isLoggedIn() || localStorage.getItem(SIGNED_OUT_KEY) === 'true' || (await database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value !== epoch) return;
      set({ items, loaded: true, loadError: '' });
    } catch (reason) {
      if (database === db && session === localStorage.getItem(SESSION_REVISION_KEY)) set({ loaded: false, loadError: reason instanceof Error ? reason.message : '日记读取失败，请重试' });
      throw reason;
    }
  },
  addItem: async (item, supplied) => {
    const record = validateDiary({ ...item, id: item.id || generateLocalId(), createdAt: Date.now(), updatedAt: Date.now() });
    if (pending.has(record.id)) throw new Error('这篇日记正在保存，请稍后');
    pending.add(record.id);
    try {
      const context = supplied ?? (await openDiaryDraft('new')).context;
      const database = context.database;
      await commitLocalMutation('diaries', 'upsert', toServerShape(record), async () => {
        await assertDiaryContext(context); await assertAvailableDate(record, context);
        if (supplied) await consumeDiaryDraft(context);
        await database.diary.add(record); await assertDiaryContext(context);
      }, [database.diary], null);
      await assertDiaryContext(context);
      set((state) => ({ items: state.items.some((row) => row.id === record.id) ? state.items : [record, ...state.items] }));
      return record;
    } finally { pending.delete(record.id); }
  },
  updateItem: async (id, updates, expected, draft) => {
    const existing = expected ?? get().items.find((item) => item.id === id);
    if (!existing || existing.id !== id) throw new Error('未找到这篇日记，请返回列表核对');
    // Historical creation time, including an unknown/zero value, is never invented by an edit.
    const updated = validateDiary({ ...existing, ...updates, id, createdAt: existing.createdAt, updatedAt: Date.now() });
    await writeDiary(existing, updated, draft);
    set((state) => ({ items: state.items.map((item) => item.id === id && sameDiarySnapshot(item, existing) ? updated : item) }));
    return updated;
  },
  removeItem: async (id, expected, draft) => {
    const existing = expected ?? get().items.find((item) => item.id === id);
    if (!existing || existing.id !== id) throw new Error('未找到这篇日记，请返回列表核对');
    await writeDiary(existing, null, draft);
    set((state) => ({ items: state.items.filter((item) => item.id !== id || !sameDiarySnapshot(item, existing)) }));
  },
  getItemsByDate: (date) => get().items.filter((item) => item.date === date).sort((a, b) => b.updatedAt - a.updatedAt),
}));
