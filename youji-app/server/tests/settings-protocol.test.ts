import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'

const directory = await mkdtemp('/tmp/youtrace-preference-tests-')
const database = join(directory, 'synthetic.db')
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = `file:${database}`
process.env.JWT_SECRET = 'synthetic-settings-test-secret-at-least-32-characters'
process.env.LLM_API_KEY = ''
process.env.SMS_PROVIDER_URL = ''
process.env.SMS_PROVIDER_TOKEN = ''
const { prisma } = await import('../src/utils/db.js')
let app: Hono
let seq = 0
const owner = 'synthetic-preference-owner'
const revision = async () => (await (await app.request('/user/settings')).json() as { revision: string }).revision
const patch = (changes: Record<string, unknown>, baseRevision: string, mutationId = `synthetic-mutation-${++seq}`) => app.request('/user/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol: 1, mutationId, baseRevision, changes }) })
const migrations = (await readdir(resolve('prisma/migrations'), { withFileTypes: true })).filter((row) => row.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
before(async () => {
  const fixture = new DatabaseSync(database, { enableDoubleQuotedStringLiterals: true })
  for (const entry of migrations) fixture.exec(await readFile(resolve('prisma/migrations', entry.name, 'migration.sql'), 'utf8'))
  fixture.close()
  await prisma.user.create({ data: { id: owner, phone: '13900000971', nickname: 'synthetic' } })
  const { userRoutes } = await import('../src/routes/user.js')
  app = new Hono()
  app.use('*', async (c, next) => { c.set('user', { id: c.req.header('X-Test-Owner') ?? owner, phone: '13900000971' }); await next() })
  app.route('/user', userRoutes)
})
after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }) })

test('new account defaults are quiet and complete; old unversioned clients fail closed', async () => {
  const response = await app.request('/user/settings')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json() as { protocol: number; revision: string; settings: Record<string, unknown> }
  assert.equal(data.protocol, 1); assert.equal(data.revision, '0')
  assert.equal(data.settings.coachPushEnabled, false); assert.equal(data.settings.quietEnabled, true)
  assert.equal(data.settings.eveningReviewEnabled, false); assert.equal(data.settings.eveningReviewTime, '21:00')
  const old = await app.request('/user/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coachStyle: 'strict' }) })
  assert.equal(old.status, 426); assert.equal(await revision(), '0')
})

test('all reminder fields save atomically and User remains a compatibility mirror', async () => {
  const changes = { coachStyle: 'strict', coachPushEnabled: true, pushLimit: 1, quietEnabled: true, quietStart: '22:30', quietEnd: '07:30', eveningReviewEnabled: true, eveningReviewTime: '20:45' }
  const response = await patch(changes, await revision())
  assert.equal(response.status, 200)
  const data = await response.json() as { acknowledged: boolean; settings: unknown }
  assert.equal(data.acknowledged, true); assert.deepEqual(data.settings, changes)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: owner } })
  assert.equal(user.coachStyle, 'strict'); assert.equal(user.pushLimit, 1); assert.equal(user.quietStart, '22:30'); assert.equal(user.quietEnd, '07:30')
})

test('lost successful response retry returns its receipt without overwriting a newer device', async () => {
  const base = await revision()
  const receipt = await (await patch({ coachStyle: 'gentle' }, base, 'lost-response-mutation')).json() as { revision: string }
  assert.equal((await patch({ coachStyle: 'data' }, receipt.revision)).status, 200)
  const retry = await patch({ coachStyle: 'gentle' }, base, 'lost-response-mutation')
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), receipt)
  assert.equal((await prisma.accountPreferences.findUniqueOrThrow({ where: { userId: owner } })).coachStyle, 'data')
})

test('stale first attempt and reused mutation ID preserve newer policy', async () => {
  const previous = await revision()
  assert.equal((await patch({ coachPushEnabled: false }, previous)).status, 200)
  const stale = await patch({ coachPushEnabled: true }, previous)
  assert.equal(stale.status, 409)
  const conflict = await stale.json() as { code: string; conflict: { settings: { coachPushEnabled: boolean } } }
  assert.equal(conflict.code, 'SETTINGS_VERSION_CONFLICT'); assert.equal(conflict.conflict.settings.coachPushEnabled, false)
  const reused = await patch({ coachStyle: 'strict' }, previous, 'lost-response-mutation')
  assert.equal(reused.status, 409); assert.equal((await reused.json() as { code: string }).code, 'SETTINGS_MUTATION_REUSED')
})

