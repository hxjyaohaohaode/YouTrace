import type { Context, Next } from 'hono'
import { prisma } from '../utils/db.js'
import { readSessionToken, verifySessionToken, isSessionRevoked } from '../utils/session.js'

export interface AuthUser {
  id: string
  phone: string
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const token = readSessionToken(c)
  if (!token) {
    return c.json({ error: '未登录' }, 401)
  }

  let payload: AuthUser
  try { payload = verifySessionToken(token) as AuthUser } catch {
    return c.json({ error: '登录已过期' }, 401)
  }
  if (await isSessionRevoked(token) || !await prisma.user.findUnique({ where: { id: payload.id }, select: { id: true } })) {
    return c.json({ error: '登录已失效，请重新登录' }, 401)
  }
  const expectedAccount = c.req.header('X-YouTrace-Account')
  if (expectedAccount && expectedAccount !== payload.id) {
    c.header('X-YouTrace-Account-Mismatch', 'true')
    return c.json({ error: '其他标签页已切换账号，请重新确认当前账号' }, 409)
  }
  c.set('user', payload)
  await next()
}
