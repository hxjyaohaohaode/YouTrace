import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'

// This suite never accepts an external DATABASE_URL or touches a deployed database.
let fixtureDir: string
let databasePath: string
let prisma: Awaited<typeof import('../src/utils/db.js')>['prisma']
let app: Hono
let nextId = 0
const id = (prefix = 'fixture') => `${prefix}-${++nextId}`
type Event = { seq: string; entity: string; entityId: string; operation: string; data: Record<string, unknown> | null }
type Page = { protocol: number; events: Event[]; nextCursor: string; hasMore: boolean }
type Ack = { acknowledged: boolean; mutationId: string; versions: Array<{ entity: string; entityId: string; seq: string }>; synced: Record<string, number> }

function request(userId: string, path: string, body?: unknown, method = 'POST') {
  return app.request(path, { method, headers: { 'X-Fixture-User': userId, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}
function push(userId: string, payload: Record<string, unknown>, mutationId = id('mutation')) {
  return request(userId, '/sync/push', { protocol: 2, mutationId, ...payload })
}
async function pull(userId: string, cursor = '0', limit = 500): Promise<Page> {
  const response = await request(userId, `/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=${limit}`, undefined, 'GET')
  assert.equal(response.status, 200, await response.clone().text())
  return response.json() as Promise<Page>
}
async function allChanges(userId: string, limit = 500) {
  let cursor = '0'
  const events: Event[] = []
  for (;;) {
    const page = await pull(userId, cursor, limit)
    assert.equal(page.protocol, 2)
    for (const event of page.events) {
      assert.ok(BigInt(event.seq) > BigInt(cursor))
      cursor = event.seq
      events.push(event)
    }
    assert.equal(page.nextCursor, cursor)
    if (!page.hasMore) return events
  }
}
async function user(prefix = 'owner') {
  const userId = id(prefix)
  await prisma.user.create({ data: { id: userId, phone: id('phone'), nickname: 'Synthetic fixture only' } })
  return userId
}
async function version(userId: string, entity: string, entityId: string) {
  const row = await prisma.syncChange.findFirstOrThrow({ where: { userId, entity, entityId }, orderBy: { seq: 'desc' } })
  return row.seq.toString()
}

before(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'youtrace-sync-v2-test-'))
  databasePath = join(fixtureDir, 'synthetic.db')
  process.env.DATABASE_URL = `file:${databasePath}`
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'sync-test-secret-at-least-thirty-two-characters'
  const db = new DatabaseSync(databasePath, { enableDoubleQuotedStringLiterals: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const migrationsDir = resolve('prisma/migrations')
  for (const name of (await readdir(migrationsDir)).sort()) {
    if (name === 'migration_lock.toml') continue
    if (name === '20261004000000_sync_v2_ledger') {
      db.exec(`INSERT INTO "User" (id,phone,nickname,updatedAt) VALUES ('backfill-owner','backfill-phone','Synthetic',0);
        INSERT INTO "Todo" (id,userId,text,updatedAt) VALUES ('backfill-todo','backfill-owner','Preserve before upgrade',0);
        INSERT INTO "Schedule" (id,userId,title,date,startTime,endTime,updatedAt) VALUES ('backfill-schedule','backfill-owner','Plan','2026-10-04','10:00','11:00',0);
        INSERT INTO "Expense" (id,userId,amount,category,name,date) VALUES ('backfill-expense','backfill-owner',100,'other','Expense','2026-10-04');
        INSERT INTO "Habit" (id,userId,name,icon) VALUES ('backfill-habit','backfill-owner','Habit','H');
        INSERT INTO "HabitCheckin" (id,habitId,date) VALUES ('backfill-checkin','backfill-habit','2026-10-04');
        INSERT INTO "QuickNote" (id,userId,content,timestamp,parsed) VALUES ('backfill-note','backfill-owner','Note',0,'{}');
        INSERT INTO "Diary" (id,userId,date,content,updatedAt) VALUES ('backfill-diary','backfill-owner','2026-10-04','Diary',0);`)
    }
    const migration = await readFile(resolve(migrationsDir, name, 'migration.sql'), 'utf8')
    // Native SQLite parses complete trigger bodies; never split migrations on semicolons.
    db.exec(migration)
  }
  db.close()
  ;({ prisma } = await import('../src/utils/db.js'))
  const [{ syncRoutes }, { todoRoutes }, { scheduleRoutes }, { expenseRoutes }, { habitRoutes }, { diaryRoutes }, { quickNoteRoutes }, { userRoutes }] = await Promise.all([
    import('../src/routes/sync.js'), import('../src/routes/todos.js'), import('../src/routes/schedules.js'), import('../src/routes/expenses.js'),
    import('../src/routes/habits.js'), import('../src/routes/diary.js'), import('../src/routes/quickNotes.js'), import('../src/routes/user.js'),
  ])
  app = new Hono()
  app.use('*', async (c, next) => {
    const userId = c.req.header('X-Fixture-User') ?? ''
    c.set('user', { id: userId, phone: 'synthetic' })
    await next()
  })
  app.route('/sync', syncRoutes).route('/todos', todoRoutes).route('/schedules', scheduleRoutes).route('/expenses', expenseRoutes)
    .route('/habits', habitRoutes).route('/diary', diaryRoutes).route('/quick-notes', quickNoteRoutes).route('/user', userRoutes)
})
after(async () => {
  if (prisma) await prisma.$disconnect()
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true })
})

