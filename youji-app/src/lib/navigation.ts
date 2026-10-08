import { Activity, BarChart3, BookOpen, Calendar, CheckSquare, Home, MessageCircle, Mic, Settings, Sparkles, Target, type LucideIcon } from 'lucide-react';

export type NavigationGroup = '记录与回看' | '安排与坚持' | '观察与行动' | '账号与偏好';
export interface Destination { path: string; label: string; description: string; icon: LucideIcon; group: NavigationGroup }
/** Static routes only: never store record IDs, input, or account details here. */
export const destinations: Destination[] = [
  { path: '/quick-note', label: '速记', description: '写一句话，核对后再保存', icon: Mic, group: '记录与回看' },
  { path: '/expense', label: '花销', description: '记录收支，核对金额与预算', icon: BarChart3, group: '记录与回看' },
  { path: '/diary', label: '日记', description: '留下文字，可不记录心情', icon: BookOpen, group: '记录与回看' },
  { path: '/timeline', label: '时间线', description: '按日期找回具体记录并修改', icon: Activity, group: '记录与回看' },
  { path: '/schedule', label: '日程', description: '安排有日期与时段的事情', icon: Calendar, group: '安排与坚持' },
  { path: '/todo', label: '待办', description: '列出要做的事，随时改期', icon: CheckSquare, group: '安排与坚持' },
  { path: '/habit', label: '习惯', description: '记录已做到的事，可补记或撤销', icon: Sparkles, group: '安排与坚持' },
  { path: '/goal', label: '目标', description: '设定方向，按实际情况调整进度', icon: Target, group: '安排与坚持' },
  { path: '/coach', label: 'AI 教练', description: '围绕自己的记录提问与讨论', icon: MessageCircle, group: '观察与行动' },
  { path: '/insights', label: '教练洞察', description: '查看观察与建议，自主决定是否采用', icon: Target, group: '观察与行动' },
  { path: '/settings', label: '设置', description: '账号、同步、提醒与数据管理', icon: Settings, group: '账号与偏好' },
];
export const navigationGroups: NavigationGroup[] = ['记录与回看', '安排与坚持', '观察与行动', '账号与偏好'];
export const homeDestination = { path: '/', label: '首页', icon: Home };
export function destinationFor(path: unknown) { return typeof path === 'string' ? destinations.find(item => item.path === path) : undefined; }
export function isMoreDestination(path: string) { return path === '/more' || destinations.some(item => item.path === path && !['/quick-note', '/expense', '/schedule'].includes(path)); }

export function navigationReturnTarget(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 2048) return null;
  const path = value.split(/[?#]/, 1)[0];
  const destination = path === '/' ? homeDestination : destinationFor(path);
  return destination ? { path: value, label: destination.label } : null;
}

export interface DirectoryPosition { top: number; path: string }
export function parseDirectoryPosition(raw: string | null): DirectoryPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && !Array.isArray(value) && destinationFor(value.path) && typeof value.top === 'number' && Number.isFinite(value.top) && value.top >= 0 && value.top <= 100000 ? { top: value.top, path: value.path } : null;
  } catch { return null; }
}

export function directoryEntry(from: string, ownerId: string | undefined) {
  return ownerId && navigationReturnTarget(from) ? { from, ownerId, entry: 'youtrace-directory' } : undefined;
}
export function directoryOrigin(state: unknown, ownerId: string) {
  if (!ownerId || !state || typeof state !== 'object' || Array.isArray(state)) return null;
  const value = state as Record<string, unknown>;
  return value.entry === 'youtrace-directory' && value.ownerId === ownerId ? navigationReturnTarget(value.from) : null;
}

/** Explicit plain-page navigation; precise record and immersive routes own their focus. */
export function staticPageEntry(path: string, ownerId: string | undefined) {
  return ownerId && path !== '/quick-note' && navigationReturnTarget(path)?.path === path && !path.includes('?') && !path.includes('#')
    ? { entry: 'youtrace-static-page', path, ownerId }
    : undefined;
}
export function isStaticPageEntry(state: unknown, ownerId: string, path: string, navigationType: string) {
  if (!ownerId || !state || typeof state !== 'object' || Array.isArray(state) || !staticPageEntry(path, ownerId)) return false;
  const value = state as Record<string, unknown>;
  const normalizedTimeline = navigationType === 'REPLACE' && path === '/timeline' && value.timelineRangeNormalized === true;
  if (navigationType !== 'PUSH' && !normalizedTimeline) return false;
  return value.entry === 'youtrace-static-page' && value.ownerId === ownerId && value.path === path;
}
