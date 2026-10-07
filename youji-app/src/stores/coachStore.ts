import { create } from 'zustand';
import Dexie from 'dexie';
import { api, streamChat, isLoggedIn } from '../services/apiClient';
import { useTodoStore } from './todoStore';
import { useHabitStore } from './habitStore';
import { db, getSetting, LOCAL_DATA_EPOCH_KEY } from '../db';
import { recordPushActed, recordPushIgnored } from '../services/pushControl';
import { addDays, getBusinessClock, getBusinessDayStartTimestamp, getToday, getYesterday } from '../utils/date';

function getDateDaysAgoStr(days: number): string {
  return addDays(getToday(), -days);
}
import { useScheduleStore } from './scheduleStore';
import { useExpenseStore } from './expenseStore';
import { toast } from '../services/toastBus';

export interface CoachMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  actions?: CoachAction[];
  replyFailed?: boolean;
}

export interface CoachAction {
  id: string;
  type: 'todo' | 'reminder' | 'goal' | 'habit' | 'smart';
  title: string;
  level: 2 | 3;
  checked: boolean;
  executed?: boolean;
  payload?: {
    actionType: 'navigate' | 'add_todo' | 'log_expense' | 'check_habit';
    path?: string;
    text?: string;
    name?: string;
    amountFen?: number;
    category?: string;
  };
}

export type InsightType = 'pattern' | 'anomaly' | 'correlation' | 'positive' | 'suggestion';
export type PushType = 'daily_brief' | 'anomaly' | 'follow_up' | 'positive' | 'evening_review';

export interface CoachInsightRecord {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  dataSources: string[];
  actionSuggested?: string;
  actionTaken?: boolean;
  actionResult?: string;
  dismissed: boolean;
  significance: number;
  createdAt: number;
  origin?: 'local' | 'cloud';
}

export interface CoachPushRecord {
  id: string;
  insightId?: string;
  type: PushType;
  title: string;
  body: string;
  actions: PushAction[];
  read: boolean;
  acted: boolean;
  createdAt: number;
  origin?: 'local' | 'cloud';
}

export interface PushAction {
  label: string;
  type: 'confirm' | 'dismiss' | 'snooze' | 'chat';
}

export interface DailyBrief {
  nickname?: string;
  greeting: string;
  date: string;
  generatedAt?: number;
  reviewDate?: string;
  source?: 'server' | 'local';
  yesterdayReview: {
    spent: number;
    expenseCount?: number;
    spentDiff: string | null;
    habits: { done: number; total: number };
    moodScore: number | null;
  };
  weeklyInsights: Array<Pick<CoachInsightRecord, 'id' | 'type' | 'title' | 'description' | 'actionSuggested' | 'dataSources'> & { createdAt?: number }>;
  todayActions: string[];
  todaySchedule: {
    id: string;
    time: string;
    title: string;
    location: string;
    type: string;
  }[];
}

interface CoachInsightApiRecord {
  id: string;
  type: string;
  title: string;
  description: string;
  dataSources: string | string[];
  actionSuggested?: string;
  actionTaken?: boolean;
  actionResult?: string;
  dismissed: boolean;
  createdAt: string;
}

interface BriefInsightApiRecord {
  id: string;
  type: string;
  title: string;
  description: string;
  actionSuggested?: string;
  dataSources?: string[];
  createdAt?: string;
}

interface CoachPushApiRecord {
  id: string;
  insightId?: string;
  type: string;
  title: string;
  body: string;
  actions?: unknown;
  read: boolean;
  acted: boolean;
  createdAt: string;
}

interface CoachBriefApiRecord {
  nickname?: string;
  greeting: string;
  date: string;
  generatedAt?: string;
  reviewDate?: string;
  yesterdayReview: {
    spent: number;
    expenseCount?: number;
    spentDiff: string | null;
    habits: { done: number; total: number };
    moodScore: number | null;
  };
  weeklyInsights: BriefInsightApiRecord[];
  todayActions: string[];
  todaySchedule: {
    id: string;
    time: string;
    title: string;
    location: string;
    type: string;
  }[];
}

const validInsightTypes = new Set<InsightType>(['pattern', 'anomaly', 'correlation', 'positive', 'suggestion']);
const validPushTypes = new Set<PushType>(['daily_brief', 'anomaly', 'follow_up', 'positive', 'evening_review']);

