// One native, in-page filter/correction tail over the existing nine records.
// No new profile, fixture write, app-state injection or database reader.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { timelineKeyboardChecks } from './audit-timeline-keyboard.mjs';

const SECTION = 'section[aria-labelledby="expense-detail-title"]';
const MONTH = '#expense-filter-month', CATEGORY = '#expense-filter-category';
const names = { food: '餐饮', transport: '交通', entertainment: '娱乐', study: '学习', daily: '日用', other: '其他' };
const money = value => (value / 100).toFixed(2);
const normalize = value => value.replace(/\s+/g, ' ').trim();
const positive = value => Number.isFinite(value?.width) && value.width > 0 && Number.isFinite(value?.height) && value.height > 0;
const painted = value => positive(value?.rect) && Array.isArray(value.styles) && value.styles.length > 0 && value.styles.every(style => style.display !== 'none' && style.visibility === 'visible' && Number.isFinite(Number(style.opacity)) && Number(style.opacity) >= .99 && style.contentVisibility !== 'hidden');
const identity = row => ({ id: row.id, name: row.name, detail: `${names[row.category]} · ${row.date} · 编辑`, aria: `编辑记账 ${row.name} ${row.date} ${row.isIncome ? '收入' : '支出'} ${money(row.amount)}元`, amount: `${row.isIncome ? '+' : '-'}¥${money(row.amount)}` });
const sort = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));

function scopeResult(surface, rows, { month = '', category = '' } = {}) {
  const expected = rows.filter(row => (!month || row.date.slice(0, 7) === month) && (!category || row.category === category)).map(identity);
  const categoryValue = category ? `category:${category}` : '';
  const status = `当前明细：${month || '所有月份'} · ${category ? names[category] : '所有类别'}，显示 ${expected.length} / ${rows.length} 笔`;
  const actual = (surface.rows ?? []).map(({ id, name, detail, aria, amount }) => ({ id, name, detail, aria, amount }));
  return { pass: surface.heading === '花销明细' && surface.month?.label === '月份' && surface.category?.label === '类别' &&
    surface.month?.value === month && surface.month?.selected === (month || '所有月份') && surface.category?.value === categoryValue && surface.category?.selected === (category ? names[category] : '所有类别') &&
    normalize(surface.status ?? '') === status && new Set(actual.map(row => row.id)).size === actual.length && isDeepStrictEqual(sort(actual), sort(expected)) &&
    (surface.rows ?? []).every(row => ['button', 'name', 'detail', 'amount'].every(key => painted(row.paint?.[key]))) &&
    surface.clear?.disabled === (!month && !category) && (expected.length > 0 ? surface.empty === null : surface.empty === '没有符合当前筛选的记录'),
  expected, actual, status, selection: { month, category }, note: 'Membership is rendered layout, including normal offscreen rows; only separately retained read points claim viewport readability. IDs corroborate the full visible dated name/type/cents/category.' };
}

function categorySaveResult(before, after, id, category, checks) {
  const localBefore = before.local.expenses.find(row => row.id === id), localAfter = after.local.expenses.find(row => row.id === id);
  const serverBefore = before.server.find(row => row.id === id), serverAfter = after.server.find(row => row.id === id);
  const draftKey = `record-draft:expense:${id}`;
  return Boolean(localBefore && localAfter && serverBefore && serverAfter) && checks.acknowledged(after, id) && checks.validVersion(checks.version(before, id)) && BigInt(checks.version(after, id)) > BigInt(checks.version(before, id)) &&
    checks.onlyChanges(localBefore, localAfter, ['category']) && checks.onlyChanges(serverBefore, serverAfter, ['category', 'updatedAt']) && localAfter.category === category && serverAfter.category === category &&
    checks.sameRows(before.local.expenses.filter(row => row.id !== id), after.local.expenses.filter(row => row.id !== id)) && checks.sameRows(before.server.filter(row => row.id !== id), after.server.filter(row => row.id !== id)) &&
    checks.settingsPreserved(before, after, { expenseChange: { id, version: checks.version(after, id) } }) && !after.local.settings.some(row => row.key === draftKey) &&
    checks.oneNewExpenseEvent(before, after, id) && isDeepStrictEqual(after.allEvents.at(-1).data, serverAfter);
}

export const expenseFilterAuditChecks = { scopeResult, categorySaveResult, identity };

