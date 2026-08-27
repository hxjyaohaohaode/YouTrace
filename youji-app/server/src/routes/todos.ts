import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'

export const todoRoutes = new Hono()

const todoSchema = z.object({
  text: z.string().trim().min(1).max(200),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
}).strict()

todoRoutes.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const todos = await prisma.todo.findMany({
    where: { userId: user.id },
    orderBy: [{ done: 'asc' }, { createdAt: 'desc' }],
  })
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
  todos.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
      || b.createdAt.getTime() - a.createdAt.getTime()
  })
  return c.json({ todos })
})

todoRoutes.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const parsed = todoSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const todo = await prisma.todo.create({
    data: {
      id: generateId(),
      userId: user.id,
      ...parsed.data,
    },
  })

  return c.json({ todo }, 201)
})

todoRoutes.patch('/:id/toggle', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const changed = await prisma.$executeRaw`
    UPDATE "Todo" SET "done" = NOT "done", "updatedAt" = ${new Date()}
    WHERE "id" = ${id} AND "userId" = ${user.id}
  `

  if (!changed) return c.json({ error: '待办不存在' }, 404)

  const todo = await prisma.todo.findUnique({ where: { id } })
  if (!todo) return c.json({ error: '待办不存在' }, 404)

  return c.json({ todo })
})

todoRoutes.put('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = todoSchema.partial().safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const existing = await prisma.todo.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '待办不存在' }, 404)

  const todo = await prisma.todo.update({
    where: { id },
    data: parsed.data,
  })

  return c.json({ todo })
})

todoRoutes.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const existing = await prisma.todo.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '待办不存在' }, 404)

  await prisma.todo.delete({ where: { id } })
  return c.json({ success: true })
})
