import client from './client';
import type { Goal, ApiResponse } from '../types';

export const goalApi = {
  getList: async (): Promise<ApiResponse<Goal[]>> => {
    const response = await client.get('/api/goals');
    return response.data;
  },

  create: async (data: { title: string; description?: string; deadline?: string }): Promise<ApiResponse<Goal>> => {
    const response = await client.post('/api/goals', data);
    return response.data;
  },

  update: async (id: string, data: { title?: string; description?: string; deadline?: string; progress?: number; status?: string }): Promise<ApiResponse<Goal>> => {
    const response = await client.put(`/api/goals/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<ApiResponse> => {
    const response = await client.delete(`/api/goals/${id}`);
    return response.data;
  },

  breakdown: async (id: string): Promise<ApiResponse<Goal>> => {
    const response = await client.post(`/api/goals/${id}/breakdown`);
    return response.data;
  },
};
