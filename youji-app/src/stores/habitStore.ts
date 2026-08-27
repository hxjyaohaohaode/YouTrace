import { create } from 'zustand';
import { db, generateLocalId, type HabitCheckinRecord } from '../db';
import { enqueueSync, flush } from '../services/syncEngine';
import { isLoggedIn } from '../services/apiClient';
import { addDays, getToday } from '../utils/date';
import { normalizeHabitFrequency } from '../utils/icons';

export interface HabitCheckinDay {
  date: string;
  done: boolean;
}

export interface HabitItem {
  id: string;
  name: string;
  icon: string;
  frequency: 'daily' | 'weekly';
  sortOrder: number;
  createdAt: number;
}

export interface HabitView extends HabitItem {
  done: boolean;
  streak: number;
  recentCheckins: HabitCheckinDay[];
}

const HABIT_DOMAIN_MAP: Array<{ keywords: string[]; domain: string }> = [
  { keywords: ['跑', '运动', '健身', '锻炼', '游泳', '瑜伽'], domain: '健康' },
  { keywords: ['读', '学', '单词', '背', '课', '写日记'], domain: '学习' },
  { keywords: ['水', '早睡', '早起', '冥想'], domain: '生活' },
];

function inferDomain(habitName: string): string | null {
  for (const rule of HABIT_DOMAIN_MAP) {
    if (rule.keywords.some((kw) => habitName.includes(kw))) return rule.domain;
  }
  return null;
}

async function propagateToGoals(habitName: string) {
  try {
    const { useGoalStore } = await import('./goalStore');
    const domain = inferDomain(habitName);
    if (!domain) return;

    const goals = useGoalStore.getState().items.filter(
      (g) => g.domain === domain && g.progress < 100
    );
    for (const goal of goals) {
      const increment = goal.level === 'short' ? 5 : goal.level === 'medium' ? 2 : 1;
      const newProgress = Math.min(100, goal.progress + increment);
      if (newProgress !== goal.progress) {
        await useGoalStore.getState().updateProgress(goal.id, newProgress);
        if (newProgress >= 100) {
          const { toast } = await import('../services/toastBus');
          toast.success(`🎉 目标「${goal.title}」已完成！`);
        }
      }
    }
  } catch {
    // goal propagation is best-effort
  }
}

interface HabitState {
  items: HabitView[];
  loaded: boolean;

  loadFromDB: () => Promise<void>;
  addHabit: (habit: { name: string; icon: string; frequency: 'daily' | 'weekly' }) => Promise<HabitView>;
  toggleHabit: (id: string, date?: string) => Promise<void>;
  removeHabit: (id: string) => Promise<void>;
}

function deriveViews(habits: HabitItem[], checkins: HabitCheckinRecord[]): HabitView[] {
  const today = getToday();
  const doneDatesByHabit = new Map<string, Set<string>>();
  for (const checkin of checkins) {
    if (!checkin.done) continue;
    let dates = doneDatesByHabit.get(checkin.habitId);
    if (!dates) {
      dates = new Set();
      doneDatesByHabit.set(checkin.habitId, dates);
    }
    dates.add(checkin.date);
  }

  const recentDates: string[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    recentDates.push(addDays(today, -offset));
  }

  return [...habits]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((habit) => {
      const doneDates = doneDatesByHabit.get(habit.id) ?? new Set<string>();
      const done = doneDates.has(today);

      let streak = 0;
      let cursor = done ? today : addDays(today, -1);
      while (doneDates.has(cursor)) {
        streak += 1;
        cursor = addDays(cursor, -1);
      }

      return {
        ...habit,
        done,
        streak,
        recentCheckins: recentDates.map((date) => ({ date, done: doneDates.has(date) })),
      };
    });
}

export const useHabitStore = create<HabitState>((set, get) => ({
  items: [],
  loaded: false,

  loadFromDB: async () => {
    const [habits, checkins] = await Promise.all([
      db.habits.toArray(),
      db.habitCheckins.toArray(),
    ]);
    set({ items: deriveViews(habits, checkins), loaded: true });
  },

  addHabit: async (habit) => {
    const now = Date.now();
    const maxSortOrder = get().items.reduce((max, item) => Math.max(max, item.sortOrder), 0);
    const item: HabitItem = {
      id: generateLocalId(),
      name: habit.name,
      icon: habit.icon || '✨',
      frequency: normalizeHabitFrequency(habit.frequency),
      sortOrder: maxSortOrder + 1,
      createdAt: now,
    };

    await db.habits.put(item);
    const allCheckins = await db.habitCheckins.toArray();
    set((state) => ({
      items: deriveViews([...state.items, item], allCheckins),
    }));

    if (isLoggedIn()) {
      await enqueueSync('habits', 'upsert', {
        id: item.id,
        name: item.name,
        icon: item.icon,
        frequency: item.frequency,
        sortOrder: item.sortOrder,
      });
      void flush();
    }

    return { ...item, done: false, streak: 0, recentCheckins: [] };
  },

  toggleHabit: async (id, date) => {
    const target = date || getToday();
    const habit = get().items.find((h) => h.id === id);
    if (!habit) return;

    const existing = await db.habitCheckins.get(`${id}|${target}`);
    const nextDone = !(existing?.done ?? false);

    const record: HabitCheckinRecord = {
      id: `${id}|${target}`,
      habitId: id,
      date: target,
      done: nextDone,
      source: 'manual',
      confirmed: true,
      updatedAt: Date.now(),
    };

    await db.habitCheckins.put(record);
    await useHabitStore.getState().loadFromDB();

    if (nextDone) {
      void propagateToGoals(habit.name);
    }

    if (isLoggedIn()) {
      await enqueueSync('habitCheckins', 'upsert', {
        habitId: record.habitId,
        date: record.date,
        done: record.done,
        source: record.source,
      });
      void flush();
    }
  },

  removeHabit: async (id) => {
    await db.transaction('rw', db.habits, db.habitCheckins, async () => {
      await db.habitCheckins.where('habitId').equals(id).delete();
      await db.habits.delete(id);
    });
    set((state) => ({ items: state.items.filter((h) => h.id !== id) }));

    if (isLoggedIn()) {
      await enqueueSync('habits', 'delete', id);
      void flush();
    }
  },
}));
