import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import jwt from 'jsonwebtoken'
import { env } from './env.js'

export interface SessionUser {
  id: string
  phone: string
}

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const SESSION_ISSUER = 'youji-server'
const SESSION_AUDIENCE = 'youji-web'

function getSameSitePolicy(): 'Lax' | 'None' {
  return env.isProduction ? 'None' : 'Lax'
}

export function issueSession(c: Context, user: SessionUser): void {
  const token = jwt.sign(user, env.jwtSecret, {
    algorithm: 'HS256',
    issuer: SESSION_ISSUER,
    audience: SESSION_AUDIENCE,
    subject: user.id,
    expiresIn: `${SESSION_TTL_SECONDS}s`,
  })

  setCookie(c, env.sessionCookieName, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: getSameSitePolicy(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSession(c: Context): void {
  deleteCookie(c, env.sessionCookieName, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: getSameSitePolicy(),
    path: '/',
  })
}

export function readSessionToken(c: Context): string | null {
  return getCookie(c, env.sessionCookieName) ?? null
}

export function verifySessionToken(token: string): SessionUser {
  return jwt.verify(token, env.jwtSecret, {
    algorithms: ['HS256'],
    issuer: SESSION_ISSUER,
    audience: SESSION_AUDIENCE,
  }) as SessionUser
}
