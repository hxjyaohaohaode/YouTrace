import client from './client';
import type { EventItem, ApiResponse } from '../types';

export const eventApi = {
  getList: async (start?: string, end?: string): Promise<ApiResponse<EventItem[]>> => {
    const params: Record<string, string> = {};
    if (start) params.start = start;
    if (end) params.end = end;
    const response = await client.get('/api/events', { params });
    return response.data;
  },

  create: async (data: {
    title: string; description?: string; startTime: string; endTime: string;
    isAllDay?: boolean; recurrenceRule?: string; color?: string; goalId?: string; reminderMinutes?: number;
    isCourse?: boolean; courseWeekStart?: number; courseWeekEnd?: number; courseDayOfWeek?: number;
    courseStartSec?: number; courseEndSec?: number; courseTeacher?: string; courseLocation?: string;
    courseAdjust?: string;
  }): Promise<ApiResponse<EventItem>> => {
    const response = await client.post('/api/events', data);
    return response.data;
  },

  update: async (id: string, data: Partial<{
    title: string; description: string; startTime: string; endTime: string;
    isAllDay: boolean; recurrenceRule: string; color: string; goalId: string; reminderMinutes: number;
    isCourse: boolean; courseWeekStart: number; courseWeekEnd: number; courseDayOfWeek: number;
    courseStartSec: number; courseEndSec: number; courseTeacher: string; courseLocation: string;
    courseAdjust: string;
  }>): Promise<ApiResponse<EventItem>> => {
    const response = await client.put(`/api/events/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<ApiResponse> => {
    const response = await client.delete(`/api/events/${id}`);
    return response.data;
  },

  recognizeSchedule: async (data: {
    attachmentId: string; semesterStart: string; weekCount: number;
  }): Promise<ApiResponse> => {
    const response = await client.post('/api/schedule/recognize', data);
    return response.data;
  },

  batchCreateSchedule: async (data: {
    courses: Array<{
      title: string; teacher: string; location: string; dayOfWeek: number;
      startSection: number; endSection: number; weekStart: number; weekEnd: number;
      adjustments: Array<{ week: number; dayOfWeek: number; startSection: number; endSection: number; location?: string }>;
    }>;
    semesterStart: string; color?: string;
  }): Promise<ApiResponse> => {
    const response = await client.post('/api/schedule/batch-create', data);
    return response.data;
  },

  addHolidays: async (year: number): Promise<ApiResponse> => {
    const response = await client.post('/api/schedule/holidays', { year });
    return response.data;
  },
};
