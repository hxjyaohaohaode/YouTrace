import client from './client';
import type { ApiResponse } from '../types';

export interface TriggerItem {
    id: string;
    userId: string;
    type: string;
    config: Record<string, unknown>;
    isActive: boolean;
    lastTriggeredAt: string | null;
    createdAt: string;
}

export const triggerApi = {
    getList: async (): Promise<ApiResponse<TriggerItem[]>> => {
        const response = await client.get('/api/triggers');
        return response.data;
    },

    update: async (id: string, data: { isActive?: boolean; config?: Record<string, unknown> }): Promise<ApiResponse<TriggerItem>> => {
        const response = await client.put(`/api/triggers/${id}`, data);
        return response.data;
    },
};
