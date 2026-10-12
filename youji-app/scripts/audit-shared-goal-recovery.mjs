// Hosted native acceptance only. The old native30 data is declared synthetic
// setup; all recovery/confirmation/retry/deletion uses visible product controls.
import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { legacyGoalOutcomeChecks } from './audit-legacy-goal-outcomes.mjs';
import { readExistingAccount } from './audit-initial-session-outcomes.mjs';
import { legacyBackupFacts } from './audit-legacy-backup.mjs';
import { finishAuthenticatedEntry } from './audit-coach-deletion.mjs';
import { readSharedGoalRawSnapshot, verifySharedGoalReceiptHash, decodeAccountFact } from './audit-shared-goal-hashes.mjs';

export const sharedGoalFixture = [
  { id: 'shared-native-a', title: '合成同名旧目标', description: '  A 原始计划\n保留末尾空白  ', level: 'short', domain: ' 学习 ', priority: 'medium', progress: 25.5, targetDate: '', createdAt: 1000, updatedAt: 2000 },
  { id: 'shared-native-b', title: '合成同名旧目标', description: 'B 是另一份不同原文，不能按同名去重', level: 'long', domain: '生活', priority: 'low', progress: 0, targetDate: null, createdAt: 3000, updatedAt: 4000 },
  { id: 'shared-native-unsupported', title: '合成未确认字段', description: '未知归属原文仍需保留', level: 'short', domain: '学习', priority: 'low', progress: 0, targetDate: null, createdAt: 5000, updatedAt: 6000, ownerId: 'historical-unverified-person' },
];
export async function seedSharedGoalFixture(rows) {
  if ((await indexedDB.databases()).some(db => db.name === 'youtrace')) throw Error('Fixture refuses an existing shared database');
  const schema = { schedules: 'id,date,type', expenses: 'id,date,category', todos: 'id,done,dueDate,priority', habits: 'id', habitCheckins: 'id,habitId,date,[habitId+date]', quickNotes: 'id,createdAt', diary: 'id,date', settings: 'key', coachInsights: 'id,type,dismissed,createdAt', coachPushes: 'id,type,read,createdAt', goals: 'id,level,domain,priority', outbox: '++seq,entity,queuedAt' };
  const request = indexedDB.open('youtrace', 30);
  request.onupgradeneeded = event => {
    if (event.oldVersion !== 0) { request.transaction.abort(); return; }
    for (const [name, definition] of Object.entries(schema)) {
      const [primary, ...indexes] = definition.split(',');
      const path = text => text.startsWith('[') ? text.slice(1, -1).split('+') : text;
      const store = request.result.createObjectStore(name, { keyPath: path(primary.replace(/^\+\+/, '')), autoIncrement: primary.startsWith('++') });
      for (const name of indexes) store.createIndex(name, path(name));
    }
  };
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    const tx = db.transaction(['goals', 'todos'], 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    for (const row of rows) tx.objectStore('goals').add(row);
    tx.objectStore('todos').add({ id: 'shared-unselected-todo', text: '合成未选择的其他类型原文', done: false, createdAt: 1 });
    await done;
  } finally { db.close(); }
}
export function installSharedSourceAudit() {
  window.__sharedSourceTransactions = [];
  const native = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (stores, mode, options) {
    if (this.name === 'youtrace') window.__sharedSourceTransactions.push({ stores: typeof stores === 'string' ? [stores] : [...stores], mode: mode ?? 'readonly' });
    return native.call(this, stores, mode, options);
  };
}
export function installOneReceiptAbort(owner) {
  const native = IDBObjectStore.prototype.add;
  window.__sharedReceiptFault = { fired: 0, restored: false };
  IDBObjectStore.prototype.add = function (value, key) {
    if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'settings' && value?.key?.startsWith('shared-goal-recovery:v1:')) {
      IDBObjectStore.prototype.add = native;
      window.__sharedReceiptFault.fired++;
      window.__sharedReceiptFault.restored = true;
      this.transaction.abort();
      throw new DOMException('合成单次空间不足，整笔事务中止', 'QuotaExceededError');
    }
    return arguments.length > 1 ? native.call(this, value, key) : native.call(this, value);
  };
}
export const accountRows = (facts, name) => facts.tables.find(t => t.name === name)?.rows ?? [];
export const recoveryReceipts = facts => accountRows(facts, 'settings').filter(r => r.key.startsWith('shared-goal-recovery:v1:'));
export function exactLocalCopy(facts, original) {
  const receipts = recoveryReceipts(facts).filter(row => row.value.sourceKey === original.id);
  if (receipts.length !== 1) return false;
  const receipt = receipts[0].value, copies = accountRows(facts, 'goalRecords').filter(row => row.id === receipt.copyId);
  const owner = /^youtrace:user:([a-zA-Z0-9_-]+):schedule-v1$/.exec(facts.databaseName ?? '')?.[1];
  return copies.length === 1 && Boolean(owner) && receipt.ownerId === owner && receipt.automaticUndoProof === 'unavailable-unfenced-writers'
    && receipt.copyId !== original.id && equal(receipt.original, original)
    && equal(copies[0], { ...original, id: receipt.copyId, syncScope: 'local' })
    && equal(receipt.copy, copies[0]) && /^[a-f0-9]{64}$/.test(receipt.rowDigest)
    && /^[a-f0-9]{64}$/.test(receipt.intentId) && /^[a-f0-9]{64}$/.test(receipt.receiptDigest)
    && accountRows(facts, 'outbox').every(row => row.entity !== 'goals');
}
// This comparison is intentionally exact for canceled/aborted operations. No
// broad settings or business-table exemptions turn legitimate changes into green.
export function unchangedAccount(before, after) { return equal(before, after); }

