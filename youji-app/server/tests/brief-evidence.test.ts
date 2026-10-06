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
  const content = '【规则回复 · 在线模型当前不可用】\n近7天 2026-09-28 至 2026-10-04\n已记录支出 ¥25.00，共1笔。\n\n支出分类：餐饮 ¥25.00。\n\n这些是已记录金额，可在明细中核对。'
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

test('read-only brief API counts retained dated true habits independently of current plan changes', async (t) => {
  const now = new Date('2026-10-07T04:00:00Z')
  t.mock.timers.enable({ apis: ['Date'], now })
  const providerFetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider request') })
  // These are synthetic SQLite fixtures, including explicit records predating habit creation.
  const habits = ['recap-one', 'recap-two'].map((id, sortOrder) => ({ id, userId: 'synthetic-brief-user', name: id, icon: '🌱', frequency: 'weekly', sortOrder, createdAt: now, updatedAt: now }))
  await prisma.habit.createMany({ data: habits })
  await prisma.habitCheckin.createMany({ data: [
    { id: 'recap-monday-one', habitId: 'recap-one', date: '2026-10-05', done: true },
    { id: 'recap-monday-two', habitId: 'recap-two', date: '2026-10-05', done: true },
    { id: 'recap-tuesday', habitId: 'recap-one', date: '2026-10-06', done: true },
    { id: 'recap-false', habitId: 'recap-two', date: '2026-10-06', done: false },
    { id: 'recap-today', habitId: 'recap-two', date: '2026-10-07', done: true },
    { id: 'recap-future', habitId: 'recap-two', date: '2026-10-08', done: true },
  ] })
  const readSources = async () => ({
    habits: await prisma.habit.findMany({ orderBy: { id: 'asc' } }),
    checkins: await prisma.habitCheckin.findMany({ orderBy: { id: 'asc' } }),
    insights: await prisma.insight.findMany({ orderBy: { id: 'asc' } }),
  })
  const original = await readSources()
  const checkBrief = async (done: number, total: number) => {
    const before = await readSources()
    const response = await app.request('/coach/brief')
    assert.equal(response.status, 200)
    const { brief } = await response.json()
    assert.equal(brief.reviewDate, '2026-10-06')
    assert.equal(brief.generatedAt, now.toISOString())
    assert.deepEqual(brief.yesterdayReview.habits, { done, total }, 'preserve the existing API shape, including total')
    assert.deepEqual(await readSources(), before, 'GET preserves full source records and historical insights')
  }
  await checkBrief(1, 2)
  // Explicit synthetic fixture correction; GET itself never mutates the stored facts.
  const correctedAt = new Date('2026-10-07T04:01:00Z')
  await prisma.habitCheckin.update({ where: { id: 'recap-tuesday' }, data: { done: false, updatedAt: correctedAt } })
  await checkBrief(0, 2)
  const corrected = await readSources()
  assert.deepEqual(corrected.checkins, original.checkins.map(row => row.id === 'recap-tuesday' ? { ...row, done: false, updatedAt: correctedAt } : row))
  await prisma.habit.update({ where: { id: 'recap-one' }, data: { frequency: 'daily' } })
  await prisma.habit.create({ data: { ...habits[0], id: 'recap-new-plan', name: 'New synthetic plan', sortOrder: 2 } })
  await checkBrief(0, 3)
  assert.deepEqual((await readSources()).checkins, corrected.checkins, 'current frequency and new plans preserve both Monday facts and the dated false record')
  assert.equal(providerFetch.mock.callCount(), 0)
})
