import { create } from 'zustand';
import { api, streamChat, isLoggedIn } from '../services/apiClient';
import { useTodoStore } from './todoStore';
import { useHabitStore } from './habitStore';
import { db } from '../db';
import { recordPushActed, recordPushIgnored, recordPositiveSent } from '../services/pushControl';
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
}

export interface PushAction {
  label: string;
  type: 'confirm' | 'dismiss' | 'snooze' | 'chat';
}

export interface DailyBrief {
  nickname?: string;
  greeting: string;
  date: string;
  yesterdayReview: {
    spent: number;
    spentDiff: string | null;
    habits: { done: number; total: number };
    moodScore: number | null;
  };
  weeklyInsights: Array<Pick<CoachInsightRecord, 'id' | 'type' | 'title' | 'description' | 'actionSuggested' | 'dataSources'>>;
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
  yesterdayReview: {
    spent: number;
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

async function buildLocalDailyBrief(): Promise<DailyBrief> {
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

  const spent = Math.round(
    yesterdayExpenses
      .filter((item) => item.category !== 'income' && !item.isIncome)
      .reduce((sum, item) => sum + item.amount, 0) / 100
  );

  const doneHabitIds = new Set(yesterdayCheckins.filter((item) => item.done).map((item) => item.habitId));

  const moodScores = recentDiaries
    .filter((d) => typeof d.moodScore === 'number' && d.moodScore > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => d.moodScore);
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

  const dynamicInsights: Array<Pick<CoachInsightRecord, 'id' | 'type' | 'title' | 'description' | 'actionSuggested' | 'dataSources'>> = [];
  if (moodTrendText) {
    dynamicInsights.push({
      id: 'mood-trend', type: 'pattern', title: moodTrendText,
      description: `基于最近${moodScores.length}条日记的情绪分析`,
      actionSuggested: undefined,
      dataSources: ['mood'],
    });
  }

  return {
    nickname: undefined,
    greeting,
    date,
    yesterdayReview: {
      spent,
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

let messageSeq = 0;

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
  generateDailyBrief: () => Promise<DailyBrief>;
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

    const p = action.payload;

    try {
      if (p.actionType === 'navigate') {
        markExecuted();
        window.dispatchEvent(new CustomEvent('youji:navigate', { detail: { path: p.path ?? '/' } }));
        return;
      }

      if (p.actionType === 'add_todo') {
        await useTodoStore.getState().addItem({ text: (p.text ?? '').slice(0, 200), priority: 'medium' });
        toast.success(`已记入待办：${(p.text ?? '').slice(0, 20)}`);
      } else if (p.actionType === 'log_expense') {
        const amount = p.amountFen ?? 0;
        if (!(amount > 0 && amount <= 100_000_000_00)) {
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
        const habit = useHabitStore.getState().items.find(
          (h) => h.name === habitName || h.name.includes(habitName) || habitName.includes(h.name)
        );
        if (!habit) {
          toast.error('没有找到匹配的习惯');
          markFailed();
          return;
        }
        const todayStr = getToday();
        const record = await db.habitCheckins.get(`${habit.id}|${todayStr}`);
        if (record?.done) {
          toast.info(`「${habit.name}」今天已经打过卡了`);
        } else {
          await useHabitStore.getState().toggleHabit(habit.id);
          toast.success(`已打卡：${habit.name} 🔥${Math.max(1, habit.streak + 1)}`);
        }
      } else {
        return;
      }
      markExecuted();
    } catch {
      toast.error('执行失败，请重试');
      markFailed();
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

  clearHistory: () => set({ messages: [], sessionId: null }),

  sendMessage: async (content: string) => {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: nextMessageId('user'),
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

    try {
      const result = await streamChat(
        content,
        get().sessionId || undefined,
        (chunk) => {
          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content: m.content + chunk } : m
            ),
          }));
        },
        (payloads) => {
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
                  ? { ...m, content: m.content.replace(/```coach-actions[\s\S]*$/, '').trim(), actions }
                  : m
              ),
            }));
          }
        },
      );

      set((state) => ({
        sessionId: result.sessionId || state.sessionId,
      }));
    } catch {
      const partial = get().messages.find((m) => m.id === aiMsgId);
      const recoveryText = partial?.content
        ? ''
        : '抱歉，网络似乎不太稳定，请稍后重试。';
      if (recoveryText) {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === aiMsgId ? { ...m, content: recoveryText } : m
          ),
        }));
        toast.error('消息发送失败，请检查网络后重试');
      } else {
        toast.warning('回复生成中断，内容可能不完整');
      }
    } finally {
      set({ isTyping: false });
    }
  },

  loadFromDB: async () => {
    if (isLoggedIn()) {
      try {
        const [insightsData, pushesData] = await Promise.all([
          api.get<{ insights: CoachInsightApiRecord[] }>('/coach/insights?limit=50'),
          api.get<{ pushes: CoachPushApiRecord[] }>('/coach/pushes'),
        ]);
        set({
          insights: insightsData.insights.map(normalizeInsight),
          pushes: pushesData.pushes.map((p) => ({
            id: p.id,
            insightId: p.insightId,
            type: normalizePushType(p.type),
            title: p.title,
            body: p.body,
            actions: parseActions(p.actions),
            read: p.read,
            acted: p.acted,
            createdAt: Date.parse(p.createdAt) || Date.now(),
          })),
          loaded: true,
        });
        return;
      } catch {
        // fall through to local data on network failure
      }
    }

    const [insights, pushes] = await Promise.all([
      db.coachInsights.toArray(),
      db.coachPushes.toArray(),
    ]);
    insights.sort((a, b) => b.createdAt - a.createdAt);
    pushes.sort((a, b) => b.createdAt - a.createdAt);
    set({ insights, pushes, loaded: true });
  },

  addInsight: async (insight) => {
    const record: CoachInsightRecord = {
      ...insight,
      id: `ins-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      createdAt: Date.now(),
    };

    set((state) => ({ insights: [record, ...state.insights] }));

    if (!isLoggedIn()) {
      await db.coachInsights.put(record);
    }
    return record;
  },

  dismissInsight: async (id) => {
    set((state) => ({
      insights: state.insights.map((i) =>
        i.id === id ? { ...i, dismissed: true } : i
      ),
    }));

    if (isLoggedIn()) {
      try {
        await api.post(`/coach/insights/${id}/dismiss`);
      } catch {
        toast.error('忽略洞察失败，请稍后重试');
      }
    } else {
      await db.coachInsights.update(id, { dismissed: true });
    }
  },

  actOnInsight: async (id, result) => {
    const updates: Partial<CoachInsightRecord> = { actionTaken: true };
    if (result) updates.actionResult = result;

    set((state) => ({
      insights: state.insights.map((i) =>
        i.id === id ? { ...i, ...updates } : i
      ),
    }));

    if (isLoggedIn()) {
      try {
        await api.post(`/coach/insights/${id}/act`, { action: result });
      } catch {
        toast.error('记录行动失败，请稍后重试');
      }
    } else {
      await db.coachInsights.update(id, updates);
    }
  },

  addPush: async (push) => {
    const todayStart = getBusinessDayStartTimestamp();
    const existingPush = get().pushes.find(
      (item) =>
        item.type === push.type &&
        item.title === push.title &&
        item.createdAt >= todayStart
    );

    if (existingPush) {
      return existingPush;
    }

    const record: CoachPushRecord = {
      ...push,
      id: `push-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      createdAt: Date.now(),
    };

    set((state) => ({ pushes: [record, ...state.pushes] }));

    if (push.type === 'positive') {
      void recordPositiveSent();
    }

    if (!isLoggedIn()) {
      await db.coachPushes.put(record);
    }
    return record;
  },

  markPushRead: async (id) => {
    set((state) => ({
      pushes: state.pushes.map((p) =>
        p.id === id ? { ...p, read: true } : p
      ),
    }));

    if (isLoggedIn()) {
      try {
        await api.patch(`/coach/pushes/${id}`, { read: true });
      } catch {
        toast.error('标记已读失败，请稍后重试');
      }
    } else {
      await db.coachPushes.update(id, { read: true });
    }
  },

  markPushActed: async (id) => {
    await recordPushActed();

    set((state) => ({
      pushes: state.pushes.map((p) =>
        p.id === id ? { ...p, acted: true, read: true } : p
      ),
    }));

    if (isLoggedIn()) {
      try {
        await api.patch(`/coach/pushes/${id}`, { acted: true, read: true });
      } catch {
        toast.error('同步操作状态失败，请稍后重试');
      }
    } else {
      await db.coachPushes.update(id, { acted: true, read: true });
    }
  },

  dismissPush: async (id) => {
    await recordPushIgnored();

    set((state) => ({
      pushes: state.pushes.filter((p) => p.id !== id),
    }));

    if (isLoggedIn()) {
      try {
        await api.delete(`/coach/pushes/${id}`);
      } catch {
        toast.error('关闭推送失败，请稍后重试');
      }
    } else {
      await db.coachPushes.delete(id);
    }
  },

  getUnreadPushCount: () => {
    return get().pushes.filter((p) => !p.read).length;
  },

  setDailyBrief: (brief) => set({ dailyBrief: brief }),

  generateDailyBrief: async () => {
    if (isLoggedIn()) {
      try {
        const data = await api.get<{ brief: CoachBriefApiRecord }>('/coach/brief');
        const brief: DailyBrief = {
          nickname: data.brief.nickname,
          greeting: data.brief.greeting,
          date: data.brief.date,
          yesterdayReview: data.brief.yesterdayReview,
          weeklyInsights: data.brief.weeklyInsights.map((item) => ({
            id: item.id,
            type: normalizeInsightType(item.type),
            title: item.title,
            description: item.description,
            actionSuggested: item.actionSuggested,
            dataSources: Array.isArray(item.dataSources) ? item.dataSources : [],
          })),
          todayActions: data.brief.todayActions,
          todaySchedule: data.brief.todaySchedule,
        };
        set({ dailyBrief: brief });
        return brief;
      } catch {
        toast.warning('简报加载失败，展示本地数据');
      }
    }

    const brief = await buildLocalDailyBrief();
    set({ dailyBrief: brief });
    return brief;
  },
}));
