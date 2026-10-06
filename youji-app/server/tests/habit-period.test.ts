import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { addDays } from '../src/utils/date.js'

const directory = await mkdtemp(resolve(tmpdir(), 'youtrace-habit-period-'))
const databasePath = resolve(directory, 'synthetic.db')
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${databasePath}`
process.env.JWT_SECRET = 'synthetic-habit-period-secret-at-least-32-characters'
const { prisma } = await import('../src/utils/db.js')
const { habitRoutes } = await import('../src/routes/habits.js')
const { computeHabitStats } = await import('../src/services/habitStats.js')
const app = new Hono<{ Variables: { user: { id: string } } }>()
app.use('*', async (c, next) => { c.set('user', { id: 'habit-owner' }); await next() })
app.route('/habits', habitRoutes)
const today = '2026-10-07'
before(async () => {
  const migrations = resolve('prisma/migrations'), fixture = new DatabaseSync(databasePath, { enableDoubleQuotedStringLiterals: true })
  try { for (const row of (await readdir(migrations, { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name).sort()) fixture.exec(await readFile(resolve(migrations, row, 'migration.sql'), 'utf8')) } finally { fixture.close() }
  for (const id of ['habit-owner', 'other-owner']) await prisma.user.create({ data: { id, phone: `synthetic-${id}`, nickname: 'Synthetic' } })
  for (const [id, userId, frequency] of [['weekly', 'habit-owner', 'weekly'], ['daily', 'habit-owner', 'daily'], ['foreign', 'other-owner', 'weekly']]) await prisma.habit.create({ data: { id, userId, frequency, name: 'Same synthetic habit', icon: '📚', createdAt: new Date(`${today}T12:00:00+08:00`) } })
  await prisma.habitCheckin.createMany({ data: [
    { id: 'past-week', habitId: 'weekly', date: '2026-10-04', done: true }, { id: 'tuesday', habitId: 'weekly', date: '2026-10-06', done: true }, { id: 'future', habitId: 'weekly', date: '2026-10-08', done: true },
    { id: 'foreign-check', habitId: 'foreign', date: '2026-10-06', done: true },
    ...Array.from({ length: 75 }, (_, i) => ({ id: `daily-${i}`, habitId: 'daily', date: addDays(today, -i), done: true })),
  ] })
})
after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }) })
test('actual API separates this week from today and retains Tuesday before audit-createdAt', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${today}T12:00:00+08:00`) })
  const response = await app.request('/habits'), { habits } = await response.json()
  assert.equal(response.status, 200); assert.equal(habits.length, 2)
  const row = habits.find((item: { id: string }) => item.id === 'weekly')
  assert.equal(row.done, false); assert.equal(row.streak, 0)
  assert.deepEqual(row.period, { frequency: 'weekly', start: '2026-10-05', end: '2026-10-11', attained: true, completedDates: ['2026-10-06'] })
  assert.equal(row.recentCheckins.find((item: { date: string }) => item.date === '2026-10-06').done, true)
})
test('actual query returns all seventy-five daily facts and cannot include another owner', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${today}T12:00:00+08:00`) })
  const stats = await computeHabitStats('habit-owner', ['daily', 'foreign'])
  assert.equal(stats.size, 1); assert.equal(stats.get('daily')?.streak, 75); assert.equal(stats.has('foreign'), false)
})
test('undo the sole current-week fact drops attainment without affecting prior/future records', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${today}T12:00:00+08:00`) })
  await prisma.habitCheckin.update({ where: { id: 'tuesday' }, data: { done: false } })
  const stats = await computeHabitStats('habit-owner', ['weekly'])
  assert.equal(stats.get('weekly')?.period.attained, false)
  assert.equal((await prisma.habitCheckin.findUniqueOrThrow({ where: { id: 'past-week' } })).done, true)
  assert.equal((await prisma.habitCheckin.findUniqueOrThrow({ where: { id: 'future' } })).done, true)
})

test('actual coach prompt and rule reply keep weekly attainment distinct from today and avoid daily pressure', async () => {
  const { buildCoachSystemPrompt, generateFallbackResponse } = await import('../src/routes/chat.js')
  const ctx = { recentExpenses: { total: 0, count: 0, categories: {}, period: { kind: 'rolling-seven-days' as const, start: '2026-10-01', end: today } }, recentTodos: [], recentDiary: [], schedules: [], habits: [
    { name: 'Synthetic weekly reading', frequency: 'weekly', done: false, streak: 0, todayDate: today, period: { start: '2026-10-05', end: '2026-10-11', attained: true, completedDates: ['2026-10-06'] } },
  ] }
  const prompt = buildCoachSystemPrompt('gentle', ctx), reply = generateFallbackResponse('习惯', ctx)
  for (const text of [prompt, reply.content]) { assert.match(text, /本周已完成/); assert.match(text, /2026-10-06/); assert.match(text, /今天 2026-10-07未打卡/); assert.doesNotMatch(text, /Synthetic weekly reading❌/) }
  assert.ok(reply.actions.every(action => action.type !== 'check_habit'))
  ctx.habits.push({ name: 'Synthetic daily walk', frequency: 'daily', done: false, streak: 0, todayDate: today, period: { start: today, end: today, attained: false, completedDates: [] } })
  const mixed = generateFallbackResponse('打卡', ctx)
  assert.match(mixed.content, /每日习惯：今天已记录 0\/1.*每周习惯：本周已完成 1\/1/)
  assert.deepEqual(mixed.actions.map(action => action.name), ['Synthetic daily walk'])
})
