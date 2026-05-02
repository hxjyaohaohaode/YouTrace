import { create } from 'zustand';
import { diaryApi } from '../api/diary';
import type { Diary, AttachmentItem } from '../types';
import { extractErrorMessage } from '../utils/error';

interface DiaryState {
  diaries: (Diary & { attachments: AttachmentItem[] })[];
  currentDiary: (Diary & { attachments: AttachmentItem[] }) | null;
  isLoading: boolean;
  error: string | null;
  page: number;
  totalPages: number;
  fetchDiaries: (page?: number, pageSize?: number, search?: string, emotionTag?: string) => Promise<void>;
  fetchDiary: (id: string) => Promise<void>;
  createDiary: (content: string, attachmentIds?: string[], weather?: string, location?: string) => Promise<void>;
  updateDiary: (id: string, content: string, attachmentIds?: string[], weather?: string, location?: string) => Promise<void>;
  deleteDiary: (id: string) => Promise<void>;
  analyzeDiary: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useDiaryStore = create<DiaryState>((set) => ({
  diaries: [],
  currentDiary: null,
  isLoading: false,
  error: null,
  page: 1,
  totalPages: 1,

  fetchDiaries: async (page = 1, pageSize, search, emotionTag) => {
    set({ isLoading: true, error: null });
    try {
      const response = await diaryApi.getDiaries({ page, pageSize, search, emotionTag });
      if (response.success && response.data) {
        set({
          diaries: response.data.items,
          page: response.data.page,
          totalPages: response.data.totalPages,
          isLoading: false,
        });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '获取日记列表失败'), isLoading: false });
    }
  },

  fetchDiary: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const response = await diaryApi.getDiary(id);
      if (response.success && response.data) {
        set({ currentDiary: response.data, isLoading: false });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '获取日记详情失败'), isLoading: false });
    }
  },

  createDiary: async (content: string, attachmentIds?: string[], weatherJson?: string, locationName?: string) => {
    set({ isLoading: true, error: null });
    try {
      const weather = weatherJson ? (() => { try { return JSON.parse(weatherJson) as Record<string, unknown>; } catch { return undefined; } })() : undefined;
      const response = await diaryApi.createDiary({ content, attachmentIds, weather, locationName });
      if (response.success && response.data) {
        const newDiary = response.data;
        set((state) => ({
          diaries: [newDiary, ...state.diaries],
          isLoading: false,
        }));
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '创建日记失败'), isLoading: false });
    }
  },

  updateDiary: async (id: string, content: string, attachmentIds?: string[], weatherJson?: string, locationName?: string) => {
    set({ isLoading: true, error: null });
    try {
      const weather = weatherJson ? (() => { try { return JSON.parse(weatherJson) as Record<string, unknown>; } catch { return undefined; } })() : undefined;
      const response = await diaryApi.updateDiary(id, { content, attachmentIds, weather, locationName });
      if (response.success && response.data) {
        set({ currentDiary: response.data, isLoading: false });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '更新日记失败'), isLoading: false });
    }
  },

  deleteDiary: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const response = await diaryApi.deleteDiary(id);
      if (response.success) {
        set((state) => ({
          diaries: state.diaries.filter((d) => d.id !== id),
          currentDiary: null,
          isLoading: false,
        }));
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '删除日记失败'), isLoading: false });
    }
  },

  analyzeDiary: async (id) => {
    set({ isLoading: true });
    try {
      const response = await diaryApi.analyzeDiary(id);
      if (response.success && response.data) {
        set((state) => ({
          currentDiary: state.currentDiary?.id === id
            ? { ...response.data!, attachments: state.currentDiary.attachments }
            : state.currentDiary,
          diaries: state.diaries.map((d) => d.id === id ? { ...d, ...response.data!, attachments: d.attachments } : d),
          isLoading: false,
        }));
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
