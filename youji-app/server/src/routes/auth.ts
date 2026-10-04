import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../utils/db.js'
import { generateId } from '../utils/id.js'
import { clearSession, issueSession, readSessionToken, verifySessionToken, isSessionRevoked, revokeSession } from '../utils/session.js'
import { consumeRateLimit, getClientIp } from '../utils/rateLimit.js'
import { env } from '../utils/env.js'
import {
  generateOtpCode,
  generateRegistrationToken,
  hashAuthSecret,
  verifyAuthSecret,
} from '../services/authSecurity.js'
import { deliverOtp, OtpDeliveryUnavailableError } from '../services/sms.js'

export const authRoutes = new Hono()

const phoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
const sendCodeSchema = z.object({ phone: phoneSchema }).strict()
const verifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/),
  challengeId: z.string().min(16).max(64),
}).strict()
const registerSchema = z.object({
  phone: phoneSchema,
  nickname: z.string().trim().min(1).max(20),
  identity: z.enum(['student', 'worker', 'freelancer', 'other']).default('other'),
  city: z.string().trim().max(50).default(''),
  registrationTicket: z.string().min(32).max(256),
}).strict()

class InvalidChallengeError extends Error {}
class InvalidRegistrationTicketError extends Error {}
class ExistingUserError extends Error {}

function publicUser(user: {
  id: string
  phone: string
  nickname: string
  avatar: string
  identity: string
  city: string
  coachStyle: string
  quietStart: string
  quietEnd: string
  pushLimit: number
}) {
  return {
    id: user.id,
    phone: user.phone,
    nickname: user.nickname,
    avatar: user.avatar,
    identity: user.identity,
    city: user.city,
    coachStyle: user.coachStyle,
    quietStart: user.quietStart,
    quietEnd: user.quietEnd,
    pushLimit: user.pushLimit,
  }
}

