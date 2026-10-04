import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { consumeSseStream } from '../../src/services/sseParser.ts'

const databasePath = resolve('prisma', `youji-test-${process.pid}-${Date.now()}.db`)

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, '/')}`
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long'
process.env.ALLOWED_ORIGINS = 'https://app.example.com'
process.env.DEV_OTP_EXPOSE = 'true'
process.env.REQUEST_BODY_LIMIT_BYTES = '16384'
process.env.LLM_API_KEY = ''

let app: Awaited<typeof import('../src/app.js')>['app']
let prisma: Awaited<typeof import('../src/utils/db.js')>['prisma']

const ALLOWED_ORIGIN = 'https://app.example.com'

function request(path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: {
      Origin: ALLOWED_ORIGIN,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function patchJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function putJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function bytesStream(bytes: Uint8Array, cutPoints: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      let start = 0
      for (const end of cutPoints) {
        controller.enqueue(bytes.slice(start, end))
        start = end
      }
      if (start < bytes.length) controller.enqueue(bytes.slice(start))
      controller.close()
    },
  })
}

async function registerUser(phone: string, nickname: string): Promise<{ cookie: string }> {
  const sent = await jsonRequest('/api/auth/send-code', { phone })
  assert.equal(sent.status, 200)
  const challenge = await sent.json() as { challengeId: string; devCode: string }

  const verified = await jsonRequest('/api/auth/verify', {
    phone,
    code: challenge.devCode,
    challengeId: challenge.challengeId,
  })
  assert.equal(verified.status, 200)
  const payload = await verified.json() as { needRegister: boolean; registrationTicket?: string }
  assert.equal(payload.needRegister, true)
  assert.ok(payload.registrationTicket)

  const registered = await jsonRequest('/api/auth/register', {
    phone,
    nickname,
    registrationTicket: payload.registrationTicket,
  })
  assert.equal(registered.status, 201)

  const setCookieHeader = registered.headers.get('set-cookie') ?? ''
  const cookiePair = setCookieHeader.split(';')[0]
  return { cookie: cookiePair }
}

before(async () => {
  ;({ prisma } = await import('../src/utils/db.js'))

  const migrationsDir = resolve('prisma/migrations')
  const entries = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const fixture = new DatabaseSync(databasePath, { enableDoubleQuotedStringLiterals: true })
  try {
    for (const name of entries) {
      fixture.exec(await readFile(resolve(migrationsDir, name, 'migration.sql'), 'utf8'))
    }
  } finally { fixture.close() }

  ;({ app } = await import('../src/app.js'))
})

after(async () => {
  await prisma.$disconnect()
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-journal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
  ])
})

test('API applies body limits, origin enforcement, JSON errors, and security headers', async () => {
  const health = await app.request('/health')
  assert.equal(health.status, 200)
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(health.headers.get('x-frame-options'), 'DENY')
  assert.equal(health.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")

  const forbiddenOriginGet = await app.request('/health', {
    headers: { Origin: 'https://evil.example.com' },
  })
  assert.equal(forbiddenOriginGet.status, 200)

  const missingOriginPost = await app.request('/api/auth/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800138000' }),
  })
  assert.equal(missingOriginPost.status, 403)

  const forbiddenOriginPost = await jsonRequest('/api/auth/send-code', { phone: '13800138000' }, {
    Origin: 'https://evil.example.com',
  })
  assert.equal(forbiddenOriginPost.status, 403)

  const malformed = await request('/api/auth/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  })
  assert.equal(malformed.status, 400)

  const oversized = await request('/api/auth/send-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': '20020',
    },
    body: JSON.stringify({ phone: '13800138000', padding: 'x'.repeat(20_000) }),
  })
  assert.equal(oversized.status, 413)

  const oversizedWithoutLength = await request('/api/auth/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800138000', padding: 'x'.repeat(20_000) }),
  })
  assert.equal(oversizedWithoutLength.status, 413)
})

test('registration requires a hashed, expiring, single-use OTP-derived ticket', async () => {
  const phone = '13800138001'

  const bypass = await jsonRequest('/api/auth/register', {
    phone,
    nickname: 'bypass',
    registrationTicket: 'x'.repeat(32),
  })
  assert.equal(bypass.status, 401)

  const sent = await jsonRequest('/api/auth/send-code', { phone })
  assert.equal(sent.status, 200)
  const challengePayload = await sent.json() as {
    challengeId: string
    devCode: string
  }
  assert.match(challengePayload.devCode, /^\d{6}$/)

  const storedChallenge = await prisma.authChallenge.findUniqueOrThrow({
    where: { id: challengePayload.challengeId },
  })
  assert.notEqual(storedChallenge.codeHash, challengePayload.devCode)
  assert.equal(storedChallenge.codeHash.length, 64)

  const wrongCode = challengePayload.devCode === '000000' ? '000001' : '000000'
  const wrong = await jsonRequest('/api/auth/verify', {
    phone,
    code: wrongCode,
    challengeId: challengePayload.challengeId,
  })
  assert.equal(wrong.status, 401)
  assert.equal((await prisma.authChallenge.findUniqueOrThrow({
    where: { id: challengePayload.challengeId },
  })).attempts, 1)

  const verified = await jsonRequest('/api/auth/verify', {
    phone,
    code: challengePayload.devCode,
    challengeId: challengePayload.challengeId,
  })
  assert.equal(verified.status, 200)
  const verifyPayload = await verified.json() as {
    needRegister: boolean
    registrationTicket: string
  }
  assert.equal(verifyPayload.needRegister, true)
  assert.ok(verifyPayload.registrationTicket.length >= 32)

  const replayedChallenge = await jsonRequest('/api/auth/verify', {
    phone,
    code: challengePayload.devCode,
    challengeId: challengePayload.challengeId,
  })
  assert.equal(replayedChallenge.status, 401)

  const storedTicket = await prisma.registrationTicket.findFirstOrThrow({ where: { phone } })
  assert.notEqual(storedTicket.tokenHash, verifyPayload.registrationTicket)
  assert.equal(storedTicket.tokenHash.length, 64)

  const wrongPhone = await jsonRequest('/api/auth/register', {
    phone: '13800138002',
    nickname: 'wrong-phone',
    registrationTicket: verifyPayload.registrationTicket,
  })
  assert.equal(wrongPhone.status, 401)

  const registered = await jsonRequest('/api/auth/register', {
    phone,
    nickname: 'verified-user',
    registrationTicket: verifyPayload.registrationTicket,
  })
  assert.equal(registered.status, 201)
  const sessionCookie = registered.headers.get('set-cookie')
  assert.ok(sessionCookie?.includes('HttpOnly'))

  const consumedTicket = await prisma.registrationTicket.findUniqueOrThrow({
    where: { id: storedTicket.id },
  })
  assert.ok(consumedTicket.consumedAt)

  const replayedTicket = await jsonRequest('/api/auth/register', {
    phone,
    nickname: 'replay',
    registrationTicket: verifyPayload.registrationTicket,
  })
  assert.equal(replayedTicket.status, 401)

  const me = await request('/api/auth/me', {
    headers: { Cookie: sessionCookie ?? '' },
  })
  assert.equal(me.status, 200)
  const mePayload = await me.json() as { user: Record<string, unknown> }
  assert.equal(mePayload.user.nickname, 'verified-user')
  assert.equal(mePayload.user.coachStyle, 'gentle')
  assert.ok('quietStart' in mePayload.user)
  assert.ok('pushLimit' in mePayload.user)

  const chat = await jsonRequest('/api/chat', { message: '看看我的待办' }, {
    Cookie: sessionCookie ?? '',
  })
  assert.equal(chat.status, 200)
  assert.match(chat.headers.get('content-type') ?? '', /^text\/event-stream/)
  assert.ok(chat.headers.get('x-session-id'))
  const events: string[] = []
  assert.ok(chat.body)
  await consumeSseStream(chat.body, (data) => events.push(data))
  assert.equal(events.at(-1), '[DONE]')
  assert.ok(events.slice(0, -1).some((event) => JSON.parse(event).content.length > 0))

  const bearerRejected = await request('/api/auth/me', {
    headers: { Authorization: 'Bearer forged-token-value-1234567890' },
  })
  assert.equal(bearerRejected.status, 401)
})

test('expired OTP challenges cannot be verified', async () => {
  const phone = '13800138003'
  const sent = await jsonRequest('/api/auth/send-code', { phone })
  const payload = await sent.json() as { challengeId: string; devCode: string }
  await prisma.authChallenge.update({
    where: { id: payload.challengeId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  })

  const response = await jsonRequest('/api/auth/verify', {
    phone,
    code: payload.devCode,
    challengeId: payload.challengeId,
  })
  assert.equal(response.status, 401)
})

test('OTP delivery is fail-closed outside explicit development exposure', async () => {
  const { OtpDeliveryUnavailableError, resolveOtpDeliveryMode } = await import('../src/services/sms.js')

  assert.throws(
    () => resolveOtpDeliveryMode({ isProduction: true, devOtpExpose: false, smsProviderUrl: '' }),
    OtpDeliveryUnavailableError,
  )
  assert.throws(
    () => resolveOtpDeliveryMode({ isProduction: false, devOtpExpose: false, smsProviderUrl: '' }),
    OtpDeliveryUnavailableError,
  )
  assert.deepEqual(
    resolveOtpDeliveryMode({ isProduction: false, devOtpExpose: true, smsProviderUrl: '' }),
    { exposeDevelopmentCode: true },
  )
  assert.deepEqual(
    resolveOtpDeliveryMode({ isProduction: true, devOtpExpose: false, smsProviderUrl: 'https://sms.example.com' }),
    { exposeDevelopmentCode: false },
  )
})

test('business dates and day boundaries are pinned to Asia/Shanghai', async () => {
  const instant = new Date('2026-01-01T16:30:00.000Z')
  const serverDates = await import('../src/utils/date.js')
  const browserDates = await import('../../src/utils/date.ts')

  assert.equal(serverDates.formatBusinessDate(instant), '2026-01-02')
  assert.deepEqual(serverDates.getBusinessClock(instant), {
    year: 2026,
    month: 1,
    day: 2,
    hour: 0,
    minute: 30,
    weekday: 5,
  })
  assert.equal(serverDates.getBusinessDayStart('2026-01-02').toISOString(), '2026-01-01T16:00:00.000Z')
  assert.equal(serverDates.daysBetween('2026-01-02', '2026-01-09'), 7)

  assert.equal(browserDates.formatBusinessDate(instant), '2026-01-02')
  assert.equal(browserDates.getBusinessDayStartTimestamp('2026-01-02'), 1_767_283_200_000)
  assert.equal(browserDates.addDays('2026-02-28', 1), '2026-03-01')
  assert.throws(() => browserDates.parseBusinessDate('2026-02-30'), RangeError)
})

test('SSE parsers preserve split UTF-8, CRLF events, comments, and DONE termination', async () => {
  const encoder = new TextEncoder()
  const browserPayload = encoder.encode(': ping\r\ndata: first\r\ndata: second\r\n\r\ndata: 你好\r\n\r\n')
  const browserEvents: string[] = []
  await consumeSseStream(bytesStream(browserPayload, [1, 7, 25, 53, 54]), (data) => {
    browserEvents.push(data)
  })
  assert.deepEqual(browserEvents, ['first\nsecond', '你好'])

  const upstreamPayload = encoder.encode([
    'data: {"choices":[{"delta":{"content":"你"}}]}\r\n\r\n',
    'data: malformed\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\r\n\r\n',
    'data: [DONE]\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"不应出现"}}]}\r\n\r\n',
  ].join(''))
  const { readChatCompletionStream } = await import('../src/services/openAiStream.js')
  const deltas: string[] = []
  for await (const delta of readChatCompletionStream(bytesStream(upstreamPayload, [2, 18, 49, 88]))) {
    deltas.push(delta)
  }
  assert.deepEqual(deltas, ['你', '好'])
})

test('quicknote list serializes BigInt timestamps and parsed payloads', async () => {
  const { cookie } = await registerUser('13900001001', 'quicknote-user')

  const created = await jsonRequest('/api/quicknote', {
    content: '午饭30元，明天要交作业，今天很开心',
    timestamp: Date.now(),
  }, { Cookie: cookie })
  assert.equal(created.status, 201)
  const createdNote = await created.json() as { note: { id: string; timestamp: number } }
  assert.equal(typeof createdNote.note.timestamp, 'number')

  const list = await request('/api/quicknote', { headers: { Cookie: cookie } })
  assert.equal(list.status, 200)
  const listPayload = await list.json() as { notes: Array<{ id: string; timestamp: number; parsed: unknown }> }
  assert.equal(listPayload.notes.length, 1)
  assert.equal(listPayload.notes[0].id, createdNote.note.id)
  assert.equal(typeof listPayload.notes[0].timestamp, 'number')
  assert.ok(listPayload.notes[0].parsed && typeof listPayload.notes[0].parsed === 'object')

  const confirmed = await putJson(`/api/quicknote/${createdNote.note.id}/confirm`, {}, { Cookie: cookie })
  assert.equal(confirmed.status, 200)

  const deleted = await request(`/api/quicknote/${createdNote.note.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  })
  assert.equal(deleted.status, 200)
})

