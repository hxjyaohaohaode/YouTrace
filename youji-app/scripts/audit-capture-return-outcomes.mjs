// Test preparation only. Native execution belongs to the existing hosted CI
// driver; no listener, browser launcher, business API writes or app imports here.
import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { createHabitAuditClock, installAuditDate } from './audit-clock.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { preparePreferencePointer } from './audit-preference-pointer.mjs';
import { readExistingAccount } from './audit-initial-session-outcomes.mjs';

const BASELINE = 'eea0f7e4c5b75a867e3eca769e68744865240655';
const RAW = '明天要交报销单；午饭15；地铁3；后天要取快递；合成原文尾记';
const DECLARED = { raw: RAW, name: '合成退餐', amount: '16.25', date: '2026-10-05', direction: 'income', category: 'food', todo: '合成：交蓝色报销单', dueDate: '2026-10-09' };
const PROFILES = [{ width: 1280, height: 900, phone: '13900008891', nickname: 'Synthetic YC1280' }, { width: 360, height: 800, phone: '13900008892', nickname: 'Synthetic YC360' }];
const COMPOSER = '[data-component="capture-composer"]', REVIEW = '[data-component="capture-review"]';
const field = label => `${REVIEW} [aria-label="${label}"]`;
const sameRows = (a, b) => equal([...a].sort((x, y) => String(x.id ?? x.key).localeCompare(String(y.id ?? y.key))), [...b].sort((x, y) => String(x.id ?? x.key).localeCompare(String(y.id ?? y.key))));
const setting = (facts, key) => facts.local.settings.find(row => row.key === key);
const draft = (facts, id) => setting(facts, `capture-review:${id}`)?.value;
const canonicalISO = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const sequence = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

