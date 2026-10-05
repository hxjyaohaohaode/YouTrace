import { decodeScheduleExceptions } from './scheduleExceptions.js'
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export const SYNC_ENTITIES = ['schedules', 'expenses', 'todos', 'habits', 'quickNotes', 'diaries', 'habitCheckins', 'goals'] as const
export type SyncEntity = typeof SYNC_ENTITIES[number]
export type SyncTransaction = Prisma.TransactionClient
export type SyncVersion = { entity: string; entityId: string; seq: string }

export class SyncRejection extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 403 | 409 = 409,
    public readonly details?: { entity: string; entityId: string; serverVersion?: string; conflictingId?: string },
  ) { super(message) }
}

export function mutationHash(payload: unknown): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)]))
    }
    return value
  }
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex')
}

export async function latestVersion(tx: SyncTransaction, userId: string, entity: SyncEntity, entityId: string) {
  // Prisma SQLite infers INTEGER as Int32 even with a BigInt schema field.
  // CAST at the SQL boundary preserves all 64 bits of SQLite's rowid.
  const changes = await tx.$queryRaw<Array<{ seq: string }>>`
    SELECT CAST("seq" AS TEXT) AS "seq" FROM "SyncChange"
    WHERE "userId" = ${userId} AND "entity" = ${entity} AND "entityId" = ${entityId}
    ORDER BY "SyncChange"."seq" DESC LIMIT 1`
  return changes[0]?.seq ?? '0'
}

export async function assertWritable(
  tx: SyncTransaction, userId: string, entity: SyncEntity, entityId: string,
  existing: { userId: string } | null, baseVersion: string | undefined,
) {
  if (existing && existing.userId !== userId) {
    throw new SyncRejection('OWNERSHIP_CONFLICT', '同步数据存在所有权冲突，已拒绝整批写入', 403)
  }
  const tombstone = await tx.syncTombstone.findUnique({ where: { userId_entity_entityId: { userId, entity, entityId } } })
  if (tombstone) throw new SyncRejection('ENTITY_DELETED', '记录已被删除，原稿已保留，请使用新记录恢复', 409, { entity, entityId })
  const version = await latestVersion(tx, userId, entity, entityId)
  if (existing ? baseVersion !== version : (baseVersion !== undefined && baseVersion !== '0')) {
    throw new SyncRejection('VERSION_CONFLICT', '记录已在其他设备修改，原稿已保留，请处理冲突', 409, { entity, entityId, serverVersion: version })
  }
}

/** Unknown-ID deletions are durable too; otherwise an offline create could resurrect them. */
export async function recordAbsentDeletion(tx: SyncTransaction, userId: string, entity: SyncEntity, entityId: string, baseVersion?: string) {
  const where = { userId_entity_entityId: { userId, entity, entityId } }
  if (await tx.syncTombstone.findUnique({ where })) return
  if (baseVersion !== undefined && baseVersion !== '0') {
    throw new SyncRejection('VERSION_CONFLICT', '删除目标版本不匹配，未确认删除', 409, { entity, entityId, serverVersion: '0' })
  }
  await tx.syncTombstone.create({ data: { userId, entity, entityId } })
  await tx.$executeRaw`INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation") VALUES (${userId}, ${entity}, ${entityId}, 'delete')`
}

/** Trigger payloads preserve SQLite values, including older text and newer integer dates. */
export function decodeChangePayload(entity: string, payload: string | null): Record<string, unknown> | null {
  if (payload === null) return null
  const value: unknown = JSON.parse(payload)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid sync change payload')
  const row = value as Record<string, unknown>
  for (const key of ['done', 'confirmed', 'isIncome']) if (key in row) row[key] = Boolean(row[key])
  for (const key of ['createdAt', 'updatedAt', 'completedAt']) {
    const value = row[key]
    if (typeof value === 'string' || typeof value === 'number') {
      const utcValue = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
      const date = new Date(utcValue)
      if (!Number.isNaN(date.getTime())) row[key] = date.toISOString()
    }
  }
  if (entity === 'quickNotes' && typeof row.parsed === 'string') {
    // A malformed historical JSON blob must remain recoverable, not silently become {}.
    try { row.parsed = JSON.parse(row.parsed) } catch { row.parsed = { legacyRaw: row.parsed } }
  }
  if (entity === 'schedules' && typeof row.exceptions === 'string') row.exceptions = decodeScheduleExceptions(row.exceptions)
  return row
}
