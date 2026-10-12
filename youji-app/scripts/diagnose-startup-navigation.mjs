// Bounded hosted-only diagnostic. A no-reproduction result is never acceptance.
// No app repair, artificial IDB holds, storage clearing or retry after failure.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { sampleStableWorkspace, workspaceLayoutFailures } from './workspace-layout-contract.mjs';
import { installStorageProgress, projectStorageProgress, storageProgressSchema } from './audit-storage-progress.mjs';
import { readExistingAccount, initialSessionChecks } from './audit-initial-session-outcomes.mjs';
import { decodeAccountFact } from './audit-shared-goal-hashes.mjs';
import { waitSharedGoalTargetSettled } from './audit-shared-goal-recovery.mjs';

export const navigationCases = Object.freeze([
  { name: 'full-observed', navigation: 'full', storageObserver: true },
  { name: 'full-unobserved', navigation: 'full', storageObserver: false },
  { name: 'spa-observed', navigation: 'spa', storageObserver: true },
  { name: 'spa-unobserved', navigation: 'spa', storageObserver: false },
].map(row => Object.freeze({ ...row, width: 1280, height: 900, reducedMotion: 'reduce', attempts: 1 })));
export const diagnosticBaseline = 'fcec29d6437fe556150ef657097cb61eb717d564';
const phases = ['initial', 'recovery', 'data-updated'];
const stages = ['initialization', 'settings', 'sync', 'sync-offline', 'stores', 'expense', 'todo', 'habit', 'quick-note', 'schedule', 'diary', 'coach', 'goal'];
const outcomes = ['start', 'success', 'error', 'timeout', 'cancel'];
const flags = ['authChecked', 'isAuthenticated', 'identityUnavailable', 'signedOut', 'boundOwner', 'verifiedOwner', 'ownersMatch', 'generationChanged', 'revisionChanged', 'dbOpen', 'dbBlocked', 'recoveryErrorPresent', 'ambientTransactionPresent', 'ambientTransactionActive'];
const errorNames = ['Error', 'AssertionError', 'TimeoutError', 'ProtocolError', 'TargetCloseError', 'StartupObservationError', 'TypeError', 'RangeError'];
const safeErrorName = error => errorNames.includes(error?.name) ? error.name : 'unknown';
export function diagnosticEndpoint(url) {
  const endpoints = { '/api/auth/me': 'auth-me', '/api/auth/send-code': 'auth-send-code', '/api/auth/verify': 'auth-verify', '/api/auth/register': 'auth-register', '/api/auth/logout': 'auth-logout', '/api/sync/push': 'sync-push', '/api/sync/pull': 'sync-pull', '/api/sync/bootstrap': 'sync-bootstrap', '/api/user/settings': 'settings' };
  try { const path = new URL(url).pathname; return Object.hasOwn(endpoints, path) ? endpoints[path] : path.startsWith('/api/') ? 'other-api' : null; } catch { return null; }
}
const finite = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
export function projectNavigationEvent(input) {
  try {
    if (!input || !finite(input.timeOrigin)) return null;
    const timeOrigin = input.timeOrigin;
    if (input.kind === 'storage-progress') { const event = projectStorageProgress(input.event); return event && event.timeOrigin === timeOrigin ? { kind: input.kind, timeOrigin, event } : null; }
    if (input.kind === 'application') {
      const e = input.event, safe = {};
      if (!e || !phases.includes(e.phase) || !stages.includes(e.stage) || !outcomes.includes(e.outcome)) return null;
      for (const k of ['attempt', 'sequence', 'elapsedMs']) { if (!Number.isSafeInteger(e[k]) || e[k] < 0 || e[k] > 1_000_000_000) return null; safe[k] = e[k]; }
      for (const k of ['phase', 'stage', 'outcome']) safe[k] = e[k];
      for (const k of flags) if (typeof e[k] === 'boolean') safe[k] = e[k];
      return { kind: 'application', timeOrigin, event: safe };
    }
    if (input.kind === 'lifecycle' && ['document-start', 'pagehide', 'pageshow', 'freeze', 'resume', 'visibilitychange'].includes(input.event) && finite(input.elapsedMs)) {
      const value = { kind: 'lifecycle', timeOrigin, event: input.event, elapsedMs: input.elapsedMs };
      for (const k of ['persisted', 'trusted', 'wasDiscarded']) if (typeof input[k] === 'boolean') value[k] = input[k];
      if (['visible', 'hidden'].includes(input.visibility)) value.visibility = input.visibility;
      if (['/', '/todo', '/settings', '/login', '/onboarding', '/data-info'].includes(input.path)) value.path = input.path;
      return value;
    }
  } catch { /* An observation cannot affect native behavior. */ }
  return null;
}
export function createNavigationLedger(limit = 20000, onEvent = () => undefined) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 50000);
  const events = [], transactions = new Map(), started = performance.now(); let dropped = 0, transactionDropped = 0;
  return {
    record(value) {
      const row = projectNavigationEvent(value); if (!row) return;
      events.push({ ...row, receivedElapsedMs: Math.round(performance.now() - started) });
      try { onEvent(row); } catch { /* Metadata subscribers cannot affect the native observer. */ }
      if (events.length > limit) { events.shift(); dropped++; }
      const e = row.event;
      if (row.kind !== 'storage-progress' || !e.transaction) return;
      const key = `${row.timeOrigin}:${e.database}:${e.transaction}`;
      if (!transactions.has(key)) {
        if (transactions.size >= limit) { transactionDropped++; return; }
        transactions.set(key, { timeOrigin: row.timeOrigin, database: e.database, transaction: e.transaction, stores: e.stores, mode: e.mode, firstObserved: e.documentElapsedMs, startObserved: false, lastRequest: null, terminal: null });
      }
      const tx = transactions.get(key);
      if (e.outcome === 'transaction-start') tx.startObserved = true;
      if (e.outcome.startsWith('request-')) tx.lastRequest = { outcome: e.outcome, request: e.request, method: e.method, store: e.store, documentElapsedMs: e.documentElapsedMs };
      if (['transaction-complete', 'transaction-abort'].includes(e.outcome)) tx.terminal = { outcome: e.outcome, documentElapsedMs: e.documentElapsedMs };
    },
    snapshot() { return structuredClone({ version: 1, limit, dropped, transactionDropped, events, transactions: [...transactions.values()], interpretation: 'No observed terminal does not prove an active lock. Numeric database/transaction IDs are scoped by document timeOrigin. Navigation can drop tail delivery.' }); },
  };
}
// No native object retained and no await in an IDB callback. Both arms keep the
// same low-volume application/lifecycle listener; only one installs IDB wrappers.
export async function installNavigationObserver(page, ledger, storageObserver) {
  await page.exposeFunction('__youtraceInitializationDiagnostic', value => ledger.record(value));
  await page.evaluateOnNewDocument((storage, schemaPhases, schemaStages, schemaOutcomes, schemaFlags) => {
    const transport = window.__youtraceInitializationDiagnostic;
    const send = value => { try { void transport({ ...value, timeOrigin: performance.timeOrigin }).catch(() => undefined); } catch { /* Metadata only. */ } };
    // Existing storage probe calls this binding. Wrap its envelope locally so
    // source-document identity does not depend on delivery after navigation.
    window.__youtraceInitializationDiagnostic = value => transport({ ...value, timeOrigin: performance.timeOrigin });
    window.addEventListener('youtrace:initialization-diagnostic', event => {
      try {
        const e = event.detail, safe = {};
        if (!e || !schemaPhases.includes(e.phase) || !schemaStages.includes(e.stage) || !schemaOutcomes.includes(e.outcome)) return;
        for (const k of ['attempt', 'sequence', 'elapsedMs']) { if (!Number.isSafeInteger(e[k]) || e[k] < 0 || e[k] > 1_000_000_000) return; safe[k] = e[k]; }
        for (const k of ['phase', 'stage', 'outcome']) safe[k] = e[k];
        for (const k of schemaFlags) if (typeof e[k] === 'boolean') safe[k] = e[k];
        send({ kind: 'application', event: safe });
      } catch { /* No private fields cross the binding. */ }
    });
    const lifecycle = (name, event) => send({ kind: 'lifecycle', event: name, elapsedMs: performance.now(), path: ['/', '/todo', '/settings', '/login', '/onboarding', '/data-info'].includes(location.pathname) ? location.pathname : 'unknown', visibility: document.visibilityState, wasDiscarded: document.wasDiscarded, ...(event ? { trusted: event.isTrusted, ...('persisted' in event ? { persisted: event.persisted } : {}) } : {}) });
    lifecycle('document-start');
    for (const name of ['pagehide', 'pageshow']) window.addEventListener(name, event => lifecycle(name, event));
    for (const name of ['freeze', 'resume', 'visibilitychange']) document.addEventListener(name, event => lifecycle(name, event));
    window.__startupNavigationStorageObserved = storage;
  }, storageObserver, phases, stages, outcomes, flags);
  if (storageObserver) await page.evaluateOnNewDocument(installStorageProgress, storageProgressSchema);
}
// Once armed immediately before existing-A login, a real initialization failure
// cannot be erased by a later successful recovery. Old document tails are excluded.
export function createNavigationFailureLatch(originFloor, onFailure = () => undefined) {
  let failure = null, finished = false, resolveFailure;
  const promise = new Promise(resolve => { resolveFailure = resolve; });
  const assertActive = () => { if (failure) { const error = new Error('Measured initialization failed; later success cannot replace the first failure'); error.name = 'StartupObservationError'; throw error; } };
  return {
    promise,
    observe(row) {
      if (finished || failure || row.kind !== 'application' || row.timeOrigin <= originFloor || row.event.stage !== 'initialization' || !['initial', 'recovery'].includes(row.event.phase) || !['timeout', 'error'].includes(row.event.outcome)) return;
      failure = structuredClone(row); resolveFailure(failure); onFailure(failure);
    },
    assertActive,
    finish() { assertActive(); finished = true; },
    get failure() { return failure; },
  };
}
export async function measureNavigation(latch, task) {
  await Promise.race([task(latch.assertActive), latch.promise.then(() => latch.assertActive())]);
  latch.finish();
}
export function targetTodo(snapshot, id) {
  const table = snapshot.tables.find(row => row.name === 'todos'); assert.ok(table);
  const rows = decodeAccountFact(table.losslessRows); const matches = rows.filter(row => row.id === id); assert.equal(matches.length, 1); return matches[0];
}
export function assertNavigationData(before, after, id, ledgerBefore, ledgerAfter) {
  assert.ok(initialSessionChecks.retained(before, after), 'Account schema, complete Todo/outbox tables and Todo version/conflict receipts must remain identical');
  assert.deepEqual(targetTodo(after, id), targetTodo(before, id));
  const queues = value => decodeAccountFact(value.tables.find(row => row.name === 'outbox').losslessRows);
  assert.deepEqual(queues(after), queues(before)); assert.deepEqual(ledgerAfter, ledgerBefore);
}
export function classifyNavigationFailure(phase, visible, errorName) {
  if ((phase === 'existing-a-navigation' && (visible?.text?.includes('加载遇到问题') || errorName === 'StartupObservationError')) || (phase === 'post-observation-data-read' && errorName === 'AssertionError')) return 'observed-failure';
  return 'infra-blocked'; // Setup, driver, capture, or unreadable source is inconclusive.
}
export async function runNavigationDiagnostic() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted CI only; local browser restrictions must not be bypassed');
  const root = resolve(import.meta.dirname, '..');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const productionPaths = ['src', 'server/src', 'server/prisma', 'public', 'package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json'];
  assert.equal(git(['diff', diagnosticBaseline, '--', ...productionPaths]), '', 'Diagnostic cannot alter the observed product or dependencies');
  assert.equal(git(['ls-files', '--others', '--exclude-standard', '--', ...productionPaths]), '', 'No untracked product source');
  const identity = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), baseline: diagnosticBaseline };
  const artifacts = join(root, 'test-artifacts/startup-navigation-diagnostic'); await mkdir(artifacts, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), 'youtrace-startup-diagnostic-'));
  const port = 3343, frontPort = 5293, origin = `http://127.0.0.1:${frontPort}`;
  const env = { ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_URL: `file:${join(scratch, 'synthetic.db')}`, JWT_SECRET: randomBytes(48).toString('hex'), ALLOWED_ORIGINS: origin, DEV_OTP_EXPOSE: 'true', SMS_PROVIDER_URL: '', SMS_PROVIDER_TOKEN: '', LLM_API_KEY: '', SERVER_AI_ENABLED: 'false', VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${port}` };
  const children = [], results = navigationCases.map(arm => ({ ...arm, status: 'infra-blocked', phase: 'not-started', diagnosticOnly: true })); let browser;
  let complete = false;
  const save = (path, value) => writeFile(join(artifacts, path), JSON.stringify(value, null, 2));
  const saveReport = () => save('report.json', { version: 1, ...identity, diagnosticOnly: true, complete, cases: results, applicationInitializationDeadlineMs: 12000, attemptsPerArm: 1, productionSourceModified: false, syntheticScratchRetained: true, limitations: ['No-reproduction is not a fix or formal acceptance', 'Observer on/off differs in timing; enabled-only failure is not causal proof', 'Missing terminal/lifecycle events do not prove locks or bfcache', 'No B account in this smallest A/logout/A comparison', 'Complete Todo/outbox, schema, Todo version/conflict receipts and sync ledger equivalence are asserted; other settings are retained in full snapshots but are not asserted unchanged', 'Incomplete or unstarted arms are infrastructure-blocked, never counted as no-reproduction'] });
  await saveReport();
  const startup = (args, cwd) => { const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'ignore', 'ignore'] }); children.push(child); return child; };
  const ready = async url => { const end = Date.now() + 30000; while (Date.now() < end) { try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* startup only */ } await new Promise(resolve => setTimeout(resolve, 200)); } throw Error('Synthetic service startup failed'); };
  try {
    const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: join(root, 'server'), env, encoding: 'utf8', timeout: 30000 }); assert.equal(migration.status, 0, 'Synthetic target migration must succeed');
    startup(['dist/index.js'], join(root, 'server')); startup(['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(frontPort), '--strictPort'], root);
    await ready(`http://127.0.0.1:${port}/health`); await ready(origin);
    assert.ok(process.env.AUDIT_BROWSER_PATH, 'Use the existing hosted Chrome prerequisite');
    browser = await puppeteer.launch({ executablePath: process.env.AUDIT_BROWSER_PATH, headless: true, protocolTimeout: 30000, args: ['--no-sandbox'] });
    for (const [index, arm] of navigationCases.entries()) {
      results[index] = { ...arm, status: 'infra-blocked', phase: 'preparation', diagnosticOnly: true }; await saveReport();
      let measurement, firstFaultSave;
      const context = await browser.createBrowserContext(), page = await context.newPage(), ledger = createNavigationLedger(20000, row => measurement?.observe(row)), network = [], actions = [];
      const assertMeasuredActive = () => measurement?.assertActive();
      const directory = join(artifacts, arm.name); await mkdir(directory); let recorder, phase = 'preparation', before, remoteBefore, owner, id;
      const snapshot = () => page.evaluate(readExistingAccount, owner);
      const capture = async name => { await page.screenshot({ path: join(directory, `${name}.png`) }); const state = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, path: location.pathname, text: document.body.innerText, activeTag: document.activeElement?.tagName, visibility: document.visibilityState })); await writeFile(join(directory, `${name}.json`), JSON.stringify(state, null, 2)); return state; };
      const api = async path => { assert.ok(['/auth/me', '/sync/pull?protocol=2&features=goals-v1&cursor=0&limit=500'].includes(path)); const response = await page.evaluate(async path => { const r = await fetch('/api' + path, { method: 'GET', signal: AbortSignal.timeout(5000) }); return { status: r.status, body: await r.json() }; }, path); assert.equal(response.status, 200); return response.body; };
      const click = async (selector, text) => {
        assertMeasuredActive();
        const found = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(el => !el.disabled && (text === undefined || el.textContent.trim() === text)), { timeout: 10000 }, selector, text);
        assertMeasuredActive(); const el = found.asElement(); assert.ok(el);
        try { await el.scrollIntoView(); await el.evaluate(waitSharedGoalTargetSettled); assert.ok(await el.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Original control is obscured'); assertMeasuredActive(); actions.push({ phase, kind: 'native-click', selector, text }); await el.click(); } finally { await found.dispose(); }
      };
      const route = async path => { assertMeasuredActive(); actions.push({ phase, kind: 'full-navigation', path }); await page.bringToFront(); assertMeasuredActive(); await page.goto(origin + path, { waitUntil: 'networkidle0' }); await page.waitForSelector('h1,h2'); assert.equal(new URL(page.url()).pathname, path); };
      const login = async () => {
        assertMeasuredActive(); await page.goto(origin + '/login', { waitUntil: 'networkidle0' }); await page.waitForSelector('#login-phone'); assertMeasuredActive(); await page.type('#login-phone', `139000086${index}1`);
        const sent = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/send-code' && r.request().method() === 'POST'); await click('button', '获取验证码'); const response = await sent; assert.equal(response.status(), 200); const otp = await response.json(); assert.match(otp.devCode, /^\d{6}$/);
        await page.waitForSelector('#login-code'); assertMeasuredActive(); await page.type('#login-code', otp.devCode);
        const verified = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/verify' && r.request().method() === 'POST'); await click('button', '验证'); assert.equal((await verified).status(), 200);
        await page.waitForFunction(() => Boolean(document.querySelector('#login-nickname')) || location.pathname !== '/login');
        if (await page.$('#login-nickname')) { const nickname = `Synthetic nav ${index}`; assert.ok(await page.$eval('#login-nickname', (el, value) => el.maxLength >= value.length, nickname)); assertMeasuredActive(); await page.type('#login-nickname', nickname); assert.equal(await page.$eval('#login-nickname', el => el.value), nickname); await click('button', '开始使用'); }
        await page.waitForFunction(() => location.pathname !== '/login', { timeout: 20000 }); await page.waitForSelector('h1,h2', { timeout: 20000 });
        if (new URL(page.url()).pathname === '/onboarding') await click('button', '跳过');
        const handle = await page.waitForFunction(sampleStableWorkspace, { timeout: 20000, polling: 'raf' }); const geometry = await handle.jsonValue(); await handle.dispose(); assert.deepEqual(workspaceLayoutFailures(geometry), []);
        assertMeasuredActive(); actions.push({ phase, kind: 'stable-home-ready', geometry });
      };
      try {
        await page.setViewport({ width: arm.width, height: arm.height }); await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: arm.reducedMotion }]); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(30000);
        await installNavigationObserver(page, ledger, arm.storageObserver);
        const requests = new WeakMap(); let nextRequest = 0, networkDropped = 0;
        const networkEvent = (request, outcome, status) => { const saved = requests.get(request); if (!saved) return; if (network.length >= 5000) { networkDropped++; return; } network.push({ ...saved, outcome, receivedElapsedMs: Math.round(performance.now()), ...(status === undefined ? {} : { status }) }); };
        page.on('request', request => { const endpoint = diagnosticEndpoint(request.url()); if (!endpoint) return; requests.set(request, { request: ++nextRequest, phase, endpoint, method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) ? request.method() : 'other' }); networkEvent(request, 'start'); });
        page.on('response', response => networkEvent(response.request(), 'response', response.status()));
        page.on('requestfinished', request => networkEvent(request, 'finished'));
        page.on('requestfailed', request => networkEvent(request, 'failed'));
        // The scalar drop count is retained without leaking request objects.
        Object.defineProperty(network, 'dropped', { get: () => networkDropped });
        await page.tracing.start({ path: join(directory, 'trace.json'), screenshots: true }); recorder = await page.screencast({ path: join(directory, 'native.webm'), fps: 12, quality: 35 });
        await login(); owner = (await api('/auth/me')).user.id;
        await click('aside nav button', '待办'); await page.waitForSelector('h1'); assert.equal(new URL(page.url()).pathname, '/todo');
        await click('button[aria-label="新建待办"]'); await page.waitForSelector('[role=dialog] #todo-text'); await page.type('[role=dialog] #todo-text', `Synthetic retained navigation ${index}`); await click('[role=dialog] button', '无日期'); await click('[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
        const until = Date.now() + 10000;
        do { before = await snapshot(); const todos = decodeAccountFact(before.tables.find(t => t.name === 'todos').losslessRows), queue = decodeAccountFact(before.tables.find(t => t.name === 'outbox').losslessRows); if (todos.length === 1 && queue.length === 0) { id = todos[0].id; break; } await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < until);
        assert.ok(id, 'Preparation needs real saved and ACKed Todo'); remoteBefore = await api('/sync/pull?protocol=2&features=goals-v1&cursor=0&limit=500'); assert.equal(remoteBefore.hasMore, false); assert.ok(initialSessionChecks.acknowledged({ local: before, events: remoteBefore.events, owner }, `Synthetic retained navigation ${index}`), 'UI Todo must match the real server ACK and version receipt');
        await writeFile(join(directory, 'before.json'), JSON.stringify({ syntheticOnly: true, owner, id, account: before, remote: remoteBefore }, null, 2));
        await click('aside nav button', '设置'); await page.waitForSelector('h1'); await click('button', '退出登录'); await page.waitForSelector('#login-phone');
        // Measurement starts before existing-A login. No added wait, snapshot,
        // idle gate or artificial transaction between stable Home and navigation.
        results[index].phase = 'existing-a-navigation'; await saveReport();
        phase = 'existing-a-navigation';
        const originFloor = Math.max(0, ...ledger.snapshot().events.map(row => row.timeOrigin));
        measurement = createNavigationFailureLatch(originFloor, failure => {
          // Synchronously latch, then preserve before UI capture or any further
          // storage read. Guards stop pending UI continuations after the race.
          firstFaultSave = writeFile(join(directory, 'first-initialization-failure.json'), JSON.stringify({ phase, failure, observer: ledger.snapshot(), network, networkDropped: network.dropped ?? 0, actions }, null, 2), { flag: 'wx' });
          void firstFaultSave.catch(() => undefined);
        });
        await measureNavigation(measurement, async assertActive => {
          await login(); assertActive();
          if (arm.navigation === 'full') await route('/todo');
          else { await click('aside nav button', '待办'); await page.waitForSelector('h1,h2'); assert.equal(new URL(page.url()).pathname, '/todo'); }
          assertActive(); await page.waitForFunction(text => document.body.innerText.includes(text), {}, `Synthetic retained navigation ${index}`); assertActive();
        });
        await capture('not-reproduced'); phase = 'post-observation-data-read'; const after = await snapshot(), remoteAfter = await api('/sync/pull?protocol=2&features=goals-v1&cursor=0&limit=500');
        assertNavigationData(before, after, id, remoteBefore, remoteAfter);
        await writeFile(join(directory, 'after.json'), JSON.stringify({ syntheticOnly: true, account: after, remote: remoteAfter, todosOutboxSchemaVersionsAndSyncLedgerEqual: true, allSettingsUnchangedClaimed: false }, null, 2));
        results[index] = { ...arm, status: 'not-reproduced', diagnosticOnly: true };
      } catch (error) {
        // Freeze before any additional storage read. No Retry, reload or second
        // navigation is attempted after the first failure in this independent arm.
        if (firstFaultSave) await firstFaultSave;
        await writeFile(join(directory, 'first-failure.json'), JSON.stringify({ phase, name: safeErrorName(error), observer: ledger.snapshot(), network, networkDropped: network.dropped ?? 0, actions }, null, 2), { flag: 'wx' });
        const visible = await capture('first-failure-visible').catch(() => null);
        const status = classifyNavigationFailure(phase, visible, safeErrorName(error));
        results[index] = { ...arm, status, phase, errorName: safeErrorName(error), diagnosticOnly: true };
        process.exitCode = 1;
      } finally {
        await saveReport();
        await writeFile(join(directory, 'observation.json'), JSON.stringify({ syntheticOnly: true, arm, observer: ledger.snapshot(), network, networkDropped: network.dropped ?? 0, actions }, null, 2));
        try { if (recorder) await recorder.stop(); } finally { try { await page.tracing.stop(); } finally { await context.close(); } }
      }
    }
    complete = true;
  } finally {
    await saveReport();
    if (browser) await browser.close(); for (const child of children) child.kill('SIGTERM');
    // Keep the isolated synthetic DB for review; never delete/reset a source to
    // obtain a pass. CI owns temporary environment cleanup after artifact capture.

  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runNavigationDiagnostic();
