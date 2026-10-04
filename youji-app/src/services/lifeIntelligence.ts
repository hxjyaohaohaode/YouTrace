import { db } from '../db';
import { addDays, formatBusinessDate, getToday } from '../utils/date';
import type { InsightType } from '../stores/coachStore';

export interface WeeklyStats {
  expenseTotalFen: number;
  lastWeekExpenseTotalFen: number;
  weekOverWeekPct: number | null;
  habitCompletionRate: number;
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

function getCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    food: '餐饮', transport: '交通', entertainment: '娱乐',
    study: '学习', daily: '日用', other: '其他',
  };
  return map[category] ?? category;
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

  const thisTotal = thisWeek.filter((e) => !e.isIncome).reduce((s, e) => s + e.amount, 0);
  const lastTotal = lastWeek.filter((e) => !e.isIncome).reduce((s, e) => s + e.amount, 0);

  const catMap = new Map<string, number>();
  for (const e of thisWeek) {
    if (!e.isIncome) catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amount);
  }
  const sorted = [...catMap.entries()].sort((a, b) => b[1] - a[1]);

  return {
    thisTotal,
    lastTotal,
    wowPct: lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 100) : null,
    topCategory: sorted.length > 0 ? sorted[0][0] : null,
    topCategoryFen: sorted.length > 0 ? sorted[0][1] : 0,
  };
}

async function computeHabitStats() {
  const today = getToday();
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i)));
  const habits = await db.habits.toArray();
  if (habits.length === 0) return { rate: 0, totalPossible: 0, totalDone: 0 };

  const checkins = await db.habitCheckins.where('date').anyOf(weekDates).toArray();
  const doneSet = new Set(checkins.filter((c) => c.done).map((c) => `${c.habitId}|${c.date}`));

  let totalPossible = 0;
  let totalDone = 0;
  for (const habit of habits) {
    const createdDate = timestampDate(habit.createdAt);
    const eligibleDates = weekDates.filter((date) => !createdDate || date >= createdDate);
    if (eligibleDates.length === 0) continue;
    const doneCount = eligibleDates.filter((date) => doneSet.has(`${habit.id}|${date}`)).length;
    // A weekly habit asks for one completion in this rolling seven-day window.
    // Daily habits only count days on or after their creation date.
    totalPossible += habit.frequency === 'weekly' ? 1 : eligibleDates.length;
    totalDone += habit.frequency === 'weekly' ? Math.min(1, doneCount) : doneCount;
  }

  return { rate: totalPossible > 0 ? Math.round((totalDone / totalPossible) * 100) : 0, totalPossible, totalDone };
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
    expenseTotalFen: expenseStats.thisTotal,
    lastWeekExpenseTotalFen: expenseStats.lastTotal,
    weekOverWeekPct: expenseStats.wowPct,
    habitCompletionRate: habitStats.rate,
    habitExpectedCount: habitStats.totalPossible,
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
      type: stats.weekOverWeekPct > 20 ? 'anomaly' : 'pattern',
      title: `近7天消费比前7天${direction}${emoji}`,
      description: `近7天记录支出¥${(stats.expenseTotalFen / 100).toFixed(0)}，${stats.weekOverWeekPct > 0 ? '比前7天多' : '比前7天少'}了${Math.abs(stats.weekOverWeekPct)}%。${stats.topCategory ? `大头是${getCategoryLabel(stats.topCategory)}（¥${(stats.topCategoryAmountFen / 100).toFixed(0)}）。` : ''}`,
      dataSources: ['expense'],
      actionSuggested: stats.weekOverWeekPct > 20
        ? `看看${stats.topCategory ? getCategoryLabel(stats.topCategory) : '消费'}明细，找出增长点`
        : undefined,
    });
  }

  if (stats.habitCompletionRate > 0 && stats.habitCompletionRate >= 70) {
    insights.push({
      type: 'positive',
      title: `习惯完成率 ${stats.habitCompletionRate}%`,
      description: `近7天的习惯完成率为${stats.habitCompletionRate}%，按每日或每周频率、创建日期计算。可以按适合自己的节奏继续。`,
      dataSources: ['habit'],
    });
  } else if (stats.habitCompletionRate > 0 && stats.habitCompletionRate < 30) {
    insights.push({
      type: 'anomaly',
      title: '习惯记录回顾',
      description: `近7天已记录的习惯完成率为${stats.habitCompletionRate}%。未打卡不一定代表没做过，也可以按实际安排调整计划。`,
      dataSources: ['habit'],
      actionSuggested: '挑一个最简单的习惯先恢复',
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
  lines.push('## 近7天回顾\n');

  lines.push(`📊 消费：¥${(stats.expenseTotalFen / 100).toFixed(0)}`);
  if (stats.weekOverWeekPct !== null) {
    const arrow = stats.weekOverWeekPct > 0 ? '↑' : '↓';
    lines.push(`   ${arrow}${Math.abs(stats.weekOverWeekPct)}% vs 前7天`);
  }
  if (stats.topCategory) {
    lines.push(`   最大支出：${getCategoryLabel(stats.topCategory)} ¥${(stats.topCategoryAmountFen / 100).toFixed(0)}`);
  }

  if (stats.habitExpectedCount > 0) {
    lines.push(`\n✅ 习惯完成率：${stats.habitCompletionRate}%（按频率与创建日期计算）`);
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
