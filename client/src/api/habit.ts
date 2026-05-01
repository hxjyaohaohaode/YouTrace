import client from './client';
import type { Habit } from '../types';
import type { ApiResponse } from '../types';

interface CreateHabitData {
  title: string;
  description?: string;
  frequency?: string;
  targetDays?: number;
  goalId?: string;
}

interface UpdateHabitData {
  title?: string;
  description?: string;
  frequency?: string;
  targetDays?: number;
  goalId?: string;
}

export const habitApi = {
  list: async (): Promise<ApiResponse<Habit[]>> => {
    const res = await client.get('/api/habits');
    return res.data;
  },

  create: async (data: CreateHabitData): Promise<ApiResponse<Habit>> => {
    const res = await client.post('/api/habits', data);
    return res.data;
  },

  update: async (id: string, data: UpdateHabitData): Promise<ApiResponse<Habit>> => {
    const res = await client.put(`/api/habits/${id}`, data);
    return res.data;
  },

  delete: async (id: string): Promise<ApiResponse> => {
    const res = await client.delete(`/api/habits/${id}`);
    return res.data;
  },

  toggle: async (id: string, date?: string): Promise<ApiResponse<{ streakCurrent: number; streakLongest: number }>> => {
    const res = await client.post(`/api/habits/${id}/toggle`, { date });
    return res.data;
  },
};
