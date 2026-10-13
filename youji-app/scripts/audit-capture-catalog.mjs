// Hosted-CI extension of the existing capture-return profiles. Original product
// controls create all fixtures. This file never imports application modules.
import assert from 'node:assert/strict';
import { captureReturnChecks as checks } from './audit-capture-return-outcomes.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { waitSharedGoalTargetSettled } from './audit-shared-goal-recovery.mjs';

const COMPOSER = '[data-component="capture-composer"]', REVIEW = '[data-component="capture-review"]', MODAL = '[role="dialog"]';
export const CAPTURE_CATALOG_ENTRY = '查看本机未提交稿';
export const CAPTURE_CATALOG_LONG_LINES = Array.from({ length: 40 }, (_, i) => `  合成长原文第${String(i + 1).padStart(2, '0')}行：原始空白与末尾文字完整保留  `);
export const CAPTURE_CATALOG_LONG_RAW = CAPTURE_CATALOG_LONG_LINES.join('\n');
export function expectedCatalogLongDraft(id, inputKey, context, actor) {
  return { id, inputKey, input: CAPTURE_CATALOG_LONG_RAW, context, ownerId: actor.ownerId, dataEpoch: actor.dataEpoch, sessionRevision: actor.sessionRevision, sessionActive: actor.sessionActive,
    expenses: [], todos: [], habits: [], diary: CAPTURE_CATALOG_LONG_LINES.map(line => line.trim()).join('；'), diaryDate: context.date, mood: null, moodScore: null, moodConfirmed: false };
}

