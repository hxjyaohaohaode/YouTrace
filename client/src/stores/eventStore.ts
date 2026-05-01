import { create } from 'zustand';
import type { EventItem } from '../types';
import { eventApi } from '../api/event';
import { extractErrorMessage } from '../utils/error';

interface EventState {
  events: EventItem[];
  isLoading: boolean;
  error: string | null;
  fetchEvents: (start?: string, end?: string) => Promise<void>;
  createEvent: (data: {
    title: string; description?: string; startTime: string; endTime: string;
    isAllDay?: boolean; color?: string; goalId?: string; reminderMinutes?: number;
    isCourse?: boolean; courseWeekStart?: number; courseWeekEnd?: number; courseDayOfWeek?: number;
    courseStartSec?: number; courseEndSec?: number; courseTeacher?: string; courseLocation?: string;
    courseAdjust?: string;
  }) => Promise<{ hasConflict: boolean; conflicts: { id: string; title: string }[] } | null>;
  updateEvent: (id: string, data: Partial<{
    title: string; description: string; startTime: string; endTime: string;
    isAllDay: boolean; recurrenceRule: string; color: string; goalId: string; reminderMinutes: number;
    isCourse: boolean; courseWeekStart: number; courseWeekEnd: number; courseDayOfWeek: number;
    courseStartSec: number; courseEndSec: number; courseTeacher: string; courseLocation: string;
    courseAdjust: string;
  }>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useEventStore = create<EventState>((set) => ({
  events: [],
  isLoading: false,
  error: null,

  fetchEvents: async (start, end) => {
    set({ isLoading: true, error: null });
    try {
      const response = await eventApi.getList(start, end);
      if (response.success && response.data) {
        set({ events: response.data, isLoading: false });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '获取日程失败'), isLoading: false });
    }
  },

  createEvent: async (data) => {
    set({ error: null });
    try {
      const response = await eventApi.create(data);
      if (response.success && response.data) {
        const eventData = response.data;
        set((state) => ({ events: [...state.events, eventData] }));
        return {
          hasConflict: eventData.hasConflict || false,
          conflicts: eventData.conflicts || [],
        };
      }
      return null;
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '创建日程失败') });
      return null;
    }
  },

  updateEvent: async (id, data) => {
    set({ error: null });
    try {
      const response = await eventApi.update(id, data);
      if (response.success && response.data) {
        set((state) => ({
          events: state.events.map((e) => (e.id === id ? response.data! : e)),
        }));
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '更新日程失败') });
    }
  },

  deleteEvent: async (id) => {
    set({ error: null });
    try {
      await eventApi.delete(id);
      set((state) => ({ events: state.events.filter((e) => e.id !== id) }));
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '删除日程失败') });
    }
  },

  clearError: () => set({ error: null }),
}));
