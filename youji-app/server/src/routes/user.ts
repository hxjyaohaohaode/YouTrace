import { Hono } from 'hono'
import { prisma } from '../utils/db.js'
import type { AuthUser } from '../middleware/auth.js'
import { cancelAIRequests } from '../services/userAI.js'
import { clearSession } from '../utils/session.js'
import { preferenceMutationSchema, readAccountPreferences, writeAccountPreferences, preferenceFailure } from '../services/settingsProtocol.js'

export const userRoutes = new Hono()

userRoutes.get('/settings', async (c) => {
  c.header('Cache-Control', 'no-store')
  try { return c.json(await readAccountPreferences((c.get('user') as AuthUser).id)) }
  catch (error) { const failure = preferenceFailure(error); return c.json(failure.body, failure.status) }
})

userRoutes.patch('/settings', async (c) => {
  c.header('Cache-Control', 'no-store')
  const body: unknown = await c.req.json()
  if (!body || typeof body !== 'object' || !('protocol' in body) || body.protocol !== 1) {
    return c.json({ error: '请更新应用后保存偏好，本设备原稿仍保留', code: 'SETTINGS_PROTOCOL_REQUIRED', minimumProtocol: 1, acknowledged: false }, 426)
  }
  const parsed = preferenceMutationSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: '偏好格式不正确，原稿已保留', code: 'SETTINGS_INVALID', acknowledged: false }, 400)
  try { return c.json(await writeAccountPreferences((c.get('user') as AuthUser).id, parsed.data)) }
  catch (error) { const failure = preferenceFailure(error); return c.json(failure.body, failure.status) }
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
    await tx.goal.deleteMany({ where: { userId: user.id } })
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

  cancelAIRequests(user.id)
  clearSession(c)
  return c.json({ success: true })
})
