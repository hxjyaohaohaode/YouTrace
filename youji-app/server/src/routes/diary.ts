import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'

export const diaryRoutes = new Hono()

const diarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string().trim().min(1).max(10000),
  mood: z.string().trim().max(30).nullable().optional(),
  moodScore: z.number().int().min(1).max(10).nullable().optional(),
  source: z.string().trim().max(30).default('manual'),
  aiInsight: z.string().trim().max(2000).optional(),
}).strict()

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002',
  )
}

diaryRoutes.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const month = c.req.query('month')

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: '月份格式不正确' }, 400)
  }

  const diaries = await prisma.diary.findMany({
    where: {
      userId: user.id,
      ...(month ? { date: { startsWith: month } } : {}),
    },
    orderBy: [{ date: 'desc' }],
  })

  return c.json({ diaries })
})

diaryRoutes.get('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const diary = await prisma.diary.findFirst({ where: { id, userId: user.id } })
  if (!diary) return c.json({ error: '日记不存在' }, 404)

  return c.json({ diary })
})

diaryRoutes.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const parsed = diarySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const diary = await prisma.diary.create({
      data: {
        id: generateId(),
        userId: user.id,
        ...parsed.data,
      },
    })
    return c.json({ diary }, 201)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: '该日期已存在日记，请直接编辑' }, 409)
    }
    throw error
  }
})

diaryRoutes.put('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = diarySchema.partial().safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const existing = await prisma.diary.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '日记不存在' }, 404)

  try {
    const diary = await prisma.diary.update({
      where: { id },
      data: parsed.data,
    })
    return c.json({ diary })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: '该日期已存在另一篇日记，无法合并' }, 409)
    }
    throw error
  }
})

diaryRoutes.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const existing = await prisma.diary.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '日记不存在' }, 404)

  await prisma.diary.delete({ where: { id } })
  return c.json({ success: true })
})
