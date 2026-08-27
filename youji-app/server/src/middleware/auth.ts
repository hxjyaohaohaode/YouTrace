import type { Context, Next } from 'hono'
import { readSessionToken, verifySessionToken } from '../utils/session.js'

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

  try {
    const payload = verifySessionToken(token) as AuthUser
    c.set('user', payload)
    await next()
  } catch {
    return c.json({ error: '登录已过期' }, 401)
  }
}