test('additive migration backfills existing rows and rejects the lossy v1 protocol', async () => {
  assert.equal((await request('backfill-owner', '/sync/pull?protocol=2&cursor=0', undefined, 'GET')).status, 426, 'old goal-unaware clients get explicit upgrade rather than an unknown event')
  const events = await allChanges('backfill-owner')
  assert.equal(events.length, 7)
  assert.equal(new Set(events.map((event) => event.entity)).size, 7)
  assert.equal(events.find((event) => event.entity === 'todos')?.data?.text, 'Preserve before upgrade')
  assert.equal((await request('backfill-owner', '/sync/pull?since=1970-01-01', undefined, 'GET')).status, 426)
  assert.equal((await request('backfill-owner', '/sync/push', { todos: [] })).status, 503)
  assert.equal((await push('backfill-owner', { goals: [{ id: 'ignored-goal' }] })).status, 400)
  assert.equal((await push('backfill-owner', { todos: [{ id: 'invalid-version', text: 'Invalid', baseVersion: 'not-an-integer' }] })).status, 400)
  assert.equal((await request('backfill-owner', '/sync/pull?protocol=2&features=goals-v1&cursor=garbage', undefined, 'GET')).status, 400)
  assert.equal((await request('backfill-owner', '/sync/pull?protocol=2&features=goals-v1&cursor=9223372036854775808', undefined, 'GET')).status, 400)
})