function normalizeInsightType(type: string): InsightType {
  return validInsightTypes.has(type as InsightType) ? (type as InsightType) : 'suggestion';
}

function normalizePushType(type: string): PushType {
  return validPushTypes.has(type as PushType) ? (type as PushType) : 'follow_up';
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseActions(value: unknown): PushAction[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is PushAction =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as PushAction).label === 'string' &&
        typeof (item as PushAction).type === 'string',
    );
  }
  if (typeof value === 'string') {
    try {
      return parseActions(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeInsight(record: CoachInsightApiRecord): CoachInsightRecord {
  return {
    origin: 'cloud',
    id: record.id,
    type: normalizeInsightType(record.type),
    title: record.title,
    description: record.description,
    dataSources: parseJsonArray(record.dataSources),
    actionSuggested: record.actionSuggested,
    actionTaken: record.actionTaken,
    actionResult: record.actionResult,
    dismissed: record.dismissed,
    significance: 0.5,
    createdAt: Date.parse(record.createdAt) || Date.now(),
  };
}

function normalizePush(record: CoachPushApiRecord): CoachPushRecord {
  return {
    origin: 'cloud', id: record.id, insightId: record.insightId,
    type: normalizePushType(record.type), title: record.title, body: record.body,
    actions: parseActions(record.actions), read: record.read, acted: record.acted,
    createdAt: Date.parse(record.createdAt) || Date.now(),
  };
}

function mergeCloudInsight(record: CoachInsightRecord, existing: CoachInsightRecord | undefined): CoachInsightRecord {
  // Feedback endpoints only set flags. A delayed read or generation response
  // cannot reverse another tab's acknowledged choice.
  return {
    ...record,
    dismissed: record.dismissed || Boolean(existing?.dismissed),
    actionTaken: record.actionTaken || Boolean(existing?.actionTaken),
    actionResult: !record.actionTaken && existing?.actionTaken ? existing.actionResult : record.actionResult,
  };
}

let coachDataRevision = 0;
let coachLoadVersion = 0;
const coachChanges = new Map<string, Promise<void>>();

/** Reads must not replay an older server snapshot over freshly acknowledged feedback. */
function serializeCoachChange(key: string, change: () => Promise<void>): Promise<void> {
  coachDataRevision += 1;
  const previous = coachChanges.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(change).finally(() => {
    coachDataRevision += 1;
    if (coachChanges.get(key) === pending) coachChanges.delete(key);
  });
  coachChanges.set(key, pending);
  return pending;
}

/** Delivery may be inside the reminder-budget transaction: publish only on its commit. */
function afterCoachCommit(publish: () => void): void {
  let transaction = Dexie.currentTransaction;
  while (transaction?.parent) transaction = transaction.parent;
  if (transaction) transaction.on('complete', publish);
  else publish();
}

function updateInsightFeedback(id: string, updates: Partial<CoachInsightRecord>, action: 'dismiss' | 'act', result?: string): Promise<void> {
  return serializeCoachChange(`insight:${id}`, async () => {
    const dataEpoch = await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial');
    const record = await db.coachInsights.get(id);
    if (!record) throw new Error('洞察不存在，请刷新后重试');
    if (action === 'dismiss' ? record.dismissed : record.actionTaken && (result === undefined || record.actionResult === result)) return;
    if (record.origin === 'cloud') await api.post(`/coach/insights/${id}/${action}`, action === 'act' ? { action: result } : undefined);
    await db.transaction('rw', db.coachInsights, db.settings, async () => {
      if (await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== dataEpoch) throw new Error('本机数据已清理，请刷新后重试');
      const current = await db.coachInsights.get(id) ?? record;
      await db.coachInsights.put({ ...current, ...updates });
      afterCoachCommit(() => useCoachStore.setState((state) => ({ insights: state.insights.map((item) => item.id === id ? { ...item, ...updates } : item) })));
    });
  });
}

function updatePushFeedback(id: string, action: 'read' | 'act' | 'dismiss'): Promise<void> {
  return serializeCoachChange(`push:${id}`, async () => {
    const dataEpoch = await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial');
    const removeVisible = () => useCoachStore.setState((state) => ({ pushes: state.pushes.filter((item) => item.id !== id) }));
    if (await db.settings.get(`coachPushDismissed:${id}`)) { removeVisible(); return; }
    const record = await db.coachPushes.get(id);
    if (!record) {
      removeVisible();
      if (action === 'dismiss') return;
      throw new Error('提醒不存在，请刷新后重试');
    }
    if ((action === 'read' && record.read) || (action === 'act' && record.acted && record.read)) return;
    const updates = action === 'act' ? { read: true, acted: true } : { read: true };
    if (record.origin === 'cloud') {
      if (action === 'dismiss') {
        try { await api.delete(`/coach/pushes/${id}`); }
        catch (error) {
          // A lost successful DELETE response is retried as 404. The requested
          // end state already holds; auth/account errors must still propagate.
          if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 404) throw error;
        }
      }
      else await api.patch(`/coach/pushes/${id}`, updates);
    }
    await db.transaction('rw', db.coachPushes, db.settings, async () => {
      if (await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== dataEpoch) throw new Error('本机数据已清理，请刷新后重试');
      const current = await db.coachPushes.get(id);
      if (!current || await db.settings.get(`coachPushDismissed:${id}`)) {
        // A later dismissal wins over a read/act response from another tab.
        afterCoachCommit(removeVisible);
        return;
      }
      if (action === 'dismiss') {
        await db.coachPushes.delete(id);
        if (record.origin === 'cloud') await db.settings.put({ key: `coachPushDismissed:${id}`, value: true });
        await recordPushIgnored();
      } else {
        await db.coachPushes.put({ ...current, ...updates });
        if (action === 'act') await recordPushActed();
      }
      afterCoachCommit(() => useCoachStore.setState((state) => ({ pushes: action === 'dismiss'
        ? state.pushes.filter((item) => item.id !== id)
        : state.pushes.map((item) => item.id === id ? { ...item, ...updates } : item) })));
    });
  });
}

async function buildLocalDailyBrief(): Promise<DailyBrief> {
  const generatedAt = Date.now();
  const now = getBusinessClock();
  const today = getToday();
  const yesterday = getYesterday();
  const hour = now.hour;

  const greeting =
    hour < 6 ? '夜深了'
    : hour < 9 ? '早上好'
    : hour < 12 ? '上午好'
    : hour < 14 ? '中午好'
    : hour < 18 ? '下午好'
    : hour < 22 ? '晚上好'
    : '夜深了';

  const date = `${now.month}月${now.day}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.weekday]}`;

  const [yesterdayExpenses, yesterdayDiary, habits, yesterdayCheckins, recentDiaries] = await Promise.all([
    db.expenses.where('date').equals(yesterday).toArray(),
    db.diary.where('date').equals(yesterday).first(),
    db.habits.toArray(),
    db.habitCheckins.where('date').equals(yesterday).toArray(),
    db.diary.where('date').aboveOrEqual(getDateDaysAgoStr(6)).toArray(),
  ]);

  const schedules = useScheduleStore.getState()
    .getItemsByDate(today)
    .map((item) => ({
      id: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
      title: item.title,
      location: item.location,
      type: item.type,
    }));

  const recordedExpenses = yesterdayExpenses.filter((item) => item.category !== 'income' && !item.isIncome);
  const spent = recordedExpenses.reduce((sum, item) => sum + item.amount, 0) / 100;

  const retainedHabitIds = new Set(habits.map((item) => item.id));
  const doneHabitIds = new Set(yesterdayCheckins
    .filter((item) => item.done === true && retainedHabitIds.has(item.habitId))
    .map((item) => item.habitId));

  const moodScores = recentDiaries
    .filter((d) => typeof d.moodScore === 'number' && d.moodScore > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => d.moodScore as number);
  let moodTrendText: string | null = null;
  if (moodScores.length >= 3) {
    const firstHalf = moodScores.slice(0, Math.floor(moodScores.length / 2));
    const secondHalf = moodScores.slice(Math.floor(moodScores.length / 2));
    const avg1 = firstHalf.reduce((s: number, n) => s + n, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((s: number, n) => s + n, 0) / secondHalf.length;
    if (avg2 > avg1 + 1) moodTrendText = '情绪在好转 📈';
    else if (avg2 < avg1 - 1) moodTrendText = '情绪有些低落，注意休息 📉';
    else moodTrendText = '情绪平稳 😊';
  }

  const activeInsights = (await db.coachInsights.toArray())
    .filter((item) => !item.dismissed)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);

  const dynamicInsights: DailyBrief['weeklyInsights'] = [];
  if (moodTrendText) {
    dynamicInsights.push({
      id: 'mood-trend', type: 'pattern', title: moodTrendText,
      description: `基于最近${moodScores.length}条日记的情绪分析`,
      actionSuggested: undefined,
      dataSources: ['mood'],
      createdAt: generatedAt,
    });
  }

  return {
    nickname: undefined,
    greeting,
    date,
    generatedAt,
    reviewDate: yesterday,
    source: 'local',
    yesterdayReview: {
      spent,
      expenseCount: recordedExpenses.length,
      spentDiff: null,
      habits: { done: doneHabitIds.size, total: habits.length },
      moodScore: yesterdayDiary?.moodScore ?? null,
    },
    weeklyInsights: [...dynamicInsights, ...activeInsights.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      actionSuggested: item.actionSuggested,
      dataSources: item.dataSources,
      createdAt: item.createdAt,
    }))],
    todayActions: activeInsights
      .map((item) => item.actionSuggested)
      .filter((item): item is string => Boolean(item))
      .slice(0, 3),
    todaySchedule: schedules.map((item) => ({
      id: item.id,
      time: `${item.startTime}-${item.endTime}`,
      title: item.title,
      location: item.location,
      type: item.type,
    })),
  };
}

