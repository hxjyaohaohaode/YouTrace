// First product-outcome package: actual rendered controls, native pointer/keyboard, real
// HTTP/Cookie/IndexedDB. A red outcome is preserved, not hidden by a test rewrite.
// All accounts/content are generated synthetic fixtures in a disposable database.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, access, stat, readFile, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { runCoachOutcomes } from './audit-coach-outcomes.mjs';
import { runPlanningOutcomes } from './audit-planning-outcomes.mjs';
import { runHabitOutcomes } from './audit-habit-outcomes.mjs';
import { runGoalOutcomes } from './audit-goal-outcomes.mjs';
import { runLegacyGoalOutcomes, waitForStableModalTarget } from './audit-legacy-goal-outcomes.mjs';
import { runInitialSessionOutcomes } from './audit-initial-session-outcomes.mjs';
import { runStartupRecoveryOutcomes } from './audit-startup-recovery-outcomes.mjs';
import { runPreferenceOutcomes } from './audit-preference-outcomes.mjs';
import { runExpenseOutcomes } from './audit-expense-outcomes.mjs';
import { runDiaryOutcomes } from './audit-diary-outcomes.mjs';
import { preferenceEvidenceErrorName } from './audit-preference-contract.mjs';
import { createHabitAuditClock } from './audit-clock.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('This diagnostic is hosted-CI only; do not retry a locally restricted browser or listener.');

