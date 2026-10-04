import { db, getSetting, setSetting } from '../db';
import { getBusinessClock, getToday } from '../utils/date';
import { readPersistedReminderSettings } from '../stores/settingsStore';

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
  const settings = await readPersistedReminderSettings();
  const today = getToday();

  const counters = await db.transaction('rw', db.settings, async () => {
    const savedDate = await getSetting<string>('pushControlDate', '');
    if (savedDate !== today) {
      await setSetting('pushControlDate', today);
      await setSetting('pushControlCount', 0);
      await setSetting('todayPositiveCount', 0);
    }
    return {
      total: await readCounter('pushControlCount', today),
      positive: await readCounter('todayPositiveCount', today),
    };
  });

  const baseLimit = Number.isFinite(settings.coachPushFrequency)
    ? Math.max(0, Math.min(10, Math.floor(settings.coachPushFrequency))) : 0;
  let maxDailyPushes = baseLimit;
  const consecutiveIgnores = await getSetting<number>('consecutiveIgnores', 0);
  if (consecutiveIgnores >= 7) {
    maxDailyPushes = 0;
  } else if (consecutiveIgnores >= 3) {
    maxDailyPushes = Math.min(maxDailyPushes, 1);
  }

  return {
    todayPushCount: counters.total,
    todayPositiveCount: counters.positive,
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
  const settings = await readPersistedReminderSettings();
  if (!settings.coachPushEnabled) {
    return false;
  }

  const now = Date.now();
  if (state.silenceUntil !== null && now < state.silenceUntil) {
    return false;
  }

  // Quiet hours and the total daily budget apply to every reminder type,
  // including encouragement and the optional evening review.
  if (isQuietHours(settings.quietHours)) return false;
  const currentLimit = Number.isFinite(settings.coachPushFrequency)
    ? Math.max(0, Math.floor(settings.coachPushFrequency)) : 0;
  if (state.todayPushCount >= Math.min(state.maxDailyPushes, currentLimit)) return false;
  if (pushType === 'evening_review' && (!state.eveningReviewEnabled || !settings.eveningReviewEnabled)) return false;
  if (pushType === 'positive' && state.todayPositiveCount >= 1) return false;
  return true;
}

async function incrementCounter(key: 'pushControlCount' | 'todayPositiveCount'): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const today = getToday();
    if (await getSetting<string>('pushControlDate', '') !== today) {
      await setSetting('pushControlDate', today);
      await setSetting('pushControlCount', 0);
      await setSetting('todayPositiveCount', 0);
    }
    const count = await getSetting<number>(key, 0);
    await setSetting(key, count + 1);
  });
}

export async function recordPushSent(): Promise<void> {
  await incrementCounter('pushControlCount');
}

export async function recordPositiveSent(): Promise<void> {
  await incrementCounter('todayPositiveCount');
}

/**
 * Serialize the final eligibility check, local delivery, and counters in one
 * per-account IndexedDB transaction. The callback must only perform local work.
 * Returning false means an existing reminder was reused and consumes no slot.
 */
export async function deliverControlledPush(
  pushType: Parameters<typeof canPush>[1],
  dedupeKey: string,
  deliver: () => Promise<boolean | void>,
): Promise<boolean> {
  return db.transaction('rw', db.settings, db.coachPushes, async () => {
    const state = await getPushControlState();
    if (!await canPush(state, pushType)) return false;
    if (pushType === 'evening_review' && !shouldShowEveningReview((await readPersistedReminderSettings()).eveningReviewTime)) return false;
    const key = `pushDelivery:${pushType}:${dedupeKey}`;
    if (await getSetting<string>(key, '') === state.todayDate) return false;
    if (await deliver() === false) return false;
    await setSetting('pushControlCount', state.todayPushCount + 1);
    if (pushType === 'positive') await setSetting('todayPositiveCount', state.todayPositiveCount + 1);
    await setSetting(key, state.todayDate);
    return true;
  });
}

export async function recordPushIgnored(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await getSetting<number>('consecutiveIgnores', 0);
    await setSetting('consecutiveIgnores', current + 1);
  });
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
