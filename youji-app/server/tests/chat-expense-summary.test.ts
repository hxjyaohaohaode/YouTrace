import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'

const directory = await mkdtemp(resolve(tmpdir(), 'youtrace-chat-expense-summary-'))
const databasePath = resolve(directory, 'synthetic.db')
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${databasePath}`
process.env.JWT_SECRET = 'synthetic-expense-summary-secret-at-least-32-characters'
process.env.LLM_API_KEY = ''
const { prisma } = await import('../src/utils/db.js')
const { chatRoutes, buildCoachSystemPrompt } = await import('../src/routes/chat.js')
const { coachRoutes } = await import('../src/routes/coach.js')
const { expenseRoutes } = await import('../src/routes/expenses.js')
const owner = 'synthetic-summary-owner'
const otherOwner = 'synthetic-summary-other'
const today = '2026-10-07'
const app = new Hono<{ Variables: { user: { id: string } } }>()
app.use('*', async (c, next) => { c.set('user', { id: owner }); await next() })
app.route('/chat', chatRoutes)
app.route('/coach', coachRoutes)
app.route('/expenses', expenseRoutes)

before(async () => {
  const migrations = resolve('prisma/migrations')
  const fixture = new DatabaseSync(databasePath, { enableDoubleQuotedStringLiterals: true })
  try {
    for (const name of (await readdir(migrations, { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name).sort()) {
      fixture.exec(await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'))
    }
  } finally { fixture.close() }
  for (const id of [owner, otherOwner]) await prisma.user.create({ data: { id, phone: id, nickname: 'Synthetic' } })
})
beforeEach(async () => { await prisma.expense.deleteMany(); await prisma.insight.deleteMany() })
after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }) })

const expense = (id: string, date: string, amount: number, category: string, isIncome = false, userId = owner) => ({ id, userId, date, amount, category, isIncome, name: `Synthetic ${id}` })

async function ask(message: string, sessionId?: string) {
  const response = await app.request('/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sessionId }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8')
  const actualSession = response.headers.get('X-Session-Id')
  assert.ok(actualSession)
  if (sessionId) assert.equal(actualSession, sessionId)
  const body = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer())
  const frames = body.split('\n\n')
  assert.equal(frames.pop(), '')
  assert.equal(frames.pop(), 'data: [DONE]')
  assert.equal(frames.length, 2)
  const [reply, actions] = frames.map(frame => { assert.ok(frame.startsWith('data: ')); return JSON.parse(frame.slice(6)) })
  assert.equal(reply.source, 'rule_fallback')
  assert.deepEqual(actions.actions[0], { type: 'navigate', path: '/expense', label: '查看花销明细' })
  const saved = await prisma.chatMessage.findMany({ where: { sessionId: actualSession } })
  const savedReply = saved.find(row => row.role === 'assistant' && row.content === reply.content)
  assert.ok(savedReply)
  assert.equal(savedReply.actions, JSON.stringify(actions.actions))
  assert.ok(saved.some(row => row.role === 'user' && row.content === message))
  const history = await app.request(`/chat/sessions/${actualSession}/messages`)
  assert.equal(history.status, 200)
  assert.ok((await history.json()).messages.some((row: { id: string; content: string }) => row.id === savedReply.id && row.content === reply.content))
  return { sessionId: actualSession, content: reply.content as string, saved }
}

async function brief() {
  const response = await app.request('/coach/brief')
  assert.equal(response.status, 200)
  return (await response.json()).brief
}

test('actual expense queries distinguish natural week and rolling seven days, and refresh after one same-ID correction', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T04:00:00Z') })
  const providerFetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider request') })
  await prisma.expense.createMany({ data: [
    expense('yesterday', '2026-10-06', 5025, 'food'),
    expense('today', today, 207, 'transport'),
    expense('monday', '2026-10-05', 101, 'food'),
    expense('sunday', '2026-10-04', 321, 'daily'),
    expense('rolling-start', '2026-10-01', 109, 'other'),
    expense('before-rolling', '2026-09-30', 887, 'food'),
    expense('future', '2026-10-08', 889, 'food'),
    expense('income', '2026-10-06', 100000, 'food', true),
    expense('legacy-income', '2026-10-06', 200000, 'income'),
    expense('other-account', '2026-10-06', 99999, 'food', false, otherOwner),
  ] })
  await prisma.insight.create({ data: {
    id: 'historical-summary', userId: owner, type: 'pattern', title: '历史观察', description: '原始金额 ¥50.25',
    dataSources: '["expense"]', createdAt: new Date('2026-09-01T04:00:00Z'),
  } })
  const sourceBefore = await prisma.expense.findMany({ orderBy: { id: 'asc' } })
  const historicalBefore = await prisma.insight.findMany()
  const listed = await app.request('/expenses')
  assert.equal(listed.status, 200)
  const { expenses } = await listed.json()
  assert.equal(expenses.length, 9)
  assert.equal(expenses.find((row: { id: string }) => row.id === 'yesterday').amount, 5025)
  assert.ok(!expenses.some((row: { id: string }) => row.id === 'other-account'))

  let sessionId: string | undefined
  for (const message of ['看看这周的花销', '看看本周花销', '看看自然周的消费', '看看近7天的花销', '看看最近7天的花销', '看看花销']) {
    const result = await ask(message, sessionId)
    sessionId = result.sessionId
    const natural = /这周|本周|自然周/.test(message)
    assert.match(result.content, natural
      ? /本周（自然周） 2026-10-05 至 2026-10-07\n已记录支出 ¥53\.33，共3笔/
      : /近7天 2026-10-01 至 2026-10-07\n已记录支出 ¥57\.63，共5笔/)
    assert.match(result.content, /餐饮 ¥51\.26、交通 ¥2\.07|餐饮 ¥51\.26、日用 ¥3\.21、交通 ¥2\.07、其他 ¥1\.09/)
    if (natural) assert.doesNotMatch(result.content, /日用|其他|近7天/)
    else { assert.match(result.content, /日用 ¥3\.21/); assert.match(result.content, /其他 ¥1\.09/) }
    assert.doesNotMatch(result.content, /\b(food|transport|daily|other|income)\b/)
  }
  const beforeBrief = await brief()
  assert.equal(beforeBrief.reviewDate, '2026-10-06')
  assert.equal(beforeBrief.generatedAt, '2026-10-07T04:00:00.000Z')
  assert.equal(beforeBrief.yesterdayReview.spent, 50.25)
  assert.equal(beforeBrief.yesterdayReview.expenseCount, 1)
  assert.deepEqual(await prisma.expense.findMany({ orderBy: { id: 'asc' } }), sourceBefore)
  assert.deepEqual(await prisma.insight.findMany(), historicalBefore)
  const messagesBefore = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { id: 'asc' } })

  // Synthetic source correction only; native edit/ACK is verified by the separate browser task.
  const original = sourceBefore.find(row => row.id === 'yesterday')!
  await prisma.expense.update({ where: { id: original.id }, data: { amount: 4025 } })
  const corrected = await prisma.expense.findUniqueOrThrow({ where: { id: original.id } })
  assert.deepEqual(corrected, { ...original, amount: 4025, updatedAt: corrected.updatedAt })
  const correctedList = await app.request('/expenses')
  assert.equal((await correctedList.json()).expenses.find((row: { id: string }) => row.id === original.id).amount, 4025)
  assert.match((await ask('这周花销', sessionId)).content, /本周（自然周） 2026-10-05 至 2026-10-07\n已记录支出 ¥43\.33，共3笔[\s\S]*餐饮 ¥41\.26、交通 ¥2\.07/)
  assert.match((await ask('近7天花销', sessionId)).content, /近7天 2026-10-01 至 2026-10-07\n已记录支出 ¥47\.63，共5笔[\s\S]*餐饮 ¥41\.26、日用 ¥3\.21、交通 ¥2\.07、其他 ¥1\.09/)
  const afterBrief = await brief()
  assert.equal(afterBrief.yesterdayReview.spent, 40.25)
  assert.equal(afterBrief.yesterdayReview.expenseCount, 1)
  assert.equal(afterBrief.reviewDate, beforeBrief.reviewDate)
  assert.equal(afterBrief.generatedAt, beforeBrief.generatedAt)
  assert.deepEqual(await prisma.expense.findMany({ orderBy: { id: 'asc' } }), sourceBefore.map(row => row.id === corrected.id ? corrected : row))
  assert.deepEqual(await prisma.insight.findMany(), historicalBefore)
  assert.deepEqual(await prisma.chatMessage.findMany({ where: { id: { in: messagesBefore.map(row => row.id) } }, orderBy: { id: 'asc' } }), messagesBefore)
  assert.equal(providerFetch.mock.callCount(), 0)
})

test('unknown source categories aggregate as other without rewriting source records, and empty periods stay explicit', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T04:00:00Z') })
  const providerFetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider request') })
  await prisma.expense.createMany({ data: [
    expense('unknown-one', '2026-10-04', 201, 'legacy-custom'),
    expense('unknown-two', '2026-10-04', 302, '__proto__'),
    expense('other', '2026-10-01', 109, 'other'),
  ] })
  const original = await prisma.expense.findMany({ orderBy: { id: 'asc' } })
  const rolling = await ask('最近7天花销')
  assert.match(rolling.content, /已记录支出 ¥6\.12，共3笔/)
  assert.match(rolling.content, /支出分类：其他 ¥6\.12。/)
  assert.doesNotMatch(rolling.content, /legacy-custom|__proto__/)
  const natural = await ask('本周花销', rolling.sessionId)
  assert.match(natural.content, /本周（自然周） 2026-10-05 至 2026-10-07\n已记录支出 ¥0\.00，共0笔/)
  assert.match(natural.content, /支出分类：暂无数据/)
  const emptyBrief = await brief()
  assert.equal(emptyBrief.yesterdayReview.spent, 0)
  assert.equal(emptyBrief.yesterdayReview.expenseCount, 0)
  assert.deepEqual(await prisma.expense.findMany({ orderBy: { id: 'asc' } }), original)
  assert.equal(providerFetch.mock.callCount(), 0)
})

test('model context describes exact queried period, cents, count and every Chinese category without provider calls', () => {
  for (const kind of ['natural-week', 'rolling-seven-days'] as const) {
    const natural = kind === 'natural-week'
    const categories: Record<string, number> = natural ? { food: 5126, transport: 207 } : { food: 5126, transport: 207, daily: 321, other: 109 }
    const prompt = buildCoachSystemPrompt('data', {
      recentExpenses: { total: natural ? 5333 : 5763, count: natural ? 3 : 5, categories, period: { kind, start: natural ? '2026-10-05' : '2026-10-01', end: today } },
      habits: [], recentTodos: [], recentDiary: [], schedules: [],
    })
    assert.match(prompt, kind === 'natural-week' ? /本周（自然周） 2026-10-05 至 2026-10-07/ : /近7天 2026-10-01 至 2026-10-07/)
    assert.match(prompt, natural ? /已记录支出 ¥53\.33，共3笔/ : /已记录支出 ¥57\.63，共5笔/)
    assert.match(prompt, natural ? /支出分类：餐饮 ¥51\.26、交通 ¥2\.07\n/ : /支出分类：餐饮 ¥51\.26、交通 ¥2\.07、日用 ¥3\.21、其他 ¥1\.09/)
    assert.match(prompt, /金额保留两位小数/)
  }
})
