import puppeteer from 'puppeteer-core';
import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORT = process.env.E2E_PORT || '3100';
const PREVIEW_PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const FRONTEND = `http://localhost:${PREVIEW_PORT}`;
const ORIGIN = FRONTEND;
const DB = resolve('server', 'prisma', `responsive-${process.pid}-${Date.now()}.db`).replace(/\\/g, '/');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const VIEWPORTS = [
  { name: 'mobile-sm', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

const ROUTES = ['/', '/expense', '/todo', '/habit', '/diary', '/schedule', '/coach', '/insights', '/settings'];

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${name}: ${detail}`);
    console.log(`FAIL  ${name} ${detail}`);
  }
}

async function waitFor(url, timeoutMs = 30_000) {
  for (let i = 0; i < timeoutMs / 500; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const serverEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PORT,
  DATABASE_URL: `file:${DB}`,
  JWT_SECRET: 'responsive-test-secret-key-32-chars-min!!',
  ALLOWED_ORIGINS: ORIGIN,
  DEV_OTP_EXPOSE: 'true',
  LLM_API_KEY: '',
};

spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: resolve(process.cwd(), 'server'),
  env: serverEnv,
  shell: process.platform === 'win32',
  encoding: 'utf8',
});

const server = spawn('node', ['dist/index.js'], {
  cwd: resolve(process.cwd(), 'server'),
  env: serverEnv,
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', () => {});

const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
  cwd: process.cwd(),
  shell: process.platform === 'win32',
  stdio: ['ignore', 'ignore', 'pipe'],
});
preview.stderr.on('data', () => {});

try {
  await waitFor(`${BASE}/health`);
  await waitFor(FRONTEND);

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'true',
    args: ['--no-sandbox', '--disable-extensions', '--disable-gpu'],
  });

  const page = await browser.newPage();

  const res = await fetch(`${BASE}/api/auth/send-code`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800000099' }),
  });
  const sent = await res.json();

  const verify = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800000099', code: sent.devCode, challengeId: sent.challengeId }),
  });
  const verified = await verify.json();

  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800000099', nickname: 'Responsive', registrationTicket: verified.registrationTicket }),
  });
  const setCookie = reg.headers.get('set-cookie');
  const cookiePair = setCookie.split(';')[0];
  const [cookieName, ...cookieValueParts] = cookiePair.split('=');
  const cookieValue = cookieValueParts.join('=');

  await page.setViewport({ width: 1280, height: 800 });
  await page.setCookie({ name: cookieName, value: cookieValue, domain: 'localhost', path: '/' });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('youji_has_session', 'true');
    localStorage.setItem('youji_onboarded', 'true');
    localStorage.setItem('youji-auth', JSON.stringify({ state: { isAuthenticated: true }, version: 0 }));
  });
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });

    for (const route of ROUTES) {
      try {
        await page.goto(`${FRONTEND}${route}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await new Promise((r) => setTimeout(r, 1200));

        const audit = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const scrollW = document.documentElement.scrollWidth;
          const hasHorizontalOverflow = scrollW > vw + 2;
          const overflows = [];
          if (hasHorizontalOverflow) {
            document.querySelectorAll('*').forEach((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.right > vw + 4 && rect.width > 4 && rect.height > 0) {
                const tag = el.tagName.toLowerCase();
                const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
                if (!overflows.some((o) => o.startsWith(tag))) {
                  overflows.push(`${tag}.${cls}`);
                }
              }
            });
          }
          return { hasHorizontalOverflow, scrollW, vw, overflowSample: overflows.slice(0, 3) };
        });

        check(
          `[${vp.name} ${vp.width}px] ${route} no overflow`,
          !audit.hasHorizontalOverflow,
          audit.hasHorizontalOverflow ? `scrollW=${audit.scrollW} vw=${audit.vw} → ${audit.overflowSample.join(' | ')}` : ''
        );
      } catch (err) {
        check(`[${vp.name}] ${route} loaded`, false, err.message?.slice(0, 60));
      }
    }

    try {
      await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await new Promise((r) => setTimeout(r, 1000));
      const navCheck = await page.evaluate(() => {
        const nav = document.querySelector('[aria-label="主导航"]');
        if (!nav) return { found: false, visible: false };
        const rect = nav.getBoundingClientRect();
        return { found: true, visible: rect.height > 0 && rect.bottom <= window.innerHeight + 4 };
      });
      if (vp.width <= 768) {
        check(`[${vp.name}] BottomNav visible`, navCheck.found && navCheck.visible);
      } else {
        check(`[${vp.name}] BottomNav hidden`, !navCheck.found || !navCheck.visible);
      }
    } catch {
      check(`[${vp.name}] nav check loaded`, false, 'timeout');
    }
  }

  await browser.close();
} finally {
  server.kill();
  preview.kill();
  await new Promise((r) => setTimeout(r, 500));
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    await rm(`${DB}${suffix}`, { force: true }).catch(() => undefined);
  }
}

console.log(`\nResponsive audit: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach((f) => console.log(` ✗ ${f}`));
}
server.kill('SIGKILL');
preview.kill('SIGKILL');
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 200);
