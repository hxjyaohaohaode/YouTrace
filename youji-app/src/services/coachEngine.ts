import type { InsightType, CoachInsightRecord, CoachPushRecord } from '../stores/coachStore';
import { useExpenseStore } from '../stores/expenseStore';
import { useHabitStore } from '../stores/habitStore';
import { useQuickNoteStore } from '../stores/quickNoteStore';
import { useCoachStore } from '../stores/coachStore';
import { assessEmotionState } from './emotionEngine';
import { universalInsights } from './insightLibrary';
import { getPushControlState } from './pushControl';
import { getToday } from '../utils/date';

export interface InsightTemplate {
  type: InsightType;
  title: string;
  description: string;
  dataSources: string[];
  actionSuggested?: string;
  significance: number;
}

function formatYuan(fen: number): string {
  return `¥${(fen / 100).toFixed(0)}`;
}

function detectExpenseAnomalies(): InsightTemplate[] {
  const insights: InsightTemplate[] = [];
  const store = useExpenseStore.getState();
  const items = store.items;

  if (items.length === 0) return insights;

  const today = getToday();
  const todayItems = items.filter((i) => i.date === today && !i.isIncome);
  const todayTotalFen = todayItems.reduce((sum, i) => sum + i.amount, 0);

  if (todayTotalFen > 8000) {
    insights.push({
      type: 'anomaly',
      title: '今日花销偏高',
      description: `今天已经花了${formatYuan(todayTotalFen)}，比平时的单日水平高出不少。是有什么特别的开销吗？`,
      dataSources: ['expense'],
      actionSuggested: '回顾一下今天的消费，看看哪些是非必要的',
      significance: 0.7,
    });
  }

  const monthTotalFen = store.monthTotal();
  const monthBudgetFen = store.monthBudget;
  if (monthBudgetFen > 0 && monthTotalFen / monthBudgetFen > 0.7 && monthTotalFen <= monthBudgetFen) {
    const percent = Math.round((monthTotalFen / monthBudgetFen) * 100);
    insights.push({
      type: 'anomaly',
      title: '预算使用过快',
      description: `本月已花${formatYuan(monthTotalFen)}，占预算的${percent}%。按当前节奏，月底可能吃紧。`,
      dataSources: ['expense'],
      actionSuggested: '本周尝试减少2次非必要消费',
      significance: 0.75,
    });
  }

  if (monthBudgetFen > 0 && monthTotalFen > monthBudgetFen) {
    insights.push({
      type: 'anomaly',
      title: '本月预算已超支',
      description: `本月已花${formatYuan(monthTotalFen)}，超出了预算${formatYuan(monthBudgetFen)}。别自责，看看钱主要花在哪了。`,
      dataSources: ['expense'],
      actionSuggested: '查看本月分类统计，找出最大的支出项',
      significance: 0.8,
    });
  }

  return insights;
}

function detectHabitAnomalies(): InsightTemplate[] {
  const insights: InsightTemplate[] = [];
  const items = useHabitStore.getState().items;

  if (items.length === 0) return insights;

  for (const habit of items) {
    if (!habit.done && habit.streak > 5) {
      insights.push({
        type: 'pattern',
        title: `${habit.name}可能要中断`,
        description: `${habit.name}已经连续坚持了${habit.streak}天，但今天还没完成。坚持了这么久，别让连续记录断在这里。`,
        dataSources: ['habit'],
        actionSuggested: `现在完成一次${habit.name}，哪怕只做最小版本`,
        significance: 0.7,
      });
    }
  }

  const doneCount = items.filter((h) => h.done).length;
  if (items.length >= 2 && doneCount / items.length < 0.3) {
    insights.push({
      type: 'anomaly',
      title: '今天习惯完成率较低',
      description: `今天${items.length}个习惯中只完成了${doneCount}个。没关系，重要的是明天继续。`,
      dataSources: ['habit'],
      actionSuggested: '挑一个最简单的习惯先完成',
      significance: 0.55,
    });
  }

  if (items.length > 0 && doneCount === items.length) {
    insights.push({
      type: 'positive',
      title: '今日习惯全部完成！',
      description: `${items.length}个习惯全部完成，连续坚持的感觉很好。今天的自己值得表扬。`,
      dataSources: ['habit'],
      significance: 0.8,
    });
  }

  return insights;
}