// Independent bounded parser for the displayed field notation. No eval/app
// formatter import; duplicate keys, trailing input and unsupported types reject.
export function parseCaptureReadonlyFields(source) {
  assert.equal(typeof source, 'string'); assert.ok(source.length <= 250000);
  let at = 0, nodes = 0;
  const space = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
  const string = () => {
    assert.equal(source[at], '"'); const start = at++;
    for (; at < source.length; at++) {
      const char = source[at];
      if (char === '"') { at++; return JSON.parse(source.slice(start, at)); }
      if (char === '\\') { at++; assert.ok(at < source.length); }
      else assert.ok(char.charCodeAt(0) >= 32, 'Raw control character');
    }
    throw Error('Unclosed displayed string');
  };
  const value = (depth = 0) => {
    assert.ok(depth <= 8 && ++nodes <= 10000); space(); const token = source[at];
    if (token === '"') return string();
    if (token === '{') {
      at++; space(); const result = {};
      if (source[at] === '}') { at++; return result; }
      for (;;) { space(); const key = string(); assert.equal(Object.hasOwn(result, key), false, 'Duplicate displayed key'); space(); assert.equal(source[at++], ':'); Object.defineProperty(result, key, { value: value(depth + 1), enumerable: true, configurable: true, writable: true }); space(); const next = source[at++]; if (next === '}') return result; assert.equal(next, ','); }
    }
    if (token === '[') {
      at++; space(); const result = []; if (source[at] === ']') { at++; return result; }
      for (;;) { result.push(value(depth + 1)); space(); const next = source[at++]; if (next === ']') return result; assert.equal(next, ','); }
    }
    for (const [literal, parsed] of [['undefined（字段存在）', undefined], ['null', null], ['true', true], ['false', false]]) if (source.startsWith(literal, at)) { at += literal.length; return parsed; }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(at)); assert.ok(match, 'Invalid field value'); at += match[0].length; const result = Number(match[0]); assert.ok(Number.isFinite(result)); return result;
  };
  const result = value(); space(); assert.equal(at, source.length, 'Unexpected displayed suffix'); return result;
}
export function captureCatalogEntrySelector(root) {
  const rows = [...document.querySelectorAll(`${root} button`)].filter(el => el.textContent.trim() === '查看本机未提交稿');
  if (rows.length !== 1) throw Error('Readonly opener is ambiguous');
  const parts = []; for (let el = rows[0]; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(node => node.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
  return 'body > ' + parts.join(' > ');
}

// Wrap methods that Dexie's cached native transaction factory cannot bypass.
// No extra request, transaction, promise, timer, abort or scheduling is created.
export function installCaptureCatalogWriteAudit() {
  if (globalThis.__captureCatalogAudit) throw Error('Prior catalog observer still installed');
  const state = { writes: [], keys: [], dropped: 0, restored: false, timeOrigin: performance.timeOrigin }, originals = [];
  const push = (where, value) => { if (state[where].length < 2000) state[where].push(value); else state.dropped++; };
  const wrap = (prototype, method, cursor) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    if (!descriptor || typeof descriptor.value !== 'function') throw Error(`Missing native ${method}`);
    const original = descriptor.value;
    const wrapped = function (...args) {
      const store = cursor ? this.source?.objectStore ?? this.source : this;
      push('writes', { method, cursor, database: store?.transaction?.db?.name ?? null, store: store?.name ?? null, mode: store?.transaction?.mode ?? null, time: performance.now() });
      return Reflect.apply(original, this, args);
    };
    Object.defineProperty(prototype, method, { ...descriptor, value: wrapped }); originals.push({ prototype, method, descriptor, wrapped });
  };
  const key = event => { if (event.key === 'Escape') push('keys', { key: event.key, trusted: event.isTrusted, tag: event.target?.tagName ?? null, time: performance.now() }); };
  try {
    for (const method of ['put', 'add', 'delete', 'clear']) wrap(IDBObjectStore.prototype, method, false);
    for (const method of ['update', 'delete']) wrap(IDBCursor.prototype, method, true);
    document.addEventListener('keydown', key, true);
    globalThis.__captureCatalogAudit = { snapshot: () => structuredClone(state), release: () => {
      const intact = originals.every(item => Object.getOwnPropertyDescriptor(item.prototype, item.method)?.value === item.wrapped);
      for (const item of originals) if (Object.getOwnPropertyDescriptor(item.prototype, item.method)?.value === item.wrapped) Object.defineProperty(item.prototype, item.method, item.descriptor);
      document.removeEventListener('keydown', key, true); state.restored = intact; const result = structuredClone(state); delete globalThis.__captureCatalogAudit; return result;
    } };
  } catch (error) { for (const item of originals) Object.defineProperty(item.prototype, item.method, item.descriptor); document.removeEventListener('keydown', key, true); throw error; }
}
export function captureCatalogEditorState(owner) {
  const editor = document.querySelector('[data-component="capture-composer"], [data-component="capture-review"]');
  if (!editor) throw Error('Original editor missing');
  return { href: location.href, input: sessionStorage.getItem(`youtrace:input:${owner}`), review: sessionStorage.getItem(`youtrace:active-review:${owner}`),
    fields: [...editor.querySelectorAll('input,textarea,select')].filter(el => !el.closest('[role=dialog]')).map(el => ({ tag: el.tagName, type: el.getAttribute('type'), label: el.getAttribute('aria-label'), value: el.value, checked: 'checked' in el ? el.checked : null, disabled: el.disabled })) };
}
export function assertCaptureCatalogUnchanged(before, after, editorBefore, editorAfter, audit) {
  assert.deepEqual(after.snapshot, before.snapshot, 'Every physical key, lossless row and schema stays exact; no settings exclusion');
  assert.deepEqual(after.local, before.local); assert.deepEqual(after.allEvents, before.allEvents);
  assert.deepEqual(editorAfter, editorBefore, 'Current editor values, URL and both active pointers remain exact');
  assert.equal(audit.dropped, 0); assert.deepEqual(audit.writes, [], 'No native write attempt, including aborted writes or another database');
}
// DOM Range measures existing text without inserting nodes or scrolling. Each
// original line must have all wrapped rects painted, unclipped and hit-testable.
export function captureCatalogRawLines(expected) {
  const nodes = [...document.querySelectorAll('[role=dialog] [aria-label="只读完整原文"]')];
  if (nodes.length !== 1 || nodes[0].textContent !== expected) throw Error('Exact complete readonly original is absent');
  const el = nodes[0], text = el.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE || el.childNodes.length !== 1) throw Error('Unexpected raw text structure');
  // A fixed Modal wrapper is viewport-relative only when every external
  // ancestor has complete, non-containing CSS. Keep its own panel overflow,
  // all paint checks and actual hit testing. Unknown CSS fails closed.
  const dialog = el.closest('[role=dialog]'), dialogFixed = dialog?.parentElement, dialogAncestors = [];
  if (dialogFixed && getComputedStyle(dialogFixed).position === 'fixed') for (let parent = dialogFixed.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    dialogAncestors.push(Object.fromEntries(['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter', 'backdropFilter', 'contain', 'willChange', 'containerType', 'contentVisibility', 'clip', 'clipPath', 'maskImage'].map(key => [key, css[key]])));
  }
  const viewportFixedDialog = Boolean(dialogFixed && getComputedStyle(dialogFixed).position === 'fixed') && dialogAncestors.every(css =>
    Object.values(css).every(value => typeof value === 'string' && value.length > 0) &&
    ['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter', 'backdropFilter', 'clipPath', 'maskImage'].every(key => css[key] === 'none') &&
    css.clip === 'auto' && css.contain === 'none' && css.willChange === 'auto' && css.containerType === 'normal' && css.contentVisibility === 'visible');
  let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, painted = true;
  for (let p = el; p; p = p.parentElement) {
    const style = getComputedStyle(p), rect = p.getBoundingClientRect();
    painted &&= style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) >= .99;
    const clipsThisTarget = !viewportFixedDialog || p === dialogFixed || dialogFixed.contains(p);
    if (p !== el && clipsThisTarget && /auto|scroll|hidden|clip/.test(style.overflowY)) { clip.top = Math.max(clip.top, rect.top); clip.bottom = Math.min(clip.bottom, rect.bottom); }
    if (p !== el && clipsThisTarget && /auto|scroll|hidden|clip/.test(style.overflowX)) { clip.left = Math.max(clip.left, rect.left); clip.right = Math.min(clip.right, rect.right); }
  }
  let offset = 0;
  const lines = expected.split('\n').map((value, index) => {
    const range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + value.length); offset += value.length + 1;
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, hit: el.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)) }));
    return { index, value, rects, visible: painted && rects.length > 0 && rects.every(r => r.hit && r.left >= clip.left - .5 && r.right <= clip.right + .5 && r.top >= clip.top - .5 && r.bottom <= clip.bottom + .5) };
  });
  const modal = el.closest('[role=dialog]');
  return { raw: el.textContent, clip, painted, viewportFixedDialog, dialogAncestors, whiteSpace: getComputedStyle(el).whiteSpace, horizontalFits: el.scrollWidth <= el.clientWidth + 1, scrollTop: modal.scrollTop, scrollHeight: modal.scrollHeight, clientHeight: modal.clientHeight, lines };
}
export function assertCaptureCatalogLines(states, expected) {
  assert.ok(states.length > 0 && states.length <= 61);
  const lines = expected.split('\n'), covered = new Set();
  for (const state of states) {
    assert.equal(state.raw, expected); assert.equal(state.horizontalFits, true); assert.ok(['pre-wrap', 'break-spaces'].includes(state.whiteSpace));
    assert.equal(state.lines.length, lines.length);
    for (const [index, row] of state.lines.entries()) {
      assert.equal(row.index, index); assert.equal(row.value, lines[index]);
      const c = state.clip, visible = state.painted === true && row.rects.length > 0 && row.rects.every(r => r.hit === true && ['left', 'top', 'right', 'bottom', 'width', 'height'].every(key => Number.isFinite(r[key])) && r.width > 0 && r.height > 0 && r.left >= c.left - .5 && r.right <= c.right + .5 && r.top >= c.top - .5 && r.bottom <= c.bottom + .5);
      assert.equal(row.visible, visible, 'Visible-line flag must agree with raw rect/hit evidence'); if (visible) covered.add(index);
    }
  }
  assert.deepEqual([...covered].sort((a,b) => a-b), lines.map((_,i) => i), 'Every original line must actually become visible');
}

