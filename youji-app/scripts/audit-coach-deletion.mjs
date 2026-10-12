// Hosted CI only: existing reminder controls, two independent Chromium profiles.
// Synthetic historical Push rows are fixture setup, never a fake result or UI.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname } from 'node:path';
import { realpathSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual as equal } from 'node:util';
import { readExistingAccount } from './audit-initial-session-outcomes.mjs';
import { createHabitAuditClock, installAuditDate } from './audit-clock.mjs';
import { reminderEntryChecks } from './audit-reminder-entry.mjs';

export const deletionFixture = {
  victim: 'native-delete-target', live: 'native-paged-out-live', added: 'native-concurrent-new',
  title: '合成云端提醒：需要删除', liveTitle: '合成云端提醒：分页外仍有效', addedTitle: '合成云端提醒：期间新增',
  body: '合成完整原文  第一行\n第二行，空白与标点必须保留。',
};
export function fixtureDatabase(path) {
  assert.equal(basename(path), 'synthetic.db');
  assert.match(basename(dirname(path)), /^youtrace-outcomes-[A-Za-z0-9]+$/, 'Disposable outcome database only');
  assert.equal(realpathSync(dirname(dirname(path))), realpathSync(tmpdir()), 'Temporary root only');
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'Existing regular fixture database only');
  assert.equal(realpathSync(path), path, 'No symlinked fixture path');
  const db = new DatabaseSync(path, { open: true, readOnly: false });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  return db;
}
export function addHistoricalPushes(path, owner, phase) {
  const db = fixtureDatabase(path);
  try {
    assert.ok(db.prepare('SELECT id FROM User WHERE id=?').get(owner), 'User must have completed real UI authentication first');
    const f = deletionFixture;
    const rows = phase === 'initial' ? [[f.victim, f.title, 0, 1000], [f.live, f.liveTitle, 0, 2000]]
      : phase === 'page' ? Array.from({ length: 55 }, (_, i) => [`native-newer-${String(i).padStart(2, '0')}`, `合成已读分页 ${i}`, 1, 3000 + i])
      : phase === 'concurrent' ? [[f.added, f.addedTitle, 0, 5000]] : null;
    assert.ok(rows, 'Unknown fixture phase');
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT INTO Push(id,userId,type,title,body,actions,read,acted,createdAt) VALUES(?,?,?,?,?,?,?,0,?)');
      for (const [id, title, read, time] of rows) insert.run(id, owner, 'follow_up', title, f.body, '[]', read, Date.UTC(2026, 0, 1) + time);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return rows.map(row => row[0]);
  } finally { db.close(); }
}
export function serverPushFacts(path, owner) {
  const db = fixtureDatabase(path);
  try {
    return {
      pushes: db.prepare('SELECT * FROM Push WHERE userId=? ORDER BY id').all(owner),
      tombstones: db.prepare("SELECT * FROM SyncTombstone WHERE userId=? AND entity='coachPushes' ORDER BY entityId").all(owner),
      feed: db.prepare('SELECT * FROM SyncChange WHERE userId=? ORDER BY seq').all(owner),
    };
  } finally { db.close(); }
}
export function projectAccount(raw) { return reminderEntryChecks.project(raw); }
export function preservedBusiness(before, after) {
  return before.databaseName === after.databaseName && before.version === after.version && equal(before.schema, after.schema)
    && Object.keys(before.local).sort().join(',') === Object.keys(after.local).sort().join(',')
    && Object.keys(before.local).filter(key => !['coachPushes', 'coachInsights', 'settings'].includes(key))
      .every(key => equal(before.local[key], after.local[key]) && equal(before.keys[key], after.keys[key]));
}
export function preservedInsightsAndSettings(before, after) {
  if (!before.local.coachInsights.every(row => after.local.coachInsights.some(current => equal(row, current)))) return false;
  const previous = new Map(before.local.settings.map(row => [row.key, row]));
  const current = new Map(after.local.settings.map(row => [row.key, row]));
  if (previous.size !== before.local.settings.length || current.size !== after.local.settings.length) return false;
  for (const key of new Set([...previous.keys(), ...current.keys()])) {
    const old = previous.get(key), row = current.get(key); if (equal(old, row)) continue;
    if (!row || !equal(Object.keys(row).sort(), ['key', 'value'])) return false;
    if (key === `coachPushDismissed:${deletionFixture.victim}` && row.value === true) continue;
    if (key === 'lastPullAt' && typeof row.value === 'string' && Number.isFinite(Date.parse(row.value)) && new Date(row.value).toISOString() === row.value
      && (!old || typeof old.value === 'string' && Date.parse(row.value) >= Date.parse(old.value))) continue;
    if (key === 'coachPushDeletionScan:v1') {
      const owner = /^youtrace:user:(.+):schedule-v1$/.exec(before.databaseName)?.[1], value = row.value;
      if (owner && value && equal(Object.keys(value).sort(), ['afterId', 'dataEpoch', 'owner']) && value.owner === owner
        && value.dataEpoch === (previous.get('localDataEpoch')?.value ?? 'initial') && typeof value.afterId === 'string' && value.afterId.length > 0 && value.afterId.length <= 256) continue;
    }
    return false;
  }
  return true;
}
export function separateOwner(original, other, otherOwner) {
  const f = deletionFixture, ids = new Set(original.local.coachPushes.map(row => row.id));
  return other.databaseName === `youtrace:user:${otherOwner}:schedule-v1` && other.databaseName !== original.databaseName
    && other.local.todos.length === 0 && other.local.coachPushes.every(row => row.origin === 'local' && !ids.has(row.id)
      && ![f.title, f.liveTitle, f.addedTitle].includes(row.title) && row.body !== f.body);
}
export function deletionConverged(before, after, remote, originalRemote) {
  const f = deletionFixture;
  if (!preservedBusiness(before, after) || !preservedInsightsAndSettings(before, after) || !before.local.coachPushes.some(row => row.id === f.victim && row.origin === 'cloud')) return false;
  if (after.local.coachPushes.some(row => row.id === f.victim) || !after.local.settings.some(row => row.key === `coachPushDismissed:${f.victim}` && row.value === true)) return false;
  for (const row of before.local.coachPushes.filter(row => row.id !== f.victim)) {
    if (!after.local.coachPushes.some(current => equal(current, row))) return false;
  }
  const local = before.local.coachPushes.filter(row => row.origin === 'local');
  if (!local.length || !after.local.coachPushes.some(row => row.id === f.live) || !after.local.coachPushes.some(row => row.id === f.added)) return false;
  if (!equal(remote.pushes, originalRemote.pushes.filter(row => row.id !== f.victim)) || !equal(remote.feed, originalRemote.feed)) return false;
  const added = after.local.coachPushes.find(row => row.id === f.added), expected = originalRemote.pushes.find(row => row.id === f.added);
  if (!expected || !added || added.origin !== 'cloud' || !['type', 'title', 'body'].every(key => added[key] === expected[key])
    || !equal(added.actions, JSON.parse(expected.actions ?? '[]')) || added.read !== Boolean(expected.read) || added.acted !== Boolean(expected.acted) || added.createdAt !== expected.createdAt) return false;
  return equal(remote.tombstones, originalRemote.tombstones) && remote.tombstones.filter(row => row.entityId === f.victim).length === 1;
}
// Installs one bounded loss AFTER a successful response from the actual DELETE.
// It never issues its own request, fabricates success, changes app records or retries.
export function installLostDeleteAck(id) {
  const native = window.fetch; let armed = true;
  window.__coachDeleteAck = { calls: [], lossCount: 0, restored: false };
  window.__restoreCoachDeleteAck = () => { window.fetch = native; window.__coachDeleteAck.restored = true; };
  window.fetch = async function(input, init) {
    const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
    const method = String(init?.method ?? (typeof input === 'object' ? input.method : 'GET') ?? 'GET').toUpperCase();
    const response = await native.call(this, input, init);
    if (method === 'DELETE' && path === `/api/coach/pushes/${encodeURIComponent(id)}`) {
      const row = { method, path, status: response.status, afterRealResponse: true }; window.__coachDeleteAck.calls.push(row);
      if (armed && response.ok) { armed = false; await response.arrayBuffer(); window.__coachDeleteAck.lossCount++; throw new TypeError('Synthetic successful DELETE acknowledgment loss'); }
    }
    return response;
  };
}

