import { expandScheduleRows } from '../utils/scheduleOccurrences';
import type { ScheduleRecord } from '../db';
import type { ExpenseItem } from '../stores/expenseStore';
import type { HabitView } from '../stores/habitStore';
import { getHabitPeriod } from '../utils/habitPeriod';
import {
  formatBusinessDate,
  getBusinessClock,
} from '../utils/date';

type OverviewHabit = Pick<HabitView, 'name' | 'frequency' | 'createdAt' | 'recentCheckins'> & Partial<Pick<HabitView, 'checkinSources'>>;
type OverviewSchedule = Pick<ScheduleRecord, 'date' | 'startTime' | 'endTime' | 'title' | 'repeat' | 'exceptions'>;
type OverviewExpense = Pick<ExpenseItem, 'date' | 'amount' | 'category' | 'isIncome'>;

export function getExpenseOverview(expenses: readonly OverviewExpense[], monthBudget: number, now: Date) {
  const today = formatBusinessDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const recorded = expenses.filter((expense) => expense.date >= monthStart && expense.date <= today);
  const isIncome = (expense: OverviewExpense) => expense.isIncome === true || expense.category === 'income';
  const spending = recorded.filter((expense) => !isIncome(expense));
  const income = recorded.filter(isIncome);
  // Money remains integer fen through aggregation; only format at the UI edge.
  const totalFen = spending.reduce((sum, expense) => sum + expense.amount, 0);
  const incomeFen = income.reduce((sum, expense) => sum + expense.amount, 0);
  const yuan = (fen: number) => (fen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

  return {
    value: `¥${yuan(totalFen)}`,
    sub: monthBudget > 0
      ? `预算 ¥${yuan(monthBudget)}`
      : income.length > 0
        ? `本月收入 ¥${yuan(incomeFen)}`
        : spending.length > 0 ? `本月已记录 ${spending.length} 笔` : '本月暂无记录',
  };
}

export function getHabitOverview(habits: readonly OverviewHabit[], now: Date) {
  const today = formatBusinessDate(now);
  const applicable = habits.flatMap((habit) => {
    const period = getHabitPeriod(habit, today);
    return period.applicable ? [{ ...habit, done: period.attained }] : [];
  });

  if (applicable.length === 0) {
    return {
      label: '今日习惯',
      value: '0 项',
      sub: habits.length === 0 ? '添加第一个习惯' : '今天暂无需要打卡的习惯',
    };
  }

  const daily = applicable.filter((habit) => habit.frequency !== 'weekly');
  const weekly = applicable.filter((habit) => habit.frequency === 'weekly');
  const doneCount = (items: typeof applicable) => items.filter((habit) => habit.done).length;
  const pendingNames = applicable.filter((habit) => !habit.done).slice(0, 2).map((habit) => habit.name).join(' · ');
  const mixedFrequency = daily.length > 0 && weekly.length > 0;

  return {
    label: mixedFrequency ? '习惯打卡' : weekly.length > 0 ? '本周习惯' : '今日习惯',
    value: `${doneCount(applicable)}/${applicable.length}`,
    sub: mixedFrequency
      ? `今日 ${doneCount(daily)}/${daily.length} · 本周 ${doneCount(weekly)}/${weekly.length}`
      : pendingNames || (weekly.length > 0 ? '本周已全部打卡' : '今日已全部打卡'),
  };
}

function minutesOfDay(time: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function getScheduleOverview(schedules: readonly OverviewSchedule[], now: Date) {
  const today = formatBusinessDate(now);
  const clock = getBusinessClock(now);
  const nowMinutes = clock.hour * 60 + clock.minute;
  const todaySchedules = expandScheduleRows(schedules, today, today);

  const timed = todaySchedules.flatMap((schedule) => {
    const start = minutesOfDay(schedule.startTime);
    const end = minutesOfDay(schedule.endTime);
    // The existing schedule form only supports same-day, positive ranges.
    // Do not reinterpret malformed or legacy overnight ranges as ongoing.
    if (start === null || end === null || end <= start) return [];
    return [{ ...schedule, start, end }];
  }).sort((a, b) => a.start - b.start);
  const ongoing = timed.find((schedule) => schedule.start <= nowMinutes && nowMinutes < schedule.end);
  const upcoming = timed.find((schedule) => schedule.start > nowMinutes);
  const invalidCount = todaySchedules.length - timed.length;

  let sub = '今天没有日程';
  if (ongoing) {
    sub = `进行中: ${ongoing.title}`;
  } else if (upcoming) {
    const until = upcoming.start - nowMinutes;
    const hours = Math.floor(until / 60);
    const minutes = until % 60;
    const remaining = `${hours > 0 ? `${hours}小时` : ''}${minutes > 0 ? `${minutes}分钟` : ''}`;
    sub = until <= 30
      ? `即将开始: ${upcoming.title}`
      : `下个: ${upcoming.startTime} ${upcoming.title} · ${remaining}后`;
  } else if (invalidCount > 0) {
    sub = `${invalidCount} 项日程时间待检查`;
  } else if (todaySchedules.length > 0) {
    sub = '今天的日程已结束';
  }

  return { value: `${todaySchedules.length} 项`, sub };
}

/** Refresh at the next minute boundary, including business midnight. */
export function getOverviewRefreshDelay(now: number): number {
  return 60_000 - (now % 60_000);
}
