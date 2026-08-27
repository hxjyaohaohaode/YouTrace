import { api, isLoggedIn } from './apiClient';
import { db, getSetting, setSetting, type OutboxRecord, type SyncEntity } from '../db';
import { toast } from './toastBus';
import type { MoodLevel } from './parser';

const MOOD_SET = new Set<MoodLevel>(['happy', 'good', 'normal', 'low', 'sad', 'angry', 'anxious']);

const LAST_SYNC_KEY = 'lastSyncAt';
const MAX_RETRY_DELAY_MS = 60_000;

let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveNetworkFailures = 0;
let consecutiveRejections = 0;
let onlineListenerAttached = false;

export async function enqueueSync(
  entity: SyncEntity,
  op: 'upsert' | 'delete',
  payload: unknown,
): Promise<void> {
  await db.outbox.add({ entity, op, payload, queuedAt: Date.now() });
  if (retryTimer === null && !flushing) {
    scheduleFlush(300);
  }
}

function scheduleFlush(delayMs: number) {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, delayMs);
}

function recordKey(record: OutboxRecord): string {
  if (record.entity === 'habitCheckins' && record.op === 'upsert') {
    const payload = record.payload as { habitId?: string; date?: string };
    return `habitCheckins:${payload.habitId}:${payload.date}`;
  }
  const payload = record.payload as { id?: string };
  const id = record.op === 'delete' ? String(record.payload) : payload.id ?? '';
  return `${record.entity}:${id}`;
}

interface SyncPushPayload {
  schedules?: unknown[];
  expenses?: unknown[];
  todos?: unknown[];
  habits?: unknown[];
  quickNotes?: unknown[];
  diaries?: unknown[];
  habitCheckins?: unknown[];
  deletions?: {
    scheduleIds?: string[];
    expenseIds?: string[];
    todoIds?: string[];
    habitIds?: string[];
    quickNoteIds?: string[];
    diaryIds?: string[];
  };
}

const UPSERT_ENTITY_TO_KEY: Record<string, keyof Omit<SyncPushPayload, 'deletions'>> = {
  schedules: 'schedules',
  expenses: 'expenses',
  todos: 'todos',
  habits: 'habits',
  quickNotes: 'quickNotes',
  diaries: 'diaries',
  habitCheckins: 'habitCheckins',
};

const DELETE_ENTITY_TO_KEY: Record<string, keyof NonNullable<SyncPushPayload['deletions']>> = {
  schedules: 'scheduleIds',
  expenses: 'expenseIds',
  todos: 'todoIds',
  habits: 'habitIds',
  quickNotes: 'quickNoteIds',
  diaries: 'diaryIds',
};

interface FlushOutcome {
  ok: boolean;
  status?: number;
  ownershipConflict: boolean;
  flushedSeqs: number[];
}

export async function flush(): Promise<boolean> {
  if (flushing || !isLoggedIn()) return false;
  flushing = true;

  try {
    const ops = await db.outbox.orderBy('seq').toArray();
    if (ops.length === 0) return true;

    const latestByKey = new Map<string, OutboxRecord>();
    for (const record of ops) {
      latestByKey.set(recordKey(record), record);
    }

    const allInvolvedSeqs = ops.map((r) => r.seq!);
    const payload: SyncPushPayload = {};
    const deletions: NonNullable<SyncPushPayload['deletions']> = {};

    let payloadEmpty = true;
    for (const record of ops) {
      if (record.op === 'upsert') {
        const key = UPSERT_ENTITY_TO_KEY[record.entity];
        if (!key) {
          console.warn('syncEngine: dropping unknown upsert entity', record.entity);
          continue;
        }
        if (latestByKey.get(recordKey(record)) !== record) continue;
        if (!payload[key]) payload[key] = [];
        payload[key].push(record.payload);
        payloadEmpty = false;
      } else {
        const key = DELETE_ENTITY_TO_KEY[record.entity];
        if (!key) {
          console.warn('syncEngine: dropping unknown delete entity', record.entity);
          continue;
        }
        if (latestByKey.get(recordKey(record)) !== record) continue;
        if (!deletions[key]) deletions[key] = [];
        deletions[key].push(String(record.payload));
        payloadEmpty = false;
      }
    }

    if (payloadEmpty) {
      await db.outbox.bulkDelete(allInvolvedSeqs);
      return true;
    }

    if (Object.keys(deletions).length > 0) {
      payload.deletions = deletions;
    }

    let outcome: FlushOutcome;
    try {
      await api.post('/sync/push', payload, 30_000);
      outcome = { ok: true, ownershipConflict: false, flushedSeqs: allInvolvedSeqs };
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = error instanceof Error ? error.message : '';
      outcome = {
        ok: false,
        status,
        ownershipConflict: message.includes('所有权冲突') || message.includes('越权'),
        flushedSeqs: allInvolvedSeqs,
      };
    }

    if (outcome.ok) {
      await db.outbox.bulkDelete(outcome.flushedSeqs);
      await setSetting('lastPushAt', new Date().toISOString());
      if (consecutiveNetworkFailures > 0 || consecutiveRejections > 0) {
        toast.success('数据已同步');
      }
      consecutiveNetworkFailures = 0;
      consecutiveRejections = 0;
      return true;
    }

    if (outcome.ownershipConflict) {
      await db.outbox.bulkDelete(outcome.flushedSeqs);
      consecutiveNetworkFailures = 0;
      consecutiveRejections = 0;
      toast.warning('检测到多设备数据冲突，已重置待同步队列');
      void pullServerChanges().catch(() => undefined);
      return false;
    }

    if (outcome.status === 429) {
      consecutiveNetworkFailures += 1;
      scheduleFlush(Math.min(MAX_RETRY_DELAY_MS, 5000 * 2 ** Math.min(consecutiveNetworkFailures, 4)));
      return false;
    }

    if (outcome.status !== undefined && outcome.status >= 400 && outcome.status < 500) {
      consecutiveRejections += 1;
      if (consecutiveRejections >= 2) {
        await db.outbox.bulkDelete(outcome.flushedSeqs);
        consecutiveRejections = 0;
        toast.error('有部分修改无法同步，已被丢弃（数据不被服务端接受）');
      } else {
        toast.warning('同步被服务端拒绝，正在重试');
      }
      return false;
    }

    consecutiveNetworkFailures += 1;
    if (consecutiveNetworkFailures === 1 || consecutiveNetworkFailures % 5 === 0) {
      toast.warning('部分修改尚未同步，将在网络恢复后自动重试');
    }
    scheduleFlush(Math.min(MAX_RETRY_DELAY_MS, 2000 * 2 ** Math.min(consecutiveNetworkFailures, 5)));
    return false;
  } finally {
    flushing = false;
    void compensatePending();
  }
}