export async function runCaptureCatalogReadOnly(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted CI only');
  const { page, label, current, reviewed, before, returnComposer, facts, readLedger, preserve, read, tap, retained, save, observe, mark, waitPath, capture, actions } = h;
  let latest = before;
  const show = async (pageKind, entries, { escape = false, long = false } = {}) => {
    const name = `catalog-${pageKind}`, root = pageKind.startsWith('composer') ? COMPOSER : REVIEW;
    const opener = `${root} button`, baseline = await facts(`${name}-before`), editorBefore = await page.evaluate(captureCatalogEditorState, current.ownerId);
    let firstError = null, audit = null, after = null, editorAfter = null;
    const collectionFailures = [];
    const tryCollect = async (part, fn) => { try { await fn(); } catch (error) { collectionFailures.push({ part, message: String(error?.message ?? error) }); } };
    await page.evaluate(installCaptureCatalogWriteAudit);
    try {
      await save(`${name}-editor-before`, editorBefore);
      mark(name); await tap(opener, CAPTURE_CATALOG_ENTRY);
      await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] h3')].some(el => el.textContent === '查看本机未提交稿（只读）'), { timeout: 7000 });
      await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent.includes('本次读取的主键顺序'), { timeout: 7000 });
      const modal = await page.$(MODAL); assert.ok(modal);
      try { await save(`${name}-modal-settled`, await modal.evaluate(waitSharedGoalTargetSettled)); } finally { await modal.dispose(); }
      await save(`${name}-title-reading`, await read(`${MODAL} h3`, '查看本机未提交稿（只读）')); await capture(page, `${label}-${name}-directory`);
      for (const [index, entry] of entries.entries()) {
        const selector = `${MODAL} button[aria-label=${JSON.stringify(`查看原稿 ${entry.id}`)}]`;
        await tap(selector); await page.waitForSelector(`${MODAL} [aria-label="只读完整原文"]`, { visible: true, timeout: 7000 });
        assert.equal(await page.$eval(`${MODAL} [aria-label="只读完整原文"]`, el => el.textContent), entry.input);
        const identity = await read(`${MODAL} [aria-label="已核验原稿只读详情"] > p`, `原编号：${entry.id} · 已核验的本机只读快照`);
        if (!long) await read(`${MODAL} [aria-label="只读完整原文"]`);
        else {
          const states = [], seen = new Set();
          for (let attempt = 0; attempt <= 60; attempt++) {
            const state = await page.evaluate(captureCatalogRawLines, entry.input); states.push(state);
            for (const row of state.lines) if (row.visible) seen.add(row.index);
            await save(`${name}-line-geometry`, { states });
            if (state.lines.some(row => row.visible)) await capture(page, `${label}-${name}-lines-${attempt}`);
            if (seen.size === entry.input.split('\n').length) break;
            assert.ok(attempt < 60, 'Bounded native line scrolling exhausted');
            const unseen = state.lines.find(row => !seen.has(row.index)), rect = unseen.rects[0]; assert.ok(rect);
            const deltaY = rect.top < state.clip.top ? -Math.max(80, (state.clip.bottom - state.clip.top) * .6) : Math.max(80, (state.clip.bottom - state.clip.top) * .6);
            const x = (state.clip.left + state.clip.right) / 2, y = (state.clip.top + state.clip.bottom) / 2;
            await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-catalog-long-wheel', surface: label, attempt, deltaY, x, y });
            await page.waitForFunction(old => document.querySelector('[role=dialog]')?.scrollTop !== old, { timeout: 2000 }, state.scrollTop);
            const rawHandle = await page.$(`${MODAL} [aria-label="只读完整原文"]`); assert.ok(rawHandle);
            try { actions.push({ kind: 'catalog-wheel-settled', attempt, ...await rawHandle.evaluate(waitSharedGoalTargetSettled) }); } finally { await rawHandle.dispose(); }
          }
          assertCaptureCatalogLines(states, entry.input);
        }
        const choiceReadings = [];
        if (!long) {
          for (const row of entry.expenses) choiceReadings.push(await read(`${MODAL} p`, `收支 ${row.id}：${row.confirmed ? '已选' : '未选'} · ${row.name} · 金额原值 ${row.amount} 分 · 日期 ${row.date ?? '未知'} · 类别 ${row.category}${row.isIncome ? ' · 收入' : ' · 支出'}`));
          for (const row of entry.todos) choiceReadings.push(await read(`${MODAL} p`, `待办 ${row.id}：${row.confirmed ? '已选' : '未选'} · ${row.text} · 日期 ${row.dueDate ?? '无已知日期'}`));
          choiceReadings.push(await read(`${MODAL} p`, `日记：${entry.diary === null ? '未选择日记正文' : entry.diary} · 日期 ${entry.diaryDate ?? '未知'}`));
          await capture(page, `${label}-${name}-choices-${index}`);
        }
        await tap(`${MODAL} summary`, '查看全部原始字段（只读）');
        assert.equal(await page.$eval(`${MODAL} details`, el => el.open), true);
        await read(`${MODAL} details p`, '用于核对字段及类型，不是可导入备份格式；未出现的字段表示原稿缺席。');
        const displayed = await page.$eval(`${MODAL} [aria-label="已核验原稿只读详情"]`, el => ({ text: el.textContent, editable: el.querySelectorAll('input,textarea,select').length, fields: el.querySelector('[aria-label="只读完整字段"]')?.textContent }));
        assert.equal(displayed.editable, 0); assert.deepEqual(parseCaptureReadonlyFields(displayed.fields), entry, 'Every displayed raw field/type must decode to the exact selected source');
        for (const row of entry.expenses) assert.ok(displayed.text.includes(`收支 ${row.id}：${row.confirmed ? '已选' : '未选'} · ${row.name} · 金额原值 ${row.amount} 分`));
        for (const row of entry.todos) assert.ok(displayed.text.includes(`待办 ${row.id}：${row.confirmed ? '已选' : '未选'} · ${row.text}`));
        assert.ok(displayed.text.includes(entry.diary ?? '未选择日记正文'));
        await save(`${name}-detail-${index}`, { identity, expected: entry, displayed, choiceReadings, fullFieldsEvidence: 'Expanded original disclosure; whole typed text independently decoded. No claim that every full-field line was separately read or screenshot-reviewed.' }); await capture(page, `${label}-${name}-detail-${index}`);
        if (index < entries.length - 1 || !escape) { await tap(`${MODAL} button`, '返回目录'); await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent.includes('本次读取的主键顺序') && !document.querySelector('[aria-label="只读完整原文"]'), { timeout: 7000 }); }
      }
      if (escape) { actions.push({ kind: 'native-catalog-key', surface: label, key: 'Escape', pageKind }); await page.keyboard.press('Escape'); }
      else await tap(`${MODAL} button`, '关闭查看');
      await page.waitForSelector(MODAL, { hidden: true, timeout: 7000 });
      await page.waitForFunction(({ root, entry }) => document.activeElement?.matches(`${root} button`) && document.activeElement.textContent.trim() === entry, { timeout: 7000 }, { root, entry: CAPTURE_CATALOG_ENTRY });
      const focus = await page.evaluate(root => { const active = document.activeElement; return { matches: active?.matches(`${root} button`), text: active?.textContent.trim(), focusedVisible: active?.matches(':focus-visible') }; }, root);
      const returnedSelector = await page.evaluate(captureCatalogEntrySelector, root);
      const visibleFocus = await page.evaluate(initialSessionGeometry, returnedSelector); assert.equal(visibleFocus.visible, true, 'Natural modal return focus must already be painted and unobscured; no scrolling rescue'); await save(`${name}-natural-return-focus`, { focus, visibleFocus, escape }); await capture(page, `${label}-${name}-closed-focus`);
      after = await facts(`${name}-after`); editorAfter = await page.evaluate(captureCatalogEditorState, current.ownerId); audit = await page.evaluate(() => globalThis.__captureCatalogAudit.snapshot());
      assertCaptureCatalogUnchanged(baseline, after, editorBefore, editorAfter, audit);
      if (escape) assert.equal(audit.keys.filter(row => row.key === 'Escape' && row.trusted).length, 1);
      await save(`${name}-readonly-result`, { editorBefore, editorAfter, audit, exactSourceAndLedger: true });
      await observe(page, `${label}-${name}-readonly-existing-draft-view`, true, 'Original Modal controls and exact selected originals/corrections; full account lossless keys/rows/schema and GET ledger equal, original editor/pointers unchanged, no native write attempts; close focus observed');
      latest = after;
    } catch (error) {
      firstError = error;
      await tryCollect('first-error', () => save(`${name}-FIRST-FAILURE`, { name: error.name, message: error.message }));
      await tryCollect('editor-before', () => save(`${name}-failure-editor-before`, editorBefore));
      await tryCollect('editor-after', async () => { editorAfter = await page.evaluate(captureCatalogEditorState, current.ownerId); await save(`${name}-failure-editor-after`, editorAfter); });
      await tryCollect('audit', async () => { audit = await page.evaluate(() => globalThis.__captureCatalogAudit.snapshot()); await save(`${name}-failure-audit`, audit); });
      await tryCollect('screenshot', () => capture(page, `${label}-${name}-FIRST-FAILURE`));
      await tryCollect('source', async () => { after = await facts(`${name}-failure`, { settle: false }); });
      // Independent GET corroboration still runs if the local snapshot above
      // failed. Its own failure is recorded, never substituted for missing IDB.
      await tryCollect('ledger', async () => { await save(`${name}-failure-ledger`, await readLedger()); });
    } finally {
      await tryCollect('restore-audit', async () => { const released = await page.evaluate(() => globalThis.__captureCatalogAudit.release()); await save(`${name}-audit-restored`, released); assert.equal(released.restored, true); assert.equal(released.dropped, 0); });
      await tryCollect('collection-log', () => save(`${name}-collection-results`, { originalError: firstError?.message ?? null, collectionFailures }));
    }
    if (firstError) throw firstError;
    assert.deepEqual(collectionFailures, [], 'Successful UI cannot conceal incomplete evidence or observer restoration');
  };
  await show('review', reviewed.slice(0, 2));
  const returned = await returnComposer(latest, current, 'catalog-return-to-composer'); latest = returned.frozen;
  await show('composer', reviewed.slice(0, 2), { escape: true });
  await tap(`${COMPOSER} button`, '查看确认稿'); await waitPath(page, '/quick-note/result'); await retained();
  assert.equal(new URL(page.url()).searchParams.get('draft'), current.id);
  const reopened = await facts('catalog-current-D-reopened'); assert.ok(checks.draftBound(reopened, current.id, current)); await preserve(latest, reopened, 'catalog-current-D-exact-reopen');
  return { facts: reopened, show };
}

