import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import type { AuthUser } from '../middleware/auth.js'
import { clearSession } from '../utils/session.js'

export const userRoutes = new Hono()

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm')

const settingsSchema = z.object({
  coachStyle: z.enum(['gentle', 'strict', 'data']).optional(),
  quietStart: timeSchema.optional(),
  quietEnd: timeSchema.optional(),
  pushLimit: z.number().int().min(0).max(10).optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: '至少提供一个设置项' },
)

function publicSettings(user: {
  coachStyle: string
  quietStart: string
  quietEnd: string
  pushLimit: number
}) {
  return {
    coachStyle: user.coachStyle,
    quietStart: user.quietStart,
    quietEnd: user.quietEnd,
    pushLimit: user.pushLimit,
  }
}

userRoutes.get('/settings', async (c) => {
  const user = c.get('user') as AuthUser
  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { coachStyle: true, quietStart: true, quietEnd: true, pushLimit: true },
  })
  if (!record) return c.json({ error: '用户不存在' }, 404)
  return c.json({ settings: publicSettings(record) })
})

userRoutes.patch('/settings', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: parsed.data,
      select: { coachStyle: true, quietStart: true, quietEnd: true, pushLimit: true },
    })
    return c.json({ settings: publicSettings(updated) })
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2025'
    ) {
      return c.json({ error: '用户不存在' }, 404)
    }
    throw error
  }
})

userRoutes.delete('/', async (c) => {
  const user = c.get('user') as AuthUser

  await prisma.$transaction(async (tx) => {
    await tx.chatMessage.deleteMany({
      where: { session: { userId: user.id } },
    })
    await tx.chatSession.deleteMany({ where: { userId: user.id } })
    await tx.push.deleteMany({ where: { userId: user.id } })
    await tx.insight.deleteMany({ where: { userId: user.id } })
    await tx.diary.deleteMany({ where: { userId: user.id } })
    await tx.quickNote.deleteMany({ where: { userId: user.id } })
    await tx.expense.deleteMany({ where: { userId: user.id } })
    await tx.todo.deleteMany({ where: { userId: user.id } })
    await tx.schedule.deleteMany({ where: { userId: user.id } })
    await tx.habitCheckin.deleteMany({ where: { habit: { userId: user.id } } })
    await tx.habit.deleteMany({ where: { userId: user.id } })
    await tx.registrationTicket.deleteMany({ where: { phone: user.phone } })
    await tx.authChallenge.deleteMany({ where: { phone: user.phone } })
    await tx.user.delete({ where: { id: user.id } })
  })

  clearSession(c)
  return c.json({ success: true })
})
