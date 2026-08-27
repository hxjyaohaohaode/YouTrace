import type { Context } from 'hono'
import { env } from './env.js'

interface RateLimitOptions {
  limit: number
  windowMs: number
}

interface RateLimitBucket {
  count: number
  resetAt: number
}

const MAX_BUCKETS = 20_000
const buckets = new Map<string, RateLimitBucket>()

function cleanupBucket(key: string, now: number) {
  const bucket = buckets.get(key)
  if (!bucket) {
    return
  }

  if (bucket.resetAt <= now) {
    buckets.delete(key)
  }
}

let sweeperStarted = false

function startSweeper() {
  if (sweeperStarted) {
    return
  }
  sweeperStarted = true
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key)
      }
    }
  }, 60_000)
  timer.unref?.()
}

export function getClientIp(c: Context): string {
  if (!env.trustProxy) {
    const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress
    return remote?.slice(0, 64) || 'unknown'
  }

  const forwardedFor = c.req.header('x-forwarded-for')
  if (forwardedFor) {
    const hops = forwardedFor.split(',').map((hop) => hop.trim()).filter(Boolean)
    const nearestProxyHop = hops.at(-1)
    if (nearestProxyHop) {
      return nearestProxyHop.slice(0, 64)
    }
  }

  return c.req.header('x-real-ip')?.slice(0, 64) || 'unknown'
}

export function consumeRateLimit(
  key: string,
  options: RateLimitOptions,
): { allowed: boolean; retryAfterSeconds: number } {
  startSweeper()

  const now = Date.now()
  cleanupBucket(key, now)

  if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) {
    const oldestKey = buckets.keys().next().value
    if (oldestKey !== undefined) {
      buckets.delete(oldestKey)
    }
  }

  const existing = buckets.get(key)
  if (!existing) {
    buckets.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    })

    return { allowed: true, retryAfterSeconds: Math.ceil(options.windowMs / 1000) }
  }

  if (existing.count >= options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  existing.count += 1
  buckets.set(key, existing)

  return {
    allowed: true,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  }
}
