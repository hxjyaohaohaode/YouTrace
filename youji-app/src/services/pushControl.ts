import { getSetting, setSetting } from '../db';
import { getBusinessClock, getToday } from '../utils/date';
import { useSettingsStore } from '../stores/settingsStore';

export interface PushControlState {
  todayPushCount: number;
  todayPositiveCount: number;
  todayDate: string;
  consecutiveIgnores: number;
  silenceUntil: number | null;
  maxDailyPushes: number;
  eveningReviewEnabled: boolean;
  eveningReviewTime: string;
}

async function readCounter(key: string, today: string): Promise<number> {
  const savedDate = await getSetting<string>('pushControlDate', '');
  if (savedDate !== today) {
    return 0;
  }
  return getSetting<number>(key, 0);
}

export async function getPushControlState(): Promise<PushControlState> {
  const settings = useSettingsStore.getState();
  const today = getToday();

  const savedDate = await getSetting<string>('pushControlDate', '');
  if (savedDate !== today) {
    await setSetting('pushControlDate', today);
    await setSetting('pushControlCount', 0);
    await setSetting('todayPositiveCount', 0);
  }

  const baseLimit = Math.max(0, Math.min(10, settings.coachPushFrequency));
  let maxDailyPushes = baseLimit;
  const consecutiveIgnores = await getSetting<number>('consecutiveIgnores', 0);
  if (consecutiveIgnores >= 7) {
    maxDailyPushes = 0;
  } else if (consecutiveIgnores >= 3) {
    maxDailyPushes = Math.min(maxDailyPushes, 1);
  }

  return {
    todayPushCount: await readCounter('pushControlCount', today),
    todayPositiveCount: await readCounter('todayPositiveCount', today),
    todayDate: today,
    consecutiveIgnores,
    silenceUntil: await getSetting<number | null>('silenceUntil', null),
    maxDailyPushes,
    eveningReviewEnabled: settings.eveningReviewEnabled,
    eveningReviewTime: settings.eveningReviewTime,
  };
}

export async function canPush(
  state: PushControlState,
  pushType: 'anomaly' | 'follow_up' | 'positive' | 'evening_review',
): Promise<boolean> {
  if (!useSettingsStore.getState().coachPushEnabled) {
    return false;
  }

  const now = Date.now();
  if (state.silenceUntil !== null && now < state.silenceUntil) {
    return false;
  }

  if (pushType === 'evening_review') {
    return state.eveningReviewEnabled;
  }

  if (isQuietHours(useSettingsStore.getState().quietHours)) {
    return false;
  }

  if (pushType === 'positive') {
    return state.todayPositiveCount < 1;
  }

  return state.todayPushCount < state.maxDailyPushes;
}

export async function recordPushSent(): Promise<void> {
  const count = await getSetting<number>('pushControlCount', 0);
  await setSetting('pushControlCount', count + 1);
}

export async function recordPositiveSent(): Promise<void> {
  const count = await getSetting<number>('todayPositiveCount', 0);
  await setSetting('todayPositiveCount', count + 1);
}

export async function recordPushIgnored(): Promise<void> {
  const current = await getSetting<number>('consecutiveIgnores', 0);
  await setSetting('consecutiveIgnores', current + 1);
}

export async function recordPushActed(): Promise<void> {
  await setSetting('consecutiveIgnores', 0);
}

export function isQuietHours(quietHours: { enabled: boolean; start: string; end: string }): boolean {
  if (!quietHours.enabled) return false;

  const now = getBusinessClock();
  const currentMinutes = now.hour * 60 + now.minute;

  const [startH, startM] = quietHours.start.split(':').map(Number);
  const [endH, endM] = quietHours.end.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function shouldShowEveningReview(time: string): boolean {
  const now = getBusinessClock();
  const [h, m] = time.split(':').map(Number);
  const targetMinutes = h * 60 + m;
  const currentMinutes = now.hour * 60 + now.minute;
  return Math.abs(currentMinutes - targetMinutes) <= 30;
}

export function getEveningReviewPush() {
  return {
    type: 'evening_review' as const,
    title: '今天还有什么想记录的吗？',
    body: '一天快结束了，回顾一下今天发生的事，用一句话记录下来吧。',
    actions: [
      { label: '去记录', type: 'chat' as const },
      { label: '今天够了', type: 'dismiss' as const },
    ],
  };
}
