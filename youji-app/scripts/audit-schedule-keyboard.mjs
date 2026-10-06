// Narrow, test-only tail of the existing planning profiles. All source access is
// readonly; the single business change is made by the real editor's Save key.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { installKeyboardControlObserver, readKeyboardSurface, keyboardOutcomeChecks as keyboard } from './audit-keyboard-outcomes.mjs';
import { diaryOutcomeChecks as generic } from './audit-diary-outcomes.mjs';
import { expenseOutcomeChecks } from './audit-expense-outcomes.mjs';

const { validVersion, sameRows, onlyChanges, settingsDifferences } = generic;
const FIELDS = ['id', 'title', 'date', 'startTime', 'endTime', 'location', 'type', 'repeat', 'remind'];
const EXTRA = ['main button', 'main [role=button]'];
const draftKey = row => `record-draft:schedule:${row.id}@${row.date}`;
const version = (facts, id) => facts.local.settings.find(row => row.key === `sync-version:schedules:${id}`)?.value;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const dateLabel = date => { const [, month, day] = date.split('-').map(Number); return `${month}月${day}日`; };
const identity = row => ({ title: row.title, time: `${row.startTime}-${row.endTime}`, ariaLabel: `${row.startTime}-${row.endTime} ${row.title}` });
const sameIdentity = (row, wanted) => row && Object.entries(identity(wanted)).every(([key, value]) => row[key] === value);
const expectedForm = (source, changed = false) => ({ ...Object.fromEntries(FIELDS.map(key => [key, source[key]])), ...(changed ? { startTime: '09:15', endTime: '10:15' } : {}), scope: 'series', occurrenceDate: source.date, base: source });
const uniqueRows = (rows, key) => Array.isArray(rows) && rows.every(row => typeof row[key] === 'string') && new Set(rows.map(row => row[key])).size === rows.length;
const quiescent = facts => facts.local.outbox.length === 0 && !facts.local.settings.some(row => row.key === 'syncV2Batch' || row.key.startsWith('sync-conflict:'));