test('100, 2000, 2001 and 10001 equal-timestamp rows paginate without loss, including writes between pages', async () => {
  for (const count of [100, 2000, 2001, 10001]) {
    const owner = await user(`page${count}`)
    const timestamp = new Date('2026-01-01T00:00:00.000Z')
    // createMany exercises trigger execution for every row, not a hand-built fake feed.
    for (let start = 0; start < count; start += 500) {
      await prisma.todo.createMany({ data: Array.from({ length: Math.min(500, count - start) }, (_, offset) => ({
        id: `${owner}-todo-${start + offset}`, userId: owner, text: `Synthetic ${start + offset}`, createdAt: timestamp, updatedAt: timestamp,
      })) })
    }
    const first = await pull(owner, '0', 137)
    const newId = `${owner}-after-page`
    await prisma.todo.create({ data: { id: newId, userId: owner, text: 'Between pages', updatedAt: timestamp } })
    const seen = [...first.events]
    let cursor = first.nextCursor
    for (;;) {
      const page = await pull(owner, cursor, 2000)
      seen.push(...page.events)
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    assert.equal(seen.length, count + 1)
    assert.equal(new Set(seen.map((event) => event.entityId)).size, count + 1)
    assert.equal(seen.at(-1)?.entityId, newId)
    const empty = await pull(owner, cursor)
    assert.equal(empty.nextCursor, cursor)
    assert.deepEqual(empty.events, [])
    assert.equal(empty.hasMore, false)
    assert.ok(seen.every((event) => event.data?.userId === owner))
  }
})

test('push receipts are durable, exact, atomic and safe after response loss', async () => {
  const owner = await user()
  const todoId = id('receipt-todo')
  const mutationId = id('lost-response')
  const body = { todos: [{ id: todoId, text: 'First draft', baseVersion: '0' }] }
  const first = await push(owner, body, mutationId)
  assert.equal(first.status, 200, await first.clone().text())
  const ack = await first.json() as Ack
  assert.equal(ack.acknowledged, true)
  assert.equal(ack.mutationId, mutationId)
  assert.equal(ack.synced.todos, 1)
  assert.match(ack.versions[0].seq, /^[1-9][0-9]*$/)
  const replay = await push(owner, body, mutationId)
  assert.equal(replay.status, 200)
  assert.deepEqual(await replay.json(), ack)
  assert.equal(await prisma.syncChange.count({ where: { userId: owner } }), 1)
  const updated = await push(owner, { todos: [{ id: todoId, text: 'Second draft', baseVersion: ack.versions[0].seq }] })
  assert.equal(updated.status, 200)
  assert.deepEqual(await (await push(owner, body, mutationId)).json(), ack, 'replay returns original receipt, not new state')
  const reused = await push(owner, { todos: [{ id: todoId, text: 'Different payload' }] }, mutationId)
  assert.equal(reused.status, 409)
  assert.equal((await reused.json()).code, 'MUTATION_ID_REUSED')
  const stale = await push(owner, { todos: [{ id: todoId, text: 'Offline older draft', baseVersion: ack.versions[0].seq }] })
  assert.equal(stale.status, 409)
  assert.equal((await prisma.todo.findUniqueOrThrow({ where: { id: todoId } })).text, 'Second draft')
  const foreign = await user('other')
  assert.equal((await push(foreign, { todos: [{ id: todoId, text: 'Owner bypass' }] })).status, 403)
  assert.equal((await push(foreign, { deletions: { todoIds: [{ id: todoId, baseVersion: ack.versions[0].seq }] } })).status, 403)
  assert.deepEqual(await allChanges(foreign), [])
})

test('missing parents and diary collisions reject the whole batch and preserve both originals', async () => {
  const owner = await user()
  const todoId = id('rollback-todo')
  const orphan = await push(owner, { todos: [{ id: todoId, text: 'Must roll back' }], habitCheckins: [{ habitId: 'missing-habit', date: '2026-10-04' }] })
  assert.equal(orphan.status, 409)
  assert.equal((await orphan.json()).code, 'MISSING_PARENT')
  assert.equal(await prisma.todo.findUnique({ where: { id: todoId } }), null)
  assert.equal(await prisma.syncReceipt.count({ where: { userId: owner } }), 0)
  assert.equal(await prisma.syncChange.count({ where: { userId: owner } }), 0)
  const diaryA = id('diary-a'), diaryB = id('diary-b')
  assert.equal((await push(owner, { diaries: [{ id: diaryA, date: '2026-10-04', content: 'Original A' }] })).status, 200)
  const originalB = { id: diaryB, date: '2026-10-04', content: 'Unmerged original B' }
  const conflict = await push(owner, { diaries: [originalB], todos: [{ id: todoId, text: 'Also rolls back' }] })
  assert.equal(conflict.status, 409)
  const error = await conflict.json()
  assert.equal(error.acknowledged, false)
  assert.equal(error.code, 'DIARY_DATE_CONFLICT')
  assert.equal(error.conflict.conflictingId, diaryA)
  assert.equal((await prisma.diary.findUniqueOrThrow({ where: { id: diaryA } })).content, 'Original A')
  assert.equal(originalB.content, 'Unmerged original B')
  assert.equal(await prisma.diary.count({ where: { userId: owner } }), 1)
  assert.equal(await prisma.todo.findUnique({ where: { id: todoId } }), null)
  const history = await allChanges(owner)
  assert.equal(history.length, 1)
  assert.equal(history[0].data?.content, 'Original A')
})

test('deletions propagate, unknown IDs are tombstoned, and stale offline edits cannot resurrect records', async () => {
  const owner = await user()
  const todoId = id('delete-todo')
  await prisma.todo.create({ data: { id: todoId, userId: owner, text: 'Will delete' } })
  const staleVersion = await version(owner, 'todos', todoId)
  assert.equal((await push(owner, { deletions: { todoIds: [{ id: todoId }] } })).status, 409)
  const mutationId = id('delete-mutation')
  const body = { deletions: { todoIds: [{ id: todoId, baseVersion: staleVersion }] } }
  assert.equal((await push(owner, body, mutationId)).status, 200)
  assert.equal((await push(owner, body, mutationId)).status, 200)
  assert.equal((await push(owner, body)).status, 200, 'already deleted is a confirmed idempotent delete')
  const stale = await push(owner, { todos: [{ id: todoId, text: 'Resurrection attempt', baseVersion: staleVersion }] })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).code, 'ENTITY_DELETED')
  await assert.rejects(prisma.todo.create({ data: { id: todoId, userId: owner, text: 'REST/raw writer bypass attempt' } }))
  assert.equal(await prisma.todo.findUnique({ where: { id: todoId } }), null)
  const events = await allChanges(owner, 1)
  assert.deepEqual(events.map((event) => event.operation), ['upsert', 'delete'])
  assert.equal(events[1].data, null)
  const unknownId = id('never-arrived')
  assert.equal((await push(owner, { deletions: { todoIds: [{ id: unknownId, baseVersion: '0' }] } })).status, 200)
  assert.equal((await push(owner, { todos: [{ id: unknownId, text: 'Late first create' }] })).status, 409)
})

