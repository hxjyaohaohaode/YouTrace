import { db } from '../db';
import { addDays, formatBusinessDate, getToday } from '../utils/date';
import { getHabitPeriod } from '../utils/habitPeriod';
import type { InsightType } from '../stores/coachStore';

export interface WeeklyStats {
  expenseFrom: string;
  expenseThrough: string;
  expenseCount: number;
  expenseTotalFen: number;
  lastWeekExpenseTotalFen: number;
  weekOverWeekPct: number | null;
  /** Current daily / natural-week plan only, never a historical seven-day score. */
  habitCompletionRate: number;
  habitRecordCount: number;
  habitRecordDays: number;
  habitExpectedCount: number;
  todoCohortDescription: string;
  todoDoneCount: number;
  todoTotalCount: number;
  diaryEntryCount: number;
  avgMoodScore: number | null;
  moodTrend: 'improving' | 'declining' | 'stable' | null;
  topCategory: string | null;
  topCategoryAmountFen: number;
  activeGoalCount: number;
  completedGoalCount: number;
  daysActive: number;
}

export interface LifeInsight {
  type: InsightType;
  title: string;
  description: string;
  dataSources: string[];
  actionSuggested?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  food: '餐饮', transport: '交通', entertainment: '娱乐',
  study: '学习', daily: '日用', other: '其他',
};

function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? '其他';
}

async function computeWeeklyExpenseStats() {
  const today = getToday();
  const weekStart = addDays(today, -6);
  const lastWeekStart = addDays(today, -13);
  const lastWeekEnd = addDays(today, -7);

  const [thisWeek, lastWeek] = await Promise.all([
    db.expenses.where('date').between(weekStart, today, true, true).toArray(),
    db.expenses.where('date').between(lastWeekStart, lastWeekEnd, true, true).toArray(),
  ]);

  const recordedExpenses = thisWeek.filter((e) => !e.isIncome && e.category !== 'income');
  const thisTotal = recordedExpenses.reduce((s, e) => s + e.amount, 0);
  const lastTotal = lastWeek.filter((e) => !e.isIncome && e.category !== 'income').reduce((s, e) => s + e.amount, 0);

  const catMap = new Map<string, number>();
  for (const e of recordedExpenses) {
    const category = Object.hasOwn(CATEGORY_LABELS, e.category) ? e.category : 'other';
    catMap.set(category, (catMap.get(category) ?? 0) + e.amount);
  }
  const sorted = [...catMap.entries()].sort((a, b) => b[1] - a[1]);

  return {
    from: weekStart,
    through: today,
    count: recordedExpenses.length,
    thisTotal,
    lastTotal,
    wowPct: lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 100) : null,
    topCategory: sorted.length > 0 ? sorted[0][0] : null,
    topCategoryFen: sorted.length > 0 ? sorted[0][1] : 0,
  };
}

async function computeHabitStats() {
  const today = getToday(), cutoff = addDays(today, -6);
  const habits = await db.habits.toArray();
  const checkins = await db.habitCheckins.where('date').between(cutoff, today, true, true).toArray();
  const ids = new Set(habits.map(row => row.id));
  const facts = checkins.filter(row => row.done && ids.has(row.habitId));
  const periods = habits.map(habit => getHabitPeriod({ ...habit, recentCheckins: checkins.filter(row => row.habitId === habit.id) }, today)).filter(period => period.applicable);
  const totalPossible = periods.length, totalDone = periods.filter(period => period.attained).length;
  return { rate: totalPossible ? Math.round(totalDone / totalPossible * 100) : 0, totalPossible, totalDone,
    recordCount: new Set(facts.map(row => `${row.habitId}|${row.date}`)).size, recordDays: new Set(facts.map(row => row.date)).size };
}

function timestampDate(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string' && !(value instanceof Date)) return null;
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? formatBusinessDate(parsed) : null;
}

async function computeTodoStats() {
  const todos = await db.todos.toArray();
  const today = getToday();
  const cutoff = addDays(today, -6);
  const inWindow = (date: string | null | undefined) => Boolean(date && date >= cutoff && date <= today);
  const cohort = todos.filter((todo) => {
    // Older local records have no createdAt; server-synced rows may retain it.
    // Never infer completion time from done, dueDate, or an update timestamp.
    const created = timestampDate((todo as typeof todo & { createdAt?: unknown }).createdAt);
    return inWindow(todo.dueDate) || inWindow(created);
  });
  return { done: cohort.filter((todo) => todo.done).length, total: cohort.length };
}

