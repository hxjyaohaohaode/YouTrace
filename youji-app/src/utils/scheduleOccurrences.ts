import type { ScheduleRecord, ScheduleException } from '../db';
import { parseBusinessDate, addDays, daysBetween } from './date';
type ScheduleSource = Pick<ScheduleRecord, 'date' | 'repeat'> & { id?: string; exceptions?: ScheduleException[] };
export type Occurrence<T> = T & { virtualId: string; occurrenceDate: string; source: T };
/** Calendar, Home and other current views must project the same exceptions. */
export function expandScheduleRows<T extends ScheduleSource>(items: readonly T[], startDate: string, endDate: string): Occurrence<T>[] {
  parseBusinessDate(startDate); parseBusinessDate(endDate);
  const expanded: Occurrence<T>[] = [];
  for (const source of items) {
    if (source.repeat !== 'weekly') {
      if (source.date >= startDate && source.date <= endDate) expanded.push({ ...source, virtualId: source.id ?? source.date, occurrenceDate: source.date, source });
      continue;
    }
    try { parseBusinessDate(source.date); } catch { continue; }
    const exceptions = new Map((source.exceptions ?? []).map(row => [row.occurrenceDate, row]));
    const first = source.date >= startDate ? source.date : addDays(source.date, Math.ceil(daysBetween(source.date, startDate) / 7) * 7);
    for (let date = first; date <= endDate; date = addDays(date, 7)) {
      if (!exceptions.has(date)) expanded.push({ ...source, date, virtualId: `${source.id}@${date}`, occurrenceDate: date, source });
    }
    for (const exception of exceptions.values()) {
      if (exception.cancelled || exception.date < startDate || exception.date > endDate) continue;
      expanded.push({ ...source, ...exception, virtualId: `${source.id}@${exception.occurrenceDate}`, occurrenceDate: exception.occurrenceDate, source });
    }
  }
  return expanded;
}
