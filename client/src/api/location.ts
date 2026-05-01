import client from './client';
import type { ApiResponse, LocationInfo } from '../types';

export const locationApi = {
  getLocation: async (params?: { lng?: number; lat?: number }): Promise<ApiResponse<LocationInfo>> => {
    const query: Record<string, string> = {};
    if (params?.lng != null) query.lng = String(params.lng);
    if (params?.lat != null) query.lat = String(params.lat);
    const searchParams = new URLSearchParams(query).toString();
    const url = searchParams ? `/api/location?${searchParams}` : '/api/location';
    const response = await client.get(url);
    return response.data;
  },

  searchCity: async (keyword: string): Promise<ApiResponse<LocationInfo[]>> => {
    const response = await client.get(`/api/location/search?keyword=${encodeURIComponent(keyword)}`);
    return response.data;
  },
};
