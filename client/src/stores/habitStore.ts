import { create } from 'zustand';
import { habitApi } from '../api/habit';
import type { Habit } from '../types';

interface HabitState {
  habits: Habit[];
  isLoading: boolean;
  error: string | null;
  fetchHabits: () => Promise<void>;
  createHabit: (data: { title: string; description?: string; frequency?: string; targetDays?: number }) => Promise<void>;
  updateHabit: (id: string, data: { title?: string; description?: string; frequency?: string; targetDays?: number }) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  toggleHabit: (id: string, date?: string) => Promise<void>;
}

export const useHabitStore = create<HabitState>((set) => ({
  habits: [],
  isLoading: false,
  error: null,

  fetchHabits: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await habitApi.list();
      if (response.success && response.data) {
        set({ habits: response.data, isLoading: false });
      }
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createHabit: async (data) => {
    set({ error: null });
    try {
      const response = await habitApi.create(data);
      if (response.success && response.data) {
        set((state) => ({ habits: [response.data!, ...state.habits] }));
      }
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  updateHabit: async (id, data) => {
    set({ error: null });
    try {
      const response = await habitApi.update(id, data);
      if (response.success && response.data) {
        set((state) => ({
          habits: state.habits.map((h) => (h.id === id ? response.data! : h)),
        }));
      }
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  deleteHabit: async (id) => {
    set({ error: null });
    try {
      await habitApi.delete(id);
      set((state) => ({ habits: state.habits.filter((h) => h.id !== id) }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  toggleHabit: async (id, date) => {
    set({ error: null });
    try {
      const response = await habitApi.toggle(id, date);
      if (response.success && response.data) {
        const { streakCurrent, streakLongest } = response.data;
        set((state) => ({
          habits: state.habits.map((h) => {
            if (h.id !== id) return h;
            const wasCompleted = h.todayCompleted;
            return {
              ...h,
              todayCompleted: !wasCompleted,
              streakCurrent,
              streakLongest,
              recentLogs: h.recentLogs
                ? [
                    { date: date || new Date().toISOString().slice(0, 10), isCompleted: !wasCompleted },
                    ...h.recentLogs.filter((l) => l.date !== (date || new Date().toISOString().slice(0, 10))).slice(0, 6),
                  ]
                : [{ date: date || new Date().toISOString().slice(0, 10), isCompleted: !wasCompleted }],
            };
          }),
        }));
      }
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },
}));
