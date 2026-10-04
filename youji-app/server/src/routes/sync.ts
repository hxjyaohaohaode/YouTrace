import { Hono } from 'hono'
import { assertWritable, decodeChangePayload, latestVersion, mutationHash, recordAbsentDeletion, SyncRejection, type SyncEntity, type SyncTransaction } from '../services/syncProtocol.js'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import type { AuthUser } from '../middleware/auth.js'
import { consumeRateLimit } from '../utils/rateLimit.js'

export const syncRoutes = new Hono()

const baseVersionSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine((value) => /^[0-9]+$/.test(value) && BigInt(value) <= 9223372036854775807n, '版本超出范围').optional()
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const scheduleSyncSchema = z.object({
  baseVersion: baseVersionSchema,
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
  baseVersion: baseVersionSchema,
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
  baseVersion: baseVersionSchema,
  id: z.string().min(8).max(64),
  text: z.string().trim().min(1).max(200),
  dueDate: isoDateSchema.optional(),
  priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  done: z.boolean().optional().default(false),
})

const habitSyncSchema = z.object({
  baseVersion: baseVersionSchema,
  id: z.string().min(8).max(64),
  name: z.string().trim().min(1).max(100),
  icon: z.string().min(1).max(16),
  frequency: z.enum(['daily', 'weekly']).optional().default('daily'),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
})

const quickNoteSyncSchema = z.object({
  baseVersion: baseVersionSchema,
  id: z.string().min(8).max(64),
  content: z.string().trim().min(1).max(5000),
  timestamp: z.union([z.number(), z.string(), z.bigint()])
    .transform((value) => Number(value))
    .pipe(z.number().int().safe().nonnegative()),
  parsed: z.unknown().optional().default({}),
  confirmed: z.boolean().optional().default(false),
})

const diarySyncSchema = z.object({
  baseVersion: baseVersionSchema,
  id: z.string().min(8).max(64),
  date: isoDateSchema,
  content: z.string().trim().min(1).max(10000),
  mood: z.string().trim().max(30).optional(),
  moodScore: z.number().int().min(1).max(10).optional(),
  source: z.string().trim().max(30).optional().default('manual'),
  aiInsight: z.string().trim().max(2000).optional(),
})

const checkinSyncSchema = z.object({
  baseVersion: baseVersionSchema,
  confirmed: z.boolean().optional().default(true),
  habitId: z.string().min(8).max(64),
  date: isoDateSchema,
  done: z.boolean().optional().default(true),
  source: z.enum(['manual', 'ai', 'schedule']).optional().default('manual'),
  aiReason: z.string().trim().max(500).optional(),
})

const deletionSchema = z.object({ id: z.string().min(8).max(100), baseVersion: baseVersionSchema }).strict()
const deletionsSchema = z.object({
  scheduleIds: z.array(deletionSchema).max(2000).optional(),
  expenseIds: z.array(deletionSchema).max(2000).optional(),
  todoIds: z.array(deletionSchema).max(2000).optional(),
  habitIds: z.array(deletionSchema).max(2000).optional(),
  quickNoteIds: z.array(deletionSchema).max(2000).optional(),
  diaryIds: z.array(deletionSchema).max(2000).optional(),
  habitCheckinIds: z.array(deletionSchema).max(2000).optional(),
}).strict()

const syncPayloadSchema = z.object({
  protocol: z.literal(2),
  mutationId: z.string().min(8).max(128),
  schedules: z.array(scheduleSyncSchema).max(500).optional(),
  expenses: z.array(expenseSyncSchema).max(1000).optional(),
  todos: z.array(todoSyncSchema).max(1000).optional(),
  habits: z.array(habitSyncSchema).max(200).optional(),
  quickNotes: z.array(quickNoteSyncSchema).max(500).optional(),
  diaries: z.array(diarySyncSchema).max(366).optional(),
  habitCheckins: z.array(checkinSyncSchema).max(1000).optional(),
  deletions: deletionsSchema.optional(),
}).strict()


const pullQuerySchema = z.object({
  protocol: z.literal('2'),
  cursor: z.string().regex(/^(0|[1-9][0-9]{0,18})$/).default('0').refine((value) => /^[0-9]+$/.test(value) && BigInt(value) <= 9223372036854775807n),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
})

async function requireSyncInfrastructure() {
  // `prisma db push` does not install triggers. Fail closed rather than ACK a lost write.
  const triggers = await prisma.$queryRaw<Array<{ name: string }>>`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync_%'`
  const tables = ['Schedule', 'Expense', 'Todo', 'Habit', 'QuickNote', 'Diary', 'HabitCheckin']
  const found = new Set(triggers.map((trigger) => trigger.name))
  return tables.every((table) => ['insert', 'update', 'delete', 'no_resurrection', 'identity_immutable'].every((suffix) => found.has(`sync_${table}_${suffix}`)))
}

