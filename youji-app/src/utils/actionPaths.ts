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
  quicknote: '速记',
  habit: '习惯',
  schedule: '日程',
  todo: '待办',
  diary: '日记',
  mood: '情绪',
};

export function resolveActionPath(dataSources: string[], actionSuggested?: string): string {
  // Exact known action semantics, never guess a destination from prose or the
  // first evidence category when this suggestion explicitly creates a capture.
  if (actionSuggested === '有想留下的事时，再写一句速记') return '/quick-note';
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
