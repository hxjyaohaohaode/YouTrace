// Diagnostic baseline: actual rendered controls, native pointer/keyboard, real
// HTTP/Cookie/IndexedDB. A red outcome is preserved, not hidden by a test rewrite.
// All accounts/content are generated synthetic fixtures in a disposable database.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import puppeteer from 'puppeteer-core';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('This diagnostic is hosted-CI only; do not retry a locally restricted browser or listener.');

const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'youtrace-outcomes-'));
const artifacts = join(root, 'test-artifacts', 'user-outcomes');
await mkdir(artifacts, { recursive: true });
const baseAppCommit = 'e0da837068b26eca3b95bfcb952c825b998a1dee';
const apiPort = 3339, frontPort = 5289, origin = `http://127.0.0.1:${frontPort}`;
const environment = { ...process.env, NODE_ENV: 'test', PORT: String(apiPort), DATABASE_URL: `file:${join(scratch, 'synthetic.db')}`, JWT_SECRET: randomBytes(48).toString('hex'), ALLOWED_ORIGINS: origin, DEV_OTP_EXPOSE: 'true', SMS_PROVIDER_URL: '', SMS_PROVIDER_TOKEN: '', LLM_API_KEY: '', VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${apiPort}` };
const results = [], actions = [], traffic = [], infrastructure = [], children = [];
let browser, sequence = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const metadata = { kind: 'diagnostic-baseline-not-product-acceptance', appBaselineCommit: baseAppCommit, commit: process.env.GITHUB_SHA || git('rev-parse', 'HEAD'), contentTree: git('rev-parse', 'HEAD^{tree}'), syntheticOnly: true, interactions: 'native pointer and keyboard; DOM reads only; one initial login URL per isolated account; historical API setup explicitly separated', startedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', untested: ['Live SMS/model quality', 'Voice permission and real recognition', 'IDB failure UI', 'Cross-midnight UI', 'Full per-component accessibility/reduced-motion/zoom', 'All remaining Y3–Y9 scenarios', 'Manual human-operated review'] };
function launch(command, args, cwd) { const child = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'ignore', 'pipe'] }); child.stderr.on('data', () => infrastructure.push('synthetic-service-stderr')); children.push(child); return child; }
async function ready(url) { const end = Date.now() + 30000; while (Date.now() < end) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(150); } throw new Error('Isolated service did not start'); }
async function state(page) { return page.evaluate(() => ({ path: location.pathname + location.search, title: document.title, text: document.body.innerText, scroll: { x: scrollX, y: scrollY }, headings: [...document.querySelectorAll('h1,h2,h3')].map(el => el.textContent), controls: [...document.querySelectorAll('button,input,textarea,select,a')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).map(el => ({ tag: el.tagName, text: el.textContent?.trim().slice(0, 180), label: el.getAttribute('aria-label'), type: el.getAttribute('type'), disabled: el.disabled, value: ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) ? el.value : undefined })) })); }
async function capture(page, name) { const stem = `${String(++sequence).padStart(3, '0')}-${name.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 75)}`; await page.screenshot({ path: join(artifacts, `${stem}.png`), fullPage: true }); const snapshot = await state(page); await writeFile(join(artifacts, `${stem}.json`), JSON.stringify(snapshot, null, 2)); return { screenshot: `${stem}.png`, snapshot: `${stem}.json`, state: snapshot }; }
async function observe(page, name, pass, detail) { const evidence = await capture(page, name); results.push({ name, status: pass === null ? 'observed-context' : pass ? 'observed-pass' : 'observed-fail', detail, screenshot: evidence.screenshot, snapshot: evidence.snapshot }); console.log(`${pass === null ? 'CONTEXT' : pass ? 'OBSERVED' : 'PRODUCT GAP'} ${name}: ${detail}`); return evidence.state; }
async function segment(page, name, operation) { try { await operation(); } catch (error) { const evidence = await capture(page, name).catch(() => ({})); results.push({ name, status: 'blocked', detail: error.message, screenshot: evidence.screenshot, snapshot: evidence.snapshot }); console.log(`BLOCKED ${name}: ${error.message}`); } }
async function visibleHandle(page, selector, text) { const handle = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.disabled && (text === undefined || el.textContent.trim() === text); }), { timeout: 7000 }, selector, text); return handle.asElement(); }
async function pointer(page, selector, text) { const element = await visibleHandle(page, selector, text); try { await element.scrollIntoView(); await page.waitForFunction(el => { const r = el.getBoundingClientRect(); return el.isConnected && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, { timeout: 7000 }, element); await element.asLocator().click(); actions.push({ at: new Date().toISOString(), kind: 'native-pointer', selector, text, path: new URL(page.url()).pathname }); } finally { await element.dispose(); } }
async function fill(page, selector, text) { await pointer(page, selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(text); assert.equal(await page.$eval(selector, el => el.value), text); actions.push({ at: new Date().toISOString(), kind: 'native-text', selector, syntheticText: text }); }
async function nav(page, label) { await pointer(page, 'aside nav button', label); await sleep(350); }
async function waitPath(page, path) { await page.waitForFunction(path => location.pathname === path, { timeout: 15000 }, path); await sleep(350); }
async function login(page, phone, nickname) {
  await page.goto(`${origin}/login`, { waitUntil: 'networkidle0' });
  actions.push({ kind: 'initial-entry-url', path: '/login' });
  await page.waitForSelector('#login-phone'); await capture(page, `${nickname}-login`);
  await fill(page, '#login-phone', phone);
  const sent = page.waitForResponse(r => r.url().endsWith('/api/auth/send-code') && r.request().method() === 'POST');
  await pointer(page, 'button', '获取验证码'); const challenge = await (await sent).json(); assert.ok(challenge.devCode);
  await fill(page, '#login-code', challenge.devCode); await pointer(page, 'button', '验证');
  await page.waitForSelector('#login-nickname'); await fill(page, '#login-nickname', nickname); await pointer(page, 'button', '开始使用');
  await waitPath(page, '/onboarding');
  for (let step = 0; step < 4; step++) { await capture(page, `${nickname}-onboarding-${step + 1}`); await pointer(page, 'button', step < 3 ? '下一步' : '开始使用'); await sleep(650); }
  await waitPath(page, '/'); await page.waitForSelector('main'); await capture(page, `${nickname}-home`);
}
async function isolated(name, viewport, body) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.setViewport(viewport); await page.emulateTimezone('Asia/Shanghai'); page.setDefaultTimeout(10000);
  page.on('pageerror', error => infrastructure.push({ scenario: name, pageError: error.name }));
  page.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) { traffic.push({ scenario: name, path, status: response.status(), method: response.request().method() }); if (response.status() >= 500) infrastructure.push({ scenario: name, httpFailure: response.status(), path }); } });
  let recorder;
  try {
    await page.tracing.start({ path: join(artifacts, `${name}-trace.json`), screenshots: true });
    recorder = await page.screencast({ path: join(artifacts, `${name}.webm`), fps: 12, quality: 35 });
    await body(page);
  } catch (error) { await segment(page, `${name}-setup`, async () => { throw error; }); }
  finally { if (recorder) await recorder.stop(); await page.tracing.stop(); await context.close(); }
}
async function apiFor(page) {
  const cookie = (await page.browserContext().cookies()).filter(row => row.domain === '127.0.0.1').map(row => `${row.name}=${row.value}`).join('; ');
  const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } }); const { user } = await me.json(); assert.ok(user?.id);
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => { const response = await fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie, Origin: origin, 'X-YouTrace-Account': user.id, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); const result = await response.json(); assert.ok(response.ok, `Synthetic fixture/API ${path}: ${response.status}`); return result; };
  request.ownerId = user.id; return request;
}
async function localRows(page, owner) {
  return page.evaluate(owner => new Promise((resolve, reject) => {
    const request = indexedDB.open(`youtrace:user:${owner}`);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected account DB must already exist')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const database = request.result, names = ['todos', 'expenses', 'quickNotes', 'outbox']; const transaction = database.transaction(names, 'readonly'), rows = {};
      for (const name of names) { const read = transaction.objectStore(name).getAll(); read.onsuccess = () => { rows[name] = read.result; }; }
      transaction.oncomplete = () => { database.close(); resolve(rows); }; transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), owner);
}
async function selectedDetail(page, expected) {
  return page.evaluate(expected => [...document.querySelectorAll('[role=dialog], [aria-selected=true], [aria-current=true], [data-record-detail], form')].some(el => {
    const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) return false;
    const text = el.textContent + ' ' + [...el.querySelectorAll('input,textarea')].map(input => input.value).join(' ');
    return text.includes(expected.content) && (text.includes(expected.date) || text.includes(expected.displayedDate)) && (!expected.amount || text.includes(expected.amount));
  }), expected);
}
const businessDate = (offset = 0) => { const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };

async function firstValue(page) {
  await login(page, '13900008801', 'Synthetic Y1');
  await pointer(page, 'main button[aria-label="速记"]'); await waitPath(page, '/quick-note');
  await fill(page, 'textarea[aria-label="速记内容"]', '明天要交报销单；午饭15');
  await observe(page, 'Y1-native-input-retained', true, 'Exact requested phrase entered from the real home shortcut');
  await pointer(page, 'button', '查看确认稿'); await waitPath(page, '/quick-note/result');
  const review = await state(page), tomorrow = businessDate(1);
  await observe(page, 'Y1-absolute-due-date-preview', review.text.includes(tomorrow) || review.controls.some(row => row.type === 'date' && row.value === tomorrow), `Expected explicit ${tomorrow}; source-relative words are not an absolute date preview`);
  await observe(page, 'Y1-expense-currency-preview', /(?:[¥￥]\s*15(?:\.00)?|15(?:\.00)?\s*(?:元|CNY))/.test(review.text), 'Expected 15.00 CNY/元 and a correctable expense, not only raw input');
  await observe(page, 'Y1-add-entirely-missed-expense', review.controls.some(row => /添加.*花销/.test(`${row.label} ${row.text}`)), 'A missing expense category must still have an add control');
  await observe(page, 'Y1-edit-todo-absolute-date', review.controls.some(row => row.type === 'date'), 'Correction must expose the actual due date that will be written');
  await observe(page, 'Y1-choose-diary-exclusion', review.controls.some(row => /不记录日记|排除日记|取消日记|删除日记/.test(`${row.label} ${row.text}`)), 'The record destination must be an explicit revisable choice');
  await pointer(page, 'button', '确认保存'); await waitPath(page, '/');
  await observe(page, 'Y1-result-receipt-locates-created-records', (await state(page)).controls.some(row => /查看.*(?:待办|速记)|打开.*记录/.test(`${row.label} ${row.text}`)), 'Saving should leave a discoverable precise result/return path, rather than only disappear to home');
  const api = await apiFor(page); let local;
  for (let i = 0; i < 40; i++) { local = await localRows(page, api.ownerId); if (local.outbox.length === 0) break; await sleep(250); }
  const server = { todos: (await api('/todos')).todos, expenses: (await api('/expenses')).expenses, notes: (await api('/quicknote')).notes };
  await observe(page, 'Y1-upload-ack-separate-from-local-save', local.outbox.length === 0, `Pending queue ${local.outbox.length}; local domain results are evaluated independently from cloud timing`);
  await writeFile(join(artifacts, 'Y1-result-data.json'), JSON.stringify({ expectedDueDate: tomorrow, expectedExpenseFen: 1500, local, server }, null, 2));
  await nav(page, '待办'); await waitPath(page, '/todo');
  await observe(page, 'Y1-saved-todo-has-intended-date', local.todos.some(row => row.text.includes('交报销单') && row.dueDate === tomorrow), `Actual local dates: ${local.todos.map(row => row.dueDate).join(', ')}; expected ${tomorrow}`);
  await observe(page, 'Y1-todo-can-be-corrected-in-place', (await state(page)).controls.some(row => /编辑|改期/.test(`${row.label} ${row.text}`)), 'A user must be able to correct a wrong due date on the actual saved record');
  await nav(page, '花销'); await waitPath(page, '/expense');
  await observe(page, 'Y1-saved-expense-is-exactly-15-yuan', local.expenses.some(row => row.amount === 1500), `Actual local expense rows ${local.expenses.length}; expected one 1500-fen record`);
  await nav(page, '首页'); await waitPath(page, '/');
  await segment(page, 'Y1-quoted-emotion-and-last-row', async () => {
    await pointer(page, 'main button[aria-label="速记"]'); await waitPath(page, '/quick-note');
    await fill(page, 'textarea[aria-label="速记内容"]', '今天很开心但这不是我的心情，是书里一句话；明天要整理资料');
    await pointer(page, 'button', '查看确认稿'); await waitPath(page, '/quick-note/result');
    const quoted = await state(page);
    await observe(page, 'Y1-reject-quoted-emotion', !await page.$('section[aria-label="识别到的情绪"]') || quoted.controls.some(row => /不记录情绪|不判断|取消情绪|移除情绪|未记录/.test(`${row.label} ${row.text}`)), 'Quoted emotion must not be forced into the user profile; inspect screenshot and controls');
    const remove = quoted.controls.find(row => row.label?.startsWith('删除待办'));
    if (remove) { await pointer(page, `button[aria-label=${JSON.stringify(remove.label)}]`); await observe(page, 'Y1-readd-last-deleted-todo', (await state(page)).controls.some(row => row.label === '添加一个待办'), 'Deleting the last candidate must not remove the category add control'); }
    await pointer(page, 'button[aria-label="返回"]'); await waitPath(page, '/quick-note');
    await observe(page, 'Y1-back-retains-original-composer', await page.$eval('textarea[aria-label="速记内容"]', el => el.value.includes('书里一句话')), 'Back uses the real rendered arrow; no URL jump or store injection');
  });
}

async function retrievePast(page) {
  await login(page, '13900008802', 'Synthetic Y2'); const api = await apiFor(page);
  // Set up historical preconditions through authenticated real REST endpoints.
  // This is fixture creation, not evidence of the missing manual-date UI working.
  const items = Array.from({ length: 70 }, (_, index) => ({ amount: 1000 + index, category: 'food', name: 'Synthetic 同名午饭', date: businessDate(-Math.floor(index / 10)) }));
  const expenses = (await api('/expenses/batch', { items })).expenses;
  const diaries = []; for (let offset = 0; offset < 7; offset++) diaries.push((await api('/diary', { date: businessDate(-offset), content: `Synthetic 同名日记 ${offset} · 需要找回与修改的具体原文`, moodScore: 5 })).diary);
  const todo = (await api('/todos', { text: 'Synthetic 已完成但明天到期', dueDate: businessDate(1) })).todo; await api(`/todos/${todo.id}/toggle`, undefined, 'PATCH');
  await writeFile(join(artifacts, 'Y2-fixture-data.json'), JSON.stringify({ setup: 'real authenticated isolated API; not UI creation evidence', expenses, diaries, todo }, null, 2));
  const navigation = page.waitForNavigation({ waitUntil: 'networkidle0' }); await page.keyboard.down('Control'); await page.keyboard.press('r'); await page.keyboard.up('Control'); await navigation; await page.waitForSelector('main');
  actions.push({ kind: 'native-keyboard-reload-after-explicit-historical-fixture', path: '/' });
  await pointer(page, 'main button[aria-label="时间线"]'); await waitPath(page, '/timeline');
  const timeline = await state(page);
  const future = await page.$eval('button[aria-label="完成待办: Synthetic 已完成但明天到期"]', el => el.textContent).catch(() => null);
  await observe(page, 'Y2-future-deadline-not-just-now', !future || !future.includes('刚刚'), `Actual future-due completed task: ${future}`);
  await observe(page, 'Y2-history-window-has-continuation', timeline.controls.some(row => /更多|下一页|加载/.test(`${row.label} ${row.text}`)), '77 recorded historical items plus future task; a 60-row cutoff needs discoverable continuation or explicit scope');
  await segment(page, 'Y2-exact-expense-retrieval', async () => {
    if (new URL(page.url()).pathname !== '/timeline') { await nav(page, '时间线'); await waitPath(page, '/timeline'); }
    const target = expenses.find(row => row.amount === 1030); assert.ok(target);
    const selector = 'button[aria-label="花销: -¥10.30 Synthetic 同名午饭"]';
    const item = await visibleHandle(page, selector); await item.scrollIntoView(); await item.dispose(); await sleep(300);
    const before = await state(page); await capture(page, 'Y2-expense-origin-position');
    await pointer(page, selector); await waitPath(page, '/expense'); const opened = await state(page);
    await observe(page, 'Y2-expense-target-identity-preserved', await selectedDetail(page, { content: target.name, date: target.date, displayedDate: `${Number(target.date.slice(5, 7))}月${Number(target.date.slice(8))}日`, amount: '10.30' }), `Clicked exact ${target.date} / ${target.amount}fen / ${target.id}; actual destination ${opened.path}`);
    await observe(page, 'Y2-expense-edit-control', opened.controls.some(row => /编辑|修改/.test(`${row.label} ${row.text}`) && !/预算/.test(`${row.label} ${row.text}`)), 'Record editing is required; the budget editor is explicitly excluded');
    await page.keyboard.down('Alt'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Alt'); actions.push({ kind: 'native-browser-back', from: '/expense' }); await waitPath(page, '/timeline'); const returned = await state(page);
    await observe(page, 'Y2-back-restores-origin-position', Math.abs(returned.scroll.y - before.scroll.y) < 30, `Before ${before.scroll.y}px; returned ${returned.scroll.y}px`);
  });
  await segment(page, 'Y2-exact-diary-retrieval', async () => {
    if (new URL(page.url()).pathname !== '/timeline') { await nav(page, '时间线'); await waitPath(page, '/timeline'); }
    const target = diaries.find(row => row.date === businessDate(-3)); assert.ok(target);
    const item = await visibleHandle(page, 'button', undefined); await item.dispose();
    await pointer(page, `button[aria-label=${JSON.stringify(`日记: ${target.content.slice(0, 40)}`)}]`); await waitPath(page, '/diary');
    const opened = await state(page); await observe(page, 'Y2-diary-target-identity-preserved', await selectedDetail(page, { content: target.content, date: target.date, displayedDate: `${Number(target.date.slice(5, 7))}月${Number(target.date.slice(8))}日` }), `Clicked exact ${target.date}; current path ${opened.path}. A root list does not identify the requested record.`);
    // Continue an independently possible correction by reading the rendered date.
    const edit = await page.$$('button[aria-label^="编辑"][aria-label$="的日记"]');
    await observe(page, 'Y2-diary-date-controls-context', null, `${edit.length} date-specific controls observed; their count is not a task-success criterion. Continue by opening and correcting the specific source.`);
    for (const element of edit) await element.dispose();
    const date = new Date(`${target.date}T12:00:00Z`);
    const displayedDate = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
    await pointer(page, `button[aria-label=${JSON.stringify(`编辑${displayedDate}的日记`)}]`);
    await observe(page, 'Y2-manual-date-search-opens-correct-original', await page.$eval('#diary-content', el => el.value) === target.content, 'After the failed direct handoff, manually finding the date is an independently observed fallback');
    const corrected = `Synthetic 已修正 · ${target.content}`;
    await fill(page, '#diary-content', corrected); await pointer(page, '[role=dialog] button', '保存');
    await page.waitForSelector('[role=dialog]', { hidden: true });
    let saved; for (let attempt = 0; attempt < 20; attempt++) { saved = (await api(`/diary/${target.id}`)).diary; if (saved?.content === corrected) break; await sleep(250); }
    await writeFile(join(artifacts, 'Y2-corrected-diary.json'), JSON.stringify({ expectedId: target.id, expectedDate: target.date, expectedContent: corrected, actual: saved }, null, 2));
    await observe(page, 'Y2-correction-updates-the-intended-record', saved?.content === corrected && saved?.date === target.date, 'Actual authenticated server row must match the selected old diary, not only the form text');
    await page.keyboard.down('Alt'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Alt'); actions.push({ kind: 'native-browser-back', from: '/diary' }); await waitPath(page, '/timeline');
    await observe(page, 'Y2-return-after-correction', (await state(page)).text.includes('Synthetic 已修正'), 'Return must show the corrected source, while direct identity/position continuity is evaluated separately');
  });
}

try {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'Video evidence requires ffmpeg');
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: join(root, 'server'), env: environment, encoding: 'utf8' }); assert.equal(migrated.status, 0, migrated.stderr);
  launch(process.execPath, ['dist/index.js'], join(root, 'server'));
  launch(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(frontPort), '--strictPort'], root);
  await ready(`http://127.0.0.1:${apiPort}/health`); await ready(origin);
  let executablePath = process.env.AUDIT_BROWSER_PATH;
  if (!executablePath) for (const path of ['/usr/bin/google-chrome', '/usr/bin/chromium']) { try { await access(path); executablePath = path; break; } catch {} }
  assert.ok(executablePath, 'An installed Chromium is required');
  browser = await puppeteer.launch({ executablePath, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] }); metadata.browser = await browser.version();
  await isolated('Y1-first-value-1280', { width: 1280, height: 900 }, firstValue);
  await isolated('Y2-retrieve-past-1280', { width: 1280, height: 900 }, retrievePast);
  for (const name of ['Y1-first-value-1280', 'Y2-retrieve-past-1280']) assert.ok((await stat(join(artifacts, `${name}.webm`))).size > 0, `Missing ${name} video`);
} catch (error) { infrastructure.push({ fatal: error.message }); process.exitCode = 2; }
finally {
  if (browser) await browser.close();
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? undefined : new Promise(resolve => child.once('exit', resolve))));
  metadata.endedAt = new Date().toISOString();
  await writeFile(join(artifacts, 'outcome-report.json'), JSON.stringify({ metadata, results, actions, traffic, infrastructure }, null, 2));
  await writeFile(join(artifacts, 'README.txt'), 'Diagnostic baseline, not acceptance. Read outcome-report.json; observed-fail means a product gap, blocked means the step did not complete. Videos and Chrome performance traces cover successful and failed operations. All data are synthetic. Initial login URL and explicit historical API setup are identified separately; business navigation uses rendered controls. No live model, SMS or production data.\n');
  await rm(scratch, { recursive: true, force: true });
}
if (infrastructure.some(item => typeof item === 'object')) process.exitCode = 2;
if (!process.exitCode && results.some(row => row.status === 'observed-fail' || row.status === 'blocked')) process.exitCode = 1;
