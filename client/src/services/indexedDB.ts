import Dexie, { type Table } from 'dexie';

interface LocalDiary {
  id: string;
  userId: string;
  content: string;
  emotionScore: number | null;
  emotionTags: string[];
  aiInsight: string | null;
  mediaUrls: string[];
  weather: string | null;
  locationName: string | null;
  locationLat: number | null;
  locationLng: number | null;
  createdAt: string;
  updatedAt: string;
  _version: number;
  _synced: boolean;
}

interface LocalEvent {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string | null;
  isAllDay: boolean;
  color: string | null;
  recurrence: string | null;
  goalId: string | null;
  reminderMinutes: number;
  isCourse: boolean;
  courseWeekStart: number | null;
  courseWeekEnd: number | null;
  courseDayOfWeek: number | null;
  courseStartSec: number | null;
  courseEndSec: number | null;
  courseTeacher: string | null;
  courseLocation: string | null;
  courseAdjust: string | null;
  courseWeekType: string | null;
  courseSemesterStart: string | null;
  courseTimeConfig: string | null;
  createdAt: string;
  updatedAt: string;
  _version: number;
  _synced: boolean;
}

interface LocalGoal {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: string;
  progress: number;
  deadline: string | null;
  aiBreakdown: string | null;
  createdAt: string;
  updatedAt: string;
  _version: number;
  _synced: boolean;
}

interface LocalHabit {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  frequency: string;
  targetDays: number;
  goalId: string | null;
  streakCurrent: number;
  streakLongest: number;
  createdAt: string;
  updatedAt: string;
  _version: number;
  _synced: boolean;
}

interface LocalHabitLog {
  id: string;
  habitId: string;
  logDate: string;
  isCompleted: boolean;
  note: string | null;
  createdAt: string;
  _version: number;
  _synced: boolean;
}

export interface SyncQueueItem {
  id?: number;
  entityType: 'diary' | 'event' | 'goal' | 'habit' | 'habitLog';
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  data: string;
  createdAt: string;
  retryCount: number;
  lastError: string | null;
  nextRetryAt: number | null;
}

class YoujiDB extends Dexie {
  diaries!: Table<LocalDiary, string>;
  events!: Table<LocalEvent, string>;
  goals!: Table<LocalGoal, string>;
  habits!: Table<LocalHabit, string>;
  habitLogs!: Table<LocalHabitLog, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  constructor() {
    super('youji_db');

    this.version(1).stores({
      diaries: 'id, userId, createdAt, _synced',
      events: 'id, userId, startTime, _synced',
      goals: 'id, userId, status, _synced',
      habits: 'id, userId, _synced',
      habitLogs: 'id, habitId, logDate, _synced',
      syncQueue: '++id, entityType, entityId, operation, createdAt',
    });

    this.version(2).stores({
      diaries: 'id, userId, createdAt, _synced',
      events: 'id, userId, startTime, _synced',
      goals: 'id, userId, status, _synced',
      habits: 'id, userId, _synced',
      habitLogs: 'id, habitId, logDate, _synced',
      syncQueue: '++id, entityType, entityId, operation, createdAt, nextRetryAt',
    }).upgrade((tx) => {
      tx.table('syncQueue').toCollection().modify((item: SyncQueueItem) => {
        item.nextRetryAt = null;
      });
    });
  }
}

const db = new YoujiDB();

export default db;

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'retryCount' | 'lastError' | 'nextRetryAt'>) {
  return db.syncQueue.add({
    ...item,
    retryCount: 0,
    lastError: null,
    nextRetryAt: null,
  });
}

export async function getSyncQueue() {
  return db.syncQueue.orderBy('createdAt').toArray();
}

export async function getSyncQueueCount() {
  return db.syncQueue.count();
}

export async function getPendingSyncQueue() {
  const now = Date.now();
  return db.syncQueue
    .where('nextRetryAt')
    .belowOrEqual(now)
    .or('nextRetryAt')
    .equals(null as unknown as number)
    .toArray();
}

export async function removeSyncQueueItem(id: number) {
  return db.syncQueue.delete(id);
}
