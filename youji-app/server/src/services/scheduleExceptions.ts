import { z } from 'zod'
export const validScheduleDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
const date = z.string().refine(validScheduleDate, '日程日期无效')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const scheduleExceptionSchema = z.object({
  occurrenceDate: date, cancelled: z.boolean().optional(), date, startTime: time, endTime: time,
  title: z.string().trim().min(1).max(100), location: z.string().max(100), type: z.enum(['class', 'study', 'work', 'social', 'other']), remind: z.number().int().min(0).max(1440),
}).strict().refine(row => row.startTime < row.endTime, '结束时间必须晚于开始时间')
export const scheduleExceptionsSchema = z.array(scheduleExceptionSchema).max(500).refine(rows => new Set(rows.map(row => row.occurrenceDate)).size === rows.length, '同一天不能重复调整')
export function exceptionsBelongToSeries(row: { date: string; repeat: string; exceptions?: Array<{ occurrenceDate: string }> }): boolean {
  return !row.exceptions?.length || row.repeat === 'weekly' && row.exceptions.every(item => item.occurrenceDate >= row.date && (Date.parse(`${item.occurrenceDate}T12:00:00Z`) - Date.parse(`${row.date}T12:00:00Z`)) % (7 * 86400000) === 0)
}
export function decodeScheduleExceptions(raw: string): unknown { return scheduleExceptionsSchema.parse(JSON.parse(raw)) }

/** Current schedule facts for brief/chat use resolved occurrences, never raw series. */
export function scheduleOccurrences<T extends { id: string; date: string; repeat: string; exceptions: string; startTime: string }>(rows: readonly T[], start: string, end: string) {
  const result: Array<T & { occurrenceDate: string }> = []
  const day = (date: string) => Date.parse(`${date}T12:00:00Z`), dateOf = (time: number) => new Date(time).toISOString().slice(0, 10)
  for (const row of rows) {
    if (!validScheduleDate(row.date)) continue
    if (row.repeat !== 'weekly') { if (row.date >= start && row.date <= end) result.push({ ...row, occurrenceDate: row.date }); continue }
    const exceptions = scheduleExceptionsSchema.parse(JSON.parse(row.exceptions))
    const changed = new Set(exceptions.map(item => item.occurrenceDate))
    const first = day(row.date) >= day(start) ? day(row.date) : day(row.date) + Math.ceil((day(start) - day(row.date)) / (7 * 86400000)) * 7 * 86400000
    for (let time = first; time <= day(end); time += 7 * 86400000) { const date = dateOf(time); if (!changed.has(date)) result.push({ ...row, date, occurrenceDate: date }) }
    for (const exception of exceptions) if (!exception.cancelled && exception.date >= start && exception.date <= end) result.push({ ...row, ...exception })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
}