test('habit and checkin batches use logical IDs and parent deletion tombstones every child', async () => {
  const owner = await user()
  const habitId = id('logical-habit'), date = '2026-10-04'
  const create = await push(owner, { habits: [{ id: habitId, name: 'Synthetic habit', icon: 'H' }], habitCheckins: [{ habitId, date, done: true, confirmed: false }] })
  assert.equal(create.status, 200)
  const ack = await create.json() as Ack
  const child = ack.versions.find((row) => row.entity === 'habitCheckins')!
  assert.equal(child.entityId, `${habitId}|${date}`)
  assert.equal((await prisma.habitCheckin.findUniqueOrThrow({ where: { habitId_date: { habitId, date } } })).confirmed, false)
  const toggle = await push(owner, { habitCheckins: [{ habitId, date, done: false, baseVersion: child.seq }] })
  assert.equal(toggle.status, 200)
  const changes = await allChanges(owner)
  assert.equal(changes[2].data?.done, false)
  assert.equal(changes[2].entityId, child.entityId)
  const remove = await push(owner, { deletions: { habitIds: [{ id: habitId, baseVersion: ack.versions.find((row) => row.entity === 'habits')!.seq }] } })
  assert.equal(remove.status, 200)
  const deleted = (await allChanges(owner)).slice(-2)
  assert.deepEqual(deleted.map((event) => [event.entity, event.operation]), [['habitCheckins', 'delete'], ['habits', 'delete']])
  assert.equal(await prisma.syncTombstone.count({ where: { userId: owner } }), 2)
  assert.equal((await push(owner, { habits: [{ id: habitId, name: 'Revive', icon: 'H' }] })).status, 409)
  assert.equal((await push(owner, { habitCheckins: [{ habitId, date }] })).status, 409)
})

