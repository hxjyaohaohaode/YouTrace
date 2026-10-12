// Only hosted CI may run this native baseline. Synthetic native30 preparation is
// separate from original recovery controls. No focus()/DOM click or app writes.
import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { sharedGoalFixture, seedSharedGoalFixture, installSharedSourceAudit, accountRows, recoveryReceipts, exactLocalCopy, prepareSharedGoalPointer, waitSharedGoalTargetSettled } from './audit-shared-goal-recovery.mjs';
import { readExistingAccount } from './audit-initial-session-outcomes.mjs';
import { legacyBackupFacts } from './audit-legacy-backup.mjs';
import { finishAuthenticatedEntry } from './audit-coach-deletion.mjs';
import { readSharedGoalRawSnapshot, verifySharedGoalReceiptHash, decodeAccountFact } from './audit-shared-goal-hashes.mjs';

export const sharedGoalKeyboardFixture = Array.from({ length: 12 }, (_, index) => ({
  ...sharedGoalFixture[0], id: `shared-keyboard-${String(index).padStart(2, '0')}`,
  title: `合成键盘旧目标 ${String(index).padStart(2, '0')}`,
  description: index === 11 ? Array.from({ length: 40 }, (_, i) => `  第${i + 1}行原始计划：空白与换行保留。  `).join('\n') : `合成第${index}份未选择资料`,
}));

