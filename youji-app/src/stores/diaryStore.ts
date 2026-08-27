import { create } from 'zustand';
import { db, generateLocalId, type DiaryRecord } from '../db';
import { enqueueSync, flush } from '../services/syncEngine';
import { isLoggedIn } from '../services/apiClient';

type DiarySource = DiaryRecord['source'];

interface DiaryState {
  items: DiaryRecord[];
  loaded: boolean;

  loadFromDB: () => Promise<void>;
  addItem: (item: Omit<DiaryRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Promise<DiaryRecord>;
  updateItem: (id: string, updates: Partial<Omit<DiaryRecord, 'id'>>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  getItemsByDate: (date: string) => DiaryRecord[];
}

function toServerShape(record: DiaryRecord): Record<string, unknown> {
  return {
    id: record.id,
    date: record.date,
    content: record.content,
    ...(record.mood ? { mood: record.mood } : {}),
    moodScore: record.moodScore,
    source: record.source as DiarySource,
    ...(record.aiInsight ? { aiInsight: record.aiInsight } : {}),
  };
}

export const useDiaryStore = create<DiaryState>((set, get) => ({
  items: [],
  loaded: false,

  loadFromDB: async () => {
    const items = await db.diary.toArray();
    set({ items, loaded: true });
  },

  addItem: async (item) => {
    const now = Date.now();
    const record: DiaryRecord = {
      ...item,
      id: item.id || generateLocalId(),
      createdAt: now,
      updatedAt: now,
    };

    await db.diary.put(record);
    set((state) => ({ items: [record, ...state.items] }));

    if (isLoggedIn()) {
      await enqueueSync('diaries', 'upsert', toServerShape(record));
      void flush();
    }

    return record;
  },

  updateItem: async (id, updates) => {
    const existing = get().items.find((i) => i.id === id);
    if (!existing) return;

    const updated: DiaryRecord = { ...existing, ...updates, updatedAt: Date.now() };
    set((state) => ({ items: state.items.map((i) => (i.id === id ? updated : i)) }));
    await db.diary.put(updated);

    if (isLoggedIn()) {
      await enqueueSync('diaries', 'upsert', toServerShape(updated));
      void flush();
    }
  },

  removeItem: async (id) => {
    const existing = get().items.find((i) => i.id === id);
    await db.diary.delete(id);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));

    if (isLoggedIn() && existing) {
      await enqueueSync('diaries', 'delete', id);
      void flush();
    }
  },

  getItemsByDate: (date) => {
    return get().items
      .filter((i) => i.date === date)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
}));
