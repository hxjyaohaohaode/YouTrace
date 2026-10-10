import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { serverAIConfiguration, publicServerAIConfiguration } from '../src/services/serverAI.js'
import { ServerAIBudget } from '../src/services/serverAIBudget.js'

const directory = await mkdtemp(resolve(tmpdir(), 'youtrace-server-ai-'))
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${directory}/synthetic.db`
process.env.JWT_SECRET = 'synthetic-server-ai-test-secret-at-least-32-characters'
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64')
const configured = { SERVER_AI_ENABLED: 'true', SERVER_AI_API_KEY: 'SYNTHETIC-SHARED-SECRET-NOT-REAL', SERVER_AI_BASE_URL: 'https://api.deepseek.com/v1', SERVER_AI_MODEL: 'deepseek-synthetic-model' }
Object.assign(process.env, configured)
const { prisma } = await import('../src/utils/db.js')
const { aiConnectionRoutes } = await import('../src/routes/aiConnection.js')
const { chatRoutes } = await import('../src/routes/chat.js')
const { todoRoutes } = await import('../src/routes/todos.js')
const { completeServerAI, saveConnection } = await import('../src/services/userAI.js')
const { consumeRateLimit } = await import('../src/utils/rateLimit.js')
const app = new Hono()
app.use('*', async (c, next) => { c.set('user', { id: 'synthetic-owner', phone: 'synthetic' }); await next() })
app.route('/connection', aiConnectionRoutes); app.route('/chat', chatRoutes); app.route('/todos', todoRoutes)
const originalFetch = globalThis.fetch
let counter = 0
const send = (path: string, method = 'GET', data?: unknown) => app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) })
const selection = () => ({ configurationId: publicServerAIConfiguration()!.configurationId, consent: true })
const wire = (parts: string[]) => parts.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
async function collect(stream: AsyncGenerator<string>) { let text = ''; for await (const part of stream) text += part; return text }
const complete = (signal = new AbortController().signal) => completeServerAI(`synthetic-request-${counter++}`, selection().configurationId, [{ role: 'user', content: 'Synthetic question' }], signal)
before(async () => {
  const db = new DatabaseSync(`${directory}/synthetic.db`, { enableDoubleQuotedStringLiterals: true })
  for (const name of (await readdir(resolve('prisma/migrations'))).filter(name => !name.endsWith('.toml')).sort()) db.exec(await readFile(resolve('prisma/migrations', name, 'migration.sql'), 'utf8'))
  db.close()
  await prisma.user.create({ data: { id: 'synthetic-owner', phone: 'synthetic-owner', nickname: 'Synthetic' } })
})
afterEach(() => { globalThis.fetch = originalFetch; Object.assign(process.env, configured) })
after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }) })

test('shared AI requires explicit complete opt-in; legacy variables ignored', () => {
  assert.equal(serverAIConfiguration({}), null)
  assert.equal(serverAIConfiguration({ LLM_API_KEY: 'synthetic', LLM_BASE_URL: configured.SERVER_AI_BASE_URL, LLM_MODEL: 'synthetic' }), null)
  for (const name of Object.keys(configured)) assert.equal(serverAIConfiguration({ ...configured, [name]: '' }), null)
  assert.equal(serverAIConfiguration({ ...configured, SERVER_AI_ENABLED: 'false' }), null)
  assert.ok(serverAIConfiguration(configured))
})

test('only exact official domestic provider endpoints and their own model families work', () => {
  for (const [base, model] of [['https://api.deepseek.com', 'deepseek-synthetic'], ['https://api.deepseek.com/v1/', 'deepseek-synthetic'], ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3-synthetic'], ['https://api.xiaomimimo.com/v1', 'mimo-synthetic']]) assert.ok(serverAIConfiguration({ ...configured, SERVER_AI_BASE_URL: base, SERVER_AI_MODEL: model }), base)
  for (const base of ['https://api.openai.com/v1', 'https://example.com/v1', 'http://api.deepseek.com/v1', 'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://169.254.169.254', 'https://api.deepseek.com.evil.com/v1', 'https://u:p@api.deepseek.com/v1', 'https://api.deepseek.com/v1?key=secret', 'https://api.deepseek.com/v1#x', 'https://api.deepseek.com:444/v1', 'https://api.deepseek.com/v1/../v1', 'https://api.deepseek.com/%76%31']) assert.equal(serverAIConfiguration({ ...configured, SERVER_AI_BASE_URL: base }), null, base)
  assert.equal(serverAIConfiguration({ ...configured, SERVER_AI_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', SERVER_AI_MODEL: 'foreign-model' }), null)
})

test('public metadata has no secret; consent binds endpoint, model and key rotation', () => {
  const pub = publicServerAIConfiguration()!
  assert.equal(JSON.stringify(pub).includes(configured.SERVER_AI_API_KEY), false)
  assert.deepEqual(Object.keys(pub).sort(), ['configurationId', 'endpoint', 'model'])
  for (const patch of [{ SERVER_AI_MODEL: 'deepseek-new-model' }, { SERVER_AI_API_KEY: 'NEW-SYNTHETIC-SECRET' }, { SERVER_AI_BASE_URL: 'https://api.deepseek.com' }]) assert.notEqual(serverAIConfiguration({ ...configured, ...patch })!.configurationId, pub.configurationId)
})

test('disabled and partial AI leave real CRUD and rules functional with zero external calls', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('no external calls') }
  for (const patch of [{ SERVER_AI_ENABLED: 'false' }, { SERVER_AI_API_KEY: '' }]) {
    Object.assign(process.env, configured, patch)
    assert.equal((await (await send('/connection')).json()).serverAI, null)
    const created = await send('/todos', 'POST', { text: 'Synthetic CRUD without AI' }); assert.equal(created.status, 201)
    const { todo } = await created.json()
    assert.equal((await send(`/todos/${todo.id}`, 'PUT', { text: 'Updated synthetic record' })).status, 200)
    assert.equal((await send('/todos')).status, 200)
    assert.equal((await send(`/todos/${todo.id}`, 'DELETE')).status, 200)
    assert.match(await (await send('/chat', 'POST', { message: '查看待办' })).text(), /rule_fallback/)
  }
  assert.equal(calls, 0)
})

test('deployment credentials do not automatically select shared model', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('must not dispatch') }
  assert.match(await (await send('/chat', 'POST', { message: 'Synthetic unselected chat' })).text(), /rule_fallback/)
  assert.equal(calls, 0)
})

test('explicit shared chat sends bounded conversation only and never proposes model actions', async () => {
  const todo = await prisma.todo.create({ data: { id: 'synthetic-private-record', userId: 'synthetic-owner', text: 'PRIVATE-APP-RECORD-DO-NOT-TRANSMIT' } })
  let calls = 0
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(String(url), 'https://api.deepseek.com/v1/chat/completions'); assert.equal(init?.redirect, 'error')
    const data = JSON.parse(String(init?.body)); assert.equal(data.model, configured.SERVER_AI_MODEL)
    assert.equal(String(init?.body).includes(todo.text), false); assert.equal(data.max_tokens, 1024); assert.deepEqual(data.thinking, { type: 'disabled' }); assert.ok(init?.signal)
    return new Response(wire(['Synthetic answer\n```coach-actions\n[{"type":"add_todo","text":"MUST-NOT-EXECUTE","label":"No"}]\n```']))
  }
  const response = await send('/chat', 'POST', { message: 'Synthetic explicit chat', serverAI: selection() })
  const text = await response.text(); assert.match(text, /Synthetic answer/); assert.equal(text.includes('"actions":'), false); assert.equal(calls, 1)
  assert.equal((await prisma.chatMessage.findFirstOrThrow({ where: { sessionId: response.headers.get('X-Session-Id')!, role: 'assistant' } })).source, 'server_ai')
  assert.equal(await prisma.todo.count({ where: { text: 'MUST-NOT-EXECUTE' } }), 0)
})

test('unconsented, stale and ambiguous selections never dispatch', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('must not dispatch') }
  assert.equal((await send('/chat', 'POST', { message: 'test', serverAI: { ...selection(), consent: false } })).status, 400)
  assert.equal((await send('/chat', 'POST', { message: 'test', serverAI: { ...selection(), configurationId: '0'.repeat(64) } })).status, 409)
  assert.equal((await send('/chat', 'POST', { message: 'test', serverAI: selection(), aiConnection: { connectionId: '00000000-0000-4000-8000-000000000001', version: 1 } })).status, 400)
  assert.equal(calls, 0)
})

test('BYOK remains independent and never falls over to the deployment key', async () => {
  const saved = await saveConnection('synthetic-owner', { connectionId: null, version: 0, providerId: 'qwen', model: 'synthetic-owned-model', apiKey: 'SYNTHETIC-OWNED-KEY', chatConsent: true })
  let calls = 0; globalThis.fetch = async (url, init) => {
    calls++; assert.match(String(url), /^https:\/\/dashscope.aliyuncs.com\//)
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer SYNTHETIC-OWNED-KEY')
    return new Response('', { status: 503 })
  }
  const text = await (await send('/chat', 'POST', { message: 'Synthetic BYOK failure', aiConnection: { connectionId: saved!.connectionId, version: saved!.version } })).text()
  assert.match(text, /rule_fallback/); assert.equal(calls, 1)
})

test('provider failures and redirects reject without retries', async () => {
  for (const status of [302, 401, 429, 500]) {
    let calls = 0; globalThis.fetch = async () => { calls++; return new Response('', { status, headers: { Location: 'https://127.0.0.1' } }) }
    await assert.rejects(collect(complete()), /AI_PROVIDER_UNAVAILABLE/); assert.equal(calls, 1)
  }
  globalThis.fetch = async () => { const r = new Response(wire(['wrong endpoint'])); Object.defineProperty(r, 'url', { value: 'https://elsewhere.example' }); return r }
  await assert.rejects(collect(complete()), /AI_REDIRECT_REJECTED/)
})

test('split secret response is suppressed across chunks', async () => {
  const secret = configured.SERVER_AI_API_KEY; let output = ''
  globalThis.fetch = async () => new Response(wire(['Safe text ', secret.slice(0, 12), secret.slice(12)]))
  await assert.rejects(async () => { for await (const part of complete()) output += part }, /AI_RESPONSE_REJECTED/)
  assert.equal(output, 'Safe text ')
})

test('cancellation releases shared slot and aborts provider', async () => {
  const controller = new AbortController()
  globalThis.fetch = async (_url, init) => { controller.abort(); init!.signal!.throwIfAborted(); throw Error('unreachable') }
  await assert.rejects(collect(complete(controller.signal)), /AI_REQUEST_CANCELLED/)
  globalThis.fetch = async () => new Response(wire(['Recovered']))
  assert.equal(await collect(complete()), 'Recovered')
})

test('shared output and wire byte ceilings remain bounded', async () => {
  globalThis.fetch = async () => new Response(wire(['x'.repeat(16001)]))
  await assert.rejects(collect(complete()), /AI_RESPONSE_TOO_LARGE/)
  globalThis.fetch = async () => new Response('x'.repeat(256001))
  await assert.rejects(collect(complete()), /AI_PROVIDER_UNAVAILABLE/)
})

test('dedicated budget caps concurrency and account usage independent of IP', () => {
  const b = new ServerAIBudget(); const now = 10_000_000
  const one = b.acquire('one', now)!; const two = b.acquire('two', now)!
  assert.equal(b.acquire('three', now), null); one(); one(); two()
  for (let i = 1; i < 20; i++) b.acquire('one', now)!()
  assert.equal(b.acquire('one', now), null); assert.ok(b.acquire('one', now + 60001))
})

test('unrelated 20000+ auth buckets cannot evict 60-request site budget', () => {
  const b = new ServerAIBudget(); const now = 10_000_000
  for (let i = 0; i < 60; i++) b.acquire(`owner-${i}`, now)!()
  for (let i = 0; i < 21000; i++) consumeRateLimit(`synthetic-other-${i}`, { limit: 1, windowMs: 60000 })
  assert.equal(b.acquire('new-owner', now), null); assert.ok(b.acquire('new-owner', now + 3600001))
})

test('shared domestic provider parameters disable thinking and use one 1024-token cap', async () => {
  for (const [base, model, expected] of [
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3-synthetic', { max_completion_tokens: 1024, enable_thinking: false }],
    ['https://api.xiaomimimo.com/v1', 'mimo-synthetic', { max_completion_tokens: 1024, thinking: { type: 'disabled' } }],
    ['https://api.deepseek.com', 'deepseek-synthetic', { max_tokens: 1024, thinking: { type: 'disabled' } }],
  ] as const) {
    Object.assign(process.env, configured, { SERVER_AI_BASE_URL: base, SERVER_AI_MODEL: model })
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const { messages: _messages, model: _model, stream: _stream, ...options } = body
      assert.deepEqual(options, expected)
      return new Response(wire(['Synthetic response']))
    }
    assert.equal(await collect(complete()), 'Synthetic response')
  }
})

test('the 30-second total timeout signal aborts a provider request and releases its slot', async (t) => {
  const nativeTimeout = AbortSignal.timeout
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { assert.equal(ms, 30000); return nativeTimeout(10) })
  const keepAlive = setTimeout(() => undefined, 200)
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
  })
  try { await assert.rejects(collect(complete()), /AI_PROVIDER_UNAVAILABLE/) }
  finally { clearTimeout(keepAlive); t.mock.restoreAll() }
  globalThis.fetch = async () => new Response(wire(['After timeout']))
  assert.equal(await collect(complete()), 'After timeout')
})
