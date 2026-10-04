import { create } from 'zustand';
import { db, generateLocalId, type HabitCheckinRecord } from '../db';
import { commitLocalMutation } from '../services/localMutation';
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

    await commitLocalMutation('habits', 'upsert', item, () => db.habits.put(item));
    const allCheckins = await db.habitCheckins.toArray();
    set((state) => ({
      items: deriveViews([...state.items, item], allCheckins),
    }));


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

    await commitLocalMutation('habitCheckins', 'upsert', record, () => db.habitCheckins.put(record), undefined, existing ?? null);
    await useHabitStore.getState().loadFromDB();


  },

  removeHabit: async (id) => {
    const habit = get().items.find((item) => item.id === id);
    if (!habit) return;
    const { id: habitId, name, icon, frequency, sortOrder, createdAt } = habit;
    const expected = { id: habitId, name, icon, frequency, sortOrder, createdAt };
    await commitLocalMutation('habits', 'delete', id, async () => {
      await db.habitCheckins.where('habitId').equals(id).delete();
      await db.habits.delete(id);
    }, [db.habits, db.habitCheckins], expected);
    set((state) => ({ items: state.items.filter((h) => h.id !== id) }));

  },
}));