test('every REST mutation path, including raw SQL and batch writes, enters the same ledger', async () => {
  const owner = await user('rest')
  async function call(path: string, body: unknown, method: string, expectedChanges: number) {
    const before = await prisma.syncChange.count({ where: { userId: owner } })
    const response = await request(owner, path, body, method)
    assert.ok(response.status >= 200 && response.status < 300, `${method} ${path}: ${await response.clone().text()}`)
    assert.equal(await prisma.syncChange.count({ where: { userId: owner } }), before + expectedChanges, `${method} ${path}`)
    return response.json()
  }
  const { todo } = await call('/todos', { text: 'REST todo' }, 'POST', 1)
  await call(`/todos/${todo.id}`, { text: 'REST updated' }, 'PUT', 1)
  await call(`/todos/${todo.id}/toggle`, {}, 'PATCH', 1)
  await call(`/todos/${todo.id}`, undefined, 'DELETE', 1)
  const { schedule } = await call('/schedules', { title: 'REST schedule', date: '2026-10-04', startTime: '10:00', endTime: '11:00' }, 'POST', 1)
  await call(`/schedules/${schedule.id}`, { title: 'Updated schedule' }, 'PUT', 1)
  await call(`/schedules/${schedule.id}`, undefined, 'DELETE', 1)
  const expense = { amount: 100, category: 'other', name: 'Synthetic', date: '2026-10-04' }
  const { expense: exp } = await call('/expenses', expense, 'POST', 1)
  await call('/expenses/batch', { items: [expense, expense] }, 'POST', 2)
  await call(`/expenses/${exp.id}`, undefined, 'DELETE', 1)
  const { habit } = await call('/habits', { name: 'REST habit' }, 'POST', 1)
  await call(`/habits/${habit.id}/check`, { date: '2026-10-04', done: true }, 'PATCH', 1)
  await call(`/habits/${habit.id}/check`, { date: '2026-10-04', done: false }, 'PATCH', 1)
  await call(`/habits/${habit.id}`, undefined, 'DELETE', 2)
  const { diary } = await call('/diary', { date: '2026-10-04', content: 'REST diary' }, 'POST', 1)
  await call(`/diary/${diary.id}`, { content: 'Updated REST diary' }, 'PUT', 1)
  await call(`/diary/${diary.id}`, undefined, 'DELETE', 1)
  const { note } = await call('/quick-notes', { content: 'Synthetic note', timestamp: 1_700_000_000_000 }, 'POST', 1)
  await call(`/quick-notes/${note.id}/confirm`, { confirmed: true }, 'PUT', 1)
  await call(`/quick-notes/${note.id}`, undefined, 'DELETE', 1)
  const events = await allChanges(owner, 3)
  assert.deepEqual(new Set(events.map((event) => event.entity)), new Set(['todos', 'schedules', 'expenses', 'habits', 'habitCheckins', 'diaries', 'quickNotes']))
  assert.equal(events.filter((event) => event.operation === 'delete').length, 7)
  assert.equal(events.find((event) => event.entity === 'quickNotes')?.data?.timestamp, 1_700_000_000_000)
  assert.equal(typeof events.find((event) => event.entity === 'quickNotes')?.data?.parsed, 'object')
})

test('mixed-entity sync writes and atomic rollback never leave partial ACKs or feed events', async () => {
  const owner = await user('mixed')
  const habitId = id('mixed-habit')
  const body = {
    schedules: [{ id: id('mixed-schedule'), title: 'Plan', date: '2026-10-05', startTime: '10:00', endTime: '11:00' }],
    expenses: [{ id: id('mixed-expense'), amount: 100, category: 'other', name: 'Synthetic', date: '2026-10-05' }],
    todos: [{ id: id('mixed-todo'), text: 'Task' }], habits: [{ id: habitId, name: 'Habit', icon: 'H' }],
    diaries: [{ id: id('mixed-diary'), date: '2026-10-05', content: 'Diary' }],
    quickNotes: [{ id: id('mixed-note'), content: 'Note', timestamp: 1000, parsed: { todos: [] } }],
    habitCheckins: [{ habitId, date: '2026-10-05' }],
  }
  const result = await push(owner, body)
  assert.equal(result.status, 200)
  assert.equal((await result.json() as Ack).versions.length, 7)
  const events = await allChanges(owner, 2)
  assert.equal(events.length, 7)
  assert.equal(new Set(events.map((event) => event.entity)).size, 7)
  const before = await prisma.syncChange.count({ where: { userId: owner } })
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.todo.create({ data: { id: id('rolled-back'), userId: owner, text: 'Never visible' } })
    throw new Error('Synthetic crash before commit')
  }))
  assert.equal(await prisma.syncChange.count({ where: { userId: owner } }), before)
})

