// Real Chromium + real HTTP cookies + real IndexedDB. Synthetic, isolated data only.
import assert from 'node:assert/strict';
import { exerciseUserAI } from './user-ai-browser-contract.mjs';
import { mkdtemp, mkdir, rm, writeFile, access, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { sampleStableWorkspace, workspaceLayoutFailures } from './workspace-layout-contract.mjs';
import { sampleTimelineHeading, timelineHeadingFailures } from './timeline-heading-contract.mjs';
import { installStorageProgress, projectStorageProgress, storageProgressSchema } from './audit-storage-progress.mjs';

// BEGIN safe initialization capture (also exercised without a browser in unit tests).
const traceSchema = {
  phase: ['initial', 'recovery', 'data-updated'],
  stage: ['initialization', 'settings', 'sync', 'sync-offline', 'stores', 'expense', 'todo', 'habit', 'quick-note', 'schedule', 'diary', 'coach', 'goal'],
  outcome: ['start', 'success', 'error', 'timeout', 'cancel'],
  errorName: ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AuthError', 'AbortError', 'TimeoutError', 'DatabaseClosedError', 'TransactionInactiveError', 'PrematureCommitError', 'SubTransactionError', 'QuotaExceededError', 'UpgradeError', 'VersionError', 'InvalidStateError', 'NotFoundError', 'ConstraintError', 'DataError', 'ReadOnlyError', 'UnknownError', 'SecurityError', 'NetworkError', 'OpenFailedError', 'MissingAPIError', 'BulkError', 'ModifyError', 'unknown'],
  errorCategory: ['authority-changed', 'local-data-changed', 'auth', 'storage', 'abort', 'timeout', 'unknown'],
  transactionMode: ['readonly', 'readwrite'],
};
const traceFlags = ['authChecked', 'isAuthenticated', 'identityUnavailable', 'signedOut', 'boundOwner', 'verifiedOwner', 'ownersMatch', 'generationChanged', 'revisionChanged', 'dbOpen', 'dbBlocked', 'recoveryErrorPresent', 'ambientTransactionPresent', 'ambientTransactionActive'];
const traceRoutes = ['/', '/login', '/onboarding', '/data-info', '/schedule', '/quick-note', '/quick-note/result', '/expense', '/todo', '/habit', '/diary', '/coach', '/insights', '/settings', '/goal', '/timeline', '/more'];
const traceMarkers = ['navigation-committed', 'document-start', 'login-start', 'login-root-ready', 'route-start', 'route-ready', 'reload-start', 'reload-ready', 'account-b-login-start', 'account-b-login-root-ready', 'account-b-todo-ready'];
const traceLimit = 2048, pageErrorLimit = 160;
const chronology = [], storageChronology = [], errors = [], tracedPages = new WeakMap();
let storageDropped = 0;
const storageLimit = 4096;
const traceStarted = performance.now();
let traceSequence = 0, traceDropped = 0, nextPage = 0, nextRequest = 0;
const safeCounter = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const elapsed = start => Math.min(1_000_000_000, Math.max(0, Math.round(performance.now() - start)));
const safeErrorName = name => traceSchema.errorName.includes(name) ? name : 'unknown';
function safeExceptionName(error) {
  try { const name = error?.name; return safeErrorName(name); } catch { return 'unknown'; }
}
function safeRoute(url) {
  try { const path = new URL(url, 'http://synthetic.invalid').pathname; return traceRoutes.includes(path) ? path : 'unknown'; } catch { return 'unknown'; }
}
function safeEndpoint(url) {
  try {
    const path = new URL(url).pathname;
    const endpoints = { '/api/auth/me': 'auth-me', '/api/auth/send-code': 'auth-send-code', '/api/auth/verify': 'auth-verify', '/api/auth/register': 'auth-register', '/api/auth/logout': 'auth-logout', '/api/sync/push': 'sync-push', '/api/sync/pull': 'sync-pull', '/api/sync/bootstrap': 'sync-bootstrap', '/api/user/settings': 'settings' };
    if (Object.hasOwn(endpoints, path)) return endpoints[path];
    if (path.startsWith('/api/coach/')) return 'coach';
    if (path.startsWith('/api/auth/')) return 'auth';
    if (path.startsWith('/api/sync/')) return 'sync';
    if (path.startsWith('/api/')) return 'api';
    return traceRoutes.includes(path) ? 'document' : 'asset';
  } catch { return 'unknown'; }
}
function projectTrace(value) {
  try {
    if (!value || typeof value !== 'object') return null;
    const safe = {};
    for (const key of ['attempt', 'sequence', 'elapsedMs']) { const field = value[key]; if (!safeCounter(field)) return null; safe[key] = field; }
    for (const key of ['phase', 'stage', 'outcome']) { const field = value[key]; if (!traceSchema[key].includes(field)) return null; safe[key] = field; }
    for (const key of ['errorName', 'errorCategory', 'transactionMode']) { const field = value[key]; if (traceSchema[key].includes(field)) safe[key] = field; }
    for (const key of traceFlags) { const field = value[key]; if (typeof field === 'boolean') safe[key] = field; }
    return safe;
  } catch { return null; }
}
function appendTrace(page, event) {
  const state = tracedPages.get(page);
  if (!state) return;
  chronology.push({ sequence: ++traceSequence, elapsedMs: elapsed(traceStarted), page: state.id, document: state.document, ...event });
  if (chronology.length > traceLimit) { traceDropped += chronology.length - traceLimit; chronology.splice(0, chronology.length - traceLimit); }
}
function boundary(page, marker, route = page.url()) {
  // Call sites supply fixed labels, never account names or addresses.
  appendTrace(page, { kind: 'boundary', marker: traceMarkers.includes(marker) ? marker : 'unknown', route: safeRoute(route) });
}
async function observeInitialization(page) {
  if (tracedPages.has(page)) return;
  tracedPages.set(page, { id: ++nextPage, document: 0 });
  const requests = new WeakMap();
  page.on('pageerror', error => {
    const name = safeExceptionName(error);
    if (errors.length < pageErrorLimit) errors.push(name);
    appendTrace(page, { kind: 'pageerror', name });
  });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) boundary(page, 'navigation-committed', frame.url()); });
  page.on('request', request => {
    const method = request.method();
    const safe = { request: ++nextRequest, documentAtRequestStart: tracedPages.get(page).document, endpoint: safeEndpoint(request.url()), method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? method : 'unknown' };
    requests.set(request, { safe, started: performance.now() });
    appendTrace(page, { kind: 'request', outcome: 'start', ...safe });
  });
  page.on('response', response => {
    const request = requests.get(response.request());
    if (!request) return;
    const status = response.status();
    appendTrace(page, { kind: 'request', outcome: 'response', ...request.safe, durationMs: elapsed(request.started), ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}) });
  });
  page.on('requestfinished', request => {
    const saved = requests.get(request);
    if (saved && saved.safe.endpoint !== 'asset') appendTrace(page, { kind: 'request', outcome: 'finished', ...saved.safe, durationMs: elapsed(saved.started) });
  });
  page.on('requestfailed', request => {
    const saved = requests.get(request);
    if (saved) appendTrace(page, { kind: 'request', outcome: 'failed', ...saved.safe, durationMs: elapsed(saved.started), failure: 'network-failure' });
  });
  await page.exposeFunction('__youtraceInitializationDiagnostic', value => {
    if (value?.kind === 'storage-progress') {
      const safe = projectStorageProgress(value.event);
      if (safe) {
        const target = tracedPages.get(page);
        storageChronology.push({ elapsedMs: elapsed(traceStarted), page: target.id, document: target.document, event: safe });
        if (storageChronology.length > storageLimit) { storageDropped += storageChronology.length - storageLimit; storageChronology.splice(0, storageChronology.length - storageLimit); }
      }
      return;
    }
    if (value?.kind === 'document-start') {
      tracedPages.get(page).document += 1;
      const route = value.route;
      boundary(page, 'document-start', traceRoutes.includes(route) ? route : 'unknown');
      return;
    }
    const safe = projectTrace(value);
    if (safe) appendTrace(page, { kind: 'initialization', event: safe });
  });
  await page.evaluateOnNewDocument((schema, flags, routes) => {
    if (window !== window.top) return;
    const send = value => { try { void window.__youtraceInitializationDiagnostic(value).catch(() => undefined); } catch { /* Observation only. */ } };
    const path = location.pathname;
    send({ kind: 'document-start', route: routes.includes(path) ? path : 'unknown' });
    window.addEventListener('youtrace:initialization-diagnostic', event => {
      // Project before crossing the browser boundary as well as in Node. A
      // spoofed CustomEvent cannot send a message, ID, token or arbitrary field.
      try {
        const value = event.detail, safe = {};
        if (!value || typeof value !== 'object') return;
        for (const key of ['attempt', 'sequence', 'elapsedMs']) {
          const field = value[key];
          if (!Number.isSafeInteger(field) || field < 0 || field > 1_000_000_000) return;
          safe[key] = field;
        }
        for (const key of ['phase', 'stage', 'outcome']) { const field = value[key]; if (!schema[key].includes(field)) return; safe[key] = field; }
        for (const key of ['errorName', 'errorCategory', 'transactionMode']) { const field = value[key]; if (schema[key].includes(field)) safe[key] = field; }
        for (const key of flags) { const field = value[key]; if (typeof field === 'boolean') safe[key] = field; }
        send(safe);
      } catch { /* Observation only. */ }
    });
  }, traceSchema, traceFlags, traceRoutes);
  await page.evaluateOnNewDocument(installStorageProgress, storageProgressSchema);
}
function firstFailureTrace(error) {
  return { version: 1, syntheticOnly: true, failureName: safeExceptionName(error), limit: traceLimit, dropped: traceDropped, storageLimit, storageDropped, storageChronology: storageChronology.map(row => ({ ...row, event: { ...row.event, stores: [...row.event.stores] } })), pageErrorNames: [...errors], chronology: chronology.map(row => ({ ...row, ...(row.event ? { event: { ...row.event } } : {}) })) };
}
// END safe initialization capture.

