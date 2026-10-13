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
  { branch: 'recovery-success', width: 1280, height: 900, phone: '13900008701', nickname: 'Synthetic 恢复1280' },
  { branch: 'both-fail', width: 1280, height: 900, phone: '13900008702', nickname: 'Synthetic 双败1280' },
  { branch: 'recovery-success', width: 360, height: 800, phone: '13900008703', nickname: 'Synthetic 恢复360' },
  { branch: 'both-fail', width: 360, height: 800, phone: '13900008704', nickname: 'Synthetic 双败360' },
];
const { acknowledged, retained, todoRowsFromLedger } = initialSessionChecks;
const table = (snapshot, name) => snapshot.tables.find(row => row.name === name);
const epoch = snapshot => table(snapshot, 'settings').rows.filter(row => row.key === 'localDataEpoch');
const sameEpoch = (before, after) => isDeepStrictEqual(epoch(before), epoch(after));
const editorDrafts = snapshot => table(snapshot, 'settings').rows.filter(row => row.key.startsWith('record-draft:todo:'));
const sourceWitness = snapshot => ({ todoId: table(snapshot, 'todos').rows[0]?.id, databaseName: snapshot.databaseName, epochPresent: epoch(snapshot).length === 1, epoch: epoch(snapshot)[0]?.value ?? null });
const goalMetadata = snapshot => table(snapshot, 'settings').rows.filter(row => /^(?:sync-(?:version|conflict):goals:|goal-)/.test(row.key));
export function startupGoalAcknowledged(facts, title, description) {
  const rows = table(facts.local, 'goalRecords').rows;
  if (rows.length !== 1) return false;
  const goal = rows[0], event = facts.events.filter(row => row.entity === 'goals' && row.entityId === goal.id).at(-1);
  const version = table(facts.local, 'settings').rows.find(row => row.key === `sync-version:goals:${goal.id}`)?.value;
  const fields = ['id', 'title', 'description', 'level', 'domain', 'priority', 'progress', 'targetDate', 'createdAt', 'updatedAt'];
  if (!fields.every(key => Object.hasOwn(goal, key) && event?.data && Object.hasOwn(event.data, key))) return false;
  const remoteTime = key => typeof event.data[key] === 'string' && Number.isFinite(Date.parse(event.data[key])) && new Date(event.data[key]).toISOString() === event.data[key] ? Date.parse(event.data[key]) : NaN;
  // createdAt is explicitly sent by goalSyncPayload. updatedAt is independently
  // assigned by the server; a push ACK does not rewrite the local timestamp.
  // Validate both, retain both full raw values, and never normalize the fixture.
  if (!['createdAt', 'updatedAt'].every(key => Number.isSafeInteger(goal[key]) && goal[key] >= 0 && Number.isFinite(remoteTime(key)))
    || remoteTime('createdAt') !== goal.createdAt || remoteTime('updatedAt') < remoteTime('createdAt') || goal.updatedAt < goal.createdAt) return false;
  return goal.title === title && goal.description === description && goal.progress === 0 && goal.targetDate === null && goal.syncScope === 'account'
    && event?.operation === 'upsert' && event.data?.id === goal.id && event.data?.userId === facts.owner
    && ['id', 'title', 'description', 'level', 'domain', 'priority', 'progress', 'targetDate'].every(key => isDeepStrictEqual(event.data[key], goal[key]))
    && typeof version === 'string' && /^[1-9]\d*$/.test(version) && version === event.seq
    && table(facts.local, 'outbox').rows.length === 0 && !goalMetadata(facts.local).some(row => row.key.startsWith('sync-conflict:'));
}
const goalsRetained = (before, after) => ['goalRecords', 'goals'].every(name => isDeepStrictEqual(table(before, name), table(after, name))) && isDeepStrictEqual(goalMetadata(before), goalMetadata(after));
const preferencesSettled = snapshot => { const state = table(snapshot, 'settings').rows.find(row => row.key === 'accountPreferences:state:v1')?.value; return Boolean(state?.server && state.active === null && state.queued === null); };

