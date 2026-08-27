import { create } from 'zustand';
import { db, generateLocalId, type GoalRecord } from '../db';

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
  addGoal: (goal: Omit<GoalRecord, 'id' | 'createdAt' | 'updatedAt' | 'progress'>) => Promise<GoalRecord>;
  updateProgress: (id: string, progress: number) => Promise<void>;
  updateGoal: (id: string, updates: Partial<Omit<GoalRecord, 'id'>>) => Promise<void>;
  removeGoal: (id: string) => Promise<void>;
}

export const useGoalStore = create<GoalState>((set) => ({
  items: [],
  loaded: false,

  loadFromDB: async () => {
    const items = await db.goals.toArray();
    items.sort((a, b) => {
      const levelOrder = { short: 0, medium: 1, long: 2 };
      return levelOrder[a.level] - levelOrder[b.level] || b.createdAt - a.createdAt;
    });
    set({ items, loaded: true });
  },

  addGoal: async (goal) => {
    const now = Date.now();
    const record: GoalRecord = {
      ...goal,
      id: generateLocalId(),
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.goals.put(record);
    set((state) => ({ items: [...state.items, record] }));
    return record;
  },

  updateProgress: async (id, progress) => {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    await db.goals.update(id, { progress: clamped, updatedAt: Date.now() });
    set((state) => ({
      items: state.items.map((g) => (g.id === id ? { ...g, progress: clamped } : g)),
    }));
  },

  updateGoal: async (id, updates) => {
    await db.goals.update(id, { ...updates, updatedAt: Date.now() });
    set((state) => ({
      items: state.items.map((g) => (g.id === id ? { ...g, ...updates } : g)),
    }));
  },

  removeGoal: async (id) => {
    await db.goals.delete(id);
    set((state) => ({ items: state.items.filter((g) => g.id !== id) }));
  },
}));
