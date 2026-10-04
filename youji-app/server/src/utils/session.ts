import type { Context } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from './db.js'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import jwt from 'jsonwebtoken'
import { env } from './env.js'

export interface SessionUser {
  id: string
  phone: string
  exp?: number
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
    jwtid: randomUUID(),
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

function sessionDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function isSessionRevoked(token: string): Promise<boolean> {
  return Boolean(await prisma.revokedSession.findUnique({ where: { id: sessionDigest(token) }, select: { id: true } }))
}

export async function revokeSession(token: string): Promise<void> {
  const payload = verifySessionToken(token)
  const expiresAt = new Date((payload.exp ?? 0) * 1000)
  if (expiresAt <= new Date()) return
  await prisma.revokedSession.upsert({
    where: { id: sessionDigest(token) }, update: {},
    create: { id: sessionDigest(token), expiresAt },
  })
  await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
}
