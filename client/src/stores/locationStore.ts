import { create } from 'zustand';
import { locationApi } from '../api/location';
import type { LocationInfo } from '../types';
import { extractErrorMessage } from '../utils/error';

interface LocationState {
  location: LocationInfo | null;
  coords: { lng: number; lat: number } | null;
  searchResults: LocationInfo[];
  isLoading: boolean;
  error: string | null;
  permissionStatus: 'granted' | 'denied' | 'prompt' | 'unavailable';

  fetchLocation: (params?: { lng?: number; lat?: number }) => Promise<void>;
  requestBrowserLocation: () => Promise<{ lng: number; lat: number } | null>;
  searchCity: (keyword: string) => Promise<void>;
  clearSearch: () => void;
  clearError: () => void;
}

const LOCATION_PERSIST_KEY = 'youji_location_coords';
const LOCATION_DATA_KEY = 'youji_location_data';

function loadPersistedCoords(): { lng: number; lat: number } | null {
  try {
    const raw = localStorage.getItem(LOCATION_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.lng === 'number' && typeof parsed.lat === 'number') {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function persistCoords(coords: { lng: number; lat: number } | null) {
  if (coords) {
    localStorage.setItem(LOCATION_PERSIST_KEY, JSON.stringify(coords));
  } else {
    localStorage.removeItem(LOCATION_PERSIST_KEY);
  }
}

function loadPersistedLocationData(): LocationInfo | null {
  try {
    const raw = localStorage.getItem(LOCATION_DATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocationInfo;
  } catch { /* ignore */ }
  return null;
}

function persistLocationData(data: LocationInfo | null) {
  if (data) {
    localStorage.setItem(LOCATION_DATA_KEY, JSON.stringify(data));
  } else {
    localStorage.removeItem(LOCATION_DATA_KEY);
  }
}

export const useLocationStore = create<LocationState>((set, get) => ({
  location: loadPersistedLocationData(),
  coords: loadPersistedCoords(),
  searchResults: [],
  isLoading: false,
  error: null,
  permissionStatus: 'prompt',

  fetchLocation: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const response = await locationApi.getLocation(params);
      if (response.success && response.data) {
        set({ location: response.data, isLoading: false });
        persistLocationData(response.data);
      } else {
        set({ error: response.message || '定位失败', isLoading: false });
      }
    } catch (error: unknown) {
      set({ error: extractErrorMessage(error, '定位失败'), isLoading: false });
    }
  },

  requestBrowserLocation: async () => {
    if (!navigator.geolocation) {
      set({ permissionStatus: 'unavailable' });
      const persisted = loadPersistedCoords();
      return persisted;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 300000,
        });
      });

      const lng = position.coords.longitude;
      const lat = position.coords.latitude;

      set({ permissionStatus: 'granted', coords: { lng, lat } });
      persistCoords({ lng, lat });

      try {
        await get().fetchLocation({ lng, lat });
      } catch {
        // 即使逆地理编码失败，坐标仍然有效
      }

      return { lng, lat };
    } catch (err) {
      const geoError = err as GeolocationPositionError;
      if (geoError.code === 1) {
        set({ permissionStatus: 'denied' });
      } else if (geoError.code === 2 || geoError.code === 3) {
        set({ permissionStatus: 'prompt' });
      }

      const persisted = loadPersistedCoords();
      if (persisted) {
        try {
          await get().fetchLocation({ lng: persisted.lng, lat: persisted.lat });
        } catch { /* ignore */ }
      }
      return persisted;
    }
  },

  searchCity: async (keyword) => {
    if (!keyword || keyword.trim().length === 0) {
      set({ searchResults: [] });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const response = await locationApi.searchCity(keyword.trim());
      if (response.success && response.data) {
        set({ searchResults: response.data, isLoading: false });
      } else {
        set({ searchResults: [], isLoading: false });
      }
    } catch {
      set({ searchResults: [], isLoading: false });
    }
  },

  clearSearch: () => set({ searchResults: [] }),

  clearError: () => set({ error: null }),
}));
