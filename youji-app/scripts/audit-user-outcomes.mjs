// First product-outcome package: actual rendered controls, native pointer/keyboard, real
// HTTP/Cookie/IndexedDB. A red outcome is preserved, not hidden by a test rewrite.
// All accounts/content are generated synthetic fixtures in a disposable database.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, access, stat, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('This diagnostic is hosted-CI only; do not retry a locally restricted browser or listener.');

const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'youtrace-outcomes-'));
const artifacts = join(root, 'test-artifacts', 'user-outcomes');
await mkdir(artifacts, { recursive: true });
const redEvidenceCommit = '2c5e7ba365e2b06e1eeb9102cbcf4ab9c6c08b17';
const apiPort = 3339, frontPort = 5289, origin = `http://127.0.0.1:${frontPort}`;
const environment = { ...process.env, NODE_ENV: 'test', PORT: String(apiPort), DATABASE_URL: `file:${join(scratch, 'synthetic.db')}`, JWT_SECRET: randomBytes(48).toString('hex'), ALLOWED_ORIGINS: origin, DEV_OTP_EXPOSE: 'true', SMS_PROVIDER_URL: '', SMS_PROVIDER_TOKEN: '', LLM_API_KEY: '', VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${apiPort}` };
const results = [], actions = [], traffic = [], infrastructure = [], children = [];
let browser, sequence = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gitRoot = git('rev-parse', '--show-toplevel');
async function sourceSnapshot() {
  const names = execFileSync('git', ['ls-files', '-z'], { cwd: gitRoot, encoding: 'utf8' }).split('\0').filter(Boolean).sort(), hash = createHash('sha256');
  for (const file of names) { hash.update(file + '\0'); hash.update(createHash('sha256').update(await readFile(join(gitRoot, file))).digest()); }
  return { dirty: git('status', '--porcelain'), trackedContentSha256: hash.digest('hex'), trackedFiles: names.length };
}
async function buildSnapshot(directory = join(root, 'dist'), prefix = '') {
  const files = [];
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.isDirectory()) files.push(...await buildSnapshot(join(directory, item.name), prefix + item.name + '/'));
    else { const body = await readFile(join(directory, item.name)); files.push({ file: prefix + item.name, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }); }
  }
  return files;
}
const metadata = { kind: 'first-package-scripted-outcomes-await-independent-review', redEvidenceCommit, commit: process.env.GITHUB_SHA || git('rev-parse', 'HEAD'), contentTree: git('rev-parse', 'HEAD^{tree}'), syntheticOnly: true, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, sourceStart: await sourceSnapshot(), buildFiles: [...await buildSnapshot(join(root, 'dist'), 'frontend/'), ...await buildSnapshot(join(root, 'server/dist'), 'server/')], interactions: 'native pointer and keyboard; DOM reads only; one initial login URL per isolated account; historical API setup explicitly separated', startedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', untested: ['Fresh cross-midnight browser clock transition', 'Fresh two-tab concurrent confirmation', 'Fresh first-package A/B/A account sequence', 'Live SMS/model quality', 'Voice permission and real recognition', 'Full per-component accessibility/reduced-motion/zoom', 'All remaining Y3–Y9 scenarios', 'Manual human-operated review'] };
function launch(command, args, cwd) { const child = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'ignore', 'pipe'] }); child.stderr.on('data', () => infrastructure.push('synthetic-service-stderr')); children.push(child); return child; }
async function ready(url) { const end = Date.now() + 30000; while (Date.now() < end) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(150); } throw new Error('Isolated service did not start'); }
async function state(page) { return page.evaluate(() => ({ capturedAt: new Date().toISOString(), path: location.pathname + location.search, title: document.title, text: document.body.innerText, scroll: { x: scrollX, y: scrollY }, visibility: document.visibilityState, focused: document.hasFocus(), activeElement: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') }, animations: document.getAnimations().map(animation => ({ playState: animation.playState, currentTime: String(animation.currentTime), target: animation.effect?.target?.tagName })), viewport: { width: innerWidth, height: innerHeight }, headings: [...document.querySelectorAll('h1,h2,h3')].map(el => el.textContent), controls: [...document.querySelectorAll('button,input,textarea,select,a')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).map(el => ({ tag: el.tagName, text: el.textContent?.trim().slice(0, 180), label: el.getAttribute('aria-label'), type: el.getAttribute('type'), disabled: el.disabled, value: ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) ? el.value : undefined, box: el.getBoundingClientRect().toJSON(), opacity: getComputedStyle(el).opacity, color: getComputedStyle(el).color, backgroundColor: getComputedStyle(el).backgroundColor, backgroundImage: getComputedStyle(el).backgroundImage, fontSize: getComputedStyle(el).fontSize, hitAtCenter: (() => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { tag: hit?.tagName, label: hit?.getAttribute('aria-label'), isTarget: el.contains(hit) }; })(), ancestors: (() => { const rows = []; for (let node = el.parentElement; node && rows.length < 8; node = node.parentElement) { const css = getComputedStyle(node); rows.push({ tag: node.tagName, box: node.getBoundingClientRect().toJSON(), position: css.position, opacity: css.opacity, transform: css.transform, overflow: css.overflow, display: css.display }); } return rows; })() })) })); }
async function capture(page, name) { const stem = `${String(++sequence).padStart(3, '0')}-${name.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 75)}`; await page.screenshot({ path: join(artifacts, `${stem}.png`), fullPage: false }); const snapshot = await state(page); await writeFile(join(artifacts, `${stem}.json`), JSON.stringify(snapshot, null, 2)); return { screenshot: `${stem}.png`, snapshot: `${stem}.json`, state: snapshot }; }
async function observe(page, name, pass, detail) { const evidence = await capture(page, name); results.push({ name, status: pass === null ? 'observed-context' : pass ? 'observed-pass' : 'observed-fail', detail, screenshot: evidence.screenshot, snapshot: evidence.snapshot }); console.log(`${pass === null ? 'CONTEXT' : pass ? 'OBSERVED' : 'PRODUCT GAP'} ${name}: ${detail}`); return evidence.state; }
async function segment(page, name, operation) { try { await operation(); } catch (error) { const evidence = await capture(page, name).catch(() => ({})); results.push({ name, status: 'blocked', detail: error.message, screenshot: evidence.screenshot, snapshot: evidence.snapshot }); console.log(`BLOCKED ${name}: ${error.message}`); } }
async function visibleHandle(page, selector, text) { const handle = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.disabled && (text === undefined || el.textContent.trim() === text); }), { timeout: 7000 }, selector, text); return handle.asElement(); }
async function pointer(page, selector, text) { await page.bringToFront(); const element = await visibleHandle(page, selector, text); try { await element.scrollIntoView(); await page.waitForFunction(el => { const r = el.getBoundingClientRect(); return el.isConnected && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, { timeout: 7000 }, element); await element.asLocator().click(); actions.push({ at: new Date().toISOString(), kind: 'native-pointer', selector, text, path: new URL(page.url()).pathname }); } finally { await element.dispose(); } }
async function fill(page, selector, text) { await pointer(page, selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(text); assert.equal(await page.$eval(selector, el => el.value), text); actions.push({ at: new Date().toISOString(), kind: 'native-text', selector, syntheticText: text }); }
async function nav(page, label) { await pointer(page, 'aside nav button', label); await sleep(350); }
async function waitPath(page, path) { const started = Date.now(); await page.waitForFunction(path => location.pathname === path, { timeout: 15000 }, path); actions.push({ at: new Date().toISOString(), kind: 'route-observed', path, waitedMs: Date.now() - started }); await sleep(350); }
async function login(page, phone, nickname) {
  await page.bringToFront(); await page.goto(`${origin}/login`, { waitUntil: 'networkidle0' });
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
  await page.setViewport(viewport); await page.emulateTimezone('Asia/Shanghai'); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000); await page.bringToFront();
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
    request.onsuccess = () => { const database = request.result, names = ['todos', 'expenses', 'quickNotes', 'diary', 'settings', 'outbox']; const transaction = database.transaction(names, 'readonly'), rows = {};
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

async function dateInput(page, selector, iso) {
  // Native segmented Chrome date control; never assigns input.value or dispatches
  // fabricated change events. If locale behavior differs, record tool blockage.
  await pointer(page, selector); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  const [year, month, day] = iso.split('-');
  await page.keyboard.type(month); await page.keyboard.press('ArrowRight'); await page.keyboard.type(day); await page.keyboard.press('ArrowRight'); await page.keyboard.type(year); await page.keyboard.press('Tab');
  const actual = await page.$eval(selector, el => el.value); actions.push({ kind: 'native-segmented-date', selector, expected: iso, actual }); assert.equal(actual, iso, 'Native date editing must reach the intended value');
}
async function checked(page, selector, value) { if (await page.$eval(selector, el => el.checked) !== value) await pointer(page, selector); assert.equal(await page.$eval(selector, el => el.checked), value); }
async function settledRows(page, api) { let local; for (let i = 0; i < 60; i++) { local = await localRows(page, api.ownerId); if (!local.outbox.length) return local; await sleep(250); } return local; }
async function back(page, from) { await page.bringToFront(); await page.goBack({ waitUntil: 'domcontentloaded' }); actions.push({ kind: 'browser-history-back', from }); await sleep(400); }
async function firstValue(page, narrow = false) {
  if (narrow) { await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); actions.push({ kind: 'browser-prefers-reduced-motion', value: 'reduce' }); }
  const label = narrow ? 'Y1N' : 'Y1'; await login(page, narrow ? '13900008803' : '13900008801', `Synthetic ${label}`);
  await observe(page, `${label}-first-use-one-record-task`, (await state(page)).text.includes('先记一件刚发生的事') && !(await state(page)).text.includes('¥2,500'), 'New account sees a clear first action and no invented budget');
  await pointer(page, 'main a', '写下第一条速记'); await waitPath(page, '/quick-note');
  await fill(page, 'textarea[aria-label="速记内容"]', '明天要交报销单；午饭15');
  await observe(page, `${label}-native-input-visible`, true, 'Requested phrase is visible after actual home navigation, not a direct capture URL');
  await pointer(page, 'button', '查看确认稿'); await waitPath(page, '/quick-note/result');
  const tomorrow = businessDate(1), dateSelector = 'input[aria-label="第1个待办截止日期"]';
  await observe(page, `${label}-absolute-date-CNY-preview`, await page.$eval(dateSelector, el => el.value) === tomorrow && await page.$eval('input[aria-label="第1笔金额（人民币元）"]', el => Number(el.value)) === 15, 'Editable absolute date and CNY amount are actual control values, not raw-text matches');
  await checked(page, 'input[aria-label="我愿意记录这次心情"]', false);
  await checked(page, 'input[aria-label="将这段文字记入日记"]', true);
  await fill(page, 'textarea[aria-label="日记内容"]', 'Synthetic excluded diary candidate');
  await checked(page, 'input[aria-label="将这段文字记入日记"]', false);
  await pointer(page, 'button', '确认保存所选记录'); await page.waitForFunction(() => location.search.includes('receipt='));
  const api = await apiFor(page), local = await settledRows(page, api);
  const server = { todos: (await api('/todos')).todos, expenses: (await api('/expenses')).expenses, notes: (await api('/quicknote')).notes };
  const todo = local.todos.find(row => row.text === '交报销单'), expense = local.expenses.find(row => row.amount === 1500);
  await writeFile(join(artifacts, `${label}-result-data.json`), JSON.stringify({ tomorrow, local, server }, null, 2));
  await observe(page, `${label}-selected-only-durable-result`, Boolean(todo && expense && todo.dueDate === tomorrow && local.todos.length === 1 && local.expenses.length === 1 && local.quickNotes.length === 1 && local.diary.length === 0 && local.quickNotes[0].mood === null && local.quickNotes[0].diary === null && local.quickNotes[0].rawInput === '明天要交报销单；午饭15'), 'Actual IDB writes contain exactly requested expense/todo and no excluded diary or inferred mood');
  await observe(page, `${label}-cloud-ack`, local.outbox.length === 0 && server.todos.length === 1 && server.expenses.length === 1 && server.notes.length === 1 && server.todos.some(row => row.id === todo?.id && row.dueDate === tomorrow) && server.expenses.some(row => row.id === expense?.id && row.amount === 1500), 'Each entity is separately verified at the real isolated server');
  assert.ok(todo && expense, 'Result must exist before exact correction tasks');
  const receiptPath = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'receipt-reload-idempotence' }); await page.waitForSelector('h1');
  const replay = await localRows(page, api.ownerId); await observe(page, `${label}-receipt-refresh-no-duplicate`, replay.todos.length === local.todos.length && replay.expenses.length === local.expenses.length, 'Refreshing a durable receipt must not execute the capture again');
  await segment(page, `${label}-correct-saved-todo`, async () => {
    await pointer(page, `a[href="/todo?record=${todo.id}"]`); await waitPath(page, '/todo');
    await observe(page, `${label}-todo-exact-editor`, await page.$eval('#todo-text', el => el.value) === todo.text && await page.$eval('#todo-date', el => el.value) === tomorrow, 'Receipt opens the exact saved object, not a module list');
    await fill(page, '#todo-text', 'Synthetic 已核对报销单'); await dateInput(page, '#todo-date', businessDate(2));
    await pointer(page, '[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const cancelledLocal = await localRows(page, api.ownerId), cancelledRemote = (await api('/todos')).todos.find(row => row.id === todo.id);
    await observe(page, `${label}-todo-cancel-does-not-mutate`, cancelledLocal.todos.length === 1 && cancelledLocal.todos[0].text === todo.text && cancelledLocal.todos[0].dueDate === tomorrow && cancelledRemote.text === todo.text && cancelledRemote.dueDate === tomorrow, 'Cancel retained a draft only; both local and server original remain unchanged');
    await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'reload-cancelled-todo-draft' }); await page.waitForSelector('#todo-text');
    await observe(page, `${label}-todo-cancel-reload-retains-draft`, await page.$eval('#todo-text', el => el.value) === 'Synthetic 已核对报销单', 'Cancel persisted the draft but did not edit the original');
    await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const changedLocal = await settledRows(page, api), changed = changedLocal.todos.find(row => row.id === todo.id), changedRemote = (await api('/todos')).todos;
    await observe(page, `${label}-todo-corrected-same-id-local`, changedLocal.todos.length === 1 && changed?.text === 'Synthetic 已核对报销单' && changed.dueDate === businessDate(2), 'Local exact-ID correction, no duplicate');
    await observe(page, `${label}-todo-correction-cloud-ack`, changedLocal.outbox.length === 0 && changedRemote.length === 1 && changedRemote[0].id === todo.id && changedRemote[0].text === changed.text && changedRemote[0].dueDate === changed.dueDate, 'Queue and actual server object separately verify correction');
    await back(page, '/todo'); await waitPath(page, '/quick-note/result'); assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, receiptPath);
    await observe(page, `${label}-todo-correction-return`, true, 'Corrected same ID/date and returned to original receipt through browser history');
  });
  await segment(page, `${label}-correct-saved-expense`, async () => {
    if (!new URL(page.url()).search.includes('receipt=')) { await back(page, new URL(page.url()).pathname); await waitPath(page, '/quick-note/result'); }
    await pointer(page, `a[href="/expense?record=${expense.id}"]`); await waitPath(page, '/expense');
    assert.equal(await page.$eval('#expense-amount', el => Number(el.value)), 15);
    await fill(page, '#expense-amount', '16.25'); await fill(page, '#expense-name', 'Synthetic 已核对午饭');
    await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const changedLocal = await settledRows(page, api), changed = changedLocal.expenses.find(row => row.id === expense.id), changedRemote = (await api('/expenses')).expenses;
    await observe(page, `${label}-expense-correction-cloud-ack`, changedLocal.outbox.length === 0 && changedLocal.expenses.length === 1 && changedRemote.length === 1 && changedRemote[0].id === expense.id && changedRemote[0].amount === 1625 && changedRemote[0].name === 'Synthetic 已核对午饭', 'No extra record; exact server correction and ACK');
    await observe(page, `${label}-expense-correction-exact-cents`, changed?.amount === 1625 && changed.name === 'Synthetic 已核对午饭', 'Same record updates to exact fen, without another expense');
    await back(page, '/expense'); await waitPath(page, '/quick-note/result');
  });
  await segment(page, `${label}-whole-class-and-optional-inference`, async () => {
    if (!new URL(page.url()).search.includes('receipt=')) { await back(page, new URL(page.url()).pathname); await waitPath(page, '/quick-note/result'); }
    await pointer(page, 'button', '再记一条'); await waitPath(page, '/quick-note');
    assert.equal(await page.$eval('textarea[aria-label="速记内容"]', el => el.value), '', 'Committed raw input must not reappear as a new duplicate draft');
    const source = '12.34是页码，不是花销；同事说“今天很开心”；明天18:30交报销单';
    await fill(page, 'textarea[aria-label="速记内容"]', source); await pointer(page, 'button', '查看确认稿'); await waitPath(page, '/quick-note/result');
    await pointer(page, 'summary', '查看原文与本机确认稿');
    await observe(page, `${label}-time-and-original-before-any-manual-repair`, await page.$eval('input[aria-label="第1个待办内容"]', el => el.value.includes('18:30')) && (await state(page)).text.includes('截止日期精确到天') && (await state(page)).text.includes(source), 'Specific time and original must be retained before deletion/re-add can mask a parser omission');
    assert.equal(await page.$$('input[aria-label^="第1笔金额"]').then(rows => rows.length), 0);
    await pointer(page, 'button[aria-label="添加收支"]'); await fill(page, 'input[aria-label="第1笔收支名称"]', 'Synthetic 手动补漏'); await fill(page, 'input[aria-label="第1笔金额（人民币元）"]', '7.25');
    await pointer(page, 'button[aria-label="移除第1笔收支"]'); await pointer(page, 'button[aria-label="添加收支"]'); await fill(page, 'input[aria-label="第1笔收支名称"]', 'Synthetic 手动补漏'); await fill(page, 'input[aria-label="第1笔金额（人民币元）"]', '7.25');
    await pointer(page, 'button[aria-label="移除第1个待办"]'); await pointer(page, 'button[aria-label="添加待办"]'); await fill(page, 'input[aria-label="第1个待办内容"]', 'Synthetic 18:30交报销单');
    await checked(page, 'input[aria-label="将这段文字记入日记"]', false); await checked(page, 'input[aria-label="我愿意记录这次心情"]', false);
    await observe(page, `${label}-added-missed-class-readded-final-row`, true, 'Actually added an absent category, removed final items and re-added them; optional destinations excluded');
    await pointer(page, 'button', '确认保存所选记录'); await page.waitForFunction(() => location.search.includes('receipt='));
    const saved = await settledRows(page, api);
    const remoteNotes = (await api('/quicknote')).notes, remoteExpenses = (await api('/expenses')).expenses, remoteTodos = (await api('/todos')).todos;
    await observe(page, `${label}-manual-additions-cloud-ack`, saved.outbox.length === 0 && remoteNotes.some(row => row.content === source) && remoteExpenses.some(row => row.name === 'Synthetic 手动补漏' && row.amount === 725) && remoteTodos.some(row => row.text === 'Synthetic 18:30交报销单' && !row.dueDate), 'Manually chosen additions independently verified at server');
    const last = saved.quickNotes.find(row => row.rawInput === source);
    await observe(page, `${label}-only-chosen-facts-written`, Boolean(last && last.mood === null && last.diary === null && saved.expenses.some(row => row.name === 'Synthetic 手动补漏' && row.amount === 725) && saved.todos.some(row => row.text === 'Synthetic 18:30交报销单' && !row.dueDate)), 'Quoted emotion/page number not misclassified; explicit manual additions survive');
  });
  await observe(page, `${label}-no-horizontal-overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `Rendered task result at ${narrow ? 360 : 1280}px`);
}

