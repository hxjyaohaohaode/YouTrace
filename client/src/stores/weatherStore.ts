import { create } from 'zustand';
import { weatherApi } from '../api/weather';
import type { WeatherNowData, WeatherForecastData } from '../types';
import { extractErrorMessage } from '../utils/error';
import { useLocationStore } from './locationStore';

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
      let finalParams = { ...params };

      if (finalParams.lng == null || finalParams.lat == null) {
        const locState = useLocationStore.getState();
        const coords = locState.coords;
        if (coords?.lng != null && coords?.lat != null) {
          finalParams.lng = coords.lng;
          finalParams.lat = coords.lat;
        } else {
          try {
            const result = await locState.requestBrowserLocation();
            if (result) {
              finalParams.lng = result.lng;
              finalParams.lat = result.lat;
            }
          } catch {
            // 浏览器定位失败，回退到IP定位
          }
        }
      }

      const [nowRes, forecastRes] = await Promise.all([
        weatherApi.getNow(finalParams),
        weatherApi.getForecast({ ...finalParams, days: '7d' }),
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
