// Hosted-CI-only native startup/recovery RED baseline. All persistent records
// and credentials come from real controls; faults are explicitly SYNTHETIC.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { createInitializationObserver } from './audit-initialization-observer.mjs';
import { waitForStableModalTarget } from './audit-legacy-goal-outcomes.mjs';
import { readExistingAccount, initialSessionChecks } from './audit-initial-session-outcomes.mjs';
import { installStartupReadFault } from './audit-startup-read-fault.mjs';
import { assertStartupChronology, assertStartupViewWitness } from './audit-startup-chronology.mjs';
export const STARTUP_RECOVERY_PATH = '/todo?view=all';
export const STARTUP_RECOVERY_CASES = [
  { branch: 'late-recovery', width: 1280, height: 900, phone: '13900008701', nickname: 'Synthetic 迟到1280' },
  { branch: 'both-fail', width: 1280, height: 900, phone: '13900008702', nickname: 'Synthetic 双败1280' },
  { branch: 'late-recovery', width: 360, height: 800, phone: '13900008703', nickname: 'Synthetic 迟到360' },
  { branch: 'both-fail', width: 360, height: 800, phone: '13900008704', nickname: 'Synthetic 双败360' },
];
const { acknowledged, retained, todoRowsFromLedger } = initialSessionChecks;
const table = (snapshot, name) => snapshot.tables.find(row => row.name === name);
const epoch = snapshot => table(snapshot, 'settings').rows.filter(row => row.key === 'localDataEpoch');
const sameEpoch = (before, after) => isDeepStrictEqual(epoch(before), epoch(after));
const editorDrafts = snapshot => table(snapshot, 'settings').rows.filter(row => row.key.startsWith('record-draft:todo:'));
const sourceWitness = snapshot => ({ todoId: table(snapshot, 'todos').rows[0]?.id, databaseName: snapshot.databaseName, epochPresent: epoch(snapshot).length === 1, epoch: epoch(snapshot)[0]?.value ?? null });
const preferencesSettled = snapshot => { const state = table(snapshot, 'settings').rows.find(row => row.key === 'accountPreferences:state:v1')?.value; return Boolean(state?.server && state.active === null && state.queued === null); };

