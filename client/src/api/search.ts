import client from './client';
import type { ApiResponse } from '../types';

export interface SearchResultItem {
    id: string;
    type: string;
    title: string;
    content: string;
    highlight: string;
    date: string;
    extra?: Record<string, unknown>;
}

export interface SearchCategoryResult {
    category: string;
    label: string;
    icon: string;
    items: SearchResultItem[];
    total: number;
}

export interface SearchResponse {
    results: SearchCategoryResult[];
    total: number;
    query: string;
}

export const searchApi = {
    globalSearch: async (params: {
        q?: string;
        categories?: string;
        date?: string;
        limit?: number;
    }): Promise<ApiResponse<SearchResponse>> => {
        const queryParams = new URLSearchParams();
        if (params.q) queryParams.set('q', params.q);
        if (params.categories) queryParams.set('categories', params.categories);
        if (params.date) queryParams.set('date', params.date);
        if (params.limit) queryParams.set('limit', String(params.limit));
        const response = await client.get(`/api/search?${queryParams.toString()}`);
        return response.data;
    },
};
