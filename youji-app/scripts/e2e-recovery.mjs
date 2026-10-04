// Real Chromium + real HTTP cookies + real IndexedDB. Synthetic, isolated data only.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const appDir = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'youtrace-browser-'));
const artifactDir = resolve(appDir, 'test-artifacts');
await mkdir(artifactDir, { recursive: true });
const port = Number(process.env.E2E_API_PORT || 3327), frontPort = Number(process.env.E2E_FRONT_PORT || 5273);
const front = `http://127.0.0.1:${frontPort}`;
const env = { ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_URL: `file:${join(scratch, 'fixture.db')}`, JWT_SECRET: randomBytes(48).toString('hex'), ALLOWED_ORIGINS: front, DEV_OTP_EXPOSE: 'true', SMS_PROVIDER_URL: '', SMS_PROVIDER_TOKEN: '', LLM_API_KEY: '', VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${port}` };
const logs = [];
const report = [];
const children = [];
let browser;
const step = (name, detail) => { report.push({ name, passed: true, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url) { const until = Date.now() + 30000; while (Date.now() < until) { try { if ((await fetch(url)).ok) return; } catch {} await delay(200); } throw new Error(`Synthetic test server did not start: ${url}`); }
function start(command, args, cwd) { const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', () => {}); child.stderr.on('data', (text) => logs.push(String(text).slice(0, 500))); children.push(child); return child; }
async function clickText(page, text) { await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === label && !button.disabled), {}, text); await page.evaluate((label) => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === label && !button.disabled).click(), text); }
async function login(page, phone, nickname) {
  await page.goto(`${front}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#login-phone');
  await page.type('#login-phone', phone);
  const sentResponse = page.waitForResponse((r) => r.url().endsWith('/api/auth/send-code') && r.request().method() === 'POST');
  await clickText(page, '获取验证码');
  const sent = await (await sentResponse).json();
  assert.ok(sent.devCode, 'synthetic OTP only');
  await page.waitForSelector('#login-code'); await page.type('#login-code', sent.devCode);
  const verifiedResponse = page.waitForResponse((r) => r.url().endsWith('/api/auth/verify') && r.request().method() === 'POST');
  await clickText(page, '验证');
  const verified = await (await verifiedResponse).json();
  if (verified.needRegister) { await page.waitForSelector('#login-nickname'); await page.type('#login-nickname', nickname); await clickText(page, '开始使用'); }
  await page.waitForFunction(() => location.pathname !== '/login', { timeout: 20000 });
  await page.waitForSelector('h1,h2', { timeout: 20000 });
  if (new URL(page.url()).pathname === '/onboarding') await clickText(page, '跳过');
  await page.waitForFunction(() => location.pathname === '/' && Boolean(document.querySelector('main')), { timeout: 20000 });
}
async function route(page, path) { await page.goto(front + path, { waitUntil: 'networkidle0' }); await page.waitForSelector('h1,h2'); assert.equal(new URL(page.url()).pathname, path); }
async function addTodo(page, text) { await route(page, '/todo'); await page.click('[aria-label="新建待办"]'); await page.waitForSelector('[role=dialog] input'); await page.type('[role=dialog] input', text); await clickText(page, '保存'); await page.waitForFunction((needle) => document.body.textContent.includes(needle) && !document.querySelector('[role=dialog]'), {}, text); }
try {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: join(appDir, 'server'), env, encoding: 'utf8' });
  assert.equal(migrated.status, 0, migrated.stderr);
  start(process.execPath, ['dist/index.js'], join(appDir, 'server'));
  start(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(frontPort), '--strictPort'], appDir);
  await waitFor(`http://127.0.0.1:${port}/health`); await waitFor(front);
  let executablePath = process.env.AUDIT_BROWSER_PATH;
  if (!executablePath) { for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) { try { await access(candidate); executablePath = candidate; break; } catch {} } }
  assert.ok(executablePath, 'Set AUDIT_BROWSER_PATH to an installed Chromium executable');
  browser = await puppeteer.launch({ executablePath, headless: true, args: process.env.CI || process.env.AUDIT_BROWSER_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.name));
  await page.setViewport({ width: 1280, height: 900 });
  await login(page, '13900009901', 'Synthetic A'); step('Real OTP-cookie registration and onboarding');
  await addTodo(page, 'Synthetic A private todo');
  await page.click('[aria-label="新建待办"]'); await page.type('[role=dialog] input', 'Retained modal draft');
  const focused = await page.evaluate(() => document.activeElement?.tagName); assert.equal(focused, 'INPUT');
  await page.keyboard.press('Escape'); await page.waitForSelector('[role=dialog]', { hidden: true });
  await page.click('[aria-label="新建待办"]'); assert.equal(await page.$eval('[role=dialog] input', (el) => el.value), 'Retained modal draft');
  await page.keyboard.press('Escape'); await page.waitForSelector('[role=dialog]', { hidden: true }); step('Modal typing keeps focus; Escape/back/reopen retains unsaved input');
  await page.click('input[type=checkbox] + span');
  await page.waitForFunction(() => document.querySelector('input[type=checkbox]')?.checked === true); step('Visible checkbox pointer target toggles persisted todo');
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => document.querySelector('input[type=checkbox]')?.checked === true); step('Todo completion survives reload and sync');
  await route(page, '/quick-note'); await page.type('textarea', '明天学习英语，午饭花了25元');
  await clickText(page, '查看确认稿');
  await page.waitForFunction(() => location.pathname === '/quick-note/result');
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => document.body.textContent.includes('明天学习英语'));
  await clickText(page, '确认保存'); await page.waitForFunction(() => location.pathname === '/'); step('Capture review survives refresh and confirms transactionally');
  const paths = ['/', '/schedule', '/quick-note', '/expense', '/todo', '/habit', '/diary', '/coach', '/insights', '/settings', '/goal', '/timeline'];
  for (const width of [360, 768, 1280]) {
    await page.setViewport({ width, height: 900 });
    for (const path of paths) {
      await route(page, path);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, `${path} overflow at ${width}`);
      assert.equal(await page.evaluate(() => document.body.textContent.includes('页面出了点问题')), false, path);
      await page.screenshot({ path: join(artifactDir, `youtrace-${width}-${path.replaceAll('/', '-') || 'home'}.png`), fullPage: true });
    }
    await page.screenshot({ path: join(artifactDir, `youtrace-${width}.png`), fullPage: true });
  }
  step('All 12 business routes at 360/768/1280 widths without overflow or error boundary');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await route(page, '/todo'); step('Reduced-motion preference route smoke');
  await route(page, '/settings'); await clickText(page, '退出登录'); await page.waitForSelector('#login-phone');
  await login(page, '13900009902', 'Synthetic B'); await route(page, '/todo');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('Synthetic A private todo')), false); step('B cannot see A records after real sign-out/sign-in');
  await route(page, '/settings'); await clickText(page, '退出登录'); await page.waitForSelector('#login-phone');
  await login(page, '13900009901', 'Synthetic A'); await route(page, '/todo');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('Synthetic A private todo')), true); step('A recovers its data after A/B/A switch');
  const secondTab = await context.newPage(); await route(secondTab, '/todo');
  await route(page, '/settings'); await clickText(page, '退出登录'); await page.waitForSelector('#login-phone'); await secondTab.waitForSelector('#login-phone'); step('Cross-tab sign-out locks old account view');
  await login(page, '13900009903', 'Synthetic C'); await route(secondTab, '/todo');
  await route(page, '/settings'); await clickText(page, '注销账号（删除全部云端数据）'); await clickText(page, '永久注销');
  await page.waitForSelector('#login-phone'); await secondTab.waitForSelector('#login-phone'); step('Cross-tab account deletion locks stale private views');
  assert.deepEqual(errors, []); step('No uncaught page errors');
  await context.close();
} catch (error) {
  if (browser) {
    const pages = await browser.pages();
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(artifactDir, `failure-${index}.png`), fullPage: true }).catch(() => undefined);
      const state = await page.evaluate(() => ({ path: location.pathname, heading: document.querySelector('h1,h2')?.textContent, text: document.body.innerText.slice(0, 5000), checkboxes: [...document.querySelectorAll('input[type=checkbox]')].map((input) => ({ checked: input.checked, disabled: input.disabled, label: input.getAttribute('aria-label') })) })).catch(() => null);
      if (state) await writeFile(join(artifactDir, `failure-${index}.json`), JSON.stringify(state, null, 2));
    }
  }
  report.push({ name: 'browser regression', passed: false, error: error.message });
  console.error(error.stack); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const child of children) child.kill('SIGTERM');
  await writeFile(join(artifactDir, 'browser-report.json'), JSON.stringify({ syntheticOnly: true, tests: report, serverErrorNames: logs.map(() => 'server-stderr') }, null, 2));
  await rm(scratch, { recursive: true, force: true });
}