function rowsFromLedger(events) {
  const rows = new Map(); let previous = 0n;
  for (const event of events) {
    assert.ok(validVersion(event.seq) && BigInt(event.seq) > previous, 'Complete all-entity ledger must be strictly ordered'); previous = BigInt(event.seq);
    if (event.entity !== 'schedules') continue;
    assert.ok(['upsert', 'delete'].includes(event.operation));
    if (event.operation === 'delete') { assert.equal(event.data, null); rows.delete(event.entityId); }
    else { assert.equal(event.data?.id, event.entityId); rows.set(event.entityId, event.data); }
  }
  return [...rows.values()];
}
function ledgerConsistent(facts) {
  try { return Array.isArray(facts.allEvents) && isDeepStrictEqual(facts.events, facts.allEvents.filter(row => row.entity === 'schedules')) && sameRows(facts.server, rowsFromLedger(facts.allEvents)); } catch { return false; }
}
function acknowledged(facts, id) {
  const local = facts.local.schedules.find(row => row.id === id), remote = facts.server.find(row => row.id === id), event = facts.events.filter(row => row.entityId === id).at(-1);
  return Boolean(local && remote) && uniqueRows(facts.local.schedules, 'id') && uniqueRows(facts.local.settings, 'key') && uniqueRows(facts.server, 'id') && quiescent(facts) && ledgerConsistent(facts) && validVersion(version(facts, id)) && version(facts, id) === event?.seq && event?.operation === 'upsert' && isDeepStrictEqual(event.data, remote) &&
    typeof local.id === 'string' && local.id.length > 0 && typeof local.title === 'string' && local.title.length > 0 && typeof local.location === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(local.date) && ['startTime', 'endTime'].every(key => /^([01]\d|2[0-3]):[0-5]\d$/.test(local[key])) && local.startTime < local.endTime && ['class', 'study', 'work', 'social', 'other'].includes(local.type) && ['none', 'weekly'].includes(local.repeat) && Number.isInteger(local.remind) && local.remind >= 0 && local.remind <= 1440 &&
    FIELDS.every(key => Object.hasOwn(local, key) && Object.hasOwn(remote, key) && isDeepStrictEqual(local[key], remote[key])) && remote.userId === facts.owner &&
    Number.isSafeInteger(local.createdAt) && local.createdAt > 0 && Number.isSafeInteger(local.updatedAt) && local.updatedAt >= local.createdAt &&
    iso(remote.createdAt) && iso(remote.updatedAt) && Date.parse(remote.updatedAt) >= Date.parse(remote.createdAt) &&
    Array.isArray(remote.exceptions) && (local.exceptions === undefined ? remote.exceptions.length === 0 : isDeepStrictEqual(local.exceptions, remote.exceptions));
}
function cursorDerived(before, after, value) {
  const old = before.local.settings.find(row => row.key === 'syncV2Cursor')?.value ?? '0';
  if (!(old === '0' || validVersion(old)) || !validVersion(value) || BigInt(value) <= BigInt(old) || !after.allEvents.some(row => row.seq === value)) return false;
  // Every consumed event must be accounted for by its observed per-record
  // version. Merely being a number below the ledger maximum is insufficient.
  return after.allEvents.filter(row => BigInt(row.seq) > BigInt(old) && BigInt(row.seq) <= BigInt(value)).every(event => {
    const known = after.local.settings.find(row => row.key === `sync-version:${event.entity}:${event.entityId}`)?.value;
    return validVersion(known) && BigInt(known) >= BigInt(event.seq);
  });
}
function settingsPreserved(before, after, { change, consumedDraft } = {}) {
  return uniqueRows(before.local.settings, 'key') && uniqueRows(after.local.settings, 'key') && settingsDifferences(before, after).every(diff => {
    const valueOnly = diff.after && (diff.before ? onlyChanges(diff.before, diff.after, ['value']) : isDeepStrictEqual(Object.keys(diff.after).sort(), ['key', 'value']));
    if (diff.key === 'lastPullAt' || change && diff.key === 'lastPushAt') return valueOnly && iso(diff.after.value) && (!diff.before || iso(diff.before.value) && Date.parse(diff.after.value) >= Date.parse(diff.before.value)) && Date.parse(diff.after.value) >= before.sample.browserStart && Date.parse(diff.after.value) <= after.sample.browserEnd;
    if (diff.key === 'syncV2Cursor') return valueOnly && cursorDerived(before, after, diff.after.value);
    if (change && diff.key === `sync-version:schedules:${change.id}`) return valueOnly && diff.after.value === change.version;
    if (consumedDraft && diff.key === consumedDraft) return diff.beforePresent && !diff.afterPresent;
    return false;
  });
}
function sourcesPreserved(before, after) {
  return before.owner === after.owner && ledgerConsistent(before) && ledgerConsistent(after) && quiescent(before) && quiescent(after) && sameRows(before.local.schedules, after.local.schedules) && sameRows(before.server, after.server) &&
    isDeepStrictEqual(before.local.outbox, after.local.outbox) && isDeepStrictEqual(before.allEvents, after.allEvents) && settingsPreserved(before, after);
}
function draftWriteResult(before, after, id) {
  const source = before.local.schedules.find(row => row.id === id), key = source && draftKey(source), rows = after.local.settings.filter(row => row.key === key), envelope = rows[0]?.value;
  const exact = Boolean(source) && !before.local.settings.some(row => row.key === key) && rows.length === 1 && typeof envelope?.revision === 'string' && /^[a-f0-9]{32}$/.test(envelope.revision) &&
    isDeepStrictEqual(rows[0], { key, value: { revision: envelope.revision, value: expectedForm(source, true) } });
  const stripped = { ...after, local: { ...after.local, settings: after.local.settings.filter(row => row.key !== key) } };
  return { pass: exact && acknowledged(before, id) && sourcesPreserved(before, stripped), exact, key, envelope };
}
function savedResult(before, prepared, after, id) {
  const a = before.local.schedules.find(row => row.id === id), b = after.local.schedules.find(row => row.id === id), x = before.server.find(row => row.id === id), y = after.server.find(row => row.id === id);
  const added = after.allEvents.slice(before.allEvents.length), event = added[0], envelope = draftWriteResult(before, prepared, id);
  const timestamps = Boolean(a && b && x && y) && Number.isSafeInteger(b.updatedAt) && b.updatedAt >= a.updatedAt && b.updatedAt >= before.sample.browserStart && b.updatedAt <= after.sample.browserEnd &&
    iso(y.updatedAt) && Date.parse(y.updatedAt) >= Date.parse(x.updatedAt) && Date.parse(y.updatedAt) >= before.sample.driverStart && Date.parse(y.updatedAt) <= after.sample.driverEnd;
  const exactEvent = added.length === 1 && isDeepStrictEqual(before.allEvents, after.allEvents.slice(0, before.allEvents.length)) && event.entity === 'schedules' && event.entityId === id && event.operation === 'upsert' &&
    validVersion(event.seq) && BigInt(event.seq) > BigInt(before.allEvents.at(-1)?.seq ?? '0') && version(after, id) === event.seq && isDeepStrictEqual(event.data, y);
  const pass = envelope.pass && acknowledged(after, id) && before.local.schedules.length === 4 && after.local.schedules.length === 4 && before.server.length === 4 && after.server.length === 4 &&
    uniqueRows(after.local.schedules, 'id') && uniqueRows(after.server, 'id') && exactEvent && timestamps && onlyChanges(a, b, ['startTime', 'endTime', 'updatedAt']) && onlyChanges(x, y, ['startTime', 'endTime', 'updatedAt']) &&
    b.startTime === '09:15' && b.endTime === '10:15' && y.startTime === b.startTime && y.endTime === b.endTime &&
    sameRows(before.local.schedules.filter(row => row.id !== id), after.local.schedules.filter(row => row.id !== id)) && sameRows(before.server.filter(row => row.id !== id), after.server.filter(row => row.id !== id)) &&
    isDeepStrictEqual(before.local.outbox, after.local.outbox) && settingsPreserved(prepared, after, { change: { id, version: version(after, id) }, consumedDraft: envelope.key }) && !after.local.settings.some(row => row.key === envelope.key);
  return { pass, timestamps, exactEvent, id, beforeVersion: version(before, id), afterVersion: version(after, id), settingsDifferences: settingsDifferences(prepared, after) };
}

// Existing small readonly IDB reader adapted to the three named Schedule tables.
// Reject unsupported values before JSON serialization, rather than silently
// losing fields. This is a table sample, not a complete database backup.
export function readScheduleSource(owner) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected account DB does not exist')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, names = ['schedules', 'settings', 'outbox'], tx = db.transaction(names, 'readonly'), result = {};
      for (const name of names) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { result[name] = read.result; }; }
      tx.oncomplete = () => {
        db.close();
        try {
          const visit = value => {
            if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
            if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
            if (typeof value !== 'object' || Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) throw new Error('Unsupported Schedule snapshot value; exact preservation cannot be claimed');
            const keys = Reflect.ownKeys(value);
            if (Array.isArray(value) && (keys.length !== value.length + 1 || !Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean))) throw new Error('Sparse or extended Schedule source array');
            for (const key of keys) {
              if (Array.isArray(value) && key === 'length') continue;
              const descriptor = Object.getOwnPropertyDescriptor(value, key);
              if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Unsupported Schedule source property');
              visit(descriptor.value);
            }
          };
          visit(result); resolve(JSON.stringify(result));
        } catch (error) { reject(error); }
      };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Readonly Schedule source aborted')); };
    };
  });
}