syncRoutes.get('/pull', async (c) => {
  if (c.req.query('protocol') !== '2') return c.json({ error: '请升级客户端后再同步，保留本地修改', code: 'SYNC_UPGRADE_REQUIRED', protocol: 2 }, 426)
  const query = pullQuerySchema.safeParse(c.req.query())
  if (!query.success) return c.json({ error: query.error.flatten(), code: 'INVALID_SYNC_CURSOR' }, 400)
  const user = c.get('user') as AuthUser
  const rateLimit = consumeRateLimit(`sync:pull:${user.id}`, { limit: 120, windowMs: 60_000 })
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds))
    return c.json({ error: '同步过于频繁，请稍后再试' }, 429)
  }
  if (!await requireSyncInfrastructure()) return c.json({ error: '同步数据库尚未完成迁移，已暂停同步', code: 'SYNC_MIGRATION_REQUIRED' }, 503)

  const { cursor, limit } = query.data
  const rows = await prisma.$queryRaw<Array<{ seq: string; entity: string; entityId: string; operation: string; payload: string | null }>>`
    SELECT CAST("seq" AS TEXT) AS "seq", "entity", "entityId", "operation", "payload"
    FROM "SyncChange" WHERE "userId" = ${user.id} AND "seq" > CAST(${cursor} AS INTEGER)
    ORDER BY "SyncChange"."seq" ASC LIMIT ${limit + 1}`
  const page = rows.slice(0, limit)
  return c.json({
    protocol: 2,
    events: page.map((row) => ({ seq: row.seq.toString(), entity: row.entity, entityId: row.entityId, operation: row.operation, data: decodeChangePayload(row.entity, row.payload) })),
    nextCursor: page.at(-1)?.seq.toString() ?? cursor,
    hasMore: rows.length > limit,
  })
})

type WriteAction = {
  entity: SyncEntity; id: string; baseVersion?: string
  read: () => Promise<{ userId: string } | null>
  create: () => Promise<unknown>
  update: () => Promise<unknown>
}

async function applyWrite(tx: SyncTransaction, userId: string, action: WriteAction) {
  const existing = await action.read()
  await assertWritable(tx, userId, action.entity, action.id, existing, action.baseVersion)
  if (existing) await action.update()
  else await action.create()
}

type DeleteAction = {
  entity: SyncEntity; id: string; baseVersion?: string
  read: () => Promise<{ userId: string } | null>
  remove: () => Promise<unknown>
}
async function applyDeletion(tx: SyncTransaction, userId: string, action: DeleteAction) {
  const existing = await action.read()
  if (!existing) return recordAbsentDeletion(tx, userId, action.entity, action.id, action.baseVersion)
  await assertWritable(tx, userId, action.entity, action.id, existing, action.baseVersion)
  await action.remove()
}

