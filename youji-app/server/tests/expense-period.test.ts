import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'

const directory = await mkdtemp(resolve(tmpdir(), 'youtrace-expense-period-'))
const databasePath = resolve(directory, 'synthetic.db')
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${databasePath}`
const { prisma } = await import('../src/utils/db.js')
const { expenseRoutes } = await import('../src/routes/expenses.js')
const app = new Hono<{ Variables: { user: { id: string } } }>()
app.use('*', async (c, next) => { c.set('user', { id: 'expense-owner' }); await next() })
app.route('/expenses', expenseRoutes)

before(async () => {
  const migrations = resolve('prisma/migrations')
  const fixture = new DatabaseSync(databasePath, { enableDoubleQuotedStringLiterals: true })
  try {
    for (const name of (await readdir(migrations, { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name).sort()) {
      fixture.exec(await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'))
    }
  } finally { fixture.close() }
  await prisma.user.create({ data: { id: 'expense-owner', phone: 'synthetic-expense-owner', nickname: 'Synthetic' } })
  const row = (id: string, date: string, amount: number, isIncome = false) => ({ id, date, amount, isIncome, userId: 'expense-owner', name: 'Synthetic ordinary record', category: 'other' })
  await prisma.expense.createMany({ data: [
    row('today', '2026-10-07', 1234), row('tuesday', '2026-10-06', 1234), row('sunday', '2026-10-04', 321),
    row('future', '2026-10-08', 567), row('today-income', '2026-10-07', 10001, true), row('tuesday-income', '2026-10-06', 1002, true),
    row('future-income', '2026-10-08', 2222, true), row('past-start', '2026-09-01', 101), row('past-end', '2026-09-30', 456),
    row('past-income', '2026-09-30', 789, true), row('next-month', '2026-11-01', 678), row('next-month-income', '2026-11-01', 901, true),
  ] })
})
after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }) })

test('actual stats query includes current-month and natural-week spending only through server today', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T04:00:00Z') })
  const beforeRows = await prisma.expense.findMany({ orderBy: { id: 'asc' } })
  const response = await app.request('/expenses/stats')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { today: 1234, week: 2468, month: 2789, count: 3, income: 11003 })
  const listed = await app.request('/expenses')
  const { expenses } = await listed.json()
  assert.equal(expenses.length, 12)
  assert.equal(expenses.find((row: { id: string }) => row.id === 'future').amount, 567)
  assert.deepEqual(await prisma.expense.findMany({ orderBy: { id: 'asc' } }), beforeRows)
})

test('selected past month remains complete and selected future month has zero recorded totals', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T04:00:00Z') })
  const past = await app.request('/expenses/stats?month=2026-09')
  assert.deepEqual(await past.json(), { today: 0, week: 2468, month: 557, count: 2, income: 789 })
  const future = await app.request('/expenses/stats?month=2026-11')
  assert.deepEqual(await future.json(), { today: 0, week: 2468, month: 0, count: 0, income: 0 })
  const listing = await app.request('/expenses?month=2026-11')
  assert.equal((await listing.json()).expenses.length, 2)
})