function detectGroundedObservations(): InsightTemplate[] {
  const insights: InsightTemplate[] = [];
  const expenseStore = useExpenseStore.getState();
  const quickNoteStore = useQuickNoteStore.getState();

  const recentNotes = quickNoteStore.records.slice(0, 10);
  const lowMoodNotes = recentNotes.filter(
    (r) => r.mood === 'low' || r.mood === 'sad'
  );

  const today = getToday();
  const todayExpenses = expenseStore.items.filter((i) => i.date === today && !i.isIncome);
  const todayTotalFen = todayExpenses.reduce((sum, i) => sum + i.amount, 0);

  if (lowMoodNotes.length >= 2 && todayTotalFen > 5000) {
    insights.push({
      type: 'correlation',
      title: '情绪与消费的观察',
      description: `最近有${lowMoodNotes.length}条记录情绪偏低，同时今天花了${formatYuan(todayTotalFen)}。情绪波动的时候更容易冲动消费，要不要聊聊最近的状态？`,
      dataSources: ['expense', 'mood'],
      actionSuggested: '下次想买东西时，先等10分钟再决定',
      significance: 0.75,
    });
  }

  const habitStore = useHabitStore.getState();
  const habitsDone = habitStore.items.filter((h) => h.done).length;
  if (habitsDone > 0 && habitStore.items.length > 0 && lowMoodNotes.length === 0) {
    insights.push({
      type: 'correlation',
      title: '习惯与状态的正向循环',
      description: `今天完成了${habitsDone}个习惯，最近的记录里情绪也不错。保持这个节奏，好状态会继续滚雪球。`,
      dataSources: ['habit', 'mood'],
      significance: 0.65,
    });
  }

  return insights;
}

export function runCoachEngine(): CoachInsightRecord[] {
  const existingInsights = useCoachStore.getState().insights;
  const existingTitles = new Set(existingInsights.map((i) => i.title));

  const emotionState = assessEmotionState();
  if (emotionState.shouldOnlyCompanion) {
    return [];
  }

  const allDetected: InsightTemplate[] = [
    ...detectExpenseAnomalies(),
    ...detectHabitAnomalies(),
    ...detectGroundedObservations(),
  ];

  if (emotionState.shouldReduceAdvice) {
    const limited = allDetected.filter((i) => i.type === 'positive').slice(0, 1);
    allDetected.length = 0;
    allDetected.push(...limited);
  }

  if (allDetected.length < 2) {
    const available = universalInsights.filter(
      (g) => !existingTitles.has(g.title)
    );
    if (available.length > 0) {
      const chosen = available[Math.floor(Math.random() * available.length)];
      allDetected.push({
        type: chosen.type,
        title: chosen.title,
        description: chosen.description,
        dataSources: chosen.dataSources,
        actionSuggested: chosen.actionSuggested,
        significance: chosen.significance,
      });
    }
  }

  const newInsights: CoachInsightRecord[] = [];
  for (const template of allDetected) {
    if (existingTitles.has(template.title)) continue;

    newInsights.push({
      id: `ins-${Date.now()}-${newInsights.length}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      type: template.type,
      title: template.title,
      description: template.description,
      dataSources: template.dataSources,
      actionSuggested: template.actionSuggested,
      dismissed: false,
      significance: template.significance,
      createdAt: Date.now() + newInsights.length,
    });
  }

  return newInsights;
}

export async function generatePushesFromInsights(
  insights: CoachInsightRecord[],
): Promise<Array<Omit<CoachPushRecord, 'id' | 'createdAt' | 'type'> & { type: Exclude<CoachPushRecord['type'], 'daily_brief'> }>> {
  const pushes: Array<Omit<CoachPushRecord, 'id' | 'createdAt' | 'type'> & { type: Exclude<CoachPushRecord['type'], 'daily_brief'> }> = [];

  if (insights.length === 0) return pushes;

  const control = await getPushControlState();
  let budget = control.maxDailyPushes - control.todayPushCount;
  if (budget <= 0) {
    const positiveOnly = insights.filter((i) => i.type === 'positive' && !i.dismissed);
    for (const insight of positiveOnly.slice(0, 1)) {
      pushes.push({
        insightId: insight.id,
        type: 'positive',
        title: insight.title,
        body: insight.description,
        actions: [{ label: '知道了', type: 'confirm' }],
        read: false,
        acted: false,
      });
    }
    return pushes;
  }

  for (const insight of insights) {
    if (budget <= 0) break;
    if (insight.dismissed) continue;

    let pushType: CoachPushRecord['type'] = 'anomaly';
    if (insight.type === 'positive') pushType = 'positive';
    else if (insight.type === 'correlation') pushType = 'follow_up';
    else if (insight.type === 'suggestion') pushType = 'follow_up';

    pushes.push({
      insightId: insight.id,
      type: pushType,
      title: insight.title,
      body: insight.description,
      actions: [
        { label: '知道了', type: 'confirm' },
        { label: '忽略', type: 'dismiss' },
        ...(insight.actionSuggested
          ? [{ label: '和教练聊聊', type: 'chat' as const }]
          : []),
      ],
      read: false,
      acted: false,
    });

    if (pushType !== 'positive') {
      budget -= 1;
    }
  }

  return pushes;
}
