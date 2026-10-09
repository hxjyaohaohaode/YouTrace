// Ordinary Diary native RED baseline. Disposable hosted CI fixtures only.
// Business input is native UI; HTTP below is GET-only source corroboration.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHabitAuditClock, installAuditDate } from './audit-clock.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { preparePreferencePointer } from './audit-preference-pointer.mjs';
import { FIRST_OPEN_PROFILES, FIRST_OPEN_WINDOW_MS, firstOpenContinuityPass, installFirstDiaryObserver } from './audit-diary-first-open.mjs';

const BASELINE = '07bc198487a883fc9e508520a2eaef6d2bd1dd74';
const TODAY = '2026-10-07';
const DATE = 'input[aria-label="日记日期"]';
const KEYS = ['date', 'content', 'mood', 'moodScore', 'source'];
const FORM_KEYS = ['date', 'content', 'mood', 'moodScore'];
const PROFILES = [
  { scenarioSet: 'records', width: 1280, phone: '13900008871', nickname: 'Synthetic YD R1280', mood: null, moodScore: null },
  { scenarioSet: 'records', width: 360, phone: '13900008872', nickname: 'Synthetic YD R360', mood: 'good', moodScore: 7 },
  { scenarioSet: 'recovery', width: 1280, phone: '13900008873', nickname: 'Synthetic YD F1280', mood: null, moodScore: null },
  { scenarioSet: 'recovery', width: 360, phone: '13900008874', nickname: 'Synthetic YD F360', mood: 'good', moodScore: 7 },
];
const LONG = '合成日记：图书馆的一天。\n上午整理了借书清单，把需要归还的两本书放进帆布袋；到馆后先还书，再找靠窗的位置读了半小时。\n中午带的饭有点凉，下午回家后把桌面收拾好，给阳台的植物浇水，还记下了明天要补买的生活用品。\n傍晚散步时绕过正在施工的小路，从河边走回家；这段经历只属于这一天，最后一句也要完整读到：蓝色书签还夹在第三章。';
const SHORT = '合成日记：短行记录\n早上还书\n午后浇花\n末行：蓝色书签';
const SECOND = '合成日记：同一天的补充稿。\n刚想起借书清单里还少了一本，不确定是否要补到原文。\n先核对原日记，再回来继续这份输入；不改日期绕过每天一篇的规则。';
const CORRECTION = '合成日记：已核对图书馆记录。\n上午归还的其实是三本书，借书清单已核对。\n下午浇花，傍晚沿河散步。\n末行：蓝色书签还夹在第三章。';
const validVersion = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const version = (facts, id) => facts.local.settings.find(row => row.key === `sync-version:diaries:${id}`)?.value;
const sameRows = (a, b) => isDeepStrictEqual([...a].sort((x, y) => String(x.id ?? x.key).localeCompare(String(y.id ?? y.key))), [...b].sort((x, y) => String(x.id ?? x.key).localeCompare(String(y.id ?? y.key))));
const onlyChanges = (a, b, allowed) => Boolean(a && b) && [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => allowed.includes(key) || Object.hasOwn(a, key) === Object.hasOwn(b, key) && isDeepStrictEqual(a[key], b[key]));
const draftRow = (facts, key) => facts.local.settings.find(row => row.key === key);
function settingsDifferences(before, after) {
  return [...new Set([...before.local.settings, ...after.local.settings].map(row => row.key))].sort().flatMap(key => {
    const a = draftRow(before, key), b = draftRow(after, key);
    return isDeepStrictEqual(a, b) ? [] : [{ key, beforePresent: a !== undefined, afterPresent: b !== undefined, before: a ?? null, after: b ?? null }];
  });
}
function settingsPreserved(before, after, { change, consumedDraft, refreshedDraft, writtenDraft } = {}) {
  return settingsDifferences(before, after).every(diff => {
    const valueOnly = diff.after && (diff.before ? onlyChanges(diff.before, diff.after, ['value']) : Object.keys(diff.after).every(key => ['key', 'value'].includes(key)));
    const time = valueOnly && typeof diff.after.value === 'string' && Number.isFinite(Date.parse(diff.after.value)) && (!diff.before || typeof diff.before.value === 'string' && Date.parse(diff.after.value) >= Date.parse(diff.before.value));
    if (diff.key === 'lastPullAt' || change && diff.key === 'lastPushAt') return time;
    if (change && diff.key === `sync-version:diaries:${change.id}`) return valueOnly && diff.after.value === change.version;
    if (consumedDraft && diff.key === consumedDraft) return diff.beforePresent && !diff.afterPresent;
    // remove() refreshes only its exact persisted draft before its business tx.
    // Its opaque revision may advance; no form/base/unknown field may change.
    if (refreshedDraft && diff.key === refreshedDraft) return valueOnly && diff.before && onlyChanges(diff.before.value, diff.after.value, ['revision']) && typeof diff.before.value.revision === 'string' && diff.before.value.revision.length > 0 && typeof diff.after.value.revision === 'string' && diff.after.value.revision.length > 0;
    if (writtenDraft && diff.key === writtenDraft.key) return valueOnly && diff.after.value && typeof diff.after.value.revision === 'string' && diff.after.value.revision.length > 0 && isDeepStrictEqual(diff.after.value.value, writtenDraft.value) && Object.keys(diff.after.value).sort().join(',') === 'revision,value';
    return false;
  });
}
function ledgerConsistent(facts) {
  return Array.isArray(facts.allEvents) && isDeepStrictEqual(facts.events, facts.allEvents.filter(row => row.entity === 'diaries')) && sameRows(facts.server, rowsFromLedger(facts.allEvents));
}
function rowsFromLedger(events) {
  const rows = new Map(); let previous = 0n;
  for (const event of events) {
    assert.ok(validVersion(event.seq) && BigInt(event.seq) > previous, 'Full ledger sequence must be canonical and strictly increasing'); previous = BigInt(event.seq);
    if (event.entity !== 'diaries') continue;
    assert.ok(['upsert', 'delete'].includes(event.operation), 'Unknown Diary operation');
    if (event.operation === 'delete') { assert.equal(event.data, null, 'Canonical Diary tombstone data must be null'); rows.delete(event.entityId); }
    else { assert.equal(event.data?.id, event.entityId); rows.set(event.entityId, event.data); }
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function oneNewEvent(before, after, id, operation) {
  if (!ledgerConsistent(before) || !ledgerConsistent(after)) return false;
  const added = after.allEvents.slice(before.allEvents.length), diaryAdded = after.events.slice(before.events.length);
  return isDeepStrictEqual(before.allEvents, after.allEvents.slice(0, before.allEvents.length)) && isDeepStrictEqual(before.events, after.events.slice(0, before.events.length)) && added.length === 1 && diaryAdded.length === 1 && isDeepStrictEqual(added[0], diaryAdded[0]) && added[0].entityId === id && added[0].operation === operation && validVersion(added[0].seq) && (!before.allEvents.length || BigInt(added[0].seq) > BigInt(before.allEvents.at(-1).seq));
}
function sourcesPreserved(before, after, options = {}) {
  return ledgerConsistent(before) && ledgerConsistent(after) && sameRows(before.local.diary, after.local.diary) && sameRows(before.server, after.server) && settingsPreserved(before, after, options) && isDeepStrictEqual(before.local.outbox, after.local.outbox) && isDeepStrictEqual(before.allEvents, after.allEvents);
}
function acknowledged(facts, id, operation = 'upsert') {
  const local = facts.local.diary.find(row => row.id === id), remote = facts.server.find(row => row.id === id), last = facts.events.filter(row => row.entityId === id).at(-1);
  return facts.local.outbox.length === 0 && validVersion(version(facts, id)) && version(facts, id) === last?.seq && last?.operation === operation && !facts.local.settings.some(row => row.key === `sync-conflict:diaries:${id}`) && (operation === 'delete' ? !local && !remote : Boolean(local && remote) && KEYS.every(key => isDeepStrictEqual(local[key], remote[key])));
}
function timestampAdvanced(before, after, key, type) {
  if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) return false;
  const a = type === 'number' ? before[key] : Date.parse(before[key]), b = type === 'number' ? after[key] : Date.parse(after[key]);
  return typeof before[key] === type && typeof after[key] === type && Number.isFinite(a) && Number.isFinite(b) && b >= a;
}
function neighborsPreserved(before, after, id) {
  return sameRows(before.local.diary.filter(row => row.id !== id), after.local.diary.filter(row => row.id !== id)) && sameRows(before.server.filter(row => row.id !== id), after.server.filter(row => row.id !== id));
}
function createdOnlyDeclared(before, after, declared, consumedDraft = 'record-draft:diary:new') {
  const added = after.local.diary.filter(row => !before.local.diary.some(old => old.id === row.id)), remote = after.server.filter(row => !before.server.some(old => old.id === row.id));
  if (added.length !== 1 || remote.length !== 1 || added[0].id !== remote[0].id || before.events.some(row => row.entityId === added[0].id)) return false;
  const id = added[0].id, stored = draftRow(before, consumedDraft)?.value, frozen = stored?.value;
  if (!frozen || typeof stored.revision !== 'string' || !stored.revision || !FORM_KEYS.every(key => isDeepStrictEqual(frozen[key], declared[key]))) return false;
  if (consumedDraft === 'record-draft:diary:new' && (frozen.id !== id || frozen.base !== null)) return false;
  const validAudit = Number.isFinite(added[0].createdAt) && added[0].createdAt > 0 && Number.isFinite(added[0].updatedAt) && added[0].updatedAt >= added[0].createdAt && typeof remote[0].createdAt === 'string' && typeof remote[0].updatedAt === 'string' && Number.isFinite(Date.parse(remote[0].createdAt)) && Date.parse(remote[0].updatedAt) >= Date.parse(remote[0].createdAt);
  return validAudit && before.local.outbox.length === 0 && acknowledged(after, id) && KEYS.every(key => Object.hasOwn(declared, key) && isDeepStrictEqual(added[0][key], declared[key]) && isDeepStrictEqual(remote[0][key], declared[key])) && isDeepStrictEqual(added[0].quickNoteIds, []) && sameRows(before.local.diary, after.local.diary.filter(row => row.id !== id)) && sameRows(before.server, after.server.filter(row => row.id !== id)) && settingsPreserved(before, after, { change: { id, version: version(after, id) }, consumedDraft }) && oneNewEvent(before, after, id, 'upsert') && draftRow(before, consumedDraft) && !draftRow(after, consumedDraft);
}
function correctedOnlyContent(before, after, id, content) {
  const a = before.local.diary.find(row => row.id === id), b = after.local.diary.find(row => row.id === id), x = before.server.find(row => row.id === id), y = after.server.find(row => row.id === id);
  const frozen = draftRow(before, `record-draft:diary:${id}`)?.value?.value;
  return frozen?.id === id && frozen.content === content && isDeepStrictEqual(frozen.base, a) && FORM_KEYS.filter(key => key !== 'content').every(key => isDeepStrictEqual(frozen[key], a[key])) && acknowledged(before, id) && acknowledged(after, id) && BigInt(version(after, id)) > BigInt(version(before, id)) && onlyChanges(a, b, ['content', 'updatedAt']) && onlyChanges(x, y, ['content', 'updatedAt']) && timestampAdvanced(a, b, 'updatedAt', 'number') && timestampAdvanced(x, y, 'updatedAt', 'string') && b.content === content && y.content === content && neighborsPreserved(before, after, id) && settingsPreserved(before, after, { change: { id, version: version(after, id) }, consumedDraft: `record-draft:diary:${id}` }) && !draftRow(after, `record-draft:diary:${id}`) && oneNewEvent(before, after, id, 'upsert');
}
function deletedOnlyTarget(before, after, id) {
  const frozen = draftRow(before, `record-draft:diary:${id}`)?.value?.value;
  return frozen?.id === id && isDeepStrictEqual(frozen.base, before.local.diary.find(row => row.id === id)) && acknowledged(before, id) && acknowledged(after, id, 'delete') && BigInt(version(after, id)) > BigInt(version(before, id)) && neighborsPreserved(before, after, id) && settingsPreserved(before, after, { change: { id, version: version(after, id) }, refreshedDraft: `record-draft:diary:${id}` }) && draftRow(before, `record-draft:diary:${id}`) && draftRow(after, `record-draft:diary:${id}`) && oneNewEvent(before, after, id, 'delete');
}
function copiedAsNew(before, after, oldId, declared) {
  const added = after.local.diary.filter(row => !before.local.diary.some(old => old.id === row.id));
  const frozen = draftRow(before, `record-draft:diary:${oldId}`)?.value?.value, oldServer = before.events.filter(row => row.entityId === oldId && row.operation === 'upsert').at(-1)?.data, newServer = after.server.find(row => row.id === added[0]?.id);
  const freshAudit = added[0] && frozen?.base && oldServer && newServer && added[0].createdAt > frozen.base.createdAt && added[0].createdAt >= frozen.base.updatedAt && Date.parse(newServer.createdAt) > Date.parse(oldServer.createdAt) && Date.parse(newServer.createdAt) >= Date.parse(oldServer.updatedAt);
  return Boolean(freshAudit) && frozen?.id === oldId && acknowledged(before, oldId, 'delete') && acknowledged(after, oldId, 'delete') && added.length === 1 && added[0].id !== oldId && createdOnlyDeclared(before, after, declared, `record-draft:diary:${oldId}`) && isDeepStrictEqual(before.events.filter(row => row.entityId === oldId), after.events.filter(row => row.entityId === oldId));
}
function declaredRecordsMatch(facts, records) {
  return records.length === facts.local.diary.length && records.length === facts.server.length && new Set(records.map(row => row.id)).size === records.length && records.every(row => acknowledged(facts, row.id) && [facts.local.diary, facts.server].every(rows => KEYS.every(key => isDeepStrictEqual(rows.find(item => item.id === row.id)?.[key], row[key]))));
}
function bodyReadingComplete(opened, observed) {
  const expected = Array.from(opened.text).filter(char => !/\s/.test(char)).length;
  if (Number(opened.lineClamp) > 0 && opened.scrollHeight > opened.clientHeight) return false;
  if (!expected || opened.glyphs.length !== expected || opened.glyphs.some(glyph => glyph.rectCount === 0)) return false;
  const ids = new Set(opened.glyphs.map(glyph => glyph.id));
  if (ids.size !== expected || observed.length !== opened.lines.length || !observed.every(row => row.line.visible)) return false;
  const readIds = new Set(observed.flatMap(row => row.line.glyphIds));
  return readIds.size === ids.size && [...ids].every(id => readIds.has(id));
}
function backupFeedbackReadable(backup, expected, feedback, fallbackReading = null) {
  if (backup.fallbackValue !== null) return backup.fallbackValue === expected && feedback.visible && feedback.text.includes('完整输入备份') && fallbackReading?.visible === true;
  return backup.copyReported === true && feedback.visible && feedback.text === '已复制，关闭';
}
export const diaryOutcomeChecks = { backupFeedbackReadable, bodyReadingComplete, profiles: PROFILES, validVersion, version, sameRows, onlyChanges, settingsDifferences, settingsPreserved, rowsFromLedger, sourcesPreserved, acknowledged, createdOnlyDeclared, correctedOnlyContent, deletedOnlyTarget, copiedAsNew, declaredRecordsMatch };

export function readDiarySource(owner) {
  return new Promise((resolve, reject) => {
      const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected account DB does not exist')); }; request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, names = ['diary', 'settings', 'outbox'], tx = db.transaction(names, 'readonly'), result = {};
        for (const name of names) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { result[name] = read.result; }; }
        tx.oncomplete = () => {
          db.close();
          try { resolve(JSON.stringify(result, function(key, value) {
            const original = this[key];
            if (original && typeof original === 'object' && !Array.isArray(original) && !(original instanceof Date) && !(original instanceof Map) && !(original instanceof Set) && Object.getPrototypeOf(original) !== Object.prototype) throw new Error('Unsupported original Diary snapshot object; custom toJSON must not hide its type');
            if (original && Object.getPrototypeOf(original) === Object.prototype && Object.hasOwn(original, '__diaryEvidenceType')) throw new Error('Reserved evidence marker in source; stop instead of creating a tagged-value collision');
            if (value === undefined) return { __diaryEvidenceType: 'undefined' };
            if (typeof value === 'bigint') return { __diaryEvidenceType: 'bigint', value: String(value) };
            if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) return { __diaryEvidenceType: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
            if (original instanceof Date) return { __diaryEvidenceType: 'date', value: original.toISOString() };
            if (value instanceof Map) return { __diaryEvidenceType: 'Map', entries: [...value] };
            if (value instanceof Set) return { __diaryEvidenceType: 'Set', values: [...value] };
            if (value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported Diary snapshot value; do not claim lossless retention');
            if (Array.isArray(value) && (Object.keys(value).length !== value.length || !Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean))) throw new Error('Sparse or extended array in Diary snapshot; stop instead of losing present keys');
            return value;
          })); } catch (error) { reject(error); }
        };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Readonly Diary source aborted')); };
      };

  });
}

