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
let coveredTargetCount = 0;
let currentScenario = 'existing browser regression';
const step = (name, detail) => { report.push({ name, passed: true, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url) { const until = Date.now() + 30000; while (Date.now() < until) { try { if ((await fetch(url)).ok) return; } catch {} await delay(200); } throw new Error(`Synthetic test server did not start: ${url}`); }
function start(command, args, cwd) { const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', () => {}); child.stderr.on('data', (text) => logs.push(String(text).slice(0, 500))); children.push(child); return child; }
async function clickText(page, text) { await page.bringToFront(); await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === label && !button.disabled), {}, text); await page.evaluate((label) => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === label && !button.disabled).click(), text); }
async function login(page, phone, nickname) {
  await page.bringToFront();
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
  assert.equal((await verifiedResponse).status(), 200, 'synthetic OTP verification must succeed');
  // An existing-account login intentionally reloads the whole document at the
  // account boundary. Chromium may discard that request's body on navigation;
  // use the actual registration/redirect UI instead of rereading an evicted body.
  await page.waitForFunction(() => Boolean(document.querySelector('#login-nickname')) || location.pathname !== '/login');
  if (await page.$('#login-nickname')) { await page.type('#login-nickname', nickname); await clickText(page, '开始使用'); }
  await page.waitForFunction(() => location.pathname !== '/login', { timeout: 20000 });
  await page.waitForSelector('h1,h2', { timeout: 20000 });
  if (new URL(page.url()).pathname === '/onboarding') await clickText(page, '跳过');
  await page.waitForFunction(() => location.pathname === '/' && Boolean(document.querySelector('main')), { timeout: 20000 });
}
async function route(page, path) { await page.bringToFront(); await page.goto(front + path, { waitUntil: 'networkidle0' }); await page.waitForSelector('h1,h2'); assert.equal(new URL(page.url()).pathname, path); }
async function addTodo(page, text) { await route(page, '/todo'); await page.click('[aria-label="新建待办"]'); await page.waitForSelector('[role=dialog] input'); await page.type('[role=dialog] input', text); await clickText(page, '保存'); await page.waitForFunction((needle) => document.body.textContent.includes(needle) && !document.querySelector('[role=dialog]'), {}, text); }
// The expanded business cases use real pointer and keyboard input. DOM evaluation
// below only reads rendered controls/assertions; it never seeds stores or IndexedDB.
async function pointerClick(page, target) {
  await target.scrollIntoView();
  const interception = await target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return el.contains(hit) ? null : { tag: hit?.tagName, role: hit?.getAttribute('role'), ariaLabel: hit?.getAttribute('aria-label') };
  });
  if (interception) {
    console.log('WAIT for unobscured pointer target', JSON.stringify(interception));
    await page.screenshot({ path: join(artifactDir, `covered-target-${++coveredTargetCount}.png`) });
  }
  // Locator stability does not imply the center is unobscured. A real transient
  // notification may cover a control after scrolling; wait for that actual UI
  // obstruction to clear rather than clicking through it or changing app state.
  await page.waitForFunction((el) => {
    if (!el.isConnected) return false;
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }, {}, target);
  await target.asLocator().click();
}
async function clickControl(page, selector) {
  await page.bringToFront();
  const target = await page.waitForSelector(selector, { visible: true });
  try { await pointerClick(page, target); } finally { await target.dispose(); }
}
async function clickButton(page, label, scope = 'body', contains = false) {
  await page.bringToFront();
  const handle = await page.waitForFunction((text, rootSelector, partial) => {
    const root = rootSelector.startsWith('dialog:')
      ? [...document.querySelectorAll('[role=dialog]')].find((dialog) => dialog.querySelector('h3')?.textContent === rootSelector.slice(7))
      : document.querySelector(rootSelector);
    return [...(root?.querySelectorAll('button') ?? [])].find((button) => {
      const actual = button.textContent.trim();
      return (partial ? actual.includes(text) : actual === text) && !button.disabled
        && button.getBoundingClientRect().width > 0 && getComputedStyle(button).visibility !== 'hidden';
    });
  }, {}, label, scope, contains);
  try { await pointerClick(page, handle.asElement()); } finally { await handle.dispose(); }
}
async function fillControl(page, selector, value) {
  await clickControl(page, selector);
  assert.equal(await page.$eval(selector, (el) => document.activeElement === el), true, `${selector} must receive keyboard focus`);
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.sendCharacter(value);
  assert.equal(await page.$eval(selector, (el) => el.value), value, `${selector} must retain the complete entered value`);
}
async function expectText(page, text, present = true, selector = 'main p') {
  await page.waitForFunction((needle, expected, rootSelector) =>
    [...document.querySelectorAll(rootSelector)].some((el) => el.textContent.trim() === needle) === expected,
  {}, text, present, selector);
}
async function expectAttribute(page, selector, attribute, value) {
  await page.waitForFunction((query, key, expected) => document.querySelector(query)?.getAttribute(key) === expected,
    {}, selector, attribute, value);
}
async function modalClosed(page) { await page.waitForSelector('[role=dialog]', { hidden: true }); }
async function reloadPage(page) { await page.bringToFront(); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('main'); }
async function scenario(name, run) {
  currentScenario = name;
  console.log(`RUN ${name}`);
  await run();
  step(name);
  currentScenario = 'existing browser regression';
}
async function businessRegressions(page) {
  await scenario('Expense: invalid amount blocked; expense/income cents survive reload and deletion', async () => {
    await route(page, '/expense');
    await clickControl(page, '[aria-label="添加花销"]');
    await fillControl(page, '#expense-amount', '0');
    assert.equal(await page.$eval('#expense-amount', (el) => el.getAttribute('aria-invalid')), 'true', 'zero expense must be invalid');
    assert.equal(await page.$$eval('[role=dialog] button', (buttons) => buttons.find((b) => b.textContent.trim() === '保存')?.disabled), true, 'zero expense cannot be saved');
    await fillControl(page, '#expense-amount', '12.34');
    await fillControl(page, '#expense-name', 'Synthetic expense cents');
    await clickControl(page, '[role=dialog] [role=radio][aria-label="学习"]');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await expectText(page, 'Synthetic expense cents');
    await clickControl(page, '[aria-label="添加花销"]');
    await fillControl(page, '#expense-amount', '56.78');
    await clickButton(page, '收入', '[role=dialog]');
    await page.waitForSelector('[role=dialog] [aria-label="支出分类"]', { hidden: true });
    await fillControl(page, '#expense-name', 'Synthetic income cents');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page);
    await expectText(page, 'Synthetic expense cents'); await expectText(page, 'Synthetic income cents');
    await expectText(page, '-¥12.34', true, '[aria-label="支出 12.34元"]');
    await expectText(page, '+¥56.78', true, '[aria-label="收入 56.78元"]');
    // Each row also has a covered swipe affordance; use its visible desktop button.
    await clickControl(page, 'button.hidden[aria-label="删除 Synthetic expense cents"]');
    await expectText(page, 'Synthetic expense cents', false);
    await clickControl(page, 'button.hidden[aria-label="删除 Synthetic income cents"]');
    await expectText(page, 'Synthetic income cents', false);
    await reloadPage(page);
    await expectText(page, 'Synthetic expense cents', false); await expectText(page, 'Synthetic income cents', false);
  });

  await scenario('Schedule: create/edit persist; cancel deletion retains entry; confirm removes it', async () => {
    await route(page, '/schedule');
    await clickControl(page, '[aria-label="新建日程"]');
    await fillControl(page, '#schedule-title', 'Synthetic schedule original');
    await fillControl(page, '#schedule-location', 'Synthetic room A');
    await clickButton(page, '工作', '[aria-label="日程类型"]');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page);
    await clickControl(page, '[role=button][aria-label="09:00-10:30 Synthetic schedule original"]');
    assert.equal(await page.$eval('#schedule-location', (el) => el.value), 'Synthetic room A', 'schedule location must survive reload');
    await fillControl(page, '#schedule-title', 'Synthetic schedule revised');
    await fillControl(page, '#schedule-location', 'Synthetic room B');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page);
    await expectText(page, 'Synthetic schedule original', false);
    await clickControl(page, '[role=button][aria-label="09:00-10:30 Synthetic schedule revised"]');
    assert.equal(await page.$eval('#schedule-location', (el) => el.value), 'Synthetic room B', 'schedule edit must survive reload');
    await clickButton(page, '删除', '[role=dialog]');
    await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 2);
    await clickButton(page, '取消', 'dialog:确认删除');
    await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 1);
    assert.equal(await page.$eval('#schedule-title', (el) => el.value), 'Synthetic schedule revised', 'cancel deletion must preserve the editing form');
    await clickButton(page, '删除', '[role=dialog]');
    await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 2);
    await clickButton(page, '删除', 'dialog:确认删除');
    await modalClosed(page); await reloadPage(page);
    await expectText(page, 'Synthetic schedule revised', false);
  });

  await scenario('Diary: create/edit content and mood persist; cancel/confirm deletion are distinct', async () => {
    await route(page, '/diary');
    await clickControl(page, '[aria-label="写日记"]');
    await fillControl(page, '#diary-content', 'Synthetic diary original: 今天完成了一件小事。');
    await clickControl(page, '[aria-label="选择心情"] button:first-child');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page);
    await expectText(page, 'Synthetic diary original: 今天完成了一件小事。');
    await expectText(page, '8/10', true, 'main span');
    await clickControl(page, 'button[aria-label^="编辑"][aria-label$="的日记"]');
    await fillControl(page, '#diary-content', 'Synthetic diary revised: 保留修改后的完整内容。');
    await clickControl(page, '[aria-label="选择心情"] button:nth-child(3)');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page);
    await expectText(page, 'Synthetic diary revised: 保留修改后的完整内容。');
    await expectText(page, 'Synthetic diary original: 今天完成了一件小事。', false);
    await expectText(page, '5/10', true, 'main span');
    await clickControl(page, 'button[aria-label^="删除"][aria-label$="的日记"]');
    await clickButton(page, '取消', '[role=dialog]'); await modalClosed(page);
    await expectText(page, 'Synthetic diary revised: 保留修改后的完整内容。');
    await clickControl(page, 'button[aria-label^="删除"][aria-label$="的日记"]');
    await clickButton(page, '删除', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page); await expectText(page, 'Synthetic diary revised: 保留修改后的完整内容。', false);
  });

  await scenario('Goal: manual 100% completion can return to 25% and survives reload', async () => {
    await route(page, '/goal');
    await clickControl(page, '[aria-label="新建目标"]');
    await fillControl(page, '[role=dialog] input[placeholder="想完成什么？"]', 'Synthetic 学习目标');
    await clickButton(page, '学习', '[aria-label="领域"]');
    await clickButton(page, '创建', '[role=dialog]'); await modalClosed(page);
    await clickControl(page, '[aria-label="将目标进度设为 100%"]');
    await expectText(page, '1/1 完成 · 平均进度 100%');
    await clickControl(page, '[aria-label="将目标进度设为 25%"]');
    await expectText(page, '0/1 完成 · 平均进度 25%');
    await reloadPage(page); await expectText(page, '0/1 完成 · 平均进度 25%');
  });

  await scenario('Habit: check-in/undo/backfill persist; deletion can be cancelled and confirmed', async () => {
    await route(page, '/habit');
    await clickControl(page, '[aria-label="新建习惯"]');
    await fillControl(page, '[role=dialog] input[placeholder="例如：跑步 5 公里"]', 'Synthetic 学习习惯');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await clickControl(page, '[aria-label="完成 Synthetic 学习习惯"]');
    await expectAttribute(page, '[aria-label="取消完成 Synthetic 学习习惯"]', 'aria-pressed', 'true');
    await reloadPage(page);
    await expectAttribute(page, '[aria-label="取消完成 Synthetic 学习习惯"]', 'aria-pressed', 'true');
    await clickControl(page, '[aria-label="取消完成 Synthetic 学习习惯"]');
    await expectAttribute(page, '[aria-label="完成 Synthetic 学习习惯"]', 'aria-pressed', 'false');
    const pastDate = await page.$eval('button[aria-label$="未完成，点击补卡"]', (el) => el.getAttribute('aria-label').split(' ')[0]);
    assert.match(pastDate, /^\d{4}-\d{2}-\d{2}$/, 'backfill date must come from the rendered week');
    await clickControl(page, `button[aria-label="${pastDate} 未完成，点击补卡"]`);
    await expectAttribute(page, `button[aria-label="${pastDate} 已完成，点击撤销"]`, 'aria-pressed', 'true');
    await reloadPage(page);
    await expectAttribute(page, '[aria-label="完成 Synthetic 学习习惯"]', 'aria-pressed', 'false');
    await expectAttribute(page, `button[aria-label="${pastDate} 已完成，点击撤销"]`, 'aria-pressed', 'true');
    await clickControl(page, `button[aria-label="${pastDate} 已完成，点击撤销"]`);
    await expectAttribute(page, `button[aria-label="${pastDate} 未完成，点击补卡"]`, 'aria-pressed', 'false');
    await clickControl(page, '[aria-label="删除习惯 Synthetic 学习习惯"]');
    await clickButton(page, '取消', '[role=dialog]'); await modalClosed(page);
    await expectText(page, 'Synthetic 学习习惯');
    await clickControl(page, '[aria-label="删除习惯 Synthetic 学习习惯"]');
    await clickButton(page, '删除', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page); await expectText(page, 'Synthetic 学习习惯', false);
  });

  await scenario('Goal: habit activity cannot inflate manual progress; deletion respects cancellation', async () => {
    await route(page, '/goal');
    await expectText(page, '0/1 完成 · 平均进度 25%');
    await clickControl(page, '[aria-label="删除目标 Synthetic 学习目标"]');
    await clickButton(page, '保留目标', '[role=dialog]'); await modalClosed(page);
    await expectText(page, 'Synthetic 学习目标');
    await clickControl(page, '[aria-label="删除目标 Synthetic 学习目标"]');
    await clickButton(page, '确认删除', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page); await expectText(page, 'Synthetic 学习目标', false);
  });

  await scenario('Coach: real SSE rule fallback discloses source and opens the actual todo workflow', async () => {
    await route(page, '/coach');
    await fillControl(page, 'textarea[aria-label="输入消息"]', '查看待办');
    await clickControl(page, '[aria-label="发送消息"]');
    await page.waitForFunction(() => document.body.textContent.includes('规则回复'));
    await clickControl(page, '[aria-label="执行：打开待办清单"]');
    await page.waitForFunction(() => location.pathname === '/todo');
    await expectText(page, 'Synthetic A private todo');
  });

  await scenario('Settings: budget/theme/reminder save and reload; account preference receives HTTP ACK', async () => {
    await route(page, '/settings');
    await fillControl(page, '#budget-input', '4321');
    await clickButton(page, '保存', 'section[aria-label="预算"]');
    await expectText(page, '预算保存在本设备；当前 ¥4321');
    await clickButton(page, '深色', '[role=radiogroup][aria-label="主题"]');
    await expectAttribute(page, 'html', 'data-theme', 'dark');
    await clickControl(page, '[role=switch][aria-label="教练推送"]');
    await expectAttribute(page, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'false');
    const styleAck = page.waitForResponse((response) => response.url().endsWith('/api/user/settings')
      && response.request().method() === 'PATCH' && JSON.parse(response.request().postData() || '{}').coachStyle === 'data');
    await clickButton(page, '数据型', '[role=radiogroup][aria-label="教练风格"]', true);
    assert.equal((await styleAck).status(), 200, 'coach style update must receive a real backend ACK');
    const frequencyAck = page.waitForResponse((response) => response.url().endsWith('/api/user/settings')
      && response.request().method() === 'PATCH' && JSON.parse(response.request().postData() || '{}').pushLimit === 1);
    await clickControl(page, '[aria-label="每天最多1条"]');
    assert.equal((await frequencyAck).status(), 200, 'push frequency must receive a real backend ACK');
    await reloadPage(page);
    assert.equal(await page.$eval('#budget-input', (el) => el.value), '4321', 'budget input must load its persisted value');
    await expectText(page, '预算保存在本设备；当前 ¥4321');
    await expectAttribute(page, 'html', 'data-theme', 'dark');
    await expectAttribute(page, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'false');
    await expectAttribute(page, '[aria-label="每天最多1条"]', 'aria-checked', 'true');
    assert.equal(await page.$eval('[role=radiogroup][aria-label="教练风格"] [aria-checked="true"]', (el) => el.textContent.includes('数据型')), true, 'account coach style must survive reload');
    await delay(350);
    await page.screenshot({ path: join(artifactDir, 'youtrace-1280-settings-dark.png'), fullPage: true });
    // Restore the original appearance before the existing responsive screenshots.
    await clickButton(page, '跟随系统', '[role=radiogroup][aria-label="主题"]');
    await clickControl(page, '[role=switch][aria-label="教练推送"]');
    await expectAttribute(page, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'true');
    await reloadPage(page);
    await expectAttribute(page, '[role=radiogroup][aria-label="主题"] button:last-child', 'aria-checked', 'true');
    await expectAttribute(page, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'true');
  });
}
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
  assert.ok(await page.$eval('main', (el) => Number.parseFloat(getComputedStyle(el).marginLeft) >= 260), 'desktop content must clear fixed sidebar');
  step('Tailwind spacing survives base reset and clears desktop navigation');
  await addTodo(page, 'Synthetic A private todo');
  await page.click('[aria-label="新建待办"]'); await page.type('[role=dialog] input', 'Retained modal draft');
  const focused = await page.evaluate(() => document.activeElement?.tagName); assert.equal(focused, 'INPUT');
  await page.keyboard.press('Escape'); await page.waitForSelector('[role=dialog]', { hidden: true });
  await page.click('[aria-label="新建待办"]'); assert.equal(await page.$eval('[role=dialog] input', (el) => el.value), 'Retained modal draft');
  await page.keyboard.press('Escape'); await page.waitForSelector('[role=dialog]', { hidden: true }); step('Modal typing keeps focus; Escape/back/reopen retains unsaved input');
  await page.click('input[type=checkbox] + span');
  await page.waitForFunction(() => document.querySelector('input[type=checkbox]')?.checked === true); step('Visible checkbox pointer target toggles persisted todo');
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => document.querySelector('input[type=checkbox]')?.checked === true); step('Todo completion survives reload and sync');
  await businessRegressions(page);
  await route(page, '/quick-note');
  await page.waitForSelector('textarea:not([disabled])');
  await page.click('textarea');
  // Commit Chinese text as a complete IME/paste-style input, rather than a
  // sequence of synthetic non-keyboard insertions with no composition events.
  await page.keyboard.sendCharacter('明天学习英语，午饭花了25元');
  assert.equal(await page.$eval('textarea', (el) => el.value), '明天学习英语，午饭花了25元');
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
      await delay(1000); // Existing greeting reveal is 900ms; capture its settled content.
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
  const secondTab = await context.newPage(); secondTab.on('pageerror', (error) => errors.push(error.name)); await route(secondTab, '/todo');
  await route(page, '/settings'); await clickText(page, '退出登录'); await page.waitForSelector('#login-phone'); await secondTab.bringToFront(); await secondTab.waitForSelector('#login-phone'); step('Cross-tab sign-out locks old account view');
  await login(page, '13900009903', 'Synthetic C'); await route(secondTab, '/todo');
  await route(page, '/settings'); await clickText(page, '注销账号（删除全部云端数据）'); await clickText(page, '永久注销');
  await page.waitForSelector('#login-phone'); await secondTab.bringToFront(); await secondTab.waitForSelector('#login-phone'); step('Cross-tab account deletion locks stale private views');
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
  report.push({ name: currentScenario, passed: false, error: error.message });
  console.error(error.stack); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const child of children) child.kill('SIGTERM');
  await writeFile(join(artifactDir, 'browser-report.json'), JSON.stringify({ syntheticOnly: true, tests: report, serverErrorNames: logs.map(() => 'server-stderr') }, null, 2));
  await rm(scratch, { recursive: true, force: true });
}
