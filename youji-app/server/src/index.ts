import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { env } from './utils/env.js'
import { prisma } from './utils/db.js'

console.log(`Youji server running on port ${env.port}`)

const server = serve({ fetch: app.fetch, port: env.port, hostname: process.env.HOST?.trim() || undefined })

let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}, shutting down`)
  try {
    await prisma.$disconnect()
  } catch {
    // ignore disconnect errors during forced shutdown path
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3_000).unref()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