export function installDiaryQuota({ owner, id, method }) {
      if (globalThis.__diaryFault && !globalThis.__diaryFault.restored) throw new Error('Prior Diary fault remains installed');
      const original = IDBObjectStore.prototype[method], transactions = new WeakSet(); let timer;
      const state = globalThis.__diaryFault = { owner, id, table: 'diary', method, kind: `exact-precommit-${method}-quota`, hits: [], aborts: 0, commits: 0, expired: false, restored: false, restoredBy: null };
      globalThis.__restoreDiaryFault = (reason = 'explicit-harness-release') => { clearTimeout(timer); IDBObjectStore.prototype[method] = original; state.restored = IDBObjectStore.prototype[method] === original; state.restoredBy ??= reason; state.restoredAt ??= performance.now(); };
      timer = setTimeout(() => { state.expired = true; globalThis.__restoreDiaryFault('safety-timeout'); }, 30000);
      IDBObjectStore.prototype[method] = function(value, suppliedKey) {
        const key = method === 'delete' ? value : value?.id;
        if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'diary' && this.transaction.mode === 'readwrite' && key === id) {
          if (!transactions.has(this.transaction)) { transactions.add(this.transaction); this.transaction.addEventListener('abort', () => { state.aborts++; }, { once: true }); this.transaction.addEventListener('complete', () => { state.commits++; }, { once: true }); }
          state.hits.push({ atMonotonicMs: performance.now(), browserDate: new Date().toISOString(), database: this.transaction.db.name, table: this.name, method, key, intendedValue: value, originalCalled: false });
          throw new DOMException(`Synthetic exact Diary precommit ${method} quota`, 'QuotaExceededError');
        }
        return suppliedKey === undefined ? original.call(this, value) : original.call(this, value, suppliedKey);
      };

}

