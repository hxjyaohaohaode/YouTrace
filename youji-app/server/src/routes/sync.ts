import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'
import { consumeRateLimit } from '../utils/rateLimit.js'

export const syncRoutes = new Hono()

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const scheduleSyncSchema = z.object({
  id: z.string().min(8).max(64),
  title: z.string().trim().min(1).max(100),
  date: isoDateSchema,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  type: z.enum(['class', 'study', 'work', 'social', 'other']).optional().default('other'),
  location: z.string().trim().max(100).optional().default(''),
  repeat: z.enum(['none', 'weekly']).optional().default('none'),
  remind: z.number().int().min(0).max(1440).optional().default(0),
})

const expenseSyncSchema = z.object({
  id: z.string().min(8).max(64),
  amount: z.number().int().positive().max(100_000_000_00),
  category: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  date: isoDateSchema,
  source: z.string().trim().max(30).optional().default('manual'),
  relatedMood: z.string().trim().max(30).optional(),
  isIncome: z.boolean().optional(),
  note: z.string().trim().max(200).optional(),
})

const todoSyncSchema = z.object({
  id: z.string().min(8).max(64),
  text: z.string().trim().min(1).max(200),
  dueDate: isoDateSchema.optional(),
  priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  done: z.boolean().optional().default(false),
})

const habitSyncSchema = z.object({
  id: z.string().min(8).max(64),
  name: z.string().trim().min(1).max(100),
  icon: z.string().min(1).max(16),
  frequency: z.enum(['daily', 'weekly']).optional().default('daily'),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
})

const quickNoteSyncSchema = z.object({
  id: z.string().min(8).max(64),
  content: z.string().trim().min(1).max(5000),
  timestamp: z.union([z.number(), z.string(), z.bigint()])
    .transform((value) => Number(value))
    .pipe(z.number().int().safe().nonnegative()),
  parsed: z.unknown().optional().default({}),
  confirmed: z.boolean().optional().default(false),
})

const diarySyncSchema = z.object({
  id: z.string().min(8).max(64),
  date: isoDateSchema,
  content: z.string().trim().min(1).max(10000),
  mood: z.string().trim().max(30).optional(),
  moodScore: z.number().int().min(1).max(10).optional(),
  source: z.string().trim().max(30).optional().default('manual'),
  aiInsight: z.string().trim().max(2000).optional(),
})

const checkinSyncSchema = z.object({
  habitId: z.string().min(8).max(64),
  date: isoDateSchema,
  done: z.boolean().optional().default(true),
  source: z.enum(['manual', 'ai', 'schedule']).optional().default('manual'),
  aiReason: z.string().trim().max(500).optional(),
})

const deletionsSchema = z.object({
  scheduleIds: z.array(z.string().max(64)).max(2000).optional(),
  expenseIds: z.array(z.string().max(64)).max(2000).optional(),
  todoIds: z.array(z.string().max(64)).max(2000).optional(),
  habitIds: z.array(z.string().max(64)).max(2000).optional(),
  quickNoteIds: z.array(z.string().max(64)).max(2000).optional(),
  diaryIds: z.array(z.string().max(64)).max(2000).optional(),
})

const syncPayloadSchema = z.object({
  schedules: z.array(scheduleSyncSchema).max(500).optional(),
  expenses: z.array(expenseSyncSchema).max(1000).optional(),
  todos: z.array(todoSyncSchema).max(1000).optional(),
  habits: z.array(habitSyncSchema).max(200).optional(),
  quickNotes: z.array(quickNoteSyncSchema).max(500).optional(),
  diaries: z.array(diarySyncSchema).max(366).optional(),
  habitCheckins: z.array(checkinSyncSchema).max(1000).optional(),
  deletions: deletionsSchema.optional(),
})

class SyncOwnershipError extends Error {
  constructor(resource: string) {
    super(`${resource} ownership mismatch`)
    this.name = 'SyncOwnershipError'
  }
}

