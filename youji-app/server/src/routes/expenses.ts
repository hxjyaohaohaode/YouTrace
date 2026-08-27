import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'
import { getToday, getWeekStart } from '../utils/date.js'

export const expenseRoutes = new Hono()

const expenseSchema = z.object({
  amount: z.number().int().positive().max(100_000_000_00),
  category: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().trim().max(30).default('manual'),
  relatedMood: z.string().trim().max(30).optional(),
  isIncome: z.boolean().optional().default(false),
  note: z.string().trim().max(200).optional(),
}).strict()

expenseRoutes.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const month = c.req.query('month')

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: '月份格式不正确' }, 400)
  }

  const expenses = await prisma.expense.findMany({
    where: {
      userId: user.id,
      ...(month ? { date: { startsWith: month } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  })

  return c.json({ expenses })
})

expenseRoutes.get('/stats', async (c) => {
  const user = c.get('user') as AuthUser
  const month = c.req.query('month') || getToday().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: '月份格式不正确' }, 400)
  }
  const today = getToday()
  const weekStartStr = getWeekStart()

  const [monthExpenses, weekExpenses, incomeTotalRow] = await Promise.all([
    prisma.expense.findMany({
      where: { userId: user.id, date: { startsWith: month }, isIncome: false },
      select: { amount: true, date: true },
    }),
    prisma.expense.findMany({
      where: { userId: user.id, date: { gte: weekStartStr, lte: today }, isIncome: false },
      select: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { userId: user.id, date: { startsWith: month }, isIncome: true },
      _sum: { amount: true },
    }),
  ])

  const todayTotal = monthExpenses
    .filter((e) => e.date === today)
    .reduce((sum, e) => sum + e.amount, 0)
  const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0)
  const weekTotal = weekExpenses.reduce((sum, e) => sum + e.amount, 0)

  return c.json({
    today: todayTotal,
    week: weekTotal,
    month: monthTotal,
    count: monthExpenses.length,
    income: incomeTotalRow._sum.amount ?? 0,
  })
})

expenseRoutes.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const parsed = expenseSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const expense = await prisma.expense.create({
    data: {
      id: generateId(),
      userId: user.id,
      ...parsed.data,
    },
  })

  return c.json({ expense }, 201)
})

expenseRoutes.post('/batch', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const items = z.array(expenseSchema).min(1).max(200).safeParse(body.items)
  if (!items.success) {
    return c.json({ error: items.error.flatten() }, 400)
  }

  const created = await prisma.$transaction(
    items.data.map((item) =>
      prisma.expense.create({
        data: { id: generateId(), userId: user.id, ...item },
      })
    )
  )

  return c.json({ expenses: created }, 201)
})

expenseRoutes.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const existing = await prisma.expense.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '记录不存在' }, 404)

  await prisma.expense.delete({ where: { id } })
  return c.json({ success: true })
})
