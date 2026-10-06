import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'

const directory = await mkdtemp(resolve(tmpdir(), 'youtrace-brief-evidence-'))
const databasePath = resolve(directory, 'synthetic.db')
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${databasePath}`
process.env.JWT_SECRET = 'synthetic-brief-secret-at-least-32-characters'
process.env.LLM_API_KEY = ''
const { prisma } = await import('../src/utils/db.js')
const { coachRoutes } = await import('../src/routes/coach.js')
const { chatRoutes } = await import('../src/routes/chat.js')
const app = new Hono<{ Variables: { user: { id: string } } }>()
app.use('*', async (c, next) => { c.set('user', { id: 'synthetic-brief-user' }); await next() })
app.route('/coach', coachRoutes)
app.route('/chat', chatRoutes)

before(async () => {
  const migrations = resolve('prisma/migrations')
  const fixture = new DatabaseSync(databasePath, { enableDoubleQuotedStringLiterals: true })
  try {
    const entries = (await readdir(migrations, { withFileTypes: true })).filter((row) => row.isDirectory()).map((row) => row.name).sort()
    for (const name of entries) fixture.exec(await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'))
  } finally { fixture.close() }
  await prisma.user.create({ data: { id: 'synthetic-brief-user', phone: '13900009999', nickname: 'synthetic' } })
})
beforeEach(async () => { await prisma.insight.deleteMany(); await prisma.expense.deleteMany() })
after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }) })

test('rule brief excludes income and future dates and states its evidence window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T06:30:00Z') })
  await prisma.expense.createMany({ data: [
    { id: 'spent-today', amount: 2500, category: 'food', date: '2026-10-04', isIncome: false },
    { id: 'spent-earlier', amount: 1000, category: 'food', date: '2026-10-01', isIncome: false },
    { id: 'income-today', amount: 500000, category: 'income', date: '2026-10-04', isIncome: true },
    { id: 'legacy-income', amount: 10000, category: 'income', date: '2026-10-04', isIncome: false },
    { id: 'future-this-month', amount: 9900, category: 'food', date: '2026-10-05', isIncome: false },
    { id: 'future-next-month', amount: 8800, category: 'food', date: '2026-11-01', isIncome: false },
    { id: 'previous-month', amount: 7700, category: 'food', date: '2026-09-30', isIncome: false },
  ].map((row) => ({ ...row, name: 'synthetic', userId: 'synthetic-brief-user' })) })
  const response = await app.request('/coach/generate-brief', { method: 'POST' })
  assert.equal(response.status, 200)
  const { insight } = await response.json()
  assert.match(insight.description, /2026-10-04.*支出 ¥25/)
  assert.match(insight.description, /2026-10-01 至 2026-10-04.*¥35/)
  assert.doesNotMatch(insight.title, /今日/)
})

test('brief preserves historical evidence time rather than implying a current-week result', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T06:30:00Z') })
  await prisma.insight.create({ data: {
    id: 'old-snapshot', userId: 'synthetic-brief-user', type: 'suggestion', title: '今日教练简报',
    description: '今日消费 ¥0，本月累计 ¥0', dataSources: '["expense"]', createdAt: new Date('2026-09-01T06:00:00Z'),
  } })
  const response = await app.request('/coach/brief')
  const { brief } = await response.json()
  assert.equal(brief.generatedAt, '2026-10-04T06:30:00.000Z')
  assert.equal(brief.reviewDate, '2026-10-03')
  assert.equal(brief.weeklyInsights[0].createdAt, '2026-09-01T06:00:00.000Z')
  assert.equal(brief.weeklyInsights[0].title, '记录简报 · 2026-09-01')
})

test('chat declares UTF-8 and preserves fallback content, navigation actions and completion', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T06:30:00Z') })
  const providerFetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider request') })
  await prisma.expense.create({ data: {
    id: 'chat-spent-today', userId: 'synthetic-brief-user', name: '合成午餐',
    amount: 2500, category: 'food', date: '2026-10-04', isIncome: false,
  } })
  const message = '看看最近的花销'
  const response = await app.request('/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8')
  const content = '【规则回复 · 在线模型当前不可用】\n最近7天你一共消费了¥25，共1笔。\n\n消费大头：food ¥25。\n\n这些是已记录金额，可在明细中核对。'
  const actions = [
    { type: 'navigate', path: '/expense', label: '查看花销明细' },
    { type: 'navigate', path: '/insights', label: '看看餐饮相关洞察' },
  ]
  const body = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer())
  assert.equal(body, `data: ${JSON.stringify({ content, source: 'rule_fallback' })}\n\ndata: ${JSON.stringify({ actions })}\n\ndata: [DONE]\n\n`)
  assert.equal(providerFetch.mock.callCount(), 0)
  const sessionId = response.headers.get('X-Session-Id')
  assert.ok(sessionId)
  const saved = await prisma.chatMessage.findMany({
    where: { sessionId }, select: { role: true, content: true, actions: true },
  })
  assert.equal(saved.length, 2)
  assert.deepEqual(saved.find((row) => row.role === 'user'), { role: 'user', content: message, actions: null })
  assert.deepEqual(saved.find((row) => row.role === 'assistant'), { role: 'assistant', content, actions: JSON.stringify(actions) })
})
