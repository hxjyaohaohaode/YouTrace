import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { readChatCompletionStream } from '../src/services/openAiStream.js'

const directory = await mkdtemp(resolve(tmpdir(), 'youtrace-chat-stream-completion-'))
const databasePath = resolve(directory, 'synthetic.db')
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${databasePath}`
process.env.JWT_SECRET = 'synthetic-stream-completion-secret-at-least-32-characters'
process.env.LLM_API_KEY = 'synthetic-placeholder-not-a-real-key'
process.env.LLM_BASE_URL = 'https://synthetic-provider.invalid/v1'
process.env.LLM_MODEL = 'synthetic-model'
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
const values = new Map<string, string>()
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage, window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }), document: { documentElement: { setAttribute() {} } } })
const appRequire = createRequire(new URL('../../package.json', import.meta.url))
await import(pathToFileURL(appRequire.resolve('fake-indexeddb/auto')).href)
const { prisma } = await import('../src/utils/db.js')
const { chatRoutes } = await import('../src/routes/chat.js')
const { saveConnection } = await import('../src/services/userAI.js')
let aiConnection: { connectionId: string; version: number }
const { useCoachStore } = await import('../../src/stores/coachStore.ts')
const { setSessionActive } = await import('../../src/services/apiClient.ts')
const { getToastSnapshot } = await import('../../src/services/toastBus.ts')
const { db } = await import('../../src/db/index.ts')
const owner = 'synthetic-stream-route-owner'
const app = new Hono<{ Variables: { user: { id: string } } }>()
app.use('*', async (c, next) => { c.set('user', { id: owner }); await next() })
app.route('/chat', chatRoutes)
const realFetch = globalThis.fetch
// One fixed fixture prerequisite; no authentication, switching or clear paths.
setSessionActive(owner)
before(async () => {
  const migrations = resolve('prisma/migrations')
  const fixture = new DatabaseSync(databasePath, { enableDoubleQuotedStringLiterals: true })
  try {
    for (const name of (await readdir(migrations, { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name).sort()) fixture.exec(await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'))
  } finally { fixture.close() }
  await prisma.user.create({ data: { id: owner, phone: owner, nickname: 'Synthetic' } })
  const saved = await saveConnection(owner, { connectionId: null, version: 0, providerId: 'deepseek', model: 'synthetic-model', apiKey: 'synthetic-placeholder-not-a-real-key', chatConsent: true })
  assert.ok(saved)
  aiConnection = { connectionId: saved.connectionId, version: saved.version }
})
after(async () => { globalThis.fetch = realFetch; await prisma.$disconnect(); db.close(); await rm(directory, { recursive: true, force: true }) })

const PARTIAL = '合成部分正文：第一段\n第二行'
const PROVIDER_ACTION = { type: 'add_todo', text: '合成候选：核对待办', label: '确认合成候选' }
const RULE_ACTION = { type: 'navigate', path: '/todo', label: '打开待办清单' }
const CLOSED_FENCE = `${PARTIAL}\n\n\`\`\`coach-actions\n${JSON.stringify([PROVIDER_ACTION])}\n\`\`\``
const UNCLOSED_FENCE = CLOSED_FENCE.slice(0, -3)
const INTERRUPTION = '\n\n生成连接已中断，以上内容可能不完整。\n\n'
const RULE_TEXT = '【规则回复 · 在线模型当前不可用】\n当前摘要显示0个未完成待办（最多显示10个）：\n\n\n\n可打开完整清单核对和调整。'
function providerWire(parts: string[], done = true, newline = '\n', terminalDelimiter = true) {
  return parts.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}${newline}${newline}`).join('')
    + (done ? `data: [DONE]${terminalDelimiter ? `${newline}${newline}` : ''}` : '')
}
function bytesStream(payload: string, error?: Error) {
  const bytes = new TextEncoder().encode(payload)
  let offset = 0
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset < bytes.length) { controller.enqueue(bytes.slice(offset, offset + 7)); offset += 7; return }
    if (error) controller.error(error); else controller.close()
  } })
}
async function collect(payload: string, error?: Error) {
  const yielded: string[] = []
  try { for await (const delta of readChatCompletionStream(bytesStream(payload, error))) yielded.push(delta); return { yielded, completed: true } }
  catch (error) { return { yielded, completed: false, error } }
}

test('upstream requires DONE after EOF flush, preserves seven-byte UTF-8/CRLF and original reader errors', async () => {
  for (const newline of ['\n', '\r\n']) for (const terminalDelimiter of [true, false]) {
    assert.deepEqual(await collect(providerWire(['你', '好\n第二行'], true, newline, terminalDelimiter)), { yielded: ['你', '好\n第二行'], completed: true })
  }
  assert.deepEqual(await collect('data: [DONE]'), { yielded: [], completed: true })
  assert.deepEqual(await collect(providerWire([PARTIAL]) + providerWire(['忽略已完成后的事件'], false)), { yielded: [PARTIAL], completed: true })
  for (const content of [PARTIAL, '']) for (const finalDelimiter of [true, false]) {
    const payload = providerWire(content ? [content] : [], false)
    const result = await collect(finalDelimiter ? payload : payload.trimEnd())
    assert.equal(result.completed, false); assert.ok(result.error instanceof Error)
    assert.deepEqual(result.yielded, content ? [content] : [])
  }
  const original = new TypeError('Synthetic reader failure after partial content')
  const result = await collect(providerWire([PARTIAL], false), original)
  assert.deepEqual(result.yielded, [PARTIAL]); assert.equal(result.error, original)
})

test('unknown content sources retain the actual store normal action-fence cleanup', async () => {
  for (const source of ['RULE_FALLBACK', 'rule_fallback ', 'unknown', { source: 'rule_fallback' }]) {
    const before = structuredClone(useCoachStore.getState().messages)
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/chat'); assert.equal(init?.method, 'POST')
      const payload = [{ content: CLOSED_FENCE, source }, { actions: [PROVIDER_ACTION] }].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
      return new Response(bytesStream(payload), { headers: { 'X-Session-Id': 'synthetic-direct-session' } })
    }
    await useCoachStore.getState().sendMessage('查看待办', aiConnection)
    const messages = useCoachStore.getState().messages
    assert.deepEqual(messages.slice(0, -2), before)
    assert.equal(messages.at(-1)?.content, PARTIAL)
    assert.equal(messages.at(-1)?.actions?.[0].payload?.actionType, 'add_todo')
  }
})

test('real route and store preserve partial/fallback text and action source through EOF/error and the next normal reply', async t => {
  const cases: Array<{ name: string; content: string; done?: boolean; error?: Error }> = [
    { name: 'normal complete provider', content: CLOSED_FENCE, done: true },
    { name: 'partial normal EOF', content: PARTIAL },
    { name: 'empty normal EOF', content: '' },
    { name: 'closed fence normal EOF', content: CLOSED_FENCE },
    { name: 'unclosed fence normal EOF', content: UNCLOSED_FENCE },
    { name: 'closed fence reader error', content: CLOSED_FENCE, error: new TypeError('Synthetic reader failure') },
    { name: 'unclosed fence reader error', content: UNCLOSED_FENCE, error: new TypeError('Synthetic reader failure') },
    { name: 'normal provider after fallback', content: CLOSED_FENCE, done: true },
  ]
  for (const row of cases) await t.test(row.name, async () => {
    const before = structuredClone(useCoachStore.getState().messages), toastBefore = structuredClone(getToastSnapshot())
    const beforeIds = new Set((await prisma.chatMessage.findMany({ select: { id: true } })).map(message => message.id))
    let clientCalls = 0, providerCalls = 0, routeSession = '', responseWire: Promise<string> | undefined
    globalThis.fetch = async (url, init) => {
      if (url === '/api/chat') {
        clientCalls++; assert.equal(init?.method, 'POST')
        const response = await app.request('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: init?.body })
        assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8')
        routeSession = response.headers.get('X-Session-Id') ?? ''
        responseWire = response.clone().text(); return response
      }
      assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(init?.method, 'POST'); providerCalls++
      return new Response(bytesStream(providerWire(row.content ? [row.content] : [], row.done === true, '\r\n', false), row.error), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    await useCoachStore.getState().sendMessage('查看待办', aiConnection)
    const state = useCoachStore.getState(), [user, assistant] = state.messages.slice(-2)
    const expected = row.done ? PARTIAL : row.content + (row.content ? INTERRUPTION : '') + RULE_TEXT
    const expectedAction = row.done ? PROVIDER_ACTION : RULE_ACTION
    const wire = await responseWire
    assert.ok(wire); assert.equal(clientCalls, 1); assert.equal(providerCalls, 1)
    assert.deepEqual(state.messages.slice(0, -2), before)
    assert.equal(user.replyFailed, undefined); assert.equal(assistant.content, expected); assert.equal(state.isTyping, false)
    assert.equal(assistant.actions?.length, 1); assert.equal(assistant.actions[0].title, expectedAction.label)
    assert.equal(assistant.actions[0].payload?.actionType, expectedAction.type)
    assert.deepEqual(getToastSnapshot(), toastBefore, 'a completed rule fallback is not a failed client response')
    const saved = (await prisma.chatMessage.findMany({ where: { sessionId: routeSession } })).filter(message => !beforeIds.has(message.id))
    assert.equal(saved.length, 2)
    const savedAssistant = saved.find(message => message.role === 'assistant')
    assert.ok(savedAssistant); assert.equal(savedAssistant.content, expected); assert.deepEqual(JSON.parse(savedAssistant.actions!), [expectedAction])
    const historyResponse = await app.request(`/chat/sessions/${routeSession}/messages`)
    const history = (await historyResponse.json()).messages as Array<{ id: string; content: string; actions: unknown }>
    assert.ok(history.some(message => message.id === savedAssistant.id && message.content === expected))
    assert.deepEqual(history.find(message => message.id === savedAssistant.id)?.actions, [expectedAction])
    assert.ok(wire.endsWith('data: [DONE]\n\n')); assert.equal(wire.includes('"source":"rule_fallback"'), !row.done)
    assert.equal(wire.includes('生成连接已中断'), !row.done && Boolean(row.content))
    const counts = await Promise.all([prisma.todo.count(), prisma.expense.count(), prisma.habit.count(), prisma.habitCheckin.count(), prisma.schedule.count(), prisma.diary.count(), prisma.quickNote.count(), prisma.goal.count()])
    assert.deepEqual(counts, counts.map(() => 0)); assert.equal(db.isOpen(), false)
  })
})
