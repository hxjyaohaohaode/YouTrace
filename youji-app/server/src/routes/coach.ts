import { scheduleOccurrences } from '../services/scheduleExceptions.js'
import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'
import { consumeRateLimit } from '../utils/rateLimit.js'
import {
  daysBetween,
  getBusinessClock,
  getToday,
  getYesterday,
  getWeekStart,
  getMonthStart,
  formatBusinessDate,
} from '../utils/date.js'

export const coachRoutes = new Hono()

const insightActionSchema = z.object({
  action: z.unknown().optional(),
}).strict()

const insightQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.string().trim().max(30).optional(),
})

const pushUpdateSchema = z.object({
  read: z.boolean().optional(),
  acted: z.boolean().optional(),
}).strict().refine(
  (data) => data.read !== undefined || data.acted !== undefined,
  { message: '至少提供一个更新字段' },
)

coachRoutes.get('/brief', async (c) => {
  const generatedAt = new Date().toISOString()
  const user = c.get('user') as AuthUser
  const today = getToday()
  const yesterday = getYesterday()
  const weekStart = getWeekStart()
  const now = getBusinessClock()
  const hour = now.hour
  const greeting =
    hour < 6 ? '夜深了'
    : hour < 9 ? '早上好'
    : hour < 12 ? '上午好'
    : hour < 14 ? '中午好'
    : hour < 18 ? '下午好'
    : hour < 22 ? '晚上好'
    : '夜深了'
  const date = `${now.month}月${now.day}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.weekday]}`

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })

  const [yesterdayExpenses, priorWindowExpenses] = await Promise.all([
    prisma.expense.findMany({ where: { userId: user.id, date: yesterday, isIncome: false, category: { not: 'income' } } }),
    prisma.expense.findMany({
      where: { userId: user.id, date: { gte: weekStart, lt: yesterday }, isIncome: false, category: { not: 'income' } },
    }),
  ])
  const yesterdayTotal = yesterdayExpenses.reduce((sum, e) => sum + e.amount, 0)
  const priorDays = Math.max(daysBetween(weekStart, yesterday), 1)
  const priorTotal = priorWindowExpenses.reduce((sum, e) => sum + e.amount, 0)
  const avgDailySpend = priorTotal / priorDays
  const spendDiff =
    avgDailySpend > 0
      ? `${Math.round(((yesterdayTotal - avgDailySpend) / avgDailySpend) * 100)}%`
      : null

  const yesterdayHabits = await prisma.habit.findMany({
    where: { userId: user.id },
    include: {
      habitCheckins: { where: { date: yesterday } },
    },
  })
  const doneHabits = yesterdayHabits.filter((h) => h.habitCheckins.some((item) => item.done)).length

  const [yesterdayDiary, schedules, recentInsights] = await Promise.all([
    prisma.diary.findFirst({
      where: { userId: user.id, date: yesterday },
      select: { moodScore: true },
    }),
    prisma.schedule.findMany({
      where: { userId: user.id, OR: [{ date: today }, { repeat: 'weekly' }] },
      orderBy: { startTime: 'asc' },
    }),
    prisma.insight.findMany({
      where: { userId: user.id, dismissed: false },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
  ])

  return c.json({
    brief: {
      nickname: dbUser?.nickname || '你',
      greeting,
      date,
      generatedAt,
      reviewDate: yesterday,
      yesterdayReview: {
        spent: yesterdayTotal / 100,
        expenseCount: yesterdayExpenses.length,
        spentDiff: spendDiff,
        habits: { done: doneHabits, total: yesterdayHabits.length },
        moodScore: yesterdayDiary?.moodScore ?? null,
      },
      weeklyInsights: recentInsights.map((item) => {
        let sources: unknown;
        try {
          const parsed: unknown = JSON.parse(item.dataSources);
          sources = Array.isArray(parsed) ? parsed : [];
        } catch {
          sources = [];
        }
        return {
          id: item.id,
          type: item.type,
          title: datedInsightTitle(item),
          description: item.description,
          createdAt: item.createdAt.toISOString(),
          actionSuggested: item.actionSuggested,
          dataSources: Array.isArray(sources) ? (sources as string[]) : [],
        };
      }),
      todayActions: recentInsights
        .map((item) => item.actionSuggested)
        .filter((item): item is string => Boolean(item))
        .slice(0, 3),
      todaySchedule: scheduleOccurrences(schedules, today, today).map((item) => ({
        id: item.id,
        time: `${item.startTime}-${item.endTime}`,
        title: item.title,
        location: item.location,
        type: item.type,
      })),
    },
  })
})

coachRoutes.get('/insights', async (c) => {
  const user = c.get('user') as AuthUser
  const parsedQuery = insightQuerySchema.safeParse({
    limit: c.req.query('limit'),
    type: c.req.query('type'),
  })
  if (!parsedQuery.success) return c.json({ error: '查询参数不正确' }, 400)
  const { limit, type } = parsedQuery.data

  const insights = await prisma.insight.findMany({
    where: {
      userId: user.id,
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      dataSources: true,
      actionSuggested: true,
      actionTaken: true,
      actionResult: true,
      dismissed: true,
      createdAt: true,
    },
  })

  return c.json({ insights: insights.map(serializeInsight) })
})