test('diary uses string ids, rejects duplicate dates, and 404s on unknown ids', async () => {
  const { cookie } = await registerUser('13900001002', 'diary-user')

  const created = await jsonRequest('/api/diary', {
    date: '2026-08-23',
    content: '今天是充实的一天',
    mood: 'happy',
    moodScore: 8,
  }, { Cookie: cookie })
  assert.equal(created.status, 201)
  const { diary } = await created.json() as { diary: { id: string } }
  assert.equal(typeof diary.id, 'string')

  const duplicate = await jsonRequest('/api/diary', {
    date: '2026-08-23',
    content: '同一天第二篇',
  }, { Cookie: cookie })
  assert.equal(duplicate.status, 409)

  const notFound = await putJson('/api/diary/%E4%B8%8D%E5%AD%98%E5%9C%A8', { content: 'x' }, { Cookie: cookie })
  assert.equal(notFound.status, 404)

  const updated = await putJson(`/api/diary/${diary.id}`, {
    content: '更新后的内容',
    moodScore: 9,
  }, { Cookie: cookie })
  assert.equal(updated.status, 200)
})

test('todos flip atomically and report the resulting state', async () => {
  const { cookie } = await registerUser('13900001003', 'todo-user')

  const created = await jsonRequest('/api/todos', {
    text: '写周报',
    dueDate: '2026-08-24',
    priority: 'high',
  }, { Cookie: cookie })
  assert.equal(created.status, 201)
  const { todo } = await created.json() as { todo: { id: string; done: boolean } }
  assert.equal(todo.done, false)

  const firstToggle = await request(`/api/todos/${todo.id}/toggle`, {
    method: 'PATCH',
    headers: { Cookie: cookie },
  })
  assert.equal(firstToggle.status, 200)
  const firstState = await firstToggle.json() as { todo: { done: boolean } }
  assert.equal(firstState.todo.done, true)

  const secondToggle = await request(`/api/todos/${todo.id}/toggle`, {
    method: 'PATCH',
    headers: { Cookie: cookie },
  })
  const secondState = await secondToggle.json() as { todo: { done: boolean } }
  assert.equal(secondState.todo.done, false)

  const missing = await request('/api/todos/nope-nope-nope/toggle', {
    method: 'PATCH',
    headers: { Cookie: cookie },
  })
  assert.equal(missing.status, 404)
})

