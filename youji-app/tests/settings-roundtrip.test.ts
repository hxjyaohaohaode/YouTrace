import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = await mkdtemp('/tmp/youtrace-preference-roundtrip-');
const file = join(directory, 'synthetic.db');
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `file:${file}`, JWT_SECRET: 'synthetic-settings-roundtrip-secret-min-32', ALLOWED_ORIGINS: 'http://settings.invalid', DEV_OTP_EXPOSE: 'false', LLM_API_KEY: '', SMS_PROVIDER_URL: '', SMS_PROVIDER_TOKEN: '' });
const memoryStorage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) }; };
Object.assign(globalThis, { localStorage: memoryStorage(), sessionStorage: memoryStorage(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {} }), location: { replace() {} } }), document: { documentElement: { setAttribute() {} } } });
const fixture = new DatabaseSync(file, { enableDoubleQuotedStringLiterals: true });
for (const name of (await readdir(resolve('server/prisma/migrations'))).filter((name) => /^\d/.test(name)).sort()) fixture.exec(await readFile(resolve('server/prisma/migrations', name, 'migration.sql'), 'utf8'));
fixture.close();
const { prisma } = await import('../server/src/utils/db.ts');
const { app } = await import('../server/src/app.ts');
const { issueSession } = await import('../server/src/utils/session.ts');
const { readAccountPreferences, writeAccountPreferences } = await import('../server/src/services/settingsProtocol.ts');
const { Hono } = await import('../server/node_modules/hono/dist/index.js');
const storage = await import('../src/db/index.ts');
const session = await import('../src/services/apiClient.ts');
const { useSettingsStore: settings, stopPreferenceSync } = await import('../src/stores/settingsStore.ts');
const owner = 'synthetic-preference-roundtrip';
let loseResponse = false;
const requests: Array<Record<string, unknown>> = [];
before(async () => {
  const user = await prisma.user.create({ data: { id: owner, phone: 'synthetic-pref-001', nickname: 'Synthetic' } });
  const issuer = new Hono(); issuer.get('/', (c) => { issueSession(c, user); return c.text('ok'); });
  const cookie = (await issuer.request('/')).headers.get('set-cookie')!.split(';')[0];
  await storage.bindAccountDatabase(owner); session.setSessionActive(owner);
  globalThis.fetch = async (path, init = {}) => {
    if (init.method === 'PATCH') requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const response = await app.request(String(path), { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: cookie, Origin: 'http://settings.invalid' } });
    if (loseResponse && init.method === 'PATCH' && response.ok) { loseResponse = false; throw new Error('synthetic successful response lost'); }
    return response;
  };
  await settings.getState().loadSettings(); await settings.getState().syncPreferences();
});
after(async () => { stopPreferenceSync(); session.clearSession(); storage.db.close(); await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }); });

test('real API + fake IndexedDB: every reminder preference reaches its authenticated account', async () => {
  await settings.getState().updateSetting('coachPushEnabled', true);
  await settings.getState().updateSetting('quietHours', { enabled: true, start: '22:30', end: '07:30' });
  await settings.getState().updateSetting('eveningReviewEnabled', true);
  await settings.getState().updateSetting('eveningReviewTime', '20:45');
  await settings.getState().syncPreferences();
  const stored = await readAccountPreferences(owner);
  assert.equal(stored.settings.coachPushEnabled, true); assert.equal(stored.settings.quietEnabled, true);
  assert.equal(stored.settings.quietStart, '22:30'); assert.equal(stored.settings.quietEnd, '07:30');
  assert.equal(stored.settings.eveningReviewEnabled, true); assert.equal(stored.settings.eveningReviewTime, '20:45');
  assert.equal(settings.getState().preferenceSync.state, 'synced');
});

test('real API + fake IndexedDB: lost ACK retry cannot overwrite a later device update', async () => {
  loseResponse = true;
  await settings.getState().updateSetting('coachStyle', 'strict'); await settings.getState().syncPreferences();
  const revision = (await readAccountPreferences(owner)).revision;
  await writeAccountPreferences(owner, { protocol: 1, mutationId: 'synthetic-remote-style-change', baseRevision: revision, changes: { coachStyle: 'data' } });
  await settings.getState().syncPreferences();
  assert.deepEqual(requests.at(-1), requests.at(-2));
  assert.equal((await readAccountPreferences(owner)).settings.coachStyle, 'data'); assert.equal(settings.getState().coachStyle, 'data');
  assert.equal(await storage.db.settings.get('pendingSetting:accountPreferences'), undefined);
});

test('real API + fake IndexedDB: conflict is preserved until explicit local choice makes a fresh CAS', async () => {
  await settings.getState().updateSetting('coachPushFrequency', 1);
  await writeAccountPreferences(owner, { protocol: 1, mutationId: 'synthetic-remote-limit-change', baseRevision: (await readAccountPreferences(owner)).revision, changes: { pushLimit: 2 } });
  await settings.getState().syncPreferences();
  const conflict = settings.getState().preferenceSync.conflict!;
  assert.equal(conflict.local.coachPushFrequency, 1); assert.equal(conflict.remote.coachPushFrequency, 2);
  assert.equal((await readAccountPreferences(owner)).settings.pushLimit, 2);
  await settings.getState().resolvePreferenceConflict('local', conflict.id);
  assert.equal((await readAccountPreferences(owner)).settings.pushLimit, 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner } })).pushLimit, 1);
  assert.equal(await storage.db.settings.where('key').startsWith('preferenceRecovery:').count(), 1);
});
