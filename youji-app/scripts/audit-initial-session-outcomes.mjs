// Initial-document RED baseline. Hosted CI only; every record/session comes
// from visible controls. No cookie/state/IDB writes, injection, or request mocks.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { createInitializationObserver } from './audit-initialization-observer.mjs';
import { waitForStableModalTarget } from './audit-legacy-goal-outcomes.mjs';

export const INITIAL_SESSION_PATH = '/todo?view=all';
export const INITIAL_SESSION_CASES = [
  { branch: 'auth401', width: 1280, height: 900, phone: '13900008601' },
  { branch: 'logout', width: 1280, height: 900, phone: '13900008602' },
  { branch: 'auth401', width: 360, height: 800, phone: '13900008603' },
  { branch: 'logout', width: 360, height: 800, phone: '13900008604' },
];
const validVersion = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const table = (snapshot, name) => snapshot.tables.find(row => row.name === name);
const todoSettings = snapshot => table(snapshot, 'settings').rows.filter(row => /^sync-(version|conflict):todos:/.test(row.key));
const version = (snapshot, id) => todoSettings(snapshot).find(row => row.key === `sync-version:todos:${id}`)?.value;

function todoRowsFromLedger(events) {
  let previous = 0n; const rows = new Map();
  for (const event of events) {
    assert.ok(validVersion(event.seq) && BigInt(event.seq) > previous, 'Complete ledger must be strictly ordered');
    previous = BigInt(event.seq);
    if (event.entity !== 'todos') continue;
    assert.ok(['upsert', 'delete'].includes(event.operation), 'Unknown Todo ledger operation');
    if (event.operation === 'delete') rows.delete(event.entityId);
    else { assert.equal(event.entityId, event.data?.id, 'Never manufacture a server record ID'); rows.set(event.entityId, event.data); }
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function sameTodo(local, server, owner) {
  if (!local || !server || server.userId !== owner) return false;
  if (!['id', 'userId', 'text', 'dueDate', 'priority', 'done', 'completedAt', 'createdAt', 'updatedAt'].every(key => Object.hasOwn(server, key))) return false;
  // Compare the entire business payload, and every additional local field.
  // Raw server metadata is retained separately and compared exactly on return.
  if (!['id', 'text', 'priority', 'done'].every(key => isDeepStrictEqual(local[key], server[key]))) return false;
  if ((local.dueDate ?? null) !== server.dueDate || (local.completedAt ?? null) !== (server.completedAt == null ? null : Date.parse(server.completedAt))) return false;
  return Object.keys(local).every(key => {
    if (['dueDate', 'completedAt'].includes(key)) return true;
    if (['createdAt', 'updatedAt'].includes(key)) return local[key] === Date.parse(server[key]);
    return Object.hasOwn(server, key) && isDeepStrictEqual(local[key], server[key]);
  }) && ['createdAt', 'updatedAt'].every(key => typeof server[key] === 'string' && Number.isFinite(Date.parse(server[key])));
}
function acknowledged(facts, expectedText) {
  const local = table(facts.local, 'todos').rows, remote = todoRowsFromLedger(facts.events);
  if (local.length !== 1 || remote.length !== 1 || local[0].text !== expectedText || local[0].priority !== 'medium' || local[0].done !== false || (local[0].dueDate ?? null) !== null || local[0].completedAt !== null || !sameTodo(local[0], remote[0], facts.owner)) return false;
  const last = facts.events.filter(row => row.entity === 'todos' && row.entityId === local[0].id).at(-1);
  return table(facts.local, 'outbox').rows.length === 0 && validVersion(version(facts.local, local[0].id)) && version(facts.local, local[0].id) === last?.seq && !todoSettings(facts.local).some(row => row.key.startsWith('sync-conflict:'));
}
function retained(before, after) {
  return before.databaseName === after.databaseName && before.version === after.version &&
    isDeepStrictEqual(before.schema, after.schema) &&
    ['todos', 'outbox'].every(name => isDeepStrictEqual(table(before, name), table(after, name))) &&
    isDeepStrictEqual(todoSettings(before), todoSettings(after));
}
export const initialSessionChecks = { todoRowsFromLedger, sameTodo, acknowledged, retained };

// Read an existing account DB only. The catalog check and aborted upgrade guard
// prevent an evidence read from silently creating or upgrading a missing DB.
export async function readExistingAccount(owner) {
  const name = `youtrace:user:${owner}:schedule-v1`;
  if (!(await indexedDB.databases()).some(row => row.name === name)) throw new Error('Expected retained account database is absent');
  return new Promise((resolve, reject) => {
    let database, finished = false;
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); database?.close(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error('Read-only account snapshot deadline')), 5000);
    const encode = value => {
      if (value === undefined) return { type: 'undefined' };
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : { type: 'number', value: String(Object.is(value, -0) ? '-0' : value) };
      if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
      if (value instanceof Date) return { type: 'date', value: value.toISOString() };
      if (Array.isArray(value)) return { type: 'array', length: value.length, entries: Object.keys(value).map(key => [key, encode(value[key])]) };
      if (value && Object.getPrototypeOf(value) === Object.prototype) return { type: 'object', entries: Object.keys(value).sort().map(key => [key, encode(value[key])]) };
      throw new Error('Unsupported snapshot value; do not claim lossless retention');
    };
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => { request.transaction.abort(); finish(new Error('Evidence must not create or upgrade account DB')); };
    request.onerror = () => finish(new Error('Read-only account DB open failed'));
    request.onblocked = () => finish(new Error('Read-only account DB open blocked'));
    request.onsuccess = () => {
      database = request.result;
      if (finished) { database.close(); return; }
      const names = [...database.objectStoreNames].sort();
      try {
        const transaction = database.transaction(names, 'readonly');
        const result = { databaseName: database.name, version: database.version, schema: [], tables: [] };
        for (const name of names) {
          const store = transaction.objectStore(name), item = { name, keys: [], rows: [], losslessRows: null };
          result.tables.push(item);
          result.schema.push({ name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes: [...store.indexNames].sort().map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; }) });
          const keys = store.getAllKeys(), rows = store.getAll();
          keys.onsuccess = () => { try { item.keys = encode(keys.result); } catch (error) { finish(error); } };
          rows.onsuccess = () => { try { item.rows = rows.result; item.losslessRows = encode(rows.result); } catch (error) { finish(error); } };
        }
        transaction.oncomplete = () => finish(null, result);
        transaction.onerror = transaction.onabort = () => finish(new Error('Read-only account snapshot transaction failed'));
      } catch (error) { finish(error); }
    };
  });
}

