import client from './client';
import type { ApiResponse, WeatherNowData, WeatherForecastData, WeatherSummaryData } from '../types';

function buildQuery(params: { location?: string; lng?: number; lat?: number; days?: '3d' | '7d' | '10d' | '15d' }): string {
  const query: Record<string, string> = {};
  if (params.location) query.location = params.location;
  if (params.lng != null) query.lng = String(params.lng);
  if (params.lat != null) query.lat = String(params.lat);
  if (params.days) query.days = params.days;
  const searchParams = new URLSearchParams(query).toString();
  return searchParams ? `?${searchParams}` : '';
}

export const weatherApi = {
  getNow: async (params?: { location?: string; lng?: number; lat?: number; days?: '3d' | '7d' | '10d' | '15d' }): Promise<ApiResponse<WeatherNowData>> => {
    const response = await client.get(`/api/weather/now${buildQuery(params || {})}`);
    return response.data;
  },

  getForecast: async (params?: { location?: string; lng?: number; lat?: number; days?: '3d' | '7d' | '10d' | '15d' }): Promise<ApiResponse<WeatherForecastData>> => {
    const response = await client.get(`/api/weather/forecast${buildQuery(params || {})}`);
    return response.data;
  },

  getSummary: async (params?: { location?: string; lng?: number; lat?: number; days?: '3d' | '7d' | '10d' | '15d' }): Promise<ApiResponse<WeatherSummaryData>> => {
    const response = await client.get(`/api/weather/summary${buildQuery(params || {})}`);
    return response.data;
  },
};
