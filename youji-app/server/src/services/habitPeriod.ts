import { addDays } from '../utils/date.js'

export function projectHabitStats(frequency: string, checkins: { date: string; done: boolean }[], today: string) {
  const day = new Date(`${today}T12:00:00+08:00`).getUTCDay() || 7
  const weekly = frequency === 'weekly', start = weekly ? addDays(today, 1 - day) : today
  const end = weekly ? addDays(start, 6) : today
  const doneDates = new Set(checkins.filter(row => row.done && row.date <= today).map(row => row.date))
  const completedDates = [...doneDates].filter(date => date >= start).sort()
  const done = doneDates.has(today)
  let streak = 0, cursor = done ? today : addDays(today, -1)
  // A weekly plan does not imply a daily streak. Daily history is not silently capped.
  if (!weekly) while (doneDates.has(cursor)) { streak += 1; cursor = addDays(cursor, -1) }
  return { done, streak, period: { frequency: weekly ? 'weekly' : 'daily', start, end, attained: completedDates.length > 0, completedDates },
    recentCheckins: Array.from({ length: 7 }, (_, index) => { const date = addDays(today, index - 6); return { date, done: doneDates.has(date) } }) }
}