test('habits expose streaks, recent checkins, and idempotent per-day toggles', async () => {
  const { cookie } = await registerUser('13900001004', 'habit-user')

  const created = await jsonRequest('/api/habits', {
    name: '跑步',
    icon: '🏃',
  }, { Cookie: cookie })
  assert.equal(created.status, 201)
  const { habit } = await created.json() as { habit: { id: string } }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())

  const checked = await patchJson(`/api/habits/${habit.id}/check`, { done: true }, { Cookie: cookie })
  assert.equal(checked.status, 200)

  const rechecked = await patchJson(`/api/habits/${habit.id}/check`, { done: true }, { Cookie: cookie })
  assert.equal(rechecked.status, 200)
  const rows = await prisma.habitCheckin.findMany({ where: { habitId: habit.id, date: today } })
  assert.equal(rows.length, 1)

  const listed = await request('/api/habits', { headers: { Cookie: cookie } })
  assert.equal(listed.status, 200)
  const listPayload = await listed.json() as {
    habits: Array<{ id: string; streak: number; recentCheckins: Array<{ date: string; done: boolean }> }>
  }
  const entry = listPayload.habits.find((h) => h.id === habit.id)
  assert.ok(entry)
  assert.equal(entry.streak, 1)
  assert.equal(entry.recentCheckins.length, 7)
  assert.equal(entry.recentCheckins.at(-1)?.date, today)
  assert.equal(entry.recentCheckins.at(-1)?.done, true)
})

