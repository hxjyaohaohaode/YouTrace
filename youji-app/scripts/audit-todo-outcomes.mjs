// Ordinary Todo native RED baseline. Disposable hosted CI fixtures only.
// Native input owns every business write; HTTP below only corroborates via GET.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHabitAuditClock, installAuditDate } from './audit-clock.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { preparePreferencePointer } from './audit-preference-pointer.mjs';
import { diaryOutcomeChecks } from './audit-diary-outcomes.mjs';

const { validVersion, sameRows, onlyChanges, settingsDifferences } = diaryOutcomeChecks;
const BASELINE = '79f9735386df7c558940e8473f84ef1ddfb59fca';
const TODAY = '2026-10-07';
const FORM_KEYS = ['text', 'priority', 'dueDate', 'done'];
const UNDEFINED = Object.freeze({ __todoEvidenceType: 'undefined' });
const PROFILES = [
  { width: 1280, phone: '13900008881', nickname: 'Synthetic YT 1280' },
  { width: 360, phone: '13900008882', nickname: 'Synthetic YT 360' },
];
const DECLARED = Object.freeze([
  { text: '合成：归还图书', dueDate: '2026-10-06', priority: 'high', done: false },
  { text: '合成：归还图书', dueDate: TODAY, priority: 'low', done: false },
  { text: '合成：周末整理书架', dueDate: '2026-10-11', priority: 'medium', done: false },
  { text: '合成：下周寄明信片', dueDate: '2026-10-12', priority: 'high', done: false },
  { text: '合成：整理抽屉', dueDate: '', priority: 'low', done: false },
].map(Object.freeze));
const draftRow = (facts, key) => facts.local.settings.find(row => row.key === key);
const version = (facts, id) => draftRow(facts, `sync-version:todos:${id}`)?.value;
const localDue = value => value || UNDEFINED;
const businessMatch = (local, remote) => Boolean(local && remote) && ['id', 'text', 'priority', 'done'].every(key => Object.hasOwn(local, key) && Object.hasOwn(remote, key) && isDeepStrictEqual(local[key], remote[key])) && Object.hasOwn(local, 'dueDate') && Object.hasOwn(remote, 'dueDate') && (isDeepStrictEqual(local.dueDate, UNDEFINED) ? remote.dueDate === null : local.dueDate === remote.dueDate) && Object.hasOwn(local, 'completedAt') && Object.hasOwn(remote, 'completedAt') && (local.completedAt === null ? remote.completedAt === null : Number.isSafeInteger(local.completedAt) && local.completedAt > 0 && typeof remote.completedAt === 'string' && Date.parse(remote.completedAt) === local.completedAt);
function settingsPreserved(before, after, { change, consumedDraft, writtenDraft } = {}) {
  return settingsDifferences(before, after).every(diff => {
    const valueOnly = diff.after && (diff.before ? onlyChanges(diff.before, diff.after, ['value']) : Object.keys(diff.after).every(key => ['key', 'value'].includes(key)));
    const time = valueOnly && typeof diff.after.value === 'string' && Number.isFinite(Date.parse(diff.after.value)) && (!diff.before || typeof diff.before.value === 'string' && Date.parse(diff.after.value) >= Date.parse(diff.before.value));
    if (diff.key === 'lastPullAt' || change && diff.key === 'lastPushAt') return time;
    if (change && diff.key === `sync-version:todos:${change.id}`) return valueOnly && diff.after.value === change.version;
    if (consumedDraft && diff.key === consumedDraft) return diff.beforePresent && !diff.afterPresent;
    if (writtenDraft && diff.key === writtenDraft.key) return valueOnly && diff.after.value && typeof diff.after.value.revision === 'string' && diff.after.value.revision.length > 0 && isDeepStrictEqual(diff.after.value.value, writtenDraft.value) && Object.keys(diff.after.value).sort().join(',') === 'revision,value';
    return false;
  });
}
function rowsFromLedger(events) {
  const rows = new Map(); let previous = 0n;
  for (const event of events) {
    assert.ok(validVersion(event.seq) && BigInt(event.seq) > previous, 'Full ledger sequence must be canonical and strictly increasing'); previous = BigInt(event.seq);
    if (event.entity !== 'todos') continue;
    assert.ok(['upsert', 'delete'].includes(event.operation), 'Unknown Todo operation');
    if (event.operation === 'delete') { assert.equal(event.data, null); rows.delete(event.entityId); }
    else { assert.equal(event.data?.id, event.entityId); rows.set(event.entityId, event.data); }
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}
const ledgerConsistent = facts => Array.isArray(facts.allEvents) && isDeepStrictEqual(facts.events, facts.allEvents.filter(row => row.entity === 'todos')) && sameRows(facts.server, rowsFromLedger(facts.allEvents));
function sourcesPreserved(before, after, options = {}) {
  return ledgerConsistent(before) && ledgerConsistent(after) && sameRows(before.local.todos, after.local.todos) && sameRows(before.server, after.server) && settingsPreserved(before, after, options) && isDeepStrictEqual(before.local.outbox, after.local.outbox) && isDeepStrictEqual(before.allEvents, after.allEvents);
}
function acknowledged(facts, id) {
  const local = facts.local.todos.find(row => row.id === id), remote = facts.server.find(row => row.id === id), last = facts.events.filter(row => row.entityId === id).at(-1);
  return facts.local.outbox.length === 0 && validVersion(version(facts, id)) && version(facts, id) === last?.seq && last?.operation === 'upsert' && !facts.local.settings.some(row => row.key === `sync-conflict:todos:${id}`) && businessMatch(local, remote);
}
function oneChange(before, after, id, consumedDraft) {
  if (!ledgerConsistent(before) || !ledgerConsistent(after) || !acknowledged(after, id)) return false;
  const added = after.allEvents.slice(before.allEvents.length);
  return isDeepStrictEqual(before.allEvents, after.allEvents.slice(0, before.allEvents.length)) && added.length === 1 && added[0].entity === 'todos' && added[0].entityId === id && added[0].operation === 'upsert' && sameRows(before.local.todos.filter(row => row.id !== id), after.local.todos.filter(row => row.id !== id)) && sameRows(before.server.filter(row => row.id !== id), after.server.filter(row => row.id !== id)) && settingsPreserved(before, after, { change: { id, version: version(after, id) }, consumedDraft });
}
function createdOnlyDeclared(before, after, declared) {
  const frozen = draftRow(before, 'record-draft:todo:new')?.value?.value, id = frozen?.id;
  const local = after.local.todos.find(row => row.id === id), remote = after.server.find(row => row.id === id);
  return Boolean(frozen && local && remote) && typeof id === 'string' && id.length > 0 && frozen.base === null && FORM_KEYS.every(key => isDeepStrictEqual(frozen[key], declared[key])) && before.local.outbox.length === 0 && !before.local.todos.some(row => row.id === id) && !before.server.some(row => row.id === id) && !before.events.some(row => row.entityId === id) && isDeepStrictEqual(local, { ...declared, id, dueDate: localDue(declared.dueDate), completedAt: null }) && typeof remote.createdAt === 'string' && Number.isFinite(Date.parse(remote.createdAt)) && typeof remote.updatedAt === 'string' && Date.parse(remote.updatedAt) >= Date.parse(remote.createdAt) && oneChange(before, after, id, 'record-draft:todo:new') && !draftRow(after, 'record-draft:todo:new');
}
function changedOnlyTarget(before, after, id, expectedLocal, allowed, consumedDraft) {
  const a = before.local.todos.find(row => row.id === id), b = after.local.todos.find(row => row.id === id), x = before.server.find(row => row.id === id), y = after.server.find(row => row.id === id);
  return acknowledged(before, id) && oneChange(before, after, id, consumedDraft) && BigInt(version(after, id)) > BigInt(version(before, id)) && onlyChanges(a, b, allowed) && isDeepStrictEqual(b, expectedLocal) && onlyChanges(x, y, [...allowed, 'updatedAt']) && typeof x.updatedAt === 'string' && typeof y.updatedAt === 'string' && Number.isFinite(Date.parse(x.updatedAt)) && Date.parse(y.updatedAt) >= Date.parse(x.updatedAt) && (!consumedDraft || !draftRow(after, consumedDraft));
}
function completionOnly(before, after, id, window) {
  const original = before.local.todos.find(row => row.id === id), completed = after.local.todos.find(row => row.id === id);
  return Boolean(original && completed) && original.done === false && completed.done === true && Number.isSafeInteger(completed.completedAt) && completed.completedAt >= window.before && completed.completedAt <= window.after && changedOnlyTarget(before, after, id, { ...original, done: true, completedAt: completed.completedAt }, ['done', 'completedAt']);
}
function undoOnly(beforeCompletion, completed, undone, id) {
  const original = beforeCompletion.local.todos.find(row => row.id === id);
  return completed.local.todos.find(row => row.id === id)?.done === true && changedOnlyTarget(completed, undone, id, original, ['done', 'completedAt']) && onlyChanges(beforeCompletion.server.find(row => row.id === id), undone.server.find(row => row.id === id), ['updatedAt']);
}
function editedOnlyDeclared(before, after, id, typed) {
  const original = before.local.todos.find(row => row.id === id), frozen = draftRow(before, `record-draft:todo:${id}`)?.value?.value;
  return Boolean(frozen && original) && frozen.id === id && isDeepStrictEqual(frozen.base, original) && FORM_KEYS.every(key => isDeepStrictEqual(frozen[key], typed[key])) && typed.done === original.done && changedOnlyTarget(before, after, id, { ...original, ...typed, dueDate: localDue(typed.dueDate) }, ['text', 'priority', 'dueDate'], `record-draft:todo:${id}`);
}
function declaredRecordsMatch(facts, records) {
  return facts.local.todos.length === records.length && facts.server.length === records.length && new Set(records.map(row => row.id)).size === records.length && records.every(row => { const local = facts.local.todos.find(item => item.id === row.id); return acknowledged(facts, row.id) && local.text === row.text && local.priority === row.priority && local.done === row.done && isDeepStrictEqual(local.dueDate, localDue(row.dueDate)); });
}
export const todoOutcomeChecks = { profiles: PROFILES, declared: DECLARED, UNDEFINED, version, businessMatch, settingsPreserved, rowsFromLedger, sourcesPreserved, acknowledged, createdOnlyDeclared, completionOnly, undoOnly, editedOnlyDeclared, declaredRecordsMatch };

export function readTodoSource(owner) {
  return new Promise((resolve, reject) => {
      const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected account DB does not exist')); }; request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, names = ['todos', 'settings', 'outbox'], tx = db.transaction(names, 'readonly'), result = {};
        for (const name of names) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { result[name] = read.result; }; }
        tx.oncomplete = () => {
          db.close();
          try { resolve(JSON.stringify(result, function(key, value) {
            const original = this[key];
            if (original && typeof original === 'object' && !Array.isArray(original) && !(original instanceof Date) && !(original instanceof Map) && !(original instanceof Set) && Object.getPrototypeOf(original) !== Object.prototype) throw new Error('Unsupported original Todo snapshot object; custom toJSON must not hide its type');
            if (original && Object.getPrototypeOf(original) === Object.prototype && Object.hasOwn(original, '__todoEvidenceType')) throw new Error('Reserved evidence marker in source; stop instead of creating a tagged-value collision');
            if (value === undefined) return { __todoEvidenceType: 'undefined' };
            if (typeof value === 'bigint') return { __todoEvidenceType: 'bigint', value: String(value) };
            if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) return { __todoEvidenceType: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
            if (original instanceof Date) return { __todoEvidenceType: 'date', value: original.toISOString() };
            if (value instanceof Map) return { __todoEvidenceType: 'Map', entries: [...value] };
            if (value instanceof Set) return { __todoEvidenceType: 'Set', values: [...value] };
            if (value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported Todo snapshot value; do not claim lossless retention');
            if (Array.isArray(value) && (Object.keys(value).length !== value.length || !Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean))) throw new Error('Sparse or extended array in Todo snapshot; stop instead of losing present keys');
            return value;
          })); } catch (error) { reject(error); }
        };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Readonly Todo source aborted')); };
      };

  });
}

