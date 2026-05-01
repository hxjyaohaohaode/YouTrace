import client from './client';
import type { NotificationItem, ApiResponse } from '../types';

interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  unreadCount: number;
}

export const notificationApi = {
  getList: async (page = 1, pageSize = 20): Promise<ApiResponse<NotificationListResponse>> => {
    const response = await client.get('/api/notifications', {
      params: { page, pageSize },
    });
    return response.data;
  },

  markAsRead: async (id: string): Promise<ApiResponse<NotificationItem>> => {
    const response = await client.put(`/api/notifications/${id}/read`);
    return response.data;
  },

  markAllAsRead: async (): Promise<ApiResponse> => {
    const response = await client.put('/api/notifications/read-all');
    return response.data;
  },

  delete: async (id: string): Promise<ApiResponse> => {
    const response = await client.delete(`/api/notifications/${id}`);
    return response.data;
  },
};