function readinessResult(samples) {
  let settledAt, previous = -1, ordered = true, count = 0;
  for (const row of samples) {
    ordered &&= Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs > previous; previous = row.elapsedMs;
    const ready = row.modalCount === 0 && row.modalAnimations === 0 && row.schedule?.url === '/schedule' && row.schedule.present && !row.schedule.loading;
    if (ready) { settledAt ??= row.elapsedMs; count++; } else { settledAt = undefined; count = 0; }
  }
  const elapsedMs = samples.at(-1)?.elapsedMs ?? 0, readyMs = settledAt === undefined ? 0 : elapsedMs - settledAt;
  return { pass: ordered && elapsedMs >= 900 && elapsedMs <= 4000 && count >= 4 && readyMs >= 350, elapsedMs, settledAt: settledAt ?? null, readyMs, readySamples: count, ordered,
    note: 'Contiguous route/loading/modal-exit readiness suffix; desired focus never controls the observation deadline' };
}
const dayScope = (surface, source) => surface.schedule?.url === '/schedule' && isDeepStrictEqual(surface.schedule.selectedTabs, ['日']) && surface.schedule.heading === dateLabel(source.date);
const readableAnchor = (surface, source) => dayScope(surface, source) && surface.anchor?.matches === 1 && sameIdentity(surface.anchor, source) && surface.anchor.geometry?.visible && surface.anchor.titleGeometry?.visible && surface.anchor.timeGeometry?.visible;
const actionable = row => row && !row.disabled && row.tabIndex >= 0 && (row.tag === 'BUTTON' || row.tag === 'DIV' && row.role === 'button');
function activationResult(before, now, source) {
  return { pass: actionable(now.active) && now.active.node === before.active?.node && now.geometry?.visible === true && ['tag', 'role', 'id', 'text', 'ariaLabel'].every(key => now.active[key] === before.active[key]) &&
    (!before.active.logicalCard || source && readableAnchor(now, source) && now.active.node === now.anchor.node && isDeepStrictEqual(now.active.logicalCard, before.active.logicalCard)) };
}
function returnResult(samples, origin, source, { afterSave = false } = {}) {
  const readiness = readinessResult(samples), final = samples.at(-1), tail = samples.filter(row => row.elapsedMs >= readiness.elapsedMs - 250);
  return { pass: readiness.pass && tail.length >= 4 && tail.every(row => readableAnchor(row, source) && actionable(row.active) && row.geometry?.visible && row.active.node === row.anchor.node && row.active.ariaLabel === identity(source).ariaLabel && sameIdentity(row.active.logicalCard, source) && row.active.node === final.active.node && (afterSave || row.active.node === origin.active.node)),
    readiness, final, tailSamples: tail.length, exactOpenerAtEnd: final?.active?.node === origin.active.node, contract: afterSave ? 'Stable same logical visible Schedule card; remount allowed' : 'Stable original connected visible DIV role=button or button', note: 'Frozen before any recovery/navigation key; later success cannot replace this verdict' };
}
function calendarResult(surface, date, count) {
  const [year, month] = date.split('-').map(Number), first = new Date(Date.UTC(year, month - 1, 1)), offset = (first.getUTCDay() + 6) % 7, days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => new Date(Date.UTC(year, month - 1, i - offset + 1)).toISOString().slice(0, 10));
  const actual = surface.schedule.cells.map(row => row.ariaLabel.split('，')[0]), target = surface.schedule.cells.filter(row => row.ariaLabel === `${dateLabel(date)}，${count}个日程`);
  return { pass: surface.schedule.url === '/schedule' && isDeepStrictEqual(surface.schedule.selectedTabs, ['月']) && surface.schedule.heading === `${year}年${month}月` && isDeepStrictEqual(actual, dates.map(dateLabel)) && target.length === 1 && target[0].text === String(Number(date.slice(-2))), dates, actual, target };
}
export const scheduleKeyboardChecks = { identity, expectedForm, acknowledged, sourcesPreserved, draftWriteResult, savedResult, readinessResult, returnResult, calendarResult, activationResult, settingsPreserved, cursorDerived };