export async function runStartupRecoveryOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Startup-recovery native journey is hosted-CI only');
  const { isolated, capture, observe, sleep, actions, infrastructure, artifacts, writeFile, join, origin, checkpoint } = h;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'Disposable synthetic origin only');
  const media = [], runs = [];
  await writeFile(join(artifacts, 'YS-scope.json'), JSON.stringify({ kind: 'startup-recovery-native-RED-baseline', applicationBaseline: 'e723af607e3cad830395d24c50c31f0d76ab2be0', syntheticOnly: true, cases: STARTUP_RECOVERY_CASES, requestedPath: STARTUP_RECOVERY_PATH, faults: 'Bounded SYNTHETIC business API offline after actual auth/me200; real native readonly transactions kept alive then normally released/aborted. No data changes, fabricated request success or application Promise interception.', deadlineMs: { scenario: 105000, appUnchanged: 12000, faults: 45000, GET: 5000, idb: 5000 }, browserExecution: 'Native CI run started; authoritative completion/failure results are in YS-media.json and each scenario-result.json' }, null, 2));

  for (const config of STARTUP_RECOVERY_CASES) {
    const label = `YS-${config.branch}-${config.width}`, directory = join(artifacts, 'startup-recovery', label);
    await mkdir(directory, { recursive: true }); media.push(label);
    const run = { label, branch: config.branch, width: config.width, status: 'not-started', steps: [], firstFailure: null };
    runs.push(run);
    try { await isolated(label, { width: config.width, height: config.height }, async page => {
      const trace = createInitializationObserver();
      let stage = 'install-observer', stopped = false, firstFailure = false, verifiedOwner, beforeFacts, faultScript, faultInstalled = false;
      const assertActive = () => { assert.equal(stopped, false, 'Scenario deadline ended; no later action is allowed'); };
      const save = (name, value) => writeFile(join(directory, `${name}.json`), JSON.stringify(value, null, 2));
      const setStage = async name => { assertActive(); stage = name; run.steps.push({ stage: name, at: new Date().toISOString() }); await checkpoint(`${label}: ${stage}`, { startupRecoveryRuns: runs }); };
      const get = async (path, afterFailure = false) => {
        if (!afterFailure) assertActive(); assert.ok(path === '/api/auth/me' || /^\/api\/sync\/pull\?protocol=2&features=goals-v1&cursor=\d+&limit=500$/.test(path), 'Evidence is restricted to declared GET-only endpoints');
        actions.push({ kind: 'GET-only-startup-recovery-evidence', surface: label, endpoint: path.split('?')[0] });
        return page.evaluate(async path => { const response = await fetch(path, { method: 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(5000) }); return { status: response.status, body: await response.json() }; }, path);
      };
      const exact = async (selector, text) => {
        assertActive();
        await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (text === undefined || el.textContent.trim() === text); }).length === 1, { timeout: 18000 }, { selector, text });
        return page.evaluate(({ selector, text }) => {
          const matches = [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (text === undefined || el.textContent.trim() === text); });
          if (matches.length !== 1) throw new Error('Rendered target changed before observation');
          const parts = []; for (let el = matches[0]; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(node => node.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
          return 'body > ' + parts.join(' > ');
        }, { selector, text });
      };
      const read = async (selector, text) => {
        const resolved = await exact(selector, text);
        for (let attempt = 0; attempt < 20; attempt++) {
          assertActive(); const box = await page.evaluate(initialSessionGeometry, resolved);
          assert.ok(box.unique, 'Actual target changed before reading');
          if (box.visible) return { resolved, box };
          const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, config.height - 20));
          const deltaY = box.rect.y + box.rect.height / 2 - y;
          if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-startup-recovery', surface: label, selector, text, x, y, deltaY, clip: box.clip, scroller: box.scroller }); }
          await sleep(125);
        }
        throw new Error(`Control stayed clipped, unpainted, obscured or truncated: ${selector}`);
      };
      const tap = async (selector, text) => {
        assertActive(); await page.bringToFront(); const initial = await read(selector, text), { resolved } = initial;
        await page.mouse.move(initial.box.rect.x + initial.box.rect.width / 2, initial.box.rect.y + initial.box.rect.height / 2);
        // Same stable-target observer as the corrected legacy-modal driver;
        // apply it to all controls so login transitions are also observed.
        const stability = await page.evaluate(waitForStableModalTarget, resolved, 2500);
        const box = await page.evaluate(initialSessionGeometry, resolved);
        assert.ok(box.visible && Object.keys(stability.box).every(key => box.rect[key] === stability.box[key]), 'Stable target must still be painted, unclipped and foreground');
        assert.equal(await page.$eval(resolved, el => el.matches(':disabled')), false, 'Disabled control is not an action');
        const x = box.rect.x + box.rect.width / 2, y = box.rect.y + box.rect.height / 2;
        await page.mouse.move(x, y);
        const atPointer = await page.evaluate(initialSessionGeometry, resolved);
        assert.ok(atPointer.visible && Object.keys(stability.box).every(key => atPointer.rect[key] === stability.box[key]), 'Target moved before the single native click');
        assertActive(); await page.mouse.click(x, y);
        actions.push({ kind: 'native-pointer-startup-recovery', surface: label, selector, text, x, y, clip: box.clip, stability });
      };
      const fill = async (selector, text) => {
        const key = async (operation, value) => { assertActive(); await page.keyboard[operation](value); };
        await tap(selector); await key('down', 'Control'); await key('press', 'A'); await key('up', 'Control'); await key('press', 'Backspace'); await key('sendCharacter', text);
        assert.equal(await page.$eval(selector, el => el.value), text, 'Exact synthetic input must remain');
        actions.push({ kind: 'native-text-startup-recovery', surface: label, selector, ...(selector === '#login-code' ? { syntheticOTP: true } : { syntheticText: text }) });
      };
      const path = async expected => {
        assertActive(); await page.waitForFunction(expected => location.pathname + location.search === expected, { timeout: 18000 }, expected);
        actions.push({ kind: 'exact-path-observed', surface: label, expected });
      };
      const pass = async (name, condition, detail) => { assertActive(); await observe(page, `${label}-${name}`, condition, detail); assert.ok(condition, `Required outcome failed: ${name}`); };
      const loginVisible = async () => { await path('/login'); const phone = await read('#login-phone'); const heading = await read('h2', '登录 / 注册'); await pass(`${stage}-readable-login`, phone.box.visible && heading.box.visible, JSON.stringify({ phone: phone.box, heading: heading.box })); };
      const response = (endpoint, method) => page.waitForResponse(value => new URL(value.url()).pathname === `/api${endpoint}` && value.request().method() === method, { timeout: 18000 });
      const submit = async (selector, text, endpoint) => {
        const pending = response(endpoint, 'POST').then(value => ({ value }), error => ({ error }));
        await tap(selector, text); const result = await pending;
        if (result.error) throw result.error;
        assert.ok(result.value.ok(), `Native ${endpoint} request must succeed`); return result.value;
      };
      const otp = async existing => {
        await setStage(existing ? 'existing-account-OTP' : 'native-registration');
        await fill('#login-phone', config.phone);
        const sent = await (await submit('button', '获取验证码', '/auth/send-code')).json();
        assert.match(sent.devCode ?? '', /^\d{6}$/, 'Require synthetic backend devOTP');
        await fill('#login-code', sent.devCode);
        const verification = await submit('button', '验证', '/auth/verify');
        // Existing-account verification replaces the document. CDP may no longer
        // retain that old response body; the actual HTTP200, requested route,
        // GET-confirmed owner and complete original record/ledger are required below.
        if (existing) return;
        const verified = await verification.json();
        assert.equal(verified.needRegister, true, 'Fresh synthetic account must require registration');
        await read('#login-nickname');
        const nicknameLimit = await page.$eval('#login-nickname', el => el.maxLength);
        assert.ok(nicknameLimit < 0 || config.nickname.length <= nicknameLimit, 'Declared synthetic nickname must fit the visible registration limit');
        await fill('#login-nickname', config.nickname); await submit('button', '开始使用', '/auth/register');
      };
      const navigate = async (destination, labelText) => {
        if (config.width === 360) { await tap('nav[aria-label="主导航"] button[aria-label="全部功能"]'); await path('/more'); await tap(`nav[aria-label="全部功能"] a[href="${destination}"]`); }
        else await tap('aside nav button', labelText);
        await path(destination);
      };
      const local = async owner => { assertActive(); return page.evaluate(readExistingAccount, owner); };
      const ledger = async (afterFailure = false) => {
        const events = []; let cursor = '0';
        for (let count = 0; count < 10; count++) {
          const result = await get(`/api/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`, afterFailure);
          assert.equal(result.status, 200, 'Actual authenticated GET ledger required'); const body = result.body;
          assert.equal(body.protocol, 2); assert.ok(body.features?.includes('goals-v1')); assert.ok(Array.isArray(body.events));
          events.push(...body.events); todoRowsFromLedger(events);
          assert.equal(body.nextCursor, events.at(-1)?.seq ?? '0', 'Read all ledger pages without skipping');
          assert.equal(typeof body.hasMore, 'boolean'); if (!body.hasMore) return events;
          assert.notEqual(body.nextCursor, cursor); cursor = body.nextCursor;
        }
        throw new Error('GET-only ledger exceeded bounded pagination');
      };
      const facts = async (owner, afterFailure = false) => ({ owner, local: afterFailure ? await page.evaluate(readExistingAccount, owner) : await local(owner), events: await ledger(afterFailure) });
      const verifyOwner = async expected => { const result = await get('/api/auth/me'); assert.equal(result.status, 200); assert.ok(typeof result.body.user?.id === 'string'); if (expected) assert.equal(result.body.user.id, expected); return result.body.user.id; };
      const faultSnapshot = () => page.evaluate(() => globalThis.__youtraceSyntheticStartupFault?.snapshot() ?? null);
      const faultCommand = (operation, ...args) => page.evaluate(({ operation, args }) => {
        const control = globalThis.__youtraceSyntheticStartupFault;
        if (!control || !['finish', 'release'].includes(operation)) throw new Error('Missing declared synthetic fault controller');
        return control[operation](...args);
      }, { operation, args });
      const faultWait = async predicate => {
        assertActive();
        await page.waitForFunction(predicate, { timeout: 18000 });
        const current = await faultSnapshot(); assert.equal(current.violation, null); assert.equal(current.expired, false);
        return current;
      };
      // A dedicated version passes serializable arguments; no app methods run.
      const waitApp = async (phase, outcome) => {
        assertActive();
        await page.waitForFunction(({ phase, outcome }) => globalThis.__youtraceSyntheticStartupFault.snapshot().events.some(row => row.kind === 'application-initialization' && row.stage === 'initialization' && row.phase === phase && row.outcome === outcome), { timeout: 18000 }, { phase, outcome });
      };
      const releaseFaults = async reason => {
        if (faultScript) { await page.removeScriptToEvaluateOnNewDocument(faultScript.identifier); faultScript = null; }
        if (faultInstalled) { await faultCommand('release', reason); await save('faults-released', await faultSnapshot()); }
      };
      const verifyRetained = async (name, owner, title) => {
        const after = await facts(owner); await save(name, after);
        const original = table(beforeFacts.local, 'todos').rows[0];
        await pass(name, acknowledged(after, title) && retained(beforeFacts.local, after.local) && isDeepStrictEqual(beforeFacts.events, after.events) && original.id === table(after.local, 'todos').rows[0]?.id && sameEpoch(beforeFacts.local, after.local), 'Same original Todo/fields/ID, full ledger, receipt/version and whole outbox; same account DB/schema and local data epoch. Other tables are retained as evidence, not asserted byte-identical.');
      };
      const journey = async () => {
        run.status = 'running'; await trace.observeInitialization(page);
        await setStage('native-registration-setup');
        actions.push({ kind: 'declared-initial-public-navigation', surface: label, path: '/login' });
        await page.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 18000 });
        await loginVisible(); await otp(false); await path('/onboarding');
        for (let index = 0; index < 4; index++) { await read('h1'); await capture(page, `${label}-onboarding-${index + 1}`); await tap('button', index < 3 ? '下一步' : '开始使用'); await sleep(650); }
        await path('/'); const owner = await verifyOwner(); verifiedOwner = owner;
        await setStage('native-create-Todo'); await navigate('/todo', '待办');
        const title = `Synthetic 启动${config.width}`;
        await tap('button[aria-label="新建待办"]'); await fill('[role=dialog] #todo-text', title); await tap('[role=dialog] button', '无日期'); await tap('[role=dialog] button', '保存');
        await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 10000 });
        await setStage('original-Todo-ACK');
        for (let attempt = 0; attempt < 30; attempt++) { beforeFacts = await facts(owner); if (acknowledged(beforeFacts, title) && preferencesSettled(beforeFacts.local)) break; await sleep(250); }
        const original = table(beforeFacts.local, 'todos').rows[0];
        const editor = `button[aria-label="编辑待办 ${title} 无日期"]`;
        await read(editor); await save('original-ACK', beforeFacts);
        await pass('original-full-ACK', acknowledged(beforeFacts, title) && preferencesSettled(beforeFacts.local), 'Native-created original Todo is exactly cloud-ACKed before the synthetic startup disturbance');
        // New-document instrumentation is installed before Dexie opens the DB;
        // Dexie captures the native transaction method while opening.
        faultScript = await page.evaluateOnNewDocument(`globalThis.__youtraceSyntheticStartupFault = (${installStartupReadFault.toString()})(${JSON.stringify({ databaseName: beforeFacts.local.databaseName, branch: config.branch })});`);
        await setStage('declared-full-document-startup');
        actions.push({ kind: 'declared-startup-full-navigation', surface: label, path: STARTUP_RECOVERY_PATH, syntheticFault: config.branch, sourceTodoId: original.id });
        trace.boundary(page, 'route-start', '/todo');
        faultInstalled = true; await page.goto(origin + STARTUP_RECOVERY_PATH, { waitUntil: 'domcontentloaded', timeout: 18000 });
        await faultWait(() => globalThis.__youtraceSyntheticStartupFault.snapshot().holds.some(row => row.target === 'initial'));
        await save('initial-read-held', await faultSnapshot());
        await setStage('real-twelve-second-timeout');
        await waitApp('initial', 'timeout');
        await faultWait(() => globalThis.__youtraceSyntheticStartupFault.snapshot().holds.some(row => row.target === 'recovery'));
        await save('overlapping-readonly-attempts', await faultSnapshot());
        if (config.branch === 'late-recovery') {
          await setStage('delayed-initial-success'); await faultCommand('finish', 'initial', 'complete'); await waitApp('initial', 'success');
          await path(STARTUP_RECOVERY_PATH); await read('main h1', '待办'); await read('button[aria-label="新建待办"]');
          const editorRead = await read(editor);
          const rowSelector = await page.evaluate(id => '#' + CSS.escape(`todo-record-${id}`), original.id);
          const rowRead = await read(rowSelector);
          const renderedIdentity = await page.evaluate(({ rowSelector, editor }) => {
            const rows = [...document.querySelectorAll(rowSelector)], editors = [...document.querySelectorAll(editor)];
            const row = rows[0], button = editors[0], containerId = row?.id ?? null;
            return { rowCount: rows.length, editorCount: editors.length, containerId, todoId: containerId?.startsWith('todo-record-') ? containerId.slice('todo-record-'.length) : null, editorContainerId: button?.closest('[id^="todo-record-"]')?.id ?? null };
          }, { rowSelector, editor });
          const visibleFault = await faultSnapshot();
          const visible = { ...renderedIdentity, rowVisible: rowRead.box.visible, editorVisible: editorRead.box.visible, readable: rowRead.box.visible && editorRead.box.visible, sequence: visibleFault.events.at(-1).sequence };
          assertStartupViewWitness(visible, original.id);
          await save('initial-view-readable-before-abort', { witness: visible, fault: visibleFault });
          await capture(page, `${label}-original-readable-before-late-abort`);
          await setStage('late-recovery-native-abort'); await faultCommand('finish', 'recovery', 'abort'); await waitApp('recovery', 'error');
          await faultWait(() => globalThis.__youtraceSyntheticStartupFault.snapshot().holds.every(row => row.terminal));
          const fault = await faultSnapshot(); await save('complete-fault-chronology', fault); assertStartupChronology(fault, visible, sourceWitness(beforeFacts.local));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          // Immediate post-failure observation preserves the real first broken
          // view instead of waiting for another unrelated request to repair it.
          const visibleAfter = await page.evaluate(({ editor, id }) => ({ title: [...document.querySelectorAll('main h1')].some(el => el.textContent === '待办'), row: Boolean(document.getElementById(`todo-record-${id}`)), editor: Boolean(document.querySelector(editor)), newTodo: Boolean(document.querySelector('button[aria-label="新建待办"]')), error: [...document.querySelectorAll('p')].some(el => el.textContent === '加载遇到问题') }), { editor, id: original.id });
          await save('view-after-late-failure', visibleAfter);
          await pass('late-failure-retains-usable-view', visibleAfter.title && visibleAfter.row && visibleAfter.editor && visibleAfter.newTodo && !visibleAfter.error, 'A late failed overlapping recovery must not retract the earlier successful original Todo view');
          await read('main h1', '待办'); await read(editor); await read('button[aria-label="新建待办"]');
          await releaseFaults('explicit-before-usability-check');
          const beforeEditor = await local(owner);
          await setStage('actual-open-and-cancel-original'); await tap(editor); await read('[role=dialog] #todo-text');
          assert.equal(await page.$eval('[role=dialog] #todo-text', el => el.value), title);
          await capture(page, `${label}-original-opened-after-late-failure`);
          await tap('[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 10000 });
          await read(editor);
          const afterEditor = await local(owner);
          await save('editor-draft-observation', { scope: 'Actual open/cancel may legitimately retain local draft metadata; this is distinct from unchanged Todo/outbox/ledger', before: editorDrafts(beforeEditor), after: editorDrafts(afterEditor), changed: !isDeepStrictEqual(editorDrafts(beforeEditor), editorDrafts(afterEditor)) });
          await verifyOwner(owner); await verifyRetained('after-open-cancel-original-retained', owner, title);
        } else {
          await setStage('both-native-readonly-aborts');
          await faultCommand('finish', 'initial', 'abort'); await waitApp('initial', 'error');
          await faultCommand('finish', 'recovery', 'abort'); await waitApp('recovery', 'error');
          await faultWait(() => globalThis.__youtraceSyntheticStartupFault.snapshot().holds.every(row => row.terminal));
          const fault = await faultSnapshot(); await save('complete-fault-chronology', fault); assertStartupChronology(fault, undefined, sourceWitness(beforeFacts.local));
          await read('p', '加载遇到问题'); await read('button', '重试');
          await pass('both-failed-readable-error-and-Retry', true, 'Neither real attempt succeeded; the application itself renders readable error and native Retry');
          await releaseFaults('explicit-before-native-Retry');
          await verifyRetained('before-Retry-original-retained', owner, title);
          await setStage('actual-Retry-after-explicit-release');
          const navigated = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 18000 }).then(value => ({ value }), error => ({ error }));
          await tap('button', '重试'); const navigation = await navigated; if (navigation.error) throw navigation.error;
          faultInstalled = false;
          assert.equal(await page.evaluate(() => typeof globalThis.__youtraceSyntheticStartupFault), 'undefined', 'Retry document must have no synthetic fault installed');
          await path(STARTUP_RECOVERY_PATH); await read('main h1', '待办'); await read(editor); await read('button[aria-label="新建待办"]');
          await verifyOwner(owner); await verifyRetained('after-native-Retry-original-retained', owner, title);
        }
        run.status = 'completed';
      };
      const timerState = {}; const deadline = new Promise((_, reject) => { timerState.id = setTimeout(() => { stopped = true; reject(new Error('Startup-recovery scenario exceeded 105-second evidence deadline')); }, 105000); });
      try { await Promise.race([journey(), deadline]); }
      catch (error) {
        stopped = true; run.status = 'failed';
        if (!firstFailure) {
          firstFailure = true; run.firstFailure = { stage, name: error.name, detail: error.message, at: new Date().toISOString() };
          // Preserve the first safe chronology before any final-media work.
          await save('first-failure', { ...run.firstFailure, diagnosisBoundary: 'Synthetic known overlapping startup reads only; this does not establish the original b5b8a12 B/Todo failure cause', initialization: trace.firstFailureTrace(error) }).catch(() => { run.firstFailure.evidenceWriteFailed = true; });
          await capture(page, `${label}-FIRST-FAILURE-${stage}`).catch(() => { run.firstFailure.screenshotFailed = true; });
          if (faultInstalled) await save('first-failure-faults-before-release', await faultSnapshot()).catch(() => { run.firstFailure.faultSnapshotFailed = true; });
          await releaseFaults('first-failure-cleanup').catch(() => { run.firstFailure.faultCleanupFailed = true; });
          if (verifiedOwner) {
            try {
              const current = await facts(verifiedOwner, true);
              await save('first-failure-retained-account', { source: 'GET-only and existing-IDB readonly corroboration after explicit fault cleanup; no later business action', current, unchangedSinceACK: beforeFacts ? retained(beforeFacts.local, current.local) && sameEpoch(beforeFacts.local, current.local) : null, fullLedgerUnchangedSinceACK: beforeFacts ? isDeepStrictEqual(beforeFacts.events, current.events) : null });
            } catch { run.firstFailure.retainedAccountReadFailed = true; }
          }
        }
        throw error; // Existing isolated wrapper records blocked/nonzero, then continues next case.
      } finally {
        stopped = true; clearTimeout(timerState.id);
        await releaseFaults('scenario-finally').catch(() => { run.faultCleanupFailed = true; });
        await save('initialization-chronology', trace.firstFailureTrace(null));
        await save('scenario-result', run);
      }
    }); } catch (error) {
      // The driver closes this profile in finally even if recording finalization
      // fails. Keep that infrastructure failure separate and run the next case.
      run.status = 'harness-failed'; run.cleanupOrRecordingError = error.name;
      infrastructure.push({ scenario: label, startupRecoveryHarnessFailure: error.name });
      if (!actions.some(row => row.kind === 'isolated-profile-closed' && row.surface === label)) throw error;
    }
    run.profileClosed = actions.some(row => row.kind === 'isolated-profile-closed' && row.surface === label);
    assert.ok(run.profileClosed, 'Prior profile must be closed before starting another independent case');
    await writeFile(join(artifacts, 'YS-media.json'), JSON.stringify({ syntheticOnly: true, media, runs }, null, 2));
  }
  return media;
}