export async function runCaptureCatalogLongOriginal(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted CI only');
  const { page, label, before, current, returnComposer, input, facts, preserve, tap, retained, waitPath, save, mark } = h;
  mark('catalog-long-original-native-preparation');
  const returned = await returnComposer(before, current, 'catalog-long-from-speech');
  await input(`${COMPOSER} textarea[aria-label="速记内容"]`, CAPTURE_CATALOG_LONG_RAW);
  await page.waitForFunction(() => document.querySelector('[data-component="capture-composer"] [role=status]')?.textContent === '原文已保留在本机', { timeout: 7000 });
  const typed = await facts('catalog-long-native-typed'); await preserve(returned.frozen, typed, 'catalog-long-exact-input-only', { writes: { [returned.fork.key]: CAPTURE_CATALOG_LONG_RAW } });
  await tap(`${COMPOSER} button`, '查看确认稿'); await waitPath(page, '/quick-note/result'); await retained();
  const id = new URL(page.url()).searchParams.get('draft'); assert.ok(id && id !== current.id);
  const expected = expectedCatalogLongDraft(id, returned.fork.key, returned.fork.context, current), opened = await facts('catalog-long-original-review');
  assert.ok(checks.newReviewExactly(typed, opened, expected));
  await preserve(typed, opened, 'catalog-long-one-native-uncommitted-review', { writes: { [`capture-review:${id}`]: expected, quicknote_review: expected } });
  await save('catalog-long-fixture-prepared', { syntheticOnly: true, preparedThroughOriginalControls: true, expected, priorSourceIds: h.reviewed.map(row => row.id), notBusinessSave: true });
  // Reuse the same exact readonly-window contract, but retain this distinct
  // long-original preparation as a new, uncommitted synthetic current draft.
  await h.show('review-long', [expected], { escape: true, long: true });
  return { draft: expected, facts: await facts(`${label}-catalog-long-final`) };
}
