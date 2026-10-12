import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'

const scratch = await mkdtemp(join(tmpdir(), 'youtrace-coach-delete-'))
const file = join(scratch, 'synthetic.sqlite3')
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `file:${file}`, JWT_SECRET: 'synthetic-coach-deletion-at-least-32-chars', ALLOWED_ORIGINS: 'https://synthetic.invalid', DEV_OTP_EXPOSE: 'false', REQUEST_BODY_LIMIT_BYTES: '16384' })
const sql = new DatabaseSync(file, { enableDoubleQuotedStringLiterals: true })
sql.exec('PRAGMA foreign_keys=ON')
const migrations = resolve('prisma/migrations')
const latest = '20261012170000_coach_push_tombstones'
for (const name of (await readdir(migrations)).filter(n => /^\d/.test(n)).sort()) {
  if (name === latest) continue
  sql.exec(await readFile(join(migrations, name, 'migration.sql'), 'utf8'))
}
sql.exec(`INSERT INTO User(id,phone,nickname,updatedAt) VALUES('owner-a','synthetic-a','Synthetic A',0),('owner-b','synthetic-b','Synthetic B',0);
 INSERT INTO Push(id,userId,type,title,body,actions,createdAt) VALUES('legacy-live','owner-a','follow_up','  原题  ','  原文\n  ',' [] ',0);`)