function safeParseNotePayload(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

const PULL_CAP = 2000

syncRoutes.get('/pull', async (c) => {
  const user = c.get('user') as AuthUser
  const rateLimit = consumeRateLimit(`sync:pull:${user.id}`, { limit: 60, windowMs: 60_000 })
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds))
    return c.json({ error: '同步过于频繁，请稍后再试' }, 429)
  }

  const sinceRaw = c.req.query('since')
  let sinceDate = new Date(0)
  if (sinceRaw) {
    const parsedSince = new Date(sinceRaw)
    if (Number.isNaN(parsedSince.getTime())) {
      return c.json({ error: 'since 参数必须是有效的 ISO 时间' }, 400)
    }
    sinceDate = parsedSince
  }

  const cursorDate = new Date()
  const updatedWindow = { gte: sinceDate, lt: cursorDate }
  const updatedAfter = { userId: user.id, updatedAt: updatedWindow }

  const [schedules, expenses, todos, habits, habitCheckins, quickNotes, diaries] = await Promise.all([
    prisma.schedule.findMany({ where: updatedAfter, orderBy: { updatedAt: 'asc' }, take: PULL_CAP }),
    prisma.expense.findMany({ where: updatedAfter, orderBy: { updatedAt: 'asc' }, take: PULL_CAP }),
    prisma.todo.findMany({ where: updatedAfter, orderBy: { updatedAt: 'asc' }, take: PULL_CAP }),
    prisma.habit.findMany({ where: updatedAfter, orderBy: { updatedAt: 'asc' }, take: PULL_CAP }),
    prisma.habitCheckin.findMany({
      where: { habit: { userId: user.id }, updatedAt: updatedWindow },
      orderBy: { updatedAt: 'asc' },
      take: PULL_CAP,
    }),
    prisma.quickNote.findMany({ where: updatedAfter, orderBy: { updatedAt: 'asc' }, take: PULL_CAP }),
    prisma.diary.findMany({ where: updatedAfter, orderBy: { updatedAt: 'asc' }, take: PULL_CAP }),
  ])

  const hasMore =
    schedules.length === PULL_CAP ||
    expenses.length === PULL_CAP ||
    todos.length === PULL_CAP ||
    habits.length === PULL_CAP ||
    habitCheckins.length === PULL_CAP ||
    quickNotes.length === PULL_CAP ||
    diaries.length === PULL_CAP

  return c.json({
    schedules,
    expenses,
    todos,
    habits,
    habitCheckins,
    quickNotes: quickNotes.map((n) => ({
      ...n,
      timestamp: Number(n.timestamp),
      parsed: safeParseNotePayload(n.parsed),
    })),
    diaries,
    hasMore,
    serverTime: cursorDate.toISOString(),
  })
})

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002',
  )
}