test('competing same-revision requests never both overwrite successfully', async () => {
  const base = await revision()
  const results = await Promise.all([patch({ pushLimit: 2 }, base), patch({ pushLimit: 3 }, base)])
  assert.equal(results.filter((row) => row.status === 200).length, 1)
  assert.ok(results.every((row) => [200, 409, 503].includes(row.status)))
  assert.equal(Number(await revision()), Number(base) + 1)
})

test('receipts are owner scoped and malformed or device input never writes', async () => {
  const base = await revision()
  assert.equal((await patch({ eveningReviewTime: '25:90' }, base)).status, 400)
  assert.equal((await patch({ theme: 'dark' }, base)).status, 400)
  assert.equal(await revision(), base)
  await prisma.user.create({ data: { id: 'synthetic-preference-other', phone: '13900000972', nickname: 'other' } })
  const response = await app.request('/user/settings', { headers: { 'X-Test-Owner': 'synthetic-preference-other' } })
  assert.equal((await response.json() as { revision: string }).revision, '0')
  assert.equal(await prisma.accountPreferenceReceipt.count({ where: { userId: 'synthetic-preference-other' } }), 0)
})

test('migration preserves legacy fields and switches default conservatively', async () => {
  const fixture = new DatabaseSync(join(directory, 'legacy.db'), { enableDoubleQuotedStringLiterals: true })
  try {
    for (const entry of migrations.filter((row) => row.name < '20261004000003_account_preferences')) fixture.exec(await readFile(resolve('prisma/migrations', entry.name, 'migration.sql'), 'utf8'))
    fixture.exec(`INSERT INTO "User" ("id","phone","nickname","coachStyle","quietStart","quietEnd","pushLimit","updatedAt") VALUES ('old','13900000973','synthetic','data','21:00','08:00',1,CURRENT_TIMESTAMP)`)
    fixture.exec(await readFile(resolve('prisma/migrations/20261004000003_account_preferences/migration.sql'), 'utf8'))
    const row = fixture.prepare('SELECT * FROM AccountPreferences WHERE userId = ?').get('old')
    assert.equal(row?.coachStyle, 'data'); assert.equal(row?.pushLimit, 1); assert.equal(row?.quietStart, '21:00'); assert.equal(row?.coachPushEnabled, 0); assert.equal(row?.quietEnabled, 1)
  } finally { fixture.close() }
})

test('interrupted preference migration rolls back tables and preserves populated User values', async () => {
  const fixture = new DatabaseSync(join(directory, 'interrupted.db'), { enableDoubleQuotedStringLiterals: true })
  try {
    for (const entry of migrations.filter((row) => row.name < '20261004000003_account_preferences')) fixture.exec(await readFile(resolve('prisma/migrations', entry.name, 'migration.sql'), 'utf8'))
    fixture.exec(`INSERT INTO "User" ("id","phone","nickname","coachStyle","updatedAt") VALUES ('preserved','13900000974','synthetic','strict',CURRENT_TIMESTAMP)`)
    const migration = await readFile(resolve('prisma/migrations/20261004000003_account_preferences/migration.sql'), 'utf8')
    assert.throws(() => fixture.exec(migration.replace('SELECT "id",', 'SELECT missing_preference_column,')), /column/i)
    fixture.exec('ROLLBACK;')
    assert.equal(fixture.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('AccountPreferences','AccountPreferenceReceipt')").get()?.count, 0)
    assert.equal(fixture.prepare('SELECT coachStyle FROM User WHERE id = ?').get('preserved')?.coachStyle, 'strict')
    fixture.exec(migration)
    assert.equal(fixture.prepare('SELECT coachStyle FROM AccountPreferences WHERE userId = ?').get('preserved')?.coachStyle, 'strict')
  } finally { fixture.close() }
})

test('missing preference schema never falls back to an unversioned User write', async () => {
  const beforeStyle = (await prisma.user.findUniqueOrThrow({ where: { id: owner } })).coachStyle
  await prisma.$executeRawUnsafe('DROP TABLE AccountPreferenceReceipt')
  const response = await patch({ coachStyle: 'gentle' }, await revision())
  assert.equal(response.status, 503)
  assert.equal((await response.json() as { code: string }).code, 'SETTINGS_SCHEMA_UNAVAILABLE')
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner } })).coachStyle, beforeStyle)
})