export async function clearPendingSync(): Promise<void> {
  await db.outbox.clear();
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  consecutiveNetworkFailures = 0;
}

interface PullPage {
  schedules: Array<Record<string, unknown> & { id: string; updatedAt: string }>;
  expenses: Array<Record<string, unknown> & { id: string; updatedAt: string }>;
  todos: Array<Record<string, unknown> & { id: string; updatedAt: string }>;
  habits: Array<Record<string, unknown> & { id: string; updatedAt: string }>;
  habitCheckins: Array<{ id: string; habitId: string; date: string; done: boolean; source?: string; aiReason?: string | null; confirmed?: boolean; updatedAt: string }>;
  quickNotes: Array<{ id: string; content: string; timestamp: number | string; parsed?: Record<string, unknown>; confirmed?: boolean; updatedAt: string }>;
  diaries: Array<{ id: string; date: string; content: string; mood?: string | null; moodScore?: number | null; source?: string; aiInsight?: string | null; createdAt: string; updatedAt: string }>;
  hasMore: boolean;
  serverTime: string;
}

function toMillis(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function toLocalTimestamp(value: unknown, fallback: number): number {
  return toMillis(value, fallback);
}

async function mergePullPage(page: PullPage): Promise<void> {
  const now = Date.now();

  await db.transaction(
    'rw',
    [db.schedules, db.expenses, db.todos, db.habits, db.habitCheckins, db.quickNotes, db.diary],
    async () => {
      if (page.schedules.length) {
        await db.schedules.bulkPut(
          page.schedules.map((row) => pickFields<ScheduleRowLike>(row, now, ['id', 'title', 'date', 'startTime', 'endTime', 'type', 'location', 'repeat', 'remind'])),
        );
      }
      if (page.expenses.length) {
        await db.expenses.bulkPut(
          page.expenses.map((row) => pickFields<ExpenseRowLike>(row, now, ['id', 'amount', 'category', 'name', 'date', 'source', 'isIncome', 'note'])),
        );
      }
      if (page.todos.length) {
        await db.todos.bulkPut(
          page.todos.map((row) => {
            const clean = pickFields<TodoRowLike>(row, now, ['id', 'text', 'dueDate', 'priority', 'done']);
            return { ...clean, dueDate: clean.dueDate || undefined };
          }),
        );
      }
      if (page.habits.length) {
        await db.habits.bulkPut(
          page.habits.map((row) => pickFields<HabitRowLike>(row, now, ['id', 'name', 'icon', 'frequency', 'sortOrder'])),
        );
      }

      if (page.habitCheckins.length) {
        await db.habitCheckins.bulkPut(
          page.habitCheckins.map((row) => ({
            id: `${row.habitId}|${row.date}`,
            habitId: row.habitId,
            date: row.date,
            done: row.done,
            source: (row.source === 'ai' || row.source === 'schedule' ? row.source : 'manual') as 'manual' | 'ai' | 'schedule',
            aiReason: row.aiReason ?? undefined,
            confirmed: row.confirmed ?? true,
            updatedAt: toMillis(row.updatedAt, now),
          })),
        );
      }

      if (page.quickNotes.length) {
        await db.quickNotes.bulkPut(
          page.quickNotes.map((row) => {
            const parsed = (row.parsed ?? {}) as Record<string, unknown>;
            const createdAt = toMillis(row.timestamp, toMillis(row.updatedAt, now));
            const rawMood = typeof parsed.mood === 'string' ? parsed.mood : null;
            const mood = rawMood && MOOD_SET.has(rawMood as MoodLevel) ? (rawMood as MoodLevel) : null;
            return {
              id: row.id,
              rawInput: row.content,
              createdAt,
              expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
              diary: typeof parsed.diary === 'string' ? parsed.diary : null,
              mood,
              moodScore: typeof parsed.moodScore === 'number' ? parsed.moodScore : 5,
              habits: Array.isArray(parsed.habits) ? parsed.habits : [],
              todos: Array.isArray(parsed.todos)
                ? (parsed.todos as Array<string | { id?: string; text?: string; confirmed?: boolean }>).map((item, index) =>
                    typeof item === 'string'
                      ? { id: `todo-${index}`, text: item, confirmed: true }
                      : { id: item.id ?? `todo-${index}`, text: item.text ?? '', confirmed: item.confirmed ?? true },
                  )
                : [],
            };
          }),
        );
      }

      if (page.diaries.length) {
        await db.diary.bulkPut(
          page.diaries.map((row) => ({
            id: row.id,
            date: row.date,
            content: row.content,
            mood: row.mood ?? null,
            moodScore: typeof row.moodScore === 'number' && row.moodScore >= 1 && row.moodScore <= 10 ? row.moodScore : 5,
            source: (row.source === 'ai_generated' || row.source === 'quicknote_aggregated'
              ? row.source
              : 'manual') as 'manual' | 'ai_generated' | 'quicknote_aggregated',
            quickNoteIds: [],
            aiInsight: row.aiInsight ?? undefined,
            createdAt: toLocalTimestamp(row.createdAt, now),
            updatedAt: toMillis(row.updatedAt, now),
          })),
        );
      }
    },
  );
}

interface ScheduleRowLike { id: string; title: string; date: string; startTime: string; endTime: string; type: 'class' | 'study' | 'work' | 'social' | 'other'; location: string; repeat: 'none' | 'weekly'; remind: number; createdAt: number; updatedAt: number }
type ExpenseRowLike = import('../stores/expenseStore').ExpenseItem;
type TodoRowLike = import('../stores/todoStore').TodoItem;
type HabitRowLike = { id: string; name: string; icon: string; frequency: 'daily' | 'weekly'; sortOrder: number; createdAt: number };

function pickFields<T>(row: Record<string, unknown>, fallbackTime: number, keepKeys: string[]): T {
  const result: Record<string, unknown> = {};
  for (const key of keepKeys) {
    if (row[key] !== undefined) result[key] = row[key];
  }
  result.createdAt = toMillis(row.createdAt, fallbackTime);
  result.updatedAt = toMillis(row.updatedAt, fallbackTime);
  return result as T;
}

export async function pullServerChanges(): Promise<void> {
  let since = await getSetting<string>(LAST_SYNC_KEY, '1970-01-01T00:00:00.000Z');

  for (let page = 0; page < 50; page += 1) {
    const data = await api.get<PullPage>(`/sync/pull?since=${encodeURIComponent(since)}`, 30_000);
    await mergePullPage(data);
    since = data.serverTime;
    await setSetting(LAST_SYNC_KEY, data.serverTime);
    if (!data.hasMore) break;
  }
}

export async function bootstrapSync(): Promise<{ offline: boolean }> {
  if (!onlineListenerAttached && typeof window !== 'undefined') {
    onlineListenerAttached = true;
    window.addEventListener('online', () => scheduleFlush(500));
  }

  if (!isLoggedIn()) return { offline: false };

  let offline = false;
  try {
    await pullServerChanges();
  } catch {
    offline = true;
    toast.warning('当前处于离线状态，展示本地数据');
  }

  void flush();
  return { offline };
}

export async function resetSyncCursor(): Promise<void> {
  await setSetting(LAST_SYNC_KEY, '1970-01-01T00:00:00.000Z');
  consecutiveNetworkFailures = 0;
  consecutiveRejections = 0;
}

async function compensatePending(): Promise<void> {
  if (flushing) return;
  const pending = await db.outbox.count();
  if (pending > 0 && isLoggedIn()) {
    scheduleFlush(500);
  }
}