// Read-only DOM descriptors share the established WeakMap identity. They never
// set attributes, scroll, focus, dispatch events or assign form values.
function readScheduleDescriptor() {
  const state = globalThis.__ykReadNodes, node = el => { if (!state.nodes.has(el)) state.nodes.set(el, state.next++); return state.nodes.get(el); };
  const selector = el => {
    const parts = []; for (let current = el; current && current !== document.body; current = current.parentElement) { const peers = [...current.parentElement.children].filter(other => other.tagName === current.tagName); parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(current) + 1})`); }
    return el ? 'body > ' + parts.join(' > ') : null;
  };
  const arrows = [...document.querySelectorAll('main button[aria-label="下一页"]')], heading = arrows.length === 1 ? [...arrows[0].parentElement.children].find(el => el.tagName === 'SPAN') : null;
  const cards = [...document.querySelectorAll('main [role=button]')].map(el => {
    const title = el.querySelector('p'), time = [...el.querySelectorAll('span')].find(span => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(span.textContent));
    return { node: node(el), selector: selector(el), titleSelector: selector(title), timeSelector: selector(time), title: title?.textContent.trim(), time: time?.textContent.trim(), ariaLabel: el.getAttribute('aria-label') };
  });
  const cells = [...document.querySelectorAll('main button[aria-label]')].filter(el => /^\d{1,2}月\d{1,2}日，\d+个日程$/.test(el.getAttribute('aria-label'))).map(el => ({ node: node(el), ariaLabel: el.getAttribute('aria-label'), text: el.textContent.trim(), pressed: el.getAttribute('aria-pressed') }));
  return { url: location.pathname + location.search, present: arrows.length === 1 && Boolean(heading), loading: /正在寻找这条日程/.test(document.querySelector('main')?.innerText ?? ''), heading: heading?.textContent.trim(), headingSelector: selector(heading),
    selectedTabs: [...document.querySelectorAll('[role=tablist][aria-label="视图切换"] [role=tab][aria-selected=true]')].map(el => el.textContent.trim()), cards, cells,
    feedback: [...document.querySelectorAll('[role=status],[role=alert],[role=region][aria-label="通知"] span')].map(el => {
      const rect = el.getBoundingClientRect(), clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }; let painted = true;
      for (let current = el; current; current = current.parentElement) {
        const css = getComputedStyle(current), box = current.getBoundingClientRect();
        painted &&= css.visibility === 'visible' && Number(css.opacity) >= 0.99 && css.display !== 'none';
        if (current !== el && /(auto|scroll|hidden|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
        if (current !== el && /(auto|scroll|hidden|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
      }
      return { text: el.textContent.trim(), selector: selector(el), rect: rect.toJSON(), clip, visible: painted && rect.width > 0 && rect.height > 0 && rect.left >= clip.left && rect.right <= clip.right && rect.top >= clip.top && rect.bottom <= clip.bottom };
    }) };
}
// Supplemental observer only for time-input arrow keys. No text/credentials or
// other inputs are sampled, and no application handler is replaced.
function installScheduleArrowObserver() {
  const nodes = globalThis.__ykReadNodes, state = { events: [], next: 1, dropped: 0, failures: 0, stopped: false };
  const listen = event => {
    if (!['schedule-start', 'schedule-end'].includes(event.target?.id) || !['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
    try {
      if (!nodes.nodes.has(event.target)) nodes.nodes.set(event.target, nodes.next++);
      state.events.push({ seq: state.next++, type: event.type, key: event.key, trusted: event.isTrusted, node: nodes.nodes.get(event.target), tag: event.target.tagName, shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey, repeat: event.repeat, monotonicMs: performance.now() });
      if (state.events.length > 256) { state.events.shift(); state.dropped++; }
    } catch { state.failures++; }
  };
  state.stop = () => { document.removeEventListener('keydown', listen, true); document.removeEventListener('keyup', listen, true); state.stopped = true; };
  document.addEventListener('keydown', listen, true); document.addEventListener('keyup', listen, true); globalThis.__scheduleArrowEvents = state;
}

export async function runScheduleKeyboardTail(h, { page, label, api, id, originalDate, selectDate, recoveryCompleted }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native Schedule evidence runs only in authorized hosted CI');
  const { sleep, pointer, capture, observe, actions, writeFile, join, artifacts } = h;
  const prefix = `${label}-schedule-keyboard`, saveJSON = (stage, value) => writeFile(join(artifacts, `${prefix}-${stage}.json`), JSON.stringify(value, null, 2));
  const report = (stage, pass, detail) => observe(page, `${prefix}-${stage}`, pass, JSON.stringify(detail));
  const unfocused = new Map(); let phase = 'setup', installed = false, wanted;
  async function facts(stage, { settle = true } = {}) {
    const sample = { driverStart: Date.now(), browserStart: await page.evaluate(() => Date.now()) };
    const read = async () => JSON.parse(await page.evaluate(readScheduleSource, api.ownerId));
    let local = await read();
    if (settle) for (let attempt = 0; attempt < 60 && (local.outbox.length || local.settings.some(row => row.key === 'syncV2Batch')); attempt++) { await sleep(150); local = await read(); }
    const allEvents = [], pages = []; let cursor = '0', complete = false;
    for (let i = 0; i < 20; i++) {
      const body = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`);
      assert.ok(expenseOutcomeChecks.completeLedgerPage(body, cursor), 'Complete ledger page protocol, sequence and cursor must be trustworthy');
      pages.push({ cursor, ...body }); allEvents.push(...body.events); cursor = body.nextCursor;
      if (!body.hasMore) { complete = true; break; }
    }
    assert.ok(complete, 'Bounded synthetic ledger must be complete');
    const server = (await api('/schedules')).schedules;
    sample.browserEnd = await page.evaluate(() => Date.now()); sample.driverEnd = Date.now();
    const result = { owner: api.ownerId, local, server, allEvents, events: allEvents.filter(row => row.entity === 'schedules'), sample };
    await saveJSON(`${stage}-full-source`, { syntheticOnly: true, scope: 'Complete named schedules/settings/outbox tables, raw GET schedules and complete all-entity ledger; not a whole-database backup', unsupportedValues: 'Reader rejects unsupported/non-JSON values before serialization; no lossy fallback', ...result, pages });
    assert.ok(uniqueRows(local.schedules, 'id') && uniqueRows(local.settings, 'key') && uniqueRows(server, 'id') && ledgerConsistent(result), 'Local identities and raw server/ledger agreement are required');
    return result;
  }
  async function snapshot() {
    const current = await page.evaluate(readKeyboardSurface, EXTRA); current.schedule = await page.evaluate(readScheduleDescriptor);
    const matches = wanted ? current.schedule.cards.filter(row => sameIdentity(row, wanted)) : [];
    current.anchor = matches.length === 1 ? { ...matches[0], matches: 1 } : { matches: matches.length };
    current.active.logicalCard = current.schedule.cards.find(row => row.node === current.active.node) ?? null;
    current.geometry = await page.evaluate(initialSessionGeometry, current.active.selector);
    current.schedule.headingGeometry = current.schedule.headingSelector ? await page.evaluate(initialSessionGeometry, current.schedule.headingSelector) : { visible: false };
    if (current.anchor.matches === 1) for (const [key, selector] of [['geometry', current.anchor.selector], ['titleGeometry', current.anchor.titleSelector], ['timeGeometry', current.anchor.timeSelector]]) current.anchor[key] = selector ? await page.evaluate(initialSessionGeometry, selector) : { visible: false };
    for (const row of current.controls) if (!row.focused) unfocused.set(row.node, row);
    return current;
  }
  async function stable() {
    const start = Date.now(); let previous, count = 0, current;
    do {
      current = await snapshot(); const signature = JSON.stringify({ active: current.active.node, rect: current.active.rect, css: current.active.css, viewport: current.viewport, animations: current.modalAnimations, heading: current.schedule.heading });
      count = signature === previous ? count + 1 : 0;
      if (count >= 2 && current.modalAnimations === 0) return { ...current, stability: { observed: true } };
      previous = signature; await sleep(55);
    } while (Date.now() - start < 2200);
    return { ...current, stability: { observed: false } };
  }
  async function evidence(stage, current) { current ??= await stable(); await saveJSON(`${stage}-surface`, current); await capture(page, `${prefix}-${stage}`); return current; }
  async function controlKey(key, stage) {
    assert.equal(phase, 'keyboard');
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(key);
    assert.ok(arrows || ['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape'].includes(key));
    const preceding = await snapshot();
    if (arrows) assert.ok(['schedule-start', 'schedule-end'].includes(preceding.active.id) && preceding.active.inDialog && preceding.geometry.visible && !preceding.active.disabled, 'Native time arrows require the observed visible enabled time field');
    const startSeq = await page.evaluate(arrows => (arrows ? globalThis.__scheduleArrowEvents : globalThis.__ykControlEvents).next, arrows);
    actions.push({ kind: 'schedule-keyboard-intent', surface: label, stage, key, preceding });
    let error;
    try { if (key === 'Shift+Tab') await page.keyboard.down('Shift'); try { await page.keyboard.press(key === 'Shift+Tab' ? 'Tab' : key); } finally { if (key === 'Shift+Tab') await page.keyboard.up('Shift'); } } catch (reason) { error = reason; }
    const receipts = await page.evaluate(({ arrows, startSeq }) => { const state = arrows ? globalThis.__scheduleArrowEvents : globalThis.__ykControlEvents; return { events: state.events.filter(row => row.seq >= startSeq), dropped: state.dropped, failures: state.failures }; }, { arrows, startSeq });
    const delivery = keyboard.keyDeliveryResult(preceding, key, receipts.events, receipts);
    actions.push({ kind: 'schedule-keyboard-result', surface: label, stage, key, sendReturned: !error, delivery, ...(arrows ? { after: await snapshot() } : {}) });
    if (error) throw error; assert.ok(delivery.pass, 'Trusted keydown/keyup must have reached the actual preceding target; stop on missing or stale receipts');
  }
  async function tab(reverse = false) { await controlKey(reverse ? 'Shift+Tab' : 'Tab', 'sequential-navigation'); return stable(); }
  async function reach(predicate, stage, { reverse = false, contained = false, limit = 70 } = {}) {
    const path = []; let current = await stable();
    for (let i = 0; i <= limit; i++) {
      path.push({ active: current.active, geometry: current.geometry, viewport: current.viewport, stability: current.stability });
      if (contained && !current.active.inDialog) { await saveJSON(`${stage}-tab-path`, path); await report(`${stage}-escaped-editor`, false, current); throw new Error('Natural keyboard focus escaped the Schedule editor'); }
      if (predicate(current) && current.stability.observed && current.geometry.visible && !current.active.disabled) { await saveJSON(`${stage}-tab-path`, path); return current; }
      if (i < limit) current = await tab(reverse);
    }
    await saveJSON(`${stage}-tab-path`, path); await report(`${stage}-unreachable`, false, path); throw new Error('Bounded actual Tab navigation cannot reach the known usable target');
  }
  async function activate(current, key, stage) { assert.ok(activationResult(current, await snapshot(), wanted).pass, 'Revalidate exact actual node, visible geometry and semantics immediately before activation'); await controlKey(key, stage); }
  async function ready() { await page.waitForFunction(() => { const modal = document.querySelector('[role=dialog]'); return modal?.querySelector('#schedule-title') && !modal.querySelector('fieldset').disabled && !/正在读取草稿|正在保留草稿/.test(modal.innerText); }, { timeout: 7000 }); }
  async function editor() {
    return page.$eval('[role=dialog]', el => {
      const fields = Object.fromEntries(['title', 'date', 'start', 'end', 'location'].map(key => [key, el.querySelector(`#schedule-${key}`).value]));
      return { title: fields.title, date: fields.date, startTime: fields.start, endTime: fields.end, location: fields.location,
        type: [...el.querySelectorAll('[aria-label="日程类型"] [aria-pressed=true]')].map(button => ({ 课程: 'class', 学习: 'study', 工作: 'work', 社交: 'social', 其他: 'other' })[button.textContent.trim()]),
        repeat: [...el.querySelectorAll('[aria-label="重复规则"] [aria-pressed=true]')].map(button => ({ 不重复: 'none', 每周重复: 'weekly' })[button.textContent.trim()]),
        scopeGroups: el.querySelectorAll('[aria-label="修改范围"]').length, copy: [...el.querySelectorAll('p')].map(row => row.textContent.trim()) };
    });
  }
  async function verifyEditor(source, changed, stage, restored = false) {
    let readiness;
    if (restored) {
      // Draft readiness can precede the entrance animation's settled paint.
      const started = Date.now(), current = await stable();
      readiness = { ...current.stability, modalAnimations: current.modalAnimations, modalCount: current.modalCount, elapsedMs: Date.now() - started, maximumMs: 2200, surfaceArtifact: `${prefix}-${stage}-restored-settled-surface.json` };
      await saveJSON(`${stage}-restored-settled-surface`, current);
      const settled = readiness.observed && readiness.modalAnimations === 0 && readiness.elapsedMs <= readiness.maximumMs;
      if (!settled) {
        await saveJSON(`${stage}-restored-copy-reading`, { readiness, copyRead: false });
        await report(`${stage}-restored-copy-readable`, false, { readiness, copyRead: false, note: 'Existing bounded stability observation did not settle; stop before copy reading or Save.' });
        assert.ok(settled, 'Restored-copy reading requires observed stability within 2200 ms and no running modal animations before Save');
      }
    }
    const actual = await editor(), form = expectedForm(source, changed), expected = { ...Object.fromEntries(['title', 'date', 'startTime', 'endTime', 'location'].map(key => [key, form[key]])), type: [source.type], repeat: ['none'], scopeGroups: 0 };
    const pass = isDeepStrictEqual({ ...actual, copy: undefined }, { ...expected, copy: undefined }) && (!restored || actual.copy.includes('已恢复本机编辑稿；保存前不会修改日程'));
    if (restored) {
      const copy = await page.evaluate(() => {
        const text = '已恢复本机编辑稿；保存前不会修改日程', rows = [...document.querySelectorAll('[role=dialog] p')].filter(el => el.textContent.trim() === text);
        if (rows.length !== 1) return { text, matches: rows.length, selector: null };
        const parts = []; for (let node = rows[0]; node && node !== document.body; node = node.parentElement) { const peers = [...node.parentElement.children].filter(other => other.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(node) + 1})`); }
        return { text, matches: 1, selector: 'body > ' + parts.join(' > ') };
      });
      const geometry = copy.selector ? await page.evaluate(initialSessionGeometry, copy.selector) : { visible: false };
      await saveJSON(`${stage}-restored-copy-reading`, { ...copy, geometry, readiness });
      await report(`${stage}-restored-copy-readable`, copy.matches === 1 && geometry.visible, { ...copy, geometry, readiness, note: 'Natural settled/title-focus position; no additional keys, pointer, focus or scroll. A reading failure stays RED independently of source retention.' });
    }
    await report(stage, pass, { actual, expected, note: 'Complete DOM form values; individual field/copy captures establish the separate reading observations, without requiring the whole editor onscreen.' }); assert.ok(pass, 'The complete editor values must bind the exact original source');
  }
  async function preserved(before, after, stage) { const pass = sourcesPreserved(before, after); await report(stage, pass, { settingsDifferences: settingsDifferences(before, after), claim: 'Complete named three-table source, raw server rows and entire old all-entity ledger' }); assert.ok(pass, 'Source mismatch stops dependent actions'); }
  async function nativeTime(field, expected) {
    const target = await reach(row => row.active.id === field, `${field}-reach`, { contained: true, limit: 25 }); await evidence(`${field}-before`, target);
    const read = () => page.$eval(`#${field}`, el => ({ value: el.value, focused: el === document.activeElement, disabled: el.matches(':disabled') }));
    for (let i = 0; i < 5; i++) await controlKey('ArrowLeft', `${field}-hour-segment-${i}`);
    const original = await read(); assert.equal(original.value, field === 'schedule-start' ? '09:00' : '10:00');
    await controlKey('ArrowRight', `${field}-minute-segment`);
    for (let i = 0; i < 15; i++) { const actual = await read(); assert.ok(actual.focused && !actual.disabled); if (actual.value === expected) break; await controlKey('ArrowUp', `${field}-minute-${i + 1}`); }
    assert.equal((await read()).value, expected, 'Native segmented minute entry failure is blocked, never a passed product result');
    await controlKey('Tab', `${field}-commit`); await ready(); assert.equal((await read()).value, expected); await evidence(`${field}-committed`);
  }
  async function trace(stage, operation) {
    const start = Date.now(), samples = []; await operation();
    do {
      const current = await snapshot(); samples.push({ elapsedMs: Date.now() - start, ...current });
      if (readinessResult(samples).pass) break;
      await sleep(35);
    } while (Date.now() - start < 4000);
    await saveJSON(`${stage}-natural-trace`, { samples, readiness: readinessResult(samples), maximumMs: 4000 }); await evidence(`${stage}-natural-final`, samples.at(-1)); return samples;
  }
  function dayMembership(surface, rows) {
    return dayScope(surface, wanted) && isDeepStrictEqual(surface.schedule.cards.map(({ title, time, ariaLabel }) => ({ title, time, ariaLabel })).sort((a, b) => a.ariaLabel.localeCompare(b.ariaLabel)), rows.map(identity).sort((a, b) => a.ariaLabel.localeCompare(b.ariaLabel)));
  }
  async function naturalResult(stage, samples, origin, source, options) {
    const result = returnResult(samples, origin, source, options); await report(`${stage}-natural-return-before-recovery`, result.pass, result);
    assert.ok(result.readiness.pass, 'Do not recover or retry Save while the modal/route outcome remains uncertain'); return result;
  }
  try {
    assert.ok(recoveryCompleted && id, 'The existing failed-delete recovery must finish before this dependent tail');
    const frozen = structuredClone(await facts('pre-calendar')), source = frozen.local.schedules.find(row => row.id === id); wanted = source;
    assert.ok(source && source.date === originalDate && source.startTime === '09:00' && source.endTime === '10:00' && source.repeat === 'none' && source.title === 'Synthetic 第二页已核对' && source.location === 'Synthetic 删除失败后仍需保留的草稿', 'Use the established ID and its latest recovered title/location');
    assert.ok(frozen.local.schedules.length === 4 && frozen.server.length === 4 && frozen.local.schedules.every(row => acknowledged(frozen, row.id)) && !frozen.local.settings.some(row => row.key === draftKey(source)), 'Exactly four acknowledged sources and no pre-existing target draft');
    const rows = frozen.local.schedules, weekly = rows.filter(row => row.repeat === 'weekly');
    assert.ok(rows.every(row => row.date === source.date) && rows.filter(row => row.repeat === 'none').length === 3 && weekly.length === 1 && weekly[0].exceptions?.length === 1 && weekly[0].exceptions[0].cancelled === true && weekly[0].exceptions[0].occurrenceDate !== source.date);
    assert.deepEqual(rows.filter(row => row.id !== id && row.repeat === 'none').map(row => row.startTime).sort(), ['06:15', '23:15']);
    assert.equal(phase, 'setup'); await selectDate(page, source.date);
    const originalDay = await evidence('setup-original-day'); assert.ok(dayMembership(originalDay, rows));
    await pointer(page, 'main button[aria-label="下一页"]');
    const nextDate = new Date(`${source.date}T12:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const setupDate = nextDate.toISOString().slice(0, 10), boundary = await evidence('pointer-setup-next-day'); assert.ok(dayScope(boundary, { date: setupDate }));
    await preserved(frozen, await facts('after-pointer-setup'), 'pointer-setup-preserves-source');
    phase = 'keyboard'; await page.evaluate(installKeyboardControlObserver); installed = true; await page.evaluate(installScheduleArrowObserver);
    actions.push({ kind: 'schedule-keyboard-only-boundary', surface: label, originalDate: source.date, setupDate, actualFocus: boundary.active, geometry: boundary.geometry, viewport: boundary.viewport, noNewProfileClockOrFault: true });
    // An actual first Tab is required even if pointer setup left an unexpected
    // current control. Subsequent target discovery remains bounded and adaptive.
    await tab();
    const month = await reach(row => row.active.role === 'tab' && row.active.text === '月', 'month-tab', { limit: 12 }); await evidence('month-tab', month); await activate(month, 'Enter', 'select-month');
    const [year, monthNumber] = source.date.split('-').map(Number), targetMonth = year * 12 + monthNumber;
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await stable(), match = current.schedule.heading?.match(/^(\d{4})年(\d{1,2})月$/); assert.ok(match && isDeepStrictEqual(current.schedule.selectedTabs, ['月']), 'Known actual month heading required');
      const actualMonth = Number(match[1]) * 12 + Number(match[2]); if (actualMonth === targetMonth) break;
      assert.equal(Math.abs(actualMonth - targetMonth), 1, 'Only the adjacent setup month is expected');
      const arrow = await reach(row => row.active.ariaLabel === (actualMonth < targetMonth ? '下一页' : '上一页'), 'adjacent-month-arrow', { reverse: true, limit: 12 }); await evidence('adjacent-month-arrow', arrow); await activate(arrow, 'Enter', 'show-original-month');
    }
    const calendar = await evidence('actual-original-month'), calendarCheck = calendarResult(calendar, source.date, rows.length); await report('month-membership-and-original-date-count', calendarCheck.pass && calendar.schedule.headingGeometry.visible, { ...calendarCheck, headingGeometry: calendar.schedule.headingGeometry, note: 'DOM calendar membership inventory; the original date target is read separately. Non-target cells are not individually read.' }); assert.ok(calendarCheck.pass && calendar.schedule.headingGeometry.visible);
    const dateCell = await reach(row => row.active.tag === 'BUTTON' && row.active.ariaLabel === `${dateLabel(source.date)}，4个日程`, 'original-date-cell');
    assert.equal((await snapshot()).schedule.cells.find(row => row.node === dateCell.active.node)?.pressed, 'false', 'The original date must be a real different calendar selection');
    await evidence('original-date-cell', dateCell); await activate(dateCell, 'Space', 'select-original-date-with-space');
    const selected = await evidence('date-cell-natural-disappearance');
    if (!selected.schedule.headingGeometry.visible) await reach(row => row.active.ariaLabel === '上一页', 'selected-day-heading-reading', { limit: 24 });
    const dated = await evidence('selected-day-heading');
    await report('selected-day-heading-readable', dayScope(dated, source) && dated.schedule.headingGeometry.visible, { date: source.date, heading: dated.schedule.heading, geometry: dated.schedule.headingGeometry });
    assert.ok(dayScope(dated, source) && dated.schedule.headingGeometry.visible, 'Read the actual selected date before navigating down the long day timeline');
    await report('actual-selected-day-and-four-card-identities', dayMembership(selected, rows) && selected.schedule.heading !== boundary.schedule.heading, { selected, previousHeading: boundary.schedule.heading, sourceDate: source.date, note: 'DOM card membership inventory; the intended card is read separately. Non-target cards are not individually read.' }); assert.ok(dayMembership(selected, rows));
    const origin = await reach(row => row.active.logicalCard && sameIdentity(row.active.logicalCard, source), 'original-day-card', { limit: 24 }); await evidence('original-day-card', origin);
    assert.ok(readableAnchor(origin, source));
    const initialIndicator = keyboard.indicatorResult(origin.active, unfocused.get(origin.active.node), origin.geometry); await report('original-card-painted-focus-indicator', initialIndicator.pass, initialIndicator);
    await preserved(frozen, await facts('pre-open'), 'calendar-and-card-reading-preserve-source');
    await activate(origin, 'Enter', 'open-original-card'); await ready(); await verifyEditor(source, false, 'opened-unedited-form'); await preserved(frozen, await facts('opened-unedited'), 'opening-writes-no-draft');
    const dateControl = await reach(row => row.active.id === 'schedule-date', 'original-date-review', { contained: true, limit: 12 }); assert.equal(dateControl.active.value, source.date); await evidence('original-date-field', dateControl);
    await nativeTime('schedule-start', '09:15'); await nativeTime('schedule-end', '10:15');
    const review = await reach(row => row.active.id === 'schedule-start', 'review-previous-time-with-shift-tab', { reverse: true, contained: true, limit: 12 }); assert.equal(review.active.value, '09:15'); await evidence('typed-start-review', review);
    await verifyEditor(source, true, 'typed-complete-form'); const prepared = await facts('typed-draft'), draftCheck = draftWriteResult(frozen, prepared, id); await report('only-exact-full-draft-written', draftCheck.pass, draftCheck); assert.ok(draftCheck.pass);
    const escapedSamples = await trace('escape', () => controlKey('Escape', 'escape-known-time-field'));
    const escaped = await naturalResult('escape', escapedSamples, origin, source);
    await preserved(prepared, await facts('escape-closed-before-recovery'), 'escape-full-draft-source-preserved');
    assert.ok(dayMembership(escaped.final, rows), 'Known original selected day/card identities required before bounded recovery');
    const escapeIndicator = keyboard.indicatorResult(escaped.final.active, unfocused.get(escaped.final.active.node), escaped.final.geometry); await report('escape-natural-painted-focus', escaped.pass && escapeIndicator.pass, { escaped: escaped.pass, indicator: escapeIndicator });
    actions.push({ kind: 'schedule-bounded-keyboard-reentry-after-frozen-return', surface: label, retainsOriginalRed: !escaped.pass || !escapeIndicator.pass });
    const reentry = await reach(row => row.active.logicalCard && sameIdentity(row.active.logicalCard, source), 'reopen-same-retained-card', { limit: 30 }); await evidence('reentry-card', reentry); assert.ok(readableAnchor(reentry, source));
    await activate(reentry, 'Space', 'reopen-same-card-with-space'); await ready(); await verifyEditor(source, true, 'reopened-retained-complete-form', true);
    await preserved(prepared, await facts('reopened'), 'reopen-preserves-exact-envelope-revision-base'); await evidence('reopened-retained-draft');
    const save = await reach(row => row.active.tag === 'BUTTON' && row.active.text === '保存', 'save-retained-once', { reverse: true, contained: true, limit: 12 }); await evidence('save-control', save);
    wanted = { ...source, startTime: '09:15', endTime: '10:15' };
    const savedSamples = await trace('save', () => activate(save, 'Enter', 'single-save-enter'));
    const savedReturn = await naturalResult('save', savedSamples, origin, wanted, { afterSave: true });
    const feedback = savedSamples.flatMap(row => row.schedule.feedback).filter(row => row.text === '日程已保存到本机' && row.visible);
    await report('actual-local-save-feedback', feedback.length > 0, { feedback, meaning: 'Local save only; complete sources below independently establish the server outcome' });
    const saved = await facts('saved'), savedCheck = savedResult(frozen, prepared, saved, id); await report('single-save-exact-upsert-and-source-retention', savedCheck.pass, savedCheck); assert.ok(savedCheck.pass, 'Uncertain mutation outcome stops without retrying Save');
    assert.ok(dayMembership(savedReturn.final, rows.map(row => row.id === id ? wanted : row)), 'Returned day must contain the same four logical records');
    // Natural evidence above is frozen. One genuine Tab supplies continuation
    // and, for a remount, the same new node's unfocused painted-style comparison.
    actions.push({ kind: 'schedule-post-natural-save-single-tab', surface: label, retainsOriginalRed: !savedReturn.pass });
    const next = await tab(), nextSamples = [], started = Date.now();
    do { nextSamples.push({ elapsedMs: Date.now() - started, ...await snapshot() }); await sleep(40); } while (Date.now() - started < 350);
    nextSamples.push({ elapsedMs: Date.now() - started, ...await snapshot() });
    const saveIndicator = keyboard.indicatorResult(savedReturn.final.active, unfocused.get(savedReturn.final.active.node), savedReturn.final.geometry);
    await report('save-natural-painted-focus', savedReturn.pass && saveIndicator.pass, { naturalReturn: savedReturn.pass, indicator: saveIndicator });
    const nextResult = keyboard.nextTabResult(savedReturn.final, next, nextSamples); await saveJSON('single-next-tab', nextResult); await report('single-next-tab-stable-usable-control', nextResult.pass, nextResult); await evidence('final-continuation', nextSamples.at(-1));
    await preserved(saved, await facts('final-continuation'), 'final-continuation-preserves-saved-source');
    return { sourcePreserved: true, escapeReturn: escaped.pass && escapeIndicator.pass, saveReturn: savedReturn.pass && saveIndicator.pass, subsequentTab: nextResult.pass, initialIndicator: initialIndicator.pass };
  } catch (error) {
    await evidence('first-failure').catch(() => undefined);
    await facts('first-failure', { settle: false }).catch(sourceError => saveJSON('first-failure-source-unavailable', { firstFailure: error.message, sourceFailure: sourceError.message }));
    throw error;
  } finally {
    if (installed) await page.evaluate(() => {
      const result = {};
      for (const [name, state] of [['control', globalThis.__ykControlEvents], ['timeArrows', globalThis.__scheduleArrowEvents]]) if (state) { state.stop(); result[name] = { events: state.events, dropped: state.dropped, failures: state.failures, stopped: state.stopped }; }
      return result;
    }).then(value => saveJSON('trusted-key-events', value));
  }
}
