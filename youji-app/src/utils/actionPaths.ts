import type { InsightType } from '../stores/coachStore';

const SOURCE_PRIORITY: Array<{ source: string; path: string }> = [
  { source: 'expense', path: '/expense' },
  { source: 'habit', path: '/habit' },
  { source: 'schedule', path: '/schedule' },
  { source: 'todo', path: '/todo' },
  { source: 'diary', path: '/diary' },
  { source: 'mood', path: '/diary' },
];

export const dataSourceLabels: Record<string, string> = {
  expense: '花销',
  habit: '习惯',
  schedule: '日程',
  todo: '待办',
  diary: '日记',
  mood: '情绪',
};

export function resolveActionPath(dataSources: string[]): string {
  for (const { source, path } of SOURCE_PRIORITY) {
    if (dataSources.includes(source)) return path;
  }
  return '/coach';
}

export function resolvePushPath(pushType: string): string {
  switch (pushType) {
    case 'evening_review':
      return '/quick-note';
    case 'daily_brief':
      return '/coach';
    case 'positive':
      return '/';
    case 'anomaly':
    case 'follow_up':
    default:
      return '/insights';
  }
}

export function resolveInsightTypePath(type: InsightType): string {
  switch (type) {
    case 'anomaly':
      return '/expense';
    case 'positive':
      return '/habit';
    default:
      return '/insights';
  }
}