test('SQLite writer serialization prevents a later committed high cursor from hiding a lower transaction', async () => {
  const owner = await user('concurrent')
  let release!: () => void
  let inserted!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const didInsert = new Promise<void>((resolve) => { inserted = resolve })
  const firstId = id('first-transaction'), secondId = id('second-transaction')
  const first = prisma.$transaction(async (tx) => {
    await tx.todo.create({ data: { id: firstId, userId: owner, text: 'First writer' } })
    inserted()
    await pending
  }, { timeout: 10_000 })
  await didInsert
  const reader = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal((reader.prepare('SELECT COUNT(*) AS count FROM SyncChange WHERE userId = ?').get(owner) as { count: number }).count, 0, 'uncommitted allocated seq is invisible')
  reader.close()
  const second = push(owner, { todos: [{ id: secondId, text: 'Second writer' }] }, id('concurrent-mutation'))
  release()
  await first
  const result = await second
  if (result.status === 503) {
    // A busy/serialization failure is explicit and safely retryable, never a success ACK.
    assert.equal((await result.json()).acknowledged, false)
    assert.equal((await push(owner, { todos: [{ id: secondId, text: 'Second writer' }] })).status, 200)
  } else assert.equal(result.status, 200, await result.clone().text())
  const events = await allChanges(owner, 1)
  assert.deepEqual(events.map((event) => event.entityId), [firstId, secondId])
  assert.ok(BigInt(events[1].seq) > BigInt(events[0].seq))
})

test('deterministic operation sequences reconstruct exactly and duplicate mutations have one effect', async () => {
  const owner = await user('property')
  let seed = 0x12345678
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed }
  const current = new Map<string, string>()
  for (let step = 0; step < 160; step++) {
    if (current.size === 0 || random() % 3 === 0) {
      const todoId = id('property-todo'), text = `Value ${step}`
      await prisma.todo.create({ data: { id: todoId, userId: owner, text } })
      current.set(todoId, text)
    } else {
      const todoId = [...current.keys()][random() % current.size]
      if (random() % 2) {
        const text = `Updated ${step}`
        await prisma.todo.update({ where: { id: todoId }, data: { text } })
        current.set(todoId, text)
      } else {
        await prisma.todo.delete({ where: { id: todoId } })
        current.delete(todoId)
      }
    }
  }
  const reconstructed = new Map<string, string>()
  const events = await allChanges(owner, 7)
  for (const event of events) {
    if (event.operation === 'delete') reconstructed.delete(event.entityId)
    else reconstructed.set(event.entityId, String(event.data?.text))
  }
  assert.deepEqual(reconstructed, current)
  assert.equal(events.length, 160)
  const mutationId = id('parallel-replay'), todoId = id('parallel-todo')
  const body = { todos: [{ id: todoId, text: 'Exactly once' }] }
  const results = await Promise.all(Array.from({ length: 5 }, () => push(owner, body, mutationId)))
  assert.ok(results.every((result) => result.status === 200 || result.status === 503))
  const ack = await push(owner, body, mutationId)
  assert.equal(ack.status, 200)
  assert.equal(await prisma.syncChange.count({ where: { userId: owner, entityId: todoId } }), 1)
  assert.equal(await prisma.syncReceipt.count({ where: { userId: owner, mutationId } }), 1)
})

test('account deletion removes private feed, tombstones and receipt contents with the account', async () => {
  const owner = await user('erase')
  const todoId = id('erase-todo')
  assert.equal((await push(owner, { todos: [{ id: todoId, text: 'Private synthetic text' }] })).status, 200)
  assert.equal((await request(owner, `/todos/${todoId}`, undefined, 'DELETE')).status, 200)
  assert.equal(await prisma.syncTombstone.count({ where: { userId: owner } }), 1)
  assert.equal((await request(owner, '/user', undefined, 'DELETE')).status, 200)
  assert.equal(await prisma.syncChange.count({ where: { userId: owner } }), 0)
  assert.equal(await prisma.syncTombstone.count({ where: { userId: owner } }), 0)
  assert.equal(await prisma.syncReceipt.count({ where: { userId: owner } }), 0)
})