export async function runExpenseFilterDifference(h, options) {
  const { page, label, ids, values, beforeTimeline, checks, enter, facts, read, exact, tap, visibleRow, open, readyDraft, category, editor, save, cancelEditor, statistics } = options;
  const { capture, observe, actions, artifacts, writeFile, join, sleep } = h;
  const prefix = `${label}-filters`, expected = values.map((value, index) => ({ id: ids[index], ...value }));
  const saveJSON = (stage, value) => writeFile(join(artifacts, `${prefix}-${stage}.json`), JSON.stringify({ syntheticOnly: true, observedAt: new Date().toISOString(), ...value }, null, 2));
  async function surface() {
    return page.evaluate(({ section, month, category }) => {
      const root = document.querySelector(section);
      const paint = node => {
        if (!node) return null;
        const r = node.getBoundingClientRect(), styles = [];
        for (let element = node; element; element = element.parentElement) { const s = getComputedStyle(element); styles.push({ display: s.display, visibility: s.visibility, opacity: s.opacity, contentVisibility: s.contentVisibility }); }
        return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, styles };
      };
      const control = selector => { const node = document.querySelector(selector); return node ? { value: node.value, selected: node.selectedOptions[0]?.textContent.trim(), label: [...node.labels].map(label => label.querySelector(':scope > span')?.textContent.trim()).join(' '), options: [...node.options].map(option => ({ value: option.value, text: option.textContent.trim() })) } : null; };
      const clear = [...(root?.querySelectorAll('button') ?? [])].find(node => node.textContent.trim() === '清除筛选');
      return { heading: root?.querySelector('h4')?.textContent, month: control(month), category: control(category), scope: root?.querySelector('#expense-detail-scope')?.textContent, status: root?.querySelector('[role=status]')?.textContent, clear: clear ? { disabled: clear.disabled } : null,
        empty: [...(root?.querySelectorAll('p') ?? [])].find(node => node.textContent.trim() === '没有符合当前筛选的记录')?.textContent ?? null,
        rows: [...document.querySelectorAll('main button[aria-label^="编辑记账 "]')].map(node => { const name = node.querySelector('p'), detail = node.querySelectorAll('p')[1], amount = node.querySelector('span[aria-label]'); return { id: node.id.replace(/^expense-record-/, ''), name: name?.textContent, detail: detail?.textContent, aria: node.getAttribute('aria-label'), amount: amount?.textContent, paint: { button: paint(node), name: paint(name), detail: paint(detail), amount: paint(amount) } }; }) };
    }, { section: SECTION, month: MONTH, category: CATEGORY });
  }
  async function stable() {
    const started = Date.now(); let last = null, since = null, value;
    do {
      value = await surface(); const key = JSON.stringify(value);
      const completePaint = value.month && value.category && value.rows.every(row => ['button', 'name', 'detail', 'amount'].every(part => painted(row.paint[part])));
      if (completePaint && key === last) since ??= Date.now(); else since = null;
      if (since !== null && Date.now() - since >= 100 && Date.now() - started <= 2200) return value;
      last = key; await sleep(50);
    } while (Date.now() - started < 2200);
    await saveJSON('unstable-surface', { value, elapsedMs: Date.now() - started }); throw new Error('Filter list did not settle within the original local observation bound');
  }
  async function choose(selector, value) {
    const options = await page.$eval(selector, node => [...node.options].map(option => ({ value: option.value, text: option.textContent.trim() })));
    const index = options.findIndex(option => option.value === value); assert.ok(index >= 0, 'Declared native option must exist');
    await tap(page, selector); await page.keyboard.press('Home'); for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
    assert.equal(await page.$eval(selector, node => node.value), value);
    actions.push({ kind: 'native-expense-filter-selection', surface: label, selector, option: options[index] });
  }
  async function checkpoint(stage, rows, selection, frozen) {
    const initial = await stable(), monthRead = await read(page, MONTH), categoryRead = await read(page, CATEGORY), localScopeRead = await read(page, '#expense-local-scope');
    assert.ok(localScopeRead.visible && localScopeRead.text.includes('本机记录') && localScopeRead.text.includes(`已加载 ${rows.length} 笔`));
    const disclosure = `${SECTION} details.expense-scope-disclosure`;
    assert.equal(await page.$eval(disclosure, node => node.open), false, 'Detailed scope starts collapsed so the real ledger remains primary');
    await tap(page, `${disclosure} summary`);
    assert.equal(await page.$eval(disclosure, node => node.open), true);
    const scopeRead = await read(page, '#expense-detail-scope');
    await tap(page, `${disclosure} summary`);
    assert.equal(await page.$eval(disclosure, node => node.open), false);
    const statusRead = await read(page, `${SECTION} [role=status]`);
    assert.ok(monthRead.visible && categoryRead.visible);
    assert.ok(scopeRead.visible && scopeRead.text.includes('仅筛选本机当前已加载的记录') && scopeRead.text.includes('不代表远端全部历史') && scopeRead.text.includes('统计不随明细筛选变化'));
    const final = await stable(), result = scopeResult(final, rows, selection);
    assert.ok(scopeResult(initial, rows, selection).pass && statusRead.visible && normalize(statusRead.text) === result.status);
    if (!result.expected.length) { const empty = await read(page, await exact(page, `${SECTION} p`, '没有符合当前筛选的记录')); assert.ok(empty.visible); }
    await capture(page, `${prefix}-${stage}`); await saveJSON(stage, { initial, final, monthRead, categoryRead, localScopeRead, scopeRead, statusRead, result });
    await observe(page, `${prefix}-${stage}-exact-loaded-membership`, result.pass, JSON.stringify(result)); assert.ok(result.pass);
    const after = await facts(`${prefix}-${stage}`); assert.ok(checks.businessSourcesPreserved(frozen, after), 'Reading and selecting filters cannot rewrite any sampled source or ledger'); return after;
  }

  const initial = await facts(`${prefix}-before-navigation`);
  assert.ok(checks.changedOnlyTarget(beforeTimeline, initial, ids[1], 1111) && checks.declaredRecordsMatch(initial, ids, values), 'Keep the complete accepted prefix bound through the new tail');
  await enter(page); const arrived = await facts(`${prefix}-arrived`); assert.ok(checks.businessSourcesPreserved(initial, arrived));
  await saveJSON('declaration', { expected, targetId: ids[3], change: { category: 'other → food' }, scope: 'Existing loaded nine records; local filters only; same-page modal cancel/save return, not reload or remote-history search' });
  await checkpoint('all', expected, {}, arrived);
  await choose(MONTH, '2026-09'); await checkpoint('september', expected, { month: '2026-09' }, arrived);
  await choose(CATEGORY, 'category:food'); await checkpoint('september-food', expected, { month: '2026-09', category: 'food' }, arrived);
  await choose(CATEGORY, 'category:transport'); const zero = await checkpoint('zero-result', expected, { month: '2026-09', category: 'transport' }, arrived);
  await statistics(page, zero.local.expenses, `${prefix}-zero-filter-does-not-change-periods`);
  await tap(page, `${SECTION} button`, '清除筛选'); await checkpoint('cleared', expected, {}, arrived);
  await choose(MONTH, '2026-09'); await choose(CATEGORY, 'category:other');
  const before = await checkpoint('before-edit', expected, { month: '2026-09', category: 'other' }, arrived), target = before.local.expenses.find(row => row.id === ids[3]); assert.ok(target);
  await open(page, target); await category(page, 'food'); await readyDraft(page); const typed = await editor(page);
  assert.deepEqual(typed, { name: target.name, date: target.date, amount: money(target.amount), category: 'food', isIncome: target.isIncome });
  const prepared = await facts(`${prefix}-prepared`), draftResult = timelineKeyboardChecks.draftWriteResult(before, prepared, target.id, typed, checks);
  await saveJSON('prepared-draft', { typed, draftResult }); assert.ok(draftResult.pass, 'Only the exact retained draft may differ from the pre-open source');
  await cancelEditor(page); await checkpoint('cancel-keeps-original-row-and-filters', expected, { month: '2026-09', category: 'other' }, prepared);
  const row = await visibleRow(page, target); await tap(page, row.selector); await readyDraft(page); assert.deepEqual(await editor(page), typed, 'Reopen must restore the same changed category without retyping');
  assert.ok(checks.businessSourcesPreserved(prepared, await facts(`${prefix}-reopened`)));
  await save(page); const saved = await facts(`${prefix}-saved`), changedValues = values.map((value, index) => index === 3 ? { ...value, category: 'food' } : value);
  const exactSave = categorySaveResult(before, saved, target.id, 'food', checks) && checks.declaredRecordsMatch(saved, ids, changedValues);
  await saveJSON('save-result', { exactSave, id: target.id, before: target, after: saved.local.expenses.find(row => row.id === target.id), settingsDifferences: checks.settingsDifferences(before, saved) }); assert.ok(exactSave, 'One category-only same-ID save must preserve every other original field, neighbor and ledger prefix');
  const changed = changedValues.map((value, index) => ({ id: ids[index], ...value }));
  await checkpoint('saved-target-leaves-other', changed, { month: '2026-09', category: 'other' }, saved);
  await choose(CATEGORY, 'category:food'); await checkpoint('corrected-same-id-found-in-food', changed, { month: '2026-09', category: 'food' }, saved); await visibleRow(page, changed[3]);
  await tap(page, `${SECTION} button`, '清除筛选'); await checkpoint('final-nine-records', changed, {}, saved);
  await statistics(page, saved.local.expenses, `${prefix}-final-periods`);
  const final = await facts(`${prefix}-terminal`); assert.ok(checks.businessSourcesPreserved(saved, final) && checks.declaredRecordsMatch(final, ids, changedValues));
  await observe(page, `${prefix}-complete-category-only-correction-and-in-page-return`, true, JSON.stringify({ id: target.id, beforeCategory: 'other', afterCategory: 'food', records: 9, scope: 'Native local-filter operations; original amount/date/type and all other sampled fields retained; no new fixture or second Save' }));
}