const pendingSmartActions = new Set<string>();
let messageSeq = 0;
let chatRequestVersion = 0;
let chatController: AbortController | null = null;
let briefRequestVersion = 0;
let serverBriefGeneratedKey = '';
let serverBriefGeneratedRecord: CoachInsightApiRecord | null = null;
let serverBriefRequest: { key: string; promise: Promise<CoachInsightApiRecord> } | null = null;

interface BriefRequestOptions {
  isCurrent?: () => boolean;
}

async function ensureServerInsight(): Promise<CoachInsightApiRecord | null> {
  const key = `${db.ownerId}:${getToday()}`;
  // A newer mount may resume after the response arrived for a cancelled mount.
  // Retain that result so it can still publish/cache the already-created record.
  if (serverBriefGeneratedKey === key) return serverBriefGeneratedRecord;
  if (!serverBriefRequest || serverBriefRequest.key !== key) {
    const promise = api.post<{ insight: CoachInsightApiRecord }>('/coach/generate-brief')
      .then(({ insight }) => { serverBriefGeneratedKey = key; serverBriefGeneratedRecord = insight; return insight; });
    serverBriefRequest = { key, promise };
  }
  const request = serverBriefRequest;
  try { return await request.promise; }
  finally { if (serverBriefRequest === request) serverBriefRequest = null; }
}

