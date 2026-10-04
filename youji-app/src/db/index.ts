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
  | 'habitCheckins'
  | 'goals';

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
  attempts?: number;
  baseVersion?: string;
  predecessorSeq?: number;
  status?: 'pending' | 'blocked';
  lastStatus?: number;
  lastAttemptAt?: number;
}

export interface GoalRecord {
  // Missing on pre-sync goals: never infer permission to upload them.
  syncScope?: 'local' | 'account';
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

export const DATABASE_UPGRADE_BLOCKED_EVENT = 'youtrace:database-upgrade-blocked';
let databaseUpgradeBlocked = false;
export const isDatabaseUpgradeBlocked = () => databaseUpgradeBlocked;

export const LOCAL_DATA_EPOCH_KEY = 'localDataEpoch';

export const ENTITY_TABLES = [
  'schedules', 'expenses', 'todos', 'habits', 'habitCheckins', 'quickNotes',
  'diary', 'settings', 'coachInsights', 'coachPushes', 'goals', 'goalRecords', 'outbox',
] as const;

// Account stores start with a fresh schema. The historical shared `youtrace`
// database is deliberately never opened with an upgrade or assigned to a user.
export class YoujiDatabase extends Dexie {
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
  goalRecords!: Table<GoalRecord, string>;
  outbox!: Table<OutboxRecord, number>;
  readonly ownerId: string | null;

  constructor(ownerId: string | null = null) {
    if (ownerId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) {
      throw new Error('账号标识无效，未打开数据');
    }
    super(ownerId ? `youtrace:user:${ownerId}` : 'youtrace:guest');
    this.ownerId = ownerId;
    this.on('blocked', () => { databaseUpgradeBlocked = true; if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATABASE_UPGRADE_BLOCKED_EVENT)); });
    this.on('ready', () => { databaseUpgradeBlocked = false; if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATABASE_UPGRADE_BLOCKED_EVENT)); });
    this.version(1).stores({
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
    });
    // Dexie may reopen/recreate an older declared schema. Preserve `goals` as a
    // quarantined source; new writes use a different physical table. Old JS can
    // only change the source, never a synchronized goal. Full-field copy and
    // source snapshots are atomic; no ownership/upload permission is inferred.
    this.version(2).stores({ goalRecords: 'id, level, domain, priority' }).upgrade(async (tx) => {
      const originals = await tx.table('goals').toArray();
      await tx.table('goalRecords').bulkPut(originals.map((row: GoalRecord) => ({ ...row, syncScope: 'local' })));
      await tx.table('settings').bulkPut(originals.map((row: GoalRecord) => ({ key: `goal-source-snapshot:${row.id}`, value: row })));
    });
  }
}

export let db = new YoujiDatabase();
let bound = false;

// Bind only once in a document, after /auth/me verifies the owner. Changing an
// account reloads the document, so late store callbacks cannot reach another DB.
export async function bindAccountDatabase(ownerId: string | null): Promise<void> {
  if (bound && db.ownerId !== ownerId) throw new Error('切换账号需要重新加载页面');
  if (!bound && db.ownerId !== ownerId) {
    db.close();
    db = new YoujiDatabase(ownerId);
  }
  bound = true;
  await db.open();
}

export async function exportAllData() {
  return db.transaction('r', db.tables, async () => {
    const tables: Record<string, unknown[]> = {};
    for (const name of ENTITY_TABLES) tables[name === 'goalRecords' ? 'goals' : name === 'goals' ? 'legacyGoalSources' : name] = await db.table(name).toArray();
    return {
      format: 'youtrace-local-backup', schemaVersion: 2, storageVersion: db.verno,
      exportedAt: new Date().toISOString(), ownerId: db.ownerId,
      scope: db.ownerId ? 'account' : 'guest', tables,
    };
  });
}

export async function clearAllData(options: { allowPending?: boolean } = {}): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    if (!options.allowPending && (await db.outbox.count() > 0 || await db.settings.where('key').startsWith('pendingSetting:').count() > 0)) {
      throw new Error('还有未同步的修改，先同步或导出备份后再处理');
    }
    for (const table of db.tables) await table.clear();
    await db.settings.put({ key: LOCAL_DATA_EPOCH_KEY, value: generateLocalId() });
  });
}

export async function hasLegacyDatabase(): Promise<boolean> {
  return Dexie.exists('youtrace');
}

export async function exportLegacyData() {
  if (!await hasLegacyDatabase()) throw new Error('没有找到旧版本地数据');
  // Dynamic schema: read the actual existing version without a versionchange.
  const legacy = new Dexie('youtrace');
  try {
    await legacy.open();
    return await legacy.transaction('r', legacy.tables, async () => {
      const tables: Record<string, unknown[]> = {};
      for (const table of legacy.tables) tables[table.name] = await table.toArray();
      return {
        format: 'youtrace-legacy-quarantine', schemaVersion: legacy.verno,
        exportedAt: new Date().toISOString(), ownership: 'unverified', tables,
      };
    });
  } finally { legacy.close(); }
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
