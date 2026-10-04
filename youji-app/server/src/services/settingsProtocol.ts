import { z } from 'zod'
import type { Prisma, AccountPreferences } from '@prisma/client'
import { prisma } from '../utils/db.js'
import { mutationHash } from './syncProtocol.js'

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const accountPreferenceSchema = z.object({
  coachStyle: z.enum(['gentle', 'strict', 'data']),
  coachPushEnabled: z.boolean(),
  pushLimit: z.number().int().min(0).max(10),
  quietEnabled: z.boolean(),
  quietStart: time,
  quietEnd: time,
  eveningReviewEnabled: z.boolean(),
  eveningReviewTime: time,
}).strict()
const changesSchema = accountPreferenceSchema.partial().refine((value) => Object.keys(value).length > 0, '至少提供一个设置项')
export const preferenceMutationSchema = z.object({
  protocol: z.literal(1),
  mutationId: z.string().min(8).max(128),
  baseRevision: z.string().regex(/^(0|[1-9]\d{0,9})$/).refine((value) => BigInt(value) < 2147483647n),
  changes: changesSchema,
}).strict()
export type AccountPreferenceValues = z.infer<typeof accountPreferenceSchema>
export type PreferenceMutation = z.infer<typeof preferenceMutationSchema>
export interface PreferenceSnapshot { protocol: 1; revision: string; settings: AccountPreferenceValues }
export class PreferenceRejection extends Error {
  constructor(public code: string, message: string, public status: 404 | 409 | 503, public snapshot?: PreferenceSnapshot) { super(message) }
}
function snapshot(row: AccountPreferences): PreferenceSnapshot {
  const { coachStyle, coachPushEnabled, pushLimit, quietEnabled, quietStart, quietEnd, eveningReviewEnabled, eveningReviewTime } = row
  return { protocol: 1, revision: String(row.revision), settings: accountPreferenceSchema.parse({ coachStyle, coachPushEnabled, pushLimit, quietEnabled, quietStart, quietEnd, eveningReviewEnabled, eveningReviewTime }) }
}
async function ensurePreferences(tx: Prisma.TransactionClient, userId: string) {
  const existing = await tx.accountPreferences.findUnique({ where: { userId } })
  if (existing) return existing
  const user = await tx.user.findUnique({ where: { id: userId }, select: { coachStyle: true, quietStart: true, quietEnd: true, pushLimit: true } })
  if (!user) throw new PreferenceRejection('SETTINGS_OWNER_MISSING', '用户不存在', 404)
  return tx.accountPreferences.create({ data: { userId, ...user } })
}
export async function readAccountPreferences(userId: string): Promise<PreferenceSnapshot> {
  return prisma.$transaction(async (tx) => snapshot(await ensurePreferences(tx, userId)))
}
export async function writeAccountPreferences(userId: string, mutation: PreferenceMutation) {
  const requestHash = mutationHash(mutation)
  return prisma.$transaction(async (tx) => {
    const prior = await tx.accountPreferenceReceipt.findUnique({ where: { userId_mutationId: { userId, mutationId: mutation.mutationId } } })
    if (prior) {
      if (prior.requestHash !== requestHash) throw new PreferenceRejection('SETTINGS_MUTATION_REUSED', '同一偏好保存编号不能用于不同内容，原稿已保留', 409)
      return JSON.parse(prior.response) as PreferenceSnapshot & { mutationId: string; acknowledged: true }
    }
    const current = await ensurePreferences(tx, userId)
    if (String(current.revision) !== mutation.baseRevision) throw new PreferenceRejection('SETTINGS_VERSION_CONFLICT', '其他设备已修改偏好，请核对后选择，原稿已保留', 409, snapshot(current))
    if (current.revision >= 2147483646) throw new PreferenceRejection('SETTINGS_REVISION_EXHAUSTED', '偏好版本需维护，原稿已保留', 503)
    const changed = await tx.accountPreferences.updateMany({ where: { userId, revision: current.revision }, data: { ...mutation.changes, revision: { increment: 1 } } })
    if (changed.count !== 1) throw new PreferenceRejection('SETTINGS_RETRY_REQUIRED', '并发保存尚未确认，请用原保存编号重试', 503)
    // Existing auth/chat consumers remain correct; unversioned PATCH is refused.
    const { coachStyle, pushLimit, quietStart, quietEnd } = mutation.changes
    await tx.user.update({ where: { id: userId }, data: { coachStyle, pushLimit, quietStart, quietEnd } })
    const updated = await tx.accountPreferences.findUniqueOrThrow({ where: { userId } })
    const response = { ...snapshot(updated), mutationId: mutation.mutationId, acknowledged: true as const }
    await tx.accountPreferenceReceipt.create({ data: { userId, mutationId: mutation.mutationId, requestHash, response: JSON.stringify(response) } })
    return response
  }, { timeout: 10_000, maxWait: 5_000 })
}
export function preferenceFailure(error: unknown) {
  if (error instanceof PreferenceRejection) return { status: error.status, body: { error: error.message, code: error.code, acknowledged: false, ...(error.snapshot ? { conflict: error.snapshot } : {}) } }
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const unavailable = code === 'P2021' || code === 'P2022'
  return { status: 503 as const, body: { error: unavailable ? '偏好存储尚未就绪，修改已保留；请稍后重试' : '偏好暂未确认，修改已保留，请使用原编号重试', code: unavailable ? 'SETTINGS_SCHEMA_UNAVAILABLE' : 'SETTINGS_RETRY_REQUIRED', acknowledged: false } }
}
