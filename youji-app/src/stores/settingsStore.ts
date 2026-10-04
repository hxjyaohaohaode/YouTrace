import { create } from 'zustand';
import { db, getSetting, generateLocalId } from '../db';
import { api, isLoggedIn } from '../services/apiClient';
import { toast } from '../services/toastBus';

export type CoachStyle = 'gentle' | 'strict' | 'data';
export type ThemeMode = 'light' | 'dark' | 'system';
export interface QuietHours { enabled: boolean; start: string; end: string }
export interface AppSettings { coachStyle: CoachStyle; coachPushEnabled: boolean; coachPushFrequency: number; quietHours: QuietHours; eveningReviewEnabled: boolean; eveningReviewTime: string; theme: ThemeMode }
const defaultSettings: AppSettings = { coachStyle: 'gentle', coachPushEnabled: true, coachPushFrequency: 2, quietHours: { enabled: false, start: '23:00', end: '07:00' }, eveningReviewEnabled: true, eveningReviewTime: '21:00', theme: 'system' };
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const SERVER_KEYS = new Set<keyof AppSettings>(['coachStyle', 'coachPushFrequency', 'quietHours']);
const revisions = new Map<keyof AppSettings, number>();
const sendQueues = new Map<keyof AppSettings, Promise<void>>();
const timers = new Map<keyof AppSettings, ReturnType<typeof setTimeout>>();
const pendingKey = (key: keyof AppSettings) => `pendingSetting:${key}`;
interface PendingSetting { id: string; body: Record<string, unknown> }
interface SettingsState extends AppSettings {
  loaded: boolean;
  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  resetSettings: () => Promise<void>;
}
function applyTheme(theme: ThemeMode) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme);
}
function serverBody<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Record<string, unknown> {
  if (key === 'coachStyle') return { coachStyle: value };
  if (key === 'coachPushFrequency') return { pushLimit: value };
  const quiet = value as QuietHours;
  return { quietStart: quiet.start, quietEnd: quiet.end };
}
function scheduleServerSync(key: keyof AppSettings, pending: PendingSetting) {
  const existing = timers.get(key); if (existing) clearTimeout(existing);
  const send = async () => {
    timers.delete(key);
    if (!isLoggedIn()) return;
    try {
      const current = await getSetting<PendingSetting | null>(pendingKey(key), null);
      if (current?.id !== pending.id) return;
      await api.patch('/user/settings', pending.body);
      await db.transaction('rw', db.settings, async () => {
        const current = await getSetting<PendingSetting | null>(pendingKey(key), null);
        if (current?.id === pending.id) await db.settings.delete(pendingKey(key));
      });
    } catch { toast.warning('偏好已保存在本设备，云端暂未确认；下次打开应用会重试'); }
  };
  timers.set(key, setTimeout(() => {
    const previous = sendQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => {
      if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`youtrace-settings:${db.name}:${key}`, send);
      return send();
    });
    sendQueues.set(key, next);
    void next.finally(() => { if (sendQueues.get(key) === next) sendQueues.delete(key); });
  }, key === 'coachStyle' ? 0 : 800));
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaultSettings, loaded: false,
  loadSettings: async () => {
    const started = new Map(revisions);
    const updates: Partial<AppSettings> = {};
    const pending = new Map<keyof AppSettings, PendingSetting>();
    for (const key of Object.keys(defaultSettings) as (keyof AppSettings)[]) {
      const value = await getSetting(key, defaultSettings[key]);
      if (key === 'quietHours') {
        const raw = value as Partial<QuietHours>;
        updates.quietHours = { enabled: Boolean(raw?.enabled), start: typeof raw?.start === 'string' && TIME_PATTERN.test(raw.start) ? raw.start : '23:00', end: typeof raw?.end === 'string' && TIME_PATTERN.test(raw.end) ? raw.end : '07:00' };
      } else (updates as Record<string, unknown>)[key] = value;
      const waiting = await getSetting<PendingSetting | null>(pendingKey(key), null);
      if (waiting) pending.set(key, waiting);
    }
    for (const key of Object.keys(updates) as (keyof AppSettings)[]) if (revisions.get(key) !== started.get(key)) delete updates[key];
    set({ ...updates, loaded: true });
    applyTheme(useSettingsStore.getState().theme);
    for (const [key, waiting] of pending) scheduleServerSync(key, waiting);
    if (!isLoggedIn()) return;
    void api.get<{ settings: { coachStyle: CoachStyle; quietStart: string; quietEnd: string; pushLimit: number } }>('/user/settings').then(async ({ settings }) => {
      const merged: Partial<AppSettings> = {};
      const untouched = (key: keyof AppSettings) => !pending.has(key) && revisions.get(key) === started.get(key);
      if (untouched('coachStyle') && settings.coachStyle in { gentle: 1, strict: 1, data: 1 }) merged.coachStyle = settings.coachStyle;
      if (untouched('coachPushFrequency') && Number.isFinite(settings.pushLimit)) merged.coachPushFrequency = Math.max(0, Math.min(10, settings.pushLimit));
      if (untouched('quietHours') && TIME_PATTERN.test(settings.quietStart) && TIME_PATTERN.test(settings.quietEnd)) merged.quietHours = { ...useSettingsStore.getState().quietHours, start: settings.quietStart, end: settings.quietEnd };
      await db.transaction('rw', db.settings, async () => {
        for (const key of Object.keys(merged) as (keyof AppSettings)[]) {
          if (!untouched(key) || await db.settings.get(pendingKey(key))) { delete merged[key]; continue; }
          await db.settings.put({ key, value: merged[key] });
        }
      });
      // Check once more after the transaction: user input can arrive while it commits.
      for (const key of Object.keys(merged) as (keyof AppSettings)[]) if (!untouched(key)) delete merged[key];
      set(merged);
    }).catch(() => undefined);
  },
  updateSetting: async (key, value) => {
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
    const pending = SERVER_KEYS.has(key) && db.ownerId ? { id: generateLocalId(), body: serverBody(key, value) } : null;
    await db.transaction('rw', db.settings, async () => {
      await db.settings.put({ key, value });
      if (pending) await db.settings.put({ key: pendingKey(key), value: pending });
    });
    set({ [key]: value } as Partial<SettingsState>);
    if (key === 'theme') applyTheme(value as ThemeMode);
    if (pending) scheduleServerSync(key, pending);
  },
  resetSettings: async () => {
    for (const key of Object.keys(defaultSettings) as (keyof AppSettings)[]) await useSettingsStore.getState().updateSetting(key, defaultSettings[key]);
  },
}));
if (typeof window !== 'undefined') window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
  if (useSettingsStore.getState().theme === 'system') document.documentElement.setAttribute('data-theme', event.matches ? 'dark' : 'light');
});
