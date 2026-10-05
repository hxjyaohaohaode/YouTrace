import { prisma } from '../utils/db.js'
import { getToday } from '../utils/date.js'
import { projectHabitStats } from './habitPeriod.js'

export type HabitStatsEntry = ReturnType<typeof projectHabitStats>

export async function computeHabitStats(userId: string, habitIds: string[]): Promise<Map<string, HabitStatsEntry>> {
  const today = getToday()
  // Only this account's selected parents participate. Explicit dated facts do
  // not disappear because their dates predate an audit-createdAt timestamp.
  const habits = await prisma.habit.findMany({ where: { userId, id: { in: habitIds } }, select: { id: true, frequency: true, habitCheckins: { where: { date: { lte: today } }, select: { date: true, done: true } } } })
  return new Map(habits.map(habit => [habit.id, projectHabitStats(habit.frequency, habit.habitCheckins, today)]))
}
