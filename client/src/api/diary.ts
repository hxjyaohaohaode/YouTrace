import client from './client';
import type { ApiResponse, Diary, AttachmentItem } from '../types';

export interface DiaryStats {
  totalDiaries: number;
  averageScore: number;
  streak: number;
  thisMonthCount: number;
  emotionTrend: { date: string; score: number }[];
  topEmotions: { score: number; count: number }[];
  wordCloud: { word: string; count: number }[];
}

export const diaryApi = {
  getDiaries: async (params?: { page?: number; pageSize?: number; search?: string; emotionTag?: string }): Promise<ApiResponse<{ items: (Diary & { attachments: AttachmentItem[] })[]; total: number; page: number; pageSize: number; totalPages: number }>> => {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set('page', String(params.page));
    if (params?.pageSize) queryParams.set('pageSize', String(params.pageSize));
    if (params?.search) queryParams.set('search', params.search);
    if (params?.emotionTag) queryParams.set('emotionTag', params.emotionTag);
    const response = await client.get(`/api/diaries?${queryParams.toString()}`);
    return response.data;
  },

  getDiary: async (id: string): Promise<ApiResponse<Diary & { attachments: AttachmentItem[] }>> => {
    const response = await client.get(`/api/diaries/${id}`);
    return response.data;
  },

  createDiary: async (data: { content: string; mediaUrls?: string[]; attachmentIds?: string[]; weather?: Record<string, unknown>; locationName?: string; locationLat?: number; locationLng?: number }): Promise<ApiResponse<Diary & { attachments: AttachmentItem[] }>> => {
    const response = await client.post('/api/diaries', data);
    return response.data;
  },

  updateDiary: async (id: string, data: { content?: string; mediaUrls?: string[]; attachmentIds?: string[]; weather?: Record<string, unknown>; locationName?: string; locationLat?: number; locationLng?: number }): Promise<ApiResponse<Diary & { attachments: AttachmentItem[] }>> => {
    const response = await client.put(`/api/diaries/${id}`, data);
    return response.data;
  },

  deleteDiary: async (id: string): Promise<ApiResponse<null>> => {
    const response = await client.delete(`/api/diaries/${id}`);
    return response.data;
  },

  analyzeDiary: async (id: string): Promise<ApiResponse<Diary>> => {
    const response = await client.post(`/api/diaries/${id}/analyze`);
    return response.data;
  },

  exportDiaries: async (): Promise<ApiResponse<unknown[]>> => {
    const response = await client.get('/api/diaries/export');
    return response.data;
  },

  stats: async (period: string): Promise<ApiResponse<DiaryStats>> => {
    const response = await client.get(`/api/diaries/stats?period=${period}`);
    return response.data;
  },
};
