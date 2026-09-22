// Diagnostic audit, not a passing regression suite: exit 1 means an invariant
// is violated, exit 2 means the probe could not complete. No production I/O.
// Requires Node >=22.13, installed frontend/backend dependencies, backend build.
import { mkdtemp, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(appDir, 'server');
const requireServer = createRequire(join(serverDir, 'package.json'));
const scratch = await mkdtemp(join(tmpdir(), 'youtrace-phase0-'));
const databasePath = join(scratch, 'audit.db');
const findings = [];
function observe(name, expected, actual, pass) {
  const row = { name, expected, actual, pass };
  findings.push(row);
  console.log(JSON.stringify(row));
}
let prisma;
let sqlite;
let browser;
let vite;
try {
  // Override environment BEFORE importing the real backend. Never use .env.
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DATABASE_URL: `file:${databasePath.replaceAll('\\', '/')}`,
    JWT_SECRET: randomBytes(48).toString('hex'),
    ALLOWED_ORIGINS: 'http://phase0.invalid',
    DEV_OTP_EXPOSE: 'false',
    SMS_PROVIDER_URL: '', SMS_PROVIDER_TOKEN: '',
    LLM_API_KEY: '',
  });
  // Prisma's Windows schema engine on this host failed to create a missing
  // SQLite file. Pre-creation is explicit; it does not count as a clean-clone
  // deployment passing without that prerequisite.
  new DatabaseSync(databasePath).close();
  const migrate = spawnSync(process.execPath, [requireServer.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: serverDir, env: process.env, encoding: 'utf8', timeout: 60_000, windowsHide: true,
  });
  console.log(JSON.stringify({ name: 'SQLite migrate deploy on pre-created empty file', exit: migrate.status, error: migrate.error?.message ?? null }));
  if (migrate.status !== 0) throw new Error(`Isolated migrate deploy failed: ${migrate.stderr}`);
  ({ prisma } = await import('../server/dist/utils/db.js'));
  const { app } = await import('../server/dist/app.js');
  const { issueSession } = await import('../server/dist/utils/session.js');
  const { Hono } = requireServer('hono');
  async function userAndCookie(id) {
    const user = await prisma.user.create({ data: { id, phone: `synthetic-${id}`, nickname: 'Phase0 synthetic' } });
    const issuer = new Hono();
    issuer.get('/', c => { issueSession(c, user); return c.text('issued'); });
    const response = await issuer.request('/');
    return response.headers.get('set-cookie').split(';')[0];
  }
  async function request(cookie, path, method = 'GET', body) {
    const response = await app.request(path, {
      method, headers: { Cookie: cookie, Origin: 'http://phase0.invalid', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  for (const count of [100, 2000, 2001, 10001]) {
    const userId = `page-${count}`;
    const cookie = await userAndCookie(userId);
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    for (let offset = 0; offset < count; offset += 250) {
      await prisma.todo.createMany({ data: Array.from({ length: Math.min(250, count - offset) }, (_, i) => ({
        id: `${userId}-${offset + i}`, userId, text: 'synthetic', updatedAt,
      })) });
    }
    const seen = new Set();
    let cursor = '1970-01-01T00:00:00.000Z';
    for (let page = 0; page < 50; page++) {
      const response = await request(cookie, `/api/sync/pull?since=${encodeURIComponent(cursor)}`);
      if (response.status !== 200) throw new Error(`Pull returned ${response.status}`);
      response.data.todos.forEach(row => seen.add(row.id));
      cursor = response.data.serverTime; // exactly the current client's protocol
      if (!response.data.hasMore) break;
    }
    observe(`pull ${count} equal-timestamp changes`, count, seen.size, seen.size === count);
  }
  const cookie = await userAndCookie('audit-owner');
  const todo = { id: 'audit-todo-0001', text: 'before delete', done: false };
  await request(cookie, '/api/sync/push', 'POST', { todos: [todo] });
  await request(cookie, '/api/sync/push', 'POST', { deletions: { todoIds: [todo.id] } });
  await request(cookie, '/api/sync/push', 'POST', { todos: [{ ...todo, text: 'stale device edit' }] });
  const resurrected = await prisma.todo.count({ where: { id: todo.id } });
  observe('stale update must not resurrect deleted todo', 0, resurrected, resurrected === 0);
  const checkin = await request(cookie, '/api/sync/push', 'POST', {
    habitCheckins: [{ habitId: 'missing-habit-0001', date: '2026-01-01', done: true }],
  });
  observe('missing-parent mutation must not receive a success envelope', 'non-2xx or explicit per-mutation rejection',
    { status: checkin.status, applied: checkin.data.synced?.habitCheckins }, checkin.status >= 400);
  const a = { id: 'audit-diary-device-a', date: '2026-01-02', content: 'unique text A' };
  const b = { id: 'audit-diary-device-b', date: a.date, content: 'unique text B' };
  await request(cookie, '/api/sync/push', 'POST', { diaries: [a] });
  const secondDiary = await request(cookie, '/api/sync/push', 'POST', { diaries: [b] });
  const stored = await prisma.diary.findMany({ where: { userId: 'audit-owner' }, select: { id: true, content: true } });
  observe('same-day diary conflict must preserve both inputs or reject explicitly', 'preserved conflict / rejected write',
    { status: secondDiary.status, rows: stored, ack: secondDiary.data }, secondDiary.status >= 400 || stored.length === 2);
  await request(cookie, '/api/auth/logout', 'POST');
  const afterLogout = await request(cookie, '/api/todos');
  observe('old cookie after logout must be revoked', 401, afterLogout.status, afterLogout.status === 401);
  await request(cookie, '/api/user', 'DELETE');
  const afterDelete = await request(cookie, '/api/todos');
  const meAfterDelete = await request(cookie, '/api/auth/me');
  observe('deleted-user cookie must fail on business routes', { todos: 401, me: 401 },
    { todos: afterDelete.status, me: meAfterDelete.status }, afterDelete.status === 401 && meAfterDelete.status === 401);

  // Historical migration is evaluated against deliberately synthetic old rows.
  sqlite = new DatabaseSync(join(scratch, 'migration-fixture.db'));
  const migrationsDir = join(serverDir, 'prisma/migrations');
  const names = (await readdir(migrationsDir)).filter(x => /^\d/.test(x)).sort();
  sqlite.exec(await readFile(join(migrationsDir, names[0], 'migration.sql'), 'utf8'));
  sqlite.exec(`INSERT INTO User(id,phone,nickname,updatedAt) VALUES('fixture-user','fixture-phone','fixture','2026-01-01');
    INSERT INTO Diary(userId,date,content,updatedAt) VALUES('fixture-user','2026-01-01','entry A','2026-01-01'),('fixture-user','2026-01-01','entry B','2026-01-02');`);
  sqlite.close();
  sqlite = undefined;
  const { PrismaClient } = requireServer('@prisma/client');
  const fixture = new PrismaClient({ datasources: { db: { url: `file:${join(scratch, 'migration-fixture.db').replaceAll('\\', '/')}` } } });
  try {
    for (const name of names.slice(1)) {
      const sql = await readFile(join(migrationsDir, name, 'migration.sql'), 'utf8');
      for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await fixture.$executeRawUnsafe(statement);
    }
    const diaryCount = await fixture.diary.count();
    observe('migration must preserve both historical diary entries', 2, diaryCount, diaryCount === 2);
  } finally { await fixture.$disconnect(); }

  sqlite = new DatabaseSync(join(scratch, 'migration-habit.db'));
  sqlite.exec(await readFile(join(migrationsDir, names[0], 'migration.sql'), 'utf8'));
  sqlite.exec(`INSERT INTO User(id,phone,nickname,updatedAt) VALUES('fixture-user','fixture-phone','fixture','2026-01-01');
    INSERT INTO Habit(id,userId,name,icon) VALUES('fixture-habit','fixture-user','fixture','x');`);
  sqlite.close(); sqlite = undefined;
  const populated = new PrismaClient({ datasources: { db: { url: `file:${join(scratch, 'migration-habit.db').replaceAll('\\', '/')}` } } });
  try {
    let migrationError = null;
    try {
      for (const name of names.slice(1)) {
        const sql = await readFile(join(migrationsDir, name, 'migration.sql'), 'utf8');
        for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await populated.$executeRawUnsafe(statement);
      }
    } catch (error) { migrationError = error.message; }
    observe('migration supports nonempty historical Habit table', 'success', migrationError ?? 'success', migrationError === null);
  } finally { await populated.$disconnect(); }

  if (process.argv.includes('--browser')) {
    // Backend env was captured above; Vite's React development runtime needs
    // development mode, including its Fast Refresh preamble.
    process.env.NODE_ENV = 'development';
    process.env.VITE_API_BASE_URL = '/api';
    const { createServer } = await import('vite');
    const { default: puppeteer } = await import('puppeteer-core');
    vite = await createServer({
      root: appDir, envDir: false,
      server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error',
      plugins: [{
        name: 'phase0-isolated-page',
        configureServer(server) {
          // Install BEFORE Vite's SPA fallback: never mount the real App while
          // constructing a historical IndexedDB fixture.
          server.middlewares.use('/phase0-blank', (_req, res, next) => {
            server.transformIndexHtml('/phase0-blank', '<!doctype html><html><head><title>Isolated Phase 0</title></head><body></body></html>')
              .then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html); })
              .catch(next);
          });
        },
      }],
    });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = await puppeteer.launch({ executablePath: process.env.AUDIT_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    const page = await browser.newPage();
    await page.goto(`${origin}/phase0-blank`);
    const clientResults = await page.evaluate(async () => {
      const results = [];
      const { db, clearAllData } = await import('/src/db/index.ts');
      const { useAuthStore } = await import('/src/stores/authStore.ts');
      const { useTodoStore } = await import('/src/stores/todoStore.ts');
      const sync = await import('/src/services/syncEngine.ts');
      const { clearSession, setSessionActive } = await import('/src/services/apiClient.ts');
      let mockUser = 'A';
      let pushStatus = 200;
      const emptyPage = { schedules: [], expenses: [], todos: [], habits: [], habitCheckins: [], quickNotes: [], diaries: [], hasMore: false, serverTime: new Date().toISOString() };
      // Only API responses are stubbed; real DB, stores and sync code execute.
      window.fetch = async path => {
        const route = String(path);
        if (route.includes('/auth/verify')) return Response.json({ user: { id: mockUser, nickname: mockUser } });
        if (route.includes('/sync/pull')) return Response.json(emptyPage);
        if (route.includes('/sync/push')) return Response.json(pushStatus === 403 ? { error: '所有权冲突' } : {}, { status: pushStatus });
        return Response.json({ insights: [], pushes: [] });
      };
      await useAuthStore.getState().verify('synthetic', 'synthetic', 'synthetic');
      await db.todos.put({ id: 'private-a', text: 'synthetic private A', done: false, priority: 'medium' });
      await db.outbox.add({ entity: 'todos', op: 'upsert', payload: { id: 'private-a', text: 'unsynced' }, queuedAt: Date.now() });
      useAuthStore.getState().logout();
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push({ name: 'logout preserves unacked outbox', expected: 1, actual: await db.outbox.count() });
      mockUser = 'B';
      await useAuthStore.getState().verify('synthetic', 'synthetic', 'synthetic');
      results.push({ name: 'B cannot see A local todo after switch', expected: false, actual: useTodoStore.getState().items.some(x => x.id === 'private-a') });
      useAuthStore.getState().logout();
      await new Promise(resolve => setTimeout(resolve, 100));
      mockUser = 'A';
      await useAuthStore.getState().verify('synthetic', 'synthetic', 'synthetic');
      results.push({ name: 'A can still read its todo after A-B-A switch', expected: true, actual: useTodoStore.getState().items.some(x => x.id === 'private-a') });
      for (const status of [403, 400, 413]) {
        pushStatus = status;
        await db.outbox.add({ entity: 'todos', op: 'upsert', payload: { id: `failed-${status}`, text: 'synthetic' }, queuedAt: Date.now() });
        setSessionActive();
        await sync.flush();
        if (status !== 403) await sync.flush();
        clearSession();
        results.push({ name: `${status} must retain unacked mutation`, expected: 1, actual: await db.outbox.count() });
        await sync.clearPendingSync();
      }
      await db.goals.put({ id: 'goal-a', title: 'synthetic', progress: 0 });
      await clearAllData();
      results.push({ name: 'clearAllData removes goals', expected: 0, actual: await db.goals.count() });
      db.close();
      return results;
    });
    for (const row of clientResults) observe(row.name, row.expected, row.actual, row.expected === row.actual);
    await page.close();
    const upgradeContext = await browser.createBrowserContext();
    const upgradePage = await upgradeContext.newPage();
    await upgradePage.goto(`${origin}/phase0-blank`);
    const upgraded = await upgradePage.evaluate(async () => {
      const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
      const old = new Dexie('youtrace');
      old.version(2).stores({ schedules: '++id, date, type, repeat', expenses: 'id, date, category', todos: 'id, done, dueDate, priority', habits: 'id', habitCheckins: '++id, habitId, date, [habitId+date]', quickNotes: 'id, timestamp', diary: '++id, date', settings: 'key', coachInsights: 'id, type, dismissed, createdAt', coachPushes: 'id, type, read, createdAt' });
      await old.open();
      await old.table('diary').add({ date: '2026-01-01', content: 'synthetic old diary' });
      old.close();
      try {
        const { db } = await import('/src/db/index.ts');
        await db.open();
        const count = await db.diary.count();
        db.close();
        return { opened: true, count };
      } catch (error) { return { opened: false, error: error.name, message: error.message }; }
    });
    observe('existing Dexie v2 upgrades without losing access', { opened: true, count: 1 }, upgraded, upgraded.opened && upgraded.count === 1);
    await upgradeContext.close();
    if (process.argv.includes('--ui-smoke')) {
      const uiCookie = await userAndCookie('ui-probe');
      const uiContext = await browser.createBrowserContext();
      const uiPage = await uiContext.newPage();
      const errors = [];
      uiPage.on('pageerror', error => errors.push(error.message));
      await uiPage.setRequestInterception(true);
      uiPage.on('request', req => {
        const url = new URL(req.url());
        if (!url.pathname.startsWith('/api/')) { void req.continue(); return; }
        void (async () => {
          // Actual backend handlers + isolated DB; in-process transport, no SMS.
          const response = await app.request(url.pathname + url.search, {
            method: req.method(),
            headers: { ...req.headers(), cookie: uiCookie, origin: 'http://phase0.invalid' },
            ...(req.postData() ? { body: req.postData() } : {}),
          });
          await req.respond({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
        })().catch(error => { errors.push(error.message); void req.abort(); });
      });
      await uiPage.evaluateOnNewDocument(() => {
        localStorage.setItem('youji_has_session', 'true');
        localStorage.setItem('youji_onboarded', 'true');
        localStorage.setItem('youji-auth', JSON.stringify({ state: { isAuthenticated: true }, version: 0 }));
      });
      const routes = ['/', '/schedule', '/quick-note', '/expense', '/todo', '/habit', '/diary', '/coach', '/insights', '/settings', '/goal', '/timeline'];
      const pages = [];
      for (const width of [360, 768, 1280]) {
        await uiPage.setViewport({ width, height: 900 });
        for (const route of routes) {
          await uiPage.goto(origin + route, { waitUntil: 'networkidle0', timeout: 30_000 });
          await uiPage.waitForSelector('h1,h2', { timeout: 15_000 });
          pages.push(await uiPage.evaluate(({ route, width }) => ({
            route, width, actualRoute: location.pathname,
            heading: document.querySelector('h1,h2')?.textContent,
            overflow: document.documentElement.scrollWidth > width + 2,
            errorBoundary: document.body.textContent.includes('页面出了点问题'),
          }), { route, width }));
        }
      }
      const failures = pages.filter(x => x.overflow || x.errorBoundary || x.route !== x.actualRoute);
      observe('authenticated UI route and width smoke (in-process API)', { pages: 36, failures: 0, errors: 0 },
        { pages: pages.length, failures, errors }, pages.length === 36 && failures.length === 0 && errors.length === 0);
      await uiContext.close();
    }
  }
  console.log(JSON.stringify({ completed: true, invariants: findings.length, violated: findings.filter(x => !x.pass).length }));
  process.exitCode = findings.some(x => !x.pass) ? 1 : 0;
} catch (error) {
  console.error(JSON.stringify({ completed: false, error: error.message }));
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (sqlite) sqlite.close();
  if (prisma) await prisma.$disconnect();
  // Exact generated files only, never recursive workspace cleanup.
  for (const name of ['audit.db', 'migration-fixture.db', 'migration-habit.db']) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) await rm(join(scratch, name + suffix), { force: true });
  }
  await rmdir(scratch);
}
