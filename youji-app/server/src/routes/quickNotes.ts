import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'
import { getBusinessDayStart } from '../utils/date.js'
import { parseQuickNote } from '../services/parser.js'

export const quickNoteRoutes = new Hono()

const quickNoteSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  timestamp: z.number().int().safe().nonnegative(),
}).strict()

const quickNoteConfirmSchema = z.object({
  corrections: z.record(z.unknown()).optional(),
  confirmed: z.boolean().optional(),
}).strict()

quickNoteRoutes.get('/', async (c) => {
  const user = c.get('user') as AuthUser
  const date = c.req.query('date')
  let timestampFilter:
    | {
        gte: number
        lt: number
      }
    | undefined
  if (date) {
    let start: Date
    try {
      start = getBusinessDayStart(date)
    } catch {
      return c.json({ error: '日期格式不正确' }, 400)
    }
    const end = new Date(start.getTime() + 86_400_000)
    timestampFilter = {
      gte: start.getTime(),
      lt: end.getTime(),
    }
  }

  const notes = await prisma.quickNote.findMany({
    where: {
      userId: user.id,
      ...(timestampFilter ? { timestamp: timestampFilter } : {}),
    },
    orderBy: { timestamp: 'desc' },
  })

  const result = notes.map((n) => ({
    ...n,
    timestamp: Number(n.timestamp),
    parsed: (() => { try { return JSON.parse(n.parsed) } catch { return {} } })(),
  }))

  return c.json({ notes: result })
})

quickNoteRoutes.post('/', async (c) => {
  const user = c.get('user') as AuthUser
  const body = await c.req.json()
  const parsed = quickNoteSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const aiParsed = parseQuickNote(parsed.data.content)

  const note = await prisma.quickNote.create({
    data: {
      id: generateId(),
      userId: user.id,
      content: parsed.data.content,
      timestamp: BigInt(parsed.data.timestamp),
      parsed: JSON.stringify(aiParsed),
      confirmed: false,
    },
  })

  return c.json({
    note: {
      ...note,
      timestamp: Number(note.timestamp),
      parsed: aiParsed,
    },
  }, 201)
})

quickNoteRoutes.put('/:id/confirm', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsedBody = quickNoteConfirmSchema.safeParse(body)

  if (!parsedBody.success) {
    return c.json({ error: parsedBody.error.flatten().fieldErrors }, 400)
  }

  const existing = await prisma.quickNote.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '速记不存在' }, 404)

  let parsedData = (() => { try { return JSON.parse(existing.parsed) } catch { return {} } })()
  if (parsedBody.data.corrections) {
    parsedData = { ...parsedData, ...parsedBody.data.corrections }
  }

  const note = await prisma.quickNote.update({
    where: { id },
    data: {
      parsed: JSON.stringify(parsedData),
      confirmed: parsedBody.data.confirmed ?? true,
    },
  })

  return c.json({
    note: {
      ...note,
      timestamp: Number(note.timestamp),
      parsed: parsedData,
    },
  })
})

quickNoteRoutes.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser
  const id = c.req.param('id')

  const existing = await prisma.quickNote.findFirst({ where: { id, userId: user.id } })
  if (!existing) return c.json({ error: '速记不存在' }, 404)

  await prisma.quickNote.delete({ where: { id } })
  return c.json({ success: true })
})