const taskSet = process.env.AUDIT_TASK_SET ?? 'records';
assert.ok(['records', 'coach', 'planning', 'habits', 'habits-frequency', 'goals', 'legacy-goals-enrollment', 'legacy-goals-source', 'initial-session', 'startup-recovery', 'preferences-normal', 'preferences-write', 'preferences-read', 'preferences-conflict', 'expense-records', 'expense-budget', 'diary-records', 'diary-recovery'].includes(taskSet), 'Unknown bounded outcome task set');
const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'youtrace-outcomes-'));
const habitClock = taskSet.startsWith('habits') ? createHabitAuditClock() : null;
const expenseClock = taskSet.startsWith('expense-') ? createHabitAuditClock() : null;
const diaryClock = taskSet.startsWith('diary-') ? createHabitAuditClock() : null;
const artifacts = join(root, 'test-artifacts', 'user-outcomes');
await mkdir(artifacts, { recursive: true });
const redEvidenceCommit = '2c5e7ba365e2b06e1eeb9102cbcf4ab9c6c08b17';
const apiPort = 3339, frontPort = 5289, origin = `http://127.0.0.1:${frontPort}`;
const environment = { ...process.env, NODE_ENV: 'test', PORT: String(apiPort), DATABASE_URL: `file:${join(scratch, 'synthetic.db')}`, JWT_SECRET: randomBytes(48).toString('hex'), ALLOWED_ORIGINS: origin, DEV_OTP_EXPOSE: 'true', SMS_PROVIDER_URL: '', SMS_PROVIDER_TOKEN: '', LLM_API_KEY: '', VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${apiPort}` };
const results = [], actions = [], traffic = [], infrastructure = [], children = [];
const surfaceNames = new WeakMap();
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
const metadata = { kind: taskSet === 'planning' ? 'planning-user-outcome-implementation-candidate' : taskSet === 'coach' ? 'coach-user-outcome-implementation-candidate' : 'first-package-scripted-outcomes-await-independent-review', taskSet, scenarioScope: taskSet === 'planning' ? ['native date/time creation and exact day/week/month retrieval', 'recurrence occurrence scope without silently modifying a series', 'canceled and conflicting edits, failed deletion recovery'] : taskSet === 'coach' ? ['zero-data insight reading', 'sparse historical first coach and real input', 'current-record evidence, explicit device choice, exact source correction and optional capture'] : ['capture/correction/history/navigation/receipt-read outage'], planningRedEvidenceCommit: 'fccbb230435b92333a27ecac19e0badac882d067', applicationBaseline: taskSet === 'planning' ? '0c31503695a9dc2d99dadd29aaa7a1b6914909c0' : '4d37ce98faebeb5bdf6053d2e7cda59af4a6ec7c', coachRedEvidenceCommit: 'e020d01d3e2d8fc07673e4d6ad65cb6f03f395d3', redEvidenceCommit, commit: process.env.GITHUB_SHA || git('rev-parse', 'HEAD'), contentTree: git('rev-parse', 'HEAD^{tree}'), syntheticOnly: true, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, sourceStart: await sourceSnapshot(), buildFiles: [...await buildSnapshot(join(root, 'dist'), 'frontend/'), ...await buildSnapshot(join(root, 'server/dist'), 'server/')], interactions: 'native pointer and keyboard; DOM reads only; one initial login URL per isolated account; historical API setup explicitly separated', startedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', untested: ['Fresh cross-midnight browser clock transition', 'Fresh two-tab concurrent confirmation', 'Fresh first-package A/B/A account sequence', 'All multi-tab behavior beyond the bounded receipt-reread and schedule-stale-form cases', 'Live SMS/model quality', 'Voice permission and real recognition', 'Full per-component accessibility/reduced-motion/zoom', 'Full Y3 including live conversation, reminder consent and cross-device feedback; remaining Y4–Y9 scenarios', 'Manual human-operated review'] };
if (taskSet.startsWith('habits')) {
  metadata.kind = taskSet === 'habits-frequency' ? 'immediate-current-frequency-user-outcome-candidate' : 'existing-habit-user-outcome-candidate';
  metadata.unsupported = ['Scheduled future-effective frequency and full historical target-rule reconstruction; archived failing diagnostic remains runnable'];
  metadata.unsupportedDiagnosticEnabled = process.env.AUDIT_INCLUDE_UNSUPPORTED_HABIT_HISTORY === 'true';
  metadata.controlledClock = habitClock;
  metadata.applicationBaseline = '11a233d4040690b42e64860c7e4d8dafb966c1f9';
  metadata.scenarioScope = ['native adult weekly habit choice/discovery', 'explicit Wednesday test Date in browser and disposable API', 'Tuesday backfill/dated undo/weekly versus today meaning', 'same-name exact-ID deletion, cancel and bounded native quota attempt'];
  if (taskSet === 'habits-frequency') metadata.scenarioScope = ['native same-name weekly creation and dated facts', 'immediate daily current-progress preview, cancel without writes', 'native quota preserves original and chosen new frequency, visible retry and ACK', 'same-ID facts/version/neighbor checks, Home/current history/reopen/reload'];
  metadata.untested = ['Real calendar transition or midnight', 'Real mobile device/OS accessibility or screen reader', 'Live SMS/model/notification delivery', 'Arbitrary habit scales, all component states and all account/multi-device concurrency', 'Human-operated task execution'];
}
if (taskSet === 'goals') {
  metadata.kind = 'goal-user-outcome-implementation-candidate';
  metadata.goalRedEvidenceCommit = '0f77be644dbd1fc45becbc7223acd8e078cadfa4';
  metadata.applicationBaseline = '9a9fdc12818e9ba03a3768c34155ce036b76a439';
  metadata.scenarioScope = ['native Goal discovery and distinguishable same-name creation', 'manual progress reversal, counts and filtered denominator meaning', 'exact source edit/cancel/clear optional date', 'bounded native quota, retained input, actual retry/delete/reload'];
  metadata.untested = ['Native multi-tab stale goal dialog and account-transition timing', 'Legacy local goal enrollment/recovery fixtures', 'All-component accessibility/zoom/reduced-motion', 'Manual human interaction or real provider calls'];
}
if (taskSet.startsWith('legacy-goals-')) {
  metadata.kind = 'legacy-account-goal-native-fixture-red-baseline';
  metadata.applicationBaseline = 'ccba25822b92cf7de890ccf29d93679c6d794940';
  metadata.redEvidenceCommit = null; // This run establishes the legacy-specific baseline.
  delete metadata.planningRedEvidenceCommit;
  delete metadata.coachRedEvidenceCommit;
  metadata.scenarioScope = taskSet === 'legacy-goals-enrollment'
    ? ['native registration and existing-account OTP in a separate historical-profile fixture', 'selected upload/cancel/quota/retry with unselected original preserved', 'complete visible upload disclosure and no unknown metadata transfer', 'empty historical date refusal/correction and actual original backup download', 'true pre-cutover late source disclosure and separate original exports']
    : ['same-name source-choice readability', 'explicit current-generation source-table fixture comparison/copy/keep', 'committed copy then bounded display-read failure and actual recovery', 'stale opened comparison after copy deletion cannot resurrect'];
  metadata.interactions = 'native pointer/keyboard and recorded browser reloads; historical per-account DB seed and current-generation source changes explicitly labelled; no auth injection or business-write API';
  metadata.untested = ['Anonymous shared database ownership recovery', 'Automatic merging or one-click recovery of actual pre-cutover late changes', 'Arbitrary historical formats or private production data', 'Full-component keyboard/accessibility/zoom/reduced-motion and real mobile devices', 'Live SMS/model or production operations'];
}
if (taskSet === 'initial-session') {
  metadata.kind = 'initial-session-native-RED-baseline';
  metadata.applicationBaseline = '6290160';
  metadata.harnessBaseline = 'e90ed2b37fb8c2393681f3062fe368d88172b210';
  metadata.redEvidenceCommit = null; // This run establishes its own native baseline.
  delete metadata.planningRedEvidenceCommit;
  delete metadata.coachRedEvidenceCommit;
  metadata.scenarioScope = ['fresh protected /todo?view=all -> actual auth/me401 -> visible Login -> native registration -> exact return', 'separate public Login/native registration -> create Todo/full same-ID ACK -> Settings Logout -> protected re-entry/Login with private content absent and retained DB -> existing-account OTP -> exact path and original record', 'both branches in independent 1280/360 profiles, with first failures and bounded deadlines'];
  metadata.interactions = 'native pointer/keyboard/wheel; only declared initial and post-Logout protected URL entries; GET-only evidence and existing-IDB readonly snapshots; no auth/cookie/state injection';
  metadata.diagnosisBoundary = 'Module-confirmed initial signed-out/auth401 readiness issues do not establish the unresolved original b5b8a12 B-to-Todo failure cause';
  metadata.untested = ['Live SMS/model delivery', 'Manual human/mobile OS/screen-reader/accessibility acceptance', 'Initial-session races beyond these four independent native scenarios', 'Production accounts/data/deployment'];
}
if (taskSet === 'startup-recovery') {
  metadata.kind = 'startup-recovery-native-RED-baseline';
  metadata.applicationBaseline = 'e723af607e3cad830395d24c50c31f0d76ab2be0';
  metadata.redEvidenceCommit = null;
  delete metadata.planningRedEvidenceCommit; delete metadata.coachRedEvidenceCommit;
  metadata.scenarioScope = ['native registration and original Todo cloud ACK; declared full-page startup, real 12s timeout, delayed initial success followed by a later actual recovery readonly abort', 'neither read succeeds: readable error and real Retry after explicit fault release returns unchanged original', 'both branches at 1280/360 in four independent profiles; first failures, source/epoch and complete fault chronology'];
  metadata.interactions = 'Native pointer/keyboard/wheel; declared initial Login and startup full navigation; GET-only and existing-IDB readonly corroboration. Bounded clearly SYNTHETIC business-fetch rejection and native readonly transaction keepalive/abort, never auth/state injection or application Promise interception.';
  metadata.diagnosisBoundary = 'Known overlapping-read readiness race only; does not establish the unresolved b5b8a12 failure cause';
  metadata.untested = ['Live providers, production data/deployment', 'Manual human/mobile OS/accessibility acceptance', 'Actual browser outcomes until this exact SHA runs and its original media are independently reviewed', 'Arbitrary source/epoch/account changes; this fixture asserts an unchanged original source'];
}
if (taskSet.startsWith('preferences-')) {
  metadata.kind = 'account-preference-native-RED-baseline';
  metadata.applicationBaseline = 'd54249d1d93da6bd2bddb1c73ff3e2dc38ba8b1d';
  metadata.redEvidenceCommit = null;
  delete metadata.planningRedEvidenceCommit; delete metadata.coachRedEvidenceCommit;
  metadata.scenarioScope = {
    'preferences-normal': ['Native account preference values, immediate switches and canceling only a time draft', 'Account numerical limit including explicit zero; separately authenticated second profile; device budget/theme retention'],
    'preferences-write': ['Exact precommit native-IDB quota preserves full source and input', 'Readable failure and actual visible Save retry after explicit release; same intent and one cloud revision'],
    'preferences-read': ['Exact target transaction completes before real display-only readonly failure', 'Visible saved fact, current read error, actual recovery action without repeating Save, full values and one cloud revision'],
    'preferences-conflict': ['Two actual profiles, distinct offline conflicts for cloud and local decisions, cancel, stale comparison refusal', 'Full visible field-to-source correspondence, real original snapshot/decision/pending-request downloads, fresh reads in both profiles'],
  }[taskSet];
  metadata.interactions = 'Native pointer/keyboard/wheel; initial OTP Login, normal onboarding, actual reload and second profile. GET-only and existing-IDB readonly evidence. Declared bounded native put quota, postcommit readonly abort and offline mode only; no app/auth state injection or business-write API setup.';
  metadata.untested = ['Actual reminder delivery and per-device usage counters', 'Unknown historical formats, arbitrary account transitions and all Settings components', 'Manual human/mobile OS/accessibility or live SMS/model providers', 'Production data and deployment'];
}
if (taskSet.startsWith('expense-')) {
  metadata.kind = 'expense-budget-native-RED-baseline';
  metadata.applicationBaseline = '48ea881908b433bdd0222a82f93a4f3417c0e5a0';
  metadata.redEvidenceCommit = null;
  delete metadata.planningRedEvidenceCommit; delete metadata.coachRedEvidenceCommit;
  metadata.controlledClock = { ...expenseClock, scope: 'browser Date only; server and database audit timestamps remain real' };
  metadata.scenarioScope = taskSet === 'expense-records'
    ? ['Native dated income and expense creation, exact actual-spend day/natural-week/month meaning', 'Visible same-name identification, cancelled retained draft and same-ID correction', 'Neighbor/source/ledger/ACK preservation and visible recalculation after return']
    : ['Unset device budget, explicit zero, exact-cent budget and overspend meaning', 'Cancel/reopen preserves the stated page draft and committed budget', 'Exact precommit budget-key refusal, readable cause and retained input, actual inline Save retry', 'Separate Expense-ID refusal: desktop direct Save retry, narrow-screen retained-draft cancel/reopen then Save; exact ACK and same-device reload'];
  metadata.interactions = 'Native pointer/keyboard/wheel with declared advancing browser Date at Wednesday 2026-10-07 Asia/Shanghai; normal synthetic registration; GET-only and existing-IDB readonly evidence; exact bounded native precommit quota only. No business-record seeding, account-state injection, live provider or production operation.';
  metadata.untested = ['Month/category filtering and all chart/keyboard states', 'Actual midnight/calendar transition and arbitrary scale', 'Account authority, clear-epoch or postcommit publication races', 'Manual human/mobile OS/accessibility or live providers', 'Production data, deployment and all-product readiness'];
}
if (taskSet.startsWith('diary-')) {
  metadata.kind = 'daily-one-diary-native-RED-baseline';
  metadata.applicationBaseline = '07bc198487a883fc9e508520a2eaef6d2bd1dd74';
  metadata.redEvidenceCommit = null;
  delete metadata.planningRedEvidenceCommit; delete metadata.coachRedEvidenceCommit;
  metadata.controlledClock = { ...diaryClock, scope: 'browser Date only; original server and database audit timestamps remain real' };
  metadata.scenarioScope = taskSet === 'diary-records'
    ? ['Native optional mood and multiline diary creation, complete reading including short four-line content', 'Daily-one refusal with actual original access and retained conflicting draft', 'Cancel/reopen and same-ID correction, precise Timeline navigation and return, fixed inputs and complete source/ledger preservation']
    : ['List-delete cancellation only; ordinary exact precommit diary put/delete refusal and visible retry', 'Editor deletion of disposable synthetic data with retained draft, explicit new-ID copy and old tombstone preserved', 'Native Diary/Timeline navigation and neighbor/current-copy consistency; no genuine undelete or old-ID resurrection claim'];
  metadata.interactions = 'Native pointer/keyboard/wheel, declared advancing browser Date, ordinary synthetic registration and GET-only/readonly corroboration. Bounded exact precommit quota only; no direct business seeding, auth/owner/clear/publication injection, live services or private records.';
  metadata.untested = ['Genuine undo of committed cloud deletion; multiple records per day are unsupported', 'Deleted-draft recovery after leaving the editor unless actually reached by a visible route', 'Arbitrary historical formats, scale, full keyboard/screen reader and real phone OS', 'Authority/clear-epoch/publication races, production data or deployment'];
}
async function checkpoint(stage, extra = {}) {
  const temporary = join(artifacts, 'progress-checkpoint.tmp');
  await writeFile(temporary, JSON.stringify({ partial: true, stage, checkpointAt: new Date().toISOString(), metadata, results, actions, traffic, infrastructure, ...extra }, null, 2));
  await rename(temporary, join(artifacts, 'progress-checkpoint.json'));
}
function launch(command, args, cwd, extraEnvironment = {}) { const child = spawn(command, args, { cwd, env: { ...environment, ...extraEnvironment }, stdio: ['ignore', 'ignore', 'pipe'] }); child.stderr.on('data', () => infrastructure.push('synthetic-service-stderr')); children.push(child); return child; }
async function ready(url) { const end = Date.now() + 30000; while (Date.now() < end) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(150); } throw new Error('Isolated service did not start'); }
async function state(page) { return page.evaluate(() => ({ capturedAt: new Date().toISOString(), path: location.pathname + location.search, title: document.title, theme: document.documentElement.dataset.theme, text: document.body.innerText, scroll: { x: scrollX, y: scrollY }, visibility: document.visibilityState, focused: document.hasFocus(), activeElement: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') }, animations: document.getAnimations().map(animation => ({ playState: animation.playState, currentTime: String(animation.currentTime), target: animation.effect?.target?.tagName })), viewport: { width: innerWidth, height: innerHeight }, headings: [...document.querySelectorAll('h1,h2,h3')].map(el => el.textContent), navigationLabels: [...document.querySelectorAll('nav[aria-label="主导航"] button span')].filter(el => el.getBoundingClientRect().width > 0).map(el => ({ text: el.textContent, color: getComputedStyle(el).color, fontSize: getComputedStyle(el).fontSize, fontWeight: getComputedStyle(el).fontWeight, box: el.getBoundingClientRect().toJSON(), ownBackground: getComputedStyle(el).backgroundColor, buttonBackground: getComputedStyle(el.closest('button')).backgroundColor, buttonGradient: getComputedStyle(el.closest('button')).backgroundImage, navBackground: getComputedStyle(el.closest('nav')).backgroundColor })), controls: [...document.querySelectorAll('button,input,textarea,select,a')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).map(el => ({ tag: el.tagName, text: el.textContent?.trim().slice(0, 180), label: el.getAttribute('aria-label'), type: el.getAttribute('type'), disabled: el.disabled, value: ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) ? el.value : undefined, box: el.getBoundingClientRect().toJSON(), opacity: getComputedStyle(el).opacity, color: getComputedStyle(el).color, backgroundColor: getComputedStyle(el).backgroundColor, backgroundImage: getComputedStyle(el).backgroundImage, fontSize: getComputedStyle(el).fontSize, hitAtCenter: (() => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { tag: hit?.tagName, label: hit?.getAttribute('aria-label'), isTarget: el.contains(hit) }; })(), ancestors: (() => { const rows = []; for (let node = el.parentElement; node && rows.length < 8; node = node.parentElement) { const css = getComputedStyle(node); rows.push({ tag: node.tagName, box: node.getBoundingClientRect().toJSON(), position: css.position, opacity: css.opacity, transform: css.transform, overflow: css.overflow, display: css.display }); } return rows; })() })) })); }
async function capture(page, name) { const stem = `${String(++sequence).padStart(3, '0')}-${name.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 75)}`; await page.screenshot({ path: join(artifacts, `${stem}.png`), fullPage: false }); const snapshot = await state(page); await writeFile(join(artifacts, `${stem}.json`), JSON.stringify(snapshot, null, 2)); await checkpoint(`captured ${stem}`); return { screenshot: `${stem}.png`, snapshot: `${stem}.json`, state: snapshot }; }
async function observe(page, name, pass, detail) { const evidence = await capture(page, name); results.push({ name, status: pass === null ? 'observed-context' : pass ? 'observed-pass' : 'observed-fail', detail, screenshot: evidence.screenshot, snapshot: evidence.snapshot }); console.log(`${pass === null ? 'CONTEXT' : pass ? 'OBSERVED' : 'PRODUCT GAP'} ${name}: ${detail}`); await checkpoint(`observed ${name}`); return evidence.state; }
async function segment(page, name, operation) { try { await operation(); } catch (error) { const evidence = await capture(page, name).catch(() => ({})); results.push({ name, status: 'blocked', detail: error.message, screenshot: evidence.screenshot, snapshot: evidence.snapshot }); console.log(`BLOCKED ${name}: ${error.message}`); await checkpoint(`blocked ${name}`); } }
async function visibleHandle(page, selector, text) { const handle = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.disabled && (text === undefined || el.textContent.trim() === text); }), { timeout: 7000 }, selector, text); return handle.asElement(); }
async function pointer(page, selector, text) {
  await page.bringToFront();
  for (let attempt = 0; attempt < 3; attempt++) {
    const element = await visibleHandle(page, selector, text); let attemptedClick = false;
    try {
      await element.scrollIntoView();
      await page.waitForFunction(el => { if (!el.isConnected) return true; const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, { timeout: 7000 }, element);
      if (!await element.evaluate(el => el.isConnected)) { actions.push({ kind: 'reacquire-rendered-target-before-click', selector, text }); continue; }
      attemptedClick = true; await element.asLocator().click();
      actions.push({ at: new Date().toISOString(), kind: 'native-pointer', surface: surfaceNames.get(page), selector, text, path: new URL(page.url()).pathname }); return;
    } catch (error) {
      // Reacquire only before any click was attempted; never replay an uncertain action.
      if (!attemptedClick && /detached|not connected/i.test(error.message) && attempt < 2) { actions.push({ kind: 'reacquire-detached-target-before-click', selector, text }); continue; }
      throw error;
    } finally { await element.dispose(); }
  }
  throw new Error('Rendered target kept changing before a native click');
}
async function fill(page, selector, text) { await pointer(page, selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(text); assert.equal(await page.$eval(selector, el => el.value), text); actions.push({ at: new Date().toISOString(), kind: 'native-text', surface: surfaceNames.get(page), selector, syntheticText: text }); }
async function nav(page, label) { await pointer(page, 'aside nav button', label); await sleep(350); }
async function waitPath(page, path) { const started = Date.now(); await page.waitForFunction(path => location.pathname === path, { timeout: 15000 }, path); actions.push({ at: new Date().toISOString(), kind: 'route-observed', surface: surfaceNames.get(page), path, waitedMs: Date.now() - started }); await sleep(350); }
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
async function finishPreferenceEvidence(name, stage, operation) {
  if (!name.startsWith('YP-') && !name.startsWith('YE-') && !name.startsWith('YD-')) return operation();
  actions.push({ kind: 'preference-evidence-finish-start', surface: name, stage, at: new Date().toISOString() });
  await checkpoint(`${name}: ${stage} started`).catch(() => undefined);
  try { return await operation(); }
  catch (error) { infrastructure.push({ preferenceEvidenceFinish: stage, errorName: preferenceEvidenceErrorName(error), surface: name }); throw error; }
  finally {
    actions.push({ kind: 'preference-evidence-finish-ended', surface: name, stage, at: new Date().toISOString() });
    await checkpoint(`${name}: ${stage} ended`).catch(() => undefined);
  }
}
async function isolated(name, viewport, body) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  surfaceNames.set(page, name);
  await page.setViewport(viewport); await page.emulateTimezone('Asia/Shanghai'); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000); await page.bringToFront();
  page.on('pageerror', error => infrastructure.push({ scenario: name, pageError: error.name }));
  page.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) { traffic.push({ scenario: name, path, status: response.status(), method: response.request().method() }); if (response.status() >= 500) infrastructure.push({ scenario: name, httpFailure: response.status(), path }); } });
  let recorder;
  try {
    await page.tracing.start({ path: join(artifacts, `${name}-trace.json`), screenshots: true });
    await checkpoint(`starting recording ${name}`);
    recorder = await page.screencast({ path: join(artifacts, `${name}.webm`), fps: 12, quality: 35 });
    await body(page);
  } catch (error) { await segment(page, `${name}-setup`, async () => { throw error; }); }
  finally { if (recorder && !page.isClosed()) { actions.push({ kind: 'natural-reading-interval', surface: name, durationMs: 500, purpose: 'final visible state before recording closes' }); await sleep(500); await finishPreferenceEvidence(name, 'final-visible-capture', () => capture(page, `${name}-final-visible-frame`)).catch(() => infrastructure.push({ scenario: name, finalVisibleFrameMissing: true })); } try { if (recorder) await finishPreferenceEvidence(name, 'recorder-stop', () => recorder.stop()); } finally { try { await finishPreferenceEvidence(name, 'trace-stop', () => page.tracing.stop()); } finally { await finishPreferenceEvidence(name, 'profile-close', () => context.close()); actions.push({ kind: 'isolated-profile-closed', surface: name }); } } }
}
async function apiFor(page) {
  const cookie = (await page.browserContext().cookies()).filter(row => row.domain === '127.0.0.1').map(row => `${row.name}=${row.value}`).join('; ');
  const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } }); const { user } = await me.json(); assert.ok(user?.id);
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => { const response = await fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie, Origin: origin, 'X-YouTrace-Account': user.id, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); const result = await response.json(); assert.ok(response.ok, `Synthetic fixture/API ${path}: ${response.status}`); return result; };
  request.ownerId = user.id; return request;
}
async function localRows(page, owner) {
  return page.evaluate(owner => new Promise((resolve, reject) => {
    const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected account DB must already exist')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const database = request.result, names = ['todos', 'expenses', 'quickNotes', 'diary', 'habits', 'habitCheckins', 'schedules', 'goalRecords', 'coachInsights', 'settings', 'outbox']; const transaction = database.transaction(names, 'readonly'), rows = {};
      for (const name of names) { const read = transaction.objectStore(name).getAll(); read.onsuccess = () => { rows[name] = read.result; }; }
      transaction.oncomplete = () => { database.close(); resolve(rows); }; transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), owner);
}
async function saveRecordEvidence(name, local, remote, selected, extra = {}) {
  const snapshots = [];
  for (const [entity, ids] of Object.entries(selected)) for (const id of ids) {
    const table = entity === 'diaries' ? 'diary' : entity === 'goals' ? 'goalRecords' : entity, key = `${entity}:${id}`;
    const pending = local.outbox.filter(row => row.entity === entity && (row.payload === id || row.payload?.id === id)).map(row => ({ seq: row.seq, op: row.op, entity: row.entity, recordId: id, status: row.status ?? 'pending', baseVersion: row.baseVersion, predecessorSeq: row.predecessorSeq, attempts: row.attempts, lastStatus: row.lastStatus }));
    snapshots.push({ entity, id, local: local[table]?.find(row => row.id === id) ?? null, server: remote[entity]?.find(row => row.id === id) ?? null, version: local.settings.find(row => row.key === `sync-version:${key}`) ?? null, conflict: local.settings.find(row => row.key === `sync-conflict:${key}`) ?? null, pending });
  }
  await writeFile(join(artifacts, `${name}-record-state.json`), JSON.stringify({ syntheticOnly: true, capturedAt: new Date().toISOString(), totalOutbox: local.outbox.length, localCounts: Object.fromEntries(Object.keys(selected).map(entity => [entity, local[entity === 'diaries' ? 'diary' : entity === 'goals' ? 'goalRecords' : entity]?.length])), serverCounts: Object.fromEntries(Object.keys(selected).map(entity => [entity, remote[entity]?.length])), snapshots, ...extra }, null, 2));
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
  // Chrome auto-advances after a two-digit month/day. Extra ArrowRight skips
  // a segment and appends digits to the year (retained in the prior red trace).
  await page.keyboard.type(month + day + year); await page.keyboard.press('Tab');
  const actual = await page.$eval(selector, el => el.value); actions.push({ kind: 'native-segmented-date', selector, expected: iso, actual }); assert.equal(actual, iso, 'Native date editing must reach the intended value');
}
async function checked(page, selector, value) { if (await page.$eval(selector, el => el.checked) !== value) await pointer(page, selector); assert.equal(await page.$eval(selector, el => el.checked), value); }
async function settledRows(page, api) { let local; for (let i = 0; i < 60; i++) { local = await localRows(page, api.ownerId); if (!local.outbox.length) return local; await sleep(250); } return local; }
async function back(page, from) { await page.bringToFront(); await page.goBack({ waitUntil: 'domcontentloaded' }); actions.push({ kind: 'browser-history-back', surface: surfaceNames.get(page), from }); await sleep(400); }
async function discoverMobileTasks(page) {
  await pointer(page, 'summary', '也可以直接安排任务、记账或查看其他功能');
  await capture(page, 'YN-empty-home-expanded-functions');
  for (const [name, path] of [['待办', '/todo'], ['习惯', '/habit']]) {
    const entry = await page.evaluate(({ name, path }) => [...document.querySelectorAll('main button,main a,nav button,nav a')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (el.getAttribute('aria-label') === name || el.textContent.trim() === name || el.getAttribute('href') === path); }).map(el => ({ tag: el.tagName, text: el.textContent.trim(), label: el.getAttribute('aria-label'), href: el.getAttribute('href'), box: el.getBoundingClientRect().toJSON() })), { name, path });
    await observe(page, `YN-discover-${name === '待办' ? 'todo' : 'habit'}-entry`, entry.length ? null : false, entry.length ? `A rendered ${name} entry exists; opening/creation still require their own task, not granted by presence` : `After opening the actual first-use function list, no rendered ${name} entry is available in Home or mobile navigation`);
  }
  await pointer(page, 'summary', '也可以直接安排任务、记账或查看其他功能');
}
async function staticArrival(page, name, path) {
  await page.waitForFunction(path => { const root = document.querySelector(`[data-page-route="${path}"]`), heading = root?.querySelector('h1'); if (!heading) return false; const r = heading.getBoundingClientRect(); return location.pathname === path && Math.abs(scrollY) <= 1 && document.activeElement === heading && r.top >= 0 && r.bottom <= innerHeight; }, { timeout: 7000 }, path);
  await observe(page, name, true, 'Natural static-page arrival shows its actual destination heading at the start with focus; the probe never scrolls the page to manufacture this state');
}
async function mobileDiscoveryAndCreation(page) {
  await login(page, '13900008806', 'Synthetic YN'); const api = await apiFor(page);
  await pointer(page, 'summary', '也可以直接安排任务、记账或查看其他功能');
  await observe(page, 'YN-first-use-tasks-visible', Boolean(await page.$('main a[aria-label="待办"]')) && Boolean(await page.$('main a[aria-label="习惯"]')), 'Formerly absent manual-task shortcuts are visibly discoverable in the first-use optional section');
  await pointer(page, 'main a[aria-label="待办"]'); await waitPath(page, '/todo');
  await pointer(page, 'button[aria-label="新建待办"]'); await fill(page, '#todo-text', 'Synthetic 从首页安排待办'); await pointer(page, '[role=dialog] button', '明天');
  await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
  const todoLocal = await settledRows(page, api), todos = (await api('/todos')).todos;
  await saveRecordEvidence('YN-home-created-todo', todoLocal, { todos }, { todos: todos.map(row => row.id) });
  await observe(page, 'YN-home-to-actual-todo-cloud-ack', todoLocal.outbox.length === 0 && todos.length === 1 && todoLocal.todos.length === 1 && todos[0].text === 'Synthetic 从首页安排待办' && todos[0].dueDate === businessDate(1), 'Real first-use Home entry creates exactly one intended tomorrow task and receives server ACK');
  await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-created-todo', surface: surfaceNames.get(page) }); await page.waitForFunction(() => document.body.innerText.includes('Synthetic 从首页安排待办'));
  await back(page, '/todo'); await waitPath(page, '/'); await capture(page, 'YN-home-return-after-manual-task');
  await pointer(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more');
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1' && document.activeElement.textContent === '全部功能');
  const menuLinks = await page.$$eval('nav[aria-label="全部功能"] a', rows => rows.map(el => ({ href: el.getAttribute('href'), text: el.innerText, minHeight: el.getBoundingClientRect().height })));
  await observe(page, 'YN-directory-choices-explicit', menuLinks.length === 11 && menuLinks.every(row => row.minHeight >= 44 && row.text.length > 4) && menuLinks.some(row => row.href === '/settings') && menuLinks.some(row => row.href === '/coach'), 'Each actual destination has a readable purpose, including settings and coach, without claiming those complete tasks are validated');
  await pointer(page, 'main button', '返回首页'); await waitPath(page, '/');
  await capture(page, 'YN-directory-top-return-home');
  await pointer(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more');
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1' && document.activeElement.textContent === '全部功能');
  for (let attempt = 0; attempt < 16 && await page.evaluate(() => document.activeElement?.getAttribute('href')) !== '/habit'; attempt++) { await page.keyboard.press('Tab'); actions.push({ kind: 'native-keyboard-tab-directory', surface: surfaceNames.get(page) }); }
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '/habit', 'Habit entry must be reachable by normal Tab order');
  const menuBefore = await state(page); await capture(page, 'YN-keyboard-habit-focus'); await page.keyboard.press('Enter'); actions.push({ kind: 'native-keyboard-enter-directory-habit', surface: surfaceNames.get(page) }); await waitPath(page, '/habit');
  await pointer(page, 'button[aria-label="新建习惯"]'); await fill(page, '[role=dialog] input[placeholder="例如：跑步 5 公里"]', 'Synthetic 自主散步'); await pointer(page, '[role=dialog] button', '每周');
  await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
  const habitLocal = await settledRows(page, api), habits = (await api('/habits')).habits;
  await saveRecordEvidence('YN-directory-created-habit', habitLocal, { habits }, { habits: habits.map(row => row.id) });
  await observe(page, 'YN-keyboard-to-actual-weekly-habit-cloud-ack', habitLocal.outbox.length === 0 && habits.length === 1 && habitLocal.habits.length === 1 && habits[0].name === 'Synthetic 自主散步' && habits[0].frequency === 'weekly', 'Actual user-chosen weekly habit is created once; this does not validate weekly denominator/streak semantics');
  const habitToday = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()));
  await pointer(page, `button[aria-label="完成 Synthetic 自主散步（仅今天 ${habitToday}）"]`); await page.waitForSelector(`button[aria-label="取消完成 Synthetic 自主散步（仅今天 ${habitToday}）"]`); const checkedHabitLocal = await settledRows(page, api);
  await observe(page, 'YN-habit-actual-today-check', (await api('/habits')).habits.some(row => row.id === habits[0].id && row.done), 'Actual check-in control changes this same habit at the server');
  await pointer(page, `button[aria-label="取消完成 Synthetic 自主散步（仅今天 ${habitToday}）"]`); await page.waitForSelector(`button[aria-label="完成 Synthetic 自主散步（仅今天 ${habitToday}）"]`); const undone = await settledRows(page, api), afterHabits = (await api('/habits')).habits;
  await saveRecordEvidence('YN-habit-undo', undone, { habits: afterHabits }, { habits: [habits[0].id] }, { checkins: undone.habitCheckins.filter(row => row.habitId === habits[0].id) });
  const todayCheckin = undone.habitCheckins.filter(row => row.habitId === habits[0].id && row.date === businessDate()), versionKey = `sync-version:habitCheckins:${habits[0].id}|${businessDate()}`;
  const checkedVersion = checkedHabitLocal.settings.find(row => row.key === versionKey)?.value, undoneVersion = undone.settings.find(row => row.key === versionKey)?.value;
  await writeFile(join(artifacts, 'YN-habit-exact-date-undo.json'), JSON.stringify({ syntheticOnly: true, habitId: habits[0].id, date: businessDate(), before: checkedHabitLocal.habitCheckins.filter(row => row.habitId === habits[0].id && row.date === businessDate()), after: todayCheckin, checkedVersion, undoneVersion, server: afterHabits.find(row => row.id === habits[0].id) }, null, 2));
  const validAck = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
  await observe(page, 'YN-habit-undo-same-id-cloud-ack', undone.outbox.length === 0 && afterHabits.length === 1 && afterHabits[0].id === habits[0].id && !afterHabits[0].done && todayCheckin.length === 1 && todayCheckin[0].done === false && afterHabits[0].recentCheckins.some(row => row.date === businessDate() && row.done === false) && validAck(checkedVersion) && validAck(undoneVersion) && BigInt(undoneVersion) > BigInt(checkedVersion), 'Undo updates this exact habit/date to false locally and at the server with a newer acknowledged check-in version, without recreation');
  await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-created-habit', surface: surfaceNames.get(page) }); await page.waitForSelector(`button[aria-label="完成 Synthetic 自主散步（仅今天 ${habitToday}）"]`);
  await back(page, '/habit'); await waitPath(page, '/more');
  await page.waitForFunction(top => document.activeElement?.getAttribute('href') === '/habit' && Math.abs(scrollY - top) < 40, { timeout: 7000 }, menuBefore.scroll.y);
  const menuReturned = await state(page);
  await observe(page, 'YN-directory-back-restores-reading-and-focus', Math.abs(menuReturned.scroll.y - menuBefore.scroll.y) < 40 && await page.evaluate(() => document.activeElement?.getAttribute('href') === '/habit'), `Original menu ${menuBefore.scroll.y}px, returned ${menuReturned.scroll.y}px; same keyboard link focus`);
  await pointer(page, 'nav[aria-label="全部功能"] a[href="/settings"]'); await waitPath(page, '/settings'); await staticArrival(page, 'YN-settings-natural-heading-arrival', '/settings');
  await pointer(page, '[role=radiogroup][aria-label="主题"] button', '深色'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); await capture(page, 'YN-dark-navigation-labels');
  await back(page, '/settings'); await waitPath(page, '/more'); await pointer(page, 'nav[aria-label="全部功能"] a[href="/coach"]'); await waitPath(page, '/coach');
  await staticArrival(page, 'YN-coach-natural-heading-arrival', '/coach');
  await observe(page, 'YN-coach-entry-retained', Boolean(await page.$('textarea[aria-label="输入消息"]')), 'Coach is actually reachable; no model call or full observation-to-action outcome is asserted');
  await pointer(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more'); await pointer(page, 'nav[aria-label="全部功能"] a[href="/settings"]'); await waitPath(page, '/settings'); await staticArrival(page, 'YN-settings-second-natural-heading-arrival', '/settings');
  await pointer(page, '[role=radiogroup][aria-label="主题"] button', '跟随系统'); await page.waitForFunction(() => document.documentElement.dataset.theme === (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); await capture(page, 'YN-system-theme-restored');
  await page.setViewport({ width: 900, height: 900 }); actions.push({ kind: 'viewport-resize', width: 900, height: 900 }); await nav(page, '时间线'); await waitPath(page, '/timeline'); await staticArrival(page, 'YN-tablet-natural-timeline-arrival', '/timeline');
  await observe(page, 'YN-tablet-timeline-navigation', await page.$eval('aside button[aria-label="时间线"]', el => el.getAttribute('aria-current') === 'page'), 'Tablet now offers the real timeline entry and exposes its selected route');
  await page.setViewport({ width: 1280, height: 900 }); actions.push({ at: new Date().toISOString(), kind: 'viewport-resize', surface: surfaceNames.get(page), width: 1280, height: 900, recordingViewport: { width: 360, height: 800 }, stillImagesUseCurrentViewport: true });
  // setViewport completes before React necessarily replaces the tablet nodes.
  // Observe the real desktop navigation before acquiring its Goal control.
  await page.waitForFunction(() => {
    const navs = [...document.querySelectorAll('aside nav[aria-label="主导航"]')].filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
    if (!matchMedia('(min-width: 1025px)').matches || navs.length !== 1) return false;
    const nav = navs[0], aside = nav.closest('aside'), goal = [...nav.querySelectorAll('button')].find(el => el.textContent.trim() === '目标');
    return Boolean(aside && aside.getBoundingClientRect().width > 200 && nav.innerText.includes('安排与坚持') && goal?.isConnected && goal.getBoundingClientRect().width > 0);
  }, { polling: 100, timeout: 10000 });
  const stability = await page.evaluate(waitForStableModalTarget, 'aside nav[aria-label="主导航"]', 2500);
  actions.push({ kind: 'actual-desktop-sidebar-ready-after-resize', surface: surfaceNames.get(page), stability });
  await capture(page, 'YN-desktop-sidebar-after-resize-before-goal');
  await nav(page, '目标'); await waitPath(page, '/goal'); await staticArrival(page, 'YN-desktop-natural-goal-arrival', '/goal');
  await observe(page, 'YN-desktop-purpose-groups-and-goal-entry', (await state(page)).text.includes('安排与坚持') && !(await page.$eval('aside nav', el => el.innerText)).includes('系统'), 'Desktop grouping no longer calls life tasks system settings; actual goal navigation is operated');
}
async function retrieveOlderThanMonth(page, api, existingHistoryCount) {
  const oldDate = businessDate(-45), name = 'Synthetic 同名跨月午饭';
  const fixtures = (await api('/expenses/batch', { items: [{ amount: 1379, category: 'food', name, date: businessDate() }, { amount: 1379, category: 'food', name, date: oldDate }] })).expenses;
  const target = fixtures.find(row => row.date === oldDate), recent = fixtures.find(row => row.date === businessDate());
  assert.ok(target && recent);
  await writeFile(join(artifacts, 'Y2-older-than-month-fixture.json'), JSON.stringify({ setup: 'isolated API setup, not user-created history', target, recent }, null, 2));
  if (new URL(page.url()).pathname !== '/timeline') { await nav(page, '时间线'); await waitPath(page, '/timeline'); }
  await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-after-explicit-fixture', fixtureOnly: true, purpose: 'older-than-month paired records' });
  let pulled;
  for (let attempt = 0; attempt < 40; attempt++) { pulled = await localRows(page, api.ownerId); if (pulled.expenses.some(row => row.id === target.id)) break; await sleep(250); }
  assert.ok(pulled.expenses.some(row => row.id === target.id), 'Old record fixture must be pulled before range observations');
  await pointer(page, 'button', '近30天');
  const oldSelector = `section[aria-label="${oldDate}"] button[aria-label="收支: -¥13.79 ${name}"]`;
  const recentSelector = `section[aria-label="${businessDate()}"] button[aria-label="收支: -¥13.79 ${name}"]`;
  await page.waitForFunction(selector => new URLSearchParams(location.search).get('range') === '30' && document.querySelector('[aria-label="时间范围"] button[aria-pressed="true"]')?.textContent === '近30天' && Boolean(document.querySelector(selector)), {}, recentSelector);
  const expandRangeToEnd = async expectedTotal => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = await page.$$eval('button', nodes => nodes.find(el => el.textContent.startsWith('继续查看较早记录'))?.textContent.trim());
      if (!next) break;
      const previousCount = await page.evaluate(() => document.body.innerText.match(/当前显示 (\d+)\/(\d+) 条/)?.[1]);
      await pointer(page, 'button', next);
      await page.waitForFunction(previous => document.body.innerText.match(/当前显示 (\d+)\/(\d+) 条/)?.[1] !== previous, {}, previousCount);
    }
    const complete = await page.evaluate(expected => document.body.innerText.includes(`当前显示 ${expected}/${expected} 条`) && ![...document.querySelectorAll('button')].some(el => el.textContent.startsWith('继续查看较早记录')), expectedTotal);
    assert.equal(complete, true, `Selected range must expose its known ${expectedTotal} fixture records before absence is tested`);
  };
  await expandRangeToEnd(existingHistoryCount + 1);
  await observe(page, 'Y2-month-filter-excludes-old-retains-recent-pair', !await page.$(oldSelector) && Boolean(await page.$(recentSelector)), 'After reading to the selected range end (all known recent fixtures, no continuation left), the recent same-name pair remains and the 45-day-old record is absent');
  await pointer(page, 'button', '全部记录');
  await page.waitForFunction(selector => new URLSearchParams(location.search).get('range') === 'all' && document.querySelector('[aria-label="时间范围"] button[aria-pressed="true"]')?.textContent === '全部记录' && Boolean(document.querySelector(selector)), {}, recentSelector);
  await expandRangeToEnd(existingHistoryCount + 2);
  assert.ok(await page.$(oldSelector), 'All-record range and continuation must expose the actual old date');
  const oldHandle = await visibleHandle(page, oldSelector); await oldHandle.scrollIntoView(); await oldHandle.dispose(); await sleep(250); const before = await state(page); await capture(page, 'Y2-older-than-month-origin');
  await pointer(page, oldSelector); await waitPath(page, '/expense');
  await observe(page, 'Y2-older-than-month-exact-editor', await selectedDetail(page, { content: name, date: oldDate, amount: '13.79' }), 'Date distinguishes the older record from a same-name same-amount recent record');
  await fill(page, '#expense-name', 'Synthetic 已核对45天前午饭'); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
  const saved = await settledRows(page, api), remote = (await api('/expenses')).expenses;
  await saveRecordEvidence('Y2-older-than-month-paired-records', saved, { expenses: remote }, { expenses: [target.id, recent.id] });
  await observe(page, 'Y2-older-than-month-same-id-cloud-ack', saved.outbox.length === 0 && saved.expenses.length === pulled.expenses.length && remote.length === pulled.expenses.length && remote.some(row => row.id === target.id && row.date === oldDate && row.name === 'Synthetic 已核对45天前午饭') && remote.some(row => row.id === recent.id && row.date === recent.date && row.name === name && row.amount === 1379), 'Exact old ID corrected and acknowledged; recent same-name counterexample and total count unchanged');
  await back(page, '/expense'); await waitPath(page, '/timeline'); const returned = await state(page);
  await observe(page, 'Y2-older-than-month-return-all-range-position', await page.$eval('button[aria-pressed="true"]', el => el.textContent === '全部记录') && Math.abs(returned.scroll.y - before.scroll.y) < 40 && returned.text.includes('Synthetic 已核对45天前午饭'), `All-record range retained, original ${before.scroll.y}px / return ${returned.scroll.y}px`);
}
async function receiptReadFailureAfterUpdate(page) {
  await login(page, '13900008805', 'Synthetic YR');
  await pointer(page, 'main a', '写下第一条速记'); await waitPath(page, '/quick-note');
  await fill(page, 'textarea[aria-label="速记内容"]', '午饭8元'); await pointer(page, 'button', '查看确认稿'); await waitPath(page, '/quick-note/result');
  await checked(page, 'input[aria-label="将这段文字记入日记"]', false); await checked(page, 'input[aria-label="我愿意记录这次心情"]', false);
  await pointer(page, 'button', '确认保存所选记录'); await page.waitForFunction(() => location.search.includes('receipt='));
  const api = await apiFor(page), initial = await settledRows(page, api), expense = initial.expenses[0]; assert.equal(initial.expenses.length, 1);
  const receiptBefore = initial.settings.find(row => row.key.startsWith('capture-applied:')); assert.ok(receiptBefore);
  await saveRecordEvidence('YR-initial-ack', initial, { expenses: (await api('/expenses')).expenses }, { expenses: [expense.id] }, { originalReceipt: receiptBefore });
  const currentLink = `a[href="/expense?record=${encodeURIComponent(expense.id)}"]`;
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('已收到云端版本确认'), {}, currentLink);
  await observe(page, 'YR-initial-current-and-ack', true, 'First tab has already rendered current expense and its actual cloud acknowledgment before the fault');
  const peerTarget = page.browserContext().waitForTarget(target => target.type() === 'page' && target !== page.target()).then(target => ({ target }), error => ({ error }));
  await page.keyboard.down('Control'); try { await pointer(page, currentLink); } finally { await page.keyboard.up('Control'); }
  const openedTarget = await peerTarget; if (openedTarget.error) throw openedTarget.error;
  actions.push({ kind: 'native-control-click-open-peer-tab', sourceSurface: surfaceNames.get(page), href: `/expense?record=${expense.id}` });
  const peer = await openedTarget.target.page(); assert.ok(peer); surfaceNames.set(peer, 'YR-peer-edit-1280'); await peer.setViewport({ width: 1280, height: 900 }); await peer.emulateTimezone('Asia/Shanghai');
  peer.on('pageerror', error => infrastructure.push({ scenario: 'YR-peer', pageError: error.name }));
  peer.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) { traffic.push({ scenario: 'YR-peer', path, status: response.status(), method: response.request().method() }); if (response.status() >= 500) infrastructure.push({ scenario: 'YR-peer', httpFailure: response.status(), path }); } });
  let recorder;
  try {
    const targets = [];
    for (const [surface, observedPage] of [['YR-receipt-reread-1280', page], ['YR-peer-edit-1280', peer]]) { const session = await observedPage.createCDPSession(); const { targetInfo } = await session.send('Target.getTargetInfo'); targets.push({ surface, targetId: targetInfo.targetId, url: observedPage.url() }); await session.detach(); }
    metadata.receiptCrossTabEvidence = { trace: 'YR-receipt-reread-1280-trace.json', scope: 'One continuous browser-global Chrome trace spanning both tabs; page-attributed native actions and separate videos', targets, videos: ['YR-receipt-reread-1280.webm', 'YR-peer-edit-1280.webm'] };
    await peer.bringToFront();
    actions.push({ kind: 'foreground-peer-recording-preparation', surface: 'YR-peer-edit-1280', at: new Date().toISOString() });
    await checkpoint('starting peer video; continuous shared trace already active', { peerState: await peer.evaluate(() => ({ url: location.href, visibility: document.visibilityState, focused: document.hasFocus() })) });
    recorder = await peer.screencast({ path: join(artifacts, 'YR-peer-edit-1280.webm'), fps: 12, quality: 35 });
    await checkpoint('peer video started');
    await peer.bringToFront(); await waitPath(peer, '/expense'); await peer.waitForSelector('#expense-name');
    metadata.receiptCrossTabEvidence.targets.find(row => row.surface === 'YR-peer-edit-1280').readyUrl = peer.url();
    await capture(peer, 'YR-peer-actual-editor');
    // Only this already-loaded receipt tab has a bounded read outage. The peer performs
    // a real same-ID edit; no application records or UI values are injected.
    await page.evaluate(({ id, owner }) => {
      const original = IDBObjectStore.prototype.get, database = `youtrace:user:${owner}:schedule-v1`, startedAt = Date.now(), deadline = startedAt + 15000;
      const diagnostic = { database, recordId: id, startedAt, deadline, calls: [], hits: [], callCount: 0, hitCount: 0, truncatedEvents: false, restoredAt: null, expired: false };
      window.__receiptReadDiagnostic = diagnostic;
      let timer;
      window.__restoreReceiptRead = () => { clearTimeout(timer); IDBObjectStore.prototype.get = original; diagnostic.restoredAt ??= Date.now(); };
      timer = setTimeout(() => { diagnostic.expired = true; window.__restoreReceiptRead(); }, 15000);
      IDBObjectStore.prototype.get = function(key) {
        if (this.name === 'expenses' && key === id && this.transaction.db.name === database) {
          const scope = { at: Date.now(), monotonicMs: performance.now(), mode: this.transaction.mode, tables: [...this.transaction.objectStoreNames] };
          const eligible = scope.mode === 'readonly' && scope.tables.includes('outbox') && scope.tables.includes('goalRecords');
          diagnostic.callCount++; if (diagnostic.calls.length < 50) diagnostic.calls.push({ ...scope, eligible }); else diagnostic.truncatedEvents = true;
          if (eligible && Date.now() < deadline) { diagnostic.hitCount++; if (diagnostic.hits.length < 50) diagnostic.hits.push(scope); throw new DOMException('Synthetic bounded receipt read outage', 'UnknownError'); }
        }
        return original.call(this, key);
      };
    }, { id: expense.id, owner: api.ownerId });
    actions.push({ kind: 'synthetic-bounded-IDB-read-outage', scope: 'first tab / verified account DB / exact expense ID / all-table readonly receipt query', hardLimitMs: 15000 });
    await fill(peer, '#expense-name', 'Synthetic 另一页已核对午饭'); await pointer(peer, '[role=dialog] button', '保存'); await peer.waitForSelector('[role=dialog]', { hidden: true });
    const peerSaved = await settledRows(peer, api), remote = (await api('/expenses')).expenses;
    await saveRecordEvidence('YR-peer-corrected', peerSaved, { expenses: remote }, { expenses: [expense.id] });
    await observe(peer, 'YR-peer-same-id-real-cloud-edit', peerSaved.outbox.length === 0 && remote.length === 1 && remote[0].id === expense.id && remote[0].name === 'Synthetic 另一页已核对午饭', 'Second same-account tab edited through actual controls and server acknowledged that exact ID');
    await page.bringToFront();
    try { await page.waitForFunction(() => window.__receiptReadDiagnostic?.hits.length > 0 && document.body.innerText.includes('重新读取当前记录'), { timeout: 8000 }); }
    catch (error) { const fault = await page.evaluate(() => window.__receiptReadDiagnostic); if (fault?.expired || Date.now() >= fault?.deadline) throw new Error('Harness read-outage deadline expired before the error state could be observed'); if (!fault?.hitCount) throw new Error('Harness read-outage did not hit the exact native read boundary'); throw error; }
    if (await page.evaluate(() => window.__receiptReadDiagnostic.expired || Date.now() >= window.__receiptReadDiagnostic.deadline)) throw new Error('Harness read-outage deadline expired before capturing the error state');
    const readFailure = await page.$eval('ul', el => el.innerText);
    await observe(page, 'YR-failed-reread-clears-old-content-and-ack', await page.evaluate(() => window.__receiptReadDiagnostic.hitCount > 0) && readFailure.includes('当前记录暂不可读') && readFailure.includes('同步确认未知') && !readFailure.includes('已收到云端版本确认') && !readFailure.includes('午饭'), 'A later read failed after a previously confirmed view; stale current content and ACK are both withdrawn');
    await pointer(page, 'summary', '当时写入（只读回执）');
    await observe(page, 'YR-readonly-original-survives-reread-failure', (await state(page)).text.includes('不代表记录现在的内容'), 'Immutable original receipt remains available with its historical meaning during current-state read failure');
    if (await page.evaluate(() => window.__receiptReadDiagnostic.expired || Date.now() >= window.__receiptReadDiagnostic.deadline)) throw new Error('Harness read-outage deadline expired before explicit storage restoration');
    await page.evaluate(() => window.__restoreReceiptRead());
    actions.push({ kind: 'restore-bounded-receipt-read-access', surface: surfaceNames.get(page), at: new Date().toISOString() });
    let recovery = 'automatic-after-storage-returned';
    if (await page.$$eval('button', rows => rows.some(el => el.textContent === '重新读取当前记录'))) {
      try { await pointer(page, 'button', '重新读取当前记录'); recovery = 'explicit-retry'; }
      catch (error) { const alreadyCurrent = await page.$eval(currentLink, el => el.textContent.includes('Synthetic 另一页已核对午饭') && el.textContent.includes('已收到云端版本确认')); if (!alreadyCurrent) throw error; }
    }
    await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('Synthetic 另一页已核对午饭') && document.querySelector(selector)?.textContent.includes('已收到云端版本确认'), {}, currentLink);
    actions.push({ kind: 'receipt-read-recovery-observed', recovery, surface: surfaceNames.get(page) });
    const after = await localRows(page, api.ownerId); assert.deepEqual(after.settings.find(row => row.key === receiptBefore.key), receiptBefore);
    await saveRecordEvidence('YR-retry-current', after, { expenses: (await api('/expenses')).expenses }, { expenses: [expense.id] }, { originalReceipt: receiptBefore, receiptAfterCorrection: after.settings.find(row => row.key === receiptBefore.key) });
    await observe(page, 'YR-retry-current-restores-latest-not-creation', after.expenses.length === 1, `${recovery}: current updated record and matching acknowledgment visible; creation receipt bytes and record count unchanged`);
    // The user finishes comparing the read-only original, then reads the current
    // result. This is a real control action and natural viewing interval, not
    // fabricated video frames or a DOM/CSS mutation for recording.
    await pointer(page, 'summary', '当时写入（只读回执）');
    actions.push({ kind: 'natural-reading-interval', surface: surfaceNames.get(page), durationMs: 750, purpose: 'read restored current record after closing original comparison' }); await sleep(750);
    const stableCurrent = await page.$eval(currentLink, el => el.textContent.includes('Synthetic 另一页已核对午饭') && el.textContent.includes('已收到云端版本确认'));
    await observe(page, 'YR-restored-current-reading-frame', stableCurrent, 'Restored latest content and ACK remain visible during normal reading after an actual comparison-panel action');
  } finally {
    const diagnostic = await page.evaluate(() => { window.__restoreReceiptRead?.(); return window.__receiptReadDiagnostic ?? null; }).catch(() => null);
    await writeFile(join(artifacts, 'YR-read-outage-diagnostic.json'), JSON.stringify({ syntheticOnly: true, ...diagnostic, classification: diagnostic?.expired ? 'harness-blocked-outage-deadline' : diagnostic?.hitCount ? 'native-read-boundary-hit; inspect actual UI evidence' : 'harness-blocked-zero-confirmed-hits' }, null, 2));
    await page.evaluate(() => { delete window.__restoreReceiptRead; delete window.__receiptReadDiagnostic; }).catch(() => undefined);
    if (recorder) await recorder.stop(); await peer.close();
  }
}

async function firstValue(page, narrow = false) {
  if (narrow) { await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); actions.push({ kind: 'browser-prefers-reduced-motion', value: 'reduce' }); }
  const label = narrow ? 'Y1N' : 'Y1'; await login(page, narrow ? '13900008803' : '13900008801', `Synthetic ${label}`);
  await observe(page, `${label}-first-use-one-record-task`, (await state(page)).text.includes('先记一件刚发生的事') && !(await state(page)).text.includes('¥2,500'), 'New account sees a clear first action and no invented budget');
  if (narrow) await discoverMobileTasks(page);
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
    await saveRecordEvidence(`${label}-todo-cancel`, cancelledLocal, { todos: [cancelledRemote] }, { todos: [todo.id] });
    await observe(page, `${label}-todo-cancel-does-not-mutate`, cancelledLocal.todos.length === 1 && cancelledLocal.todos[0].text === todo.text && cancelledLocal.todos[0].dueDate === tomorrow && cancelledRemote.text === todo.text && cancelledRemote.dueDate === tomorrow, 'Cancel retained a draft only; both local and server original remain unchanged');
    await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'reload-cancelled-todo-draft' }); await page.waitForSelector('#todo-text');
    await observe(page, `${label}-todo-cancel-reload-retains-draft`, await page.$eval('#todo-text', el => el.value) === 'Synthetic 已核对报销单', 'Cancel persisted the draft but did not edit the original');
    await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const changedLocal = await settledRows(page, api), changed = changedLocal.todos.find(row => row.id === todo.id), changedRemote = (await api('/todos')).todos;
    await saveRecordEvidence(`${label}-todo-corrected`, changedLocal, { todos: changedRemote }, { todos: [todo.id] });
    await observe(page, `${label}-todo-corrected-same-id-local`, changedLocal.todos.length === 1 && changed?.text === 'Synthetic 已核对报销单' && changed.dueDate === businessDate(2), 'Local exact-ID correction, no duplicate');
    await observe(page, `${label}-todo-correction-cloud-ack`, changedLocal.outbox.length === 0 && changedRemote.length === 1 && changedRemote[0].id === todo.id && changedRemote[0].text === changed.text && changedRemote[0].dueDate === changed.dueDate, 'Queue and actual server object separately verify correction');
    await back(page, '/todo'); await waitPath(page, '/quick-note/result'); assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, receiptPath);
    await page.waitForFunction(date => document.body.innerText.includes('Synthetic 已核对报销单') && document.body.innerText.includes(date), {}, businessDate(2));
    const afterReturn = await localRows(page, api.ownerId), receiptId = new URL(page.url()).searchParams.get('receipt');
    const beforeReceipt = local.settings.find(row => row.key === `capture-applied:${receiptId}`)?.value, afterReceipt = afterReturn.settings.find(row => row.key === `capture-applied:${receiptId}`)?.value;
    assert.deepEqual(afterReceipt, beforeReceipt, 'Current-record display must never rewrite creation receipt');
    await saveRecordEvidence(`${label}-current-receipt`, afterReturn, { todos: changedRemote }, { todos: [todo.id] }, { originalReceipt: beforeReceipt, receiptAfterCorrection: afterReceipt });
    await observe(page, `${label}-todo-correction-return`, true, 'Current title/date visible after Back; immutable original receipt unchanged');
    await pointer(page, 'summary', '当时写入（只读回执）');
    await observe(page, `${label}-original-receipt-kept-separate`, (await state(page)).text.includes('交报销单') && (await state(page)).text.includes(tomorrow), 'Original creation labels/date remain available as explicitly historical evidence');
    for (let attempt = 0; attempt < 6; attempt++) {
      const geometry = await page.evaluate(date => { const el = [...document.querySelectorAll('details[open] li')].find(el => el.textContent.startsWith('交报销单') && el.textContent.includes(date)); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, center: r.top + r.height / 2, width: innerWidth, height: innerHeight }; }, tomorrow);
      assert.ok(geometry, 'Original todo row must exist inside the expanded read-only receipt');
      if (geometry.top >= 80 && geometry.bottom <= geometry.height - 100) break;
      const deltaY = geometry.center - geometry.height / 2; await page.mouse.move(geometry.width * 0.75, geometry.height / 2); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-read-original-receipt', deltaY }); await sleep(300);
    }
    const originalReadable = await page.evaluate(date => { const el = [...document.querySelectorAll('details[open] li')].find(el => el.textContent.startsWith('交报销单') && el.textContent.includes(date)); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 80 && r.bottom <= innerHeight - 100 && r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, tomorrow);
    await observe(page, `${label}-original-todo-date-reading-viewport`, originalReadable, 'Original creation title and earlier date are actually visible after normal scrolling when needed, separately from the current-record card');
    await pointer(page, 'summary', '当时写入（只读回执）');
  });
  await segment(page, `${label}-correct-saved-expense`, async () => {
    if (!new URL(page.url()).search.includes('receipt=')) { await back(page, new URL(page.url()).pathname); await waitPath(page, '/quick-note/result'); }
    await pointer(page, `a[href="/expense?record=${expense.id}"]`); await waitPath(page, '/expense');
    assert.equal(await page.$eval('#expense-amount', el => Number(el.value)), 15);
    await fill(page, '#expense-amount', '16.25'); await fill(page, '#expense-name', 'Synthetic 已核对午饭');
    await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const changedLocal = await settledRows(page, api), changed = changedLocal.expenses.find(row => row.id === expense.id), changedRemote = (await api('/expenses')).expenses;
    await saveRecordEvidence(`${label}-expense-corrected`, changedLocal, { expenses: changedRemote }, { expenses: [expense.id] });
    await observe(page, `${label}-expense-correction-cloud-ack`, changedLocal.outbox.length === 0 && changedLocal.expenses.length === 1 && changedRemote.length === 1 && changedRemote[0].id === expense.id && changedRemote[0].amount === 1625 && changedRemote[0].name === 'Synthetic 已核对午饭', 'No extra record; exact server correction and ACK');
    await observe(page, `${label}-expense-page-current-vs-history`, !(await state(page)).text.includes('当日/累计支出¥0') && !(await state(page)).text.includes('已记录支出 ¥0.00'), 'Stale coach snapshots must not be presented as current spending beside the actual edited amount');
    await observe(page, `${label}-expense-correction-exact-cents`, changed?.amount === 1625 && changed.name === 'Synthetic 已核对午饭', 'Same record updates to exact fen, without another expense');
    await pointer(page, 'summary', '查看收支统计与历史提示');
    await observe(page, `${label}-historical-insight-explicit-snapshot`, (await state(page)).text.includes('生成时的快照，不会随新记录更新'), 'Optional historical advice remains available with a timestamp and explicit non-current meaning');
    const moneyUnclipped = await page.$$eval('[aria-label*="支出人民币"]', rows => rows.length === 3 && rows.every(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis' && el.innerText.includes('16.25'); }));
    await observe(page, `${label}-stat-amount-layout-unclipped`, moneyUnclipped, 'DOM layout check only: three amounts retain cents without horizontal clipping; viewport evidence follows separately');
    for (const [index, period] of ['今日', '本周', '本月'].entries()) {
      const selector = `[aria-label="${period}支出人民币16.25元"]`;
      await page.bringToFront();
      for (let attempt = 0; attempt < 6; attempt++) {
        const geometry = await page.$eval(selector, el => { const rect = el.parentElement.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, center: rect.top + rect.height / 2, width: innerWidth, height: innerHeight }; });
        if (geometry.top >= 80 && geometry.bottom <= geometry.height - 100) break;
        const deltaY = geometry.center - geometry.height / 2;
        await page.mouse.move(geometry.width * 0.75, geometry.height / 2);
        await page.mouse.wheel({ deltaY });
        actions.push({ kind: 'native-wheel-read-stat', period, deltaY });
        await sleep(350);
      }
      const readable = await page.$eval(selector, el => { const rect = el.parentElement.getBoundingClientRect(), amount = el.getBoundingClientRect(); return rect.top >= 80 && rect.bottom <= innerHeight - 100 && rect.left >= 0 && rect.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis' && el.innerText === '¥16.25' && el.contains(document.elementFromPoint(amount.x + amount.width / 2, amount.y + amount.height / 2)); });
      await observe(page, `${label}-stat-${index + 1}-actual-reading-viewport`, readable, `${period}: normal scrolling brings the label and complete ¥16.25 amount into the captured viewport`);
    }
    await observe(page, `${label}-next-action-clears-own-success-overlay`, !(await page.$eval('[aria-label="通知"]', el => el.innerText)).includes('已存本机：支出'), 'Opening optional analysis also clears obsolete success overlay on the same page; warnings/errors are retained');
    await pointer(page, 'summary', '查看收支统计与历史提示');
    await back(page, '/expense'); await waitPath(page, '/quick-note/result');
  });
  await segment(page, `${label}-whole-class-and-optional-inference`, async () => {
    if (!new URL(page.url()).search.includes('receipt=')) { await back(page, new URL(page.url()).pathname); await waitPath(page, '/quick-note/result'); }
    await pointer(page, 'button', '再记一条'); await waitPath(page, '/quick-note');
    await observe(page, `${label}-old-success-not-on-new-draft`, !(await page.$eval('[aria-label="通知"]', el => el.innerText)).includes('已存本机：支出'), 'A previous expense success notice must not claim or cover the next unsaved capture');
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
  const historyExpanded = await page.waitForFunction(() => document.body.innerText.includes('78/78'), { timeout: 7000 }).then(() => true).catch(() => false);
  await observe(page, 'Y2-all-history-reachable', historyExpanded, 'All 70 expenses + 7 diaries + completion are reachable through continuation');
  await segment(page, 'Y2-old-expense-correct-and-return', async () => {
    const target = expenses.find(row => row.amount === 1065), selector = 'button[aria-label="收支: -¥10.65 Synthetic 同名午饭"]';
    const handle = await visibleHandle(page, selector); await handle.scrollIntoView(); await handle.dispose(); await sleep(300); const before = await state(page); await capture(page, 'Y2-expense-origin-viewport');
    await pointer(page, selector); await waitPath(page, '/expense'); await observe(page, 'Y2-old-expense-exact', await selectedDetail(page, { content: target.name, date: target.date, amount: '10.65' }), 'Correct target among same-named records, including exact date and cents');
    await fill(page, '#expense-name', 'Synthetic 已修正历史账单'); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const changedLocal = await settledRows(page, api), changed = changedLocal.expenses.find(row => row.id === target.id), remote = (await api('/expenses')).expenses;
    await saveRecordEvidence('Y2-near-week-expense-corrected', changedLocal, { expenses: remote }, { expenses: [target.id] });
    await observe(page, 'Y2-old-expense-local-correction', changedLocal.expenses.length === 70 && changed?.date === target.date && changed.name === 'Synthetic 已修正历史账单', 'Exact local ID/date, count unchanged');
    await observe(page, 'Y2-old-expense-cloud-ack', changedLocal.outbox.length === 0 && remote.length === 70 && remote.some(row => row.id === target.id && row.date === target.date && row.name === 'Synthetic 已修正历史账单'), 'Each old expense edit also verified on actual server');
    await back(page, '/expense'); await waitPath(page, '/timeline'); const returned = await state(page);
    await observe(page, 'Y2-history-return-retains-page-position', Math.abs(returned.scroll.y - before.scroll.y) < 40 && returned.text.includes('Synthetic 已修正历史账单'), `Original ${before.scroll.y}px, return ${returned.scroll.y}px; continuation retained`);
  });
  await segment(page, 'Y2-old-diary-correct-and-return', async () => {
    if (await page.$('[role=dialog]')) { await pointer(page, '[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true }); }
    if (new URL(page.url()).pathname !== '/timeline') { await nav(page, '时间线'); await waitPath(page, '/timeline'); }
    const target = diaries.find(row => row.date === businessDate(-3)); await pointer(page, `button[aria-label=${JSON.stringify(`日记: ${target.content.slice(0, 80)}`)}]`); await waitPath(page, '/diary');
    await observe(page, 'Y2-old-diary-real-date-unknown-mood', await page.$eval('#diary-content', el => el.value) === target.content && (await state(page)).text.includes(`${target.date} 的心情`) && !(await state(page)).text.includes('今天的心情'), 'Exact old object and its date shown; unknown mood is not five');
    const corrected = `Synthetic 已修正 · ${target.content}`; await fill(page, '#diary-content', corrected); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const afterDiary = await settledRows(page, api); const saved = (await api(`/diary/${target.id}`)).diary;
    await saveRecordEvidence('Y2-diary-corrected', afterDiary, { diaries: [saved] }, { diaries: [target.id] });
    await observe(page, 'Y2-diary-cloud-ack', afterDiary.outbox.length === 0 && afterDiary.diary.length === 7, 'Diary acknowledgment and unchanged count checked independently');
    await writeFile(join(artifacts, 'Y2-corrected-diary.json'), JSON.stringify({ expectedId: target.id, expectedDate: target.date, expectedContent: corrected, actual: saved }, null, 2));
    await observe(page, 'Y2-diary-same-id-date-server', saved.content === corrected && saved.date === target.date && saved.moodScore === null, 'Actual server row retains ID/date and unknown emotion');
    await back(page, '/diary'); await waitPath(page, '/timeline'); await observe(page, 'Y2-diary-return-corrected-source', (await state(page)).text.includes('Synthetic 已修正'), 'Return sees the corrected source');
  });
  await segment(page, 'Y2-older-than-month-complete-task', () => retrieveOlderThanMonth(page, api, expenses.length + diaries.length + 1));
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
  const clockArguments = habitClock ? ['--import', join(root, 'scripts', 'audit-clock.mjs')] : [];
  const clockEnvironment = habitClock ? { YOUTRACE_AUDIT_CLOCK_PRELOAD: 'habit-outcomes-v1', YOUTRACE_AUDIT_CLOCK_ISO: habitClock.instant, YOUTRACE_AUDIT_CLOCK_WALL_MS: String(habitClock.wallMs) } : {};
  launch(process.execPath, [...clockArguments, 'dist/index.js'], join(root, 'server'), clockEnvironment);
  launch(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(frontPort), '--strictPort'], root);
  await ready(`http://127.0.0.1:${apiPort}/health`); await ready(origin);
  let executablePath = process.env.AUDIT_BROWSER_PATH;
  if (!executablePath) for (const path of ['/usr/bin/google-chrome', '/usr/bin/chromium']) { try { await access(path); executablePath = path; break; } catch {} }
  assert.ok(executablePath, 'An installed Chromium is required');
  browser = await puppeteer.launch({ executablePath, headless: true, ...(taskSet.startsWith('preferences-') || taskSet.startsWith('expense-') || taskSet.startsWith('diary-') ? { protocolTimeout: 30000 } : {}), args: process.env.CI ? ['--no-sandbox'] : [] }); metadata.browser = await browser.version();
  if (taskSet.startsWith('diary-')) {
    const { media } = await runDiaryOutcomes({ isolated, login, waitPath, apiFor, capture, observe, sleep, actions, infrastructure, artifacts, writeFile, join, origin, checkpoint, surfaceNames, clock: diaryClock }, { scenarioSet: taskSet.slice('diary-'.length) });
    for (const name of media) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
  } else if (taskSet.startsWith('expense-')) {
    const { media } = await runExpenseOutcomes({ isolated, login, waitPath, apiFor, capture, observe, sleep, actions, infrastructure, artifacts, writeFile, join, origin, checkpoint, surfaceNames, clock: expenseClock }, { scenarioSet: taskSet.slice('expense-'.length) });
    for (const name of media) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
  } else if (taskSet.startsWith('preferences-')) {
    const { media, peerMedia } = await runPreferenceOutcomes({ isolated, capture, observe, sleep, actions, infrastructure, artifacts, writeFile, join, origin, checkpoint, surfaceNames }, { branch: taskSet.slice('preferences-'.length) });
    for (const name of media) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
    for (const name of peerMedia) assert.ok((await stat(join(artifacts, `${name}.webm`))).size > 0, 'Second preference profile requires its own video and target identity in the scenario browser-global trace');
  } else if (taskSet === 'startup-recovery') {
    const media = await runStartupRecoveryOutcomes({ isolated, capture, observe, sleep, actions, infrastructure, artifacts, writeFile, join, origin, checkpoint });
    for (const name of media) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
  } else if (taskSet === 'initial-session') {
    const media = await runInitialSessionOutcomes({ isolated, capture, observe, sleep, actions, infrastructure, artifacts, writeFile, join, origin, checkpoint });
    for (const name of media) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
  } else if (taskSet.startsWith('habits')) {
    const media = await runHabitOutcomes({ isolated, login, pointer, fill, dateInput, waitPath, state, capture, observe, segment, apiFor, localRows, settledRows, saveRecordEvidence, sleep, actions, artifacts, writeFile, join, surfaceNames, habitClock }, { frequencyOnly: taskSet === 'habits-frequency' });
    for (const name of media) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
  } else if (taskSet.startsWith('legacy-goals-')) {
    const { media, peerMedia } = await runLegacyGoalOutcomes({ isolated, login, waitPath, capture, observe, segment, apiFor, sleep, actions, artifacts, writeFile, join, surfaceNames, origin }, { scenarioSet: taskSet === 'legacy-goals-enrollment' ? 'enrollment' : 'source' });
    for (const name of media) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
    for (const name of peerMedia) assert.ok((await stat(join(artifacts, `${name}.webm`))).size > 0, 'Opened comparison peer requires its video; its target identity is recorded in the continuous scenario trace');
  } else if (taskSet === 'goals') {
    const media = await runGoalOutcomes({ isolated, login, pointer, fill, dateInput, waitPath, state, capture, observe, segment, apiFor, localRows, settledRows, saveRecordEvidence, businessDate, sleep, actions, artifacts, writeFile, join, surfaceNames });
    for (const name of media) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
  } else if (taskSet === 'planning') {
    const peerMedia = await runPlanningOutcomes({ isolated, login, pointer, fill, dateInput, waitPath, state, capture, observe, segment, apiFor, localRows, settledRows, saveRecordEvidence, businessDate, sleep, actions, artifacts, writeFile, join, surfaceNames, infrastructure, traffic, checkpoint });
    for (const name of ['Y4-plan-and-adapt-1280', 'Y4-plan-and-adapt-360']) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
    for (const name of peerMedia) assert.ok((await stat(join(artifacts, `${name}.webm`))).size > 0, 'Opened peer requires its video; both targets share the original continuous browser trace');
  } else if (taskSet === 'coach') {
    await runCoachOutcomes({ isolated, login, pointer, fill, waitPath, state, capture, observe, segment, apiFor, localRows, settledRows, saveRecordEvidence, businessDate, sleep, actions, artifacts, writeFile, join });
    for (const name of ['Y3-sparse-history-360', 'Y3-observation-action-1280', 'Y3-observation-action-360']) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
  } else {
  await isolated('Y1-first-value-1280', { width: 1280, height: 900 }, firstValue);
  await isolated('Y2-retrieve-past-1280', { width: 1280, height: 900 }, retrievePast);
  await isolated('Y1N-first-value-360', { width: 360, height: 800 }, page => firstValue(page, true));
  await isolated('YF-storage-recovery-1280', { width: 1280, height: 900 }, recoverStorage);
  await isolated('YN-mobile-discovery-360', { width: 360, height: 800 }, mobileDiscoveryAndCreation);
  await isolated('YR-receipt-reread-1280', { width: 1280, height: 900 }, receiptReadFailureAfterUpdate);
  for (const name of ['YN-mobile-discovery-360', 'YR-receipt-reread-1280', 'Y1-first-value-1280', 'Y2-retrieve-past-1280', 'Y1N-first-value-360', 'YF-storage-recovery-1280']) for (const suffix of ['.webm', '-trace.json']) assert.ok((await stat(join(artifacts, `${name}${suffix}`))).size > 0, `Missing ${name}${suffix} evidence`);
  assert.ok((await stat(join(artifacts, 'YR-peer-edit-1280.webm'))).size > 0, 'Missing peer video; both pages share the continuous YR browser trace');
  }
} catch (error) { infrastructure.push({ fatal: error.message }); process.exitCode = 2; }
finally {
  if (browser) await browser.close();
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? undefined : new Promise(resolve => child.once('exit', resolve))));
  metadata.endedAt = new Date().toISOString();
  metadata.sourceEnd = await sourceSnapshot();
  if (metadata.sourceStart.trackedContentSha256 !== metadata.sourceEnd.trackedContentSha256 || metadata.sourceStart.dirty || metadata.sourceEnd.dirty) infrastructure.push({ sourceChangedOrDirty: true });
  await writeFile(join(artifacts, 'outcome-report.json'), JSON.stringify({ metadata, results, actions, traffic, infrastructure }, null, 2));
  await writeFile(join(artifacts, 'README.txt'), 'Scripted user-outcome evidence, pending independent product review. Read outcome-report.json; observed-fail means a product gap, blocked means the step did not complete. Videos and Chrome performance traces cover successful and failed operations. All data are synthetic. Initial login URL and explicit historical API setup are identified separately; business navigation uses rendered controls. No live model, SMS or production data.\n');
  await rm(scratch, { recursive: true, force: true });
}
if (infrastructure.some(item => typeof item === 'object')) process.exitCode = 2;
if (!process.exitCode && results.some(row => row.status === 'observed-fail' || row.status === 'blocked')) process.exitCode = 1;