// Decode only the established readExistingAccount lossless format. Raw JSON
// rows remain in artifacts for reading; assertions retain undefined/own keys.
export function decodeCaptureEvidence(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value.type === 'undefined') return undefined;
  if (value.type === 'number') return value.value === '-0' ? -0 : Number(value.value);
  if (value.type === 'bigint') return BigInt(value.value);
  if (value.type === 'date') return new Date(value.value);
  assert.ok(value.type === 'array' || value.type === 'object', 'Unknown source encoding');
  const result = value.type === 'array' ? new Array(value.length) : {};
  for (const [key, entry] of value.entries) Object.defineProperty(result, key, { value: decodeCaptureEvidence(entry), enumerable: true, writable: true, configurable: true });
  return result;
}
function settingsDifferences(a, b) {
  return [...new Set([...a.local.settings, ...b.local.settings].map(row => row.key))].sort().flatMap(key => {
    const before = setting(a, key), after = setting(b, key);
    return equal(before, after) ? [] : [{ key, beforePresent: before !== undefined, afterPresent: after !== undefined, before: before ?? null, after: after ?? null }];
  });
}
function settingsAllowed(a, b, { writes = {}, deletes = [], committed = false } = {}) {
  return settingsDifferences(a, b).every(diff => {
    if (Object.hasOwn(writes, diff.key)) return equal(diff.after, { key: diff.key, value: writes[diff.key] }) && (!diff.before || Object.keys(diff.before).sort().join(',') === 'key,value');
    if (deletes.includes(diff.key)) return diff.beforePresent && !diff.afterPresent;
    // Ordinary background sync metadata is declared, bounded and recorded in
    // every source-difference file, never removed before comparison.
    if (diff.key === 'lastPullAt' || committed && diff.key === 'lastPushAt') return diff.after && Object.keys(diff.after).sort().join(',') === 'key,value' && (!diff.before || Object.keys(diff.before).sort().join(',') === 'key,value') && canonicalISO(diff.after.value) && (!diff.before || canonicalISO(diff.before.value) && Date.parse(diff.after.value) >= Date.parse(diff.before.value));
    return false;
  });
}
function ledgerValid(events) {
  let prior = 0n;
  return Array.isArray(events) && events.every(event => {
    if (!sequence(event.seq) || BigInt(event.seq) <= prior || !['upsert', 'delete'].includes(event.operation) || (event.operation === 'delete' ? event.data !== null : event.data?.id !== event.entityId)) return false;
    prior = BigInt(event.seq); return true;
  });
}
function completeLedgerPage(body, cursor) {
  if (!(cursor === '0' || sequence(cursor)) || body?.protocol !== 2 || !Array.isArray(body.features) || !body.features.includes('goals-v1') || typeof body.hasMore !== 'boolean' || !ledgerValid(body.events)) return false;
  const last = body.events.at(-1)?.seq ?? cursor;
  return body.nextCursor === last && body.events.every(event => BigInt(event.seq) > BigInt(cursor)) && (body.events.length > 0 || body.hasMore === false);
}
function refusalExplained(message) {
  return typeof message === 'string' && /存储.{0,12}(?:不足|已满)|空间不足|配额不足/.test(message) && /未保存|尚未保存|未能保存|保存失败|保存未完成/.test(message) && /(?:确认稿|修改|修正|输入).{0,8}(?:已|仍).{0,6}(?:保留|在(?:本机|此页|当前))/.test(message) && !/QuotaExceededError|Synthetic|未能保留|没有保留|未保留/.test(message);
}
function preserved(a, b, changes = {}) {
  return equal(a.schema, b.schema) && a.databaseName === b.databaseName && a.version === b.version && equal(Object.keys(a.local).sort(), Object.keys(b.local).sort()) && Object.keys(a.local).filter(name => name !== 'settings').every(name => equal(a.local[name], b.local[name])) && settingsAllowed(a, b, changes) && ledgerValid(a.allEvents) && ledgerValid(b.allEvents) && equal(a.allEvents, b.allEvents);
}
function draftBound(facts, id, intended) {
  const value = draft(facts, id);
  return Boolean(value?.inputKey) && value.id === id && equal(setting(facts, `capture-review:${id}`), { key: `capture-review:${id}`, value }) && equal(value, intended) && equal(setting(facts, 'quicknote_review'), { key: 'quicknote_review', value }) && equal(setting(facts, value.inputKey), { key: value.inputKey, value: value.input }) && equal(setting(facts, `${value.inputKey}:context`), { key: `${value.inputKey}:context`, value: value.context }) && !setting(facts, `capture-applied:${id}`) && !setting(facts, `capture-source:${id}`) && !facts.local.quickNotes.some(row => row.id === id);
}
function continuity(a, b, originalId, openedId) {
  // A same-looking B cannot pass as A. Physical retention is a separate fact.
  const original = draft(a, originalId), opened = draft(b, openedId);
  return Boolean(original) && originalId === openedId && equal(original, opened) && draftBound(b, openedId, original);
}
function selectedNote(value, at) {
  return { id: value.id, rawInput: value.input, createdAt: at, expenses: value.expenses.filter(row => row.confirmed).map(row => ({ id: row.id, name: row.name, amount: row.amount, category: row.category, confirmed: true, date: row.date, currency: 'CNY', isIncome: row.isIncome === true })), diary: null, mood: null, moodScore: null, habits: [], todos: value.todos.filter(row => row.confirmed).map(row => ({ id: row.id, text: row.text, confirmed: true, dueDate: row.dueDate ?? null })), confirmed: true, captureContext: value.context };
}
function refusalExact(fault, value, time) {
  const hit = fault?.hits?.[0], intended = hit && decodeCaptureEvidence(hit.intendedValue);
  return fault?.id === value.id && fault.table === 'quickNotes' && fault.method === 'put' && fault.hits.length === 1 && fault.aborts === 1 && fault.commits === 0 && !fault.expired && !fault.restored && hit.originalCalled === false && hit.database === `youtrace:user:${fault.owner}:schedule-v1` && hit.table === 'quickNotes' && hit.key === value.id && intended.createdAt >= time.before && intended.createdAt <= time.after && equal(intended, selectedNote(value, intended.createdAt));
}
function corrected(value, declared = DECLARED) {
  return value?.input === declared.raw && value.expenses?.length === 2 && value.todos?.length === 2 && value.habits?.length === 0 && value.diary === null && value.diaryExcludedText === '合成原文尾记' && value.moodConfirmed === false && value.mood === null && value.moodScore === null && value.context?.date === '2026-10-07' && value.context?.timeZone === 'Asia/Shanghai' && equal(value.expenses.map(row => ({ name: row.name, amount: row.amount, date: row.date, currency: row.currency, isIncome: row.isIncome, confirmed: row.confirmed })), [{ name: declared.name, amount: 1625, date: declared.date, currency: 'CNY', isIncome: true, confirmed: true }, { name: '地铁', amount: 300, date: '2026-10-07', currency: 'CNY', isIncome: false, confirmed: false }]) && value.expenses[0].amountText === declared.amount && value.expenses[0].category === declared.category && equal(value.todos.map(row => ({ text: row.text, dueDate: row.dueDate, confirmed: row.confirmed })), [{ text: declared.todo, dueDate: declared.dueDate, confirmed: true }, { text: '取快递', dueDate: '2026-10-09', confirmed: false }]);
}
function fingerprint(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) : item !== null && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : item;
  return JSON.stringify(canonical(Object.fromEntries(['input', 'context', 'expenses', 'habits', 'todos', 'diary', 'diaryExcludedText', 'diaryDate', 'mood', 'moodScore', 'moodConfirmed'].map(key => [key, value[key]]))));
}
function committedExactly(a, b, value, window) {
  if (!draftBound(a, value.id, value) || !corrected(value) || !ledgerValid(a.allEvents) || !ledgerValid(b.allEvents) || !equal(a.schema, b.schema) || a.version !== b.version || a.databaseName !== b.databaseName || !equal(Object.keys(a.local).sort(), Object.keys(b.local).sort()) || a.local.outbox.length || b.local.outbox.length || !equal(a.allEvents, b.allEvents.slice(0, a.allEvents.length))) return false;
  const receipt = setting(b, `capture-applied:${value.id}`)?.value, refs = receipt?.result?.records, at = receipt?.result?.committedAt;
  if (!Array.isArray(refs) || refs.length !== 3 || !Number.isSafeInteger(at) || at < window.before || at > window.after) return false;
  const [noteRef, expenseRef, todoRef] = refs;
  if (noteRef.entity !== 'quickNotes' || noteRef.id !== value.id || expenseRef.entity !== 'expenses' || todoRef.entity !== 'todos' || new Set(refs.map(row => row.id)).size !== 3 || value.expenses.some(row => row.id === expenseRef.id) || value.todos.some(row => row.id === todoRef.id)) return false;
  const expense = value.expenses.find(row => row.confirmed), todo = value.todos.find(row => row.confirmed);
  const expectedRefs = [{ entity: 'quickNotes', id: value.id, label: '原始速记', effect: 'created' }, { entity: 'expenses', id: expenseRef.id, label: expense.name, date: expense.date, effect: 'created' }, { entity: 'todos', id: todoRef.id, label: todo.text, date: todo.dueDate, effect: 'created' }];
  if (!equal(receipt, { fingerprint: fingerprint(value), result: { expenseCount: 1, habitCount: 0, diaryCreated: false, diaryUpdated: false, todoCount: 1, records: expectedRefs, committedAt: at, captureContext: value.context }, input: value.input, ownerId: value.ownerId })) return false;
  const note = selectedNote(value, at), localRows = { quickNotes: note, expenses: { id: expenseRef.id, name: expense.name, amount: expense.amount, category: expense.category, date: expense.date, isIncome: true, source: 'quicknote' }, todos: { id: todoRef.id, text: todo.text, dueDate: todo.dueDate, priority: 'medium', done: false, createdAt: at, updatedAt: at } };
  for (const [name, rows] of Object.entries(a.local)) {
    if (name === 'settings') continue;
    const added = localRows[name];
    if (added ? rows.some(row => row.id === added.id) || !sameRows(b.local[name], [...rows, added]) : !equal(rows, b.local[name])) return false;
  }
  const added = b.allEvents.slice(a.allEvents.length);
  if (added.length !== 3 || new Set(added.map(row => `${row.entity}:${row.entityId}`)).size !== 3) return false;
  const writes = { [`capture-source:${value.id}`]: value, [`capture-applied:${value.id}`]: receipt };
  for (const ref of refs) {
    const event = added.find(row => row.entity === ref.entity && row.entityId === ref.id);
    if (!event || event.operation !== 'upsert' || a.allEvents.some(row => row.entity === ref.entity && row.entityId === ref.id) || setting(b, `sync-conflict:${ref.entity}:${ref.id}`)) return false;
    const server = event.data;
    if (typeof server.createdAt !== 'string' || !Number.isFinite(Date.parse(server.createdAt)) || typeof server.updatedAt !== 'string' || Date.parse(server.updatedAt) < Date.parse(server.createdAt)) return false;
    const expected = ref.entity === 'quickNotes' ? { id: ref.id, userId: value.ownerId, content: value.input, timestamp: server.timestamp, parsed: { expenses: note.expenses, diary: null, mood: null, moodScore: null, habits: [], todos: note.todos, captureContext: value.context }, confirmed: true, createdAt: server.createdAt, updatedAt: server.updatedAt } : ref.entity === 'expenses' ? { ...localRows.expenses, userId: value.ownerId, relatedMood: null, note: null, createdAt: server.createdAt, updatedAt: server.updatedAt } : { id: ref.id, userId: value.ownerId, text: todo.text, dueDate: todo.dueDate, priority: 'medium', done: false, completedAt: null, createdAt: server.createdAt, updatedAt: server.updatedAt };
    if (!equal(server, expected) || ref.entity === 'quickNotes' && !((typeof server.timestamp === 'number' && server.timestamp === at) || (typeof server.timestamp === 'string' && server.timestamp === String(at)))) return false;
    writes[`sync-version:${ref.entity}:${ref.id}`] = event.seq;
    if (!equal(setting(b, `sync-version:${ref.entity}:${ref.id}`), { key: `sync-version:${ref.entity}:${ref.id}`, value: event.seq })) return false;
  }
  return settingsAllowed(a, b, { writes, deletes: [`capture-review:${value.id}`, 'quicknote_review', value.inputKey, `${value.inputKey}:context`], committed: true }) && equal(setting(b, `capture-source:${value.id}`), { key: `capture-source:${value.id}`, value }) && !draft(b, value.id) && !setting(b, 'quicknote_review') && !setting(b, value.inputKey) && !setting(b, `${value.inputKey}:context`);
}
export const captureReturnChecks = { profiles: PROFILES, declared: DECLARED, corrected, setting, draft, draftBound, continuity, preserved, settingsDifferences, refusalExact, selectedNote, committedExactly, completeLedgerPage, refusalExplained };