// Browser-side read only: capture native focus and its complete clipping bounds.
// Center/edge hits catch a fixed bar covering a keyboard-focused control. Rounded
// corners are deliberately not sampled; the actual rectangle must still fit.
export function sharedGoalKeyboardFocus(expected) {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return { matched: false, connected: false };
  const r = el.getBoundingClientRect(), style = getComputedStyle(el);
  let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, hidden = false;
  for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
    const s = getComputedStyle(ancestor), b = ancestor.getBoundingClientRect();
    hidden ||= s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0;
    if (ancestor !== el) {
      if (/auto|scroll|hidden|clip/.test(s.overflowX)) { clip.left = Math.max(clip.left, b.left); clip.right = Math.min(clip.right, b.right); }
      if (/auto|scroll|hidden|clip/.test(s.overflowY)) { clip.top = Math.max(clip.top, b.top); clip.bottom = Math.min(clip.bottom, b.bottom); }
    }
  }
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const insetX = Math.min(6, r.width / 4), insetY = Math.min(6, r.height / 4);
  const hits = [[x, y], [r.left + insetX, y], [r.right - insetX, y], [x, r.top + insetY], [x, r.bottom - insetY]].map(([px, py]) => {
    const hit = document.elementFromPoint(px, py); return { x: px, y: py, self: Boolean(hit && el.contains(hit)), tag: hit?.tagName ?? null, label: hit?.getAttribute('aria-label') ?? null };
  });
  const sourceKey = [...(el.closest('div.rounded-lg')?.querySelectorAll('p') ?? [])].map(p => p.textContent).find(text => text.startsWith('原编号：'))?.slice(4) ?? null;
  const text = el.textContent.trim(), label = el.getAttribute('aria-label');
  return { matched: el.matches(expected.selector) && (expected.text === undefined || text === expected.text) && (expected.sourceKey === undefined || sourceKey === expected.sourceKey),
    connected: el.isConnected, enabled: !el.matches(':disabled'), tag: el.tagName, type: el.getAttribute('type'), text, label, sourceKey,
    checked: el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : null,
    focusedVisible: el.matches(':focus-visible'), outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle, outlineColor: style.outlineColor, outlineOffset: style.outlineOffset, boxShadow: style.boxShadow, backgroundColor: style.backgroundColor, textColor: style.color,
    hidden, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, clip, hits,
    dialogTitle: el.closest('[role=dialog]')?.querySelector('h3')?.textContent ?? null,
  };
}
// This product declares an outline for :focus-visible. A shadow alone is not
// accepted as evidence. Computed nontransparent RGB is only a necessary guard;
// actual screenshot/background contrast still needs independent visual review.
export function hasDeclaredKeyboardOutline(state) {
  if (state.focusedVisible !== true || !Number.isFinite(state.outlineWidth) || state.outlineWidth <= 0 || !['auto', 'solid', 'dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset'].includes(state.outlineStyle)) return false;
  const color = typeof state.outlineColor === 'string' ? /^rgba?\(([^()]*)\)$/.exec(state.outlineColor.trim()) : null;
  if (!color) return false;
  const pieces = color[1].replace(/,/g, ' ').replace(/\//g, ' ').trim().split(/\s+/);
  if (pieces.length !== 3 && pieces.length !== 4) return false;
  const numeric = (value, max) => { const percent = value.endsWith('%'); const number = Number(percent ? value.slice(0, -1) : value); return Number.isFinite(number) && number >= 0 && number <= (percent ? 100 : max) ? number / (percent ? 100 : max) : NaN; };
  if (pieces.slice(0, 3).some(value => !Number.isFinite(numeric(value, 255)))) return false;
  return pieces.length === 3 || numeric(pieces[3], 1) > 0;
}
export function assertSharedGoalKeyboardFocus(state) {
  assert.ok(state.matched && state.connected && state.enabled && !state.hidden, 'Native keyboard focus must be the declared enabled original control');
  const { rect: r, clip: c } = state;
  assert.ok(r.width > 0 && r.height > 0 && r.left >= c.left - .5 && r.top >= c.top - .5 && r.right <= c.right + .5 && r.bottom <= c.bottom + .5, 'Entire keyboard control must remain inside viewport/scroll clipping bounds');
  assert.ok(state.hits.length === 5 && state.hits.every(hit => hit.self), 'Keyboard control is covered; do not scroll/focus it through a test-only route');
  assert.ok(hasDeclaredKeyboardOutline(state), 'Declared keyboard focus outline is absent, unsupported or transparent; shadows alone are not proof');
}
export function assertOnlySharedGoalCopy(before, after, original) {
  assert.ok(exactLocalCopy(after, original));
  for (const key of Object.keys(before).filter(key => key !== 'tables')) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(Object.keys(before).sort(), Object.keys(after).sort());
  assert.deepEqual(after.tables.map(t => t.name), before.tables.map(t => t.name));
  const receipt = recoveryReceipts(after).find(row => row.value.sourceKey === original.id);
  const decodedBefore = before.tables.map(t => ({ ...t, decodedKeys: decodeAccountFact(t.keys), decodedRows: decodeAccountFact(t.losslessRows) }));
  const decodedAfter = after.tables.map(t => ({ ...t, decodedKeys: decodeAccountFact(t.keys), decodedRows: decodeAccountFact(t.losslessRows) }));
  for (const table of decodedAfter) {
    const previous = decodedBefore.find(t => t.name === table.name); assert.ok(previous);
    assert.equal(table.decodedKeys.length, table.decodedRows.length);
    assert.equal(table.rows.length, table.decodedRows.length);
    // Native JSON transport may omit undefined own properties; the lossless
    // representation remains authoritative and all transported values agree.
    assert.deepEqual(JSON.parse(JSON.stringify(table.rows)), JSON.parse(JSON.stringify(table.decodedRows)));
    const newKey = table.name === 'goalRecords' ? receipt.value.copyId : table.name === 'settings' ? receipt.key : null;
    const indexes = table.decodedKeys.map((key, i) => ({ key, i })).filter(({ key }) => key !== newKey).map(({ i }) => i);
    assert.deepEqual(indexes.map(i => table.decodedKeys[i]), previous.decodedKeys);
    assert.deepEqual(indexes.map(i => table.decodedRows[i]), previous.decodedRows);
    for (const key of Object.keys(table).filter(k => !['rows', 'keys', 'losslessRows', 'decodedKeys', 'decodedRows'].includes(k))) assert.deepEqual(table[key], previous[key]);
  }
  assert.equal(decodedAfter.length, decodedBefore.length);
  assert.equal(accountRows(after, 'goalRecords').length, accountRows(before, 'goalRecords').length + 1);
  assert.equal(recoveryReceipts(after).length, recoveryReceipts(before).length + 1);
}

export async function runSharedGoalKeyboardOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted CI only; no local browser permission bypass');
  const { isolated, pointer: originalPointer, fill, waitPath, apiFor, capture, observe, actions, artifacts, writeFile, join, origin } = h;
  const panel = 'section[aria-label="逐项恢复旧版目标"]', modal = '[role=dialog]';
  const checkbox = { selector: `${modal} input[type=checkbox]` }, close = { selector: `${modal} button[aria-label="关闭"]` };
  const cancel = { selector: `${modal} button`, text: '暂不恢复' }, confirm = { selector: `${modal} button`, text: '确认并创建仅本机副本' };
  const media = [];
  for (const [index, width] of [1280, 360].entries()) {
    const name = `YSGK-shared-goals-keyboard-${width}`; media.push(name);
    await isolated(name, { width, height: 900 }, async page => {
      let actor, sourceBefore, initial; const states = [], writes = [], snapshots = {};
      const save = (label, value) => writeFile(join(artifacts, `${name}-${label}.json`), JSON.stringify({ syntheticOnly: true, ...value }, null, 2));
      const local = () => page.evaluate(readExistingAccount, actor.ownerId);
      const pass = async (label, condition, detail) => { await observe(page, `${name}-${label}`, condition, detail); assert.ok(condition, label); };
      const pointer = async (page, selector, text) => {
        const handle = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(el => !el.disabled && (text === undefined || el.textContent.trim() === text)), { timeout: 7000 }, selector, text);
        try { await prepareSharedGoalPointer(page, handle.asElement(), actions, `setup:${text ?? selector}`); } finally { await handle.dispose(); }
        await originalPointer(page, selector, text);
      };
      const focus = async (expected, label) => {
        const active = await page.evaluateHandle(() => document.activeElement);
        try { actions.push({ kind: 'native-keyboard-settle', label, ...await active.evaluate(waitSharedGoalTargetSettled) }); } finally { await active.dispose(); }
        const state = await page.evaluate(sharedGoalKeyboardFocus, expected); states.push({ label, expected, state });
        await save('focus-progress', { states }); assertSharedGoalKeyboardFocus(state); return state;
      };
      const key = async (value, expected, label) => {
        actions.push({ kind: 'native-recovery-key', key: value, label, width }); await page.keyboard.press(value);
        return expected ? focus(expected, label) : undefined;
      };
      const tabTo = async (expected, backwards = false) => {
        for (let count = 0; count < 90; count++) {
          const state = await page.evaluate(sharedGoalKeyboardFocus, expected);
          if (state.matched) return focus(expected, `tab-target:${expected.sourceKey ?? expected.text ?? expected.selector}`);
          await key(backwards ? 'Shift+Tab' : 'Tab');
          const next = await page.evaluate(sharedGoalKeyboardFocus, expected); actions.push({ kind: 'native-tab-transition', backwards, count, tag: next.tag, text: next.text, label: next.label, sourceKey: next.sourceKey });
        }
        throw Error('Original recovery control is not reachable in90nativeTab steps');
      };
      const waitDialog = async () => {
        await page.waitForSelector(`${modal} input[type=checkbox]`, { visible: true, timeout: 7000 });
        await focus(checkbox, 'initial-checkbox-focus');
        const displayed = await page.$eval(modal, el => ({ text: el.textContent, raw: el.querySelector('pre')?.textContent, label: el.querySelector('label')?.textContent }));
        assert.ok(displayed.text.includes(`目标账号：${actor.ownerId}。`));
        assert.ok(displayed.label.includes('我确认这一份资料属于我'));
        assert.deepEqual(JSON.parse(displayed.raw), sharedGoalKeyboardFixture[11]);
      };
      page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/sync') && request.method() !== 'GET') writes.push({ path, body: request.postData() ?? null }); });
      try {
        await page.goto(origin + '/login', { waitUntil: 'networkidle0' }); actions.push({ kind: 'initial-native-login-url', width });
        await fill(page, '#login-phone', `139000085${index}1`);
        const sent = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/send-code' && r.request().method() === 'POST');
        await pointer(page, 'button', '获取验证码'); const response = await sent; assert.equal(response.status(), 200); const challenge = await response.json(); assert.match(challenge.devCode ?? '', /^\d{6}$/);
        await fill(page, '#login-code', challenge.devCode); await pointer(page, 'button', '验证'); await page.waitForSelector('#login-nickname');
        await fill(page, '#login-nickname', `合成键盘恢复${width}`); await pointer(page, 'button', '开始使用'); await finishAuthenticatedEntry(page, pointer, waitPath); actor = await apiFor(page);
        if (width <= 768) { await pointer(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more'); await pointer(page, 'nav[aria-label="全部功能"] a[href="/settings"]'); }
        else await pointer(page, 'aside nav button', '设置');
        await waitPath(page, '/settings'); await page.waitForSelector(panel, { visible: true });
        await page.waitForFunction(() => document.querySelector('[data-component="preference-sync"]')?.textContent.includes('账号偏好已同步'), { timeout: 15000 }); await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
        actions.push({ kind: 'declared-native30-keyboard-fixture', rows: 12, longOriginalLines: 40, width });
        await page.evaluate(seedSharedGoalFixture, sharedGoalKeyboardFixture); await page.evaluate(installSharedSourceAudit);
        sourceBefore = await page.evaluate(legacyBackupFacts); initial = await local(); const sourceSnapshot = await page.evaluate(readSharedGoalRawSnapshot);
        snapshots.initial = initial; await save('before', { ownerId: actor.ownerId, sourceBefore, sourceSnapshot, initial });
        // From this point every recovery interaction is native keyboard only.
        await tabTo({ selector: `${panel} button`, text: '预览旧版目标' }); await key('Enter');
        await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('已读取 12 份旧目标'), {}, panel);
        await tabTo({ selector: `${panel} button`, text: '下一页目标' }); await capture(page, `${name}-page1-last-control-focus`); await key('Space');
        const original = sharedGoalKeyboardFixture[11], opener = { selector: `${panel} button`, text: '核对这一份原文', sourceKey: original.id };
        await page.waitForFunction((selector, id) => document.querySelector(selector)?.textContent.includes(`原编号：${id}`), {}, panel, original.id);
        await tabTo(opener, true); await capture(page, `${name}-page2-original-keyboard-focus`); await key('Enter'); await waitDialog();
        assert.equal((await focus(checkbox, 'long-original-unchecked')).checked, false); await capture(page, `${name}-long-original-checkbox-focus`);
        await key('Enter', checkbox, 'unchecked-checkbox-Enter'); assert.equal((await page.evaluate(sharedGoalKeyboardFocus, checkbox)).checked, false);
        await key('Shift+Tab', close, 'unchecked-back-to-close'); await capture(page, `${name}-long-original-owner-top-focus`); await key('Tab', checkbox, 'unchecked-close-to-checkbox'); await key('Tab', cancel, 'unchecked-checkbox-to-cancel');
        await key('Tab', close, 'unchecked-disabled-confirm-skipped-wrap'); await key('Shift+Tab', cancel, 'unchecked-reverse-wrap'); await key('Shift+Tab', checkbox, 'reverse-to-checkbox');
        await key('Space', checkbox, 'Space-confirms-ownership'); assert.equal((await page.evaluate(sharedGoalKeyboardFocus, checkbox)).checked, true);
        await key('Tab', cancel, 'checked-to-cancel'); await key('Tab', confirm, 'checked-to-confirm'); await key('Tab', close, 'checked-forward-wrap'); await key('Shift+Tab', confirm, 'checked-reverse-wrap');
        await capture(page, `${name}-confirm-focus-before-Escape`); await key('Escape'); await page.waitForSelector(modal, { hidden: true }); await focus(opener, 'Escape-natural-return');
        snapshots.afterEscape = await local(); await pass('Escape-zero-writes-natural-return', equal(initial, snapshots.afterEscape) && equal(sourceBefore, await page.evaluate(legacyBackupFacts)), 'Real keyboard ownership checkbox, complete Tab/ShiftTab cycle and Esc preserve all source/account data; focus returns to the actual second-page opener');
        await key('Enter'); await waitDialog(); assert.equal((await page.evaluate(sharedGoalKeyboardFocus, checkbox)).checked, false);
        await key('Space', checkbox, 'reopen-reconfirm'); await key('Tab', cancel, 'reopen-cancel-focus'); await key('Enter'); await page.waitForSelector(modal, { hidden: true }); await focus(opener, 'cancel-natural-return');
        snapshots.afterCancel = await local(); await pass('reopen-reset-and-cancel-zero-writes', equal(initial, snapshots.afterCancel), 'Reopen resets ownership checkbox; native Enter on ordinary cancel keeps every account value unchanged');
        await key('Enter'); await waitDialog(); assert.equal((await page.evaluate(sharedGoalKeyboardFocus, checkbox)).checked, false);
        await key('Space', checkbox, 'explicit-copy-check'); await key('Tab', cancel, 'copy-cancel'); await key('Tab', confirm, 'copy-confirm'); await capture(page, `${name}-keyboard-Enter-confirm`); await key('Enter');
        await page.waitForSelector(modal, { hidden: true, timeout: 15000 }); await focus(opener, 'committed-natural-return');
        snapshots.copied = await local(); assertOnlySharedGoalCopy(initial, snapshots.copied, original);
        const receipt = recoveryReceipts(snapshots.copied).find(row => row.value.sourceKey === original.id), epoch = accountRows(snapshots.copied, 'settings').find(row => row.key === 'localDataEpoch')?.value;
        const proof = verifySharedGoalReceiptHash(receipt, { ownerId: actor.ownerId, epoch, sourceSnapshot });
        await pass('Enter-one-exact-copy-and-receipt', true, 'Enter commits only the explicitly selected original as one exact local copy plus independently verified durable receipt; every pre-existing table/key/value remains');
        await key('Enter'); await waitDialog(); await key('Space', checkbox, 'replay-check'); await key('Tab', cancel, 'replay-cancel'); await key('Tab', confirm, 'replay-confirm'); await key('Space');
        await page.waitForSelector(modal, { hidden: true, timeout: 15000 }); await focus(opener, 'Space-replay-natural-return'); snapshots.replayed = await local();
        await pass('Space-confirm-idempotent', equal(snapshots.copied, snapshots.replayed), 'Space on original confirm button replays the same durable intent; no second copy, receipt or other account change');
        await tabTo({ selector: `${panel} button`, text: '查看恢复收据' }); await key('Enter');
        await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('已读取 1 份本账号恢复收据'), {}, panel);
        const comparison = { selector: `${panel} button`, text: `比较恢复副本：${original.title}` };
        await tabTo(comparison); await key('Enter'); await page.waitForSelector(modal, { visible: true }); await focus(close, 'comparison-initial-close');
        await key('Tab', { selector: `${modal} a[href="/goal"]` }, 'comparison-goal-link'); await key('Tab', { selector: `${modal} button`, text: '保留并返回' }, 'comparison-return');
        await key('Tab', close, 'comparison-forward-wrap'); await key('Shift+Tab', { selector: `${modal} button`, text: '保留并返回' }, 'comparison-reverse-wrap');
        await capture(page, `${name}-comparison-focus`); await key('Escape'); await page.waitForSelector(modal, { hidden: true }); await focus(comparison, 'comparison-natural-return');
        snapshots.final = await local(); const sourceAfter = await page.evaluate(legacyBackupFacts), sourceTransactions = await page.evaluate(() => window.__sharedSourceTransactions);
        await pass('comparison-keeps-data-source-and-queue', equal(snapshots.copied, snapshots.final) && equal(sourceBefore, sourceAfter) && sourceTransactions.length > 0 && sourceTransactions.every(tx => tx.mode === 'readonly') && accountRows(snapshots.final, 'outbox').every(row => row.entity !== 'goals') && writes.every(row => !row.body?.includes(receipt.value.copyId)), 'Comparison keyboard navigation/Esc never deletes or re-creates; source readonly, no automatic undo or Goal upload');
        await save('verified', { ownerId: actor.ownerId, sourceBefore, sourceAfter, sourceSnapshot, sourceTransactions, snapshots, states, writes, proof });
      } finally {
        // Preserve real failure facts too; a failed focus assertion never discards
        // the before/after source or account evidence gathered in this profile.
        await save('final', { ownerId: actor?.ownerId ?? null, sourceBefore, accountBefore: initial, snapshots, states, writes,
          accountAfter: actor ? await local().catch(error => ({ readError: error.name })) : null,
          sourceAfter: sourceBefore ? await page.evaluate(legacyBackupFacts).catch(error => ({ readError: error.name })) : null,
          sourceTransactions: await page.evaluate(() => window.__sharedSourceTransactions ?? []).catch(() => null) });
      }
    });
  }
  return { media };
}