function nextMessageId(prefix: string): string {
  messageSeq += 1;
  return `msg-${Date.now()}-${prefix}-${messageSeq}`;
}

interface CoachState {
  messages: CoachMessage[];
  isTyping: boolean;
  insights: CoachInsightRecord[];
  pushes: CoachPushRecord[];
  dailyBrief: DailyBrief | null;
  loaded: boolean;
  sessionId: string | null;

  addMessage: (msg: Omit<CoachMessage, 'id' | 'timestamp'>) => void;
  setTyping: (typing: boolean) => void;
  executeActions: (messageId: string, actionIds: string[]) => void;
  executeSmartAction: (messageId: string, actionId: string) => Promise<void>;
  clearHistory: () => void;

  sendMessage: (content: string) => Promise<void>;

  loadFromDB: () => Promise<void>;
  addInsight: (insight: Omit<CoachInsightRecord, 'id' | 'createdAt'>) => Promise<CoachInsightRecord>;
  dismissInsight: (id: string) => Promise<void>;
  actOnInsight: (id: string, result?: string) => Promise<void>;

  addPush: (push: Omit<CoachPushRecord, 'id' | 'createdAt'>) => Promise<CoachPushRecord>;
  markPushRead: (id: string) => Promise<void>;
  markPushActed: (id: string) => Promise<void>;
  dismissPush: (id: string) => Promise<void>;
  getUnreadPushCount: () => number;

  setDailyBrief: (brief: DailyBrief) => void;
  generateDailyBrief: (options?: BriefRequestOptions) => Promise<DailyBrief | null>;
}