syncRoutes.post('/push', async (c) => {
  const body: unknown = await c.req.json()
  if (!body || typeof body !== 'object' || !('protocol' in body) || body.protocol !== 2) {
    // Old clients discard repeated 4xx failures. A retryable status preserves their outbox.
    c.header('Retry-After', '60')
    return c.json({ error: '请升级客户端后再同步，保留本地修改', code: 'SYNC_UPGRADE_REQUIRED', protocol: 2 }, 503)
  }
  const parsed = syncPayloadSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten(), code: 'INVALID_SYNC_MUTATION' }, 400)
  const user = c.get('user') as AuthUser
  const rateLimit = consumeRateLimit(`sync:push:${user.id}`, { limit: 60, windowMs: 60_000 })
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds))
    return c.json({ error: '同步过于频繁，请稍后再试' }, 429)
  }
  if (!await requireSyncInfrastructure()) return c.json({ error: '同步数据库尚未完成迁移，已暂停同步', code: 'SYNC_MIGRATION_REQUIRED' }, 503)

  const data = parsed.data
  const requestHash = mutationHash(data)
  try {
    const response = await prisma.$transaction(async (tx) => {
      const receiptKey = { userId_mutationId: { userId: user.id, mutationId: data.mutationId } }
      const receipt = await tx.syncReceipt.findUnique({ where: receiptKey })
      if (receipt) {
        if (receipt.requestHash !== requestHash) throw new SyncRejection('MUTATION_ID_REUSED', '同步编号对应不同内容，已拒绝整批写入')
        return JSON.parse(receipt.response) as { protocol: number; mutationId: string; acknowledged: boolean; synced: Record<string, number>; versions: Array<{ entity: string; entityId: string; seq: string }> }
      }
      const synced: Record<string, number> = {}
      const touched = new Map<string, { entity: SyncEntity; entityId: string }>()
      function touch(entity: SyncEntity, entityId: string) {
        const key = `${entity}:${entityId}`
        if (touched.has(key)) throw new SyncRejection('DUPLICATE_ENTITY', '同一批次不能重复修改同一记录', 409, { entity, entityId })
        touched.set(key, { entity, entityId })
      }

      for (const item of data.schedules ?? []) {
        const { id, baseVersion, ...changes } = item
        touch('schedules', id)
        await applyWrite(tx, user.id, { entity: 'schedules', id, baseVersion,
          read: () => tx.schedule.findUnique({ where: { id } }),
          create: () => tx.schedule.create({ data: { id, userId: user.id, ...changes } }),
          update: () => tx.schedule.update({ where: { id }, data: changes }),
        })
      }
      for (const item of data.expenses ?? []) {
        const { id, baseVersion, ...changes } = item
        touch('expenses', id)
        await applyWrite(tx, user.id, { entity: 'expenses', id, baseVersion,
          read: () => tx.expense.findUnique({ where: { id } }),
          create: () => tx.expense.create({ data: { id, userId: user.id, ...changes } }),
          update: () => tx.expense.update({ where: { id }, data: changes }),
        })
      }
      for (const item of data.todos ?? []) {
        const { id, baseVersion, ...changes } = item
        touch('todos', id)
        await applyWrite(tx, user.id, { entity: 'todos', id, baseVersion,
          read: () => tx.todo.findUnique({ where: { id } }),
          create: () => tx.todo.create({ data: { id, userId: user.id, ...changes } }),
          update: () => tx.todo.update({ where: { id }, data: changes }),
        })
      }
      for (const item of data.habits ?? []) {
        const { id, baseVersion, ...changes } = item
        touch('habits', id)
        await applyWrite(tx, user.id, { entity: 'habits', id, baseVersion,
          read: () => tx.habit.findUnique({ where: { id } }),
          create: () => tx.habit.create({ data: { id, userId: user.id, ...changes } }),
          update: () => tx.habit.update({ where: { id }, data: changes }),
        })
      }
      for (const item of data.quickNotes ?? []) {
        const { id, baseVersion } = item
        const changes = { content: item.content, timestamp: BigInt(item.timestamp), parsed: JSON.stringify(item.parsed), confirmed: item.confirmed }
        touch('quickNotes', id)
        await applyWrite(tx, user.id, { entity: 'quickNotes', id, baseVersion,
          read: () => tx.quickNote.findUnique({ where: { id } }),
          create: () => tx.quickNote.create({ data: { id, userId: user.id, ...changes } }),
          update: () => tx.quickNote.update({ where: { id }, data: changes }),
        })
      }
      for (const item of data.diaries ?? []) {
        const { id, baseVersion, ...changes } = item
        touch('diaries', id)
        const conflict = await tx.diary.findUnique({ where: { userId_date: { userId: user.id, date: item.date } } })
        if (conflict && conflict.id !== id) throw new SyncRejection('DIARY_DATE_CONFLICT', '该日期已有另一篇日记，两份原稿均保留，请处理冲突', 409, { entity: 'diaries', entityId: id, conflictingId: conflict.id })
        await applyWrite(tx, user.id, { entity: 'diaries', id, baseVersion,
          read: () => tx.diary.findUnique({ where: { id } }),
          create: () => tx.diary.create({ data: { id, userId: user.id, ...changes } }),
          update: () => tx.diary.update({ where: { id }, data: changes }),
        })
      }
      for (const item of data.habitCheckins ?? []) {
        const { baseVersion, habitId, date, ...changes } = item
        const entityId = `${habitId}|${date}`
        touch('habitCheckins', entityId)
        const habit = await tx.habit.findUnique({ where: { id: habitId } })
        if (!habit) throw new SyncRejection('MISSING_PARENT', '打卡的习惯尚不存在，已保留整批修改', 409, { entity: 'habitCheckins', entityId })
        if (habit.userId !== user.id) throw new SyncRejection('OWNERSHIP_CONFLICT', '打卡习惯不属于当前账号', 403)
        const existing = await tx.habitCheckin.findUnique({ where: { habitId_date: { habitId, date } } })
        await assertWritable(tx, user.id, 'habitCheckins', entityId, existing ? habit : null, baseVersion)
        if (existing) await tx.habitCheckin.update({ where: { id: existing.id }, data: changes })
        else await tx.habitCheckin.create({ data: { id: generateId(), habitId, date, ...changes } })
      }
      for (const entity of ['schedules', 'expenses', 'todos', 'habits', 'quickNotes', 'diaries', 'habitCheckins'] as const) {
        if (data[entity]?.length) synced[entity] = data[entity].length
      }

      const deletions = data.deletions
      for (const item of deletions?.scheduleIds ?? []) {
        touch('schedules', item.id)
        await applyDeletion(tx, user.id, { entity: 'schedules', ...item,
          read: () => tx.schedule.findUnique({ where: { id: item.id } }), remove: () => tx.schedule.delete({ where: { id: item.id } }),
        })
      }
      for (const item of deletions?.expenseIds ?? []) {
        touch('expenses', item.id)
        await applyDeletion(tx, user.id, { entity: 'expenses', ...item,
          read: () => tx.expense.findUnique({ where: { id: item.id } }), remove: () => tx.expense.delete({ where: { id: item.id } }),
        })
      }
      for (const item of deletions?.todoIds ?? []) {
        touch('todos', item.id)
        await applyDeletion(tx, user.id, { entity: 'todos', ...item,
          read: () => tx.todo.findUnique({ where: { id: item.id } }), remove: () => tx.todo.delete({ where: { id: item.id } }),
        })
      }
      for (const item of deletions?.quickNoteIds ?? []) {
        touch('quickNotes', item.id)
        await applyDeletion(tx, user.id, { entity: 'quickNotes', ...item,
          read: () => tx.quickNote.findUnique({ where: { id: item.id } }), remove: () => tx.quickNote.delete({ where: { id: item.id } }),
        })
      }
      for (const item of deletions?.diaryIds ?? []) {
        touch('diaries', item.id)
        await applyDeletion(tx, user.id, { entity: 'diaries', ...item,
          read: () => tx.diary.findUnique({ where: { id: item.id } }), remove: () => tx.diary.delete({ where: { id: item.id } }),
        })
      }
      for (const item of deletions?.habitCheckinIds ?? []) {
        touch('habitCheckins', item.id)
        const split = item.id.lastIndexOf('|')
        if (split < 8 || !isoDateSchema.safeParse(item.id.slice(split + 1)).success) throw new SyncRejection('INVALID_CHECKIN_ID', '打卡标识无效')
        const habitId = item.id.slice(0, split), date = item.id.slice(split + 1)
        const habit = await tx.habit.findUnique({ where: { id: habitId } })
        if (habit && habit.userId !== user.id) throw new SyncRejection('OWNERSHIP_CONFLICT', '打卡习惯不属于当前账号', 403)
        const existing = await tx.habitCheckin.findUnique({ where: { habitId_date: { habitId, date } } })
        await applyDeletion(tx, user.id, { entity: 'habitCheckins', ...item,
          read: async () => existing && habit ? habit : null,
          remove: () => tx.habitCheckin.delete({ where: { habitId_date: { habitId, date } } }),
        })
      }
      for (const item of deletions?.habitIds ?? []) {
        touch('habits', item.id)
        await applyDeletion(tx, user.id, { entity: 'habits', ...item,
          read: () => tx.habit.findUnique({ where: { id: item.id } }),
          remove: async () => {
            await tx.habitCheckin.deleteMany({ where: { habitId: item.id } })
            await tx.habit.delete({ where: { id: item.id } })
          },
        })
      }
      for (const [key, ack] of [['scheduleIds', 'deletedSchedules'], ['expenseIds', 'deletedExpenses'], ['todoIds', 'deletedTodos'], ['habitIds', 'deletedHabits'], ['quickNoteIds', 'deletedQuickNotes'], ['diaryIds', 'deletedDiaries'], ['habitCheckinIds', 'deletedHabitCheckins']] as const) {
        if (deletions?.[key]?.length) synced[ack] = deletions[key].length
      }
      const versions = []
      for (const { entity, entityId } of touched.values()) versions.push({ entity, entityId, seq: await latestVersion(tx, user.id, entity, entityId) })
      const ack = { protocol: 2, mutationId: data.mutationId, acknowledged: true, synced, versions }
      await tx.syncReceipt.create({ data: { userId: user.id, mutationId: data.mutationId, requestHash, response: JSON.stringify(ack) } })
      return ack
    }, { timeout: 30_000, maxWait: 5_000 })
    return c.json(response)
  } catch (error) {
    if (error instanceof SyncRejection) return c.json({ error: error.message, code: error.code, conflict: error.details, acknowledged: false, mutationId: data.mutationId }, error.status)
    if (error && typeof error === 'object' && 'code' in error && ['P1008', 'P2002', 'P2028', 'P2034'].includes(String(error.code))) {
      c.header('Retry-After', '1')
      return c.json({ error: '并发写入未获确认，请使用相同同步编号重试', code: 'SYNC_RETRY_REQUIRED', acknowledged: false, mutationId: data.mutationId }, 503)
    }
    throw error
  }
})
