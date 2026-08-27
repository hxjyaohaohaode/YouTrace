import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORT = process.env.E2E_PORT || '3100';
const BASE = `http://localhost:${PORT}`;
const ORIGIN = 'http://localhost:5180';
const DB = resolve('server', 'prisma', `e2e-${process.pid}-${Date.now()}.db`).replace(/\\/g, '/');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name} ${detail}`);
    console.log(`FAIL  ${name} ${detail}`);
  }
}

function makeCookieJar() {
  let cookie = '';
  return {
    capture(res) {
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
    },
    get header() {
      return cookie ? { Cookie: cookie } : {};
    },
  };
}

async function req(method, path, { body, jar } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...jar?.header,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  jar?.capture(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, res };
}

async function waitForServer(proc, stderrBuffer) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
    if (proc.exitCode !== null) {
      console.error(`Server exited early (code ${proc.exitCode}). stderr:\n${stderrBuffer.join('')}`);
      return false;
    }
  }
  console.error(`Server did not become healthy in time. stderr:\n${stderrBuffer.join('')}`);
  return false;
}

const serverEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PORT,
  DATABASE_URL: `file:${DB}`,
  JWT_SECRET: 'e2e-secret-key-that-is-at-least-32-chars-long!!',
  ALLOWED_ORIGINS: ORIGIN,
  DEV_OTP_EXPOSE: 'true',
  LLM_API_KEY: '',
};

const server = spawn(process.platform === 'win32' ? 'node.exe' : 'node', ['dist/index.js'], {
  cwd: resolve(process.cwd(), 'server'),
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
const stderrBuffer = [];
server.stderr.on('data', (d) => {
  stderrBuffer.push(d.toString());
  process.stderr.write(`[server] ${d}`);
});

const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: resolve(process.cwd(), 'server'),
  env: serverEnv,
  shell: process.platform === 'win32',
  encoding: 'utf8',
});
if (migrate.status !== 0) {
  console.error('prisma migrate deploy failed:\n', migrate.stdout, migrate.stderr);
  server.kill();
  process.exit(1);
}

try {
  const up = await waitForServer(server, stderrBuffer);
  if (!up) {
    server.kill();
    process.exit(1);
  }
  check('server boots and /health is ok', true);

  const health = await fetch(`${BASE}/health`);
  const securityHeadersOk =
    health.headers.get('x-content-type-options') === 'nosniff' &&
    health.headers.get('x-frame-options') === 'DENY';
  check('security headers present', securityHeadersOk);

  const csrfBlocked = await fetch(`${BASE}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800000001' }),
  });
  check('mutating request without Origin is rejected (CSRF)', csrfBlocked.status === 403);

  const alice = makeCookieJar();
  const sent = await req('POST', '/api/auth/send-code', { body: { phone: '13800000001' }, jar: alice });
  check('send-code returns devCode in dev mode', sent.status === 200 && /^\d{6}$/.test(sent.json?.devCode ?? ''));

  const verified = await req('POST', '/api/auth/verify', {
    body: { phone: '13800000001', code: sent.json.devCode, challengeId: sent.json.challengeId },
    jar: alice,
  });
  check('verify issues registration ticket for new user', verified.json?.needRegister === true && Boolean(verified.json?.registrationTicket));

  const registered = await req('POST', '/api/auth/register', {
    body: { phone: '13800000001', nickname: 'E2E用户', registrationTicket: verified.json.registrationTicket },
    jar: alice,
  });
  check('register creates user + session', registered.status === 201 && registered.json?.user?.nickname === 'E2E用户');
  check('me payload includes settings fields', registered.json.user.coachStyle === 'gentle' && 'pushLimit' in registered.json.user);

  const settingsPatched = await req('PATCH', '/api/user/settings', {
    body: { coachStyle: 'data', quietStart: '22:00', pushLimit: 4 },
    jar: alice,
  });
  check('user settings patch persists', settingsPatched.json?.settings?.coachStyle === 'data' && settingsPatched.json?.settings?.pushLimit === 4);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

  const expenseCreated = await req('POST', '/api/expenses', {
    body: { amount: 2500, category: 'food', name: '午饭', date: today, isIncome: false },
    jar: alice,
  });
  check('expense created', expenseCreated.status === 201);

  const incomeCreated = await req('POST', '/api/expenses/batch', {
    body: { items: [{ amount: 20000, category: 'other', name: '兼职', date: today, isIncome: true }] },
    jar: alice,
  });
  check('income batch created with isIncome flag', incomeCreated.status === 201 && incomeCreated.json.expenses[0].isIncome === true);

  const stats = await req('GET', '/api/expenses/stats', { jar: alice });
  check('stats exclude income from spend', stats.json?.month === 2500 && typeof stats.json.week === 'number');

  const todo = await req('POST', '/api/todos', { body: { text: '复习高数', priority: 'high' }, jar: alice });
  const toggled = await req('PATCH', `/api/todos/${todo.json.todo.id}/toggle`, { jar: alice });
  check('todo toggle flips atomically', toggled.json?.todo?.done === true);

  const habit = await req('POST', '/api/habits', { body: { name: '跑步', icon: '🏃' }, jar: alice });
  await req('PATCH', `/api/habits/${habit.json.habit.id}/check`, { body: { done: true }, jar: alice });
  const habitsListed = await req('GET', '/api/habits', { jar: alice });
  const habitEntry = habitsListed.json.habits.find((h) => h.id === habit.json.habit.id);
  check(
    'habits expose streak + 7-day recentCheckins',
    habitEntry.streak === 1 &&
      habitEntry.recentCheckins.length === 7 &&
      habitEntry.recentCheckins.at(-1).date === today
  );

  const note = await req('POST', '/api/quicknote', {
    body: { content: '午饭30元，明天记得交作业，今天很开心', timestamp: Date.now() },
    jar: alice,
  });
  check('quicknote created with parsed result', note.status === 201 && Array.isArray(note.json.note.parsed.expenses));

  const notesListed = await req('GET', '/api/quicknote', { jar: alice });
  check(
    'quicknote list serializes BigInt timestamps (regression)',
    notesListed.status === 200 && typeof notesListed.json.notes[0].timestamp === 'number'
  );

  const diaryDate = '2026-08-23';
  const diary = await req('POST', '/api/diary', {
    body: { date: diaryDate, content: '今天很充实', moodScore: 8 },
    jar: alice,
  });
  const dupDiary = await req('POST', '/api/diary', {
    body: { date: diaryDate, content: '重复' },
    jar: alice,
  });
  check('diary string id + duplicate date 409', typeof diary.json.diary.id === 'string' && dupDiary.status === 409);

  const scheduleId = 'e2e-schedule-alice-1';
  const syncPush = await req('POST', '/api/sync/push', {
    body: {
      schedules: [{ id: scheduleId, title: '小组会', date: '2026-08-25', startTime: '10:00', endTime: '11:00' }],
      habitCheckins: [{ habitId: habit.json.habit.id, date: '2026-08-22', done: true }],
    },
    jar: alice,
  });
  check('sync push accepts client ids + checkins', syncPush.status === 200 && syncPush.json.synced.schedules === 1);

  const pulled = await req('GET', '/api/sync/pull?since=1970-01-01T00:00:00Z', { jar: alice });
  check(
    'sync pull returns collections with cursor',
    pulled.json.schedules.length === 1 &&
      pulled.json.habitCheckins.length >= 2 &&
      typeof pulled.json.serverTime === 'string'
  );

  const bob = makeCookieJar();
  const bobSent = await req('POST', '/api/auth/send-code', { body: { phone: '13800000002' }, jar: bob });
  const bobVerified = await req('POST', '/api/auth/verify', {
    body: { phone: '13800000002', code: bobSent.json.devCode, challengeId: bobSent.json.challengeId },
    jar: bob,
  });
  await req('POST', '/api/auth/register', {
    body: { phone: '13800000002', nickname: '攻击者', registrationTicket: bobVerified.json.registrationTicket },
    jar: bob,
  });

  const mallorySync = await req('POST', '/api/sync/push', {
    body: { schedules: [{ id: scheduleId, title: '篡改', date: '2026-08-25', startTime: '10:00', endTime: '11:00' }] },
    jar: bob,
  });
  check('cross-user sync push rejected 403', mallorySync.status === 403);

  const malloryDelete = await req('DELETE', `/api/expenses/${expenseCreated.json.expense.id}`, { jar: bob });
  check('cross-user REST delete rejected', malloryDelete.status === 404);

  const brief = await req('GET', '/api/coach/brief', { jar: alice });
  check(
    'coach brief honest shape (no weather)',
    !('weather' in brief.json.brief) && brief.json.brief.yesterdayReview.habits.total === 1
  );

  const chat = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...alice.header },
    body: JSON.stringify({ message: '看看我的待办' }),
  });
  const chatBody = await chat.text();
  check(
    'chat SSE streams fallback and terminates',
    chat.status === 200 && chat.headers.get('content-type').startsWith('text/event-stream') && chatBody.includes('[DONE]')
  );

  const deletedAccount = await req('DELETE', '/api/user', { jar: bob });
  const bobMe = await req('GET', '/api/auth/me', { jar: bob });
  check('account deletion cascades and revokes session', deletedAccount.status === 200 && bobMe.status === 401);

  const aliceStillWorks = await req('GET', '/api/todos', { jar: alice });
  check('other users unaffected by deletion', aliceStillWorks.status === 200);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 800));
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    await rm(`${DB}${suffix}`, { force: true }).catch(() => undefined);
  }
}

console.log(`\nE2E results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach((f) => console.error(` - ${f}`));
  process.exit(1);
}
