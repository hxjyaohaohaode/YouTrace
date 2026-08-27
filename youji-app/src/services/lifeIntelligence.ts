import { db } from '../db';
import { addDays, getToday } from '../utils/date';
import type { InsightType } from '../stores/coachStore';

export interface WeeklyStats {
  expenseTotalFen: number;
  lastWeekExpenseTotalFen: number;
  weekOverWeekPct: number | null;
  habitCompletionRate: number;
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

  const totalPossible = habits.length * 7;
  const totalDone = habits.reduce((sum, h) => {
    return sum + weekDates.filter((d) => doneSet.has(`${h.id}|${d}`)).length;
  }, 0);

  return { rate: totalPossible > 0 ? Math.round((totalDone / totalPossible) * 100) : 0, totalPossible, totalDone };
}

async function computeTodoStats() {
  const todos = await db.todos.toArray();
  const done = todos.filter((t) => t.done).length;
  return { done, total: todos.length };
}

async function computeMoodStats() {
  const cutoff = addDays(getToday(), -6);
  const diaries = await db.diary.where('date').between(cutoff, getToday(), true, true).toArray();
  const scored = diaries
    .filter((d) => typeof d.moodScore === 'number' && d.moodScore > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (scored.length === 0) return { count: 0, avg: null, trend: null as string | null };

  const scores = scored.map((d) => d.moodScore!);
  const avg = Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10;

  let trend: string | null = null;
  if (scores.length >= 4) {
    const half = Math.floor(scores.length / 2);
    const first = scores.slice(0, half).reduce((s: number, n) => s + n, 0) / half;
    const second = scores.slice(half).reduce((s: number, n) => s + n, 0) / (scores.length - half);
    if (second > first + 0.5) trend = 'improving';
    else if (second < first - 0.5) trend = 'declining';
    else trend = 'stable';
  }

  return { count: scored.length, avg, trend };
}

async function computeActivityDays() {
  const cutoff = addDays(getToday(), -6);
  const [expenses, checkins] = await Promise.all([
    db.expenses.where('date').between(cutoff, getToday(), true, true).toArray(),
    db.habitCheckins.where('date').between(cutoff, getToday(), true, true).toArray(),
  ]);
  const activeDates = new Set<string>();
  for (const e of expenses) activeDates.add(e.date);
  for (const c of checkins) activeDates.add(c.date);
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

  const goals = await db.goals.toArray();

  return {
    expenseTotalFen: expenseStats.thisTotal,
    lastWeekExpenseTotalFen: expenseStats.lastTotal,
    weekOverWeekPct: expenseStats.wowPct,
    habitCompletionRate: habitStats.rate,
    todoDoneCount: todoStats.done,
    todoTotalCount: todoStats.total,
    diaryEntryCount: moodStats.count,
    avgMoodScore: moodStats.avg,
    moodTrend: moodStats.trend as WeeklyStats['moodTrend'],
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
      title: `本周消费比上周${direction}${emoji}`,
      description: `本周花了¥${(stats.expenseTotalFen / 100).toFixed(0)}，${stats.weekOverWeekPct > 0 ? '比上周多' : '比上周少'}了${Math.abs(stats.weekOverWeekPct)}%。${stats.topCategory ? `大头是${getCategoryLabel(stats.topCategory)}（¥${(stats.topCategoryAmountFen / 100).toFixed(0)}）。` : ''}`,
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
      description: `这周的习惯坚持得很好，完成率达到了${stats.habitCompletionRate}%。继续保持这个节奏。`,
      dataSources: ['habit'],
    });
  } else if (stats.habitCompletionRate > 0 && stats.habitCompletionRate < 30) {
    insights.push({
      type: 'anomaly',
      title: '习惯完成率偏低',
      description: `这周的习惯完成率只有${stats.habitCompletionRate}%。没关系，重新开始永远不晚。`,
      dataSources: ['habit'],
      actionSuggested: '挑一个最简单的习惯先恢复',
    });
  }

  if (stats.moodTrend === 'declining') {
    insights.push({
      type: 'correlation',
      title: '最近情绪有些下滑 📉',
      description: '日记里的情绪分数在逐渐降低。如果感到压力，减少一些不必要的消费和社交，多给自己一点空间。',
      dataSources: ['mood'],
      actionSuggested: '今晚早点休息，或者写一篇日记梳理一下',
    });
  } else if (stats.moodTrend === 'improving') {
    insights.push({
      type: 'positive',
      title: '情绪在持续好转 📈',
      description: '日记里的情绪分数在稳步上升。你在做对的事情，继续保持。',
      dataSources: ['mood'],
    });
  }

  if (stats.daysActive <= 2 && stats.daysActive > 0) {
    insights.push({
      type: 'suggestion',
      title: '这周只记录了少数几天',
      description: `过去一周只有${stats.daysActive}天有记录。数据越多，教练越了解你。哪怕一句话的速记也有价值。`,
      dataSources: ['habit', 'expense'],
      actionSuggested: '用语音速记说一句今天的事，只要10秒',
    });
  }

  if (stats.todoTotalCount > 0 && stats.todoDoneCount / stats.todoTotalCount >= 0.8) {
    insights.push({
      type: 'positive',
      title: '待办完成率很高！',
      description: `${stats.todoDoneCount}/${stats.todoTotalCount}个待办已完成。执行力和自律都在线。`,
      dataSources: ['todo'],
    });
  }

  return insights;
}

export async function generateWeeklyReview(): Promise<string> {
  const stats = await computeWeeklyStats();

  const lines: string[] = [];
  lines.push('## 本周回顾\n');

  lines.push(`📊 消费：¥${(stats.expenseTotalFen / 100).toFixed(0)}`);
  if (stats.weekOverWeekPct !== null) {
    const arrow = stats.weekOverWeekPct > 0 ? '↑' : '↓';
    lines.push(`   ${arrow}${Math.abs(stats.weekOverWeekPct)}% vs 上周`);
  }
  if (stats.topCategory) {
    lines.push(`   最大支出：${getCategoryLabel(stats.topCategory)} ¥${(stats.topCategoryAmountFen / 100).toFixed(0)}`);
  }

  if (stats.habitCompletionRate > 0) {
    lines.push(`\n✅ 习惯完成率：${stats.habitCompletionRate}%`);
  }

  if (stats.todoTotalCount > 0) {
    lines.push(`\n☑️ 待办：${stats.todoDoneCount}/${stats.todoTotalCount} 已完成`);
  }

  if (stats.diaryEntryCount > 0) {
    lines.push(`\n📝 日记：${stats.diaryEntryCount} 篇`);
    if (stats.avgMoodScore !== null) {
      lines.push(`   平均心情 ${stats.avgMoodScore}/10`);
    }
  }

  if (stats.activeGoalCount > 0 || stats.completedGoalCount > 0) {
    lines.push(`\n🎯 目标：${stats.activeGoalCount} 个进行中`);
    if (stats.completedGoalCount > 0) lines.push(`   ✨ ${stats.completedGoalCount} 个已完成`);
  }

  lines.push(`\n📅 活跃天数：${stats.daysActive}/7 天`);

  return lines.join('\n');
}