test('user settings patch validates input and persists', async () => {
  const { cookie } = await registerUser('13900001005', 'settings-user')

  const patched = await patchJson('/api/user/settings', {
    coachStyle: 'strict',
    quietStart: '22:30',
    quietEnd: '06:30',
    pushLimit: 5,
  }, { Cookie: cookie })
  assert.equal(patched.status, 200)
  const settings = await patched.json() as { settings: Record<string, unknown> }
  assert.equal(settings.settings.coachStyle, 'strict')
  assert.equal(settings.settings.quietStart, '22:30')
  assert.equal(settings.settings.pushLimit, 5)

  const invalidTime = await patchJson('/api/user/settings', { quietStart: '25:99' }, { Cookie: cookie })
  assert.equal(invalidTime.status, 400)

  const emptyBody = await patchJson('/api/user/settings', {}, { Cookie: cookie })
  assert.equal(emptyBody.status, 400)

  const unauthenticated = await patchJson('/api/user/settings', { pushLimit: 3 })
  assert.equal(unauthenticated.status, 401)
})

test('sync v2 round-trips records, deletion events, cursors and ownership', async () => {
  const alice = await registerUser('13900001006', 'alice-sync')
  const mallory = await registerUser('13900001007', 'mallory-sync')
  const scheduleId = 'sched-alice-0001', expenseId = 'expen-alice-0001', todoId = 'todo--alice-0001', habitId = 'habit-alice-0001'
  const pushed = await jsonRequest('/api/sync/push', {
    protocol: 2, mutationId: 'alice-initial-0001',
    schedules: [{ id: scheduleId, title: '小组会', date: '2026-08-24', startTime: '10:00', endTime: '11:00', type: 'study', location: '图书馆' }],
    expenses: [{ id: expenseId, amount: 2500, category: 'food', name: '午饭', date: '2026-08-23' }],
    todos: [{ id: todoId, text: '复习高数', dueDate: '2026-08-25', priority: 'high' }],
    habits: [{ id: habitId, name: '背单词', icon: '📖' }],
    habitCheckins: [{ habitId, date: '2026-08-23', done: true, source: 'manual' }],
  }, { Cookie: alice.cookie })
  assert.equal(pushed.status, 200)
  const receipt = await pushed.json() as { acknowledged: boolean; synced: Record<string, number>; versions: Array<{ entityId: string; seq: string }> }
  assert.equal(receipt.acknowledged, true)
  assert.equal(receipt.synced.schedules, 1)
  assert.equal(receipt.synced.habitCheckins, 1)
  const version = (id: string) => receipt.versions.find((v) => v.entityId === id)!.seq
  const foreign = await jsonRequest('/api/sync/push', {
    protocol: 2, mutationId: 'mallory-update-0001', schedules: [{ id: scheduleId, title: '篡改', date: '2026-08-24', startTime: '10:00', endTime: '11:00' }],
  }, { Cookie: mallory.cookie })
  assert.equal(foreign.status, 403)
  const pulled = await request('/api/sync/pull?protocol=2&cursor=0', { headers: { Cookie: alice.cookie } })
  assert.equal(pulled.status, 200)
  const page = await pulled.json() as { events: Array<{ entity: string; entityId: string; operation: string; data: { title: string } }>; nextCursor: string }
  assert.equal(page.events.filter((e) => e.entity === 'schedules').length, 1)
  assert.equal(page.events.find((e) => e.entity === 'schedules')!.data.title, '小组会')
  assert.equal(page.events.filter((e) => e.entity === 'habitCheckins').length, 1)
  const incremental = await request(`/api/sync/pull?protocol=2&cursor=${page.nextCursor}`, { headers: { Cookie: alice.cookie } })
  assert.equal(((await incremental.json()) as { events: unknown[] }).events.length, 0)
  const deletions = { scheduleIds: [{ id: scheduleId, baseVersion: version(scheduleId) }], expenseIds: [{ id: expenseId, baseVersion: version(expenseId) }] }
  const deleted = await jsonRequest('/api/sync/push', { protocol: 2, mutationId: 'alice-delete-0001', deletions }, { Cookie: alice.cookie })
  assert.equal(deleted.status, 200)
  const foreignDelete = await jsonRequest('/api/sync/push', { protocol: 2, mutationId: 'mallory-delete-0001', deletions: { todoIds: [{ id: todoId, baseVersion: version(todoId) }] } }, { Cookie: mallory.cookie })
  assert.equal(foreignDelete.status, 403)
  const replay = await jsonRequest('/api/sync/push', { protocol: 2, mutationId: 'alice-delete-0001', deletions }, { Cookie: alice.cookie })
  assert.equal(replay.status, 200)
  const afterDelete = await request(`/api/sync/pull?protocol=2&cursor=${page.nextCursor}`, { headers: { Cookie: alice.cookie } })
  const events = ((await afterDelete.json()) as { events: Array<{ operation: string }> }).events
  assert.equal(events.filter((e) => e.operation === 'delete').length, 2)
  assert.equal(await prisma.todo.count({ where: { id: todoId } }), 1)
  assert.equal((await request('/api/sync/pull?protocol=2&cursor=not-a-seq', { headers: { Cookie: alice.cookie } })).status, 400)
  assert.equal((await request('/api/sync/pull?since=1970-01-01', { headers: { Cookie: alice.cookie } })).status, 426)
  const invalidPush = await jsonRequest('/api/sync/push', { protocol: 2, mutationId: 'invalid-mutation-0001', expenses: [{ id: 'short', amount: -5, category: '', name: '', date: 'bad' }] }, { Cookie: alice.cookie })
  assert.equal(invalidPush.status, 400)
})

