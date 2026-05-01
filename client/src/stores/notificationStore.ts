import { create } from 'zustand';
import { notificationApi } from '../api/notification';
import type { NotificationItem } from '../types';
import { extractErrorMessage } from '../utils/error';

interface NotificationState {
  notifications: NotificationItem[];
  unreadCount: number;
  total: number;
  page: number;
  totalPages: number;
  isLoading: boolean;
  latestNotification: NotificationItem | null;
  error: string | null;

  fetchNotifications: (page?: number) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  setLatestNotification: (notification: NotificationItem | null) => void;
  clearError: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  total: 0,
  page: 1,
  totalPages: 1,
  isLoading: false,
  latestNotification: null,
  error: null,

  fetchNotifications: async (page = 1) => {
    set({ isLoading: true, error: null });
    try {
      const response = await notificationApi.getList(page);
      if (response.success && response.data) {
        const data = response.data;
        set((state) => ({
          notifications: page === 1 ? data.items : [...state.notifications, ...data.items],
          total: data.total,
          page: data.page,
          totalPages: data.totalPages,
          unreadCount: data.unreadCount,
          isLoading: false,
        }));
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '获取通知失败'), isLoading: false });
    }
  },

  markAsRead: async (id) => {
    try {
      const response = await notificationApi.markAsRead(id);
      if (response.success && response.data) {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, isRead: true } : n
          ),
          unreadCount: Math.max(0, state.unreadCount - 1),
        }));
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '标记已读失败') });
    }
  },

  markAllAsRead: async () => {
    try {
      await notificationApi.markAllAsRead();
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0,
      }));
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '标记全部已读失败') });
    }
  },

  deleteNotification: async (id) => {
    try {
      await notificationApi.delete(id);
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
        total: state.total - 1,
      }));
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '删除通知失败') });
    }
  },

  setLatestNotification: (notification) => {
    set({ latestNotification: notification });
  },

  clearError: () => set({ error: null }),
}));
