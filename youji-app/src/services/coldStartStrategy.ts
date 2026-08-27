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

export function getWelcomeForPhase(phase: ColdStartPhase): string {
  switch (phase) {
    case 'seed':
      return '你好！我是你的生活教练 👋\n\n我会通过你随手记录的内容来了解你。从今天起，每一条速记、每一笔账，都在帮我看清你的规律。\n\n先说好——我不会天天催你做什么，你该干嘛干嘛。有什么想说的，随时跟我说。不想打字？说一句话就行。';
    case 'observe':
      return '嗨，又见面了！我已经开始了解你了。\n\n目前我还在观察阶段，不会给你太多建议。等你多记录一些，我就能发现你自己注意不到的规律。\n\n继续用速记记录你的生活吧，我会一直在看。';
    case 'breakthrough':
      return '嘿，我发现了一些有意思的事！\n\n经过这段时间的观察，我已经能看出你的一些生活规律了。接下来我会开始分享我的发现，你可以告诉我准不准。\n\n记住，我的建议只是参考，你永远是自己的主人。';
    case 'trust':
      return '你好！我们已经相处一段时间了。\n\n我越来越了解你了，可以给你更具体的建议了。如果你觉得我说得对，就试试；觉得不对，告诉我，我会调整。\n\n今天想聊点什么？';
  }
}