export async function runStartupRecoveryOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Startup-recovery native journey is hosted-CI only');
  const { isolated, capture, observe, sleep, actions, infrastructure, artifacts, writeFile, join, origin, checkpoint } = h;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'Disposable synthetic origin only');
  const media = [], runs = [];
  await writeFile(join(artifacts, 'YS-scope.json'), JSON.stringify({ kind: 'startup-recovery-required-snapshot-candidate', applicationBaseline: 'c3cb006a25949aae67c57874da4971aec5b5721f', syntheticOnly: true, cases: STARTUP_RECOVERY_CASES, requestedPath: STARTUP_RECOVERY_PATH, faults: 'Bounded SYNTHETIC business API offline after actual auth/me200; real native readonly transactions kept alive then normally released/aborted. No data changes, fabricated request success or application Promise interception.', deadlineMs: { scenario: 105000, appUnchanged: 12000, faults: 45000, GET: 5000, idb: 5000 }, browserExecution: 'Native CI run started; authoritative completion/failure results are in YS-media.json and each scenario-result.json' }, null, 2));

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
        assert.ok(goalsRetained(beforeFacts.local, after.local), 'Complete original Goal, old source and all Goal metadata stay exact');
        await pass(name, acknowledged(after, title) && retained(beforeFacts.local, after.local) && isDeepStrictEqual(beforeFacts.events, after.events) && original.id === table(after.local, 'todos').rows[0]?.id && sameEpoch(beforeFacts.local, after.local), 'Same original Goal and Todo/fields/IDs, full ledger, receipt/version and whole outbox; same account DB/schema and local data epoch. Other tables are retained as evidence, not asserted byte-identical.');
      };
      const journey = async () => {
        run.status = 'running'; await trace.observeInitialization(page);
        await setStage('native-registration-setup');
        actions.push({ kind: 'declared-initial-public-navigation', surface: label, path: '/login' });
        await page.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 18000 });
        await loginVisible(); await otp(false); await path('/onboarding');
        for (let index = 0; index < 4; index++) { await read('h1'); await capture(page, `${label}-onboarding-${index + 1}`); await tap('button', index < 3 ? '下一步' : '开始使用'); await sleep(650); }
        await path('/'); const owner = await verifyOwner(); verifiedOwner = owner;
        await setStage('native-create-Goal'); await navigate('/goal', '目标');
        const goalTitle = `Synthetic 启动目标${config.width}`, goalDescription = 'Synthetic 完整目标原文，初始手动进度为0';
        await tap('button[aria-label="新建目标"]');
        await fill('[role=dialog] input[placeholder="想完成什么？"]', goalTitle);
        await fill('[role=dialog] #goal-description', goalDescription);
        await tap('[role=dialog] button', '创建'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 10000 });
        for (let attempt = 0; attempt < 30; attempt++) { beforeFacts = await facts(owner); if (startupGoalAcknowledged(beforeFacts, goalTitle, goalDescription)) break; await sleep(250); }
        await pass('native-Goal-full-ACK', startupGoalAcknowledged(beforeFacts, goalTitle, goalDescription), 'One real Goal created by original controls, same ID and complete visible fields cloud-ACKed; 0 is its explicit default manual progress, not an unread fallback');
        await read('[data-component="goal-card"] h2', goalTitle); await read('[data-component="goal-card"] p', goalDescription);
        await setStage('native-create-Todo'); await navigate('/todo', '待办');
        const title = `Synthetic 启动${config.width}`;
        await tap('button[aria-label="新建待办"]'); await fill('[role=dialog] #todo-text', title); await tap('[role=dialog] button', '无日期'); await tap('[role=dialog] button', '保存');
        await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 10000 });
        await setStage('original-Todo-ACK');
        for (let attempt = 0; attempt < 30; attempt++) { beforeFacts = await facts(owner); if (acknowledged(beforeFacts, title) && startupGoalAcknowledged(beforeFacts, goalTitle, goalDescription) && preferencesSettled(beforeFacts.local)) break; await sleep(250); }
        const original = table(beforeFacts.local, 'todos').rows[0];
        const editor = `button[aria-label="编辑待办 ${title} 无日期"]`;
        await read(editor); await save('original-ACK', beforeFacts);
        await pass('original-full-ACK', acknowledged(beforeFacts, title) && startupGoalAcknowledged(beforeFacts, goalTitle, goalDescription) && preferencesSettled(beforeFacts.local), 'Native-created original Goal and Todo is exactly cloud-ACKed before the synthetic startup disturbance');
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
        if (config.branch === 'recovery-success') {
          await setStage('unpublished-initial-Goal-stays-failed'); await faultCommand('finish', 'initial', 'complete'); await waitApp('initial', 'error');
          await read('p', '加载遇到问题'); await read('button', '重试');
          assert.equal(await page.$('main h1'), null, 'Protected business content stays closed before a complete required snapshot');
          await save('initial-unpublished-stays-locked', await faultSnapshot());
          await setStage('complete-required-recovery'); await faultCommand('finish', 'recovery', 'complete'); await waitApp('recovery', 'success');
          await faultWait(() => globalThis.__youtraceSyntheticStartupFault.snapshot().holds.every(row => row.terminal));
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
          await save('complete-recovery-view-readable', { witness: visible, fault: visibleFault });
          await capture(page, `${label}-original-readable-after-complete-recovery`);
          const fault = await faultSnapshot(); await save('complete-fault-chronology', fault); assertStartupChronology(fault, visible, sourceWitness(beforeFacts.local));
          await pass('complete-recovery-opens-usable-view', true, 'Initial transaction completion without Goal publication stayed failed; only the complete recovery attempt opened the exact original Todo');
          await read('main h1', '待办'); await read(editor); await read('button[aria-label="新建待办"]');
          await releaseFaults('explicit-after-complete-recovery');
          const beforeEditor = await local(owner);
          await setStage('actual-open-and-cancel-original'); await tap(editor); await read('[role=dialog] #todo-text');
          assert.equal(await page.$eval('[role=dialog] #todo-text', el => el.value), title);
          await capture(page, `${label}-original-opened-after-complete-recovery`);
          await tap('[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 10000 });
          await read(editor);
          const afterEditor = await local(owner);
          await save('editor-draft-observation', { scope: 'Actual open/cancel may legitimately retain local draft metadata; this is distinct from unchanged Todo/outbox/ledger', before: editorDrafts(beforeEditor), after: editorDrafts(afterEditor), changed: !isDeepStrictEqual(editorDrafts(beforeEditor), editorDrafts(afterEditor)) });
          await verifyOwner(owner); await verifyRetained('after-open-cancel-original-retained', owner, title);
        } else {
          await setStage('both-native-readonly-aborts');
          await faultCommand('finish', 'initial', 'abort'); await waitApp('initial', 'error');
          await faultWait(() => globalThis.__youtraceSyntheticStartupFault.snapshot().holds.find(row => row.target === 'initial')?.terminal === 'abort');
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
        await setStage('original-Goal-visible-after-recovery'); await navigate('/goal', '目标');
        await read('[data-component="goal-card"] h2', goalTitle); await read('[data-component="goal-card"] p', goalDescription);
        assert.equal(await page.$$eval('[data-component="goal-card"]', rows => rows.length), 1);
        assert.equal(await page.$eval('[data-component="goal-card"] [role=progressbar]', el => Number(el.getAttribute('aria-valuenow'))), 0);
        await read('[data-component="goal-workspace"] h1 + p', '0/1 完成 · 平均进度 0%');
        await capture(page, `${label}-original-Goal-visible-after-recovery`);
        await verifyRetained('after-original-Goal-read', owner, title);
        await navigate('/todo', '待办'); await read(editor);
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