// Self-contained native IDB boundary, same pattern as the existing Todo quota.
// Throwing synchronously lets Dexie abort its real transaction naturally.
export function installCaptureReturnQuota({ owner, id }) {
  if (!owner || !id || globalThis.__captureReturnFault && !globalThis.__captureReturnFault.restored) throw new Error('Invalid or still-active capture quota boundary');
  const original = IDBObjectStore.prototype.put, seen = new WeakSet(); let timer;
  const encode = value => {
    if (value === undefined) return { type: 'undefined' };
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : { type: 'number', value: String(Object.is(value, -0) ? '-0' : value) };
    if (Array.isArray(value)) return { type: 'array', length: value.length, entries: Object.keys(value).map(key => [key, encode(value[key])]) };
    if (value && Object.getPrototypeOf(value) === Object.prototype) return { type: 'object', entries: Object.keys(value).sort().map(key => [key, encode(value[key])]) };
    throw new Error('Unsupported intended capture value; stop instead of losing metadata');
  };
  const state = globalThis.__captureReturnFault = { owner, id, table: 'quickNotes', method: 'put', kind: 'SYNTHETIC-exact-current-draft-precommit-quota', hits: [], aborts: 0, commits: 0, restored: false, restoredBy: null, expired: false };
  const wrapped = function(value, key) {
    if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.transaction.mode === 'readwrite' && this.name === 'quickNotes' && value?.id === id) {
      if (!seen.has(this.transaction)) { seen.add(this.transaction); this.transaction.addEventListener('abort', () => { state.aborts++; }, { once: true }); this.transaction.addEventListener('complete', () => { state.commits++; }, { once: true }); }
      state.hits.push({ atMonotonicMs: performance.now(), database: this.transaction.db.name, table: this.name, key: id, originalCalled: false, intendedValue: encode(value) });
      throw new DOMException('Synthetic exact QuickNote precommit put quota', 'QuotaExceededError');
    }
    return key === undefined ? original.call(this, value) : original.call(this, value, key);
  };
  globalThis.__releaseCaptureReturnQuota = (reason = 'explicit-harness-release') => {
    clearTimeout(timer);
    if (IDBObjectStore.prototype.put === wrapped) IDBObjectStore.prototype.put = original;
    state.restored = IDBObjectStore.prototype.put === original; state.restoredBy ??= reason; state.restoredAt ??= performance.now();
    return state;
  };
  IDBObjectStore.prototype.put = wrapped;
  timer = setTimeout(() => { state.expired = true; globalThis.__releaseCaptureReturnQuota('safety-timeout'); }, 30000);
}