// A pathname-only check can see transient / before RequireOnboarding finishes.
// Read the real rendered entry state; do not skip onboarding via storage/API writes.
export function readAuthenticatedEntry() {
  const visible = element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  if (location.pathname === '/onboarding' && [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '跳过' && visible(button))) return 'onboarding';
  const home = document.querySelector('#home-capture-title');
  if (location.pathname === '/' && home && visible(home) && [...document.querySelectorAll('nav[aria-label="主导航"]')].some(visible)) return 'home';
  return false;
}
export async function finishAuthenticatedEntry(target, pointer, waitPath) {
  const state = await target.waitForFunction(readAuthenticatedEntry, { timeout: 15000 });
  if (await state.jsonValue() === 'onboarding') await pointer(target, 'button', '跳过');
  await waitPath(target, '/');
  await target.waitForSelector('#home-capture-title', { visible: true, timeout: 15000 });
  assert.equal(await (await target.waitForFunction(readAuthenticatedEntry, { timeout: 15000 })).jsonValue(), 'home');
}

export async function runCoachDeletionOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native diagnostic is hosted CI only; no local restriction bypass');
  const { isolated, pointer, fill, waitPath, apiFor, capture, observe, sleep, actions, artifacts, writeFile, join, origin, surfaceNames, databasePath } = h;
  const clock = createHabitAuditClock();
  const f = deletionFixture, media = [], phone = '13900008571', otherPhone = '13900008572';
  const requests = [], responses = [], responseReads = [];
  const attachWire = target => {
    target.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/coach/')) requests.push({ surface: surfaceNames.get(target), method: request.method(), path, account: request.headers()['x-youtrace-account'] ?? null, body: request.postData() ?? null }); });
    target.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/coach/')) { const row = { surface: surfaceNames.get(target), path, method: response.request().method(), status: response.status() }; responses.push(row); if (path.endsWith('/deletion-status')) responseReads.push(response.json().then(body => { row.body = body; }, () => { row.bodyReadUnavailable = true; })); } });
  };
  const save = (name, value) => writeFile(join(artifacts, `YPD-${name}.json`), JSON.stringify({ syntheticOnly: true, ...value }, null, 2));
  await isolated('YPD-owner-A-1280', { width: 1280, height: 900 }, async page => {
    let peerContext, peer, recorder, activePage = page; attachWire(page);
    await page.evaluateOnNewDocument(installAuditDate, clock);
    await save('clock', { clock, scope: 'Explicit browser Date only at Wednesday noon; real timers, server, SQLite and cookies. No natural-midnight claim.' });
    const pass = async (target, name, condition, detail) => { await observe(target, `YPD-${name}`, condition, detail); assert.ok(condition, name); };
    const local = async (target, owner) => projectAccount(await target.evaluate(readExistingAccount, owner));
    const waitLocal = async (target, owner, predicate) => {
      const until = Date.now() + 12000; let value;
      do { value = await local(target, owner); if (predicate(value)) return value; await sleep(100); } while (Date.now() < until);
      throw new Error('Expected real account state did not settle');
    };
    const navigate = async (target, path, label) => {
      await target.bringToFront();
      if (target.viewport().width <= 768) {
        if (path === '/') await pointer(target, 'nav[aria-label="主导航"] button[aria-label="首页"]');
        else { await pointer(target, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(target, '/more'); await pointer(target, `nav[aria-label="全部功能"] a[href="${path}"]`); }
      } else await pointer(target, 'aside nav button', label);
      await waitPath(target, path);
      const ready = { '/': '#home-capture-title', '/todo': '[aria-label="新建待办"]', '/settings': 'section[aria-label="账号"]', '/insights': '[data-component="historical-observations"]' }[path];
      assert.ok(ready, 'Every task navigation has an explicit rendered-page landmark');
      await target.waitForSelector(ready, { visible: true, timeout: 15000 });
    };
    const authenticate = async (target, number, nickname, initial) => {
      if (initial) { await target.goto(origin + '/login', { waitUntil: 'networkidle0' }); actions.push({ kind: 'initial-login-entry', surface: surfaceNames.get(target), path: '/login' }); }
      await target.waitForSelector('#login-phone'); await fill(target, '#login-phone', number);
      const sent = target.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/send-code' && r.request().method() === 'POST');
      await pointer(target, 'button', '获取验证码'); const challenge = await (await sent).json(); assert.match(challenge.devCode ?? '', /^\d{6}$/);
      await fill(target, '#login-code', challenge.devCode);
      const verified = target.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/verify' && r.request().method() === 'POST');
      await pointer(target, 'button', '验证'); assert.equal((await verified).status(), 200);
      await target.waitForFunction(() => Boolean(document.querySelector('#login-nickname')) || location.pathname !== '/login');
      if (await target.$('#login-nickname')) { await fill(target, '#login-nickname', nickname); await pointer(target, 'button', '开始使用'); }
      actions.push({ kind: 'authentication-await-rendered-home-or-onboarding', surface: surfaceNames.get(target) });
      await finishAuthenticatedEntry(target, pointer, waitPath);
      await target.waitForSelector('main'); return apiFor(target);
    };
    const logout = async target => {
      await navigate(target, '/settings', '设置'); const response = target.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/logout' && r.request().method() === 'POST');
      await pointer(target, 'section[aria-label="账号"] button', '退出登录'); assert.equal((await response).status(), 200); await waitPath(target, '/login');
    };
    const reload = async target => { await target.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'native-browser-reload', surface: surfaceNames.get(target) }); await waitPath(target, '/insights'); await target.waitForSelector('[data-component="historical-observations"]', { visible: true, timeout: 15000 }); };
    try {
      const a = await authenticate(page, phone, '合成删除账号', true);
      // Create a real business counterexample using the existing Todo UI.
      await navigate(page, '/todo', '待办'); await pointer(page, '[aria-label="新建待办"]'); await fill(page, '[role=dialog] #todo-text', '合成须保留的待办原文'); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
      await waitLocal(page, a.ownerId, rows => rows.local.todos.length === 1 && rows.local.outbox.length === 0);
      // Native preference controls cause the ordinary Home rule to create a local reminder.
      await navigate(page, '/settings', '设置');
      for (const label of ['教练推送', '晚间复盘']) { const selector = `[role=switch][aria-label="${label}"]`; if (await page.$eval(selector, el => el.getAttribute('aria-checked')) !== 'true') await pointer(page, selector); }
      await pointer(page, '[role=radio][aria-label="每天最多1条"]');
      const quiet = '[role=switch][aria-label="免打扰时段"]'; if (await page.$eval(quiet, el => el.getAttribute('aria-checked')) === 'true') await pointer(page, quiet);
      const now = reminderEntryChecks.businessClock(await page.evaluate(() => Date.now())).time, selector = '#evening-review-time';
      if (await page.$eval(selector, el => el.value) !== now) {
        await pointer(page, selector); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
        const hour = Number(now.slice(0, 2)), seen = new Set(); let meridiem = false;
        for (let i = 0; i < 25; i++) { const current = Number((await page.$eval(selector, el => el.value)).slice(0, 2)); if (current === hour) break; if (seen.has(current)) { meridiem = true; break; } seen.add(current); await page.keyboard.press('ArrowUp'); }
        if (meridiem) for (let i = 0; i < 12; i++) { if (Number((await page.$eval(selector, el => el.value)).slice(0, 2)) % 12 === hour % 12) break; await page.keyboard.press('ArrowUp'); }
        await page.keyboard.press('ArrowRight'); const delta = (Number(now.slice(3)) - Number((await page.$eval(selector, el => el.value)).slice(3)) + 60) % 60;
        for (let i = 0; i < Math.min(delta, 60 - delta); i++) await page.keyboard.press(delta <= 30 ? 'ArrowUp' : 'ArrowDown');
        if (meridiem) { await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); } await page.keyboard.press('Tab'); assert.equal(await page.$eval(selector, el => el.value), now);
        await pointer(page, '[data-component="time-preference"]:has(#evening-review-time) button', '保存晚间复盘时间');
      }
      await page.waitForFunction(() => document.querySelector('[data-component="preference-sync"]')?.textContent.includes('上次核对时，账号偏好已同步'));
      await navigate(page, '/', '首页');
      await waitLocal(page, a.ownerId, rows => rows.local.coachPushes.some(row => row.origin === 'local' && row.type === 'evening_review'));
      await pass(page, 'real-local-reminder-before-cloud-fixture', true, 'Ordinary Settings and Home generated the local record; no direct IDB/store/timer writes');
      actions.push({ kind: 'declared-synthetic-historical-Push-SQLite-fixture', phase: 'initial', ids: addHistoricalPushes(databasePath, a.ownerId, 'initial'), note: 'There is no public cloud Push creation endpoint. This fixture represents existing server history, not native reminder creation or delivery.' });
      await navigate(page, '/insights', '教练洞察'); await reload(page);
      await waitLocal(page, a.ownerId, rows => rows.local.coachPushes.some(row => row.id === f.victim) && rows.local.coachPushes.some(row => row.id === f.live));
      peerContext = await page.browser().createBrowserContext(); peer = await peerContext.newPage(); surfaceNames.set(peer, 'YPD-owner-B-360'); await peer.setViewport({ width: 360, height: 800 }); await peer.emulateTimezone('Asia/Shanghai'); peer.setDefaultTimeout(15000); peer.setDefaultNavigationTimeout(30000);
      await peer.evaluateOnNewDocument(installAuditDate, clock); attachWire(peer);
      const targets = [];
      for (const target of [page, peer]) { const client = await target.createCDPSession(); const info = await client.send('Target.getTargetInfo'); targets.push({ surface: surfaceNames.get(target), targetId: info.targetInfo.targetId }); await client.detach(); }
      await save('media-targets', { targets, trace: 'YPD-owner-A-1280-trace.json', videos: ['YPD-owner-A-1280.webm', 'YPD-owner-B-360.webm'], scope: 'One continuous browser-global trace, separate profile videos; no second simultaneous tracing session' });
      peer.on('pageerror', error => h.infrastructure.push({ scenario: 'YPD-owner-B-360', pageError: error.name }));
      recorder = await peer.screencast({ path: join(artifacts, 'YPD-owner-B-360.webm'), fps: 12, quality: 35 }); media.push('YPD-owner-B-360.webm');
      activePage = peer;
      const b = await authenticate(peer, phone, '合成删除账号', true); assert.equal(b.ownerId, a.ownerId);
      // Home's rule effect is cancellable: data completion must precede leaving Home.
      await waitLocal(peer, b.ownerId, rows => rows.local.coachPushes.some(row => row.origin === 'local') && rows.local.todos.length === 1 && rows.local.outbox.length === 0);
      actions.push({ kind: 'peer-Home-rule-and-Todo-data-settled-before-navigation', surface: surfaceNames.get(peer) });
      await navigate(peer, '/insights', '教练洞察');
      const beforeB = await waitLocal(peer, b.ownerId, rows => rows.local.coachPushes.some(row => row.id === f.victim) && rows.local.coachPushes.some(row => row.id === f.live) && rows.local.coachPushes.some(row => row.origin === 'local') && rows.local.todos.length === 1 && rows.local.outbox.length === 0);
      const serverBeforeDelete = serverPushFacts(databasePath, a.ownerId);
      await save('before-delete', { a: await local(page, a.ownerId), b: beforeB, server: serverBeforeDelete });
      await pass(peer, 'two-independent-native-IDB-caches', page.browserContext() !== peer.browserContext() && beforeB.local.coachPushes.some(row => row.id === f.victim), 'Same verified account; distinct browser storage/cookie contexts, real IndexedDB and normal OTP');
      const closeSelector = `[aria-label="关闭推送：${f.title}"]`;
      await page.waitForSelector(closeSelector, { visible: true }); await peer.waitForSelector(closeSelector, { visible: true });
      await capture(page, 'YPD-original-cloud-reminder-A'); await capture(peer, 'YPD-original-cloud-reminder-B');
      actions.push({ kind: 'declared-synthetic-historical-Push-SQLite-fixture', phase: 'page', ids: addHistoricalPushes(databasePath, a.ownerId, 'page') });
      const latest = await b('/coach/pushes'); assert.equal(latest.pushes.length, 50); assert.ok(!latest.pushes.some(row => row.id === f.live || row.id === f.victim));
      await pass(peer, 'page-absence-not-deletion', serverPushFacts(databasePath, a.ownerId).pushes.some(row => row.id === f.live), '55 newer read rows intentionally move two live cached IDs outside the API latest-50 page');
      await page.evaluate(installLostDeleteAck, f.victim); activePage = page;
      await pointer(page, closeSelector);
      await page.waitForFunction(() => window.__coachDeleteAck?.lossCount === 1 && document.body.innerText.includes('反馈未保存，请稍后重试'));
      const lost = await local(page, a.ownerId), committed = serverPushFacts(databasePath, a.ownerId);
      await pass(page, 'committed-delete-lost-ACK-preserves-retry-control', lost.local.coachPushes.some(row => row.id === f.victim) && !committed.pushes.some(row => row.id === f.victim) && committed.tombstones.filter(row => row.entityId === f.victim).length === 1 && Boolean(await page.$(closeSelector)), 'Actual server deletion committed; injected loss only occurs after real successful response. Original record/control remains for deliberate retry.');
      await save('lost-ACK', { local: lost, server: committed, wire: await page.evaluate(() => window.__coachDeleteAck) });
      actions.push({ kind: 'declared-synthetic-concurrent-Push-SQLite-fixture', phase: 'concurrent', ids: addHistoricalPushes(databasePath, a.ownerId, 'concurrent') });
      const beforeRetryRemote = serverPushFacts(databasePath, a.ownerId);
      await pointer(page, closeSelector); // Same rendered operation; no injected retry.
      await waitLocal(page, a.ownerId, rows => !rows.local.coachPushes.some(row => row.id === f.victim));
      await page.waitForSelector(closeSelector, { hidden: true });
      const wire = await page.evaluate(() => { window.__restoreCoachDeleteAck(); return window.__coachDeleteAck; });
      await pass(page, 'same-ID-explicit-retry-idempotent', wire.lossCount === 1 && wire.calls.length === 2 && wire.calls.every(row => row.status === 200 && row.path.endsWith('/' + deletionFixture.victim)) && equal(serverPushFacts(databasePath, a.ownerId), beforeRetryRemote), 'Exactly two real DELETEs for the same ID; second ACK succeeds, no second deletion fact or unrelated write');
      activePage = peer; await peer.bringToFront();
      await pass(peer, 'peer-cache-still-old-before-load', Boolean(await peer.$(closeSelector)), 'Peer still displays its independent pre-deletion cache before its ordinary reload');
      await reload(peer);
      const afterB = await waitLocal(peer, b.ownerId, rows => !rows.local.coachPushes.some(row => row.id === f.victim) && rows.local.coachPushes.some(row => row.id === f.added));
      const finalRemote = serverPushFacts(databasePath, a.ownerId);
      await Promise.all(responseReads);
      await pass(peer, 'peer-real-owner-filtered-tombstone-HTTP', responses.some(row => row.surface === 'YPD-owner-B-360' && row.path.endsWith('/deletion-status') && row.status === 200 && row.body?.protocol === 1 && row.body.deletedIds?.includes(f.victim)), 'Peer actual HTTP response contains the exact target tombstone; page absence alone is never the proof');
      // Expected final source includes every declared fixture row, minus only the victim.
      const expectedBefore = { ...beforeRetryRemote, pushes: [] };
      // Do not construct expected server fields from the observed result: use the
      // frozen initial raw server record for the removed row.
      const original = serverBeforeDelete.pushes.find(row => row.id === f.victim);
      expectedBefore.pushes = [...beforeRetryRemote.pushes, original].sort((x, y) => x.id.localeCompare(y.id));
      await pass(peer, 'peer-reconciles-only-explicit-tombstone', deletionConverged(beforeB, afterB, finalRemote, expectedBefore), 'Exact original local rows and Todo retained; only target gone, one durable tombstone; paged-out live and concurrent new reminder kept');
      await peer.waitForSelector(closeSelector, { hidden: true });
      await peer.waitForSelector(`[aria-label="关闭推送：${f.liveTitle}"]`, { visible: true }); await peer.waitForSelector(`[aria-label="关闭推送：${f.addedTitle}"]`, { visible: true });
      await save('converged', { before: beforeB, after: afterB, server: finalRemote, wire, latestPage: latest });
      await reload(peer); const reloaded = await waitLocal(peer, b.ownerId, rows => rows.local.coachPushes.some(row => row.id === f.added));
      await pass(peer, 'reload-no-resurrection-or-source-loss', deletionConverged(beforeB, reloaded, serverPushFacts(databasePath, a.ownerId), expectedBefore), 'A second complete native reload retains the same tombstone and all unrelated records');
      // Same profile A -> sign out -> new B -> sign out -> A, using actual controls.
      const ownerBefore = await local(peer, b.ownerId); await logout(peer);
      const c = await authenticate(peer, otherPhone, '合成另一账号', false); assert.notEqual(c.ownerId, b.ownerId);
      const other = await waitLocal(peer, c.ownerId, rows => rows.local.outbox.length === 0);
      await pass(peer, 'other-account-no-private-reminders-or-Todo', separateOwner(ownerBefore, other, c.ownerId) && !await peer.evaluate(text => document.body.innerText.includes(text), f.liveTitle) && !await peer.evaluate(() => document.body.innerText.includes('合成须保留的待办原文')), 'Real normal sign-out and distinct OTP account: exact owner database, no old IDs/private cloud content or Todo. Any legitimate new-account local reminder is permitted.');
      const retained = await local(peer, b.ownerId); assert.ok(preservedBusiness(ownerBefore, retained)); assert.ok(preservedInsightsAndSettings(ownerBefore, retained)); assert.deepEqual(retained.local.coachPushes, ownerBefore.local.coachPushes);
      await save('other-account-isolation', { other, retainedOriginal: retained, originalBefore: ownerBefore });
      await logout(peer); const returning = await authenticate(peer, phone, '合成删除账号', false); assert.equal(returning.ownerId, b.ownerId);
      await navigate(peer, '/insights', '教练洞察'); const returned = await waitLocal(peer, b.ownerId, rows => rows.local.coachPushes.some(row => row.id === f.added) && rows.local.todos.length === 1);
      await pass(peer, 'A-B-A-keeps-owner-tombstone-and-originals', deletionConverged(beforeB, returned, serverPushFacts(databasePath, a.ownerId), expectedBefore), 'Original account reopens its retained data; deleted cloud target remains absent and all unrelated original rows survive');
      await save('final', { local: returned, server: serverPushFacts(databasePath, a.ownerId), boundary: 'Two Chromium storage profiles, not two physical devices. Page reload and A/B/A; not browser-process restart, all delayed account windows, live SMS/model, complete inbox delivery or historical hard-delete inference.' });
      await capture(page, 'YPD-A-final'); await capture(peer, 'YPD-B-final');
    } catch (error) { await save('first-error', { name: error.name, message: error.message, stack: error.stack, surface: activePage && surfaceNames.get(activePage) }); if (activePage && !activePage.isClosed()) await capture(activePage, 'YPD-first-failure').catch(() => undefined); throw error; }
    finally { await Promise.all(responseReads); await save('coach-wire', { requests, responses }); if (peer && !peer.isClosed()) { await capture(peer, 'YPD-peer-final').catch(() => undefined); if (recorder) await recorder.stop(); } if (peerContext) await peerContext.close(); }
  });
  return { media };
}
