import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'
import { computeHabitStats } from '../services/habitStats.js'
import { getToday } from '../utils/date.js'

export const habitRoutes = new Hono()

const habitSchema = z.object({
  name: z.string().trim().min(1).max(100),
  icon: z.string().min(1).max(16).default('✨'),
  frequency: z.enum(['daily', 'weekly']).default('daily'),
  sortOrder: z.number().int().min(0).max(10000).default(0),
}).strict()

const checkinSchema = z.object({
  done: z.boolean().default(true),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict()

habitRoutes.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const habits = await prisma.habit.findMany({
    where: { userId: user.id },
    orderBy: { sortOrder: 'asc' },
  })

  const stats = await computeHabitStats(user.id, habits.map((h) => h.id))

  return c.json({
    habits: habits.map((h) => {
      const stat = stats.get(h.id)
      return {
        id: h.id,
        name: h.name,
        icon: h.icon,
        frequency: h.frequency,
        sortOrder: h.sortOrder,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
        done: stat?.done ?? false,
        streak: stat?.streak ?? 0,
        recentCheckins: stat?.recentCheckins ?? [],
      }
    }),
  })
})

habitRoutes.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const parsed = habitSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const habit = await prisma.habit.create({
    data: {
      id: generateId(),
      userId: user.id,
      ...parsed.data,
    },
  })

  return c.json({ habit }, 201)
})

habitRoutes.patch('/:id/check', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  const parsed = checkinSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  const { done, date } = parsed.data

  const existing = await prisma.habit.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '习惯不存在' }, 404)

  const checkDate = date || getToday()

  const checkin = await prisma.habitCheckin.upsert({
    where: { habitId_date: { habitId: id, date: checkDate } },
    update: { done },
    create: {
      id: generateId(),
      habitId: id,
      date: checkDate,
      done,
      source: 'manual',
      confirmed: true,
    },
  })

  return c.json({ checkin })
})

habitRoutes.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const existing = await prisma.habit.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '习惯不存在' }, 404)

  await prisma.$transaction([
    prisma.habitCheckin.deleteMany({ where: { habitId: id } }),
    prisma.habit.delete({ where: { id } }),
  ])
  return c.json({ success: true })
})