authRoutes.post('/send-code', async (c) => {
  const parsed = sendCodeSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const purgeBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: purgeBefore } } })
  await prisma.registrationTicket.deleteMany({
    where: { expiresAt: { lt: purgeBefore }, consumedAt: { not: null } },
  })

  const clientIp = getClientIp(c)
  const phoneLimit = consumeRateLimit(`auth:send-code:phone:${parsed.data.phone}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  })
  const ipLimit = consumeRateLimit(`auth:send-code:ip:${clientIp}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  })

  if (!phoneLimit.allowed || !ipLimit.allowed) {
    const retryAfterSeconds = Math.max(phoneLimit.retryAfterSeconds, ipLimit.retryAfterSeconds)
    c.header('Retry-After', String(retryAfterSeconds))
    return c.json({ error: '请求过于频繁，请稍后再试' }, 429)
  }

  const challengeId = generateId()
  const code = generateOtpCode()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + env.otpTtlSeconds * 1000)

  await prisma.$transaction([
    prisma.authChallenge.updateMany({
      where: { phone: parsed.data.phone, purpose: 'login', consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.authChallenge.create({
      data: {
        id: challengeId,
        phone: parsed.data.phone,
        purpose: 'login',
        codeHash: hashAuthSecret(env.jwtSecret, `otp:${challengeId}`, code),
        expiresAt,
        maxAttempts: env.otpMaxAttempts,
      },
    }),
  ])

  try {
    const delivery = await deliverOtp(parsed.data.phone, code)
    return c.json({
      success: true,
      challengeId,
      expiresInSeconds: env.otpTtlSeconds,
      ...(delivery.exposeDevelopmentCode ? { devCode: code } : {}),
    })
  } catch (error) {
    await prisma.authChallenge.deleteMany({ where: { id: challengeId } })
    if (error instanceof OtpDeliveryUnavailableError) {
      return c.json({ error: '验证码服务暂不可用' }, 503)
    }
    throw error
  }
})

authRoutes.post('/verify', async (c) => {
  const parsed = verifySchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const clientIp = getClientIp(c)
  const rateLimit = consumeRateLimit(`auth:verify:${parsed.data.phone}:${clientIp}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  })
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds))
    return c.json({ error: '验证过于频繁，请稍后再试' }, 429)
  }

  const challenge = await prisma.authChallenge.findFirst({
    where: { id: parsed.data.challengeId, phone: parsed.data.phone, purpose: 'login' },
  })
  const now = new Date()
  if (
    !challenge ||
    challenge.consumedAt ||
    challenge.expiresAt <= now ||
    challenge.attempts >= challenge.maxAttempts
  ) {
    return c.json({ error: '验证码错误或已过期' }, 401)
  }

  const validCode = verifyAuthSecret(
    env.jwtSecret,
    `otp:${challenge.id}`,
    parsed.data.code,
    challenge.codeHash,
  )
  if (!validCode) {
    await prisma.authChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: challenge.attempts },
      data: { attempts: { increment: 1 } },
    })
    return c.json({ error: '验证码错误或已过期' }, 401)
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.authChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: challenge.attempts,
        },
        data: { consumedAt: now },
      })
      if (claimed.count !== 1) throw new InvalidChallengeError()

      const user = await tx.user.findUnique({ where: { phone: parsed.data.phone } })
      if (user) return { user, registrationTicket: null }

      const rawTicket = generateRegistrationToken()
      await tx.registrationTicket.create({
        data: {
          id: generateId(),
          phone: parsed.data.phone,
          tokenHash: hashAuthSecret(env.jwtSecret, 'registration-ticket', rawTicket),
          expiresAt: new Date(now.getTime() + env.registrationTicketTtlSeconds * 1000),
        },
      })
      return { user: null, registrationTicket: rawTicket }
    })

    if (result.user) {
      issueSession(c, { id: result.user.id, phone: result.user.phone })
      return c.json({ user: publicUser(result.user) })
    }

    return c.json({
      needRegister: true,
      phone: parsed.data.phone,
      registrationTicket: result.registrationTicket,
    })
  } catch (error) {
    if (error instanceof InvalidChallengeError) {
      return c.json({ error: '验证码已被使用或已过期' }, 401)
    }
    throw error
  }
})

authRoutes.post('/register', async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const { phone, nickname, identity, city, registrationTicket } = parsed.data
  const tokenHash = hashAuthSecret(env.jwtSecret, 'registration-ticket', registrationTicket)
  const now = new Date()

  try {
    const user = await prisma.$transaction(async (tx) => {
      const ticket = await tx.registrationTicket.findUnique({ where: { tokenHash } })
      if (!ticket || ticket.phone !== phone || ticket.consumedAt || ticket.expiresAt <= now) {
        throw new InvalidRegistrationTicketError()
      }

      const existing = await tx.user.findUnique({ where: { phone } })
      if (existing) throw new ExistingUserError()

      const claimed = await tx.registrationTicket.updateMany({
        where: { id: ticket.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      })
      if (claimed.count !== 1) throw new InvalidRegistrationTicketError()

      return tx.user.create({
        data: { id: generateId(), phone, nickname, identity, city },
      })
    })

    issueSession(c, { id: user.id, phone: user.phone })
    return c.json({ user: publicUser(user) }, 201)
  } catch (error) {
    if (error instanceof InvalidRegistrationTicketError) {
      return c.json({ error: '注册凭证无效或已过期，请重新验证手机号' }, 401)
    }
    if (error instanceof ExistingUserError) {
      return c.json({ error: '该手机号已注册' }, 409)
    }
    throw error
  }
})

authRoutes.get('/me', async (c) => {
  const token = readSessionToken(c)
  if (!token) return c.json({ error: '未登录' }, 401)
  let payload: { id: string }
  try { payload = verifySessionToken(token) } catch { return c.json({ error: '登录已过期' }, 401) }
  if (await isSessionRevoked(token)) { clearSession(c); return c.json({ error: '登录已退出，请重新登录' }, 401) }
  const user = await prisma.user.findUnique({ where: { id: payload.id } })
  if (!user) { clearSession(c); return c.json({ error: '登录已失效' }, 401) }
  return c.json({ user: publicUser(user) })
})

authRoutes.post('/logout', async (c) => {
  const token = readSessionToken(c)
  if (token) {
    try { verifySessionToken(token) } catch { clearSession(c); return c.json({ success: true }) }
    const expected = c.req.header('X-YouTrace-Account')
    if (expected && expected !== verifySessionToken(token).id) {
      c.header('X-YouTrace-Account-Mismatch', 'true')
      return c.json({ error: '其他标签页已切换账号，未退出新账号' }, 409)
    }
    await revokeSession(token)
  }
  clearSession(c)
  return c.json({ success: true })
})