async function computeMoodStats() {
  const cutoff = addDays(getToday(), -6);
  const diaries = await db.diary.where('date').between(cutoff, getToday(), true, true).toArray();
  const scored = diaries
    .filter((d) => typeof d.moodScore === 'number' && Number.isFinite(d.moodScore) && d.moodScore >= 1 && d.moodScore <= 10)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (scored.length === 0) return { count: diaries.length, avg: null, trend: null as WeeklyStats['moodTrend'] };

  const scores = scored.map((d) => d.moodScore!);
  const avg = Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10;

  let trend: WeeklyStats['moodTrend'] = null;
  if (scores.length >= 4) {
    const half = Math.floor(scores.length / 2);
    const first = scores.slice(0, half).reduce((s: number, n) => s + n, 0) / half;
    const second = scores.slice(half).reduce((s: number, n) => s + n, 0) / (scores.length - half);
    if (second > first + 0.5) trend = 'improving';
    else if (second < first - 0.5) trend = 'declining';
    else trend = 'stable';
  }

  return { count: diaries.length, avg, trend };
}

async function computeActivityDays() {
  const cutoff = addDays(getToday(), -6);
  const [expenses, checkins, diaries, notes] = await Promise.all([
    db.expenses.where('date').between(cutoff, getToday(), true, true).toArray(),
    db.habitCheckins.where('date').between(cutoff, getToday(), true, true).toArray(),
    db.diary.where('date').between(cutoff, getToday(), true, true).toArray(),
    db.quickNotes.toArray(),
  ]);
  const activeDates = new Set<string>();
  for (const e of expenses) activeDates.add(e.date);
  for (const c of checkins) activeDates.add(c.date);
  for (const diary of diaries) activeDates.add(diary.date);
  for (const note of notes) {
    const date = timestampDate(note.createdAt);
    if (date && date >= cutoff && date <= getToday()) activeDates.add(date);
  }
  return activeDates.size;
}

export async function computeWeeklyStats(): Promise<WeeklyStats> {
  const [expenseStats, habitStats, todoStats, moodStats, activeDays] = await Promise.all([
    computeWeeklyExpenseStats(),
    computeHabitStats(),
    computeTodoStats(),
    computeMoodStats(),
    computeActivityDays(),
  ]);

  const goals = await db.goalRecords.toArray();

  return {
    expenseFrom: expenseStats.from,
    expenseThrough: expenseStats.through,
    expenseCount: expenseStats.count,
    expenseTotalFen: expenseStats.thisTotal,
    lastWeekExpenseTotalFen: expenseStats.lastTotal,
    weekOverWeekPct: expenseStats.wowPct,
    habitCompletionRate: habitStats.rate,
    habitExpectedCount: habitStats.totalPossible,
    habitRecordCount: habitStats.recordCount,
    habitRecordDays: habitStats.recordDays,
    todoCohortDescription: '近7天创建或到期的待办（当前完成状态）',
    todoDoneCount: todoStats.done,
    todoTotalCount: todoStats.total,
    diaryEntryCount: moodStats.count,
    avgMoodScore: moodStats.avg,
    moodTrend: moodStats.trend,
    topCategory: expenseStats.topCategory,
    topCategoryAmountFen: expenseStats.topCategoryFen,
    activeGoalCount: goals.filter((g) => g.progress < 100).length,
    completedGoalCount: goals.filter((g) => g.progress >= 100).length,
    daysActive: activeDays,
  };
}

