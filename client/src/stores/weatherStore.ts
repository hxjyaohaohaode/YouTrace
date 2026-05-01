import { create } from 'zustand';
import { weatherApi } from '../api/weather';
import type { WeatherNowData, WeatherForecastData } from '../types';
import { extractErrorMessage } from '../utils/error';

interface WeatherState {
  currentWeather: WeatherNowData | null;
  forecast: WeatherForecastData | null;
  isLoading: boolean;
  error: string | null;

  refreshAll: (params?: { lng?: number; lat?: number; location?: string }) => Promise<void>;
  clearError: () => void;
}

export const useWeatherStore = create<WeatherState>((set) => ({
  currentWeather: null,
  forecast: null,
  isLoading: false,
  error: null,

  refreshAll: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const [nowRes, forecastRes] = await Promise.all([
        weatherApi.getNow(params),
        weatherApi.getForecast({ ...params, days: '7d' }),
      ]);

      const updates: Partial<WeatherState> = { isLoading: false };
      if (nowRes.success && nowRes.data) updates.currentWeather = nowRes.data;
      if (forecastRes.success && forecastRes.data) updates.forecast = forecastRes.data;

      set(updates);
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '获取天气失败'), isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
