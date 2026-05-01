import { create } from 'zustand';
import { goalApi } from '../api/goal';
import type { Goal } from '../types';
import { extractErrorMessage } from '../utils/error';

interface GoalState {
  goals: Goal[];
  isLoading: boolean;
  error: string | null;
  fetchGoals: () => Promise<void>;
  createGoal: (data: { title: string; description?: string; deadline?: string }) => Promise<void>;
  updateGoal: (id: string, data: { title?: string; description?: string; deadline?: string; progress?: number; status?: string }) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  breakdownGoal: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useGoalStore = create<GoalState>((set) => ({
  goals: [],
  isLoading: false,
  error: null,

  fetchGoals: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await goalApi.getList();
      if (response.success && response.data) {
        set({ goals: response.data, isLoading: false });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '获取目标失败'), isLoading: false });
    }
  },

  createGoal: async (data) => {
    set({ error: null });
    try {
      const response = await goalApi.create(data);
      if (response.success && response.data) {
        set((state) => ({ goals: [response.data!, ...state.goals] }));
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '创建目标失败') });
    }
  },

  updateGoal: async (id, data) => {
    set({ error: null });
    try {
      const response = await goalApi.update(id, data);
      if (response.success && response.data) {
        set((state) => ({
          goals: state.goals.map((g) => (g.id === id ? response.data! : g)),
        }));
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '更新目标失败') });
    }
  },

  deleteGoal: async (id) => {
    set({ error: null });
    try {
      await goalApi.delete(id);
      set((state) => ({ goals: state.goals.filter((g) => g.id !== id) }));
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '删除目标失败') });
    }
  },

  breakdownGoal: async (id) => {
    set({ error: null });
    try {
      const response = await goalApi.breakdown(id);
      if (response.success && response.data) {
        set((state) => ({
          goals: state.goals.map((g) => (g.id === id ? response.data! : g)),
        }));
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, 'AI拆解失败') });
    }
  },

  clearError: () => set({ error: null }),
}));