test('cursors remain exact above JavaScript safe integer range', async () => {
  const owner = await user('bigint')
  // Synthetic database only. Verify actual driver + trigger + HTTP serialization precision.
  const connection = new DatabaseSync(databasePath)
  connection.exec("UPDATE sqlite_sequence SET seq = 9007199254740992 WHERE name = 'SyncChange';")
  connection.close()
  const todoId = id('bigint-todo')
  const response = await push(owner, { todos: [{ id: todoId, text: 'Beyond Number precision' }] })
  assert.equal(response.status, 200)
  const ack = await response.json() as Ack
  assert.equal(ack.versions[0].seq, '9007199254740993')
  const page = await pull(owner)
  assert.equal(page.nextCursor, '9007199254740993')
  assert.equal((await pull(owner, page.nextCursor)).events.length, 0)
})

test('ledger migration rolls back an interrupted backfill without losing existing rows', async () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true })
  const migrationsDir = resolve('prisma/migrations')
  for (const name of (await readdir(migrationsDir)).sort()) {
    if (name.startsWith('2026') && name < '20261004000000') db.exec(await readFile(resolve(migrationsDir, name, 'migration.sql'), 'utf8'))
  }
  db.exec(`INSERT INTO User (id,phone,nickname,updatedAt) VALUES ('safe-owner','safe-phone','Synthetic',0);
    INSERT INTO Todo (id,userId,text,updatedAt) VALUES ('safe-existing','safe-owner','Preserve on interruption',0);`)
  const migration = await readFile(resolve(migrationsDir, '20261004000000_sync_v2_ledger', 'migration.sql'), 'utf8')
  assert.throws(() => db.exec(migration.replace('\nCOMMIT;', '\nINSERT INTO DeliberatelyMissingTable VALUES (1);\nCOMMIT;')))
  db.exec('ROLLBACK;')
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'SyncChange'").get() as { count: number }).count, 0)
  assert.equal((db.prepare('SELECT text FROM Todo WHERE id = ?').get('safe-existing') as { text: string }).text, 'Preserve on interruption')
  db.exec(migration)
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM SyncChange').get() as { count: number }).count, 1)
  assert.equal((db.prepare('PRAGMA foreign_key_check').all()).length, 0)
  db.close()
})

test('goal versioned API preserves ownership, validates data and returns exact replay receipts', async () => {
  const owner = await user('goal-owner'), other = await user('goal-other')
  const goal = { id: id('goal-record'), title: 'Synthetic goal', description: 'Original detail', level: 'long', domain: '生活', priority: 'medium', progress: 25, targetDate: '2026-12-31', createdAt: 1000 }
  const mutationId = id('goal-mutation')
  const created = await push(owner, { goals: [goal] }, mutationId)
  assert.equal(created.status, 200)
  const receipt = await created.json() as Ack
  assert.equal(receipt.synced.goals, 1)
  assert.equal(receipt.versions[0].entity, 'goals')
  const replay = await push(owner, { goals: [goal] }, mutationId)
  assert.deepEqual(await replay.json(), receipt)
  assert.equal(await prisma.syncChange.count({ where: { userId: owner, entity: 'goals' } }), 1)
  assert.equal((await push(owner, { goals: [{ ...goal, title: 'Different content' }] }, mutationId)).status, 409)
  assert.equal((await push(other, { goals: [goal] })).status, 403)
  assert.equal((await pull(other)).events.length, 0)
  assert.equal((await push(owner, { goals: [{ ...goal, id: id('invalid-goal'), progress: 101 }] })).status, 400)
  assert.equal((await push(owner, { goals: [{ ...goal, id: id('invalid-goal'), title: '  ' }] })).status, 400)
  assert.equal((await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })).createdAt.getTime(), 1000)
  assert.equal((await pull(owner, '0', 1)).events[0].data?.description, goal.description)
})