export async function runCaptureReturnOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Capture return native evidence runs only in authorized hosted CI');
  const { isolated, login, waitPath, capture, observe, sleep, actions, artifacts, writeFile, join, surfaceNames, origin } = h;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'Existing disposable hosted-CI origin only');
  const media = [];
  await writeFile(join(artifacts, 'YQ-return-scope.json'), JSON.stringify({ applicationBaseline: BASELINE, profiles: PROFILES, declared: DECLARED, kind: 'uncommitted-capture-return-native-RED-baseline', syntheticOnly: true, clock: 'Browser-only advancing 2026-10-07 in Asia/Shanghai; real server audit timestamps', boundaries: ['One capture-return matrix task, existing 8-minute evidence and 20-minute job limits', 'A return-continuity RED remains RED even when separately corrected current draft B saves', 'No hidden review URL, browser history substitute, business API seeding, auth/owner/session/generation changes, live SMS/model or production', 'No preference authority/clear-generation/publication tests or dependent postcommit receipt-read repair', 'Not deletion, full disk exhaustion, reload recovery, simultaneous tabs, two devices, OS or complete accessibility coverage'] }, null, 2));
  for (const profile of PROFILES) {
    const label = `YQ-return-${profile.width}`; media.push(label);
    await isolated(label, { width: profile.width, height: profile.height }, async page => {
      let owner, lastFacts, stage = 'login', firstFailure;
      const save = (name, value) => writeFile(join(artifacts, `${label}-${name}.json`), JSON.stringify(value, null, 2));
      const mark = name => { stage = name; actions.push({ kind: 'capture-return-stage', surface: label, stage, driverTime: new Date().toISOString() }); };
      const get = async path => {
        assert.ok(path === '/api/auth/me' || /^\/api\/sync\/pull\?protocol=2&features=goals-v1&cursor=\d+&limit=500$/.test(path), 'Only declared GET evidence endpoints');
        const result = await page.evaluate(async path => { const response = await fetch(path, { method: 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(5000) }); return { status: response.status, body: await response.json() }; }, path);
        assert.equal(result.status, 200); return result.body;
      };
      const local = async () => {
        const snapshot = await page.evaluate(readExistingAccount, owner);
        return { snapshot, databaseName: snapshot.databaseName, version: snapshot.version, schema: snapshot.schema, local: Object.fromEntries(snapshot.tables.map(table => [table.name, decodeCaptureEvidence(table.losslessRows)])) };
      };
      const facts = async (name, { settle = true, extra = {} } = {}) => {
        let source = await local();
        if (settle) for (let i = 0; i < 60 && source.local.outbox.length; i++) { await sleep(250); source = await local(); }
        if (settle) assert.equal(source.local.outbox.length, 0, 'Whole outbox must ACK before the next task segment');
        const allEvents = [], pages = []; let cursor = '0', finished = false;
        for (let i = 0; i < 20; i++) {
          const path = `/api/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`, body = await get(path); pages.push({ path, body });
          assert.ok(completeLedgerPage(body, cursor), 'Protocol, boolean hasMore and exact last-event cursor must prove every ledger page boundary'); allEvents.push(...body.events);
          if (body.hasMore === false) { finished = true; break; }
          assert.ok(sequence(body.nextCursor) && BigInt(body.nextCursor) > BigInt(cursor)); cursor = body.nextCursor;
        }
        assert.ok(finished && ledgerValid(allEvents), 'Complete bounded GET ledger, never a truncated prefix');
        const result = { ...source, allEvents };
        await save(`${name}-full-source`, { syntheticOnly: true, observedByDriverAt: new Date().toISOString(), browserClock: await page.evaluate(() => ({ instant: new Date().toISOString(), fixture: globalThis.__youtraceAuditClock })), serverAuditClock: 'real, never aligned to browser business date', ...result, pages, ...extra });
        lastFacts = result; return result;
      };
      const exact = async (selector, text) => {
        await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (text === undefined || el.textContent.trim() === text); }).length === 1, { timeout: 7000 }, { selector, text });
        return page.evaluate(({ selector, text }) => {
          const rows = [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (text === undefined || el.textContent.trim() === text); });
          if (rows.length !== 1) throw new Error('Rendered target changed');
          const parts = []; for (let el = rows[0]; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(node => node.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
          return 'body > ' + parts.join(' > ');
        }, { selector, text });
      };
      const read = async (selector, text) => {
        const resolved = await exact(selector, text);
        for (let i = 0; i < 16; i++) {
          const box = await page.evaluate(initialSessionGeometry, resolved); assert.ok(box.unique);
          if (box.visible) return { ...box, resolved };
          const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, profile.height - 20)), deltaY = box.rect.y + box.rect.height / 2 - y;
          if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-capture-return', surface: label, selector, x, y, deltaY, clip: box.clip }); }
          await sleep(125);
        }
        throw new Error(`Unreadable painted/clipped control: ${selector} / ${text ?? ''}`);
      };
      const tap = async (selector, text) => {
        await page.bringToFront(); const reading = await read(selector, text), probes = [];
        assert.equal(await page.$eval(reading.resolved, el => el.matches(':disabled')), false);
        let point; try { point = await preparePreferencePointer(page, reading.resolved, selector, text, probes); } finally { actions.push({ kind: 'capture-return-preclick', surface: label, selector, text, probes }); }
        await page.mouse.click(point.x, point.y); actions.push({ kind: 'native-capture-return-pointer', surface: label, selector, text, ...point });
      };
      const input = async (selector, value) => {
        await tap(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(value);
        assert.equal(await page.$eval(selector, el => el.value), value); actions.push({ kind: 'native-capture-return-input', surface: label, selector, value });
      };
      const date = async (selector, value) => {
        await tap(selector); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft'); const [year, month, day] = value.split('-'); await page.keyboard.type(month + day + year); await page.keyboard.press('Tab');
        assert.equal(await page.$eval(selector, el => el.value), value); actions.push({ kind: 'native-capture-return-date', surface: label, selector, value });
      };
      const select = async (selector, value) => {
        const index = await page.$eval(selector, (el, value) => [...el.options].findIndex(option => option.value === value && !option.disabled), value); assert.ok(index >= 0);
        await tap(selector); await page.keyboard.press('Home'); for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); assert.equal(await page.$eval(selector, el => el.value), value);
      };
      const check = async (name, value) => {
        const selector = field(name), labelSelector = await exact(selector);
        // Painted Checkbox label owns its native transparent input; click the
        // real label instead of claiming the opacity-zero input is visible.
        const parent = await page.$eval(labelSelector, el => { const id = el.id; return `label[for="${CSS.escape(id)}"]`; });
        if (await page.$eval(selector, el => el.checked) !== value) await tap(parent);
        assert.equal(await page.$eval(selector, el => el.checked), value); await read(parent);
      };
      const retained = async () => {
        await page.waitForFunction(() => [...document.querySelectorAll('[data-component="capture-review"] footer [role=status]')].some(el => el.textContent.startsWith('确认稿已保留在本机')) && !document.querySelector('[data-component="capture-review"] fieldset')?.disabled, { timeout: 7000 });
        return read(`${REVIEW} footer [role=status]`);
      };
      const readValue = async (selector, expected, name) => {
        const box = await read(selector), fieldValue = await page.$eval(selector, el => ({ value: el.value, selectedText: el.selectedOptions?.[0]?.textContent ?? null, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft }));
        assert.equal(fieldValue.value, expected);
        if (expected === 'income' || expected === 'expense') assert.equal(fieldValue.selectedText, expected === 'income' ? '收入' : '支出');
        if (expected === 'food') assert.equal(fieldValue.selectedText, '餐饮');
        assert.ok(fieldValue.scrollWidth <= fieldValue.clientWidth && fieldValue.scrollLeft === 0, 'Short declared input must be fully readable, not only present in DOM');
        await observe(page, `${label}-${name}`, true, JSON.stringify({ box, fieldValue, expected })); return fieldValue;
      };
      const preserve = async (before, after, name, changes = {}) => {
        const pass = preserved(before, after, changes); await save(`${name}-changes`, { pass, changes, settingsDifferences: settingsDifferences(before, after) });
        await observe(page, `${label}-${name}`, pass, 'Full schema, all other local tables/rows/metadata, outbox and complete prior GET ledger are unchanged; only listed exact settings transitions may differ');
        assert.ok(pass, 'Unverified source change stops all later business actions');
      };
      const navigate = async (path, title) => {
        if (profile.width === 360) {
          await tap('nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more'); await tap(`nav[aria-label="全部功能"] a[href="${path}"]`);
        } else await tap('aside nav button', title);
        await waitPath(page, path);
      };
      const inputsAdded = (before, after, raw, context) => {
        const added = after.local.settings.filter(row => row.key.startsWith('capture-input:') && !setting(before, row.key)), textRows = added.filter(row => !row.key.endsWith(':context'));
        assert.equal(textRows.length, 1); assert.equal(added.length, 2); const key = textRows[0].key, basis = setting(after, `${key}:context`)?.value;
        assert.equal(textRows[0].value, raw); assert.equal(basis?.date, '2026-10-07'); assert.equal(basis?.timeZone, 'Asia/Shanghai'); assert.ok(Number.isSafeInteger(basis?.capturedAt)); if (context) assert.deepEqual(basis, context);
        return { key, context: basis, writes: { [key]: raw, [`${key}:context`]: basis } };
      };
      const inventory = async name => {
        const controls = await page.$$eval(`${COMPOSER} button, ${COMPOSER} a, ${COMPOSER} summary`, rows => rows.map(el => ({ label: el.getAttribute('aria-label') || el.textContent.trim(), tag: el.tagName, href: el.getAttribute('href'), disabled: el.matches(':disabled'), rendered: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 })));
        const continuation = controls.filter(row => row.rendered && /确认稿|继续|恢复|重试/.test(row.label));
        await save(`${name}-all-ordinary-controls`, { controls, continuation, note: 'DOM inventory is discovery, not proof of reading. Composer top Return exists and can traverse its existing navigation history; this task does not exercise it or claim every route to A is unavailable. Each review-specific continuation below receives a painted geometry observation.' });
        await read(`${COMPOSER} > header button[aria-label="返回"]`);
        for (const item of continuation) { assert.equal(item.tag, 'BUTTON'); await read(`${COMPOSER} button`, item.label); }
        assert.deepEqual(continuation.map(row => row.label), ['查看确认稿'], 'New review-specific continuation/recovery control requires inspection; stop without asserting overall unavailability or substituting a hidden URL');
        await capture(page, `${label}-${name}-visible-continue`);
      };
      const correctReview = async (before, id, name) => {
        mark(name); const source = draft(before, id); assert.ok(source && draftBound(before, id, source));
        await input(field('第1笔收支名称'), DECLARED.name); await input(field('第1笔金额（人民币元）'), DECLARED.amount); await date(field('第1笔记录日期'), DECLARED.date); await select(field('第1笔收支方向'), 'income');
        await input(field('第1个待办内容'), DECLARED.todo); await date(field('第1个待办截止日期'), DECLARED.dueDate);
        await check('记录第1笔收支', true); await check('记录第2笔收支', false); await check('记录第1个待办', true); await check('记录第2个待办', false); await check('将这段文字记入日记', false); await check('我愿意记录这次心情', false); await retained();
        const expected = { ...source, expenses: source.expenses.map((row, i) => i === 0 ? { ...row, name: DECLARED.name, amount: 1625, amountText: DECLARED.amount, date: DECLARED.date, isIncome: true, confirmed: true } : { ...row, confirmed: false }), todos: source.todos.map((row, i) => i === 0 ? { ...row, text: DECLARED.todo, dueDate: DECLARED.dueDate, dateConfirmed: true, confirmed: true } : { ...row, confirmed: false }), diary: null, diaryExcludedText: source.diary ?? source.diaryExcludedText, moodConfirmed: false };
        const after = await facts(`${name}-retained`); assert.ok(corrected(expected) && draftBound(after, id, expected));
        await preserve(before, after, `${name}-only-exact-reviewed-intent`, { writes: { [`capture-review:${id}`]: expected, quicknote_review: expected } });
        await readReview(expected, name); return { facts: after, draft: expected };
      };
      const readReview = async (value, name) => {
        const readings = [['第1笔收支名称', value.expenses[0].name], ['第1笔金额（人民币元）', value.expenses[0].amountText ?? String(value.expenses[0].amount / 100)], ['第1笔记录日期', value.expenses[0].date], ['第1笔收支方向', value.expenses[0].isIncome ? 'income' : 'expense'], ['第1笔分类', value.expenses[0].category], ['第1个待办内容', value.todos[0].text], ['第1个待办截止日期', value.todos[0].dueDate]];
        for (const [labelText, expected] of readings) await readValue(field(labelText), expected, `${name}-read-${labelText}`);
        const currency = await read(`${REVIEW} label:has(input[aria-label="第1笔金额（人民币元）"])`);
        assert.ok(currency.text.includes('人民币 CNY（元）'));
        await tap(`${REVIEW} summary`, '查看原文与本机确认稿');
        const raw = await read(`${REVIEW} details[open] > p`); assert.equal(raw.text, RAW); await observe(page, `${label}-${name}-read-full-original`, true, JSON.stringify({ raw, currency, draftId: value.id }));
        await tap(`${REVIEW} summary`, '查看原文与本机确认稿');
        const scope = await read(field('本次保存范围')), status = await retained();
        await observe(page, `${label}-${name}-visible-retained-selection`, scope.text === '原文 + 1 笔收支 · 1 个待办 · 不写日记 · 不记录情绪', JSON.stringify({ scope, status, draftId: value.id, note: 'Displayed CNY label, native selected direction/date/content and unchecked choices were actually read; this is not business Save.' }));
      };
      const release = async name => {
        const fault = await page.evaluate(() => globalThis.__releaseCaptureReturnQuota?.() ?? null); await save(`${name}-fault`, fault);
        assert.ok(fault?.restored && !fault.expired && fault.restoredBy === 'explicit-harness-release', 'Safety expiry cannot count as explicit release'); return fault;
      };
      try {
        const clock = h.clock ?? createHabitAuditClock(); await page.evaluateOnNewDocument(installAuditDate, clock); actions.push({ kind: 'explicit-browser-only-capture-return-Date', surface: label, ...clock, serverDateUnchanged: true });
        await login(page, profile.phone, profile.nickname); owner = (await get('/api/auth/me')).user?.id; assert.ok(owner);
        mark('native-setup-neighbor'); await navigate('/todo', '待办'); const empty = await facts('before-neighbor-opening');
        assert.equal(empty.local.todos.length, 0); await tap('button[aria-label="新建待办"]'); await page.waitForSelector('#todo-text'); await input('#todo-text', '合成：保留邻居待办'); await tap('[role=dialog] button', '无日期');
        await page.waitForFunction(() => !document.querySelector('[role=dialog] fieldset')?.disabled && !/正在保留草稿|正在读取草稿/.test(document.querySelector('[role=dialog]')?.innerText ?? ''), { timeout: 7000 });
        await readValue('#todo-text', '合成：保留邻居待办', 'neighbor-read-input'); await read('[role=dialog] p', '实际截止日期：无截止日期');
        const typed = await facts('neighbor-native-draft'), envelope = setting(typed, 'record-draft:todo:new')?.value, neighbor = envelope?.value;
        assert.ok(neighbor && typeof envelope.revision === 'string' && neighbor.id && equal(neighbor, { id: neighbor.id, text: '合成：保留邻居待办', priority: 'medium', dueDate: '', done: false, base: null }));
        await preserve(empty, typed, 'neighbor-typing-only-draft', { writes: { 'record-draft:todo:new': envelope } });
        await tap('[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true }); const baseline = await facts('neighbor-native-ack');
        const event = baseline.allEvents.at(-1), expectedNeighbor = { id: neighbor.id, text: neighbor.text, priority: 'medium', dueDate: undefined, done: false, completedAt: null };
        assert.ok(baseline.allEvents.length === typed.allEvents.length + 1 && equal(typed.allEvents, baseline.allEvents.slice(0, -1)) && event.entity === 'todos' && event.entityId === neighbor.id && event.operation === 'upsert' && typeof event.data?.createdAt === 'string' && Number.isFinite(Date.parse(event.data.createdAt)) && typeof event.data.updatedAt === 'string' && Date.parse(event.data.updatedAt) >= Date.parse(event.data.createdAt));
        assert.deepEqual(event.data, { id: neighbor.id, text: neighbor.text, dueDate: null, priority: 'medium', done: false, completedAt: null, userId: owner, createdAt: event.data.createdAt, updatedAt: event.data.updatedAt });
        assert.deepEqual(baseline.local.todos, [expectedNeighbor]);
        assert.deepEqual(setting(baseline, `sync-version:todos:${neighbor.id}`), { key: `sync-version:todos:${neighbor.id}`, value: event.seq }, 'Native setup neighbor needs its actual complete ACK version row');
        const projected = { ...baseline, allEvents: typed.allEvents, local: { ...baseline.local, todos: typed.local.todos } };
        assert.ok(preserved(typed, projected, { writes: { [`sync-version:todos:${neighbor.id}`]: event.seq }, deletes: ['record-draft:todo:new'], committed: true }));
        await read(`button[aria-label="编辑待办 ${neighbor.text}"]`); await capture(page, `${label}-native-neighbor`);
        // Capture is reached through the actual navigation entry after setup.
        await navigate('/quick-note', '速记'); await page.waitForFunction(() => document.querySelector('[data-component="capture-composer"] [role=status]')?.textContent === '原文已保留在本机', { timeout: 7000 });
        const opened = await facts('composer-before-input'), inputA = inputsAdded(baseline, opened, ''); await preserve(baseline, opened, 'composer-only-new-empty-input', { writes: inputA.writes });
        await input(`${COMPOSER} textarea[aria-label="速记内容"]`, RAW); await page.waitForFunction(() => document.querySelector('[data-component="capture-composer"] [role=status]')?.textContent === '原文已保留在本机', { timeout: 7000 });
        const rawA = await facts('raw-input-A'); await preserve(opened, rawA, 'typing-only-original-input', { writes: { [inputA.key]: RAW } }); await readValue(`${COMPOSER} textarea`, RAW, 'read-native-raw-input'); await inventory('first-composer');
        await tap(`${COMPOSER} button`, '查看确认稿'); await waitPath(page, '/quick-note/result'); await retained();
        const idA = new URL(page.url()).searchParams.get('draft'); assert.ok(idA); const parsed = await facts('A-before-reading-or-correction'), parsedA = draft(parsed, idA);
        assert.ok(parsedA && parsedA.inputKey === inputA.key && parsedA.ownerId === owner && equal(parsedA.context, inputA.context) && parsedA.input === RAW && parsedA.expenses.length === 2 && parsedA.todos.length === 2 && parsedA.habits.length === 0 && parsedA.diary === '合成原文尾记');
        assert.deepEqual(parsedA.expenses, [{ id: 'exp-0', name: '午饭', amount: 1500, category: 'food', confirmed: true, date: '2026-10-07', currency: 'CNY', isIncome: false }, { id: 'exp-1', name: '地铁', amount: 300, category: 'transport', confirmed: true, date: '2026-10-07', currency: 'CNY', isIncome: false }]);
        assert.deepEqual(parsedA.todos, [{ id: 'todo-0', text: '交报销单', confirmed: true, dueDate: '2026-10-08', dateUncertain: false }, { id: 'todo-1', text: '取快递', confirmed: true, dueDate: '2026-10-09', dateUncertain: false }]);
        await preserve(rawA, parsed, 'A-created-only-declared-review', { writes: { [`capture-review:${idA}`]: parsedA, quicknote_review: parsedA } });
        const disclosure = await read(`${REVIEW} p`, '规则整理可能有遗漏。你可以补充、修改，或只保留原文。'); assert.ok(disclosure.visible);
        await readValue(field('第1笔金额（人民币元）'), '15', 'read-uncorrected-amount'); await readValue(field('第1个待办截止日期'), '2026-10-08', 'read-uncorrected-date');
        const reviewedA = await correctReview(parsed, idA, 'A-native-corrected-review');
        mark('actual-top-return-and-composer-reentry'); await tap(`${REVIEW} > header button[aria-label="返回"]`); await waitPath(page, '/quick-note');
        await page.waitForFunction(() => document.querySelector('[data-component="capture-composer"] [role=status]')?.textContent === '原文已保留在本机', { timeout: 7000 });
        const returned = await facts('after-top-return-before-reentry'), inputB = inputsAdded(reviewedA.facts, returned, RAW, parsedA.context);
        await preserve(reviewedA.facts, returned, 'return-retains-A-and-original-input', { writes: inputB.writes }); await readValue(`${COMPOSER} textarea`, RAW, 'returned-full-raw-input'); await inventory('returned-composer');
        await tap(`${COMPOSER} button`, '查看确认稿'); await waitPath(page, '/quick-note/result'); await retained();
        const currentId = new URL(page.url()).searchParams.get('draft'); assert.ok(currentId); const reentered = await facts('ordinary-reentry-before-new-correction'), current = draft(reentered, currentId);
        const openedExpected = currentId === idA ? reviewedA.draft : { ...parsedA, id: currentId, inputKey: inputB.key };
        assert.deepEqual(current, openedExpected, 'Unexpected source/body change stops before diagnostics'); assert.ok(draftBound(reentered, currentId, openedExpected));
        await preserve(returned, reentered, 'ordinary-reentry-only-current-review', { writes: { [`capture-review:${currentId}`]: openedExpected, quicknote_review: openedExpected } });
        const continuesA = continuity(reviewedA.facts, reentered, idA, currentId);
        await readValue(field('第1笔金额（人民币元）'), current.expenses[0].amountText ?? String(current.expenses[0].amount / 100), 'ordinary-reentry-actual-amount'); await readValue(field('第1个待办内容'), current.todos[0].text, 'ordinary-reentry-actual-todo');
        await observe(page, `${label}-ordinary-return-continues-original-corrections`, continuesA, JSON.stringify({ originalDraftId: idA, openedDraftId: currentId, originalCompleteDraftRetained: equal(draft(reentered, idA), reviewedA.draft), originalRawRetained: equal(setting(reviewedA.facts, inputA.key), setting(reentered, inputA.key)), current, note: 'Changed ID/body is continuity RED for the actual View review button, never deletion or proof all routes to A are unavailable. Composer top Return remains a visible control and may traverse existing history; no hidden deep link or history action substitutes for this tested path.' }));
        // The outcome above is already recorded. The following is explicitly a
        // NEW review of the actually opened draft, not a resumed A assertion.
        await observe(page, `${label}-current-draft-diagnostic-boundary`, null, JSON.stringify({ originalDraftId: idA, currentDraftId: currentId, kind: currentId === idA ? 'current A independently checked again' : 'NEW native B review/correction; A continuity remains RED', intended: DECLARED }));
        const currentReview = await correctReview(reentered, currentId, 'NEW-current-draft-native-review');
        mark('exact-precommit-quota'); await read(`${REVIEW} footer button`, '确认保存所选记录');
        const before = await facts('current-before-fault'); await preserve(currentReview.facts, before, 'current-reading-preserves-review');
        await page.evaluate(installCaptureReturnQuota, { owner, id: currentId }); const refusalWindow = { before: await page.evaluate(() => Date.now()) };
        try {
          await tap(`${REVIEW} footer button`, '确认保存所选记录'); await page.waitForSelector(`${REVIEW} [role=alert]`, { timeout: 7000 });
          await page.waitForFunction(() => globalThis.__captureReturnFault.aborts || globalThis.__captureReturnFault.commits, { timeout: 4000 }); refusalWindow.after = await page.evaluate(() => Date.now());
          const naturalAlert = await page.evaluate(initialSessionGeometry, `${REVIEW} [role=alert]`);
          await capture(page, `${label}-refusal-before-any-reading-scroll`); await save('refusal-natural-viewport', { naturalAlert, note: 'Captured before any harness reading wheel. Later reached/error-reading screenshots do not prove the error naturally appeared in the current viewport.' });
          const fault = await page.evaluate(() => globalThis.__captureReturnFault), refused = await facts('current-put-refusal', { settle: false, extra: { fault, refusalWindow } });
          assert.ok(refusalExact(fault, currentReview.draft, refusalWindow), 'One exact put, no original call, native abort, zero transaction commit, within active boundary');
          await preserve(before, refused, 'quota-zero-partial-business-source-receipt-outbox-ledger'); assert.ok(draftBound(refused, currentId, currentReview.draft));
          const alert = await read(`${REVIEW} [role=alert]`), explanation = await read(`${REVIEW} [role=alert] > p`), retry = await read(`${REVIEW} [role=alert] button`, '重试保留修改'), businessSave = await read(`${REVIEW} footer button`, '确认保存所选记录');
          const understandable = refusalExplained(explanation.text);
          await observe(page, `${label}-reader-understands-not-committed-retained-intent-cause-and-save`, understandable, JSON.stringify({ naturalAlert, reachedAlert: alert, explanation, retry, businessSave, note: 'Error reading is after actual wheel navigation when needed. 重试保留修改 retries review autosave only. 确认保存所选记录 is the separate business save. Mechanical rollback is not readable recovery wording.' }));
          await capture(page, `${label}-original-precommit-refusal`);
        } catch (error) {
          await capture(page, `${label}-first-fault-segment-failure-before-release`).catch(() => undefined);
          await save('first-fault-segment-failure-before-release', { message: error.message, fault: await page.evaluate(() => globalThis.__captureReturnFault).catch(() => null) });
          throw error;
        } finally { await release('explicit-before-retry'); }
        await readReview(currentReview.draft, 'released-current-intent');
        const released = await facts('current-after-explicit-release'); await preserve(before, released, 'release-keeps-full-current-draft-and-old-A');
        mark('one-original-business-save-after-release'); const retryWindow = { before: await page.evaluate(() => Date.now()) };
        await tap(`${REVIEW} footer button`, '确认保存所选记录'); await page.waitForFunction(id => location.pathname === '/quick-note/result' && new URLSearchParams(location.search).get('receipt') === id, { timeout: 10000 }, currentId);
        const committed = await facts('one-current-draft-save-ack'); retryWindow.after = await page.evaluate(() => Date.now());
        const precise = committedExactly(before, committed, currentReview.draft, retryWindow); await save('commit-differences', { precise, retryWindow, settingsDifferences: settingsDifferences(before, committed) });
        await observe(page, `${label}-one-retry-exact-receipt-IDs-selected-entities-and-history`, precise, 'Exactly one new current-draft QuickNote, one selected Expense and Todo with actual generated receipt IDs; all unselected entities, full native neighbor, old A/input and complete prior ledger preserved'); assert.ok(precise);
        await finishReceipt(committed, currentReview.draft);
      } catch (error) {
        firstFailure = error; await capture(page, `${label}-first-failure-${stage}`).catch(() => undefined);
        const fault = await page.evaluate(() => globalThis.__captureReturnFault ?? null).catch(() => null); await save('first-failure', { stage, message: error.message, fault, lastCompletedSource: lastFacts?.databaseName ?? null });
        if (owner) await facts(`first-failure-${stage}`, { settle: false, extra: { firstFailure: error.message, fault, note: 'Read-only preservation after the first failed assertion; no later business action.' } }).catch(sourceError => save('first-failure-source-unavailable', { message: sourceError.message }));
        throw error;
      } finally {
        const active = await page.evaluate(() => globalThis.__captureReturnFault && !globalThis.__captureReturnFault.restored).catch(() => false);
        if (active) await release('final-cleanup').catch(error => { actions.push({ kind: 'capture-return-cleanup-failure', surface: label, error: error.message, firstFailure: firstFailure?.message }); });
      }

      async function finishReceipt(frozen, value) {
        mark('actual-receipt-destinations-and-return'); const receiptPath = `/quick-note/result?receipt=${encodeURIComponent(value.id)}`, refs = setting(frozen, `capture-applied:${value.id}`).value.result.records;
        await page.waitForFunction(() => [...document.querySelectorAll('[data-component="capture-review"] ul:first-of-type [role=status]')].filter(el => el.textContent === '已收到云端版本确认').length === 3, { timeout: 7000 });
        for (const ref of refs) {
          const path = ref.entity === 'quickNotes' ? `/timeline?record=${encodeURIComponent(ref.id)}` : `${ref.entity === 'todos' ? '/todo' : '/expense'}?record=${encodeURIComponent(ref.id)}`;
          const link = await read(`${REVIEW} a[href="${path}"]`);
          if (ref.entity === 'quickNotes') assert.ok(link.text.includes('原始速记') && link.text.includes(RAW), 'Select the original-note link by its visible kind and actual raw input before corroborating its ID');
          if (ref.entity === 'expenses') assert.ok(link.text.includes(DECLARED.name) && link.text.includes(`${DECLARED.date} · 收入 CNY ¥16.25`));
          if (ref.entity === 'todos') assert.ok(link.text.includes(DECLARED.todo) && link.text.includes(`截止 ${DECLARED.dueDate} · 未完成`));
          await observe(page, `${label}-visible-receipt-${ref.entity}`, true, JSON.stringify({ link, ref })); await tap(`${REVIEW} a[href="${path}"]`); await waitPath(page, path.split('?')[0]); assert.equal(new URL(page.url()).searchParams.get('record'), ref.id);
          if (ref.entity === 'quickNotes') {
            const raw = await read('[role=dialog] p', RAW); await observe(page, `${label}-receipt-original-note`, true, JSON.stringify({ raw, actualId: ref.id })); await tap('[role=dialog] button', '返回保存结果');
          } else {
            await page.waitForSelector(ref.entity === 'todos' ? '#todo-text' : '#expense-name');
            await readValue(ref.entity === 'todos' ? '#todo-text' : '#expense-name', ref.label, `actual-${ref.entity}-content`);
            if (ref.entity === 'todos') { await readValue('#todo-date', DECLARED.dueDate, 'actual-todo-date'); await read('[role=dialog] p', `实际截止日期：${DECLARED.dueDate}`); }
            else { await readValue('#expense-amount', '16.25', 'actual-expense-amount'); await readValue('#expense-date', DECLARED.date, 'actual-expense-date'); await read('[role=dialog] p', `${DECLARED.date} · 收入 CNY ¥16.25`); }
            await tap('[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true }); await tap('main button', '← 返回保存结果');
          }
          await waitPath(page, '/quick-note/result'); assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, receiptPath);
          await preserve(frozen, await facts(`after-${ref.entity}-receipt-return`), `${ref.entity}-read-cancel-return-keeps-exact-sources`);
        }
        await tap(`${REVIEW} button`, '回到首页'); await waitPath(page, '/'); await navigate('/timeline', '时间线');
        await tap('[role=group][aria-label="时间范围"] button', '全部记录');
        await page.waitForFunction(() => location.pathname === '/timeline' && location.search === '?range=all' && [...document.querySelectorAll('[role=group][aria-label="时间范围"] button[aria-pressed=true]')].length === 1 && document.querySelector('[role=group][aria-label="时间范围"] button[aria-pressed=true]')?.textContent === '全部记录', { timeout: 7000 });
        const originPath = new URL(page.url()).pathname + new URL(page.url()).search; actions.push({ kind: 'capture-return-timeline-origin-after-URL-and-selected-state', surface: label, originPath });
        const noteButton = `button[aria-label="原始速记: ${RAW}"]`; await read(noteButton); await tap(noteButton); await page.waitForSelector('[role=dialog]'); assert.equal(new URL(page.url()).searchParams.get('record'), value.id); await read('[role=dialog] p', RAW);
        await tap('[role=dialog] button', '返回时间线'); await page.waitForSelector('[role=dialog]', { hidden: true });
        await page.waitForFunction(expected => location.pathname + location.search === expected && document.querySelector('[role=group][aria-label="时间范围"] button[aria-pressed=true]')?.textContent === '全部记录', { timeout: 7000 }, originPath);
        await read(noteButton); await tap(noteButton); await tap('[role=dialog] a', '查看本机保存结果与去向'); await waitPath(page, '/quick-note/result'); assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, receiptPath);
        await preserve(frozen, await facts('final-visible-original-timeline-receipt-return'), 'final-visible-rediscovery-preserves-all-source-history');
      }
    });
  }
  return { media };
}
