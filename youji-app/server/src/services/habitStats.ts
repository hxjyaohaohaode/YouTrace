import { prisma } from '../utils/db.js'
import { addDays, getToday } from '../utils/date.js'

export interface HabitStatsEntry {
  done: boolean
  streak: number
  recentCheckins: { date: string; done: boolean }[]
}

export async function computeHabitStats(
  userId: string,
  habitIds: string[],
): Promise<Map<string, HabitStatsEntry>> {
  const today = getToday()
  const windowStart = addDays(today, -59)

  const checkins = await prisma.habitCheckin.findMany({
    where: { habit: { userId }, date: { gte: windowStart } },
    select: { habitId: true, date: true, done: true },
  })

  const doneDatesByHabit = new Map<string, Set<string>>()
  for (const checkin of checkins) {
    if (!checkin.done) continue
    let dates = doneDatesByHabit.get(checkin.habitId)
    if (!dates) {
      dates = new Set()
      doneDatesByHabit.set(checkin.habitId, dates)
    }
    dates.add(checkin.date)
  }

  const recentDates: string[] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    recentDates.push(addDays(today, -offset))
  }

  const result = new Map<string, HabitStatsEntry>()
  for (const habitId of habitIds) {
    const doneDates = doneDatesByHabit.get(habitId) ?? new Set<string>()
    const done = doneDates.has(today)

    let streak = 0
    let cursor = done ? today : addDays(today, -1)
    while (doneDates.has(cursor)) {
      streak += 1
      cursor = addDays(cursor, -1)
    }

    result.set(habitId, {
      done,
      streak,
      recentCheckins: recentDates.map((date) => ({ date, done: doneDates.has(date) })),
    })
  }

  return result
}