test('goal manual progress is reversible, stale mutation conflicts atomically and deletion is permanent by ID', async () => {
  const owner = await user('goal-change')
  const goal = { id: id('goal-change'), title: 'Synthetic', description: '', level: 'short', domain: '学习', priority: 'low', progress: 0, targetDate: null }
  let response = await push(owner, { goals: [goal] })
  const first = await response.json() as Ack
  response = await push(owner, { goals: [{ ...goal, progress: 100, baseVersion: first.versions[0].seq }] })
  const completed = await response.json() as Ack
  assert.equal(response.status, 200)
  assert.equal((await push(owner, { goals: [{ ...goal, progress: 50, baseVersion: first.versions[0].seq }], todos: [{ id: id('rollback-goal-todo'), text: 'Must not survive' }] })).status, 409)
  assert.equal(await prisma.todo.count({ where: { userId: owner } }), 0)
  response = await push(owner, { goals: [{ ...goal, progress: 25, baseVersion: completed.versions[0].seq }] })
  const reversed = await response.json() as Ack
  assert.equal((await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })).progress, 25)
  assert.equal((await push(owner, { deletions: { goalIds: [{ id: goal.id, baseVersion: reversed.versions[0].seq }] } })).status, 200)
  assert.equal((await push(owner, { goals: [goal] })).status, 409)
  const events = await allChanges(owner, 1)
  assert.deepEqual(events.map((event) => event.operation), ['upsert', 'upsert', 'upsert', 'delete'])
  assert.equal(await prisma.goal.count({ where: { userId: owner } }), 0)
  assert.equal((await request(owner, '/user', undefined, 'DELETE')).status, 200)
  assert.equal(await prisma.syncChange.count({ where: { userId: owner } }), 0)
  assert.equal(await prisma.syncReceipt.count({ where: { userId: owner } }), 0)
})

test('goal triggers reject identity changes, capture every writer and account deletion removes active goals', async () => {
  const owner = await user('goal-triggers'), other = await user('goal-other-trigger')
  const goalId = id('direct-goal')
  await prisma.goal.create({ data: { id: goalId, userId: owner, title: 'Direct writer', domain: '生活' } })
  await assert.rejects(prisma.goal.update({ where: { id: goalId }, data: { userId: other } }))
  await assert.rejects(prisma.goal.update({ where: { id: goalId }, data: { createdAt: new Date(0) } }))
  await prisma.goal.update({ where: { id: goalId }, data: { description: 'Changed through direct writer' } })
  assert.equal((await allChanges(owner)).length, 2)
  assert.equal((await request(owner, '/user', undefined, 'DELETE')).status, 200)
  assert.equal(await prisma.goal.count({ where: { userId: owner } }), 0)
  assert.equal(await prisma.syncTombstone.count({ where: { userId: owner } }), 0)
})

test('additive goal migration interruption rolls back schema and preserves populated prior data', async () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true })
  const migrationsDir = resolve('prisma/migrations')
  for (const name of (await readdir(migrationsDir)).sort()) {
    if (/^2026/.test(name) && name < '20261004000002') db.exec(await readFile(resolve(migrationsDir, name, 'migration.sql'), 'utf8'))
  }
  db.exec(`INSERT INTO User (id,phone,nickname,updatedAt) VALUES ('goal-upgrade-owner','goal-upgrade-phone','Synthetic',0);
    INSERT INTO Todo (id,userId,text,updatedAt) VALUES ('goal-upgrade-todo','goal-upgrade-owner','Preserve original source',0);`)
  const migration = await readFile(resolve(migrationsDir, '20261004000002_goal_lifecycle', 'migration.sql'), 'utf8')
  assert.throws(() => db.exec(migration.replace('\nCOMMIT;', '\nINSERT INTO DeliberatelyMissingTable VALUES (1);\nCOMMIT;')))
  db.exec('ROLLBACK;')
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='Goal'").get() as { n: number }).n, 0)
  assert.equal((db.prepare('SELECT text FROM Todo WHERE id=?').get('goal-upgrade-todo') as { text: string }).text, 'Preserve original source')
  db.exec(migration)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM Goal').get() as { n: number }).n, 0, 'no private local goal is inferred')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM SyncChange').get() as { n: number }).n, 1)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  db.close()
})

test('missing database trigger fails closed with no write and no ACK', async () => {
  const owner = await user('missing-trigger')
  await prisma.$executeRawUnsafe('DROP TRIGGER "sync_Todo_insert"')
  const response = await push(owner, { todos: [{ id: id('no-trigger-todo'), text: 'Do not accept' }] })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'SYNC_MIGRATION_REQUIRED')
  assert.equal(await prisma.todo.count({ where: { userId: owner } }), 0)
  assert.equal(await prisma.syncReceipt.count({ where: { userId: owner } }), 0)
})