export async function generateRealInsights(): Promise<LifeInsight[]> {
  const stats = await computeWeeklyStats();
  const insights: LifeInsight[] = [];

  if (stats.weekOverWeekPct !== null && stats.weekOverWeekPct !== 0) {
    const direction = stats.weekOverWeekPct > 0 ? '上升' : '下降';
    const emoji = stats.weekOverWeekPct > 15 ? '📈' : stats.weekOverWeekPct < -15 ? '📉' : '';
    insights.push({
      type: 'pattern',
      title: `近7天消费比前7天${direction}${emoji}`,
      description: `近7天记录支出¥${(stats.expenseTotalFen / 100).toFixed(2)}，${stats.weekOverWeekPct > 0 ? '比前7天多' : '比前7天少'}了${Math.abs(stats.weekOverWeekPct)}%。${stats.topCategory ? `大头是${getCategoryLabel(stats.topCategory)}（¥${(stats.topCategoryAmountFen / 100).toFixed(2)}）。` : ''}`,
      dataSources: ['expense'],
      actionSuggested: stats.weekOverWeekPct > 20
        ? `看看${stats.topCategory ? getCategoryLabel(stats.topCategory) : '消费'}明细，找出增长点`
        : undefined,
    });
  }

  if (stats.habitRecordCount > 0) {
    insights.push({
      type: 'pattern',
      title: '习惯记录回顾',
      description: `近7天在${stats.habitRecordDays}天记录了${stats.habitRecordCount}次习惯活动。这是实际日期的记录，不按现在的频率回算过去的完成率；未记录不代表没有做过。`,
      dataSources: ['habit'],
    });
  }

  if (stats.moodTrend === 'declining') {
    insights.push({
      type: 'pattern',
      title: '近期记录的心情分数有所下降',
      description: '近7天已评分日记中，后半段的平均分低于前半段。记录有限，不能据此判断原因；如果你愿意，可以回顾当时发生了什么。',
      dataSources: ['mood'],
      actionSuggested: '愿意的话，记录一下当下的感受',
    });
  } else if (stats.moodTrend === 'improving') {
    insights.push({
      type: 'positive',
      title: '近期记录的心情分数有所上升',
      description: '近7天已评分日记中，后半段的平均分高于前半段。可以回看看有哪些值得珍惜的时刻，这不代表已经确定了变化的原因。',
      dataSources: ['mood'],
    });
  }

  if (stats.daysActive <= 2 && stats.daysActive > 0) {
    insights.push({
      type: 'suggestion',
      title: '按适合你的节奏记录',
      description: `近7天有${stats.daysActive}天留下了花销、打卡、日记或速记。记录是为了帮助你回顾，不需要每天完成。`,
      dataSources: ['habit', 'expense', 'diary', 'quicknote'],
      actionSuggested: '有想留下的事时，再写一句速记',
    });
  }

  if (stats.todoTotalCount > 0 && stats.todoDoneCount / stats.todoTotalCount >= 0.8) {
    insights.push({
      type: 'positive',
      title: '近期待办进展',
      description: `${stats.todoCohortDescription}：${stats.todoDoneCount}/${stats.todoTotalCount}个已完成。这里不表示它们都是在近7天内完成的。`,
      dataSources: ['todo'],
    });
  }

  return insights;
}

export async function generateWeeklyReview(): Promise<string> {
  const stats = await computeWeeklyStats();

  const lines: string[] = [];
  lines.push(`## 近7天回顾 ${stats.expenseFrom} 至 ${stats.expenseThrough}\n本机记录\n`);

  lines.push(`📊 消费：¥${(stats.expenseTotalFen / 100).toFixed(2)}，共${stats.expenseCount}笔`);
  if (stats.weekOverWeekPct !== null) {
    const arrow = stats.weekOverWeekPct > 0 ? '↑' : '↓';
    lines.push(`   ${arrow}${Math.abs(stats.weekOverWeekPct)}% vs 前7天`);
  }
  if (stats.topCategory) {
    lines.push(`   最大支出：${getCategoryLabel(stats.topCategory)} ¥${(stats.topCategoryAmountFen / 100).toFixed(2)}`);
  }

  if (stats.habitRecordCount > 0) {
    lines.push(`\n✅ 近7天习惯记录：${stats.habitRecordCount} 次，分布在 ${stats.habitRecordDays} 天（按实际日期，不回算历史完成率）`);
  }

  if (stats.todoTotalCount > 0) {
    lines.push(`\n☑️ ${stats.todoCohortDescription}：${stats.todoDoneCount}/${stats.todoTotalCount} 已完成`);
  }

  if (stats.diaryEntryCount > 0) {
    lines.push(`\n📝 日记：${stats.diaryEntryCount} 篇`);
    if (stats.avgMoodScore !== null) {
      lines.push(`   平均心情 ${stats.avgMoodScore}/10`);
    }
  }

  if (stats.activeGoalCount > 0 || stats.completedGoalCount > 0) {
    lines.push(`\n🎯 当前目标：${stats.activeGoalCount} 个进行中`);
    if (stats.completedGoalCount > 0) lines.push(`   ✨ ${stats.completedGoalCount} 个已完成`);
  }

  lines.push(`\n📅 有记录天数：${stats.daysActive}/7 天`);

  return lines.join('\n');
}