test('coach brief reports honest spend diff and pushes can be marked read or acted', async () => {
  const { cookie } = await registerUser('13900001008', 'coach-user')

  const generated = await jsonRequest('/api/coach/generate-brief', {}, { Cookie: cookie })
  assert.equal(generated.status, 200)
  const { insight } = await generated.json() as { insight: { id: string } }

  const dismissed = await jsonRequest(`/api/coach/insights/${insight.id}/dismiss`, {}, { Cookie: cookie })
  assert.equal(dismissed.status, 200)

  const brief = await request('/api/coach/brief', { headers: { Cookie: cookie } })
  assert.equal(brief.status, 200)
  const briefData = await brief.json() as { brief: { yesterdayReview: { spentDiff: string | null }; weather?: unknown } }
  assert.ok(!('weather' in briefData.brief))
  assert.ok(['string', 'object'].includes(typeof briefData.brief.yesterdayReview.spentDiff))

  const pushCreated = await prisma.push.create({
    data: {
      id: 'push-coach-test-1',
      userId: (await prisma.user.findUniqueOrThrow({ where: { phone: '13900001008' } })).id,
      type: 'insight',
      title: '测试推送',
      body: '内容',
      actions: JSON.stringify([{ label: '查看' }]),
    },
  })

  const patched = await patchJson(`/api/coach/pushes/${pushCreated.id}`, {
    read: true,
    acted: true,
  }, { Cookie: cookie })
  assert.equal(patched.status, 200)

  const invalidPatch = await patchJson(`/api/coach/pushes/${pushCreated.id}`, {}, { Cookie: cookie })
  assert.equal(invalidPatch.status, 400)

  const foreignCookie = (await registerUser('13900001009', 'other')).cookie
  const foreignPatch = await patchJson('/api/coach/pushes/push-coach-test-1', {
    read: true,
  }, { Cookie: foreignCookie })
  assert.equal(foreignPatch.status, 404)
})

