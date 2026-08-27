import Dexie, { type Table } from 'dexie';
import type { ExpenseItem } from '../stores/expenseStore';
import type { TodoItem } from '../stores/todoStore';
import type { HabitItem } from '../stores/habitStore';
import type { QuickNoteRecord } from '../stores/quickNoteStore';
import type { CoachInsightRecord, CoachPushRecord } from '../stores/coachStore';

export type SyncEntity =
  | 'schedules'
  | 'expenses'
  | 'todos'
  | 'habits'
  | 'quickNotes'
  | 'diaries'
  | 'habitCheckins';

export interface ScheduleRecord {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
  type: 'class' | 'study' | 'work' | 'social' | 'other';
  repeat: 'none' | 'weekly';
  remind: number;
  createdAt: number;
  updatedAt: number;
}

export interface HabitCheckinRecord {
  id: string;
  habitId: string;
  date: string;
  done: boolean;
  source: 'manual' | 'ai' | 'schedule';
  aiReason?: string;
  confirmed: boolean;
  updatedAt: number;
}

export interface DiaryRecord {
  id: string;
  date: string;
  content: string;
  mood: string | null;
  moodScore: number;
  source: 'manual' | 'ai_generated' | 'quicknote_aggregated';
  quickNoteIds: string[];
  aiInsight?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OutboxRecord {
  seq?: number;
  op: 'upsert' | 'delete';
  entity: SyncEntity;
  payload: unknown;
  queuedAt: number;
}

export interface GoalRecord {
  id: string;
  title: string;
  description: string;
  level: 'short' | 'medium' | 'long';
  domain: string;
  priority: 'low' | 'medium' | 'high';
  progress: number;
  targetDate: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export function generateLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

class YoujiDatabase extends Dexie {
  schedules!: Table<ScheduleRecord, string>;
  expenses!: Table<ExpenseItem, string>;
  todos!: Table<TodoItem, string>;
  habits!: Table<HabitItem, string>;
  habitCheckins!: Table<HabitCheckinRecord, string>;
  quickNotes!: Table<QuickNoteRecord, string>;
  diary!: Table<DiaryRecord, string>;
  settings!: Table<SettingRecord, string>;
  coachInsights!: Table<CoachInsightRecord, string>;
  coachPushes!: Table<CoachPushRecord, string>;
  goals!: Table<GoalRecord, string>;
  outbox!: Table<OutboxRecord, number>;

  constructor() {
    super('youtrace');
    this.version(2).stores({
      schedules: '++id, date, type, repeat',
      expenses: 'id, date, category',
      todos: 'id, done, dueDate, priority',
      habits: 'id',
      habitCheckins: '++id, habitId, date, [habitId+date]',
      quickNotes: 'id, timestamp',
      diary: '++id, date',
      settings: 'key',
      coachInsights: 'id, type, dismissed, createdAt',
      coachPushes: 'id, type, read, createdAt',
    });

    this.version(3).stores({
      schedules: 'id, date, type',
      expenses: 'id, date, category',
      todos: 'id, done, dueDate, priority',
      habits: 'id',
      habitCheckins: 'id, habitId, date, [habitId+date]',
      quickNotes: 'id, createdAt',
      diary: 'id, date',
      settings: 'key',
      coachInsights: 'id, type, dismissed, createdAt',
      coachPushes: 'id, type, read, createdAt',
      goals: 'id, level, domain, priority',
      outbox: '++seq, entity, queuedAt',
    }).upgrade(async (tx) => {
      const schedules = await tx.table('schedules').toArray();
      await tx.table('schedules').clear();
      await tx.table('schedules').bulkPut(
        schedules.map((item: Record<string, unknown>) => ({
          ...item,
          id: typeof item.id === 'string' && item.id ? item.id : generateLocalId(),
        })),
      );

      const diaries = await tx.table('diary').toArray();
      await tx.table('diary').clear();
      await tx.table('diary').bulkPut(
        diaries.map((item: Record<string, unknown>) => ({
          ...item,
          id: typeof item.id === 'string' && item.id ? item.id : generateLocalId(),
          moodScore: typeof item.moodScore === 'number' && item.moodScore >= 1 && item.moodScore <= 10 ? item.moodScore : 5,
        })),
      );

      const checkins = await tx.table('habitCheckins').toArray();
      await tx.table('habitCheckins').clear();
      await tx.table('habitCheckins').bulkPut(
        checkins.map((item: Record<string, unknown>) => ({
          confirmed: true,
          updatedAt: Date.now(),
          ...item,
          id: `${String(item.habitId)}|${String(item.date)}`,
        })),
      );

      const legacyNotes = await tx.table('quickNotes').toArray();
      const droppable = legacyNotes.filter((item: Record<string, unknown>) => typeof item.rawInput !== 'string');
      if (droppable.length > 0) {
        console.warn(`[db] v3 upgrade: dropping ${droppable.length} quickNotes without rawInput`, droppable);
      }
      if (legacyNotes.length > 0) {
        await tx.table('quickNotes').clear();
        await tx.table('quickNotes').bulkPut(
          legacyNotes
            .filter((item: Record<string, unknown>) => typeof item.rawInput === 'string')
            .map((item: Record<string, unknown>) => ({
              ...item,
              createdAt: typeof item.createdAt === 'number'
                ? item.createdAt
                : Number(item.timestamp) || Date.now(),
            })),
        );
      }
    });
  }
}

export const db = new YoujiDatabase();

export async function exportAllData(): Promise<Record<string, unknown[]>> {
  const [schedules, expenses, todos, habits, habitCheckins, quickNotes, diary, settings, coachInsights, coachPushes, goals] =
    await Promise.all([
      db.schedules.toArray(),
      db.expenses.toArray(),
      db.todos.toArray(),
      db.habits.toArray(),
      db.habitCheckins.toArray(),
      db.quickNotes.toArray(),
      db.diary.toArray(),
      db.settings.toArray(),
      db.coachInsights.toArray(),
      db.coachPushes.toArray(),
      db.goals.toArray(),
    ]);

  return {
    schedules,
    expenses,
    todos,
    habits,
    habitCheckins,
    quickNotes,
    diary,
    settings,
    coachInsights,
    coachPushes,
    goals,
  };
}

export async function clearAllData(): Promise<void> {
  await Promise.all([
    db.schedules.clear(),
    db.expenses.clear(),
    db.todos.clear(),
    db.habits.clear(),
    db.habitCheckins.clear(),
    db.quickNotes.clear(),
    db.diary.clear(),
    db.settings.clear(),
    db.coachInsights.clear(),
    db.coachPushes.clear(),
    db.outbox.clear(),
  ]);
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const record = await db.settings.get(key);
  return record ? (record.value as T) : defaultValue;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}
