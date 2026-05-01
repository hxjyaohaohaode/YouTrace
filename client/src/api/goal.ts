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

  askQuestions: async (goalId: string): Promise<ApiResponse<{ questions: Array<{ question: string; context: string }> }>> => {
    const response = await client.post('/api/goals/ask-questions', { goalId });
    return response.data;
  },

  generatePlan: async (goalId: string, answers: Array<{ question: string; answer: string }>): Promise<ApiResponse<{
    plan: {
      summary: string;
      milestones: Array<{ step: number; title: string; duration: string; startDate?: string; endDate?: string; tasks?: string[] }>;
      tips: string[];
    };
  }>> => {
    const response = await client.post('/api/goals/generate-plan', { goalId, answers });
    return response.data;
  },

  confirmPlan: async (goalId: string, plan: {
    summary: string;
    milestones: Array<{ step: number; title: string; duration: string; startDate?: string; endDate?: string; tasks?: string[] }>;
    tips: string[];
  }): Promise<ApiResponse<{ createdEvents: number }>> => {
    const response = await client.post('/api/goals/confirm-plan', { goalId, plan });
    return response.data;
  },
};