syncRoutes.post('/push', async (c) => {
  const user = c.get('user') as AuthUser
  const rateLimit = consumeRateLimit(`sync:push:${user.id}`, { limit: 30, windowMs: 60_000 })
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds))
    return c.json({ error: '同步过于频繁，请稍后再试' }, 429)
  }

  const body = await c.req.json()
  const parsed = syncPayloadSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400)
  }

  const results: Record<string, number> = {}

  try {
    await prisma.$transaction(async (tx) => {
      const data = parsed.data

      if (data.schedules?.length) {
        for (const item of data.schedules) {
          const existing = await tx.schedule.findUnique({ where: { id: item.id } })
          if (existing && existing.userId !== user.id) throw new SyncOwnershipError('schedule')

          if (existing) {
            const { id: _ignored, ...changes } = item
            await tx.schedule.update({ where: { id: item.id }, data: changes })
          } else {
            try {
              await tx.schedule.create({ data: { ...item, userId: user.id } })
            } catch (error) {
              if (!isUniqueConstraintError(error)) throw error
              const { id: _dropped, ...recovery } = item
              await tx.schedule.update({ where: { id: item.id }, data: recovery })
            }
          }
        }
        results.schedules = data.schedules.length
      }

      if (data.expenses?.length) {
        for (const item of data.expenses) {
          const existing = await tx.expense.findUnique({ where: { id: item.id } })
          if (existing && existing.userId !== user.id) throw new SyncOwnershipError('expense')

          if (existing) {
            const { id: _ignored, ...changes } = item
            await tx.expense.update({ where: { id: item.id }, data: changes })
          } else {
            try {
              await tx.expense.create({ data: { ...item, userId: user.id } })
            } catch (error) {
              if (!isUniqueConstraintError(error)) throw error
              const { id: _dropped, ...recovery } = item
              await tx.expense.update({ where: { id: item.id }, data: recovery })
            }
          }
        }
        results.expenses = data.expenses.length
      }

      if (data.todos?.length) {
        for (const item of data.todos) {
          const existing = await tx.todo.findUnique({ where: { id: item.id } })
          if (existing && existing.userId !== user.id) throw new SyncOwnershipError('todo')

          if (existing) {
            const { id: _ignored, ...changes } = item
            await tx.todo.update({ where: { id: item.id }, data: changes })
          } else {
            try {
              await tx.todo.create({ data: { ...item, userId: user.id } })
            } catch (error) {
              if (!isUniqueConstraintError(error)) throw error
              const { id: _dropped, ...recovery } = item
              await tx.todo.update({ where: { id: item.id }, data: recovery })
            }
          }
        }
        results.todos = data.todos.length
      }

      if (data.habits?.length) {
        for (const item of data.habits) {
          const existing = await tx.habit.findUnique({ where: { id: item.id } })
          if (existing && existing.userId !== user.id) throw new SyncOwnershipError('habit')

          if (existing) {
            const { id: _ignored, ...changes } = item
            await tx.habit.update({ where: { id: item.id }, data: changes })
          } else {
            try {
              await tx.habit.create({ data: { ...item, userId: user.id } })
            } catch (error) {
              if (!isUniqueConstraintError(error)) throw error
              const { id: _dropped, ...recovery } = item
              await tx.habit.update({ where: { id: item.id }, data: recovery })
            }
          }
        }
        results.habits = data.habits.length
      }

      if (data.quickNotes?.length) {
        for (const item of data.quickNotes) {
          const existing = await tx.quickNote.findUnique({ where: { id: item.id } })
          if (existing && existing.userId !== user.id) throw new SyncOwnershipError('quickNote')

          const noteData = {
            content: item.content,
            timestamp: BigInt(item.timestamp),
            parsed: JSON.stringify(item.parsed ?? {}),
            confirmed: item.confirmed,
          }

          if (existing) {
            await tx.quickNote.update({ where: { id: item.id }, data: noteData })
          } else {
            try {
              await tx.quickNote.create({ data: { id: item.id, userId: user.id, ...noteData } })
            } catch (error) {
              if (!isUniqueConstraintError(error)) throw error
              await tx.quickNote.update({ where: { id: item.id }, data: noteData })
            }
          }
        }
        results.quickNotes = data.quickNotes.length
      }

      if (data.diaries?.length) {
        for (const item of data.diaries) {
          const existingById = await tx.diary.findUnique({ where: { id: item.id } })
          if (existingById && existingById.userId !== user.id) throw new SyncOwnershipError('diary')

          const { id: _ignored, ...changes } = item
          try {
            if (existingById) {
              await tx.diary.update({ where: { id: item.id }, data: changes })
            } else {
              const clashByDate = await tx.diary.findUnique({
                where: { userId_date: { userId: user.id, date: item.date } },
              })
              if (clashByDate) {
                const { date: _dropped, ...mergeChanges } = changes
                await tx.diary.update({ where: { id: clashByDate.id }, data: mergeChanges })
              } else {
                await tx.diary.create({ data: { ...item, userId: user.id } })
              }
            }
          } catch (error) {
            if (!isUniqueConstraintError(error)) throw error
            const clashByDate = await tx.diary.findUnique({
              where: { userId_date: { userId: user.id, date: item.date } },
            })
            if (clashByDate) {
              const { date: _dropped, ...mergeChanges } = changes
              await tx.diary.update({ where: { id: clashByDate.id }, data: mergeChanges })
            }
          }
        }
        results.diaries = data.diaries.length
      }

      if (data.habitCheckins?.length) {
        const habitIds = [...new Set(data.habitCheckins.map((item) => item.habitId))]
        const ownedHabits = await tx.habit.findMany({
          where: { id: { in: habitIds }, userId: user.id },
          select: { id: true },
        })
        const ownedHabitIds = new Set(ownedHabits.map((h) => h.id))

        let appliedCheckins = 0
        for (const item of data.habitCheckins) {
          if (!ownedHabitIds.has(item.habitId)) continue
          const checkinData = {
            done: item.done,
            source: item.source,
            ...(item.aiReason !== undefined ? { aiReason: item.aiReason } : {}),
          }
          await tx.habitCheckin.upsert({
            where: { habitId_date: { habitId: item.habitId, date: item.date } },
            update: checkinData,
            create: {
              id: generateId(),
              habitId: item.habitId,
              date: item.date,
              ...checkinData,
            },
          })
          appliedCheckins += 1
        }
        results.habitCheckins = appliedCheckins
      }

      const deletions = data.deletions
      if (deletions) {
        if (deletions.scheduleIds?.length) {
          const removed = await tx.schedule.deleteMany({ where: { id: { in: deletions.scheduleIds }, userId: user.id } })
          results.deletedSchedules = removed.count
        }
        if (deletions.expenseIds?.length) {
          const removed = await tx.expense.deleteMany({ where: { id: { in: deletions.expenseIds }, userId: user.id } })
          results.deletedExpenses = removed.count
        }
        if (deletions.todoIds?.length) {
          const removed = await tx.todo.deleteMany({ where: { id: { in: deletions.todoIds }, userId: user.id } })
          results.deletedTodos = removed.count
        }
        if (deletions.quickNoteIds?.length) {
          const removed = await tx.quickNote.deleteMany({ where: { id: { in: deletions.quickNoteIds }, userId: user.id } })
          results.deletedQuickNotes = removed.count
        }
        if (deletions.diaryIds?.length) {
          const removed = await tx.diary.deleteMany({ where: { id: { in: deletions.diaryIds }, userId: user.id } })
          results.deletedDiaries = removed.count
        }
        if (deletions.habitIds?.length) {
          const ownedHabits = await tx.habit.findMany({
            where: { id: { in: deletions.habitIds }, userId: user.id },
            select: { id: true },
          })
          const ownedIds = ownedHabits.map((h) => h.id)
          if (ownedIds.length > 0) {
            await tx.habitCheckin.deleteMany({ where: { habitId: { in: ownedIds } } })
            const removed = await tx.habit.deleteMany({ where: { id: { in: ownedIds } } })
            results.deletedHabits = removed.count
          }
        }
      }
    })
  } catch (error) {
    if (error instanceof SyncOwnershipError) {
      return c.json({ error: '同步数据存在所有权冲突，已拒绝写入' }, 403)
    }

    throw error
  }

  return c.json({ synced: results, timestamp: new Date().toISOString() })
})
