import { create } from 'zustand';
import { db, getSetting, setSetting } from '../db';
import { api, isLoggedIn } from '../services/apiClient';

export type CoachStyle = 'gentle' | 'strict' | 'data';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

export interface AppSettings {
  coachStyle: CoachStyle;
  coachPushEnabled: boolean;
  coachPushFrequency: number;
  quietHours: QuietHours;
  eveningReviewEnabled: boolean;
  eveningReviewTime: string;
  theme: ThemeMode;
}

const defaultSettings: AppSettings = {
  coachStyle: 'gentle',
  coachPushEnabled: true,
  coachPushFrequency: 2,
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
  eveningReviewEnabled: true,
  eveningReviewTime: '21:00',
  theme: 'system',
};

const SERVER_SYNCED_KEYS = new Set<keyof AppSettings>(['coachStyle', 'coachPushFrequency', 'quietHours']);

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

interface SettingsState extends AppSettings {
  loaded: boolean;
  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  resetSettings: () => Promise<void>;
}

function applyTheme(theme: ThemeMode) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

const serverSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleServerSync(key: keyof AppSettings) {
  if (!isLoggedIn() || !SERVER_SYNCED_KEYS.has(key)) return;

  const existing = serverSyncTimers.get(key);
  if (existing) clearTimeout(existing);

  const send = () => {
    serverSyncTimers.delete(key);
    if (!isLoggedIn()) return;
    const state = useSettingsStore.getState();
    const body: Record<string, unknown> = {};
    if (key === 'coachStyle') body.coachStyle = state.coachStyle;
    if (key === 'coachPushFrequency') body.pushLimit = state.coachPushFrequency;
    if (key === 'quietHours') {
      body.quietStart = state.quietHours.start;
      body.quietEnd = state.quietHours.end;
    }
    void api.patch('/user/settings', body).catch(() => undefined);
  };

  if (key === 'coachStyle') {
    send();
    return;
  }

  serverSyncTimers.set(key, setTimeout(send, 800));
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaultSettings,
  loaded: false,

  loadSettings: async () => {
    const updates: Partial<AppSettings> = {};

    const quietRaw = await getSetting<Partial<QuietHours> | null>('quietHours', null);
    updates.quietHours = {
      enabled: Boolean(quietRaw?.enabled),
      start: typeof quietRaw?.start === 'string' && TIME_PATTERN.test(quietRaw.start) ? quietRaw.start : defaultSettings.quietHours.start,
      end: typeof quietRaw?.end === 'string' && TIME_PATTERN.test(quietRaw.end) ? quietRaw.end : defaultSettings.quietHours.end,
    };

    for (const key of Object.keys(defaultSettings) as (keyof AppSettings)[]) {
      if (key === 'quietHours') continue;
      const value = await getSetting(key, defaultSettings[key]);
      (updates as Record<string, unknown>)[key] = value;
    }

    set({ ...updates, loaded: true });
    applyTheme(updates.theme ?? defaultSettings.theme);

    if (isLoggedIn()) {
      void api
        .get<{ settings: { coachStyle: CoachStyle; quietStart: string; quietEnd: string; pushLimit: number } }>('/user/settings')
        .then(({ settings }) => {
          const merged: Partial<AppSettings> = {};
          if (settings.coachStyle in { gentle: 1, strict: 1, data: 1 }) {
            merged.coachStyle = settings.coachStyle;
          }
          merged.coachPushFrequency = Math.max(0, Math.min(10, settings.pushLimit));
          set(merged);
          void db.settings.put({ key: 'coachStyle', value: merged.coachStyle });
          void db.settings.put({ key: 'coachPushFrequency', value: merged.coachPushFrequency });
        })
        .catch(() => undefined);
    }
  },

  updateSetting: async (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);
    await setSetting(key, value);

    if (key === 'theme') {
      applyTheme(value as ThemeMode);
    }

    scheduleServerSync(key);
  },

  resetSettings: async () => {
    for (const key of Object.keys(defaultSettings)) {
      await db.settings.delete(key);
    }
    set({ ...defaultSettings });
    applyTheme(defaultSettings.theme);
  },
}));

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const current = useSettingsStore.getState().theme;
    if (current === 'system') {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
}