const beforeMigration = sql.prepare('SELECT * FROM Push').all()
sql.exec(await readFile(join(migrations, latest, 'migration.sql'), 'utf8'))
const { prisma } = await import('../src/utils/db.js')
const { app } = await import('../src/app.js')
const { issueSession } = await import('../src/utils/session.js')
const fixture = new Hono()
let cookieA = '', cookieB = ''
fixture.route('/', app)
function request(path: string, method = 'GET', body?: unknown, cookie = cookieA) {
  return fixture.request('/api' + path, { method, headers: { Cookie: cookie, Origin: 'https://synthetic.invalid', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const status = (ids: string[], cookie = cookieA) => request('/coach/pushes/deletion-status', 'POST', { protocol: 1, ids }, cookie)
const makePush = (id: string, userId = 'owner-a') => prisma.push.create({ data: { id, userId, type: 'follow_up', title: 'Synthetic', body: 'Synthetic' } })
before(async () => {
  // Sessions are synthetic fixtures; the production auth middleware remains in use.
  const sessions = new Hono()
  sessions.get('/:id', async (c) => { issueSession(c, await prisma.user.findUniqueOrThrow({ where: { id: c.req.param('id') } })); return c.text('ok') })
  cookieA = (await sessions.request('/owner-a')).headers.get('set-cookie')!.split(';')[0]
  cookieB = (await sessions.request('/owner-b')).headers.get('set-cookie')!.split(';')[0]
})
after(async () => { sql.close(); await prisma.$disconnect(); await rm(scratch, { recursive: true, force: true }) })

test('additive migration preserves every old Push field and invents no historical tombstones', async () => {
  assert.deepEqual(sql.prepare('SELECT * FROM Push').all(), beforeMigration)
  assert.equal(await prisma.syncTombstone.count({ where: { entity: 'coachPushes' } }), 0)
  assert.deepEqual(await (await status(['legacy-live', 'historically-absent'])).json(), { protocol: 1, deletedIds: [] })
})

test('delete persists one owner-scoped tombstone atomically, repeat is idempotent, no v2 feed pollution', async () => {
  await makePush('delete-once')
  const changes = await prisma.syncChange.count()
  assert.equal((await request('/coach/pushes/delete-once', 'DELETE')).status, 200)
  assert.equal((await request('/coach/pushes/delete-once', 'DELETE')).status, 200)
  assert.equal(await prisma.push.count({ where: { id: 'delete-once' } }), 0)
  assert.equal(await prisma.syncTombstone.count({ where: { entity: 'coachPushes', entityId: 'delete-once' } }), 1)
  const response = await status(['delete-once', 'unknown'])
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { protocol: 1, deletedIds: ['delete-once'] })
  assert.equal(await prisma.syncChange.count(), changes)
})

test('foreign and unknown IDs reveal no existence and cannot forge deletion facts', async () => {
  for (const id of ['legacy-live', 'delete-once', 'never-existed']) assert.equal((await request('/coach/pushes/' + id, 'DELETE', undefined, cookieB)).status, 404)
  assert.deepEqual(await (await status(['legacy-live', 'delete-once', 'never-existed'], cookieB)).json(), { protocol: 1, deletedIds: [] })
  assert.equal(await prisma.syncTombstone.count({ where: { userId: 'owner-b' } }), 0)
  assert.equal((await request('/coach/pushes/never-existed', 'DELETE')).status, 404)
  assert.equal((await status(['delete-once'], '')).status, 401)
})

test('bounded deletion query rejects malformed, duplicate, empty and oversized requests', async () => {
  for (const body of [{ protocol: 2, ids: ['a'] }, { protocol: 1, ids: [] }, { protocol: 1, ids: ['a', 'a'] }, { protocol: 1, ids: [1] }, { protocol: 1, ids: ['a'], extra: true }, { protocol: 1, ids: ['x'.repeat(257)] }, { protocol: 1, ids: Array.from({ length: 101 }, (_, i) => 'id-' + i) }]) {
    assert.equal((await request('/coach/pushes/deletion-status', 'POST', body)).status, 400)
  }
  const exact = await status(Array.from({ length: 100 }, (_, i) => 'id-' + i))
  assert.equal(exact.status, 200)
  assert.deepEqual(await exact.json(), { protocol: 1, deletedIds: [] })
})

test('tombstone persistence failure rolls back the deleted source and permits safe retry', async () => {
  await makePush('rollback-delete')
  sql.exec(`CREATE TRIGGER synthetic_tombstone_fault BEFORE INSERT ON SyncTombstone WHEN NEW.entity='coachPushes' AND NEW.entityId='rollback-delete' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;`)
  try {
    assert.equal((await request('/coach/pushes/rollback-delete', 'DELETE')).status, 500)
    assert.equal(await prisma.push.count({ where: { id: 'rollback-delete' } }), 1)
    assert.equal(await prisma.syncTombstone.count({ where: { entityId: 'rollback-delete' } }), 0)
  } finally { sql.exec('DROP TRIGGER synthetic_tombstone_fault') }
  assert.equal((await request('/coach/pushes/rollback-delete', 'DELETE')).status, 200)
})

test('missing trigger fails closed instead of acknowledging an untracked deletion', async () => {
  await makePush('unmigrated-delete')
  const trigger = sql.prepare("SELECT sql FROM sqlite_master WHERE name='sync_Push_delete'").get()!.sql as string
  sql.exec('DROP TRIGGER sync_Push_delete')
  try {
    assert.equal((await request('/coach/pushes/unmigrated-delete', 'DELETE')).status, 503)
    assert.equal(await prisma.push.count({ where: { id: 'unmigrated-delete' } }), 1)
  } finally { sql.exec(trigger) }
})

test('same-ID resurrection and owner mutation are rejected; a genuinely new reminder survives', async () => {
  await assert.rejects(makePush('delete-once'))
  await assert.rejects(prisma.push.update({ where: { id: 'legacy-live' }, data: { userId: 'owner-b' } }))
  await assert.rejects(prisma.push.update({ where: { id: 'legacy-live' }, data: { id: 'changed-id' } }))
  await makePush('genuinely-new')
  assert.equal(await prisma.push.count({ where: { id: 'genuinely-new' } }), 1)
  assert.deepEqual(await (await status(['genuinely-new'])).json(), { protocol: 1, deletedIds: [] })
})

test('account deletion cascades old and newly triggered tombstones without FK failure', async () => {
  await makePush('account-deleted-push', 'owner-b')
  await makePush('account-prior-deleted-push', 'owner-b')
  assert.equal((await request('/coach/pushes/account-prior-deleted-push', 'DELETE', undefined, cookieB)).status, 200)
  assert.equal((await request('/user', 'DELETE', undefined, cookieB)).status, 200)
  assert.equal(await prisma.user.count({ where: { id: 'owner-b' } }), 0)
  assert.equal(await prisma.push.count({ where: { userId: 'owner-b' } }), 0)
  assert.equal(await prisma.syncTombstone.count({ where: { userId: 'owner-b' } }), 0)
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal((await status(['account-deleted-push'], cookieB)).status, 401)
})


test('exact 256-code-unit Unicode IDs are not normalized or truncated and 257 is explicitly rejected', async () => {
  const ids = ['中'.repeat(256), '😀'.repeat(128), 'v'.repeat(256)];
  for (const id of ids) { await makePush(id); await prisma.push.delete({ where: { id } }); }
  const response = await status(ids); assert.equal(response.status, 200);
  assert.deepEqual(((await response.json()) as { deletedIds: string[] }).deletedIds.sort(), [...ids].sort());
  assert.equal((await status(['中'.repeat(257)])).status, 400);
  assert.equal((await status(['😀'.repeat(128) + 'a'])).status, 400);
})
