import { useExpenseStore } from '../stores/expenseStore';
import { useTodoStore } from '../stores/todoStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useHabitStore } from '../stores/habitStore';
import { useQuickNoteStore } from '../stores/quickNoteStore';
import { daysBetween, getToday } from '../utils/date';

export type ColdStartPhase = 'seed' | 'observe' | 'breakthrough' | 'trust';

export interface ColdStartState {
  phase: ColdStartPhase;
  dayCount: number;
  firstRecordDate: string | null;
  shouldPushAdvice: boolean;
  maxAdvicePerDay: number;
  coachBehavior: {
    giveAdvice: boolean;
    giveCrossDomainInsight: boolean;
    giveActionSuggestion: boolean;
    tone: 'observational' | 'suggestive' | 'coaching';
  };
}

function earliestDateFromStores(): string | null {
  const candidates: number[] = [
    ...useExpenseStore.getState().items.map((i) => i.date),
    ...useTodoStore.getState().items.map((i) => i.dueDate ?? ''),
    ...useDiaryStore.getState().items.map((i) => i.date),
    ...useHabitStore.getState().items.map((i) => i.createdAt),
    ...useQuickNoteStore.getState().records.map((r) => r.createdAt),
  ]
    .filter(Boolean)
    .map((value) => (typeof value === 'string' ? Date.parse(`${value.slice(0, 10)}T12:00:00+08:00`) : Number(value)))
    .filter((value) => Number.isFinite(value));

  if (candidates.length === 0) return null;

  const earliest = new Date(Math.min(...candidates));
  const businessFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });
  return businessFormatter.format(earliest);
}

export function getColdStartStateSync(): ColdStartState {
  const firstRecordDate = earliestDateFromStores();
  const today = getToday();
  const dayCount = firstRecordDate ? Math.max(daysBetween(firstRecordDate, today) + 1, 1) : 1;

  if (dayCount <= 3) {
    return {
      phase: 'seed',
      dayCount,
      firstRecordDate,
      shouldPushAdvice: true,
      maxAdvicePerDay: 1,
      coachBehavior: {
        giveAdvice: false,
        giveCrossDomainInsight: false,
        giveActionSuggestion: true,
        tone: 'observational',
      },
    };
  }

  if (dayCount <= 7) {
    return {
      phase: 'observe',
      dayCount,
      firstRecordDate,
      shouldPushAdvice: true,
      maxAdvicePerDay: 1,
      coachBehavior: {
        giveAdvice: false,
        giveCrossDomainInsight: true,
        giveActionSuggestion: true,
        tone: 'observational',
      },
    };
  }

  if (dayCount <= 14) {
    return {
      phase: 'breakthrough',
      dayCount,
      firstRecordDate,
      shouldPushAdvice: true,
      maxAdvicePerDay: 2,
      coachBehavior: {
        giveAdvice: true,
        giveCrossDomainInsight: true,
        giveActionSuggestion: true,
        tone: 'suggestive',
      },
    };
  }

  return {
    phase: 'trust',
    dayCount,
    firstRecordDate,
    shouldPushAdvice: true,
    maxAdvicePerDay: 3,
    coachBehavior: {
      giveAdvice: true,
      giveCrossDomainInsight: true,
      giveActionSuggestion: true,
      tone: 'coaching',
    },
  };
}

/** Coverage is a fact about records, never evidence of a personal relationship. */
export function formatRecordCoverageWelcome(firstRecordDate: string | null, count: number): string {
  if (count === 0) return '可以先记一件刚发生的事，或聊聊你想核对什么。记录由你决定，不需要每天完成。没有足够记录时，我不会据此判断你的生活规律。';
  const scope = firstRecordDate ? `已加载的收支、待办、习惯、日记和速记共${count}条，相关日期最早为${firstRecordDate}。` : `已加载的收支、待办、习惯、日记和速记共${count}条。`;
  return `${scope}旧日期只表示记录覆盖范围，不代表连续记录或相处时长。可以选一条具体记录核对，再决定下一步；建议只供参考。`;
}

export function getRecordCoverageWelcome(): string {
  const count = useExpenseStore.getState().items.length + useTodoStore.getState().items.length + useDiaryStore.getState().items.length + useHabitStore.getState().items.length + useQuickNoteStore.getState().records.length;
  return formatRecordCoverageWelcome(earliestDateFromStores(), count);
}

export function subscribeRecordCoverage(listener: () => void): () => void {
  const subscriptions = [useExpenseStore.subscribe(listener), useTodoStore.subscribe(listener), useDiaryStore.subscribe(listener), useHabitStore.subscribe(listener), useQuickNoteStore.subscribe(listener)];
  return () => { for (const unsubscribe of subscriptions) unsubscribe(); };
}