function datedInsightTitle(insight: { title: string; createdAt: Date }): string {
  // Old rule snapshots used a relative title even when read months later.
  return insight.title === '今日教练简报'
    ? `记录简报 · ${formatBusinessDate(insight.createdAt)}`
    : insight.title
}

function serializeInsight(insight: {
  id: string
  type: string
  title: string
  description: string
  dataSources: string
  actionSuggested: string | null
  actionTaken: boolean
  actionResult: string | null
  dismissed: boolean
  createdAt: Date
}) {
  let dataSources: unknown;
  try {
    const parsed: unknown = JSON.parse(insight.dataSources);
    dataSources = Array.isArray(parsed) ? parsed : [];
  } catch {
    dataSources = [];
  }
  return {
    id: insight.id,
    type: insight.type,
    title: datedInsightTitle(insight),
    description: insight.description,
    dataSources: Array.isArray(dataSources) ? dataSources : [],
    actionSuggested: insight.actionSuggested ?? undefined,
    actionTaken: insight.actionTaken,
    actionResult: insight.actionResult ?? undefined,
    dismissed: insight.dismissed,
    createdAt: insight.createdAt.toISOString(),
  }
}

coachRoutes.post('/insights/:id/dismiss', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const existing = await prisma.insight.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '洞察不存在' }, 404)

  await prisma.insight.update({
    where: { id },
    data: { dismissed: true },
  })

  return c.json({ success: true })
})

coachRoutes.post('/insights/:id/act', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = insightActionSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const existing = await prisma.insight.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '洞察不存在' }, 404)

  await prisma.insight.update({
    where: { id },
    data: {
      actionTaken: true,
      actionResult: JSON.stringify(parsed.data.action ?? null),
    },
  })

  return c.json({ success: true })
})

coachRoutes.get('/pushes', async (c) => {
  const user = c.get('user') as AuthUser
  const unread = c.req.query('unread') === 'true'

  const pushes = await prisma.push.findMany({
    where: {
      userId: user.id,
      ...(unread ? { read: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return c.json({ pushes: pushes.map(serializePush) })
})

coachRoutes.patch('/pushes/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = pushUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const updated = await prisma.push.updateMany({
    where: { id, userId: user.id },
    data: parsed.data,
  })

  if (updated.count === 0) {
    return c.json({ error: '推送不存在' }, 404)
  }

  return c.json({ success: true })
})

function serializePush(push: {
  id: string
  type: string
  title: string
  body: string
  actions: string | null
  read: boolean
  acted: boolean
  createdAt: Date
}) {
  let actions: unknown = null
  if (push.actions) {
    try {
      actions = JSON.parse(push.actions)
    } catch {
      actions = null
    }
  }
  return {
    id: push.id,
    type: push.type,
    title: push.title,
    body: push.body,
    actions,
    read: push.read,
    acted: push.acted,
    createdAt: push.createdAt.toISOString(),
  }
}

coachRoutes.post('/generate-brief', async (c) => {
  const user = c.get('user') as AuthUser

  const rateLimit = consumeRateLimit(`coach:generate:${user.id}`, {
    limit: 5,
    windowMs: 60 * 1000,
  })
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds))
    return c.json({ error: '简报生成过于频繁，请稍后再试' }, 429)
  }

  const today = getToday()
  const monthStart = getMonthStart()
  const generatedAt = new Date()

  const [todayExpenses, monthExpenses, habits] = await Promise.all([
    prisma.expense.findMany({
      where: { userId: user.id, date: today, isIncome: false, category: { not: 'income' } },
      select: { amount: true },
    }),
    prisma.expense.findMany({
      where: { userId: user.id, date: { gte: monthStart, lte: today }, isIncome: false, category: { not: 'income' } },
      select: { amount: true },
    }),
    prisma.habit.findMany({
      where: { userId: user.id },
      include: { habitCheckins: { where: { date: today } } },
    }),
  ])

  const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0)
  const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0)
  const doneCount = habits.filter((h) =>
    h.habitCheckins.some((checkin) => checkin.done)
  ).length

  const insight = await prisma.insight.create({
    data: {
      id: generateId(),
      userId: user.id,
      type: 'suggestion',
      title: `记录简报 · ${today}`,
      description: `${today} 已记录支出 ¥${(todayTotal / 100).toFixed(2)}，${monthStart} 至 ${today} 累计支出 ¥${(monthTotal / 100).toFixed(2)}；当日习惯打卡 ${doneCount}/${habits.length}。基于生成时已同步的记录。`,
      dataSources: JSON.stringify(['expense', 'habit']),
      createdAt: generatedAt,
    },
  })

  return c.json({ insight: serializeInsight(insight) })
})

coachRoutes.delete('/pushes/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const removed = await prisma.push.deleteMany({
    where: { id, userId: user.id },
  })

  if (removed.count === 0) {
    return c.json({ error: '推送不存在' }, 404)
  }

  return c.json({ success: true })
})