export function installTodoQuota({ owner, id }) {
  if (globalThis.__todoFault && !globalThis.__todoFault.restored) throw new Error('Prior Todo fault remains installed');
  const original = IDBObjectStore.prototype.put, transactions = new WeakSet(); let timer;
  const state = globalThis.__todoFault = { owner, id, table: 'todos', method: 'put', kind: 'exact-precommit-put-quota', hits: [], aborts: 0, commits: 0, expired: false, restored: false, restoredBy: null };
  globalThis.__restoreTodoFault = (reason = 'explicit-harness-release') => { clearTimeout(timer); IDBObjectStore.prototype.put = original; state.restored = IDBObjectStore.prototype.put === original; state.restoredBy ??= reason; state.restoredAt ??= performance.now(); };
  timer = setTimeout(() => { state.expired = true; globalThis.__restoreTodoFault('safety-timeout'); }, 30000);
  IDBObjectStore.prototype.put = function(value, suppliedKey) {
    if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'todos' && this.transaction.mode === 'readwrite' && value?.id === id) {
      if (!transactions.has(this.transaction)) { transactions.add(this.transaction); this.transaction.addEventListener('abort', () => { state.aborts++; }, { once: true }); this.transaction.addEventListener('complete', () => { state.commits++; }, { once: true }); }
      state.hits.push({ atMonotonicMs: performance.now(), browserDate: new Date().toISOString(), database: this.transaction.db.name, table: this.name, method: 'put', key: id, intendedValue: JSON.parse(JSON.stringify(value, (_key, item) => item === undefined ? { __todoEvidenceType: 'undefined' } : item)), originalCalled: false });
      throw new DOMException('Synthetic exact Todo precommit put quota', 'QuotaExceededError');
    }
    return suppliedKey === undefined ? original.call(this, value) : original.call(this, value, suppliedKey);
  };
}