export const useCoachStore = create<CoachState>((set, get) => ({
  messages: [],
  isTyping: false,
  insights: [],
  pushes: [],
  dailyBrief: null,
  loaded: false,
  sessionId: null,

  addMessage: (msg) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...msg,
          id: nextMessageId(msg.role),
          timestamp: Date.now(),
        },
      ],
    })),

  setTyping: (typing) => set({ isTyping: typing }),

  executeActions: (messageId, actionIds) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId && m.actions
          ? {
              ...m,
              actions: m.actions.map((a) =>
                actionIds.includes(a.id) ? { ...a, executed: true } : a
              ),
            }
          : m
      ),
    })),

  executeSmartAction: async (messageId, actionId) => {
    const message = get().messages.find((m) => m.id === messageId);
    const action = message?.actions?.find((a) => a.id === actionId);
    if (!action || action.executed || action.type !== 'smart' || !action.payload) return;
    const executionKey = `${messageId}:${actionId}`;
    if (pendingSmartActions.has(executionKey)) return;
    pendingSmartActions.add(executionKey);

    const p = action.payload;

    try {
      if (p.actionType === 'navigate') {
        markExecuted();
        window.dispatchEvent(new CustomEvent('youji:navigate', { detail: { path: p.path ?? '/' } }));
        return;
      }

      if (p.actionType === 'add_todo') {
        const text = (p.text ?? '').trim().slice(0, 200);
        if (!text) throw new Error('Missing todo text');
        await useTodoStore.getState().addItem({ text, priority: 'medium' });
        toast.success(`已记入待办：${(p.text ?? '').slice(0, 20)}`);
      } else if (p.actionType === 'log_expense') {
        const amount = p.amountFen ?? 0;
        if (!(Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000_00)) {
          toast.error('金额无效，未记录');
          return;
        }
        await useExpenseStore.getState().addItem({
          name: (p.name ?? '消费').slice(0, 100),
          amount,
          category: p.category ?? 'other',
          date: getToday(),
          source: 'coach',
        });
        toast.success(`已记账：${p.name ?? ''} ¥${(amount / 100).toFixed(0)}`);
      } else if (p.actionType === 'check_habit') {
        const habitName = (p.name ?? '').trim();
        const matches = habitName ? useHabitStore.getState().items.filter((h) => h.name === habitName) : [];
        if (matches.length !== 1) {
          toast.error('无法唯一确认习惯，请到习惯页面选择后打卡');
          markFailed();
          return;
        }
        const habit = matches[0];
        const todayStr = getToday();
        const result = await useHabitStore.getState().setHabitDone(habit, todayStr, true);
        if (!result.viewUpdated) toast.warning('打卡已保存在本机，列表暂未刷新，请到习惯页面核对；无需重复提交');
        else if (result.status === 'already-achieved') toast.info(`「${habit.name}」今天已经打过卡了`);
        else toast.success(`已记录：${habit.name} · ${todayStr}`);
      } else {
        return;
      }
      markExecuted();
    } catch {
      toast.error('执行失败，请重试');
      markFailed();
    } finally {
      pendingSmartActions.delete(executionKey);
    }

    function markExecuted() {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === messageId && m.actions
            ? { ...m, actions: m.actions.map((a) => (a.id === actionId ? { ...a, executed: true } : a)) }
            : m
        ),
      }));
    }
    function markFailed() {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === messageId && m.actions
            ? { ...m, actions: m.actions.map((a) => (a.id === actionId ? { ...a, checked: false } : a)) }
            : m
        ),
      }));
    }
  },

  clearHistory: () => {
    chatRequestVersion += 1;
    chatController?.abort();
    chatController = null;
    set({ messages: [], sessionId: null, isTyping: false });
  },

  sendMessage: async (content: string) => {
    if (get().isTyping || !content.trim()) return;
    const version = ++chatRequestVersion;
    const controller = new AbortController();
    chatController = controller;
    const current = () => version === chatRequestVersion && !controller.signal.aborted;
    const userMsgId = nextMessageId('user');
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: userMsgId,
          role: 'user',
          content,
          timestamp: Date.now(),
        },
      ],
      isTyping: true,
    }));

    const aiMsgId = nextMessageId('ai');
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: aiMsgId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        },
      ],
    }));

    let receivedRuleFallback = false;
    try {
      const result = await streamChat(
        content,
        get().sessionId || undefined,
        (chunk, source) => {
          if (!current()) return;
          if (source === 'rule_fallback') receivedRuleFallback = true;
          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content: m.content + chunk } : m
            ),
          }));
        },
        (payloads) => {
          if (!current()) return;
          const actions: CoachAction[] = payloads.slice(0, 3).map((p, i) => ({
            id: `${aiMsgId}-act-${i}`,
            type: 'smart' as const,
            title: p.label,
            level: 2 as const,
            checked: false,
            payload: {
              actionType: p.type,
              path: p.path,
              text: p.text,
              name: p.name,
              amountFen: p.amountFen,
              category: p.category,
            },
          }));
          if (actions.length > 0) {
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === aiMsgId
                  ? { ...m, content: receivedRuleFallback ? m.content : m.content.replace(/```coach-actions[\s\S]*$/, '').trim(), actions }
                  : m
              ),
            }));
          }
        },
        controller.signal,
      );

      if (current()) set((state) => ({
        sessionId: result.sessionId || state.sessionId,
      }));
    } catch {
      if (!current()) return;
      const partial = get().messages.find((m) => m.id === aiMsgId);
      const recoveryText = partial?.content
        ? ''
        : '抱歉，网络似乎不太稳定，请稍后重试。';
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === userMsgId ? { ...m, replyFailed: true }
            : m.id === aiMsgId && recoveryText ? { ...m, content: recoveryText } : m
        ),
      }));
      if (partial?.content) toast.warning('回复生成中断，内容可能不完整');
    } finally {
      if (current()) set({ isTyping: false });
      if (chatController === controller) chatController = null;
    }
  },

  loadFromDB: async () => {
    const version = ++coachLoadVersion;
    const revision = coachDataRevision;
    const signedIn = isLoggedIn();
    const owner = db.ownerId;
    const dataEpoch = await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial');
    let remote: { insights: CoachInsightRecord[]; pushes: CoachPushRecord[] } | null = null;
    if (signedIn) {
      try {
        const [insightsData, pushesData] = await Promise.all([
          api.get<{ insights: CoachInsightApiRecord[] }>('/coach/insights?limit=50'),
          api.get<{ pushes: CoachPushApiRecord[] }>('/coach/pushes'),
        ]);
        remote = { insights: insightsData.insights.map(normalizeInsight), pushes: pushesData.pushes.map(normalizePush) };
      } catch {
        // Keep all previously cached and locally generated evidence when offline.
      }
    }
    if (version !== coachLoadVersion || owner !== db.ownerId || signedIn !== isLoggedIn()) return;
    await db.transaction('rw', db.coachInsights, db.coachPushes, db.settings, async () => {
      if (await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== dataEpoch) return;
      if (remote && version === coachLoadVersion && revision === coachDataRevision) {
        // Both endpoints are limited pages. Absence is not a deletion event.
        for (const record of remote.insights) {
          const existing = await db.coachInsights.get(record.id);
          if (!existing || existing.origin === 'cloud') await db.coachInsights.put(mergeCloudInsight(record, existing));
        }
        for (const record of remote.pushes) {
          const existing = await db.coachPushes.get(record.id);
          if (await db.settings.get(`coachPushDismissed:${record.id}`)) continue;
          if (!existing || existing.origin === 'cloud') await db.coachPushes.put({
            ...record, read: record.read || Boolean(existing?.read), acted: record.acted || Boolean(existing?.acted),
          });
        }
      }
      const [insights, pushes] = await Promise.all([db.coachInsights.toArray(), db.coachPushes.toArray()]);
      insights.sort((a, b) => b.createdAt - a.createdAt);
      pushes.sort((a, b) => b.createdAt - a.createdAt);
      afterCoachCommit(() => {
        if (version === coachLoadVersion && owner === db.ownerId && signedIn === isLoggedIn()) set({ insights, pushes, loaded: true });
      });
    });
  },

  addInsight: async (insight) => {
    const record: CoachInsightRecord = {
      ...insight, origin: 'local',
      id: `ins-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      createdAt: Date.now(),
    };
    coachDataRevision += 1;
    await db.coachInsights.put(record);
    afterCoachCommit(() => {
      coachDataRevision += 1;
      set((state) => ({ insights: [record, ...state.insights.filter((item) => item.id !== record.id)] }));
    });
    return record;
  },

  dismissInsight: (id) => updateInsightFeedback(id, { dismissed: true }, 'dismiss'),

  actOnInsight: (id, result) => updateInsightFeedback(id, { actionTaken: true, ...(result !== undefined ? { actionResult: result } : {}) }, 'act', result),

  addPush: async (push) => {
    coachDataRevision += 1;
    return db.transaction('rw', db.coachPushes, async () => {
      const todayStart = getBusinessDayStartTimestamp();
      const existing = await db.coachPushes.where('type').equals(push.type)
        .filter((item) => item.title === push.title && item.createdAt >= todayStart).first();
      if (existing) return existing;
      const record: CoachPushRecord = {
        ...push, origin: 'local',
        id: `push-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`,
        createdAt: Date.now(),
      };
      await db.coachPushes.put(record);
      afterCoachCommit(() => {
        coachDataRevision += 1;
        set((state) => ({ pushes: [record, ...state.pushes.filter((item) => item.id !== record.id)] }));
      });
      return record;
    });
  },

  markPushRead: (id) => updatePushFeedback(id, 'read'),

  markPushActed: (id) => updatePushFeedback(id, 'act'),

  dismissPush: (id) => updatePushFeedback(id, 'dismiss'),

  getUnreadPushCount: () => {
    return get().pushes.filter((p) => !p.read).length;
  },

  setDailyBrief: (brief) => set({ dailyBrief: brief }),

  generateDailyBrief: async (options = {}) => {
    const version = ++briefRequestVersion;
    const signedIn = isLoggedIn();
    const owner = db.ownerId;
    const current = () => version === briefRequestVersion && owner === db.ownerId && signedIn === isLoggedIn() && (options.isCurrent?.() ?? true);
    if (!current()) return null;
    const dataEpoch = await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial');
    if (!current()) return null;
    if (signedIn) {
      try {
        const insight = await ensureServerInsight();
        if (!current()) return null;
        if (insight) {
          const record = normalizeInsight(insight);
          coachDataRevision += 1;
          const cached = await db.transaction('rw', db.coachInsights, db.settings, async () => {
            if (!current() || await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== dataEpoch) return null;
            const existing = await db.coachInsights.get(record.id);
            const merged = existing && existing.origin !== 'cloud' ? existing : mergeCloudInsight(record, existing);
            await db.coachInsights.put(merged);
            return merged;
          });
          if (!cached) return null;
          if (!current()) return null;
          set((state) => ({ insights: [cached, ...state.insights.filter((item) => item.id !== cached.id)].sort((a, b) => b.createdAt - a.createdAt) }));
        }
      } catch {
        // A failed rule snapshot must not prevent reading existing evidence.
        if (!current()) return null;
      }
      try {
        const data = await api.get<{ brief: CoachBriefApiRecord }>('/coach/brief');
        if (!current() || await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== dataEpoch) return null;
        if (!current()) return null;
        const brief: DailyBrief = {
          nickname: data.brief.nickname,
          greeting: data.brief.greeting,
          date: data.brief.date,
          generatedAt: data.brief.generatedAt ? Date.parse(data.brief.generatedAt) : undefined,
          reviewDate: data.brief.reviewDate,
          source: 'server',
          yesterdayReview: data.brief.yesterdayReview,
          weeklyInsights: data.brief.weeklyInsights.map((item) => ({
            id: item.id,
            type: normalizeInsightType(item.type),
            title: item.title,
            description: item.description,
            actionSuggested: item.actionSuggested,
            dataSources: Array.isArray(item.dataSources) ? item.dataSources : [],
            createdAt: item.createdAt ? Date.parse(item.createdAt) : undefined,
          })),
          todayActions: data.brief.todayActions,
          todaySchedule: data.brief.todaySchedule,
        };
        set({ dailyBrief: brief });
        return brief;
      } catch {
        if (!current()) return null;
        toast.warning('简报加载失败，展示本地数据');
      }
    }

    const brief = await buildLocalDailyBrief();
    if (!current() || await getSetting<string>(LOCAL_DATA_EPOCH_KEY, 'initial') !== dataEpoch) return null;
    if (!current()) return null;
    set({ dailyBrief: brief });
    return brief;
  },
}));
