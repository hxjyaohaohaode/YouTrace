import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authMiddleware } from './middleware/auth.js'
import { authRoutes } from './routes/auth.js'
import { aiConnectionRoutes } from './routes/aiConnection.js'
import { chatRoutes } from './routes/chat.js'
import { coachRoutes } from './routes/coach.js'
import { diaryRoutes } from './routes/diary.js'
import { expenseRoutes } from './routes/expenses.js'
import { habitRoutes } from './routes/habits.js'
import { quickNoteRoutes } from './routes/quickNotes.js'
import { scheduleRoutes } from './routes/schedules.js'
import { syncRoutes } from './routes/sync.js'
import { todoRoutes } from './routes/todos.js'
import { userRoutes } from './routes/user.js'
import { env, isOriginAllowed } from './utils/env.js'
import { prisma } from './utils/db.js'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function createApp() {
  const app = new Hono()

  if (!env.isProduction) {
    app.use('*', logger())
  }

  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    if (env.isProduction) {
      c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
    }
    await next()
  })

  app.use('/api/*', async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method)) {
      const origin = c.req.header('Origin')
      if (!origin || !isOriginAllowed(origin)) {
        return c.json({ error: 'Origin not allowed' }, 403)
      }
    }
    await next()
  })

  app.use('*', cors({
    origin: (origin) => (isOriginAllowed(origin) && origin ? origin : ''),
    credentials: true,
    exposeHeaders: ['X-Session-Id', 'X-YouTrace-Account-Mismatch'],
    allowHeaders: ['Content-Type', 'X-YouTrace-Account'],
  }))

  app.use('/api/*', bodyLimit({
    maxSize: env.requestBodyLimitBytes,
    onError: (c) => c.json({ error: '请求体过大' }, 413),
  }))

  app.route('/api/auth', authRoutes)

  app.use('/api/*', authMiddleware)

  app.route('/api/user', userRoutes)
  app.route('/api/schedules', scheduleRoutes)
  app.route('/api/expenses', expenseRoutes)
  app.route('/api/todos', todoRoutes)
  app.route('/api/habits', habitRoutes)
  app.route('/api/quicknote', quickNoteRoutes)
  app.route('/api/diary', diaryRoutes)
  app.route('/api/coach', coachRoutes)
  app.route('/api/chat', chatRoutes)
  app.route('/api/ai-connection', aiConnectionRoutes)
  app.route('/api/sync', syncRoutes)

  app.get('/health', async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({ status: 'ok', time: new Date().toISOString() })
    } catch {
      return c.json({ status: 'degraded', time: new Date().toISOString() }, 503)
    }
  })

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((error, c) => {
    if (error instanceof SyntaxError && c.req.header('Content-Type')?.includes('application/json')) {
      return c.json({ error: '请求体不是有效的 JSON' }, 400)
    }

    console.error('Unhandled request error', {
      method: c.req.method,
      path: c.req.path,
      name: error.name,
    })
    return c.json({ error: '服务器内部错误' }, 500)
  })

  return app
}

export const app = createApp()