export async function runDiaryOutcomes(h, { scenarioSet } = {}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native Diary evidence runs only in authorized hosted CI');
  assert.ok(['records', 'recovery'].includes(scenarioSet));
  const { isolated, login, waitPath, capture, observe, apiFor, sleep, actions, artifacts, writeFile, join, surfaceNames } = h;
  const prefix = scenarioSet === 'records' ? 'YD-records' : 'YD-recovery';
  await writeFile(join(artifacts, `${prefix}-scope.json`), JSON.stringify({ applicationBaseline: BASELINE, kind: 'ordinary-diary-native-red-baseline', scenarioSet, profiles: PROFILES.filter(row => row.scenarioSet === scenarioSet), syntheticOnly: true, dailyOneSemantics: true, genuineUndo: 'Unsupported: deletion is not reversed; copy creates a new ID and preserves old tombstone', clock: 'Browser Date only, advancing from 2026-10-07 12:00 Asia/Shanghai; Node/server audit timestamps remain real', boundaries: ['No local browser/listener startup', 'No implementation, production, deploy, provider, business HTTP writes or hidden route', 'No list irreversible delete confirmation; only ordinary editor deletion on disposable synthetic source after full draft/backup UI is verified', 'No preference authority, clear epoch, publication audit or dependent postcommit read repair', 'No multi-entry support, two-device merge, export, arbitrary scale or complete accessibility claim'] }, null, 2));
  async function read(page, selector) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const box = await page.evaluate(initialSessionGeometry, selector); assert.equal(box.unique, true, `Expected one actual region: ${selector}`); if (box.visible) return box;
      const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20)), deltaY = box.rect.y + box.rect.height / 2 - y;
      if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-read-diary', surface: surfaceNames.get(page), selector, pointer: { x, y }, deltaY, clip: box.clip, scroller: box.scroller }); }
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
    finally { actions.push({ kind: 'diary-preclick-geometry', surface: surfaceNames.get(page), selector, resolved, probes }); }
    await page.mouse.click(point.x, point.y);
    actions.push({ kind: 'native-diary-pointer', surface: surfaceNames.get(page), selector, resolved, text, ...point, clip: reading.clip, path: new URL(page.url()).pathname });
  }
  async function input(page, selector, text) {
    await tap(page, selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(text);
    assert.equal(await page.$eval(selector, el => el.value), text); actions.push({ kind: 'native-diary-typed-input', surface: surfaceNames.get(page), selector, text });
  }
  async function localSource(page, owner) { return JSON.parse(await page.evaluate(readDiarySource, owner)); }
  async function ledger(api) {
    const events = []; let cursor = '0';
    for (let i = 0; i < 20; i++) { const result = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`); assert.ok(Array.isArray(result.events)); events.push(...result.events); if (!result.hasMore) return events; assert.notEqual(result.nextCursor, cursor); cursor = result.nextCursor; }
    throw new Error('Read-only audit ledger exceeded 20 bounded pages');
  }
  async function facts(page, api, label, { settle = true, extra = {} } = {}) {
    let local = await localSource(page, api.ownerId);
    if (settle) for (let i = 0; i < 60 && local.outbox.length; i++) { await sleep(250); local = await localSource(page, api.ownerId); }
    const allEvents = await ledger(api), events = allEvents.filter(event => event.entity === 'diaries'), server = (await api('/diary')).diaries;
    const result = { local, server, events, allEvents };
    await writeFile(join(artifacts, `${label}-full-source.json`), JSON.stringify({ syntheticOnly: true, observedByDriverAt: new Date().toISOString(), browserClock: await page.evaluate(() => ({ instant: new Date().toISOString(), config: globalThis.__youtraceAuditClock })), ...result, serverTimestampMeaning: 'Original canonical server createdAt/updatedAt/version are preserved separately; browser business dates and any local timestamp are synthetic and are never rewritten to match them', ...extra }, null, 2));
    assert.ok(Array.isArray(server)); assert.ok(server.length < 50, 'Disposable Diary fixture must stay bounded');
    assert.ok(sameRows(server, rowsFromLedger(allEvents)), 'GET rows and complete canonical Diary ledger must agree without dropping fields');
    return result;
  }
  async function date(page, value) {
    await tap(page, DATE); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    const [year, month, day] = value.split('-'); await page.keyboard.type(month + day + year); await page.keyboard.press('Tab');
    assert.equal(await page.$eval(DATE, el => el.value), value, 'Native segmented date must match the declared real date');
    actions.push({ kind: 'native-diary-date', surface: surfaceNames.get(page), value });
  }
  async function ready(page) {
    await page.waitForFunction(() => { const modal = document.querySelector('[role=dialog]'); return modal?.querySelector('#diary-content') && !modal.querySelector('fieldset').disabled && !/正在读取本机草稿|正在保留草稿|本机草稿尚未保留/.test(modal.innerText); }, { timeout: 7000 });
  }
  async function editor(page) {
    return page.$eval('[role=dialog]', el => {
      const selected = el.querySelector('[role=group][aria-labelledby="diary-mood-label"] button[aria-pressed=true]');
      const label = selected?.getAttribute('aria-label') ?? selected?.textContent.trim();
      if (!['未记录心情', '不错'].includes(label)) throw new Error('Fixture selected an unexpected actual mood');
      const moodText = [...el.querySelectorAll('p')].find(row => row.textContent.startsWith('已选：'))?.textContent ?? '';
      return { date: el.querySelector('input[aria-label="日记日期"]').value, content: el.querySelector('#diary-content').value, mood: label === '不错' ? 'good' : null, moodScore: label === '不错' && moodText.includes('7/10') ? 7 : null };
    });
  }
  async function fill(page, values) {
    await date(page, values.date); await input(page, '#diary-content', values.content);
    if (values.mood === null) await tap(page, '[role=group][aria-labelledby="diary-mood-label"] button', '未记录心情');
    else { assert.equal(values.mood, 'good'); assert.equal(values.moodScore, 7); await tap(page, '[role=group] button[aria-label="不错"]'); }
    await ready(page); assert.deepEqual(await editor(page), Object.fromEntries(FORM_KEYS.map(key => [key, values[key]])));
  }
  async function navigate(page, path, label) {
    if (page.viewport().width === 360) {
      await tap(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more');
      await tap(page, `nav[aria-label="全部功能"] a[href="${path}"]`);
    } else await tap(page, 'aside nav button', label);
    await waitPath(page, path);
  }
  async function cancel(page) { await tap(page, '[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 7000 }); }
  async function save(page, label = '保存') { await ready(page); await tap(page, '[role=dialog] button', label); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 7000 }); }
  function assertDraft(facts, key, typed, source = null) {
    const stored = draftRow(facts, key);
    assert.ok(stored && typeof stored.value?.revision === 'string' && stored.value.revision.length > 0, 'Full input must already be durably saved as an ordinary draft');
    const form = stored.value.value; assert.equal(typeof form.id, 'string'); assert.ok(form.id.length > 0);
    for (const field of FORM_KEYS) assert.deepEqual(form[field], typed[field]);
    assert.deepEqual(form.base, source, 'Draft preserves full original source including unknown present fields');
    if (source) assert.equal(form.id, source.id);
    return form;
  }
  async function requirePreserved(page, before, after, label, options = {}) {
    const pass = sourcesPreserved(before, after, options);
    await observe(page, label, pass, JSON.stringify({ settingsDifferences: settingsDifferences(before, after), options, note: 'All present local/remote rows and fields, versions, full all-entity ledger, conflicts and queue must remain unchanged; only named exact settings differences are eligible' }));
    assert.ok(pass, 'Source/draft preservation prerequisite failed; stop this profile');
  }
  async function create(page, api, label, declared) {
    const before = await facts(page, api, `${label}-before-input`); assert.equal(before.local.outbox.length, 0);
    await tap(page, 'button[aria-label="写日记"]'); await ready(page); await fill(page, declared);
    const typed = await editor(page), prepared = await facts(page, api, `${label}-prepared`, { extra: { declared, typed } }), form = assertDraft(prepared, 'record-draft:diary:new', typed);
    await requirePreserved(page, before, prepared, `${label}-input-only-draft`, { writtenDraft: { key: 'record-draft:diary:new', value: form } });
    await capture(page, `${label}-frozen-declared-input`); await save(page);
    const after = await facts(page, api, `${label}-created`), pass = createdOnlyDeclared(prepared, after, declared), row = after.local.diary.find(item => item.id === form.id);
    await observe(page, `${label}-exact-native-create-and-cloud-ack`, Boolean(pass && row), JSON.stringify({ declared, draftForm: form, boundId: form.id, settingsDifferences: settingsDifferences(prepared, after), source: `${label}-created-full-source.json` })); assert.ok(pass && row);
    return { ...declared, id: row.id };
  }
  async function visibleCard(page, wanted) {
    // Locate by actual date/content/mood first. The ID is checked afterwards.
    const candidates = await page.evaluate(wanted => [...document.querySelectorAll('main button[aria-label^="编辑"]')].filter(button => button.getAttribute('aria-label').endsWith('的日记')).map(button => {
      const card = button.parentElement.parentElement.parentElement, text = card.innerText, paragraph = [...card.children].find(el => el.tagName === 'P');
      const parts = []; for (let el = card; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(row => row.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
      return { selector: 'body > ' + parts.join(' > '), text, content: paragraph?.textContent, matches: text.includes(wanted.date) && paragraph?.textContent === wanted.content && text.includes(wanted.mood === null ? '未记录心情' : '不错') && (wanted.mood === null || text.includes('7/10')) };
    }), wanted);
    const matches = candidates.filter(row => row.matches); assert.equal(matches.length, 1, `One visible date/content/mood identity required: ${JSON.stringify({ wanted, candidates })}`);
    const card = matches[0], header = await read(page, `${card.selector} > div:first-child`), paragraph = `${card.selector} > p:first-of-type`;
    assert.ok(header.visible && header.text.includes(wanted.date), 'Absolute date and chosen mood must actually be readable before selecting');
    const first = await textLines(page, paragraph), visibleFirst = first.lines[0];
    assert.ok(visibleFirst && !visibleFirst.ownClipped, 'First actual content line must exist');
    assert.ok((await readLine(page, paragraph, 0)).line.visible, 'First content line must actually be readable before ID corroboration'); const identity = await page.$eval(card.selector, el => el.parentElement.id);
    assert.equal(identity, `diary-record-${wanted.id}`, 'Hidden ID only corroborates the visibly selected record');
    return { ...card, paragraph, header };
  }
  async function open(page, wanted, retained = null) {
    const card = await visibleCard(page, wanted); await capture(page, `${surfaceNames.get(page)}-dated-diary-selection`);
    await tap(page, `${card.selector} button[aria-label^="编辑"]`); await ready(page);
    assert.deepEqual(await editor(page), retained ?? Object.fromEntries(FORM_KEYS.map(key => [key, wanted[key]])));
    return card;
  }
  async function textLines(page, selector) {
    const geometry = await page.evaluate(initialSessionGeometry, selector);
    return page.evaluate(({ selector, geometry }) => {
      const el = document.querySelector(selector), own = el.getBoundingClientRect(), style = getComputedStyle(el), groups = [], glyphs = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node, nodeIndex = 0;
      while ((node = walker.nextNode())) {
        let index = 0;
        for (const char of node.textContent) {
          const start = index; index += char.length;
          if (/\s/.test(char)) continue;
          const range = document.createRange(); range.setStart(node, start); range.setEnd(node, index);
          const boxes = [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0), id = `${nodeIndex}:${start}`;
          glyphs.push({ id, char, rectCount: boxes.length });
          for (const box of boxes) {
            let line = groups.find(row => Math.abs(row.top - box.top) < 0.5 && Math.abs(row.bottom - box.bottom) < 0.5);
            if (!line) { line = { top: box.top, bottom: box.bottom, left: box.left, right: box.right, text: '', glyphIds: [] }; groups.push(line); }
            line.left = Math.min(line.left, box.left); line.right = Math.max(line.right, box.right); line.text += char; line.glyphIds.push(id);
          }
        }
        nodeIndex++;
      }
      const ownClips = /(auto|scroll|hidden|clip)/.test(style.overflowY) || style.webkitLineClamp !== 'none' && Number(style.webkitLineClamp) > 0;
      const lines = groups.map(line => {
        const ownClipped = ownClips && (line.top < own.top || line.bottom > own.bottom || line.left < own.left || line.right > own.right);
        const centerHit = el.contains(document.elementFromPoint((line.left + line.right) / 2, (line.top + line.bottom) / 2));
        return { ...line, ownClipped, centerHit, visible: geometry.painted && !ownClipped && centerHit && line.top >= geometry.clip.top && line.bottom <= geometry.clip.bottom && line.left >= geometry.clip.left && line.right <= geometry.clip.right };
      });
      return { text: el.textContent, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, lineClamp: style.webkitLineClamp, own: own.toJSON(), clip: geometry.clip, scroller: geometry.scroller, glyphs, lines };
    }, { selector, geometry });
  }
  async function readLine(page, selector, index) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const all = await textLines(page, selector), line = all.lines[index]; assert.ok(line, 'Declared text line disappeared');
      if (line.visible || line.ownClipped) return { ...all, index, line };
      const x = Math.max(all.clip.left + 8, Math.min((line.left + line.right) / 2, all.clip.right - 8));
      const y = Math.max(20, Math.min((all.clip.top + all.clip.bottom) / 2, page.viewport().height - 20)), deltaY = (line.top + line.bottom) / 2 - y;
      await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-diary-reading-wheel', surface: surfaceNames.get(page), selector, index, x, y, deltaY }); await sleep(120);
    }
    const all = await textLines(page, selector); return { ...all, index, line: all.lines[index] };
  }
  async function readFullContent(page, card, wanted, label) {
    const initial = await textLines(page, card.paragraph); assert.equal(initial.text, wanted.content);
    await capture(page, `${label}-before-reading-state`);
    const hasExpand = await page.$$eval(`${card.selector} button`, nodes => nodes.some(el => el.textContent.trim() === '展开'));
    if (hasExpand) await tap(page, `${card.selector} button`, '展开');
    const opened = await textLines(page, card.paragraph), observed = []; assert.equal(opened.text, wanted.content);
    for (let index = 0; index < opened.lines.length; index++) {
      const reading = await readLine(page, card.paragraph, index); assert.equal(reading.text, wanted.content); observed.push({ index, line: reading.line, clip: reading.clip });
      if (reading.line.ownClipped) break;
      if (index === 0 || index === opened.lines.length - 1) await capture(page, `${label}-read-line-${index + 1}`);
    }
    const pass = bodyReadingComplete(opened, observed);
    await writeFile(join(artifacts, `${label}-reading.json`), JSON.stringify({ initial, hasExpand, opened, observed, pass, expectedFullContent: wanted.content, note: 'Range glyph-line bounds and actual clipping/hit tests; innerText alone and horizontal geometry do not prove full reading. Native wheel samples each wrapped line without requiring one tall paragraph to fit the viewport.' }, null, 2));
    await observe(page, `${label}-every-line-and-final-sentence-readable`, pass, JSON.stringify({ hasExpand, lineCount: opened.lines.length, readCount: observed.filter(row => row.line.visible).length, scrollHeight: opened.scrollHeight, clientHeight: opened.clientHeight, source: `${label}-reading.json` }));
    return pass;
  }
  async function correct(page, api, target, label, { quota = false } = {}) {
    const originalSource = await facts(page, api, `${label}-before-editor-input`);
    await open(page, target); await input(page, '#diary-content', CORRECTION); await ready(page);
    const typed = await editor(page), before = await facts(page, api, `${label}-frozen-input`), original = before.local.diary.find(row => row.id === target.id);
    const prepared = assertDraft(before, `record-draft:diary:${target.id}`, typed, original); assert.ok(acknowledged(before, target.id));
    await requirePreserved(page, originalSource, before, `${label}-opening-and-input-preserve-original-source`, { writtenDraft: { key: `record-draft:diary:${target.id}`, value: prepared } });
    if (quota) {
      await installQuota(page, api.ownerId, target.id, 'put');
      await withFaultRelease(page, `${label}-put`, async () => { await tap(page, '[role=dialog] button', '保存'); return refusal(page, api, before, typed, `${label}-put`, 'put', target.id); });
    } else {
      await cancel(page); const closed = await facts(page, api, `${label}-cancelled`); await requirePreserved(page, before, closed, `${label}-cancel-keeps-source-and-exact-draft`);
      await open(page, target, typed); const reopened = await facts(page, api, `${label}-reopened`); await requirePreserved(page, before, reopened, `${label}-reopen-keeps-every-field`);
    }
    assert.deepEqual(await editor(page), typed); await capture(page, `${label}-retained-input-before-save`); await save(page);
    const after = await facts(page, api, `${label}-saved`), pass = correctedOnlyContent(before, after, target.id, CORRECTION);
    await observe(page, `${label}-same-id-content-only-correction`, pass, JSON.stringify({ id: target.id, typed, settingsDifferences: settingsDifferences(before, after), beforeVersion: version(before, target.id), afterVersion: version(after, target.id), source: `${label}-saved-full-source.json` })); assert.ok(pass);
    return { ...target, content: CORRECTION };
  }
  async function sameDay(page, api, target, profile, label) {
    const source = await facts(page, api, `${label}-before-second-draft`);
    await tap(page, 'button[aria-label="写日记"]'); await ready(page); await fill(page, { date: target.date, content: SECOND, mood: profile.mood, moodScore: profile.moodScore });
    const typed = await editor(page), before = await facts(page, api, `${label}-conflicting-draft`), form = assertDraft(before, 'record-draft:diary:new', typed);
    await requirePreserved(page, source, before, `${label}-only-new-draft-written`, { writtenDraft: { key: 'record-draft:diary:new', value: form } });
    const section = 'section[aria-label="同日日记对照"]', text = await page.$eval(section, el => el.innerText), disabled = await page.$$eval('[role=dialog] button', nodes => nodes.find(el => el.textContent.trim() === '保存')?.disabled === true);
    const instruction = await exact(page, `${section} > p`, `${target.date} 已有日记，本次不会覆盖`), reading = await read(page, instruction), guidance = await read(page, `${section} > p:nth-of-type(2)`);
    await observe(page, `${label}-daily-one-refusal-is-explicit`, disabled && reading.visible && guidance.visible && text.includes('本次不会覆盖') && text.includes('当前输入会保留为本机草稿') && text.includes('不要为绕过冲突填写不真实的日期'), JSON.stringify({ disabled, reading, guidance, text }));
    assert.ok(disabled, 'Same-day second save must be refused without a second row or overwrite');
    await tap(page, `${section} button`, '保留当前稿，打开这篇日记');
    await page.waitForFunction(({ id, content }) => new URL(location.href).searchParams.get('record') === id && document.querySelector('#diary-content')?.value === content, { timeout: 7000 }, target); await ready(page);
    assert.deepEqual(await editor(page), Object.fromEntries(FORM_KEYS.map(key => [key, target[key]])));
    assert.equal(new URL(page.url()).searchParams.get('record'), target.id, 'Actual rendered existing-record control must open that original ID');
    const original = await facts(page, api, `${label}-original-opened`); await requirePreserved(page, before, original, `${label}-original-access-keeps-full-second-draft`);
    await capture(page, `${label}-actual-original-editor`); await cancel(page);
    const card = await visibleCard(page, target); await readFullContent(page, card, target, `${label}-read-existing-original`);
    await tap(page, 'button[aria-label="写日记"]'); await ready(page); assert.deepEqual(await editor(page), typed);
    const returned = await facts(page, api, `${label}-returned-to-second-draft`); await requirePreserved(page, before, returned, `${label}-return-exact-new-draft-without-retyping`);
    await capture(page, `${label}-second-draft-restored`); await cancel(page);
    await requirePreserved(page, before, await facts(page, api, `${label}-final-cancelled`), `${label}-final-cancel-preserves-original-and-second-draft`);
  }
  async function timeline(page, api, target, label) {
    const before = await facts(page, api, `${label}-before-timeline`);
    await navigate(page, '/timeline', '时间线'); await tap(page, '[role=group][aria-label="时间范围"] button', '全部记录');
    await page.waitForFunction(() => {
      const url = new URL(location.href), selected = [...document.querySelectorAll('[role=group][aria-label="时间范围"] button[aria-pressed=true]')];
      return url.pathname === '/timeline' && url.searchParams.get('range') === 'all' && selected.length === 1 && selected[0].textContent.trim() === '全部记录';
    }, { timeout: 7000 });
    const origin = new URL(page.url()).pathname + new URL(page.url()).search;
    actions.push({ kind: 'diary-timeline-all-range-observed', surface: surfaceNames.get(page), path: origin, selected: '全部记录', note: 'Read after the original single range click commits its actual URL and selected state; no second click or route assignment.' });
    const selector = await page.evaluate(({ date, title }) => {
      const matches = [...document.querySelectorAll('section[aria-label] button')].filter(el => el.closest('section').getAttribute('aria-label') === date && el.getAttribute('aria-label') === `日记: ${title}`);
      if (matches.length !== 1) throw new Error(`Expected exactly one real dated Diary preview, got ${matches.length}`);
      const parts = []; for (let el = matches[0]; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(row => row.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
      return 'body > ' + parts.join(' > ');
    }, { date: target.date, title: target.content.slice(0, 80) });
    const row = await read(page, selector), dateHeading = await read(page, `section[aria-label="${target.date}"] > h2`), expectedFirstSentence = target.content.split('\n')[0];
    const preview = await readLine(page, `${selector} p:first-child`, 0);
    await observe(page, `${label}-timeline-current-first-line-and-real-date`, row.visible && dateHeading.visible && preview.line.visible && preview.line.text.includes(expectedFirstSentence.replace(/\s/g, '')) && dateHeading.text.includes(target.date), JSON.stringify({ row, dateHeading, preview, expectedFirstSentence, origin, note: 'Only the visible distinctive current first sentence identifies this preview; complete body reading is separately measured on Diary.' }));
    assert.ok(row.visible && dateHeading.visible && preview.line.visible, 'Timeline entry must actually be accessible before the real record link');
    await capture(page, `${label}-timeline-current-record`); await tap(page, selector); await waitPath(page, '/diary'); await ready(page);
    assert.equal(new URL(page.url()).searchParams.get('record'), target.id); assert.deepEqual(await editor(page), Object.fromEntries(FORM_KEYS.map(key => [key, target[key]])));
    await capture(page, `${label}-timeline-linked-current-editor`); await cancel(page);
    await tap(page, 'main button', '← 返回时间线'); await waitPath(page, '/timeline');
    const afterPath = new URL(page.url()).pathname + new URL(page.url()).search, selected = await page.$$eval('[role=group][aria-label="时间范围"] button', nodes => nodes.find(el => el.getAttribute('aria-pressed') === 'true')?.textContent.trim());
    assert.equal(afterPath, origin); assert.equal(selected, '全部记录');
    const returned = await read(page, selector); await observe(page, `${label}-native-return-keeps-range-and-current-record`, returned.visible && returned.text.replace(/\s+/g, ' ').includes(expectedFirstSentence), JSON.stringify({ origin, afterPath, selected, returned }));
    const after = await facts(page, api, `${label}-returned`); await requirePreserved(page, before, after, `${label}-navigation-preserves-all-source-and-ledger`);
  }
  async function installQuota(page, owner, id, method) {
    assert.ok(['put', 'delete'].includes(method));
    await page.evaluate(installDiaryQuota, { owner, id, method });
    actions.push({ kind: 'declared-exact-precommit-diary-quota', surface: surfaceNames.get(page), owner, id, table: 'diary', method, safetyDeadlineMs: 30000 });
  }
  async function releaseQuota(page, label) {
    const fault = await page.evaluate(() => { globalThis.__restoreDiaryFault?.(); return globalThis.__diaryFault ?? null; });
    await writeFile(join(artifacts, `${label}-fault.json`), JSON.stringify(fault, null, 2));
    if (fault) assert.ok(fault.restored && !fault.expired && fault.restoredBy === 'explicit-harness-release', 'Safety timeout or incomplete restoration invalidates the experiment');
    actions.push({ kind: 'explicit-diary-fault-release', surface: surfaceNames.get(page), method: fault?.method, restoredBy: fault?.restoredBy }); return fault;
  }
  async function withFaultRelease(page, label, operation) {
    let first;
    try { return await operation(); } catch (error) { first = error; throw error; }
    finally { try { await releaseQuota(page, label); } catch (cleanup) { if (!first) throw cleanup; actions.push({ kind: 'diary-fault-cleanup-additional-failure', surface: surfaceNames.get(page), firstFailure: first.message, cleanupFailure: cleanup.message }); } }
  }
  async function refusal(page, api, before, typed, label, method, id) {
    await page.waitForSelector('[role=dialog] [role=alert]', { timeout: 7000 });
    await page.waitForFunction(() => globalThis.__diaryFault.aborts || globalThis.__diaryFault.commits, { timeout: 4000 });
    await ready(page);
    const fault = await page.evaluate(() => globalThis.__diaryFault), after = await facts(page, api, `${label}-refused`, { settle: false, extra: { fault, retainedInput: await editor(page) } });
    assert.equal(fault.method, method); assert.equal(fault.id, id);
    const precise = fault.hits.length === 1 && fault.aborts === 1 && fault.commits === 0 && !fault.expired && fault.hits[0].originalCalled === false;
    const options = method === 'delete' ? { refreshedDraft: `record-draft:diary:${id}` } : {};
    const preserved = sourcesPreserved(before, after, options), retained = isDeepStrictEqual(await editor(page), typed);
    await observe(page, `${label}-precommit-refusal-keeps-source-and-full-draft`, precise && preserved && retained, JSON.stringify({ precise, preserved, retained, fault, settingsDifferences: settingsDifferences(before, after), source: `${label}-refused-full-source.json` })); assert.ok(precise && preserved && retained);
    assertDraft(after, `record-draft:diary:${id}`, typed, before.local.diary.find(row => row.id === id));
    const reading = await read(page, '[role=dialog] [role=alert]'), text = reading.text;
    await observe(page, `${label}-reader-understands-storage-cause-and-next-step`, reading.visible && /存储.{0,12}(?:不足|已满)|空间不足|配额不足/.test(text) && /未保存|未能保存|保存失败|未完成|输入.{0,8}保留/.test(text) && /重试|再试/.test(text) && !/QuotaExceededError|Synthetic/.test(text), JSON.stringify({ reading, note: 'Mechanical retry and self-service error understanding are separate outcomes. Raw synthetic/quota text is not an understandable recovery instruction.' }));
    await capture(page, `${label}-actual-refusal`); return after;
  }
  async function inspectShortEditor(page, target, label) {
    await open(page, target); const geometry = await read(page, '#diary-content');
    const field = await page.$eval('#diary-content', el => ({ value: el.value, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, scrollTop: el.scrollTop }));
    await observe(page, `${label}-short-original-still-readable-in-editor`, geometry.visible && field.value === target.content && field.scrollHeight <= field.clientHeight && field.scrollWidth <= field.clientWidth && field.scrollTop === 0, JSON.stringify({ geometry, field, note: 'A list-only clamp defect does not imply lost data or that every reading route is unavailable. This short four-line value fits the actual visible textarea without internal clipping.' }));
    await capture(page, `${label}-short-editor-reading`); await cancel(page);
  }
  async function deleteCopy(page, api, target, label) {
    const first = await facts(page, api, `${label}-before-list-delete-cancel`), card = await visibleCard(page, target);
    await tap(page, `${card.selector} button[aria-label^="删除"]`); await page.waitForSelector('[role=dialog]');
    const warning = await read(page, '[role=dialog] p');
    await observe(page, `${label}-list-deletion-is-explicitly-irreversible`, warning.visible && warning.text.includes(target.date) && warning.text.includes('不可撤销'), JSON.stringify(warning));
    await tap(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 7000 });
    await requirePreserved(page, first, await facts(page, api, `${label}-list-delete-cancelled`), `${label}-list-delete-cancel-keeps-source`);
    await open(page, target);
    // Native re-entry of the already-read content creates a durable exact draft;
    // no hidden store/API seeding. This makes the recoverable source explicit.
    await input(page, '#diary-content', target.content); await ready(page);
    const typed = await editor(page), before = await facts(page, api, `${label}-durable-editor-draft`), original = before.local.diary.find(row => row.id === target.id);
    const prepared = assertDraft(before, `record-draft:diary:${target.id}`, typed, original);
    await requirePreserved(page, first, before, `${label}-editor-preparation-preserves-original-source`, { writtenDraft: { key: `record-draft:diary:${target.id}`, value: prepared } });
    await tap(page, '[role=dialog] button', '删除');
    const confirm = 'section[aria-label="确认删除日记"]', explanation = await read(page, `${confirm} > p`);
    assert.ok(explanation.visible && explanation.text.includes('当前编辑稿会保留') && explanation.text.includes('不能撤销为原记录'));
    await installQuota(page, api.ownerId, target.id, 'delete'); let refused;
    refused = await withFaultRelease(page, `${label}-delete`, async () => { await tap(page, `${confirm} button`, '确认删除'); return refusal(page, api, before, typed, `${label}-delete`, 'delete', target.id); });
    // This is the actual editor's existing backup control, reached through the
    // preserved refusal. Do not bypass it by constructing a hidden recovery URL.
    await tap(page, '[role=dialog] button', '复制完整输入');
    await page.waitForFunction(() => Boolean(document.querySelector('#diary-copy')) || [...document.querySelectorAll('[role=dialog] button')].some(el => el.textContent.trim() === '已复制，关闭'), { timeout: 7000 });
    const backup = await page.evaluate(() => ({ fallbackValue: document.querySelector('#diary-copy')?.value ?? null, copyReported: [...document.querySelectorAll('[role=dialog] button')].some(el => el.textContent.trim() === '已复制，关闭') }));
    const expectedBackup = `${typed.date}\n${typed.mood === null ? '未记录心情' : '不错 · 7/10'}\n\n${typed.content}`;
    const feedback = await read(page, backup.fallbackValue !== null ? 'label[for="diary-copy"]' : await exact(page, '[role=dialog] button', '已复制，关闭'));
    const fallbackReading = backup.fallbackValue !== null ? await read(page, '#diary-copy') : null;
    const readableBackup = backupFeedbackReadable(backup, expectedBackup, feedback, fallbackReading);
    await observe(page, `${label}-actual-editor-backup-route`, readableBackup, JSON.stringify({ backup, expectedBackup, feedback, fallbackReading, limitation: 'Clipboard success is an actually visible UI acknowledgement; OS clipboard paste/read is not independently verified. Any present fallback textarea must match the full expected bytes, and its labelled control must be visibly reachable; this does not claim that all long textarea text was read at once.' }));
    assert.ok(readableBackup, 'Backup feedback must actually be readable; any fallback must retain exact bytes');
    await capture(page, `${label}-actual-backup-ui`);
    assert.deepEqual(await editor(page), typed); await requirePreserved(page, refused, await facts(page, api, `${label}-after-backup-ui`), `${label}-backup-ui-keeps-source-and-draft`);
    await tap(page, `${confirm} button`, '确认删除');
    await page.waitForFunction(() => document.querySelector('[role=dialog] h3')?.textContent === '已删除日记的编辑稿', { timeout: 7000 }); await ready(page);
    const deleted = await facts(page, api, `${label}-deleted`), pass = deletedOnlyTarget(refused, deleted, target.id);
    await observe(page, `${label}-real-delete-keeps-draft-and-old-id-tombstone`, pass, JSON.stringify({ oldId: target.id, retained: await editor(page), settingsDifferences: settingsDifferences(refused, deleted), source: `${label}-deleted-full-source.json` })); assert.ok(pass);
    assert.deepEqual(await editor(page), typed); assertDraft(deleted, `record-draft:diary:${target.id}`, typed, original);
    const status = await read(page, '[role=dialog] p[role=status]'); await observe(page, `${label}-new-copy-is-not-original-undo`, status.visible && status.text.includes('不会恢复已删除的编号') && status.text.includes('另存为新日记'), JSON.stringify(status));
    await capture(page, `${label}-deleted-draft-before-new-copy`); await save(page, '另存为新日记');
    const after = await facts(page, api, `${label}-copied`), declared = { ...typed, source: 'manual' }, copied = copiedAsNew(deleted, after, target.id, declared), added = after.local.diary.filter(row => !deleted.local.diary.some(item => item.id === row.id));
    await observe(page, `${label}-explicit-copy-has-new-id-and-old-tombstone-intact`, copied, JSON.stringify({ oldId: target.id, newId: added[0]?.id, declared, settingsDifferences: settingsDifferences(deleted, after), source: `${label}-copied-full-source.json`, claim: 'Only current editor recovery is operated. No genuine undo, deleted-record route discoverability or tombstone resurrection claim.' })); assert.ok(copied);
    const result = { ...declared, id: added[0].id }, newCard = await visibleCard(page, result); await readFullContent(page, newCard, result, `${label}-copied-reading`);
    await requirePreserved(page, after, await facts(page, api, `${label}-after-copied-reading`), `${label}-copy-reading-preserves-committed-source`);
    return result;
  }
  async function recordsJourney(page, api, label, profile) {
    const declared = [
      { date: TODAY, content: LONG, mood: profile.mood, moodScore: profile.moodScore, source: 'manual' },
      { date: '2026-10-06', content: LONG, mood: profile.mood, moodScore: profile.moodScore, source: 'manual' },
      { date: '2026-10-05', content: SHORT, mood: profile.mood, moodScore: profile.moodScore, source: 'manual' },
    ];
    const records = []; for (const [index, values] of declared.entries()) records.push(await create(page, api, `${label}-create-${index + 1}`, values));
    const complete = await facts(page, api, `${label}-all-declared-inputs`, { extra: { records } }); assert.ok(declaredRecordsMatch(complete, records));
    await readFullContent(page, await visibleCard(page, records[0]), records[0], `${label}-long-original`);
    await readFullContent(page, await visibleCard(page, records[2]), records[2], `${label}-short-four-lines`);
    await inspectShortEditor(page, records[2], `${label}-short-four-lines`);
    await requirePreserved(page, complete, await facts(page, api, `${label}-after-original-reading`), `${label}-reading-and-editor-cancel-preserve-declared-source`);
    await sameDay(page, api, records[0], profile, `${label}-same-day-second-draft`);
    const changed = await correct(page, api, records[0], `${label}-cancel-and-correct`);
    const saved = await facts(page, api, `${label}-before-corrected-reading`);
    await readFullContent(page, await visibleCard(page, changed), changed, `${label}-corrected-full-reading`);
    await requirePreserved(page, saved, await facts(page, api, `${label}-after-corrected-reading`), `${label}-reading-preserves-corrected-source`);
    await timeline(page, api, changed, `${label}-cross-page`);
  }
  async function recoveryJourney(page, api, label, profile) {
    const values = { date: TODAY, content: SHORT, mood: profile.mood, moodScore: profile.moodScore, source: 'manual' };
    const target = await create(page, api, `${label}-target`, values), neighbor = await create(page, api, `${label}-neighbor`, { ...values, date: '2026-10-06' });
    const originals = await facts(page, api, `${label}-declared-originals`); assert.ok(declaredRecordsMatch(originals, [target, neighbor]));
    const changed = await correct(page, api, target, `${label}-ordinary-put-retry`, { quota: true });
    const copied = await deleteCopy(page, api, changed, `${label}-ordinary-delete-retry-and-copy`);
    await timeline(page, api, copied, `${label}-new-copy-cross-page`);
  }
  async function run(page) {
    const label = surfaceNames.get(page), clock = h.clock ?? createHabitAuditClock(); let api;
    await page.evaluateOnNewDocument(installAuditDate, clock); actions.push({ kind: 'explicit-browser-only-advancing-diary-Date', surface: label, ...clock, serverDateUnchanged: true });
    try {
      const profile = PROFILES.find(row => row.scenarioSet === scenarioSet && row.width === page.viewport().width); assert.ok(profile && profile.nickname.length <= 20);
      await login(page, profile.phone, profile.nickname); api = await apiFor(page);
      assert.equal(await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())), TODAY);
      await navigate(page, '/diary', '日记'); await page.waitForSelector('button[aria-label="写日记"]'); await capture(page, `${label}-first-natural-entry`);
      if (scenarioSet === 'records') await recordsJourney(page, api, label, profile); else await recoveryJourney(page, api, label, profile);
    } catch (error) {
      await capture(page, `${label}-first-failure`).catch(() => undefined);
      const fault = await page.evaluate(() => globalThis.__diaryFault ?? null).catch(() => null);
      if (api) await facts(page, api, `${label}-first-failure`, { settle: false, extra: { firstFailure: error.message, fault } }).catch(async sourceError => { await writeFile(join(artifacts, `${label}-first-failure-source-unavailable.json`), JSON.stringify({ firstFailure: error.message, sourceFailure: sourceError.message, fault }, null, 2)); });
      throw error;
    } finally {
      const active = await page.evaluate(() => Boolean(globalThis.__diaryFault && !globalThis.__diaryFault.restored)).catch(() => false);
      if (active) await releaseQuota(page, `${label}-final-cleanup`).catch(error => { actions.push({ kind: 'diary-final-cleanup-additional-failure', surface: label, error: error.message }); });
    }
  }
  async function firstEmptyDiary(page, profile) {
    const label = surfaceNames.get(page), clock = h.clock ?? createHabitAuditClock(); let api;
    await page.evaluateOnNewDocument(installAuditDate, clock);
    await page.evaluateOnNewDocument(installFirstDiaryObserver);
    const path = value => page.waitForFunction(value => location.pathname === value, { timeout: 15000 }, value);
    try {
      // Deliberately do not use login(): its onboarding/home captures and fixed
      // sleeps settle startup before a first click. All business input stays native.
      await page.goto(`${h.origin}/login`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#login-phone'); await input(page, '#login-phone', profile.phone);
      const sent = page.waitForResponse(r => r.url().endsWith('/api/auth/send-code') && r.request().method() === 'POST');
      await tap(page, 'button', '获取验证码'); const challenge = await (await sent).json(); assert.ok(challenge.devCode);
      await page.waitForSelector('#login-code'); await input(page, '#login-code', challenge.devCode); await tap(page, 'button', '验证');
      await page.waitForSelector('#login-nickname'); await input(page, '#login-nickname', profile.nickname);
      await tap(page, 'button', '开始使用'); await path('/onboarding'); await page.waitForSelector('main h1');
      for (let step = 0; step < 4; step++) {
        const heading = await page.$eval('main h1', el => el.textContent);
        await tap(page, 'button', step < 3 ? '下一步' : '开始使用');
        if (step < 3) await page.waitForFunction(old => document.querySelector('main h1')?.textContent !== old, { timeout: 7000 }, heading);
      }
      await path('/'); await page.waitForSelector('main');
      if (profile.start === 'warm') {
        // Same newly registered account and persisted account DB, new document.
        // No diary has been opened or created before this declared document reload.
        actions.push({ kind: 'declared-first-empty-warm-document-reload', surface: label });
        await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('main');
      }
      await page.waitForSelector(profile.width === 360 ? 'nav[aria-label="主导航"] button[aria-label="全部功能"]' : 'aside nav button');
      if (profile.width === 360) {
        await tap(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await path('/more');
        await page.waitForSelector('nav[aria-label="全部功能"] a[href="/diary"]');
        await tap(page, 'nav[aria-label="全部功能"] a[href="/diary"]');
      } else await tap(page, 'aside nav button', '日记');
      await path('/diary'); await page.waitForSelector('button[aria-label="写日记"]');
      await page.evaluate(() => globalThis.__firstDiaryAudit.arm());
      // No source read, apiFor, screenshot, settling, or artificial network delay
      // precedes this first native opening on each independent empty account.
      await tap(page, 'button[aria-label="写日记"]'); await ready(page);
      assert.deepEqual(await editor(page), { date: TODAY, content: '', mood: null, moodScore: null });
      await page.waitForFunction(ms => { const s = globalThis.__firstDiaryAudit.snapshot(); return s.violations.length || s.firstPaintAt !== null && s.lastSampleAt - s.firstPaintAt >= ms; }, { timeout: FIRST_OPEN_WINDOW_MS + 7000 }, FIRST_OPEN_WINDOW_MS);
      const blankTrace = await page.evaluate(() => globalThis.__firstDiaryAudit.snapshot());
      await writeFile(join(artifacts, `${label}-blank-window.json`), JSON.stringify(blankTrace, null, 2));
      assert.ok(firstOpenContinuityPass(blankTrace), 'First empty dialog must stay mounted and painted through the real initialization deadline window');
      assert.deepEqual(await editor(page), { date: TODAY, content: '', mood: null, moodScore: null });
      // Corroborate only after observing the race window, without a settle wait.
      api = await apiFor(page);
      const empty = await facts(page, api, `${label}-empty-after-window`, { settle: false });
      assert.deepEqual(empty.local.diary, []); assert.deepEqual(empty.local.outbox, []); assert.deepEqual(empty.server, []); assert.deepEqual(empty.events, []);
      assert.equal(draftRow(empty, 'record-draft:diary:new'), undefined, 'Untouched first form must have no pre-existing persisted draft');
      const values = { date: TODAY, content: SHORT, mood: 'good', moodScore: 7 };
      await fill(page, values);
      const prepared = await facts(page, api, `${label}-typed`, { settle: false }), form = assertDraft(prepared, 'record-draft:diary:new', values);
      await requirePreserved(page, empty, prepared, `${label}-typing-writes-only-new-draft`, { writtenDraft: { key: 'record-draft:diary:new', value: form } });
      const typedTrace = await page.evaluate(() => globalThis.__firstDiaryAudit.snapshot());
      assert.ok(firstOpenContinuityPass(typedTrace), 'Typing must retain the original mounted first dialog');
      await capture(page, `${label}-first-typed-dialog`);
      await page.evaluate(() => globalThis.__firstDiaryAudit.stop()); await cancel(page);
      const cancelled = await facts(page, api, `${label}-cancelled`, { settle: false });
      await requirePreserved(page, prepared, cancelled, `${label}-cancel-preserves-original-draft`);
      await tap(page, 'button[aria-label="写日记"]'); await ready(page); assert.deepEqual(await editor(page), values);
      const reopened = await facts(page, api, `${label}-reopened`, { settle: false });
      assert.deepEqual(assertDraft(reopened, 'record-draft:diary:new', values), form, 'Reopening must retain the exact original draft ID and all fields');
      await requirePreserved(page, cancelled, reopened, `${label}-reopen-preserves-original-draft`);
      await capture(page, `${label}-reopened-original-draft`); await cancel(page);
      const evidence = { profile, windowMs: FIRST_OPEN_WINDOW_MS, blankTrace, typedTrace, draftId: form.id,
        initializationAfterFirstPaint: typedTrace.initializations.filter(row => row.at >= typedTrace.firstPaintAt),
        limits: 'App ready-gates the route. The 13s first-open observation does not imply overlap with initial readiness; only recorded post-open events prove actual overlap. Historical disappearance root cause remains unresolved. Native desktop viewports, not mobile OS or original CUA call-boundary acceptance.' };
      await writeFile(join(artifacts, `${label}-first-open-evidence.json`), JSON.stringify(evidence, null, 2));
      await observe(page, `${label}-empty-first-open-cancel-original-draft-reopen`, true, JSON.stringify({ profile, draftId: form.id, observedMs: blankTrace.lastSampleAt - blankTrace.firstPaintAt, samples: blankTrace.samples, initializationAfterFirstPaint: evidence.initializationAfterFirstPaint, evidence: `${label}-first-open-evidence.json`, limits: evidence.limits }));
    } catch (error) {
      const trace = await page.evaluate(() => globalThis.__firstDiaryAudit?.snapshot() ?? null).catch(() => null);
      await writeFile(join(artifacts, `${label}-first-open-failure.json`), JSON.stringify({ error: error.message, profile, trace }, null, 2));
      await capture(page, `${label}-first-open-failure`).catch(() => undefined); throw error;
    }
  }
  const media = [];
  if (scenarioSet === 'records') await writeFile(join(artifacts, 'YD-first-empty-scope.json'), JSON.stringify({ profiles: FIRST_OPEN_PROFILES, windowMs: FIRST_OPEN_WINDOW_MS, syntheticOnly: true, beforeFirstOpen: 'Native registration/onboarding/navigation only; no source read, settle, capture or business creation', startup: 'Cold means first registered document; warm means same never-opened account after one declared reload. Each profile has an independent browser context and account.', limits: 'Ready-gated app: no assertion of overlapping initial readiness. Passive post-open initialization chronology only. Historical disappearance remains unresolved; a negative reproduction is not root-cause closure.' }, null, 2));
  if (scenarioSet === 'records') for (const profile of FIRST_OPEN_PROFILES) {
    const name = `YD-first-empty-${profile.start}-${profile.width}`; media.push(name);
    await isolated(name, { width: profile.width, height: profile.width === 360 ? 800 : 900 }, page => firstEmptyDiary(page, profile));
  }
  for (const width of [1280, 360]) { const name = `${prefix}-${width}`; media.push(name); await isolated(name, { width, height: width === 360 ? 800 : 900 }, run); }
  return { media };
}