const appDir = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'youtrace-browser-'));
const artifactDir = resolve(appDir, 'test-artifacts');
await mkdir(artifactDir, { recursive: true });
const port = Number(process.env.E2E_API_PORT || 3327), frontPort = Number(process.env.E2E_FRONT_PORT || 5273);
const front = `http://127.0.0.1:${frontPort}`;
const env = { ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_URL: `file:${join(scratch, 'fixture.db')}`, JWT_SECRET: randomBytes(48).toString('hex'), ALLOWED_ORIGINS: front, DEV_OTP_EXPOSE: 'true', SMS_PROVIDER_URL: '', SMS_PROVIDER_TOKEN: '', AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'), VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${port}` };
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
  boundary(page, 'login-start', '/login');
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
  let geometry;
  try {
    const sample = await page.waitForFunction(sampleStableWorkspace, { timeout: 20000, polling: 'raf' });
    geometry = await sample.jsonValue();
    await sample.dispose();
  } catch (error) {
    geometry = await page.evaluate(() => window.__youtraceWorkspaceLayoutSample?.snapshot ?? null);
    report.push({ name: 'Workspace layout readiness', passed: false, detail: geometry });
    console.log('WORKSPACE_LAYOUT', JSON.stringify(geometry));
    throw error;
  }
  console.log('WORKSPACE_LAYOUT', JSON.stringify(geometry));
  const failures = workspaceLayoutFailures(geometry);
  report.push({ name: 'Workspace clears actual primary navigation', passed: failures.length === 0, detail: geometry, failures });
  assert.deepEqual(failures, [], 'workspace layout contract');
  boundary(page, 'login-root-ready', '/');
}
async function route(page, path) { boundary(page, 'route-start', path); await page.bringToFront(); await page.goto(front + path, { waitUntil: 'networkidle0' }); await page.waitForSelector('h1,h2'); assert.equal(new URL(page.url()).pathname, path); boundary(page, 'route-ready', path); }
async function addTodo(page, text) { await route(page, '/todo'); await page.click('[aria-label="新建待办"]'); await page.waitForFunction(() => { const input = document.querySelector('[role=dialog] input'); return input && !input.matches(':disabled'); }); await page.type('[role=dialog] input', text); await clickText(page, '保存'); await page.waitForFunction((needle) => document.body.textContent.includes(needle) && !document.querySelector('[role=dialog]'), {}, text); }
// The expanded business cases use real pointer and keyboard input. DOM evaluation
// below reads rendered controls/assertions. A separately named migration case
// creates only an explicit synthetic pre-upgrade IndexedDB source; current app
// stores and authentication state are never seeded or bypassed.
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
async function reloadPage(page) { boundary(page, 'reload-start'); await page.bringToFront(); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('main'); boundary(page, 'reload-ready'); }
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
    await clickControl(page, '[role=dialog] select[aria-label="记账分类"]'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await expectText(page, 'Synthetic expense cents');
    await clickControl(page, '[aria-label="添加花销"]');
    await fillControl(page, '#expense-amount', '56.78');
    await clickButton(page, '收入', '[role=dialog]');
    assert.equal(await page.$eval('[role=dialog] button[aria-pressed=true]', el => el.textContent.trim()), '收入');
    await fillControl(page, '#expense-name', 'Synthetic income cents');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page);
    await expectText(page, 'Synthetic expense cents'); await expectText(page, 'Synthetic income cents');
    await expectText(page, '-¥12.34', true, '[aria-label="支出 12.34元"]');
    await expectText(page, '+¥56.78', true, '[aria-label="收入 56.78元"]');
    // Open the actual record editor, explicitly confirm deletion, then close the retained draft.
    await clickControl(page, 'button[aria-label^="编辑记账 Synthetic expense cents"]'); await clickButton(page, '删除', '[role=dialog]'); await clickButton(page, '确认删除', '[aria-label="确认删除记账"]'); await clickButton(page, '取消（保留草稿）', '[role=dialog]'); await modalClosed(page);
    await expectText(page, 'Synthetic expense cents', false);
    await clickControl(page, 'button[aria-label^="编辑记账 Synthetic income cents"]'); await clickButton(page, '删除', '[role=dialog]'); await clickButton(page, '确认删除', '[aria-label="确认删除记账"]'); await clickButton(page, '取消（保留草稿）', '[role=dialog]'); await modalClosed(page);
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
    await clickControl(page, ':is(button:not([role]),[role=button])[aria-label="09:00-10:30 Synthetic schedule original"]');
    assert.equal(await page.$eval('#schedule-location', (el) => el.value), 'Synthetic room A', 'schedule location must survive reload');
    await fillControl(page, '#schedule-title', 'Synthetic schedule revised');
    await fillControl(page, '#schedule-location', 'Synthetic room B');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page);
    await expectText(page, 'Synthetic schedule original', false);
    await clickControl(page, ':is(button:not([role]),[role=button])[aria-label="09:00-10:30 Synthetic schedule revised"]');
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
    await clickControl(page, '[role=dialog] button[aria-label="开心"]');
    await clickButton(page, '保存', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page);
    await expectText(page, 'Synthetic diary original: 今天完成了一件小事。');
    await expectText(page, '8/10', true, 'main span');
    await clickControl(page, 'button[aria-label^="编辑"][aria-label$="的日记"]');
    await fillControl(page, '#diary-content', 'Synthetic diary revised: 保留修改后的完整内容。');
    await clickControl(page, '[role=dialog] button[aria-label="平静"]');
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
    const learningOption = await page.$eval('select[aria-label="领域"]', (el) => {
      const options = [...el.options].filter(option => !option.disabled);
      const matches = options.filter(option => option.value === '学习');
      return { unique: matches.length === 1, index: options.findIndex(option => option.value === '学习') };
    });
    assert.equal(learningOption.unique, true, 'The rendered learning option must exist exactly once and be enabled');
    await clickControl(page, 'select[aria-label="领域"]');
    await page.keyboard.press('Home');
    for (let index = 0; index < learningOption.index; index++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('select[aria-label="领域"]', (el) => el.value), '学习');
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
    const habitDate = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()));
    await clickControl(page, `[aria-label="完成 Synthetic 学习习惯（仅今天 ${habitDate}）"]`);
    await expectAttribute(page, `[aria-label="取消完成 Synthetic 学习习惯（仅今天 ${habitDate}）"]`, 'aria-pressed', 'true');
    await reloadPage(page);
    await expectAttribute(page, `[aria-label="取消完成 Synthetic 学习习惯（仅今天 ${habitDate}）"]`, 'aria-pressed', 'true');
    await clickControl(page, `[aria-label="取消完成 Synthetic 学习习惯（仅今天 ${habitDate}）"]`);
    await expectAttribute(page, `[aria-label="完成 Synthetic 学习习惯（仅今天 ${habitDate}）"]`, 'aria-pressed', 'false');
    const pastDate = await page.$eval('button[aria-label$="未完成，点击补卡"]', (el) => el.getAttribute('aria-label').split(' ')[0]);
    assert.match(pastDate, /^\d{4}-\d{2}-\d{2}$/, 'backfill date must come from the rendered week');
    await clickControl(page, `button[aria-label="${pastDate} 未完成，点击补卡"]`);
    await expectAttribute(page, `button[aria-label="${pastDate} 已完成，点击撤销"]`, 'aria-pressed', 'true');
    await reloadPage(page);
    await expectAttribute(page, `[aria-label="完成 Synthetic 学习习惯（仅今天 ${habitDate}）"]`, 'aria-pressed', 'false');
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
    await expectText(page, 'Synthetic 学习目标', true, 'main h2');
    await clickControl(page, '[aria-label="删除目标 Synthetic 学习目标"]');
    await clickButton(page, '确认删除', '[role=dialog]'); await modalClosed(page);
    await reloadPage(page); await expectText(page, 'Synthetic 学习目标', false, 'main h2');
  });

  await scenario('Goal: two isolated devices retain offline conflict evidence and propagate deletion', async () => {
    await route(page, '/goal');
    await clickControl(page, '[aria-label="新建目标"]');
    await fillControl(page, '[role=dialog] input[placeholder="想完成什么？"]', 'Synthetic 跨设备目标');
    await clickButton(page, '创建', '[role=dialog]'); await modalClosed(page);
    const initialGoalAck = page.waitForResponse((response) => response.url().endsWith('/api/sync/push') && response.request().method() === 'POST' && JSON.parse(response.request().postData() || '{}').goals?.some((goal) => goal.title === 'Synthetic 跨设备目标' && goal.progress === 25));
    await clickControl(page, '[aria-label="将目标进度设为 25%"]');
    assert.equal((await initialGoalAck).status(), 200);
    await expectText(page, '已同步', true, 'main article span');
    await clickControl(page, '[aria-label="编辑目标 Synthetic 跨设备目标"]');
    await fillControl(page, '[role=dialog] #goal-description', '跨设备完整描述');
    const editedGoalAck = page.waitForResponse((response) => response.url().endsWith('/api/sync/push') && response.request().method() === 'POST' && JSON.parse(response.request().postData() || '{}').goals?.some((goal) => goal.description === '跨设备完整描述'));
    await clickButton(page, '保存修改', '[role=dialog]'); await modalClosed(page);
    await expectText(page, '已同步', true, 'main article span');
    assert.equal((await editedGoalAck).status(), 200);
    const otherContext = await browser.createBrowserContext();
    const other = await otherContext.newPage();
    await observeInitialization(other);
    await login(other, '13900009901', 'Synthetic A');
    await route(other, '/goal');
    await expectText(other, 'Synthetic 跨设备目标', true, 'main h2');
    await expectText(other, '跨设备完整描述');
    await expectText(other, '0/1 完成 · 平均进度 25%');
    await page.bringToFront(); await page.setOfflineMode(true);
    await clickControl(page, '[aria-label="将目标进度设为 75%"]');
    await expectText(page, '0/1 完成 · 平均进度 75%');
    await expectText(page, '待同步', true, 'main article span');
    await other.bringToFront();
    const otherGoalAck = other.waitForResponse((response) => response.url().endsWith('/api/sync/push') && response.request().method() === 'POST' && JSON.parse(response.request().postData() || '{}').goals?.some((goal) => goal.progress === 50));
    await clickControl(other, '[aria-label="将目标进度设为 50%"]');
    assert.equal((await otherGoalAck).status(), 200);
    await expectText(other, '已同步', true, 'main article span');
    await page.bringToFront(); await page.setOfflineMode(false);
    // The existing sync action retries and pulls a real 409 conflict; no fixture writes.
    await route(page, '/settings');
    await clickButton(page, '立即同步');
    await clickButton(page, '比较目标版本');
    await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent.includes('进度 75%') && document.querySelector('[role=dialog]')?.textContent.includes('进度 50%'));
    await clickButton(page, '采用云端版本', '[role=dialog]'); await modalClosed(page);
    await route(page, '/goal'); await expectText(page, '0/1 完成 · 平均进度 50%');
    await other.bringToFront();
    await clickControl(other, '[aria-label="删除目标 Synthetic 跨设备目标"]');
    const deletionAck = other.waitForResponse((response) => response.url().endsWith('/api/sync/push') && response.request().method() === 'POST' && JSON.parse(response.request().postData() || '{}').deletions?.goalIds?.length > 0);
    await clickButton(other, '确认删除', '[role=dialog]'); await modalClosed(other);
    assert.equal((await deletionAck).status(), 200);
    await reloadPage(page); await expectText(page, 'Synthetic 跨设备目标', false, 'main h2');
    await otherContext.close();
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
    await fillControl(page, '#budget-input', '-1');
    await clickButton(page, '保存', 'section[aria-label="预算"]');
    await expectText(page, '请输入 0 到 10000000 之间的预算金额，最多两位小数', true, '#budget-feedback');
    await expectAttribute(page, '#budget-input', 'aria-invalid', 'true');
    await fillControl(page, '#budget-input', '4321');
    await clickButton(page, '保存', 'section[aria-label="预算"]');
    await expectText(page, '预算保存在本设备；当前 ¥4321');
    await expectText(page, '已保存 ¥4,321 预算', true, '#budget-feedback');
    assert.equal(await page.$eval('[aria-label="通知"]', (el) => el.textContent.includes('预算')), false, 'budget feedback must stay inline rather than obscure the next setting');
    await clickButton(page, '深色', '[role=radiogroup][aria-label="主题"]');
    await expectAttribute(page, 'html', 'data-theme', 'dark');
    if (await page.$eval('[role=switch][aria-label="教练推送"]', (el) => el.getAttribute('aria-checked')) === 'false') {
      await clickControl(page, '[role=switch][aria-label="教练推送"]');
      await expectAttribute(page, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'true');
    }
    await clickControl(page, '[role=switch][aria-label="教练推送"]');
    await expectAttribute(page, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'false');
    const styleAck = page.waitForResponse((response) => response.url().endsWith('/api/user/settings')
      && response.request().method() === 'PATCH' && JSON.parse(response.request().postData() || '{}').changes?.coachStyle === 'data');
    await clickButton(page, '数据型', '[role=radiogroup][aria-label="教练风格"]', true);
    assert.equal((await styleAck).status(), 200, 'coach style update must receive a real backend ACK');
    const frequencyAck = page.waitForResponse((response) => response.url().endsWith('/api/user/settings')
      && response.request().method() === 'PATCH' && JSON.parse(response.request().postData() || '{}').changes?.pushLimit === 1);
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

  await scenario('Settings: two devices share reminder policy, preserve device budget, and compare offline conflicts', async () => {
    await route(page, '/settings');
    await clickControl(page, '[role=switch][aria-label="教练推送"]');
    await expectAttribute(page, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'false');
    await clickControl(page, '[aria-label="每天最多0条"]');
    await clickControl(page, '[role=switch][aria-label="晚间复盘"]');
    await expectAttribute(page, '[role=switch][aria-label="晚间复盘"]', 'aria-checked', 'true');
    await clickControl(page, '#evening-review-time');
    for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Tab');
    const eveningTime = await page.$eval('#evening-review-time', (el) => el.value);
    assert.notEqual(eveningTime, '21:00', 'native time editing remains visible before persistence');
    await clickControl(page, '[role=switch][aria-label="晚间复盘"]');
    await expectAttribute(page, '[role=switch][aria-label="晚间复盘"]', 'aria-checked', 'false');
    assert.equal(await page.$eval('#evening-review-time', (el) => el.value), eveningTime, 'turning a policy off preserves unsaved time input');
    await clickControl(page, '[role=switch][aria-label="晚间复盘"]');
    await expectAttribute(page, '[role=switch][aria-label="晚间复盘"]', 'aria-checked', 'true');
    const eveningTimeAck = page.waitForResponse((response) => response.url().endsWith('/api/user/settings') && response.request().method() === 'PATCH' && JSON.parse(response.request().postData() || '{}').changes?.eveningReviewTime === eveningTime);
    await clickButton(page, '保存晚间复盘时间');
    assert.equal((await eveningTimeAck).status(), 200);
    const quietTimeAck = page.waitForResponse((response) => response.url().endsWith('/api/user/settings') && response.request().method() === 'PATCH' && JSON.parse(response.request().postData() || '{}').changes?.quietStart !== undefined);
    await clickControl(page, '#quiet-start');
    for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Tab');
    const quietStart = await page.$eval('#quiet-start', (el) => el.value);
    await clickButton(page, '保存免打扰开始');
    assert.equal((await quietTimeAck).status(), 200);
    await expectText(page, '上次核对时，账号偏好已同步', true, '[aria-label="账号偏好同步"] p');
    const otherContext = await browser.createBrowserContext();
    const other = await otherContext.newPage(); await observeInitialization(other);
    await login(other, '13900009901', 'Synthetic A'); await route(other, '/settings');
    await expectText(other, '上次核对时，账号偏好已同步', true, '[aria-label="账号偏好同步"] p');
    await expectAttribute(other, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'false');
    await expectAttribute(other, '[aria-label="每天最多0条"]', 'aria-checked', 'true');
    await expectAttribute(other, '[role=switch][aria-label="晚间复盘"]', 'aria-checked', 'true');
    assert.equal(await other.$eval('#evening-review-time', (el) => el.value), eveningTime);
    assert.equal(await other.$eval('#quiet-start', (el) => el.value), quietStart);
    assert.notEqual(await other.$eval('#budget-input', (el) => el.value), '4321', 'device-only budget must not silently follow the account');
    await page.bringToFront(); await page.setOfflineMode(true);
    await clickButton(page, '温柔型', '[role=radiogroup][aria-label="教练风格"]', true);
    await page.waitForFunction(() => document.querySelector('[role=radiogroup][aria-label="教练风格"] [aria-checked="true"]')?.textContent.includes('温柔型'));
    await other.bringToFront();
    const otherStyleAck = other.waitForResponse((response) => response.url().endsWith('/api/user/settings') && response.request().method() === 'PATCH' && JSON.parse(response.request().postData() || '{}').changes?.coachStyle === 'strict');
    await clickButton(other, '严格型', '[role=radiogroup][aria-label="教练风格"]', true);
    assert.equal((await otherStyleAck).status(), 200);
    await expectText(other, '上次核对时，账号偏好已同步', true, '[aria-label="账号偏好同步"] p');
    await page.bringToFront(); await page.setOfflineMode(false);
    await clickButton(page, '重新核对账号偏好');
    await clickButton(page, '比较偏好版本');
    await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent.includes('温柔型') && document.querySelector('[role=dialog]')?.textContent.includes('严格型'));
    await clickButton(page, '使用云端偏好', '[role=dialog]'); await modalClosed(page);
    await expectText(page, '上次核对时，账号偏好已同步', true, '[aria-label="账号偏好同步"] p');
    assert.equal(await page.$eval('[role=radiogroup][aria-label="教练风格"] [aria-checked="true"]', (el) => el.textContent.includes('严格型')), true);
    await expectAttribute(page, '[role=switch][aria-label="教练推送"]', 'aria-checked', 'false');
    await otherContext.close();
  });

  await scenario('Goal migration: pre-generation IndexedDB copy, explicit upload, and retained source-table recovery preserve originals', async () => {
    await page.bringToFront();
    const ownerId = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user.id);
    assert.match(ownerId, /^[a-zA-Z0-9_-]+$/);
    const legacyContext = await browser.createBrowserContext();
    const legacyPage = await legacyContext.newPage(); await observeInitialization(legacyPage);
    await legacyPage.goto(front + '/data-info', { waitUntil: 'networkidle0' });
    // Historical schema fixture is necessary to exercise the actual browser
    // upgrade. It contains synthetic account-local source only, never real data.
    await legacyPage.evaluate(async (owner) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(`youtrace:user:${owner}`, 10);
        request.onupgradeneeded = () => {
          const goals = request.result.createObjectStore('goals', { keyPath: 'id' });
          for (const key of ['level', 'domain', 'priority']) goals.createIndex(key, key);
          request.result.createObjectStore('settings', { keyPath: 'key' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('goals', 'readwrite');
          transaction.objectStore('goals').put({ id: 'synthetic-browser-legacy-goal', title: 'Synthetic 旧窗口目标', description: '明确选择的旧目标描述', level: 'short', domain: '生活', priority: 'medium', progress: 25, targetDate: null, createdAt: 1000, updatedAt: 2000, privateMemo: 'SYNTHETIC_UNSELECTED_BROWSER_FIELD' });
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => { database.close(); reject(transaction.error); };
        };
      });
    }, ownerId);
    await login(legacyPage, '13900009901', 'Synthetic A'); await route(legacyPage, '/goal');
    await expectText(legacyPage, '仅本机', true, 'main article span');
    await clickButton(legacyPage, '选择同步旧目标');
    assert.equal(await legacyPage.$eval('[role=dialog] input[type=checkbox]', (el) => el.checked), false, 'no automatic legacy upload selection');
    await clickControl(legacyPage, '[role=dialog] input[type=checkbox]');
    const uploaded = legacyPage.waitForResponse((response) => response.url().endsWith('/api/sync/push') && response.request().method() === 'POST' && JSON.parse(response.request().postData() || '{}').goals?.some((goal) => goal.id === 'synthetic-browser-legacy-goal'));
    await clickButton(legacyPage, '确认上传 1 个目标', '[role=dialog]'); await modalClosed(legacyPage);
    const upload = await uploaded;
    assert.equal(upload.status(), 200);
    assert.equal(upload.request().postData().includes('SYNTHETIC_UNSELECTED_BROWSER_FIELD'), false, 'unpreviewed arbitrary legacy field never leaves the browser');
    await expectText(legacyPage, '已同步', true, 'main article span');
    // Synthetic change to the retained goals source table in the new generation.
    // Actual old-JS writes to the old physical DB are covered separately.
    await legacyPage.evaluate(async (owner) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result, transaction = database.transaction('goals', 'readwrite'), source = transaction.objectStore('goals');
          const read = source.get('synthetic-browser-legacy-goal');
          read.onsuccess = () => source.put({ ...read.result, progress: 75 });
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => { database.close(); reject(transaction.error); };
        };
      });
    }, ownerId);
    await reloadPage(legacyPage);
    await expectText(legacyPage, '0/1 完成 · 平均进度 25%');
    await clickButton(legacyPage, '比较旧目标来源：Synthetic 旧窗口目标', 'body', true);
    await legacyPage.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent.includes('75%') && document.querySelector('[role=dialog]')?.textContent.includes('25%'));
    await clickButton(legacyPage, '生成本机副本', '[role=dialog]'); await modalClosed(legacyPage);
    await expectText(legacyPage, '0/2 完成 · 平均进度 50%');
    await expectText(legacyPage, '仅本机', true, 'main article span');
    // True old-window write targets the retained pre-cutover physical DB. It must
    // not update the current-generation goal or upload itself through this app.
    await legacyPage.evaluate(owner => new Promise((resolve, reject) => {
      const opening = indexedDB.open(`youtrace:user:${owner}`);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result, tx = database.transaction('goals', 'readwrite'), table = tx.objectStore('goals'), read = table.get('synthetic-browser-legacy-goal');
        read.onsuccess = () => table.put({ ...read.result, title: 'Synthetic old window late change', progress: 88 });
        tx.oncomplete = () => { database.close(); resolve(); }; tx.onerror = () => { database.close(); reject(tx.error); };
      };
    }), ownerId);
    await reloadPage(legacyPage); await expectText(legacyPage, '0/2 完成 · 平均进度 50%'); await expectText(legacyPage, 'Synthetic old window late change', false);
    await route(legacyPage, '/settings'); await clickButton(legacyPage, '检查旧窗口修改'); await legacyPage.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(el => /^发现 \d+ 类旧版资料与升级时不同，可能包含尚未转入的修改$/.test(el.textContent.trim())));
    await legacyPage.screenshot({ path: join(artifactDir, 'generation-late-source-disclosure.png'), fullPage: false });
    const downloadPath = join(artifactDir, 'generation-export'); await mkdir(downloadPath, { recursive: true }); await legacyPage.browserContext().setDownloadBehavior({ policy: 'allow', downloadPath });
    await clickButton(legacyPage, '导出升级前保留资料');
    let exported;
    for (let attempt = 0; attempt < 40; attempt++) { const file = (await readdir(downloadPath)).find(name => name.endsWith('.json')); if (file) { try { exported = JSON.parse(await readFile(join(downloadPath, file), 'utf8')); break; } catch { /* wait for completed write */ } } await delay(100); }
    assert.equal(exported?.format, 'youtrace-account-generation-recovery'); assert.equal(exported.ownerId, ownerId); assert.equal(exported.status.changedTables.includes('goals'), true);
    assert.equal(JSON.stringify(exported.baseline).includes('Synthetic old window late change'), false); assert.equal(JSON.stringify(exported.source).includes('Synthetic old window late change'), true);
    step('Retained old source: visible late-change notice and actual downloaded baseline/source JSON preserve separate originals', { file: 'generation-export/', currentGoalStill25: true });

    await route(page, '/goal');
    await expectText(page, '0/1 完成 · 平均进度 25%');
    await legacyContext.close();
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
  await observeInitialization(page);
  await page.setViewport({ width: 1280, height: 900 });
  await login(page, '13900009901', 'Synthetic A'); step('Real OTP-cookie registration and onboarding');
  await exerciseUserAI(page, { route, clickControl, clickButton, fillControl, artifactDir }); step('User-owned AI add/delete, per-page opt-in reset, and zero provider requests');
  step('Paint-stable workspace geometry and computed margin clear actual fixed navigation');
  await addTodo(page, 'Synthetic A private todo');
  // A success notification must not steal the user's next create click.
  await page.waitForFunction(() => document.querySelector('[aria-label="通知"]')?.textContent.includes('待办已保存'));
  const nextTarget = await page.waitForSelector('[aria-label="新建待办"]');
  assert.equal(await nextTarget.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'success toast must not intercept next new-Todo action');
  await page.screenshot({ path: join(artifactDir, 'todo-save-next-create-hit.png') }); await nextTarget.dispose();
  await clickControl(page, '[aria-label="新建待办"]'); await page.waitForFunction(() => { const input = document.querySelector('[role=dialog] input'); return input && !input.matches(':disabled'); }); await page.type('[role=dialog] input', 'Retained modal draft');
  const focused = await page.evaluate(() => document.activeElement?.tagName); assert.equal(focused, 'INPUT');
  await page.keyboard.press('Escape'); await page.waitForSelector('[role=dialog]', { hidden: true });
  await clickControl(page, '[aria-label="新建待办"]'); await page.waitForFunction(() => { const input = document.querySelector('[role=dialog] input'); return input && !input.matches(':disabled') && input.value === 'Retained modal draft'; }); assert.equal(await page.$eval('[role=dialog] input', (el) => el.value), 'Retained modal draft');
  await page.keyboard.press('Escape'); await page.waitForSelector('[role=dialog]', { hidden: true }); step('Modal typing keeps focus; Escape/back/reopen retains unsaved input');
  await clickControl(page, 'input[aria-label="完成 Synthetic A private todo"]');
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
  await clickText(page, '确认保存所选记录'); await page.waitForFunction(() => location.search.includes('receipt=')); await clickText(page, '回到首页'); await page.waitForFunction(() => location.pathname === '/'); step('Capture review survives refresh and confirms transactionally');
  const paths = ['/', '/schedule', '/quick-note', '/expense', '/todo', '/habit', '/diary', '/coach', '/insights', '/settings', '/goal', '/timeline', '/more'];
  for (const width of [360, 768, 1280]) {
    await page.setViewport({ width, height: 900 });
    for (const path of paths) {
      await route(page, path);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, `${path} overflow at ${width}`);
      assert.equal(await page.evaluate(() => document.body.textContent.includes('页面出了点问题')), false, path);
      await delay(1000); // Existing greeting reveal is 900ms; capture its settled content.
      if (path === '/timeline') {
        const geometry = await page.evaluate(sampleTimelineHeading);
        const failures = timelineHeadingFailures(geometry);
        report.push({ name: `Timeline capture heading remains one line at ${width}px`, passed: failures.length === 0, detail: geometry, failures });
        assert.deepEqual(failures, [], `Timeline heading at ${width}px: ${failures.join('; ')}`);
      }
      await page.screenshot({ path: join(artifactDir, `youtrace-${width}-${path.replaceAll('/', '-') || 'home'}.png`), fullPage: true });
    }
    await page.screenshot({ path: join(artifactDir, `youtrace-${width}.png`), fullPage: true });
  }
  step('Responsive appearance of 13 listed routes at 360/768/1280; capture result covered separately');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await route(page, '/todo'); step('Reduced-motion preference route smoke');
  await route(page, '/settings'); await clickText(page, '退出登录'); await page.waitForSelector('#login-phone');
  boundary(page, 'account-b-login-start', '/login');
  await login(page, '13900009902', 'Synthetic B'); boundary(page, 'account-b-login-root-ready', '/');
  await route(page, '/todo'); boundary(page, 'account-b-todo-ready', '/todo');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('Synthetic A private todo')), false); step('B cannot see A records after real sign-out/sign-in');
  await route(page, '/settings'); await clickText(page, '退出登录'); await page.waitForSelector('#login-phone');
  await login(page, '13900009901', 'Synthetic A'); await route(page, '/todo');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('Synthetic A private todo')), true); step('A recovers its data after A/B/A switch');
  const secondTab = await context.newPage(); await observeInitialization(secondTab); await route(secondTab, '/todo');
  await route(page, '/settings'); await clickText(page, '退出登录'); await page.waitForSelector('#login-phone'); await secondTab.bringToFront(); await secondTab.waitForSelector('#login-phone'); step('Cross-tab sign-out locks old account view');
  await login(page, '13900009903', 'Synthetic C'); await route(secondTab, '/todo');
  await route(page, '/settings'); await clickText(page, '注销账号（删除全部云端数据）'); await clickText(page, '永久注销');
  await page.waitForSelector('#login-phone'); await secondTab.bringToFront(); await secondTab.waitForSelector('#login-phone'); step('Cross-tab account deletion locks stale private views');
  assert.deepEqual(errors, []); step('No uncaught page errors');
  await context.close();
} catch (error) {
  // Freeze the first failure before screenshot/body reads. No retry, reload or
  // extended assertion deadline is introduced by diagnostic collection.
  await writeFile(join(artifactDir, 'first-failure-initialization.json'), JSON.stringify(firstFailureTrace(error), null, 2))
    .catch(writeError => console.error('Initialization trace write failed:', safeExceptionName(writeError)));
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
