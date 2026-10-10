import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'

const directory = await mkdtemp(resolve(tmpdir(), 'youtrace-owned-ai-'))
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${directory}/synthetic.db`
process.env.JWT_SECRET = 'synthetic-ai-owned-signing-secret-long-enough-for-tests'
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.LLM_API_KEY = 'FIXTURE-OLD-SHARED-KEY-MUST-BE-IGNORED'
process.env.LLM_BASE_URL = 'https://forbidden.invalid'
const { prisma } = await import('../src/utils/db.js')
const { aiConnectionRoutes } = await import('../src/routes/aiConnection.js')
const { chatRoutes } = await import('../src/routes/chat.js')
const { userRoutes } = await import('../src/routes/user.js')
const { AI_PROVIDERS, chatMessages, completeUserAI, encryptCredential, publicConnection, selectedConnection } = await import('../src/services/userAI.js')
type Connection = NonNullable<ReturnType<typeof publicConnection>>
const app = new Hono()
app.use('*', async (c, next) => { c.set('user', { id: c.req.header('X-Test-Owner') ?? 'owner-a', phone: 'synthetic' }); await next() })
app.route('/connection', aiConnectionRoutes)
app.route('/chat', chatRoutes)
app.route('/user', userRoutes)
const originalFetch = globalThis.fetch
const originalKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY
let ownerCounter = 0
const fixtureKey = 'FIXTURE-PRIVATE-KEY-NOT-REAL'
const body = { connectionId: null, version: 0, providerId: 'deepseek' as const, model: 'fixture-explicit-model', apiKey: fixtureKey, chatConsent: true }
const send = (path: string, method = 'GET', data?: unknown, owner = 'owner-a', signal?: AbortSignal) => app.request(path, { method, headers: { 'Content-Type': 'application/json', 'X-Test-Owner': owner }, body: data === undefined ? undefined : JSON.stringify(data), signal })
async function newOwner() { const id = `synthetic-ai-owner-${++ownerCounter}`; await prisma.user.create({ data: { id, phone: id, nickname: 'Synthetic' } }); return id }
async function add(owner: string, patch: Partial<typeof body> = {}): Promise<Connection> {
  const response = await send('/connection', 'PUT', { ...body, ...patch }, owner)
  assert.equal(response.status, 200, await response.clone().text())
  return (await response.json()).connection
}
function wire(parts: string[], done = true) {
  return parts.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '')
}
async function collect(stream: AsyncGenerator<string>) { let out = ''; for await (const part of stream) out += part; return out }
const migrations = (await readdir(resolve('prisma/migrations'))).filter(name => !name.endsWith('.toml')).sort()
before(async () => {
  const db = new DatabaseSync(`${directory}/synthetic.db`, { enableDoubleQuotedStringLiterals: true })
  for (const migration of migrations) db.exec(await readFile(resolve('prisma/migrations', migration, 'migration.sql'), 'utf8'))
  db.close()
  await prisma.user.create({ data: { id: 'owner-a', phone: 'owner-a', nickname: 'Synthetic' } })
})
afterEach(() => { globalThis.fetch = originalFetch; process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalKey })
after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }) })

test('new accounts are empty despite old shared environment keys, and local chat never dispatches', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('MUST_NOT_DISPATCH') }
  const response = await send('/connection'); assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const config = await response.json()
  assert.equal(config.connection, null); assert.equal(config.templates.length, 4)
  assert.ok(config.templates.every((row: Record<string, unknown>) => !('model' in row) && !('apiKey' in row)))
  const chat = await send('/chat', 'POST', { message: '查看待办' })
  const text = await chat.text(); assert.match(text, /rule_fallback/); assert.equal(calls, 0)
})

test('credential saving is encrypted, write-only, owned and versioned; no endpoint override', async () => {
  const owner = await newOwner(); const connection = await add(owner)
  const row = await prisma.userAIConnection.findUniqueOrThrow({ where: { userId: owner } })
  assert.deepEqual(publicConnection(row), connection)
  assert.notEqual(row.cipher, fixtureKey); assert.equal(row.cipher.includes(fixtureKey), false)
  assert.equal(JSON.stringify(connection).includes(fixtureKey), false)
  const catalog = await send('/connection', 'GET', undefined, owner)
  const text = await catalog.text(); assert.ok(!text.includes(fixtureKey) && !text.includes(row.cipher))
  assert.equal((await send('/connection', 'PUT', { ...body, connectionId: connection.connectionId, version: 1, apiKey: '' }, 'owner-a')).status, 409)
  assert.equal((await send('/connection/remove', 'POST', { connectionId: connection.connectionId, version: 1 }, 'owner-a')).status, 409)
  assert.equal((await send('/connection', 'PUT', { ...body, baseUrl: 'https://127.0.0.1' }, owner)).status, 400)
  assert.equal((await send('/connection', 'PUT', { ...body, providerId: 'https://evil.invalid' }, owner)).status, 400)
  assert.equal((await send('/connection', 'PUT', { ...body, connectionId: connection.connectionId, version: 1, providerId: 'glm', apiKey: '' }, owner)).status, 422)
  const updates = await Promise.all(['new-model-1', 'new-model-2'].map(model => send('/connection', 'PUT', { ...body, connectionId: connection.connectionId, version: 1, model, apiKey: '' }, owner)))
  assert.equal(updates.filter(result => result.status === 200).length, 1)
  assert.equal((await prisma.userAIConnection.findUniqueOrThrow({ where: { userId: owner } })).version, 2)
})

test('missing storage key fails closed without creating or overwriting ciphertext', async () => {
  const owner = await newOwner()
  delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY
  assert.equal((await send('/connection', 'PUT', body, owner)).status, 503)
  assert.equal(await prisma.userAIConnection.count({ where: { userId: owner } }), 0)
})

test('delete and recreate cannot reuse an old connection identity or chat permission', async () => {
  const owner = await newOwner(); const old = await add(owner)
  assert.equal((await send('/connection/remove', 'POST', { connectionId: old.connectionId, version: old.version }, owner)).status, 200)
  const fresh = await add(owner, { chatConsent: false })
  assert.notEqual(old.connectionId, fresh.connectionId)
  assert.equal((await send('/connection/remove', 'POST', { connectionId: old.connectionId, version: 1 }, owner)).status, 409)
  assert.equal((await send('/chat', 'POST', { message: 'Synthetic question', aiConnection: { connectionId: old.connectionId, version: 1 } }, owner)).status, 409)
  assert.equal((await send('/chat', 'POST', { message: 'Synthetic question', aiConnection: { connectionId: fresh.connectionId, version: 1 } }, owner)).status, 422)
})

test('only provenance-marked current conversation text is sent, not app data or local/legacy history', async () => {
  const owner = await newOwner(); const connection = await add(owner)
  const session = await prisma.chatSession.create({ data: { id: `${owner}-chat`, userId: owner, triggerType: 'user_initiated' } })
  await prisma.chatMessage.createMany({ data: [
    { id: `${owner}-legacy`, sessionId: session.id, role: 'assistant', content: 'FORBIDDEN-LEGACY-EXPENSE-SUMMARY' },
    { id: `${owner}-rule`, sessionId: session.id, role: 'assistant', content: 'FORBIDDEN-RULE-DIARY-SUMMARY', source: 'rule_fallback' },
    { id: `${owner}-known`, sessionId: session.id, role: 'assistant', content: 'Known own-model answer', source: 'user_ai' },
  ] })
  await prisma.todo.create({ data: { id: `${owner}-todo`, userId: owner, text: 'FORBIDDEN-APP-RECORD' } })
  let payload = ''; let calls = 0
  globalThis.fetch = async (url, init) => { calls++; assert.equal(url, AI_PROVIDERS[0].endpoint); assert.equal(init?.redirect, 'error'); payload = String(init?.body); return new Response(wire(['Synthetic model answer'])) }
  const response = await send('/chat', 'POST', { message: 'Explicit current user message', sessionId: session.id, aiConnection: { connectionId: connection.connectionId, version: connection.version } }, owner)
  const result = await response.text(); assert.match(result, /Synthetic model answer/); assert.equal(calls, 1)
  assert.ok(payload.includes('Explicit current user message') && payload.includes('Known own-model answer'))
  assert.ok(!payload.includes('FORBIDDEN-') && !payload.includes(fixtureKey))
  const messages = await prisma.chatMessage.findMany({ where: { sessionId: session.id } })
  assert.equal(messages.find(message => message.content === 'Synthetic model answer')?.source, 'user_ai')
  assert.equal(messages.find(message => message.content === 'Explicit current user message')?.source, 'user_text')
  const bounded = chatMessages(Array.from({ length: 30 }, (_, n) => ({ role: 'user', content: 'x'.repeat(n === 29 ? 2000 : 1000), source: 'user_text' })))
  assert.ok(bounded.length <= 21 && bounded.slice(1).reduce((total, message) => total + message.content.length, 0) <= 12000)
})

test('probe requires explicit charge confirmation and sends only a generic bounded message', async () => {
  const owner = await newOwner(); const connection = await add(owner, { chatConsent: false })
  const identity = { connectionId: connection.connectionId, version: connection.version }
  let calls = 0; let payload = ''
  globalThis.fetch = async (_url, init) => { calls++; payload = String(init?.body); return new Response(wire(['OK'])) }
  assert.equal((await send('/connection/probe', 'POST', identity, owner)).status, 400)
  const result = await send('/connection/probe', 'POST', { ...identity, confirmProviderCharge: true }, owner)
  assert.equal(result.status, 200, await result.clone().text()); assert.equal(calls, 1)
  const request = JSON.parse(payload); assert.deepEqual(request.messages, [{ role: 'user', content: 'Connection test. Reply OK.' }]); assert.equal(request.max_tokens, 32)
})

test('redacted failures and oversized bodies never leak secrets or retry another provider', async () => {
  const owner = await newOwner(); const connection = await add(owner)
  const row = await selectedConnection(owner, connection.connectionId, connection.version)
  for (const response of [new Response(fixtureKey, { status: 401 }), new Response('x'.repeat(256001)), new Response(wire(['hello ', fixtureKey.slice(0, 8), fixtureKey.slice(8)]))]) {
    let calls = 0; let received = ''
    globalThis.fetch = async () => { calls++; return response }
    await assert.rejects(async () => { for await (const text of completeUserAI(row, [{ role: 'user', content: 'Synthetic' }], new AbortController().signal)) received += text }, error => error instanceof Error && !error.message.includes(fixtureKey))
    assert.equal(calls, 1); assert.ok(!received.includes(fixtureKey) && !received.includes(fixtureKey.slice(0, 8)))
  }
  globalThis.fetch = async () => { throw new Error(`unsafe upstream ${fixtureKey}`) }
  await assert.rejects(collect(completeUserAI(row, [], new AbortController().signal)), error => error instanceof Error && error.message === 'AI_PROVIDER_UNAVAILABLE')
})

test('credential ciphertext cannot be moved to another owner or service', async () => {
  const owner = await newOwner(); const connection = await add(owner)
  const row = await selectedConnection(owner, connection.connectionId, connection.version)
  const cipher = encryptCredential('different-owner', row.providerId, fixtureKey)
  await prisma.userAIConnection.update({ where: { userId: owner }, data: { cipher } })
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('MUST_NOT_SEND') }
  await assert.rejects(collect(completeUserAI({ ...row, cipher }, [], new AbortController().signal)), /AI_CREDENTIALS_UNAVAILABLE/)
  assert.equal(calls, 0)
})

for (const ending of ['remove_connection', 'delete_account']) test(`${ending} cancels an in-flight body and does not store a fallback success`, async () => {
  const owner = await newOwner(); const connection = await add(owner)
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve })
  let cancelled = false
  globalThis.fetch = async () => { entered(); return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })) }
  const pending = send('/chat', 'POST', { message: 'Synthetic question', aiConnection: { connectionId: connection.connectionId, version: connection.version } }, owner)
  await started
  const response = await pending
  const text = response.text()
  const removed = ending === 'delete_account' ? await send('/user', 'DELETE', undefined, owner) : await send('/connection/remove', 'POST', { connectionId: connection.connectionId, version: connection.version }, owner)
  assert.equal(removed.status, 200)
  assert.equal(await text, ''); assert.equal(cancelled, true)
  assert.equal(await prisma.chatMessage.count({ where: { session: { userId: owner }, role: 'assistant' } }), 0)
})

test('new migration preserves old chat bytes and rolls back a failed ALTER atomically', async () => {
  const sql = await readFile(resolve('prisma/migrations/20261010040000_user_owned_ai/migration.sql'), 'utf8')
  const db = new DatabaseSync(`${directory}/legacy.db`, { enableDoubleQuotedStringLiterals: true })
  try {
    for (const migration of migrations.filter(name => name < '20261010040000_user_owned_ai')) db.exec(await readFile(resolve('prisma/migrations', migration, 'migration.sql'), 'utf8'))
    db.exec(`INSERT INTO User (id,phone,nickname,updatedAt) VALUES ('legacy','legacy','Synthetic',CURRENT_TIMESTAMP); INSERT INTO ChatSession (id,userId,triggerType) VALUES ('legacy-session','legacy','user_initiated'); INSERT INTO ChatMessage (id,sessionId,role,content) VALUES ('legacy-message','legacy-session','assistant','Original unchanged history');`)
    assert.throws(() => db.exec(sql.replace('ALTER TABLE "ChatMessage"', 'ALTER TABLE "MissingTable"')))
    db.exec('ROLLBACK')
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='UserAIConnection'").get()?.n, 0)
    db.exec(sql)
    assert.deepEqual({ ...db.prepare('SELECT content,source FROM ChatMessage').get() }, { content: 'Original unchanged history', source: 'legacy' })
    assert.equal(db.prepare('SELECT count(*) n FROM UserAIConnection').get()?.n, 0)
  } finally { db.close() }
})