async function retrievePast(page) {
  await login(page, '13900008802', 'Synthetic Y2'); const api = await apiFor(page);
  const items = Array.from({ length: 70 }, (_, index) => ({ amount: 1000 + index, category: 'food', name: 'Synthetic 同名午饭', date: businessDate(-Math.floor(index / 10)) }));
  const expenses = (await api('/expenses/batch', { items })).expenses, diaries = [];
  for (let offset = 0; offset < 7; offset++) diaries.push((await api('/diary', { date: businessDate(-offset), content: `Synthetic 同名日记 ${offset} · 需要找回与修改的具体原文`, moodScore: null })).diary);
  const todo = (await api('/todos', { text: 'Synthetic 已完成但明天到期', dueDate: businessDate(1) })).todo; const completed = (await api(`/todos/${todo.id}/toggle`, undefined, 'PATCH')).todo;
  await writeFile(join(artifacts, 'Y2-fixture-data.json'), JSON.stringify({ setup: 'isolated authenticated API preconditions, not UI creation', expenses, diaries, completed }, null, 2));
  await page.bringToFront(); await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-after-explicit-fixture', fixtureOnly: true }); await page.waitForSelector('main');
  await nav(page, '时间线'); await waitPath(page, '/timeline');
  const data = await localRows(page, api.ownerId), localTodo = data.todos.find(row => row.id === todo.id);
  const completionView = await page.$eval('button[aria-label="完成待办: Synthetic 已完成但明天到期"]', el => ({ sectionDate: el.closest('section')?.getAttribute('aria-label'), visibleText: el.innerText }));
  await observe(page, 'Y2-completion-uses-actual-action-time', localTodo?.completedAt === Date.parse(completed.completedAt) && completionView.sectionDate === businessDate() && completionView.sectionDate !== todo.dueDate && /刚刚|分钟前/.test(completionView.visibleText), 'Actual completion timestamp is synced separately from tomorrow deadline; saying just now is valid only for this actual completion');
  await pointer(page, 'button', '继续查看较早记录（还有 18 条）');
  await observe(page, 'Y2-all-history-reachable', (await state(page)).text.includes('78/78'), 'All 70 expenses + 7 diaries + completion are reachable through continuation');
  await segment(page, 'Y2-old-expense-correct-and-return', async () => {
    const target = expenses.find(row => row.amount === 1065), selector = 'button[aria-label="收支: -¥10.65 Synthetic 同名午饭"]';
    const handle = await visibleHandle(page, selector); await handle.scrollIntoView(); await handle.dispose(); await sleep(300); const before = await state(page); await capture(page, 'Y2-expense-origin-viewport');
    await pointer(page, selector); await waitPath(page, '/expense'); await observe(page, 'Y2-old-expense-exact', await selectedDetail(page, { content: target.name, date: target.date, amount: '10.65' }), 'Correct target among same-named records, including exact date and cents');
    await fill(page, '#expense-name', 'Synthetic 已修正历史账单'); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const changedLocal = await settledRows(page, api), changed = changedLocal.expenses.find(row => row.id === target.id), remote = (await api('/expenses')).expenses;
    await observe(page, 'Y2-old-expense-local-correction', changedLocal.expenses.length === 70 && changed?.date === target.date && changed.name === 'Synthetic 已修正历史账单', 'Exact local ID/date, count unchanged');
    await observe(page, 'Y2-old-expense-cloud-ack', changedLocal.outbox.length === 0 && remote.length === 70 && remote.some(row => row.id === target.id && row.date === target.date && row.name === 'Synthetic 已修正历史账单'), 'Each old expense edit also verified on actual server');
    await back(page, '/expense'); await waitPath(page, '/timeline'); const returned = await state(page);
    await observe(page, 'Y2-history-return-retains-page-position', Math.abs(returned.scroll.y - before.scroll.y) < 40 && returned.text.includes('Synthetic 已修正历史账单'), `Original ${before.scroll.y}px, return ${returned.scroll.y}px; continuation retained`);
  });
  await segment(page, 'Y2-old-diary-correct-and-return', async () => {
    if (new URL(page.url()).pathname !== '/timeline') { await nav(page, '时间线'); await waitPath(page, '/timeline'); }
    const target = diaries.find(row => row.date === businessDate(-3)); await pointer(page, `button[aria-label=${JSON.stringify(`日记: ${target.content.slice(0, 80)}`)}]`); await waitPath(page, '/diary');
    await observe(page, 'Y2-old-diary-real-date-unknown-mood', await page.$eval('#diary-content', el => el.value) === target.content && (await state(page)).text.includes(`${target.date} 的心情`) && !(await state(page)).text.includes('今天的心情'), 'Exact old object and its date shown; unknown mood is not five');
    const corrected = `Synthetic 已修正 · ${target.content}`; await fill(page, '#diary-content', corrected); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const afterDiary = await settledRows(page, api); const saved = (await api(`/diary/${target.id}`)).diary;
    await observe(page, 'Y2-diary-cloud-ack', afterDiary.outbox.length === 0 && afterDiary.diary.length === 7, 'Diary acknowledgment and unchanged count checked independently');
    await writeFile(join(artifacts, 'Y2-corrected-diary.json'), JSON.stringify({ expectedId: target.id, expectedDate: target.date, expectedContent: corrected, actual: saved }, null, 2));
    await observe(page, 'Y2-diary-same-id-date-server', saved.content === corrected && saved.date === target.date && saved.moodScore === null, 'Actual server row retains ID/date and unknown emotion');
    await back(page, '/diary'); await waitPath(page, '/timeline'); await observe(page, 'Y2-diary-return-corrected-source', (await state(page)).text.includes('Synthetic 已修正'), 'Return sees the corrected source');
  });
}
async function recoverStorage(page) {
  await login(page, '13900008804', 'Synthetic YF');
  // Explicit fault injection at the browser IndexedDB API boundary only. No
  // app stores, auth state or records are seeded and no control is DOM-clicked.
  await page.evaluate(() => { window.__originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, ...args) { if (this.name === 'settings' && String(value?.key).startsWith('capture-input:')) throw new DOMException('Synthetic quota', 'QuotaExceededError'); return window.__originalPut.call(this, value, ...args); }; });
  actions.push({ kind: 'synthetic-IDB-put-quota-injection', scope: 'capture-input only' });
  await pointer(page, 'main a', '写下第一条速记'); await waitPath(page, '/quick-note');
  const text = 'Synthetic 存储失败仍保留原文；明天要交资料'; await fill(page, 'textarea[aria-label="速记内容"]', text);
  await observe(page, 'YF-text-mode-failure-visible-editable', (await state(page)).text.includes('草稿存储暂时打不开') && await page.$eval('textarea', el => !el.disabled && el.value.includes('仍保留原文')), 'Actual text-mode init failure explains cause and preserves editable original');
  await pointer(page, 'button', '复制原文'); await capture(page, 'YF-copy-or-select-fallback');
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__originalPut; delete window.__originalPut; }); actions.push({ kind: 'remove-synthetic-quota-fault' });
  await pointer(page, 'button', '重试草稿存储'); await pointer(page, 'button', '查看确认稿'); await waitPath(page, '/quick-note/result');
  await observe(page, 'YF-recovery-no-retyping', (await state(page)).text.includes('规则整理可能有遗漏'), 'Storage recovery reaches confirmation with same raw input');
  await checked(page, 'input[aria-label="将这段文字记入日记"]', false); await pointer(page, 'button', '确认保存所选记录'); await page.waitForFunction(() => location.search.includes('receipt='));
  const api = await apiFor(page), local = await settledRows(page, api); await observe(page, 'YF-recovered-exact-original', local.quickNotes.some(row => row.rawInput === text), 'Original survives real browser failure, retry, confirmation and IndexedDB write');
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
  await isolated('Y1N-first-value-360', { width: 360, height: 800 }, page => firstValue(page, true));
  await isolated('YF-storage-recovery-1280', { width: 1280, height: 900 }, recoverStorage);
  for (const name of ['Y1-first-value-1280', 'Y2-retrieve-past-1280', 'Y1N-first-value-360', 'YF-storage-recovery-1280']) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
} catch (error) { infrastructure.push({ fatal: error.message }); process.exitCode = 2; }
finally {
  if (browser) await browser.close();
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? undefined : new Promise(resolve => child.once('exit', resolve))));
  metadata.endedAt = new Date().toISOString();
  metadata.sourceEnd = await sourceSnapshot();
  if (metadata.sourceStart.trackedContentSha256 !== metadata.sourceEnd.trackedContentSha256 || metadata.sourceStart.dirty || metadata.sourceEnd.dirty) infrastructure.push({ sourceChangedOrDirty: true });
  await writeFile(join(artifacts, 'outcome-report.json'), JSON.stringify({ metadata, results, actions, traffic, infrastructure }, null, 2));
  await writeFile(join(artifacts, 'README.txt'), 'First-package scripted evidence, pending independent product review. Read outcome-report.json; observed-fail means a product gap, blocked means the step did not complete. Videos and Chrome performance traces cover successful and failed operations. All data are synthetic. Initial login URL and explicit historical API setup are identified separately; business navigation uses rendered controls. No live model, SMS or production data.\n');
  await rm(scratch, { recursive: true, force: true });
}
if (infrastructure.some(item => typeof item === 'object')) process.exitCode = 2;
if (!process.exitCode && results.some(row => row.status === 'observed-fail' || row.status === 'blocked')) process.exitCode = 1;