export async function runInitialSessionOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Initial-session native journey is hosted-CI only');
  const { isolated, capture, observe, sleep, actions, infrastructure, artifacts, writeFile, join, origin, checkpoint } = h;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'Disposable synthetic origin only');
  const media = [], runs = [];
  await writeFile(join(artifacts, 'YI-scope.json'), JSON.stringify({ kind: 'initial-session-native-RED-baseline', applicationBaseline: '6290160', harnessBaseline: 'e90ed2b37fb8c2393681f3062fe368d88172b210', syntheticOnly: true, cases: INITIAL_SESSION_CASES, requestedPath: INITIAL_SESSION_PATH, controls: 'Native pointer/keyboard/wheel; full paint, clipping and center-hit gate; stable target before one click', setup: 'Only declared initial /login or /todo?view=all navigation, then post-Logout direct protected navigation. Native devOTP registration/existing login. GET-only evidence and existing-IDB readonly snapshots.', deadlineMs: { scenario: 85000, loginOrPath: 18000, GET: 5000, idb: 5000, stableTarget: 2500 }, limitations: ['Prepared native RED baseline; a run determines outcomes', 'Module-confirmed signed-out/auth401 readiness diagnosis is separate from the unresolved b5b8a12 B-to-Todo initialization failure', 'No app-core/Login/Splash changes, live provider calls, production data, manual-human/mobile-OS/accessibility acceptance', 'Retained DB identity/schema, full Todo/outbox and Todo receipts are asserted; full other tables are evidence only'] }, null, 2));

  for (const config of INITIAL_SESSION_CASES) {
    const label = `YI-${config.branch}-${config.width}`, directory = join(artifacts, 'initial-session', label);
    await mkdir(directory, { recursive: true }); media.push(label);
    const run = { label, branch: config.branch, width: config.width, status: 'not-started', steps: [], firstFailure: null };
    runs.push(run);
    try { await isolated(label, { width: config.width, height: config.height }, async page => {
      const trace = createInitializationObserver();
      let stage = 'install-observer', stopped = false, firstFailure = false, verifiedOwner, beforeFacts;
      const assertActive = () => { assert.equal(stopped, false, 'Scenario deadline ended; no later action is allowed'); };
      const save = (name, value) => writeFile(join(directory, `${name}.json`), JSON.stringify(value, null, 2));
      const setStage = async name => { assertActive(); stage = name; run.steps.push({ stage: name, at: new Date().toISOString() }); await checkpoint(`${label}: ${stage}`, { initialSessionRuns: runs }); };
      const get = async path => {
        assertActive(); assert.ok(path === '/api/auth/me' || /^\/api\/sync\/pull\?protocol=2&features=goals-v1&cursor=\d+&limit=500$/.test(path), 'Evidence is restricted to declared GET-only endpoints');
        actions.push({ kind: 'GET-only-initial-session-evidence', surface: label, endpoint: path.split('?')[0] });
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
          if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-initial-session', surface: label, selector, text, x, y, deltaY, clip: box.clip, scroller: box.scroller }); }
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
        actions.push({ kind: 'native-pointer-initial-session', surface: label, selector, text, x, y, clip: box.clip, stability });
      };
      const fill = async (selector, text) => {
        const key = async (operation, value) => { assertActive(); await page.keyboard[operation](value); };
        await tap(selector); await key('down', 'Control'); await key('press', 'A'); await key('up', 'Control'); await key('press', 'Backspace'); await key('sendCharacter', text);
        assert.equal(await page.$eval(selector, el => el.value), text, 'Exact synthetic input must remain');
        actions.push({ kind: 'native-text-initial-session', surface: label, selector, ...(selector === '#login-code' ? { syntheticOTP: true } : { syntheticText: text }) });
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
        const verified = await (await submit('button', '验证', '/auth/verify')).json();
        if (existing) { assert.ok(verified.needRegister !== true && typeof verified.user?.id === 'string', 'Existing account must return the actual user and must not register again'); return; }
        assert.equal(verified.needRegister, true, 'Fresh synthetic account must require registration');
        await fill('#login-nickname', `Synthetic ${config.branch}`); await submit('button', '开始使用', '/auth/register');
      };
      const navigate = async (destination, labelText) => {
        if (config.width === 360) { await tap('nav[aria-label="主导航"] button[aria-label="全部功能"]'); await path('/more'); await tap(`nav[aria-label="全部功能"] a[href="${destination}"]`); }
        else await tap('aside nav button', labelText);
        await path(destination);
      };
      const local = async owner => { assertActive(); return page.evaluate(readExistingAccount, owner); };
      const ledger = async () => {
        const events = []; let cursor = '0';
        for (let count = 0; count < 10; count++) {
          const result = await get(`/api/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`);
          assert.equal(result.status, 200, 'Actual authenticated GET ledger required'); const body = result.body;
          assert.equal(body.protocol, 2); assert.ok(body.features?.includes('goals-v1')); assert.ok(Array.isArray(body.events));
          events.push(...body.events); todoRowsFromLedger(events);
          assert.equal(body.nextCursor, events.at(-1)?.seq ?? '0', 'Read all ledger pages without skipping');
          assert.equal(typeof body.hasMore, 'boolean'); if (!body.hasMore) return events;
          assert.notEqual(body.nextCursor, cursor); cursor = body.nextCursor;
        }
        throw new Error('GET-only ledger exceeded bounded pagination');
      };
      const facts = async owner => ({ owner, local: await local(owner), events: await ledger() });
      const verifyOwner = async expected => { const result = await get('/api/auth/me'); assert.equal(result.status, 200); assert.ok(typeof result.body.user?.id === 'string'); if (expected) assert.equal(result.body.user.id, expected); return result.body.user.id; };
      const noPrivateContent = async title => page.evaluate(title => !document.body.textContent.includes(title) && !document.querySelector('[id^="todo-record-"], button[aria-label="新建待办"], aside, nav[aria-label="主导航"], textarea'), title);
      const journey = async () => {
        run.status = 'running'; await trace.observeInitialization(page);
        if (config.branch === 'auth401') {
          await setStage('fresh-protected-entry');
          const unauthorized = response('/auth/me', 'GET').then(value => ({ status: value.status() }), error => ({ error }));
          actions.push({ kind: 'declared-initial-protected-navigation', surface: label, path: INITIAL_SESSION_PATH });
          trace.boundary(page, 'route-start', '/todo');
          await page.goto(origin + INITIAL_SESSION_PATH, { waitUntil: 'domcontentloaded', timeout: 18000 });
          const actual = await unauthorized; if (actual.error) throw actual.error;
          await save('first-auth-response', { source: 'actual app initial GET /auth/me, not an evidence probe', ...actual });
          await pass('actual-auth-me-401', actual.status === 401, 'Fresh browser profile received an actual HTTP401 from the disposable backend');
          await setStage('auth401-reaches-login'); await loginVisible();
          await otp(false); await setStage('registration-returns-requested-path'); await path(INITIAL_SESSION_PATH);
          const heading = await read('main h1', '待办'); const owner = await verifyOwner();
          await save('registered-account', { owner, currentPath: new URL(page.url()).pathname + new URL(page.url()).search, local: await local(owner) });
          await pass('exact-fresh-return', heading.box.visible, 'Native registration reaches readable Todo at the original full requested path, including query');
        } else {
          await setStage('public-login-setup');
          actions.push({ kind: 'declared-initial-public-navigation', surface: label, path: '/login' });
          await page.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 18000 });
          await loginVisible(); await otp(false); await path('/onboarding');
          for (let index = 0; index < 4; index++) { await read('h1'); await capture(page, `${label}-onboarding-${index + 1}`); await tap('button', index < 3 ? '下一步' : '开始使用'); await sleep(650); }
          await path('/'); const owner = await verifyOwner(); verifiedOwner = owner;
          await setStage('native-create-todo'); await navigate('/todo', '待办');
          const title = `Synthetic 保留${config.width}`;
          await tap('button[aria-label="新建待办"]'); await fill('[role=dialog] #todo-text', title); await tap('[role=dialog] button', '无日期'); await tap('[role=dialog] button', '保存');
          await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 10000 });
          await setStage('await-exact-todo-ACK');
          let before;
          for (let attempt = 0; attempt < 30; attempt++) { before = await facts(owner); if (acknowledged(before, title)) break; await sleep(250); }
          await save('before-logout', before); beforeFacts = before;
          const todo = table(before.local, 'todos').rows[0];
          const reading = await read(`button[aria-label="编辑待办 ${title} 无日期"]`);
          await pass('full-todo-ACK', acknowledged(before, title) && reading.box.visible, 'Native Todo exists once; full business fields, original local row, raw server record, exact sync version and empty whole outbox are retained');
          await setStage('native-settings-logout'); await navigate('/settings', '设置');
          await submit('section[aria-label="账号"] button', '退出登录', '/auth/logout');
          await loginVisible();
          const afterLogout = await local(owner); await save('after-logout-local', afterLogout);
          await pass('logout-private-content-absent-retained-DB', await noPrivateContent(title) && retained(before.local, afterLogout), 'Visible Login hides private Todo/navigation; original account DB/schema, complete Todo/outbox and receipts remain exact');
          const revoked = await get('/api/auth/me'); await save('logout-server-session', { source: 'GET-only observer probe after native logout', status: revoked.status });
          await pass('actual-server-logout', revoked.status === 401, 'Normal Settings Logout completed; the current browser now receives HTTP401. Old-credential replay is outside this journey.');
          await setStage('signed-out-protected-reentry');
          actions.push({ kind: 'declared-post-logout-protected-navigation', surface: label, path: INITIAL_SESSION_PATH });
          trace.boundary(page, 'route-start', '/todo');
          await page.goto(origin + INITIAL_SESSION_PATH, { waitUntil: 'domcontentloaded', timeout: 18000 });
          await loginVisible();
          const signedOut = await local(owner); await save('signed-out-protected-local', signedOut);
          await pass('signed-out-private-content-absent-retained-DB', await noPrivateContent(title) && retained(before.local, signedOut), 'Signed-out initial document reaches readable Login, preserves original account records and exposes no private Todo');
          await otp(true); await setStage('existing-account-exact-return'); await path(INITIAL_SESSION_PATH); await verifyOwner(owner);
          await read(`button[aria-label="编辑待办 ${title} 无日期"]`);
          const after = await facts(owner); await save('after-existing-login', after);
          await pass('same-owner-same-ID-exact-return', acknowledged(after, title) && retained(before.local, after.local) && isDeepStrictEqual(before.events, after.events) && todo.id === table(after.local, 'todos').rows[0]?.id, 'Existing-account native OTP returns exact /todo?view=all with the same owner, complete original record, unchanged full server ledger, version and empty outbox');
        }
        run.status = 'completed';
      };
      const timerState = {}; const deadline = new Promise((_, reject) => { timerState.id = setTimeout(() => { stopped = true; reject(new Error('Initial-session scenario exceeded 85-second evidence deadline')); }, 85000); });
      try { await Promise.race([journey(), deadline]); }
      catch (error) {
        stopped = true; run.status = 'failed';
        if (!firstFailure) {
          firstFailure = true; run.firstFailure = { stage, name: error.name, detail: error.message, at: new Date().toISOString() };
          // Preserve the first safe chronology before any final-media work.
          await save('first-failure', { ...run.firstFailure, diagnosisBoundary: 'This run does not establish the original b5b8a12 B/Todo failure cause', initialization: trace.firstFailureTrace(error) }).catch(() => { run.firstFailure.evidenceWriteFailed = true; });
          await capture(page, `${label}-FIRST-FAILURE-${stage}`).catch(() => { run.firstFailure.screenshotFailed = true; });
          if (verifiedOwner) {
            try {
              const current = await page.evaluate(readExistingAccount, verifiedOwner);
              await save('first-failure-retained-account', { owner: verifiedOwner, current, unchangedSinceACK: beforeFacts ? retained(beforeFacts.local, current) : null });
            } catch { run.firstFailure.retainedAccountReadFailed = true; }
          }
        }
        throw error; // Existing isolated wrapper records blocked/nonzero, then continues next case.
      } finally {
        stopped = true; clearTimeout(timerState.id);
        await save('initialization-chronology', trace.firstFailureTrace(null));
        await save('scenario-result', run);
      }
    }); } catch (error) {
      // The driver closes this profile in finally even if recording finalization
      // fails. Keep that infrastructure failure separate and run the next case.
      run.status = 'harness-failed'; run.cleanupOrRecordingError = error.name;
      infrastructure.push({ scenario: label, initialSessionHarnessFailure: error.name });
      if (!actions.some(row => row.kind === 'isolated-profile-closed' && row.surface === label)) throw error;
    }
    run.profileClosed = actions.some(row => row.kind === 'isolated-profile-closed' && row.surface === label);
    assert.ok(run.profileClosed, 'Prior profile must be closed before starting another independent case');
    await writeFile(join(artifacts, 'YI-media.json'), JSON.stringify({ syntheticOnly: true, media, runs }, null, 2));
  }
  return media;
}