export async function runTodoOutcomes(h, options = {}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native Todo evidence runs only in authorized hosted CI');
  assert.equal(options.scenarioSet ?? 'records', 'records', 'One bounded ordinary Todo task');
  const { isolated, login, waitPath, capture, observe, apiFor, sleep, actions, artifacts, writeFile, join, surfaceNames } = h;
  const prefix = 'YT-records';
  await writeFile(join(artifacts, `${prefix}-scope.json`), JSON.stringify({ applicationBaseline: BASELINE, kind: 'ordinary-todo-native-red-baseline', profiles: PROFILES, declared: DECLARED, syntheticOnly: true, clock: 'Browser-only advancing Wednesday 2026-10-07 Date. Server timestamps remain real.', boundaries: ['No app/server/driver/CI change in this baseline module', 'No production, hidden route, DOM click/value assignment, fabricated events or business API writes', 'No deletion or deleted-record recovery claim; undo is the actual completion-state undo', 'No preference authority, clear generation, publication audit, postcommit read repair or startup experiments', 'Successful fresh profiles do not explain the older intermittent B-to-Todo initialization failure', 'No reload, full database backup, arbitrary scale, two-device or complete accessibility claim'] }, null, 2));
  async function read(page, selector) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const box = await page.evaluate(initialSessionGeometry, selector); assert.equal(box.unique, true, `Expected one actual region: ${selector}`); if (box.visible) return box;
      const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20)), deltaY = box.rect.y + box.rect.height / 2 - y;
      if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-read-todo', surface: surfaceNames.get(page), selector, pointer: { x, y }, deltaY, clip: box.clip, scroller: box.scroller }); }
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
    finally { actions.push({ kind: 'todo-preclick-geometry', surface: surfaceNames.get(page), selector, resolved, probes }); }
    await page.mouse.click(point.x, point.y);
    actions.push({ kind: 'native-todo-pointer', surface: surfaceNames.get(page), selector, resolved, text, ...point, clip: reading.clip, path: new URL(page.url()).pathname });
  }
  async function input(page, selector, text) {
    await tap(page, selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(text);
    assert.equal(await page.$eval(selector, el => el.value), text); actions.push({ kind: 'native-todo-typed-input', surface: surfaceNames.get(page), selector, text });
  }
  async function localSource(page, owner) { return JSON.parse(await page.evaluate(readTodoSource, owner)); }
  async function ledger(api) {
    const events = []; let cursor = '0';
    for (let i = 0; i < 20; i++) { const result = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`); assert.ok(Array.isArray(result.events)); events.push(...result.events); if (!result.hasMore) return events; assert.notEqual(result.nextCursor, cursor); cursor = result.nextCursor; }
    throw new Error('Read-only audit ledger exceeded 20 bounded pages');
  }
  async function facts(page, api, label, { settle = true, extra = {} } = {}) {
    let local = await localSource(page, api.ownerId);
    if (settle) for (let i = 0; i < 60 && local.outbox.length; i++) { await sleep(250); local = await localSource(page, api.ownerId); }
    const allEvents = await ledger(api), events = allEvents.filter(event => event.entity === 'todos'), server = (await api('/todos')).todos;
    const result = { local, server, events, allEvents };
    await writeFile(join(artifacts, `${label}-full-source.json`), JSON.stringify({ syntheticOnly: true, observedByDriverAt: new Date().toISOString(), browserClock: await page.evaluate(() => ({ instant: new Date().toISOString(), config: globalThis.__youtraceAuditClock })), ...result, serverTimestampMeaning: 'Original canonical server createdAt/updatedAt/version are preserved separately; browser business dates and any local timestamp are synthetic and are never rewritten to match them', ...extra }, null, 2));
    assert.ok(Array.isArray(server)); assert.ok(server.length < 50, 'Disposable Todo fixture must stay bounded');
    assert.ok(sameRows(server, rowsFromLedger(allEvents)), 'GET rows and complete canonical Todo ledger must agree without dropping fields');
    return result;
  }
  async function ready(page) {
    await page.waitForFunction(() => { const modal = document.querySelector('[role=dialog]'); return modal?.querySelector('#todo-text') && !modal.querySelector('fieldset').disabled && !/正在读取草稿|正在保留草稿/.test(modal.innerText); }, { timeout: 7000 });
  }
  async function editor(page) {
    return page.$eval('[role=dialog]', el => ({ text: el.querySelector('#todo-text').value, priority: el.querySelector('select').value, dueDate: el.querySelector('#todo-date').value, done: el.querySelector('fieldset input[type=checkbox]')?.checked ?? false }));
  }
  async function date(page, value) {
    await tap(page, '#todo-date'); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    const [year, month, day] = value.split('-'); await page.keyboard.type(month + day + year); await page.keyboard.press('Tab');
    assert.equal(await page.$eval('#todo-date', el => el.value), value, 'Native segmented date must match declared deadline');
    actions.push({ kind: 'native-todo-date', surface: surfaceNames.get(page), value });
  }
  async function fill(page, values) {
    await input(page, '#todo-text', values.text); await tap(page, '[role=dialog] select');
    const index = await page.$eval('[role=dialog] select', (el, value) => { const matches = [...el.options].filter(option => option.value === value && !option.disabled); if (matches.length !== 1) throw new Error('Expected one enabled priority'); return [...el.options].indexOf(matches[0]); }, values.priority);
    await page.keyboard.press('Home'); for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    if (values.dueDate) await date(page, values.dueDate); else await tap(page, '[role=dialog] button', '无日期');
    await ready(page); assert.deepEqual(await editor(page), values);
    actions.push({ kind: 'native-todo-priority', surface: surfaceNames.get(page), expected: values.priority, selectedOptionIndex: index });
  }
  async function readEditor(page, expected, label) {
    assert.deepEqual(await editor(page), expected);
    const text = await read(page, '#todo-text'), priority = await read(page, '[role=dialog] select');
    const selectedPriority = await page.$eval('[role=dialog] select', el => el.selectedOptions[0]?.textContent);
    assert.equal(selectedPriority, ({ high: '高', medium: '中', low: '低' })[expected.priority]);
    const field = await page.$eval('#todo-text', el => ({ value: el.value, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, scrollLeft: el.scrollLeft }));
    const deadline = await read(page, await exact(page, '[role=dialog] p', `实际截止日期：${expected.dueDate || '无截止日期'}`));
    const pass = text.visible && priority.visible && deadline.visible && field.value === expected.text && field.scrollWidth <= field.clientWidth && field.scrollLeft === 0;
    await observe(page, `${label}-actual-editor-readable`, pass, JSON.stringify({ text, priority, selectedPriority, deadline, field, expected, note: 'These short titles must fit the real input. Reachable control/full DOM value alone does not prove a clipped long value is readable.' }));
  }
  async function navigate(page, path, label) {
    if (page.viewport().width === 360) {
      await tap(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more');
      await tap(page, `nav[aria-label="全部功能"] a[href="${path}"]`);
    } else await tap(page, 'aside nav button', label);
    await waitPath(page, path);
  }
  async function cancel(page) { await tap(page, '[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 7000 }); }
  async function save(page) { await ready(page); await tap(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 7000 }); }
  function assertDraft(facts, key, typed, source = null) {
    const stored = draftRow(facts, key);
    assert.ok(stored && typeof stored.value?.revision === 'string' && stored.value.revision.length > 0, 'Full ordinary editor input must be durably saved');
    const form = stored.value.value; assert.equal(typeof form.id, 'string'); assert.ok(form.id.length > 0);
    for (const field of FORM_KEYS) assert.deepEqual(form[field], typed[field]);
    assert.deepEqual(form.base, source, 'Full source base includes every originally present field'); if (source) assert.equal(form.id, source.id);
    assert.deepEqual(Object.keys(form).sort(), ['base', 'done', 'dueDate', 'id', 'priority', 'text']); return form;
  }
  async function requirePreserved(page, before, after, label, options = {}) {
    const pass = sourcesPreserved(before, after, options);
    await observe(page, label, pass, JSON.stringify({ settingsDifferences: settingsDifferences(before, after), options, note: 'All rows/fields/versions, exact draft envelope, outbox and full old all-entity ledger remain unchanged except specifically named settings differences.' }));
    assert.ok(pass, 'Source preservation prerequisite failed; stop dependent actions');
  }
  async function create(page, api, label, declared) {
    const original = await facts(page, api, `${label}-before-opening-input`); assert.equal(original.local.outbox.length, 0);
    await tap(page, 'button[aria-label="新建待办"]'); await ready(page); await fill(page, declared);
    const typed = await editor(page), before = await facts(page, api, `${label}-frozen-input`, { extra: { declared, typed } }), form = assertDraft(before, 'record-draft:todo:new', typed);
    await requirePreserved(page, original, before, `${label}-only-exact-new-draft-written`, { writtenDraft: { key: 'record-draft:todo:new', value: form } });
    await readEditor(page, typed, `${label}-frozen`); await save(page);
    const after = await facts(page, api, `${label}-created`), pass = createdOnlyDeclared(before, after, declared);
    await observe(page, `${label}-declared-input-id-and-exact-cloud-ack`, pass, JSON.stringify({ declared, boundId: form.id, beforeVersion: version(before, form.id), afterVersion: version(after, form.id), source: `${label}-created-full-source.json` })); assert.ok(pass);
    return Object.freeze({ ...declared, id: form.id });
  }
  async function visibleRow(page, wanted) {
    // First locate actual title + absolute date/no deadline + priority. ID only corroborates afterwards.
    const candidates = await page.evaluate(wanted => [...document.querySelectorAll('main button[aria-label^="编辑待办 "]')].map(button => {
      const row = button.parentElement, title = button.querySelector('p:first-child')?.textContent, date = button.querySelector('p:nth-child(2)')?.textContent, priority = row.querySelector('span')?.textContent;
      const parts = []; for (let el = row; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(node => node.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
      const group = row.parentElement.parentElement.parentElement.firstElementChild.querySelector('span')?.textContent;
      return { selector: 'body > ' + parts.join(' > '), title, date, priority, group, matches: title === wanted.text && (wanted.dueDate ? date?.includes(` · ${wanted.dueDate} · 编辑`) : date === '无截止日期 · 编辑') && priority === ({ high: '高', medium: '中', low: '低' })[wanted.priority] };
    }), wanted);
    const matches = candidates.filter(row => row.matches); assert.equal(matches.length, 1, `One title/date/priority row required: ${JSON.stringify({ wanted, candidates })}`);
    const row = matches[0], title = await read(page, `${row.selector} button p:first-child`), date = await read(page, `${row.selector} button p:nth-child(2)`), priority = await read(page, `${row.selector} > span`);
    assert.ok(title.visible && date.visible && priority.visible, 'Visible identity must actually be readable before ID corroboration');
    const actual = await page.$eval(row.selector, el => ({ id: el.parentElement.id, done: el.querySelector('input[type=checkbox]').checked }));
    const expectedGroup = wanted.done ? '已完成' : ({ '2026-10-06': '逾期', '2026-10-07': '今天', '2026-10-11': '本周', '2026-10-12': '更晚', '': '更晚' })[wanted.dueDate];
    assert.ok(expectedGroup, 'Declared fixture needs an explicit expected group'); assert.equal(row.group, expectedGroup);
    assert.equal(actual.id, `todo-record-${wanted.id}`); assert.equal(actual.done, wanted.done);
    await capture(page, `${surfaceNames.get(page)}-visible-${wanted.id}-${wanted.done ? 'done' : 'active'}`);
    actions.push({ kind: 'todo-visible-row-identity', surface: surfaceNames.get(page), declared: wanted, expectedGroup, row, title, date, priority, actual }); return row;
  }
  async function open(page, wanted, retained = null) {
    const row = await visibleRow(page, wanted); await tap(page, `${row.selector} button`); await ready(page);
    assert.deepEqual(await editor(page), retained ?? Object.fromEntries(FORM_KEYS.map(key => [key, wanted[key]])));
  }
  async function groups(page, expected, label, records) {
    for (const record of records) await visibleRow(page, record);
    const actual = await page.evaluate(() => [...document.querySelectorAll('main div')].filter(el => el.children.length === 3 && el.children[0].tagName.toLowerCase() === 'svg' && ['逾期', '今天', '本周', '更晚', '已完成'].includes(el.children[1].textContent)).map(el => ({ label: el.children[1].textContent, count: el.children[2].textContent })));
    assert.deepEqual(actual, Object.entries(expected).filter(([, count]) => count > 0).map(([label, count]) => ({ label, count: `(${count})` })), 'Read actual group labels and exact counts, not guessed filter state');
    for (const [name, count] of Object.entries(expected).filter(([, value]) => value > 0)) {
      const selector = await exact(page, 'main span', name), reading = await read(page, selector), countReading = await read(page, `${selector} + span`);
      await observe(page, `${label}-${name}-count`, reading.visible && countReading.visible && countReading.text === `(${count})`, JSON.stringify({ reading, countReading, expected: count }));
    }
  }
  async function chooseRange(page, value, text) {
    await tap(page, '[role=group][aria-label="时间范围"] button', text);
    await page.waitForFunction(({ value, text }) => { const selected = [...document.querySelectorAll('[role=group][aria-label="时间范围"] button[aria-pressed=true]')], url = new URL(location.href); return url.pathname === '/timeline' && url.searchParams.get('range') === value && selected.length === 1 && selected[0].textContent.trim() === text; }, { timeout: 7000 }, { value, text });
    const origin = new URL(page.url()).pathname + new URL(page.url()).search;
    actions.push({ kind: 'todo-timeline-range-observed', surface: surfaceNames.get(page), origin, selected: text, note: 'Freeze only after original single range click has committed URL and unique selected state.' }); return origin;
  }
  async function timelineRow(page, target, label) {
    const selector = await exact(page, `section[aria-label="${TODAY}"] button`, undefined);
    assert.equal(await page.$eval(selector, el => el.getAttribute('aria-label')), `完成待办: ${target.text}`);
    const row = await read(page, selector), dateHeading = await read(page, `section[aria-label="${TODAY}"] > h2`), title = await read(page, `${selector} p:first-child`), detail = await read(page, `${selector} p:nth-child(2)`), time = await read(page, `${selector} p:nth-child(3)`);
    const count = await page.$$eval('section[aria-label] button[aria-label^="完成待办:"]', nodes => nodes.length);
    const pass = count === 1 && row.visible && dateHeading.visible && title.visible && detail.visible && time.visible && title.text === target.text && detail.text === '完成待办' && dateHeading.text === TODAY && /刚刚|分钟前/.test(time.text);
    await observe(page, label, pass, JSON.stringify({ row, title, detail, time, dateHeading, deadline: target.dueDate, completionDate: TODAY, count })); assert.ok(pass, 'Real completion event must be readable under completion date, never its deadline'); return selector;
  }
  async function completionJourney(page, api, records, label) {
    const target = records[0];
    const original = await facts(page, api, `${label}-before-completion`), row = await visibleRow(page, target);
    const earliest = await page.evaluate(() => Date.now()); await tap(page, `${row.selector} input[type=checkbox]`);
    await page.waitForFunction(id => { const checkbox = document.getElementById(`todo-record-${id}`)?.querySelector('input[type=checkbox]'); return checkbox?.checked === true && !checkbox.disabled; }, { timeout: 7000 }, target.id);
    const completed = await facts(page, api, `${label}-completed`), latest = await page.evaluate(() => Date.now()), pass = completionOnly(original, completed, target.id, { before: earliest, after: latest });
    await observe(page, `${label}-same-id-actual-completion-time-and-ack`, pass, JSON.stringify({ id: target.id, window: { before: earliest, after: latest }, local: completed.local.todos.find(value => value.id === target.id), remote: completed.server.find(value => value.id === target.id), source: `${label}-completed-full-source.json` })); assert.ok(pass);
    const done = { ...target, done: true }; await groups(page, { 逾期: 0, 今天: 1, 本周: 1, 更晚: 2, 已完成: 1 }, `${label}-completed-groups`, records.map(row => row.id === target.id ? done : row));
    await navigate(page, '/timeline', '时间线'); await chooseRange(page, 'all', '全部记录'); await timelineRow(page, done, `${label}-all-completion-date`);
    const origin = await chooseRange(page, '7', '近7天'), selector = await timelineRow(page, done, `${label}-seven-completion-date`);
    await tap(page, selector); await waitPath(page, '/todo'); await ready(page); assert.equal(new URL(page.url()).searchParams.get('record'), target.id);
    await readEditor(page, Object.fromEntries(FORM_KEYS.map(key => [key, done[key]])), `${label}-rediscovered-same-completed-todo`); await cancel(page);
    await tap(page, 'main button', '← 返回时间线'); await waitPath(page, '/timeline');
    await page.waitForFunction(origin => location.pathname + location.search === origin && document.querySelectorAll('[role=group][aria-label="时间范围"] button[aria-pressed=true]').length === 1 && [...document.querySelectorAll('[role=group][aria-label="时间范围"] button')].some(el => el.getAttribute('aria-pressed') === 'true' && el.textContent.trim() === '近7天'), { timeout: 7000 }, origin);
    await timelineRow(page, done, `${label}-return-keeps-seven-and-same-event`);
    const returned = await facts(page, api, `${label}-after-range-editor-return`); await requirePreserved(page, completed, returned, `${label}-navigation-reading-cancel-preserve-full-completed-source`);
    await navigate(page, '/todo', '待办'); await visibleRow(page, done);
    const undo = await exact(page, 'main button', '撤销上次完成状态'), feedback = await read(page, 'main div[role=status] > span');
    assert.ok(feedback.visible && feedback.text.includes(target.text)); await tap(page, undo);
    await page.waitForFunction(id => { const checkbox = document.getElementById(`todo-record-${id}`)?.querySelector('input[type=checkbox]'); return checkbox?.checked === false && !checkbox.disabled && ![...document.querySelectorAll('main button')].some(el => el.textContent.trim() === '撤销中…'); }, { timeout: 7000 }, target.id);
    const undone = await facts(page, api, `${label}-undone`), restored = undoOnly(original, completed, undone, target.id);
    await observe(page, `${label}-actual-completion-undo-restores-full-original`, restored, JSON.stringify({ id: target.id, beforeVersion: version(completed, target.id), afterVersion: version(undone, target.id), source: `${label}-undone-full-source.json`, claim: 'Same-session actual completion-state undo; no reload or deleted-record undo claim.' })); assert.ok(restored);
    await groups(page, { 逾期: 1, 今天: 1, 本周: 1, 更晚: 2, 已完成: 0 }, `${label}-undone-groups`, records);
    await navigate(page, '/timeline', '时间线'); await chooseRange(page, 'all', '全部记录');
    await page.waitForFunction(() => !document.querySelector('main [role=status]') && !document.querySelector('main [role=alert]') && [...document.querySelectorAll('main p')].some(el => el.textContent === '这个时间范围还没有记录。'), { timeout: 7000 });
    const empty = await read(page, await exact(page, 'main p', '这个时间范围还没有记录。')), remaining = await page.$$eval('section[aria-label] button[aria-label^="完成待办:"]', nodes => nodes.length);
    await observe(page, `${label}-undo-removes-actual-timeline-event`, empty.visible && remaining === 0, JSON.stringify({ empty, remaining, selected: '全部记录', note: 'All five Todos are now unfinished; complete all-range rendering is empty, while historical server events remain in the saved ledger.' })); assert.ok(empty.visible && remaining === 0);
    await navigate(page, '/todo', '待办'); await visibleRow(page, target);
    await requirePreserved(page, undone, await facts(page, api, `${label}-after-undo-rediscovery`), `${label}-undo-rediscovery-preserves-source-and-history`);
  }
  async function releaseQuota(page, label) {
    const fault = await page.evaluate(() => { globalThis.__restoreTodoFault?.(); return globalThis.__todoFault ?? null; });
    await writeFile(join(artifacts, `${label}-fault.json`), JSON.stringify(fault, null, 2));
    if (fault) assert.ok(fault.restored && !fault.expired && fault.restoredBy === 'explicit-harness-release', 'Timeout restoration cannot satisfy explicit release');
    actions.push({ kind: 'explicit-todo-fault-release', surface: surfaceNames.get(page), restoredBy: fault?.restoredBy }); return fault;
  }
  async function editJourney(page, api, records, label) {
    const target = records[1];
    const original = await facts(page, api, `${label}-before-opening-editor`), source = original.local.todos.find(row => row.id === target.id);
    await open(page, target); const dated = { text: '合成：归还两本图书', priority: 'high', dueDate: '2026-10-09', done: false }; await fill(page, dated);
    const prepared = await facts(page, api, `${label}-dated-draft`), form = assertDraft(prepared, `record-draft:todo:${target.id}`, dated, source);
    await requirePreserved(page, original, prepared, `${label}-opening-and-typing-only-exact-draft`, { writtenDraft: { key: `record-draft:todo:${target.id}`, value: form } });
    await readEditor(page, dated, `${label}-before-cancel`); await cancel(page);
    await requirePreserved(page, prepared, await facts(page, api, `${label}-cancelled`), `${label}-cancel-keeps-full-draft-and-source`);
    await open(page, target, dated); await readEditor(page, dated, `${label}-reopened`);
    await requirePreserved(page, prepared, await facts(page, api, `${label}-reopened-source`), `${label}-reopening-keeps-exact-envelope-and-base`);
    await tap(page, '[role=dialog] button', '无日期'); await ready(page); const typed = { ...dated, dueDate: '' }; assert.deepEqual(await editor(page), typed);
    const before = await facts(page, api, `${label}-explicitly-cleared-deadline`), cleared = assertDraft(before, `record-draft:todo:${target.id}`, typed, source);
    await requirePreserved(page, prepared, before, `${label}-clear-only-exact-draft`, { writtenDraft: { key: `record-draft:todo:${target.id}`, value: cleared } });
    await readEditor(page, typed, `${label}-cleared-deadline`);
    await page.evaluate(installTodoQuota, { owner: api.ownerId, id: target.id }); actions.push({ kind: 'declared-exact-precommit-todo-put-quota', surface: surfaceNames.get(page), owner: api.ownerId, id: target.id, safetyDeadlineMs: 30000 });
    let first;
    try {
      await tap(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog] [role=alert]', { timeout: 7000 });
      await page.waitForFunction(() => globalThis.__todoFault.aborts || globalThis.__todoFault.commits, { timeout: 4000 }); await ready(page);
      const fault = await page.evaluate(() => globalThis.__todoFault), after = await facts(page, api, `${label}-put-refused`, { settle: false, extra: { fault, retainedInput: await editor(page) } });
      const precise = fault.id === target.id && fault.hits.length === 1 && fault.aborts === 1 && fault.commits === 0 && !fault.expired && fault.hits[0].originalCalled === false && isDeepStrictEqual(fault.hits[0].intendedValue, { ...source, ...typed, dueDate: UNDEFINED });
      const preserved = sourcesPreserved(before, after), retained = isDeepStrictEqual(await editor(page), typed);
      await observe(page, `${label}-exact-refusal-abort-zero-commit-source-and-input`, precise && preserved && retained, JSON.stringify({ precise, preserved, retained, fault, settingsDifferences: settingsDifferences(before, after), source: `${label}-put-refused-full-source.json` })); assert.ok(precise && preserved && retained);
      assertDraft(after, `record-draft:todo:${target.id}`, typed, source);
      const reading = await read(page, '[role=dialog] [role=alert]'), text = reading.text;
      await observe(page, `${label}-reader-understands-storage-cause-and-retry`, reading.visible && /存储.{0,12}(?:不足|已满)|空间不足|配额不足/.test(text) && /未保存|未能保存|保存失败|输入.{0,8}保留/.test(text) && /重试|再试/.test(text) && !/QuotaExceededError|Synthetic/.test(text), JSON.stringify({ reading, note: 'Raw quota English remains reader RED even if the independent mechanical retry succeeds.' }));
      await capture(page, `${label}-original-put-refusal`);
    } catch (error) { first = error; throw error; }
    finally { try { await releaseQuota(page, `${label}-put`); } catch (error) { if (!first) throw error; actions.push({ kind: 'todo-cleanup-additional-failure', firstFailure: first.message, cleanupFailure: error.message }); } }
    assert.deepEqual(await editor(page), typed); await readEditor(page, typed, `${label}-released-retained-input`); await save(page);
    const after = await facts(page, api, `${label}-retried-current-save`), pass = editedOnlyDeclared(before, after, target.id, typed);
    await observe(page, `${label}-one-current-save-same-id-full-source-and-neighbor`, pass, JSON.stringify({ id: target.id, typed, beforeVersion: version(before, target.id), afterVersion: version(after, target.id), source: `${label}-retried-current-save-full-source.json` })); assert.ok(pass);
    const changed = { ...target, ...typed }; await groups(page, { 逾期: 1, 今天: 0, 本周: 1, 更晚: 3, 已完成: 0 }, `${label}-final-groups`, records.map(row => row.id === target.id ? changed : row));
    await requirePreserved(page, after, await facts(page, api, `${label}-after-current-row-reading`), `${label}-final-reading-preserves-source`); return changed;
  }
  async function run(page) {
    const label = surfaceNames.get(page), clock = h.clock ?? createHabitAuditClock(); let api;
    await page.evaluateOnNewDocument(installAuditDate, clock); actions.push({ kind: 'explicit-browser-only-advancing-todo-Date', surface: label, ...clock, serverDateUnchanged: true });
    try {
      const profile = PROFILES.find(row => row.width === page.viewport().width); assert.ok(profile && profile.nickname.length <= 20);
      await login(page, profile.phone, profile.nickname); api = await apiFor(page);
      assert.equal(await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())), TODAY);
      await navigate(page, '/todo', '待办'); await page.waitForSelector('button[aria-label="新建待办"]'); await capture(page, `${label}-first-natural-entry`);
      const records = []; for (const [index, declared] of DECLARED.entries()) records.push(await create(page, api, `${label}-create-${index + 1}`, declared));
      const frozen = await facts(page, api, `${label}-all-original-declarations`, { extra: { records } }); assert.ok(declaredRecordsMatch(frozen, records));
      await groups(page, { 逾期: 1, 今天: 1, 本周: 1, 更晚: 2, 已完成: 0 }, `${label}-original-groups`, records);
      await requirePreserved(page, frozen, await facts(page, api, `${label}-after-original-reading`), `${label}-all-original-reading-preserves-source`);
      await completionJourney(page, api, records, `${label}-completion-undo`);
      const changed = await editJourney(page, api, records, `${label}-cancel-clear-refusal-retry`);
      const finalRecords = records.map(row => row.id === changed.id ? changed : row), final = await facts(page, api, `${label}-final-declared-records`, { extra: { originalRecords: records, expectedFinalRecords: finalRecords } });
      assert.ok(declaredRecordsMatch(final, finalRecords));
    } catch (error) {
      await capture(page, `${label}-first-failure`).catch(() => undefined);
      const fault = await page.evaluate(() => globalThis.__todoFault ?? null).catch(() => null);
      if (api) await facts(page, api, `${label}-first-failure`, { settle: false, extra: { firstFailure: error.message, fault } }).catch(async sourceError => { await writeFile(join(artifacts, `${label}-first-failure-source-unavailable.json`), JSON.stringify({ firstFailure: error.message, sourceFailure: sourceError.message, fault }, null, 2)); });
      throw error;
    } finally {
      const active = await page.evaluate(() => Boolean(globalThis.__todoFault && !globalThis.__todoFault.restored)).catch(() => false);
      if (active) await releaseQuota(page, `${label}-final-cleanup`).catch(error => { actions.push({ kind: 'todo-final-cleanup-additional-failure', surface: label, error: error.message }); });
    }
  }
  const media = [];
  for (const width of [1280, 360]) { const name = `${prefix}-${width}`; media.push(name); await isolated(name, { width, height: width === 360 ? 800 : 900 }, run); }
  return { media };
}