// Scrolling is a real wheel action. A fixed bottom bar must never receive a
// recovery click intended for an offscreen/covered target. No force/DOM click.
export function sharedGoalTargetGeometry(el) {
  const rect = el.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { connected: el.isConnected, enabled: !el.disabled, x, y, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, hit: Boolean(hit && el.contains(hit)), hitTag: hit?.tagName ?? null, hitLabel: hit?.getAttribute('aria-label') ?? null };
}
// Geometry is sampled only after the target's own/ancestor animation finishes.
// Three unchanged animation frames are required; the timeout never disables an
// animation or changes application DOM/styles.
export function waitSharedGoalTargetSettled(el) {
  return new Promise((resolve, reject) => {
    let frame, timer, previous, stable = 0, samples = 0, finished = false;
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); cancelAnimationFrame(frame); if (error) reject(error); else resolve(value); };
    const tick = () => {
      if (!el.isConnected) { finish(Error('Original control detached while waiting for stable geometry')); return; }
      const rect = el.getBoundingClientRect(), geometry = [rect.x, rect.y, rect.width, rect.height]; samples++;
      const animations = document.getAnimations().filter(animation => (animation.playState === 'running' || animation.pending) && animation.effect?.target?.contains?.(el));
      stable = animations.length === 0 && previous && geometry.every((value, index) => Math.abs(value - previous[index]) < .25) ? stable + 1 : 0;
      previous = geometry;
      if (stable >= 3) { finish(null, { samples, stableFrames: stable, activeAncestorAnimations: animations.length }); return; }
      frame = requestAnimationFrame(tick);
    };
    timer = setTimeout(() => finish(Error('Original control did not settle within3seconds')), 3000);
    frame = requestAnimationFrame(tick);
  });
}
export async function prepareSharedGoalPointer(page, target, actions, label) {
  await page.bringToFront();
  actions.push({ kind: 'recovery-control-settled', label, ...await target.evaluate(waitSharedGoalTargetSettled) });
  await target.scrollIntoView();
  for (let attempt = 0; attempt <= 4; attempt++) {
    actions.push({ kind: 'recovery-control-settled-after-scroll', label, attempt, ...await target.evaluate(waitSharedGoalTargetSettled) });
    const before = await target.evaluate(sharedGoalTargetGeometry);
    actions.push({ kind: 'recovery-control-hit-test', label, attempt, ...before });
    assert.ok(before.connected && before.enabled && before.width > 0 && before.height > 0, 'Original control is no longer available');
    if (before.hit) return before;
    assert.ok(attempt < 4, 'Original control remains covered after bounded native scrolling; no click attempted');
    const deltaY = Math.max(-before.viewportHeight * .6, Math.min(before.viewportHeight * .6, before.y - before.viewportHeight / 2));
    assert.ok(Math.abs(deltaY) > 1, 'Original control is covered in the viewport center; refuse a guessed click');
    await page.mouse.move(before.viewportWidth / 2, before.viewportHeight / 2);
    await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-to-recovery-control', label, deltaY });
    await page.waitForFunction((el, oldY) => { const r = el.getBoundingClientRect(); return !el.isConnected || Math.abs(r.y + r.height / 2 - oldY) > 1 || el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, { timeout: 3000 }, target, before.y);
  }
  throw Error('Original control remains covered after bounded native scrolling; no click attempted');
}

export async function runSharedGoalRecoveryOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted CI only; no local browser permission bypass');
  const { isolated, pointer: originalPointer, fill, waitPath, apiFor, capture, observe, actions, artifacts, writeFile, join, origin } = h;
  const pointer = async (page, selector, text) => {
    const handle = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled && (text === undefined || el.textContent.trim() === text); }), { timeout: 7000 }, selector, text);
    const element = handle.asElement(); assert.ok(element);
    try { await prepareSharedGoalPointer(page, element, actions, text ?? selector); }
    finally { await handle.dispose(); }
    await originalPointer(page, selector, text);
  };
  const media = [];
  for (const [index, width] of [1280, 360].entries()) {
    const name = `YSG-shared-goals-${width}`; media.push(name);
    await isolated(name, { width, height: 900 }, async page => {
      const writes = [], sourceTransactions = [], firstPhone = `139000084${index}1`, otherPhone = `139000084${index}2`;
      page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/sync') && request.method() !== 'GET') writes.push({ path, method: request.method(), body: request.postData() ?? null }); });
      const save = (label, value) => writeFile(join(artifacts, `${name}-${label}.json`), JSON.stringify({ syntheticOnly: true, ...value }, null, 2));
      const pass = async (label, condition, detail) => { await observe(page, `${name}-${label}`, condition, detail); assert.ok(condition, label); };
      const navigate = async (path, label) => {
        if (width <= 768) { await pointer(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more'); await pointer(page, `nav[aria-label="全部功能"] a[href="${path}"]`); }
        else await pointer(page, 'aside nav button', label);
        await waitPath(page, path);
        await page.waitForSelector(path === '/settings' ? 'section[aria-label="逐项恢复旧版目标"]' : '[data-component="goal-workspace"]', { visible: true });
        if (path === '/settings') await page.waitForFunction(() => document.querySelector('[data-component="preference-sync"]')?.textContent.includes('账号偏好已同步'), { timeout: 15000 });
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
      };
      const authenticate = async (phone, nickname, initial = false) => {
        if (initial) { await page.goto(origin + '/login', { waitUntil: 'networkidle0' }); actions.push({ kind: 'initial-native-login-url', path: '/login', width }); }
        await page.waitForSelector('#login-phone'); await fill(page, '#login-phone', phone);
        const sent = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/send-code' && r.request().method() === 'POST');
        await pointer(page, 'button', '获取验证码'); const response = await sent; assert.equal(response.status(), 200); const challenge = await response.json(); assert.match(challenge.devCode ?? '', /^\d{6}$/);
        await fill(page, '#login-code', challenge.devCode); await pointer(page, 'button', '验证');
        await page.waitForFunction(() => Boolean(document.querySelector('#login-nickname')) || location.pathname !== '/login');
        if (await page.$('#login-nickname')) { await fill(page, '#login-nickname', nickname); await pointer(page, 'button', '开始使用'); }
        await finishAuthenticatedEntry(page, pointer, waitPath); return apiFor(page);
      };
      const collectSourceTransactions = async () => { sourceTransactions.push(...await page.evaluate(() => window.__sharedSourceTransactions ?? [])); };
      const local = owner => page.evaluate(readExistingAccount, owner);
      const panel = 'section[aria-label="逐项恢复旧版目标"]';
      const dialogReady = async label => {
        const dialog = await page.waitForSelector('[role=dialog]', { visible: true, timeout: 7000 }); assert.ok(dialog);
        try { actions.push({ kind: 'recovery-dialog-ready', label, ...await dialog.evaluate(waitSharedGoalTargetSettled) }); }
        finally { await dialog.dispose(); }
      };
      const preview = async () => { await pointer(page, `${panel} button`, '预览旧版目标'); await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('已读取 3 份旧目标'), { timeout: 15000 }, panel); };
      const select = async sourceId => {
        // Read the visible source ID to choose one real row, then native click.
        // No synthetic data-* attribute or hidden app/service entrypoint is used.
        const ordinal = await page.$$eval(`${panel} div.rounded-lg`, (rows, id) => rows.findIndex(row => [...row.querySelectorAll('p')].some(p => p.textContent === `原编号：${id}`)), sourceId);
        assert.ok(ordinal >= 0); const candidates = await page.$$(`${panel} div.rounded-lg`);
        const target = await candidates[ordinal].$('button'); assert.ok(target);
        await prepareSharedGoalPointer(page, target, actions, `source:${sourceId}`);
        await capture(page, `${name}-source-row-before-native-click`);
        await prepareSharedGoalPointer(page, target, actions, `source:${sourceId}:after-capture`);
        await target.asLocator().click();
        actions.push({ kind: 'native-pointer-source-row', sourceId, width });
        await page.waitForSelector('[role=dialog] input[type=checkbox]', { visible: true }); await dialogReady('ownership');
      };
      const acknowledge = () => pointer(page, '[role=dialog] input[type=checkbox]');
      const commit = async () => { await pointer(page, '[role=dialog] button', '确认并创建仅本机副本'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 15000 }); };
      const actor = await authenticate(firstPhone, `合成旧目标${width}`, true);
      await navigate('/settings', '设置');
      actions.push({ kind: 'declared-native30-historical-shared-fixture', width, schemaCommit: '9abd4d3808b6d42067839333c78c482df14c9f71', note: 'Fresh isolated browser only; not UI-created history or an inferred owner.' });
      await page.evaluate(seedSharedGoalFixture, sharedGoalFixture);
      await page.evaluate(installSharedSourceAudit); await page.evaluateOnNewDocument(installSharedSourceAudit);
      const sourceBefore = await page.evaluate(legacyBackupFacts), sourceSnapshot = await page.evaluate(readSharedGoalRawSnapshot), initial = await local(actor.ownerId);
      await save('before', { sourceBefore, sourceSnapshot, account: initial, ownerId: actor.ownerId });
      await preview(); await select(sharedGoalFixture[0].id);
      const unchecked = await page.$eval('[role=dialog] input[type=checkbox]', el => !el.checked);
      assert.ok(unchecked); assert.ok(await page.$$eval('[role=dialog] button', buttons => buttons.find(b => b.textContent === '确认并创建仅本机副本').disabled));
      await capture(page, `${name}-raw-unchecked-preview`); await pointer(page, '[role=dialog] button', '暂不恢复'); await page.waitForSelector('[role=dialog]', { hidden: true });
      const afterCancel = await local(actor.ownerId), sourceAfterCancel = await page.evaluate(legacyBackupFacts);
      await save('cancel', { before: initial, after: afterCancel, sourceBefore, sourceAfter: sourceAfterCancel });
      await pass('cancel-zero-writes', unchangedAccount(initial, afterCancel) && equal(sourceBefore, sourceAfterCancel), 'Original unchecked ownership preview/cancel leaves all account and shared-source values/schema unchanged');
      await select(sharedGoalFixture[0].id); await acknowledge(); const beforeFault = await local(actor.ownerId);
      await page.evaluate(installOneReceiptAbort, actor.ownerId); actions.push({ kind: 'declared-one-native-account-receipt-add-abort', width });
      await pointer(page, '[role=dialog] button', '确认并创建仅本机副本');
      await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent.includes('复制结果尚未确认'), { timeout: 15000 });
      const afterFault = await local(actor.ownerId), fault = await page.evaluate(() => window.__sharedReceiptFault);
      await save('fault', { beforeFault, afterFault, fault });
      await pass('atomic-abort-visible', unchangedAccount(beforeFault, afterFault) && fault.fired === 1 && fault.restored, 'One native transaction abort before receipt add is visible; no partial Goal/receipt, original controls retain choice for retry');
      await commit(); const copied = await local(actor.ownerId); await save('copied', { account: copied });
      await pass('exact-one-local-copy', exactLocalCopy(copied, sharedGoalFixture[0]) && accountRows(copied, 'goalRecords').length === 1, 'Exact whitespace/fractional progress/empty date/raw timestamps survive local-only new-ID copy with bound receipt and no Goal outbox');
      await select(sharedGoalFixture[0].id); await acknowledge(); await commit(); assert.ok(unchangedAccount(copied, await local(actor.ownerId)));
      await collectSourceTransactions(); await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'native-browser-reload', width }); await waitPath(page, '/settings');
      await page.waitForSelector(panel, { visible: true }); await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
      await preview(); await select(sharedGoalFixture[0].id); await acknowledge(); await commit();
      const replayed = await local(actor.ownerId);
      await pass('durable-reload-idempotency', equal(recoveryReceipts(copied), recoveryReceipts(replayed)) && equal(accountRows(copied, 'goalRecords'), accountRows(replayed, 'goalRecords')), 'Same preview and real reload/fresh preview retain the same original receipt/copy ID; no second Goal');
      await pointer(page, `${panel} button`, '查看恢复收据'); await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('已读取 1 份本账号恢复收据'), {}, panel);
      await pointer(page, `${panel} button`, `比较恢复副本：${sharedGoalFixture[0].title}`); await dialogReady('comparison');
      await pass('compare-preserves-without-undo', await page.$eval('[role=dialog]', el => el.textContent.includes('无法确认，保留记录') && el.textContent.includes('不按恢复编号自动定位') && ![...el.querySelectorAll('button')].some(b => /删除|撤销/.test(b.textContent))), 'Original receipt/current comparison explicitly has no automatic deletion and does not claim Goal ID positioning');
      await pointer(page, '[role=dialog] a[href="/goal"]'); await waitPath(page, '/goal'); await page.waitForSelector('[data-component="goal-card"]', { visible: true });
      assert.equal(await page.$$eval('[data-component="goal-card"]', nodes => nodes.length), 1);
      assert.equal(await page.$eval('[data-component="goal-card"] p', el => el.textContent), sharedGoalFixture[0].description);
      assert.ok(await page.$eval('[data-component="goal-card"]', el => el.textContent.includes('仅本机')));
      await pointer(page, '[data-component="goal-card"] button[aria-label^="删除目标"]'); await dialogReady('ordinary-delete');
      assert.ok(await page.$eval('[role=dialog]', el => el.textContent.includes('A 原始计划')));
      await pointer(page, '[role=dialog] button', '确认删除'); await page.waitForSelector('[role=dialog]', { hidden: true });
      await navigate('/settings', '设置'); await preview(); await select(sharedGoalFixture[0].id); await acknowledge(); await commit();
      const afterDelete = await local(actor.ownerId);
      await pass('explicit-delete-never-resurrected', accountRows(afterDelete, 'goalRecords').length === 0 && equal(recoveryReceipts(copied), recoveryReceipts(afterDelete)), 'Separate ordinary Goal deletion removes only the one visibly identified copy; replay retains receipt without recreating it');
      await select(sharedGoalFixture[1].id); await acknowledge(); await commit(); const ownerA = await local(actor.ownerId);
      assert.ok(exactLocalCopy(ownerA, sharedGoalFixture[1])); assert.equal(recoveryReceipts(ownerA).length, 2);
      const cloud = await actor('/sync/pull?protocol=2&features=goals-v1&cursor=0&limit=500'); assert.equal(cloud.hasMore, false); assert.equal(cloud.events.filter(e => e.entity === 'goals').length, 0);
      await collectSourceTransactions(); await pointer(page, 'section[aria-label="账号"] button', '退出登录'); await waitPath(page, '/login');
      const retainedAfterLogout = await local(actor.ownerId);
      const next = await authenticate(otherPhone, `合成其他账号${width}`); await navigate('/settings', '设置'); await pointer(page, `${panel} button`, '查看恢复收据');
      await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('已读取 0 份本账号恢复收据'), {}, panel);
      const other = await local(next.ownerId), inactiveA = await local(actor.ownerId);
      await pass('other-owner-unclaimed', actor.ownerId !== next.ownerId && accountRows(other, 'goalRecords').length === 0 && recoveryReceipts(other).length === 0 && unchangedAccount(retainedAfterLogout, inactiveA) && !await page.$eval(panel, node => node.textContent.includes('合成同名旧目标')), 'B has its own empty Goal/receipt set; source was never assigned automatically, and inactive A remains byte/value-equivalent');
      await collectSourceTransactions(); await pointer(page, 'section[aria-label="账号"] button', '退出登录'); await waitPath(page, '/login');
      const returned = await authenticate(firstPhone, `合成旧目标${width}`); assert.equal(returned.ownerId, actor.ownerId); await navigate('/settings', '设置');
      await pointer(page, `${panel} button`, '查看恢复收据'); await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('已读取 2 份本账号恢复收据'), {}, panel);
      const final = await local(actor.ownerId); await collectSourceTransactions();
      const epoch = accountRows(final, 'settings').find(row => row.key === 'localDataEpoch')?.value;
      const independentReceiptHashes = recoveryReceipts(final).map(row => verifySharedGoalReceiptHash(row, { ownerId: actor.ownerId, epoch, sourceSnapshot }));
      await save('independent-receipt-hashes', { independentReceiptHashes });
      const sourceAfter = await page.evaluate(legacyBackupFacts);
      // Actual original account export, not a programmatic export-service call.
      const directory = join(artifacts, `${name}-account-download`); await mkdir(directory);
      const client = await page.browser().target().createCDPSession(), begins = [];
      client.on('Browser.downloadWillBegin', event => begins.push(event));
      await client.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: directory, eventsEnabled: true, browserContextId: page.browserContext().id });
      let downloadProof;
      try {
        const complete = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { client.off('Browser.downloadProgress', received); reject(Error('Account backup did not complete in20seconds')); }, 20000);
          function received(event) { if (event.state === 'completed' || event.state === 'canceled') { clearTimeout(timer); client.off('Browser.downloadProgress', received); if (event.state === 'completed') resolve(event); else reject(Error('Account backup canceled')); } }
          client.on('Browser.downloadProgress', received);
        });
        void complete.catch(() => undefined);
        await pointer(page, 'section[aria-label="数据透明"] button', '导出数据');
        const download = await complete;
        assert.equal(begins.length, 1); assert.equal(download.guid, begins[0].guid); assert.match(download.guid, /^[a-f0-9-]{36}$/i); assert.match(begins[0].suggestedFilename, /^youtrace-backup-\d{4}-\d{2}-\d{2}\.json$/);
        assert.deepEqual(await readdir(directory), [download.guid]);
        const bytes = await readFile(join(directory, download.guid)), envelope = JSON.parse(bytes.toString('utf8'));
        assert.equal(envelope.format, 'youtrace-local-backup'); assert.equal(envelope.schemaVersion, 3); assert.equal(envelope.ownerId, actor.ownerId); assert.equal(envelope.rawTablesEncoding, 'youtrace-structured-clone-v1');
        const raw = legacyGoalOutcomeChecks.decodeRecovery(envelope.rawTables);
        const expectedTables = final.tables.filter(table => table.name !== '_accountGeneration');
        assert.deepEqual(raw.map(table => table.name).sort(), expectedTables.map(table => table.name).sort());
        for (const table of expectedTables) { const downloaded = raw.find(row => row.name === table.name); assert.deepEqual(downloaded.keys, decodeAccountFact(table.keys)); assert.deepEqual(downloaded.rows, decodeAccountFact(table.losslessRows)); }
        const downloadedReceipts = raw.find(table => table.name === 'settings').rows.filter(row => row.key.startsWith('shared-goal-recovery:v1:'));
        const downloadedHashes = downloadedReceipts.map(row => verifySharedGoalReceiptHash(row, { ownerId: actor.ownerId, epoch, sourceSnapshot }));
        assert.deepEqual(downloadedHashes, independentReceiptHashes);
        downloadProof = { guid: download.guid, suggestedFilename: begins[0].suggestedFilename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), downloadedHashes, allExportedAccountTablesAndRawKeysEqual: true };
        await save('download-proof', downloadProof);
        await pass('actual-backup-independent-chain', true, 'Original account backup produces one completed native file; independent decoder compares every exported account table/key/value and independent wire oracle recomputes each recovered Goal receipt chain');
      } finally { await client.detach(); }
      await save('final', { sourceBefore, sourceAfter, sourceSnapshot, independentReceiptHashes, copied, afterDelete, ownerA, retainedAfterLogout, other, inactiveA, final, sourceTransactions, writes, downloadProof });
      await pass('return-and-source-retention', equal(accountRows(ownerA, 'goalRecords'), accountRows(final, 'goalRecords')) && equal(recoveryReceipts(ownerA), recoveryReceipts(final)) && equal(sourceBefore, sourceAfter) && sourceTransactions.length > 0 && sourceTransactions.every(tx => tx.mode === 'readonly') && accountRows(final, 'outbox').every(row => row.entity !== 'goals') && writes.every(row => !JSON.parse(row.body ?? '{}').goals?.length), 'A return keeps second same-name source as a distinct exact copy and both original receipts; deleted first copy stays absent, all shared-source reads readonly, no Goal upload');
    });
  }
  return { media };
}
