import type { ExpenseItem } from '../stores/expenseStore';
import type { TodoItem } from '../stores/todoStore';
import type { HabitItem } from '../stores/habitStore';
import type { QuickNoteRecord } from '../stores/quickNoteStore';
import type { DiaryRecord, HabitCheckinRecord, ScheduleRecord } from '../db';
import { formatBusinessDate } from '../utils/date';
import { isCaptureDate } from './parser';
export interface TimelineEntry { id: string; type: 'expense' | 'todo_done' | 'habit' | 'diary' | 'schedule' | 'capture'; title: string; detail: string; date: string | null; occurredAt: number | null; route: string; recordId: string }
export interface TimelineData { expenses: ExpenseItem[]; todos: TodoItem[]; habits: HabitItem[]; checkins: HabitCheckinRecord[]; diaries: DiaryRecord[]; schedules: ScheduleRecord[]; notes: QuickNoteRecord[] }
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8640000000000000;
/** Date-only sources remain date-only; a deadline never becomes a completion. */
export function timelineEntries(data: TimelineData): TimelineEntry[] {
  const rows: TimelineEntry[] = [];
  const add = (row: Omit<TimelineEntry, 'id'>) => rows.push({ ...row, id: `${row.type}:${row.recordId}:${row.date ?? 'unknown'}` });
  for (const row of data.expenses) add({ type: 'expense', recordId: row.id, title: `${row.isIncome ? '+' : '-'}¥${(row.amount / 100).toFixed(2)} ${row.name}`, detail: '记账日期 · 未记录具体发生时间', date: isCaptureDate(row.date) ? row.date : null, occurredAt: null, route: `/expense?record=${encodeURIComponent(row.id)}` });
  for (const row of data.todos) {
    if (!row.done) continue;
    const completedAt = (row as TodoItem & { completedAt?: number | null }).completedAt;
    const time = validTime(completedAt) && completedAt <= Date.now() ? completedAt : null;
    add({ type: 'todo_done', recordId: row.id, title: row.text, detail: time ? '完成待办' : `已完成 · 完成时间未记录${row.dueDate ? ` · 截止日期 ${row.dueDate}` : ''}`, date: time ? formatBusinessDate(new Date(time)) : null, occurredAt: time, route: `/todo?record=${encodeURIComponent(row.id)}` });
  }
  for (const row of data.checkins) {
    if (!row.done) continue;
    const parent = data.habits.find(habit => habit.id === row.habitId);
    if (!parent) continue;
    add({ type: 'habit', recordId: row.id, title: `${parent.icon} ${parent.name}`, detail: '打卡所属日期 · 可包含补卡', date: isCaptureDate(row.date) ? row.date : null, occurredAt: null, route: `/habit?record=${encodeURIComponent(parent.id)}&date=${encodeURIComponent(row.date)}` });
  }
  for (const row of data.diaries) add({ type: 'diary', recordId: row.id, title: row.content.slice(0, 80) || '日记', detail: '日记所属日期', date: isCaptureDate(row.date) ? row.date : null, occurredAt: null, route: `/diary?record=${encodeURIComponent(row.id)}` });
  for (const row of data.schedules) {
    add({ type: 'schedule', recordId: row.id, title: row.title, detail: `${row.repeat === 'weekly' ? '每周系列起始日 · 单次调整另列 · ' : ''}计划 ${row.startTime}–${row.endTime} · 不代表已完成`, date: isCaptureDate(row.date) ? row.date : null, occurredAt: null, route: `/schedule?record=${encodeURIComponent(row.id)}` });
    for (const exception of row.exceptions ?? []) rows.push({ id: `schedule-exception:${row.id}:${exception.occurrenceDate}`, type: 'schedule', recordId: row.id, title: exception.title, detail: exception.cancelled ? `已取消 ${exception.occurrenceDate} 这一次安排` : `单次调整 · 原日期 ${exception.occurrenceDate} · 计划 ${exception.startTime}–${exception.endTime} · 不代表已完成`, date: exception.cancelled ? exception.occurrenceDate : exception.date, occurredAt: null, route: `/schedule?record=${encodeURIComponent(row.id)}&occurrence=${encodeURIComponent(exception.occurrenceDate)}` });
  }
  for (const row of data.notes) {
    const time = validTime(row.createdAt) ? row.createdAt : null;
    add({ type: 'capture', recordId: row.id, title: row.rawInput.slice(0, 80), detail: row.confirmed ? '已确认的原始速记 · 保存时间' : '原始速记 · 确认状态未知', date: time ? formatBusinessDate(new Date(time)) : null, occurredAt: time, route: `/timeline?record=${encodeURIComponent(row.id)}` });
  }
  return rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.occurredAt ?? 0) - (a.occurredAt ?? 0) || a.id.localeCompare(b.id));
}
export function timelineTimeLabel(entry: TimelineEntry, now = Date.now()): string {
  if (entry.occurredAt === null) return entry.date ? '日期记录' : '时间未知';
  if (entry.occurredAt > now) return '时间待核对';
  const elapsed = now - entry.occurredAt;
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}小时前`;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(entry.occurredAt);
}
