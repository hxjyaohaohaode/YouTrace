import type { InsightType, CoachInsightRecord, CoachPushRecord } from '../stores/coachStore';
import { useExpenseStore } from '../stores/expenseStore';
import { useHabitStore } from '../stores/habitStore';
import { useCoachStore } from '../stores/coachStore';
import { assessEmotionState } from './emotionEngine';
import { canPush, getPushControlState } from './pushControl';
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
      title: '今日花销记录',
      description: `今天已经花了${formatYuan(todayTotalFen)}。这只是已记录的金额，是否符合预期由你判断。`,
      dataSources: ['expense'],
      actionSuggested: '如有需要，查看今天的消费明细',
      significance: 0.7,
    });
  }

  const monthTotalFen = store.monthTotal();
  const monthBudgetFen = store.monthBudget;
  if (monthBudgetFen > 0 && monthTotalFen / monthBudgetFen > 0.7 && monthTotalFen <= monthBudgetFen) {
    const percent = Math.round((monthTotalFen / monthBudgetFen) * 100);
    insights.push({
      type: 'anomaly',
      title: '本月预算使用情况',
      description: `本月已花${formatYuan(monthTotalFen)}，占预算的${percent}%。是否需要调整，可以结合本月剩余安排决定。`,
      dataSources: ['expense'],
      actionSuggested: '查看本月预算与支出明细',
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
  // The daily reminder must not treat a once-weekly habit as overdue each day.
  const items = useHabitStore.getState().items.filter((habit) => habit.frequency === 'daily');

  if (items.length === 0) return insights;

  for (const habit of items) {
    if (!habit.done && habit.streak > 5) {
      insights.push({
        type: 'pattern',
        title: `${habit.name}可能要中断`,
        description: `${habit.name}已经连续坚持了${habit.streak}天，但今天还没完成。今天的安排可以按实际精力调整，连续记录不是压力。`,
        dataSources: ['habit'],
        actionSuggested: `如果适合今天的安排，可以做一次${habit.name}的最小版本`,
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
  ];

  if (emotionState.shouldReduceAdvice) {
    const limited = allDetected.filter((i) => i.type === 'positive').slice(0, 1);
    allDetected.length = 0;
    allDetected.push(...limited);
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
  let budget = Math.max(0, control.maxDailyPushes - control.todayPushCount);
  if (budget <= 0) return pushes;

  for (const insight of insights) {
    if (budget <= 0) break;
    if (insight.dismissed) continue;

    let pushType: CoachPushRecord['type'] = 'anomaly';
    if (insight.type === 'positive') pushType = 'positive';
    else if (insight.type === 'correlation') pushType = 'follow_up';
    else if (insight.type === 'suggestion') pushType = 'follow_up';

    if (!await canPush(control, pushType)) continue;

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

    budget -= 1;
    control.todayPushCount += 1;
    if (pushType === 'positive') control.todayPositiveCount += 1;
  }

  return pushes;
}
