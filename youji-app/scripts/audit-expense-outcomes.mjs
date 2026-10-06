// Expense/Budget native RED baseline. Hosted synthetic CI only. Normal records
// originate in rendered controls; every API call below is a GET observation.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHabitAuditClock, installAuditDate } from './audit-clock.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { preparePreferencePointer } from './audit-preference-pointer.mjs';

const TODAY = '2026-10-07';
const NAME = 'Synthetic 同名记账';
const BUDGET = 'section[aria-label="月预算"]';
const BUDGET_INPUT = `${BUDGET} input[placeholder="可明确设为 0"]`;
const EXPENSE_KEYS = ['name', 'amount', 'category', 'date', 'isIncome'];
const PROFILES = [
  { scenarioSet: 'records', width: 1280, phone: '13900008861', nickname: 'Synthetic YE R1280' },
  { scenarioSet: 'records', width: 360, phone: '13900008862', nickname: 'Synthetic YE R360' },
  { scenarioSet: 'budget', width: 1280, phone: '13900008863', nickname: 'Synthetic YE B1280' },
  { scenarioSet: 'budget', width: 360, phone: '13900008864', nickname: 'Synthetic YE B360' },
];
const validVersion = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const version = (facts, id) => facts.local.settings.find(row => row.key === `sync-version:expenses:${id}`)?.value;
const yuan = fen => (fen / 100).toFixed(2);
const sameRows = (left, right) => isDeepStrictEqual([...left].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key))), [...right].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key))));
const budgetRows = local => local.settings.filter(row => ['monthBudget', 'monthBudgetConfigured'].includes(row.key));
function onlyChanges(before, after, allowed) {
  return Boolean(before && after) && [...new Set([...Object.keys(before), ...Object.keys(after)])].every(key => allowed.includes(key) || Object.hasOwn(before, key) === Object.hasOwn(after, key) && isDeepStrictEqual(before[key], after[key]));
}
function settingsDifferences(before, after) {
  return [...new Set([...before.local.settings, ...after.local.settings].map(row => row.key))].sort().flatMap(key => {
    const left = before.local.settings.find(row => row.key === key), right = after.local.settings.find(row => row.key === key);
    return isDeepStrictEqual(left, right) ? [] : [{ key, beforePresent: left !== undefined, afterPresent: right !== undefined, before: left ?? null, after: right ?? null }];
  });
}
function settingsPreserved(before, after, { allowBudgetChange = false, expenseChange, reload = false } = {}) {
  return settingsDifferences(before, after).every(diff => {
    const valueOnly = diff.after && Object.keys(diff.after).every(key => ['key', 'value'].includes(key)) && (!diff.before || onlyChanges(diff.before, diff.after, ['value']));
    const advancingTimestamp = valueOnly && typeof diff.after.value === 'string' && Number.isFinite(Date.parse(diff.after.value)) && (!diff.before || typeof diff.before.value === 'string' && Date.parse(diff.after.value) >= Date.parse(diff.before.value));
    if (diff.key === 'lastPullAt') return advancingTimestamp;
    if (allowBudgetChange && ['monthBudget', 'monthBudgetConfigured'].includes(diff.key)) return Boolean(valueOnly);
    if (expenseChange && diff.key === 'lastPushAt') return advancingTimestamp;
    if (expenseChange && diff.key === `sync-version:expenses:${expenseChange.id}`) return valueOnly && diff.after.value === expenseChange.version;
    if (expenseChange && diff.key === `record-draft:expense:${expenseChange.id}`) return diff.beforePresent && !diff.afterPresent;
    if (reload && diff.key === 'syncV2Cursor') {
      const previous = diff.before?.value ?? '0', latest = (after.allEvents ?? after.events).at(-1)?.seq ?? '0';
      return valueOnly && (previous === '0' || validVersion(previous)) && (latest === '0' || validVersion(latest)) && diff.after.value === latest && BigInt(latest) >= BigInt(previous) && isDeepStrictEqual(before.allEvents ?? before.events, after.allEvents ?? after.events);
    }
    return false;
  });
}
function businessSourcesPreserved(before, after, options = {}) {
  return Array.isArray(before.allEvents) && Array.isArray(after.allEvents) && isDeepStrictEqual(before.events, before.allEvents.filter(row => row.entity === 'expenses')) && isDeepStrictEqual(after.events, after.allEvents.filter(row => row.entity === 'expenses')) && sameRows(before.local.expenses, after.local.expenses) && sameRows(before.server, after.server) && settingsPreserved(before, after, options) && isDeepStrictEqual(before.local.outbox, after.local.outbox) && isDeepStrictEqual(before.events, after.events) && isDeepStrictEqual(before.allEvents, after.allEvents);
}
function oneNewExpenseEvent(before, after, id) {
  if (!Array.isArray(before.allEvents) || !Array.isArray(after.allEvents)) return false;
  if (!isDeepStrictEqual(before.events, before.allEvents.filter(row => row.entity === 'expenses')) || !isDeepStrictEqual(after.events, after.allEvents.filter(row => row.entity === 'expenses'))) return false;
  const prefixPreserved = isDeepStrictEqual(before.allEvents, after.allEvents.slice(0, before.allEvents.length)) && isDeepStrictEqual(before.events, after.events.slice(0, before.events.length));
  const added = after.allEvents.slice(before.allEvents.length), expenseAdded = after.events.slice(before.events.length);
  return prefixPreserved && added.length === 1 && expenseAdded.length === 1 && isDeepStrictEqual(added[0], expenseAdded[0]) && added[0].entity === 'expenses' && added[0].entityId === id && added[0].operation === 'upsert' && added[0].data?.id === id && validVersion(added[0].seq) && (!before.allEvents.length || BigInt(added[0].seq) > BigInt(before.allEvents.at(-1).seq));
}
function expenseRowsFromLedger(events) {
  const rows = new Map(); let previous = 0n;
  for (const event of events) {
    assert.ok(validVersion(event.seq) && BigInt(event.seq) > previous, 'Complete ledger must have strictly increasing canonical sequence strings'); previous = BigInt(event.seq);
    if (event.entity !== 'expenses') continue;
    assert.ok(['upsert', 'delete'].includes(event.operation), 'Unknown Expense operation');
    if (event.operation === 'delete') rows.delete(event.entityId);
    else { assert.equal(event.data?.id, event.entityId, 'Raw server payload identity must match its event'); rows.set(event.entityId, event.data); }
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function expectedTotals(rows, today = TODAY) {
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  const reference = new Date(`${today}T12:00:00Z`), monday = new Date(reference);
  monday.setUTCDate(reference.getUTCDate() - ((reference.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10), month = today.slice(0, 7);
  const sum = (from, income) => rows.filter(row => row.date >= from && row.date <= today && Boolean(row.isIncome) === income).reduce((total, row) => {
    assert.ok(Number.isSafeInteger(row.amount) && row.amount > 0, 'Recorded amounts must be positive exact cents');
    assert.ok(Number.isSafeInteger(total + row.amount), 'Audit total must remain an exact integer'); return total + row.amount;
  }, 0);
  return { today: sum(today, false), week: sum(weekStart, false), month: sum(`${month}-01`, false), monthIncome: sum(`${month}-01`, true), weekStart, through: today };
}
function acknowledged(facts, id) {
  const local = facts.local.expenses.find(row => row.id === id), remote = facts.server.find(row => row.id === id);
  const last = facts.events.filter(event => event.entityId === id).at(-1);
  return Boolean(local && remote && last?.operation === 'upsert') && facts.local.outbox.length === 0 && validVersion(version(facts, id)) && version(facts, id) === last.seq && !facts.local.settings.some(row => row.key === `sync-conflict:expenses:${id}`) && EXPENSE_KEYS.every(key => isDeepStrictEqual(local[key], remote[key]));
}
function changedOnlyTarget(before, after, id, expected) {
  const localBefore = before.local.expenses.find(row => row.id === id), localAfter = after.local.expenses.find(row => row.id === id);
  const serverBefore = before.server.find(row => row.id === id), serverAfter = after.server.find(row => row.id === id);
  return acknowledged(after, id) && validVersion(version(before, id)) && BigInt(version(after, id)) > BigInt(version(before, id)) &&
    onlyChanges(localBefore, localAfter, ['amount']) && onlyChanges(serverBefore, serverAfter, ['amount', 'updatedAt']) && localAfter.amount === expected && serverAfter.amount === expected &&
    sameRows(before.local.expenses.filter(row => row.id !== id), after.local.expenses.filter(row => row.id !== id)) && sameRows(before.server.filter(row => row.id !== id), after.server.filter(row => row.id !== id)) &&
    sameRows(before.local.settings.filter(row => row.key.startsWith('sync-version:expenses:') && row.key !== `sync-version:expenses:${id}`), after.local.settings.filter(row => row.key.startsWith('sync-version:expenses:') && row.key !== `sync-version:expenses:${id}`)) &&
    settingsPreserved(before, after, { expenseChange: { id, version: version(after, id) } }) && oneNewExpenseEvent(before, after, id) && after.allEvents.at(-1).data.amount === expected;
}
function createdOnlyDeclared(before, after, declared) {
  const added = after.local.expenses.filter(row => !before.local.expenses.some(old => old.id === row.id)), remoteAdded = after.server.filter(row => !before.server.some(old => old.id === row.id));
  if (added.length !== 1 || remoteAdded.length !== 1 || added[0].id !== remoteAdded[0].id) return false;
  const id = added[0].id;
  return before.local.outbox.length === 0 && acknowledged(after, id) && EXPENSE_KEYS.every(key => isDeepStrictEqual(added[0][key], declared[key]) && isDeepStrictEqual(remoteAdded[0][key], declared[key])) &&
    sameRows(before.local.expenses, after.local.expenses.filter(row => row.id !== id)) && sameRows(before.server, after.server.filter(row => row.id !== id)) &&
    settingsPreserved(before, after, { expenseChange: { id, version: version(after, id) } }) && oneNewExpenseEvent(before, after, id) && EXPENSE_KEYS.every(key => isDeepStrictEqual(after.allEvents.at(-1).data[key], declared[key]));
}
function declaredRecordsMatch(facts, ids, values) {
  return ids.length === values.length && new Set(ids).size === ids.length && facts.local.expenses.length === values.length && facts.server.length === values.length && ids.every((id, index) => acknowledged(facts, id) && [facts.local.expenses, facts.server].every(rows => { const row = rows.find(item => item.id === id); return row && EXPENSE_KEYS.every(key => isDeepStrictEqual(row[key], values[index][key])); }));
}
function dailySummaryMatches(text, spent, income) {
  if (!Number.isSafeInteger(spent) || !Number.isSafeInteger(income) || spent < 0 || income < 0) return false;
  // The adjacent label, currency and exact signed cents form one fact. Merely
  // finding labels and the two numbers somewhere in the same region is unsafe.
  const money = '([+-]?)\\s*(?:¥|￥|CNY|人民币)\\s*([+-]?)\\s*(\\d+\\.\\d{2})(?![\\d.])(?:\\s*元)?';
  const matches = label => [...text.matchAll(new RegExp(`(?<!净)(${label})\\s*[:：]?\\s*${money}`, 'g'))].map(row => {
    if (row[2] && row[3]) return null;
    const [whole, fraction] = row[4].split('.'), magnitude = Number(whole) * 100 + Number(fraction);
    return Number.isSafeInteger(magnitude) ? { label: row[1], sign: row[2] || row[3], magnitude } : null;
  });
  const gross = matches('支出|收入');
  let grossPass = false;
  if (gross.length === 2 && gross.every(Boolean)) {
    const expense = gross.filter(row => row.label === '支出'), received = gross.filter(row => row.label === '收入');
    grossPass = expense.length === 1 && received.length === 1 && expense[0].magnitude === spent && expense[0].sign !== '+' && received[0].magnitude === income && received[0].sign !== '-';
  }
  const nets = matches('净收入|净支出|净额|收支差额|结余');
  // A visible but malformed net statement cannot disappear behind valid gross figures.
  if ([...text.matchAll(/净收入|净支出|净额|收支差额|结余/g)].length !== nets.length) return false;
  if (!nets.length) return grossPass;
  if (gross.length && !grossPass) return false;
  if (nets.length !== 1 || !nets[0]) return false;
  const { label, sign, magnitude } = nets[0], net = income - spent;
  if (label === '净收入') return net >= 0 && magnitude === net && sign !== '-';
  if (label === '净支出') return net <= 0 && magnitude === -net && sign !== '+';
  return (sign === '-' ? -magnitude : magnitude) === net && !(net === 0 && sign === '-');
}
export const expenseOutcomeChecks = { profiles: PROFILES, validVersion, version, onlyChanges, sameRows, budgetRows, settingsDifferences, settingsPreserved, businessSourcesPreserved, expenseRowsFromLedger, expectedTotals, acknowledged, changedOnlyTarget, createdOnlyDeclared, declaredRecordsMatch, dailySummaryMatches };

export async function runExpenseOutcomes(h, { scenarioSet } = {}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Expense native evidence runs only in authorized hosted CI');
  assert.ok(['records', 'budget'].includes(scenarioSet), 'Select one bounded Expense task');
  const { isolated, login, waitPath, capture, observe, apiFor, sleep, actions, artifacts, writeFile, join, surfaceNames } = h;
  const prefix = scenarioSet === 'records' ? 'YE-records' : 'YE-budget';
  const scope = { applicationBaseline: '48ea881908b433bdd0222a82f93a4f3417c0e5a0', kind: 'native-expense-red-baseline', scenarioSet, syntheticOnly: true, widths: [1280, 360], clock: 'Existing audit-clock Date fixture in browser only: 2026-10-07 12:00 Asia/Shanghai, advancing; Node API, database timestamps, timers and cookie engine remain real', limitations: ['No native month/category filter exists at this source; unsupported/untested, no fabricated click or pass', 'No day/week income-summary feature is required: expenditure must remain separate from income and existing month income must be accurate', 'Current Expense task is independent of prior Timeline/Capture old-record correction', 'Budget is device-local; no account preference update or cloud budget ACK is required or asserted', 'No live provider, production account, clear/signout/authority/publication race, postcommit-read failure, arbitrary scale, real phone OS, full keyboard/accessibility or release claim'] };
  await writeFile(join(artifacts, `${prefix}-scope.json`), JSON.stringify(scope, null, 2));

  // Shared read-only geometry includes viewport-fixed navigation; the pointer
  // guard waits for stable frames and rechecks semantics after the real hover.
  async function read(page, selector) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const box = await page.evaluate(initialSessionGeometry, selector); assert.equal(box.unique, true, `Expected one actual region: ${selector}`); if (box.visible) return box;
      const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20)), deltaY = box.rect.y + box.rect.height / 2 - y;
      if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-read-expense', surface: surfaceNames.get(page), selector, pointer: { x, y }, deltaY, clip: box.clip, scroller: box.scroller }); }
      await sleep(150);
    }
    return page.evaluate(initialSessionGeometry, selector);
  }
  async function exact(page, selector, text) {
    return page.evaluate(({ selector, text }) => {
      const rows = [...document.querySelectorAll(selector)].filter(el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (text === undefined || el.textContent.trim() === text); });
      if (rows.length !== 1) throw new Error(`Expected one rendered target: ${selector} / ${text ?? ''}; got ${rows.length}`);
      const parts = []; for (let node = rows[0]; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(el => el.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
      return 'body > ' + parts.join(' > ');
    }, { selector, text });
  }
  async function tap(page, selector, text) {
    await page.bringToFront(); const resolved = await exact(page, selector, text), reading = await read(page, resolved);
    assert.ok(reading.visible, `Control is clipped, unpainted, truncated or obscured: ${selector} ${text ?? ''}`);
    assert.equal(await page.$eval(resolved, el => Boolean(el.disabled)), false);
    const probes = []; let point;
    try { point = await preparePreferencePointer(page, resolved, selector, text, probes); }
    finally { actions.push({ kind: 'expense-preclick-geometry', surface: surfaceNames.get(page), selector, resolved, probes }); }
    await page.mouse.click(point.x, point.y);
    actions.push({ kind: 'native-expense-pointer', surface: surfaceNames.get(page), selector, resolved, text, ...point, clip: reading.clip, path: new URL(page.url()).pathname });
  }
  async function input(page, selector, text) {
    await tap(page, selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(text);
    assert.equal(await page.$eval(selector, el => el.value), text); actions.push({ kind: 'native-expense-typed-input', surface: surfaceNames.get(page), selector, text });
  }
  async function date(page, value) {
    await tap(page, '#expense-date'); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    const [year, month, day] = value.split('-'); await page.keyboard.type(month + day + year); await page.keyboard.press('Tab');
    assert.equal(await page.$eval('#expense-date', el => el.value), value, 'Native segmented date must reach the requested business date'); actions.push({ kind: 'native-expense-date', surface: surfaceNames.get(page), expected: value });
  }
  async function category(page, value) {
    const selector = 'select[aria-label="记账分类"]', options = await page.$eval(selector, el => [...el.options].map(row => ({ value: row.value, text: row.text })));
    const index = options.findIndex(row => row.value === value); assert.ok(index >= 0); await tap(page, selector); await page.keyboard.press('Home');
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    assert.equal(await page.$eval(selector, el => el.value), value); actions.push({ kind: 'native-expense-category', surface: surfaceNames.get(page), selected: options[index] });
  }
  async function editor(page) {
    return page.$eval('[role=dialog]', el => ({ name: el.querySelector('#expense-name').value, amount: el.querySelector('#expense-amount').value, date: el.querySelector('#expense-date').value, category: el.querySelector('select[aria-label="记账分类"]').value, isIncome: [...el.querySelectorAll('[role=group][aria-label="收支类型"] button')].find(button => button.getAttribute('aria-pressed') === 'true')?.textContent.trim() === '收入' }));
  }
  async function readyDraft(page) {
    await page.waitForFunction(() => { const modal = document.querySelector('[role=dialog]'); return modal?.querySelector('#expense-amount') && !modal.querySelector('fieldset').disabled && !/正在读取草稿|正在保留草稿/.test(modal.innerText); }, { timeout: 7000 });
  }
  async function enter(page) {
    await tap(page, page.viewport().width === 360 ? 'nav[aria-label="主导航"] button[aria-label="花销"]' : 'aside nav button', page.viewport().width === 360 ? undefined : '花销');
    await waitPath(page, '/expense'); await page.waitForSelector('button[aria-label="添加花销"]');
  }
  async function home(page) {
    await tap(page, page.viewport().width === 360 ? 'nav[aria-label="主导航"] button[aria-label="首页"]' : 'aside nav button', page.viewport().width === 360 ? undefined : '首页'); await waitPath(page, '/');
  }
  async function localSource(page, owner) {
    // This is a complete three-table sample, not a whole-database export or an
    // arbitrary structured-clone codec. Own undefined keys and observed ordinary
    // unknown fields are retained; unsupported object types stop the sample.
    const serialized = await page.evaluate(owner => new Promise((resolve, reject) => {
      const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected account DB does not exist')); }; request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, names = ['expenses', 'settings', 'outbox'], tx = db.transaction(names, 'readonly'), result = {};
        for (const name of names) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { result[name] = read.result; }; }
        tx.oncomplete = () => {
          db.close();
          try { resolve(JSON.stringify(result, function(key, value) {
            const original = this[key];
            if (original && typeof original === 'object' && !Array.isArray(original) && !(original instanceof Date) && !(original instanceof Map) && !(original instanceof Set) && Object.getPrototypeOf(original) !== Object.prototype) throw new Error('Unsupported original Expense snapshot object; custom toJSON must not hide its type');
            if (original && Object.getPrototypeOf(original) === Object.prototype && Object.hasOwn(original, '__expenseEvidenceType')) throw new Error('Reserved evidence marker in source; stop instead of creating a tagged-value collision');
            if (value === undefined) return { __expenseEvidenceType: 'undefined' };
            if (typeof value === 'bigint') return { __expenseEvidenceType: 'bigint', value: String(value) };
            if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) return { __expenseEvidenceType: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
            if (original instanceof Date) return { __expenseEvidenceType: 'date', value: original.toISOString() };
            if (value instanceof Map) return { __expenseEvidenceType: 'Map', entries: [...value] };
            if (value instanceof Set) return { __expenseEvidenceType: 'Set', values: [...value] };
            if (value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported Expense snapshot value; do not claim lossless retention');
            if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new Error('Sparse or extended array in Expense snapshot; stop instead of losing present keys');
            return value;
          })); } catch (error) { reject(error); }
        };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Readonly Expense source aborted')); };
      };
    }), owner);
    return JSON.parse(serialized);
  }
  async function ledger(api) {
    const events = []; let cursor = '0';
    for (let i = 0; i < 20; i++) { const result = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`); assert.ok(Array.isArray(result.events)); events.push(...result.events); if (!result.hasMore) return events; assert.notEqual(result.nextCursor, cursor); cursor = result.nextCursor; }
    throw new Error('Read-only audit ledger exceeded 20 bounded pages');
  }
  async function facts(page, api, label, { settle = true, extra = {} } = {}) {
    let local = await localSource(page, api.ownerId);
    if (settle) for (let i = 0; i < 60 && local.outbox.length; i++) { await sleep(250); local = await localSource(page, api.ownerId); }
    const allEvents = await ledger(api), events = allEvents.filter(event => event.entity === 'expenses'), server = (await api('/expenses')).expenses;
    const result = { local, server, events, allEvents };
    await writeFile(join(artifacts, `${label}-full-source.json`), JSON.stringify({ syntheticOnly: true, observedByDriverAt: new Date().toISOString(), browserClock: await page.evaluate(() => ({ instant: new Date().toISOString(), config: globalThis.__youtraceAuditClock })), ...result, serverTimestampMeaning: 'Original canonical server createdAt/updatedAt/version are preserved separately; browser business dates and any local timestamp are synthetic and are never rewritten to match them', ...extra }, null, 2));
    assert.ok(Array.isArray(server)); assert.equal(server.length < 2000, true, 'Bounded fixture must not hit GET /expenses cap');
    assert.ok(sameRows(server, expenseRowsFromLedger(allEvents)), 'GET rows and complete canonical Expense ledger must agree without dropping fields');
    return result;
  }
  async function visibleRow(page, wanted) {
    // The human-visible name/date/type/amount selects the row; IDs corroborate
    // after selection only. No hidden ID, remembered order or React key locates it.
    const candidates = await page.evaluate(wanted => [...document.querySelectorAll('main button')].filter(el => el.getAttribute('aria-label')?.startsWith('编辑记账 ')).map(el => {
      const text = el.innerText, label = el.getAttribute('aria-label'), name = el.querySelector('p')?.innerText;
      const parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(row => row.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
      return { selector: 'body > ' + parts.join(' > '), name, text, label, matches: name === wanted.name && text.includes(wanted.date) && label === `编辑记账 ${wanted.name} ${wanted.date} ${wanted.isIncome ? '收入' : '支出'} ${(wanted.amount / 100).toFixed(2)}元` };
    }), wanted);
    const matches = candidates.filter(row => row.matches); assert.equal(matches.length, 1, `Visible dated identity must be unique: ${JSON.stringify({ wanted, candidates })}`);
    const row = matches[0], reading = await read(page, row.selector); assert.ok(reading.visible, 'Exact dated record must be visibly readable');
    assert.ok(reading.text.includes(wanted.date) && reading.text.includes(`${wanted.isIncome ? '+' : '-'}¥${yuan(wanted.amount)}`), 'Painted type/sign, cents and business date must identify the intended record');
    return { ...row, reading };
  }
  async function open(page, wanted) {
    const row = await visibleRow(page, wanted); await capture(page, `${surfaceNames.get(page)}-visible-dated-selection`); await tap(page, row.selector); await readyDraft(page);
    const actual = await editor(page); for (const key of ['name', 'date', 'category', 'isIncome']) assert.equal(actual[key], wanted[key]); assert.equal(actual.amount, yuan(wanted.amount)); return actual;
  }
  async function save(page) { await readyDraft(page); await tap(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 7000 }); }
  async function create(page, api, label, values) {
    const before = await facts(page, api, `${label}-before-create`); assert.equal(before.local.outbox.length, 0);
    await tap(page, 'button[aria-label="添加花销"]'); await readyDraft(page); await input(page, '#expense-name', values.name); await input(page, '#expense-amount', yuan(values.amount)); await category(page, values.category); await date(page, values.date);
    await tap(page, '[role=group][aria-label="收支类型"] button', values.isIncome ? '收入' : '支出'); await readyDraft(page);
    const typed = await editor(page); await capture(page, `${label}-typed-original`); await save(page);
    const after = await facts(page, api, `${label}-created`, { extra: { typed } }), added = after.local.expenses.filter(row => !before.local.expenses.some(old => old.id === row.id)); assert.equal(added.length, 1);
    const row = added[0], pass = createdOnlyDeclared(before, after, values);
    await observe(page, `${label}-same-id-exact-cents-cloud-ack`, pass, JSON.stringify({ typed, declared: values, id: row.id, version: version(after, row.id), settingsDifferences: settingsDifferences(before, after), sourceArtifact: `${label}-created-full-source.json`, note: 'Creation must preserve every old local/server row, old version and complete ledger prefix, adding exactly the declared target Expense event.' })); assert.ok(pass, 'Actual native creation/ACK/source-preservation prerequisite failed; do not manufacture records or continue dependent work'); return row;
  }
  async function budgetReading(page, label, expected) {
    const reading = await read(page, BUDGET); await observe(page, label, reading.visible && expected(reading.text), JSON.stringify(reading)); return reading;
  }
  async function statistics(page, rows, label) {
    const summary = '查看收支统计与历史提示';
    if (await page.$$eval('summary', (nodes, text) => nodes.some(el => el.textContent.trim() === text && !el.parentElement.open), summary)) await tap(page, 'summary', summary);
    const expected = expectedTotals(rows), actual = {};
    for (const [name, key] of [['今日', 'today'], ['本周', 'week'], ['本月', 'month']]) {
      const selector = `p[aria-label^="${name}支出人民币"]`, reading = await read(page, selector), period = await read(page, `div:has(> ${selector})`), labelText = await page.$eval(selector, el => el.getAttribute('aria-label')); actual[key] = { reading, period, label: labelText };
      await observe(page, `${label}-${key}-actual-expenditure-cents`, reading.visible && period.visible && period.text.includes(name) && reading.text === `¥${yuan(expected[key])}` && labelText === `${name}支出人民币${yuan(expected[key])}元`, JSON.stringify({ expected, actual: actual[key], note: 'Actual expenditure excludes income and future dates; no daily/weekly income summary is required' }));
    }
    await budgetReading(page, `${label}-spent-and-income-stay-separate`, text => text.includes(`本月已花\n¥${yuan(expected.month)}`) && text.includes(`本月收入 ¥${yuan(expected.monthIncome)}`));
    return expected;
  }
  async function installQuota(page, owner, table, key) {
    assert.ok(table === 'expenses' || table === 'settings' && key === 'monthBudget');
    await page.evaluate(({ owner, table, key }) => {
      if (window.__expensePutFault && !window.__expensePutFault.restored) throw new Error('Prior Expense fault is still installed');
      const original = IDBObjectStore.prototype.put, transactions = new WeakSet(); let timer;
      const state = window.__expensePutFault = { owner, table, key, kind: 'exact-precommit-put-quota', hits: [], aborts: 0, commits: 0, expired: false, restored: false, restoredBy: null, restoredAt: null };
      window.__restoreExpensePut = (reason = 'explicit-harness-release') => { clearTimeout(timer); IDBObjectStore.prototype.put = original; state.restored = IDBObjectStore.prototype.put === original; state.restoredBy ??= reason; state.restoredAt ??= performance.now(); };
      timer = setTimeout(() => { state.expired = true; window.__restoreExpensePut('safety-timeout'); }, 30000);
      IDBObjectStore.prototype.put = function(value, suppliedKey) {
        const actualKey = table === 'settings' ? value?.key : value?.id;
        if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === table && this.transaction.mode === 'readwrite' && actualKey === key) {
          if (!transactions.has(this.transaction)) { transactions.add(this.transaction); this.transaction.addEventListener('abort', () => { state.aborts += 1; }, { once: true }); this.transaction.addEventListener('complete', () => { state.commits += 1; }, { once: true }); }
          state.hits.push({ atMonotonicMs: performance.now(), browserDate: new Date().toISOString(), database: this.transaction.db.name, table: this.name, key: actualKey, intendedValue: value, originalPutCalled: false });
          throw new DOMException('Synthetic exact Expense precommit quota', 'QuotaExceededError');
        }
        return suppliedKey === undefined ? original.call(this, value) : original.call(this, value, suppliedKey);
      };
    }, { owner, table, key });
    actions.push({ kind: 'declared-exact-precommit-expense-quota', surface: surfaceNames.get(page), owner, table, key, safetyDeadlineMs: 30000, originalMatchedPutCalled: false });
  }
  async function releaseQuota(page, label) {
    const fault = await page.evaluate(() => { window.__restoreExpensePut?.(); return window.__expensePutFault ?? null; });
    await writeFile(join(artifacts, `${label}-fault.json`), JSON.stringify(fault, null, 2));
    if (fault) { actions.push({ kind: 'explicit-expense-fault-release', surface: surfaceNames.get(page), table: fault.table, key: fault.key, restoredBy: fault.restoredBy }); assert.ok(fault.restored && !fault.expired && fault.restoredBy === 'explicit-harness-release', 'A timed-out or unrestored fault is a failed experiment, never recovery evidence'); }
    return fault;
  }
  async function failedSave(page, api, label, before, kind, values) {
    const selector = kind === 'budget' ? `${BUDGET} [role=alert]` : '[role=dialog] [role=alert]';
    await page.waitForSelector(selector, { timeout: 7000 });
    await page.waitForFunction(() => window.__expensePutFault.aborts > 0 || window.__expensePutFault.commits > 0, { timeout: 4000 });
    const fault = await page.evaluate(() => window.__expensePutFault), after = await facts(page, api, `${label}-failed-before-release`, { settle: false, extra: { fault, retainedInput: kind === 'budget' ? await page.$eval(BUDGET_INPUT, el => el.value) : await editor(page) } });
    const sourcePreserved = businessSourcesPreserved(before, after) && sameRows(budgetRows(before.local), budgetRows(after.local));
    const retained = kind === 'budget' ? await page.$eval(BUDGET_INPUT, el => el.value) === values : isDeepStrictEqual(await editor(page), values);
    const actualRefusal = fault.hits.length === 1 && fault.aborts === 1 && fault.commits === 0 && !fault.expired && fault.hits[0].originalPutCalled === false;
    await observe(page, `${label}-exact-refusal-zero-commit-complete-source-retained`, actualRefusal && sourcePreserved && retained, JSON.stringify({ actualRefusal, sourcePreserved, retained, fault, settingsDifferences: settingsDifferences(before, after), sourceArtifact: `${label}-failed-before-release-full-source.json` }));
    assert.ok(actualRefusal && sourcePreserved && retained, 'Unexpected write/commit/target/source/input evidence: stop all dependent business actions');
    const reading = await read(page, await exact(page, selector)), text = reading.text;
    await observe(page, `${label}-reader-understands-cause-and-retry`, reading.visible && /存储.{0,12}(?:不足|已满)|空间不足|配额不足/.test(text) && /未保存|未能保存|保存失败|尚未保存|输入.{0,8}保留/.test(text) && /重试|再试/.test(text) && !/QuotaExceededError|Synthetic/.test(text), JSON.stringify({ reading, note: 'A normal Save control permits a mechanical retry only. It does not make an untranslated quota message understandable or grant complete self-service recovery acceptance.' }));
    return after;
  }
  async function cancelEditor(page) { await tap(page, '[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 7000 }); }
  async function correct(page, api, target, label, nextAmount, { quota = false } = {}) {
    await open(page, target); await input(page, '#expense-amount', yuan(nextAmount)); await readyDraft(page);
    const typed = await editor(page), before = await facts(page, api, `${label}-before-attempt`, { extra: { typed } }); assert.ok(acknowledged(before, target.id));
    if (quota) {
      await installQuota(page, api.ownerId, 'expenses', target.id);
      try { await tap(page, '[role=dialog] button', '保存'); await failedSave(page, api, label, before, 'expense', typed); }
      finally { await releaseQuota(page, label); }
      const reopen = page.viewport().width === 360;
      if (reopen) {
        // Narrow profile exercises the promised retained-draft cancel/reopen;
        // desktop keeps the actual failure editor mounted for its direct retry.
        await cancelEditor(page); const cancelled = await facts(page, api, `${label}-cancelled-failed-editor`);
        assert.ok(businessSourcesPreserved(before, cancelled), 'Cancel after refusal must not alter original, draft, versions, ledger or queue');
        await statistics(page, before.local.expenses, `${label}-unchanged-after-refusal`);
        const row = await visibleRow(page, target); await tap(page, row.selector); await readyDraft(page);
      }
      assert.deepEqual(await editor(page), typed, 'Visible retry must use the same retained fields, without retyping or creating a replacement');
      actions.push({ kind: 'native-retained-expense-save-retry', surface: surfaceNames.get(page), id: target.id, control: '保存', dedicatedErrorRetry: false, resumedAfterVisibleCancelReopen: reopen, backgroundTotalsReadWhileObscured: false });
    } else {
      await cancelEditor(page); const cancelled = await facts(page, api, `${label}-cancelled-input-retained`);
      const preserved = businessSourcesPreserved(before, cancelled); await observe(page, `${label}-cancel-preserves-full-original-and-draft`, preserved, JSON.stringify({ targetId: target.id, typed, sourceArtifact: `${label}-cancelled-input-retained-full-source.json` })); assert.ok(preserved);
      await statistics(page, before.local.expenses, `${label}-unchanged-after-cancel`);
      const row = await visibleRow(page, target); await tap(page, row.selector); await readyDraft(page); assert.deepEqual(await editor(page), typed);
    }
    await capture(page, `${label}-retained-fields-before-real-save`); await save(page);
    const after = await facts(page, api, `${label}-saved`), pass = changedOnlyTarget(before, after, target.id, nextAmount);
    await observe(page, `${label}-one-same-id-change-cloud-ack-neighbors-preserved`, pass, JSON.stringify({ targetId: target.id, beforeVersion: version(before, target.id), afterVersion: version(after, target.id), typed, settingsDifferences: settingsDifferences(before, after), sourceArtifact: `${label}-saved-full-source.json`, note: 'Only target amount may change locally; canonical server updatedAt may change. Unknown and all other fields, every neighbor and previous ledger events remain preserved. Exact target version/draft consumption and lastPushAt/lastPullAt are listed individually.' })); assert.ok(pass, 'Exact acknowledged correction is a prerequisite for later reads');
    const changed = after.local.expenses.find(row => row.id === target.id); await visibleRow(page, changed); await statistics(page, after.local.expenses, `${label}-recalculated`);
    await open(page, changed); assert.equal((await editor(page)).amount, yuan(nextAmount)); await cancelEditor(page);
    return { changed, after };
  }
  async function dailyMeaning(page, target, rows, label) {
    const row = await visibleRow(page, target);
    const header = await page.$eval(row.selector, el => {
      const node = el.parentElement.parentElement.previousElementSibling, parts = [];
      if (!node) throw new Error('Cannot identify the visible dated group header');
      for (let current = node; current && current !== document.body; current = current.parentElement) { const siblings = [...current.parentElement.children].filter(el => el.tagName === current.tagName); parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`); }
      return 'body > ' + parts.join(' > ');
    });
    const reading = await read(page, header), sameDay = rows.filter(item => item.date === target.date), spent = sameDay.filter(item => !item.isIncome).reduce((sum, item) => sum + item.amount, 0), income = sameDay.filter(item => item.isIncome).reduce((sum, item) => sum + item.amount, 0);
    await observe(page, `${label}-daily-list-net-is-not-mislabeled-as-income-or-spend`, reading.visible && dailySummaryMatches(reading.text, spent, income), JSON.stringify({ reading, date: target.date, grossExpense: spent, grossIncome: income, incomeMinusExpense: income - spent, note: 'Bind adjacent visible label, currency, exact cents and direction/sign: either individually correct gross expense/income or the correctly signed net. A net label alone cannot pass; no new day/week income summary feature is required.' }));
  }
  async function recordJourney(page, api, label) {
    const values = [
      { name: NAME, amount: 1234, date: TODAY, category: 'food', isIncome: false },
      { name: NAME, amount: 1234, date: '2026-10-06', category: 'transport', isIncome: false },
      { name: 'Synthetic 自然周以外', amount: 321, date: '2026-10-04', category: 'other', isIncome: false },
      { name: 'Synthetic 上月记录', amount: 456, date: '2026-09-30', category: 'other', isIncome: false },
      { name: 'Synthetic 未来日期', amount: 567, date: '2026-10-08', category: 'other', isIncome: false },
      { name: 'Synthetic 今日收入', amount: 10001, date: TODAY, category: 'other', isIncome: true },
      { name: 'Synthetic 本周收入', amount: 1002, date: '2026-10-06', category: 'other', isIncome: true },
    ];
    const created = [];
    for (const [index, value] of values.entries()) created.push(await create(page, api, `${label}-record-${index + 1}`, value));
    const declared = values.map((value, index) => ({ id: created[index].id, ...value }));
    const before = await facts(page, api, `${label}-all-native-records`, { extra: { declaredOriginalInputs: declared } }), allDeclared = declaredRecordsMatch(before, created.map(row => row.id), values);
    await observe(page, `${label}-seven-records-still-match-original-declared-inputs`, allDeclared, JSON.stringify({ declared, sourceArtifact: `${label}-all-native-records-full-source.json` })); assert.ok(allDeclared, 'Do not calculate accepted totals from sources that changed away from the original seven declared inputs');
    for (const item of [created[0], created[1], created[4]]) { const row = await visibleRow(page, item); await observe(page, `${label}-dated-identity-${item.date}`, true, JSON.stringify({ idForCorroborationOnly: item.id, visibleIdentity: row })); }
    await statistics(page, before.local.expenses, `${label}-initial`); await dailyMeaning(page, created[0], before.local.expenses, label);
    const changed = await correct(page, api, created[0], `${label}-exact-correction`, 987);
    const future = changed.after.local.expenses.find(row => row.id === created[4].id); assert.deepEqual(future, created[4]); await visibleRow(page, future);
    await observe(page, `${label}-future-record-retained-after-correction`, true, JSON.stringify({ future, note: 'A future-dated record remains visible with its original ID. Separately recorded expenditure assertions decide whether 已花 scope is accurate.' }));
    await home(page); await enter(page); const returned = await facts(page, api, `${label}-returned`); assert.ok(businessSourcesPreserved(changed.after, returned)); await visibleRow(page, changed.changed);
    await statistics(page, returned.local.expenses, `${label}-returned`);
    await observe(page, `${label}-month-category-filters-not-exercised`, null, 'Unsupported/untested at the application baseline. No native month/category filter exists; no invented action or inherited Timeline/Capture acceptance. Current category selection is only an editor choice.');
  }
  async function startBudgetEdit(page) {
    const choices = await page.$$eval(`${BUDGET} button`, rows => rows.filter(el => ['设置预算', '编辑月预算', '继续编辑预算'].includes(el.textContent.trim())).map(el => el.textContent.trim())); assert.equal(choices.length, 1);
    await tap(page, `${BUDGET} button`, choices[0]); await page.waitForSelector(BUDGET_INPUT);
    const copy = await exact(page, `${BUDGET} form p`, '预算仅保存在本设备。保存后才采用新金额；取消会保留本页输入。'), reading = await read(page, copy);
    await observe(page, `${surfaceNames.get(page)}-budget-device-only-scope`, reading.visible, JSON.stringify({ reading, note: 'This proves the stated device-local scope is readable, not a second-device isolation experiment.' }));
  }
  async function saveBudget(page, api, label, amount, { alreadyEditing = false } = {}) {
    if (!alreadyEditing) await startBudgetEdit(page); await input(page, BUDGET_INPUT, yuan(amount)); const before = await facts(page, api, `${label}-before-save`);
    await tap(page, `${BUDGET} button`, '保存预算'); await page.waitForSelector(BUDGET_INPUT, { hidden: true, timeout: 7000 });
    const after = await facts(page, api, `${label}-saved`), pass = businessSourcesPreserved(before, after, { allowBudgetChange: true }) && isDeepStrictEqual(budgetRows(after.local).sort((a, b) => a.key.localeCompare(b.key)), [{ key: 'monthBudget', value: amount }, { key: 'monthBudgetConfigured', value: true }]);
    await observe(page, `${label}-exact-local-budget-without-record-write`, pass, JSON.stringify({ amount, before: budgetRows(before.local), after: budgetRows(after.local), settingsDifferences: settingsDifferences(before, after), note: 'Budget has no cloud ACK. Full record sources/versions/ledger and outbox must remain unchanged.' })); assert.ok(pass); return after;
  }
  async function budgetJourney(page, api, label) {
    const empty = await facts(page, api, `${label}-unset`); assert.deepEqual(budgetRows(empty.local), []);
    await budgetReading(page, `${label}-unset-is-not-zero`, text => text.includes('尚未设置月预算') && !text.includes('已明确设置为 0 元') && text.includes('¥0.00'));
    await saveBudget(page, api, `${label}-explicit-zero`, 0); await budgetReading(page, `${label}-zero-is-explicit-choice`, text => text.includes('月预算 ¥0.00') && text.includes('已明确设置为 0 元') && !text.includes('尚未设置'));
    const target = await create(page, api, `${label}-expense`, { name: NAME, amount: 1234, date: TODAY, category: 'food', isIncome: false });
    await create(page, api, `${label}-neighbor`, { name: NAME, amount: 201, date: '2026-10-06', category: 'transport', isIncome: false });
    await create(page, api, `${label}-income`, { name: 'Synthetic 预算中的收入', amount: 10001, date: TODAY, category: 'other', isIncome: true });
    await budgetReading(page, `${label}-zero-with-real-spend`, text => text.includes('已明确设置为 0 元，支出 ¥14.35') && text.includes('本月收入 ¥100.01'));
    await saveBudget(page, api, `${label}-overspend`, 1001); await budgetReading(page, `${label}-overspend-keeps-cents`, text => text.includes('月预算 ¥10.01') && text.includes('超出预算 ¥4.34') && !text.includes('剩余'));
    await startBudgetEdit(page); await input(page, BUDGET_INPUT, '12.02'); const beforeCancel = await facts(page, api, `${label}-before-budget-cancel`);
    await tap(page, `${BUDGET} button`, '取消'); const cancelled = await facts(page, api, `${label}-cancelled-budget`); assert.ok(businessSourcesPreserved(beforeCancel, cancelled) && sameRows(budgetRows(beforeCancel.local), budgetRows(cancelled.local)));
    await budgetReading(page, `${label}-cancel-keeps-applied-budget`, text => text.includes('月预算 ¥10.01') && text.includes('超出预算 ¥4.34') && text.includes('继续编辑预算'));
    await startBudgetEdit(page); assert.equal(await page.$eval(BUDGET_INPUT, el => el.value), '12.02', 'Budget cancel promise retains the same input on this page');
    const beforeFault = await facts(page, api, `${label}-before-budget-quota`); await installQuota(page, api.ownerId, 'settings', 'monthBudget');
    try { await tap(page, `${BUDGET} button`, '保存预算'); await failedSave(page, api, `${label}-budget-quota`, beforeFault, 'budget', '12.02'); }
    finally { await releaseQuota(page, `${label}-budget-quota`); }
    await budgetReading(page, `${label}-quota-keeps-applied-budget-and-total`, text => text.includes('月预算 ¥10.01') && text.includes('超出预算 ¥4.34') && text.includes('¥14.35'));
    await statistics(page, beforeFault.local.expenses, `${label}-unchanged-budget-refusal`); assert.equal(await page.$eval(BUDGET_INPUT, el => el.value), '12.02');
    actions.push({ kind: 'native-retained-budget-save-retry', surface: surfaceNames.get(page), control: '保存预算', dedicatedErrorRetry: false, noRetyping: true });
    await tap(page, `${BUDGET} button`, '保存预算'); await page.waitForSelector(BUDGET_INPUT, { hidden: true, timeout: 7000 });
    const retried = await facts(page, api, `${label}-budget-retry`), retryPass = businessSourcesPreserved(beforeFault, retried, { allowBudgetChange: true }) && isDeepStrictEqual(budgetRows(retried.local).sort((a, b) => a.key.localeCompare(b.key)), [{ key: 'monthBudget', value: 1202 }, { key: 'monthBudgetConfigured', value: true }]);
    await observe(page, `${label}-budget-real-retry-local-result`, retryPass, JSON.stringify({ before: budgetRows(beforeFault.local), after: budgetRows(retried.local), settingsDifferences: settingsDifferences(beforeFault, retried), noBudgetAccountSyncClaim: true })); assert.ok(retryPass);
    await budgetReading(page, `${label}-retried-budget-recalculates-cents`, text => text.includes('月预算 ¥12.02') && text.includes('超出预算 ¥2.33'));
    const corrected = await correct(page, api, target, `${label}-expense-quota`, 1357, { quota: true });
    await budgetReading(page, `${label}-expense-retry-recalculates-budget`, text => text.includes('本月已花\n¥15.58') && text.includes('超出预算 ¥3.56') && text.includes('本月收入 ¥100.01'));
    const beforeReload = await facts(page, api, `${label}-before-reload`); await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'normal-budget-and-expense-reload', surface: surfaceNames.get(page) }); await waitPath(page, '/expense'); await page.waitForSelector('button[aria-label="添加花销"]');
    const reloaded = await facts(page, api, `${label}-reloaded`), reloadPass = businessSourcesPreserved(beforeReload, reloaded, { reload: true });
    await observe(page, `${label}-same-device-budget-and-record-survive-reload`, reloadPass, JSON.stringify({ settingsDifferences: settingsDifferences(beforeReload, reloaded), note: 'Full Expense/draft/version/ledger/outbox and both budget rows remain unchanged. Only explicit lastPullAt and reload cursor advancement to the already-existing unchanged ledger end are allowed; no second-device claim' })); assert.ok(reloadPass); await visibleRow(page, corrected.changed);
    await budgetReading(page, `${label}-reloaded-exact-budget-and-spend`, text => text.includes('月预算 ¥12.02') && text.includes('本月已花\n¥15.58') && text.includes('超出预算 ¥3.56'));
  }
  async function run(page) {
    const label = surfaceNames.get(page), clock = h.clock ?? createHabitAuditClock(); let api;
    await page.evaluateOnNewDocument(installAuditDate, clock); actions.push({ kind: 'explicit-browser-only-advancing-expense-Date', surface: label, ...clock, serverDateUnchanged: true });
    try {
      const profile = PROFILES.find(row => row.scenarioSet === scenarioSet && row.width === page.viewport().width); assert.ok(profile && profile.nickname.length <= 20);
      await login(page, profile.phone, profile.nickname); api = await apiFor(page);
      const browserDate = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())); assert.equal(browserDate, TODAY);
      await enter(page); await capture(page, `${label}-first-expense-entry`);
      if (scenarioSet === 'records') await recordJourney(page, api, label); else await budgetJourney(page, api, label);
    } catch (error) {
      // First mechanical/source failure stops this profile. Read-only evidence
      // collection and explicit fault release remain allowed; no business reset.
      await capture(page, `${label}-first-failure`).catch(() => undefined);
      const fault = await page.evaluate(() => window.__expensePutFault ?? null).catch(() => null);
      if (api) await facts(page, api, `${label}-first-failure`, { settle: false, extra: { firstFailure: error.message, fault } }).catch(async snapshotError => { await writeFile(join(artifacts, `${label}-first-failure-source-unavailable.json`), JSON.stringify({ firstFailure: error.message, sourceFailure: snapshotError.message, fault }, null, 2)); });
      throw error;
    } finally {
      const active = await page.evaluate(() => Boolean(window.__expensePutFault && !window.__expensePutFault.restored)).catch(() => false);
      if (active) await releaseQuota(page, `${label}-final-cleanup`);
    }
  }
  const media = [];
  for (const width of [1280, 360]) { const name = `${prefix}-${width}`; media.push(name); await isolated(name, { width, height: width === 360 ? 800 : 900 }, run); }
  return { media };
}
