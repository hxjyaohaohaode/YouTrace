import { publicServerAIConfiguration } from '../services/serverAI.js'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthUser } from '../middleware/auth.js'
import { prisma } from '../utils/db.js'
import { consumeRateLimit } from '../utils/rateLimit.js'
import { AIError, AI_PROVIDERS, completeUserAI, connectionSchema, encryptionReady, publicConnection, removeConnection, saveConnection, selectedConnection } from '../services/userAI.js'

export const aiConnectionRoutes = new Hono()
const identity = z.object({ connectionId: z.string().uuid(), version: z.number().int().min(1).max(2147483646) }).strict()
aiConnectionRoutes.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
aiConnectionRoutes.onError((error, c) => error instanceof AIError
  ? c.json({ error: error.code }, error.status)
  : c.json({ error: 'AI_CONNECTION_UNAVAILABLE' }, 503))
aiConnectionRoutes.get('/', async c => {
  const user = c.get('user') as AuthUser
  const row = await prisma.userAIConnection.findUnique({ where: { userId: user.id } })
  return c.json({ connection: publicConnection(row), templates: AI_PROVIDERS, credentialStorageReady: encryptionReady(), serverAI: publicServerAIConfiguration() })
})
aiConnectionRoutes.put('/', async c => {
  const parsed = connectionSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'AI_CONNECTION_INVALID' }, 400)
  const user = c.get('user') as AuthUser
  const limit = consumeRateLimit(`ai-connection:${user.id}`, { limit: 15, windowMs: 60000 })
  if (!limit.allowed) return c.json({ error: 'AI_RATE_LIMITED' }, 429)
  return c.json({ connection: await saveConnection(user.id, parsed.data) })
})
aiConnectionRoutes.post('/remove', async c => {
  const parsed = identity.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'AI_CONNECTION_INVALID' }, 400)
  const user = c.get('user') as AuthUser
  await removeConnection(user.id, parsed.data.connectionId, parsed.data.version)
  return c.json({ removed: true })
})
aiConnectionRoutes.post('/probe', async c => {
  const parsed = identity.extend({ confirmProviderCharge: z.literal(true) }).strict().safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'AI_PROBE_CONSENT_REQUIRED' }, 400)
  const user = c.get('user') as AuthUser
  const limit = consumeRateLimit(`ai-probe:${user.id}`, { limit: 3, windowMs: 60000 })
  if (!limit.allowed) return c.json({ error: 'AI_RATE_LIMITED' }, 429)
  const row = await selectedConnection(user.id, parsed.data.connectionId, parsed.data.version, false)
  // Only this synthetic text is disclosed; not a single user record or chat is read.
  for await (const _ of completeUserAI(row, [{ role: 'user', content: 'Connection test. Reply OK.' }], c.req.raw.signal, true)) { /* consume bounded response without echo */ }
  await selectedConnection(user.id, parsed.data.connectionId, parsed.data.version, false)
  return c.json({ ok: true, notice: '本次连接测试成功，不代表所有模型功能或余额持续可用' })
})
