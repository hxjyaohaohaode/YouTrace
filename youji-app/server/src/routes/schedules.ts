import { decodeScheduleExceptions } from '../services/scheduleExceptions.js'
import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'
import { addDays, getWeekStart } from '../utils/date.js'

export const scheduleRoutes = new Hono()

const scheduleSchema = z.object({
  title: z.string().trim().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  type: z.enum(['class', 'study', 'work', 'social', 'other']).default('other'),
  location: z.string().trim().max(100).default(''),
  repeat: z.enum(['none', 'weekly']).default('none'),
  remind: z.number().int().min(0).max(1440).default(0),
}).strict()

scheduleRoutes.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const date = c.req.query('date')
  const view = c.req.query('view')
  let dateFilter: string | { gte: string; lte: string } | undefined

  if (date) {
    dateFilter = date
  } else if (view === 'week') {
    const start = getWeekStart()
    dateFilter = {
      gte: start,
      lte: addDays(start, 6),
    }
  }

  const schedules = await prisma.schedule.findMany({
    where: {
      userId: user.id,
      ...(dateFilter ? { date: dateFilter } : {}),
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  })

  return c.json({ schedules: schedules.map(row => ({ ...row, exceptions: decodeScheduleExceptions(row.exceptions) })) })
})

scheduleRoutes.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const parsed = scheduleSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const schedule = await prisma.schedule.create({
    data: {
      id: generateId(),
      userId: user.id,
      ...parsed.data,
    },
  })

  return c.json({ schedule }, 201)
})

scheduleRoutes.put('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = scheduleSchema.partial().safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const existing = await prisma.schedule.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '日程不存在' }, 404)
  if (existing.exceptions !== '[]') return c.json({ error: '这组日程有单次调整，请使用最新有迹页面核对后操作', code: 'SCHEDULE_CLIENT_UPGRADE_REQUIRED' }, 409)

  // The protection is in the write predicate, not just the prior read. A new
  // client can add exceptions between these awaits. Never detach those edits.
  const result = await prisma.schedule.updateMany({
    where: { id, userId: user.id, exceptions: '[]', updatedAt: existing.updatedAt },
    data: parsed.data,
  })
  if (result.count !== 1) return c.json({ error: '日程刚刚更新，请刷新核对后重试', code: 'SCHEDULE_VERSION_CONFLICT' }, 409)
  const schedule = await prisma.schedule.findFirst({ where: { id, userId: user.id } })
  return c.json({ schedule })
})

scheduleRoutes.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const existing = await prisma.schedule.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '日程不存在' }, 404)
  if (existing.exceptions !== '[]') return c.json({ error: '这组日程有单次调整，请使用最新有迹页面核对后操作', code: 'SCHEDULE_CLIENT_UPGRADE_REQUIRED' }, 409)

  const result = await prisma.schedule.deleteMany({ where: { id, userId: user.id, exceptions: '[]', updatedAt: existing.updatedAt } })
  if (result.count !== 1) return c.json({ error: '日程刚刚更新，请刷新核对后重试', code: 'SCHEDULE_VERSION_CONFLICT' }, 409)
  return c.json({ success: true })
})