test('account deletion cascades every owned record and revokes access', async () => {
  const { cookie } = await registerUser('13900001010', 'doomed-user')
  const user = await prisma.user.findUniqueOrThrow({ where: { phone: '13900001010' } })

  await jsonRequest('/api/expenses', { amount: 1000, category: 'food', name: '测试', date: '2026-08-23' }, { Cookie: cookie })
  await jsonRequest('/api/diary', { date: '2026-08-23', content: '日记' }, { Cookie: cookie })
  await prisma.chatSession.create({ data: { id: 'session-doomed-01', userId: user.id } })

  const deleted = await request('/api/user', {
    method: 'DELETE',
    headers: { Cookie: cookie },
  })
  assert.equal(deleted.status, 200)

  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0)
  assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 0)
  assert.equal(await prisma.diary.count({ where: { userId: user.id } }), 0)
  assert.equal(await prisma.chatSession.count({ where: { userId: user.id } }), 0)

  const meAfter = await request('/api/auth/me', { headers: { Cookie: cookie } })
  assert.equal(meAfter.status, 401)
})


test('expected-account header rejects shared-cookie races on every private route', async () => {
  const { cookie } = await registerUser('13900001030', 'account-boundary')
  const requests: Array<[string, string]> = [['/api/todos', 'GET'], ['/api/sync/pull?protocol=2', 'GET'], ['/api/user/settings', 'GET'], ['/api/chat', 'POST'], ['/api/user', 'DELETE']]
  for (const [path, method] of requests) {
    const response = await request(path, { method, headers: { Cookie: cookie, 'X-YouTrace-Account': 'different-account' } })
    assert.equal(response.status, 409, path)
    assert.equal(response.headers.get('X-YouTrace-Account-Mismatch'), 'true')
  }
})

test('logout revokes copied cookie on auth and business routes', async () => {
  const { cookie } = await registerUser('13900001031', 'logout-boundary')
  assert.equal((await request('/api/todos', { headers: { Cookie: cookie } })).status, 200)
  assert.equal((await jsonRequest('/api/auth/logout', {}, { Cookie: cookie })).status, 200)
  for (const path of ['/api/auth/me', '/api/todos', '/api/user/settings', '/api/sync/pull?protocol=2']) {
    assert.equal((await request(path, { headers: { Cookie: cookie } })).status, 401, path)
  }
})
