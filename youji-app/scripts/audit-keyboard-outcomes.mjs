// One continuous keyboard editing task. Native execution belongs to hosted CI.
// Setup may use the pointer; after its explicit boundary only real keys navigate.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHabitAuditClock, installAuditDate } from './audit-clock.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { preparePreferencePointer } from './audit-preference-pointer.mjs';
import { todoOutcomeChecks as todo, readTodoSource, installTodoQuota } from './audit-todo-outcomes.mjs';

const BASELINE = '386cde59c2a2254d08e70df712751b55c8af2a8b';
const PROFILES = [{ width: 1280, phone: '13900008911', nickname: 'Synthetic YK 1280' }, { width: 360, phone: '13900008912', nickname: 'Synthetic YK 360' }];
const DECLARED = [{ text: '合成：归还图书', priority: 'low', dueDate: '2026-10-07', done: false }, { text: '合成：归还图书', priority: 'medium', dueDate: '2026-10-08', done: false }];
const TYPED = { text: '合成：归还两本书', priority: 'high', dueDate: '2026-10-09', done: false };
const ORDER = ['close', 'content', 'priority', 'due-date', 'today', 'tomorrow', 'no-date', 'done', 'delete', 'cancel', 'save'];
const draft = (facts, key) => facts.local.settings.find(row => row.key === key)?.value;

// A native date control can take several Tabs without changing activeElement.
// Other duplicate nodes, skipped controls, escaped focus and short subloops fail.
function cycleResult(observations, direction, reference = {}) {
  const collapsed = [], invalid = [], nodes = { ...reference };
  for (const row of observations) {
    if (!row || !ORDER.includes(row.key) || !Number.isSafeInteger(row.node) || row.node < 1) { invalid.push(row); continue; }
    if (nodes[row.key] !== undefined && nodes[row.key] !== row.node) invalid.push({ ...row, reason: 'same semantic control changed node' });
    if (Object.entries(nodes).some(([key, node]) => key !== row.key && node === row.node)) invalid.push({ ...row, reason: 'same node cannot stand in for distinct controls' });
    nodes[row.key] ??= row.node;
    const previous = collapsed.at(-1);
    if (row.key === previous?.key) { if (row.key !== 'due-date' || row.node !== previous.node) invalid.push(row); }
    else collapsed.push(row);
  }
  const start = ORDER.indexOf(collapsed[0]?.key);
  const expected = start < 0 ? [] : Array.from({ length: ORDER.length + 1 }, (_, i) => ORDER[(start + (direction === 'reverse' ? -i : i) + ORDER.length * 2) % ORDER.length]);
  return { pass: expected.length > 0 && invalid.length === 0 && collapsed.at(-1)?.node === collapsed[0]?.node && isDeepStrictEqual(collapsed.map(row => row.key), expected), collapsed, expected, invalid, nodes, raw: observations };
}
function nextTabResult(before, next, samples) {
  const usable = row => row.active && row.active.node !== before.active.node && row.active.tabIndex >= 0 && (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY'].includes(row.active.tag) || Boolean(row.active.role) || row.active.contentEditable === true) && !row.active.disabled && row.geometry?.visible;
  return { pass: next.stability?.observed === true && usable(next) && (samples.at(-1)?.elapsedMs ?? 0) >= 300 && samples.length >= 4 && samples.every(row => usable(row) && row.active.node === next.active.node), before, next, samples };
}
function keyDeliveryResult(before, key, events, { dropped = 0, failures = 0 } = {}) {
  const expectedKey = key === 'Space' ? ' ' : key === 'Shift+Tab' ? 'Tab' : key;
  const [down, up] = events;
  return { pass: dropped === 0 && failures === 0 && events.length === 2 && down.type === 'keydown' && up.type === 'keyup' && down.key === expectedKey && up.key === expectedKey && down.trusted === true && up.trusted === true && events.every(row => row.repeat === false && !row.ctrl && !row.alt && !row.meta) && down.node === before.active.node && down.shift === (key === 'Shift+Tab') && down.seq < up.seq && down.monotonicMs <= up.monotonicMs, before, key, events, dropped, failures, note: 'Default keydown action may move focus; keyup records its actual target without requiring the old target' };
}
// Installed only after synthetic setup. It observes four control keys without
// cancelling, redispatching, retaining DOM nodes or observing text/credentials.
export function installKeyboardControlObserver() {
  if (globalThis.__ykControlEvents) throw new Error('Keyboard observer already exists');
  const nodes = globalThis.__ykReadNodes ??= { nodes: new WeakMap(), next: 1 };
  const state = { events: [], next: 1, dropped: 0, failures: 0, stopped: false };
  const listen = event => {
    try {
      const key = event.key;
      if (!['Tab', 'Enter', ' ', 'Escape'].includes(key)) return;
      const target = event.target;
      if (!nodes.nodes.has(target)) nodes.nodes.set(target, nodes.next++);
      state.events.push({ seq: state.next++, type: event.type, key, trusted: event.isTrusted, node: nodes.nodes.get(target), tag: target.tagName ?? null, shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey, repeat: event.repeat, monotonicMs: performance.now() });
      if (state.events.length > 4096) { state.events.shift(); state.dropped++; }
    } catch { state.failures++; }
  };
  state.stop = () => { document.removeEventListener('keydown', listen, true); document.removeEventListener('keyup', listen, true); state.stopped = true; };
  document.addEventListener('keydown', listen, true); document.addEventListener('keyup', listen, true);
  globalThis.__ykControlEvents = state;
  return { installed: true, keys: ['Tab', 'Enter', ' ', 'Escape'] };
}
function cssParts(value) {
  let depth = 0, start = 0; const parts = [];
  for (let i = 0; i < value.length; i++) { if (value[i] === '(') depth++; if (value[i] === ')') depth--; if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; } }
  parts.push(value.slice(start)); return parts;
}
function transparent(value) {
  if (!value || value === 'transparent') return true;
  const slashAlpha = value.match(/\/\s*([\d.]+)%?\s*\)$/); if (slashAlpha) return Number(slashAlpha[1]) === 0;
  if (/^(rgba|hsla)\(/.test(value)) { const components = value.slice(value.indexOf('(') + 1, -1).split(','); return components.length === 4 && parseFloat(components[3]) === 0; }
  return false; // rgb(0, 0, 0) is opaque black, not a zero alpha value.
}
function indicatorResult(focused, unfocused, geometry) {
  if (!focused || !unfocused || focused.node !== unfocused.node || !focused.focused || unfocused.focused || !geometry?.visible) return { pass: false, reason: 'Need the same actual node, an unfocused comparison, and readable focused geometry' };
  const a = focused.css, b = unfocused.css, candidates = [];
  const fits = pad => geometry.rect.left - pad >= geometry.clip.left && geometry.rect.right + pad <= geometry.clip.right && geometry.rect.top - pad >= geometry.clip.top && geometry.rect.bottom + pad <= geometry.clip.bottom;
  const outline = parseFloat(a.outlineWidth);
  if (outline > 0 && !['none', 'hidden'].includes(a.outlineStyle) && !transparent(a.outlineColor) && ['outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset'].some(key => a[key] !== b[key])) candidates.push({ kind: 'changed-painted-outline', pad: Math.max(0, outline + parseFloat(a.outlineOffset || '0')) });
  if (a.boxShadow !== b.boxShadow && a.boxShadow !== 'none') for (const shadow of cssParts(a.boxShadow)) {
    const color = shadow.match(/(?:rgba?|hsla?|oklch|oklab|color)\([^)]*\)/)?.[0];
    const lengths = [...shadow.replace(/(?:rgba?|hsla?|oklch|oklab|color)\([^)]*\)/g, '').matchAll(/(-?[\d.]+)px/g)].map(match => Number(match[1]));
    if (color && !transparent(color) && lengths.length >= 2 && lengths.some(value => value !== 0)) candidates.push({ kind: 'changed-painted-shadow', pad: /inset/.test(shadow) ? 0 : Math.max(0, Math.abs(lengths[0]) + (lengths[2] ?? 0) + (lengths[3] ?? 0), Math.abs(lengths[1]) + (lengths[2] ?? 0) + (lengths[3] ?? 0)) });
  }
  if (['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(a[`border${side}Width`]) > 0 && !['none', 'hidden'].includes(a[`border${side}Style`]) && !transparent(a[`border${side}Color`]) && ['Width', 'Style', 'Color'].some(part => a[`border${side}${part}`] !== b[`border${side}${part}`]))) candidates.push({ kind: 'changed-painted-border', pad: 0 });
  return { pass: candidates.some(candidate => fits(candidate.pad)), candidates: candidates.map(candidate => ({ ...candidate, withinClip: fits(candidate.pad) })), focusVisible: focused.focusVisible, note: 'Computed visible-style candidate plus original pixels; no contrast or WCAG certification. A pseudo-state alone never passes.' };
}
function returnResult(samples, opener, { afterSave = false } = {}) {
  const end = samples.at(-1)?.elapsedMs ?? 0, tail = samples.filter(row => row.elapsedMs >= end - 250);
  const same = row => row.active && (afterSave ? row.active.tag === 'BUTTON' && row.active.recordId === opener.recordId && row.active.ariaLabel.startsWith('编辑待办 ') : row.active.node === opener.node && row.active.ariaLabel === opener.ariaLabel);
  return { pass: end >= 750 && tail.length >= 4 && tail.every(row => row.modalCount === 0 && row.modalAnimations === 0 && row.geometry?.visible && !row.active.disabled && same(row)), elapsedMs: end, final: samples.at(-1), exactOpenerAtEnd: samples.at(-1)?.active?.node === opener.node, sameRecordAtEnd: samples.at(-1)?.active?.recordId === opener.recordId, tailSamples: tail.length, contract: afterSave ? 'Stable usable edit button for the same changed ID; a remounted button is allowed' : 'Stable actual initiating edit button; a same-record noninteractive row is reported separately' };
}
export const keyboardOutcomeChecks = { profiles: PROFILES, declared: DECLARED, typed: TYPED, order: ORDER, cycleResult, indicatorResult, returnResult, nextTabResult, keyDeliveryResult };

// Read-only DOM instrumentation. Weak node identities never affect app state or
// focus; no DOM attributes, events, route, values, scrolling or CSS are changed.
export function readKeyboardSurface(extraSelectors = []) {
  const state = globalThis.__ykReadNodes ??= { nodes: new WeakMap(), next: 1 };
  const selector = el => {
    if (!el || el === document.body) return 'body'; if (el === document.documentElement) return 'html';
    const parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(other => other.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); } return 'body > ' + parts.join(' > ');
  };
  const describe = el => {
    if (!el) return null;
    if (!state.nodes.has(el)) state.nodes.set(el, state.next++);
    const style = getComputedStyle(el), css = {};
    for (const property of ['outlineWidth', 'outlineOffset', 'outlineStyle', 'outlineColor', 'boxShadow', 'backgroundColor', 'color', 'opacity', 'visibility', 'overflowX', 'overflowY', 'fontSize', 'lineHeight', ...['Top', 'Right', 'Bottom', 'Left'].flatMap(side => ['Width', 'Style', 'Color'].map(part => `border${side}${part}`))]) css[property] = style[property];
    const text = el.textContent.trim(), ariaLabel = el.getAttribute('aria-label') ?? '', labels = [...(el.labels ?? [])].map(label => label.textContent.trim());
    let key = null;
    if (el.closest('[role=dialog]')) {
      if (el.id === 'todo-text') key = 'content'; else if (el.id === 'todo-date') key = 'due-date'; else if (el.tagName === 'SELECT' && labels.some(label => label.startsWith('优先级'))) key = 'priority';
      else if (el.tagName === 'INPUT' && el.type === 'checkbox' && labels.includes('已完成')) key = 'done';
      else if (el.tagName === 'BUTTON') key = ariaLabel === '关闭' ? 'close' : ({ 今天: 'today', 明天: 'tomorrow', 无日期: 'no-date', 删除: 'delete', '取消（保留草稿）': 'cancel', 保存: 'save', '保存中…': 'saving' })[text] ?? `unknown-button:${text}`;
    }
    const ancestors = []; for (let parent = el.parentElement; parent; parent = parent.parentElement) { const c = getComputedStyle(parent); if (/(auto|scroll|hidden|clip)/.test(c.overflowX + c.overflowY) || c.transform !== 'none' || c.clipPath !== 'none' || Number(c.opacity) < 1) ancestors.push({ tag: parent.tagName, role: parent.getAttribute('role'), rect: parent.getBoundingClientRect().toJSON(), overflowX: c.overflowX, overflowY: c.overflowY, opacity: c.opacity, transform: c.transform, clipPath: c.clipPath, scrollTop: parent.scrollTop, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight }); }
    return { node: state.nodes.get(el), selector: selector(el), key, tag: el.tagName, role: el.getAttribute('role'), contentEditable: el.isContentEditable, type: el.getAttribute('type'), ariaLabel, text, labels, id: el.id, recordId: el.closest('[id^="todo-record-"]')?.id ?? null, focused: el === document.activeElement, focusVisible: el.matches(':focus-visible'), disabled: el.matches(':disabled'), inDialog: Boolean(el.closest('[role=dialog]')), tabIndex: el.tabIndex, value: 'value' in el ? el.value : null, checked: 'checked' in el ? el.checked : null, rect: el.getBoundingClientRect().toJSON(), css, ancestors, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, scrollLeft: el.scrollLeft };
  };
  const dialog = document.querySelector('[role=dialog]');
  return { monotonicMs: performance.now(), browserDate: new Date().toISOString(), viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY }, active: describe(document.activeElement), controls: [...document.querySelectorAll(['[role=dialog] button, [role=dialog] input, [role=dialog] select, main button[aria-label^="编辑待办 "]', ...extraSelectors].join(', '))].map(describe), modalCount: document.querySelectorAll('[role=dialog]').length, modalAnimations: document.getAnimations().filter(animation => { const target = animation.effect?.target; return target && (target === dialog || dialog?.contains(target) || target.contains?.(dialog)) && animation.playState === 'running'; }).length, alerts: [...document.querySelectorAll('[role=dialog] [role=alert]')].map(el => ({ selector: selector(el), text: el.textContent, role: el.getAttribute('role'), live: el.getAttribute('aria-live'), atomic: el.getAttribute('aria-atomic') })) };
}

export async function runKeyboardOutcomes(h, options = {}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native keyboard evidence runs only in authorized hosted CI');
  assert.equal(options.scenarioSet ?? 'records', 'records');
  const { isolated, login, waitPath, capture, observe, apiFor, sleep, actions, artifacts, writeFile, join, surfaceNames } = h;
  const prefix = 'YK-records', phases = new WeakMap();
  await writeFile(join(artifacts, `${prefix}-scope.json`), JSON.stringify({ applicationBaseline: BASELINE, profiles: PROFILES, declared: DECLARED, typed: TYPED, syntheticOnly: true, task: 'Native keyboard existing Todo entry, cycles, retained Escape/reopen, exact precommit refusal, released keyboard retry and return', boundaries: ['Pointer login/navigation/two-record creation is explicitly setup, not keyboard coverage', 'After the boundary: native control keys and Chromium Input.insertText; no focus, DOM click, scrollIntoView, assigned values, dispatched events, pointer rescue or manual wheel', 'Existing source/quota/clock primitives are reused; no business API writes', 'No preference authority, clear generation, publication audit or dependent read repair; no startup/connection/lifecycle experiment', '360 is a desktop browser viewport, not phone touch/OS/AT evidence', 'Computed styles and original pixels require review; no full WCAG, screen-reader announcement, reduced-motion or contrast claim', 'No deletion, reload, account switch, scheduling, stale peer or postcommit fault', 'No cause established for the older B-to-Todo initialization failure'], budgets: 'Existing 8 minute evidence step and 20 minute job unchanged' }, null, 2));
  async function saveJSON(label, value) { await writeFile(join(artifacts, `${label}.json`), JSON.stringify(value, null, 2)); }
  async function exact(page, selector, text) {
    return page.evaluate(({ selector, text }) => {
      const rows = [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (text === undefined || el.textContent.trim() === text); }); assertUnique();
      function assertUnique() { if (rows.length !== 1) throw new Error(`Expected one rendered ${selector} / ${text ?? ''}; got ${rows.length}`); }
      const parts = []; for (let node = rows[0]; node && node !== document.body; node = node.parentElement) { const peers = [...node.parentElement.children].filter(other => other.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(node) + 1})`); } return 'body > ' + parts.join(' > ');
    }, { selector, text });
  }
  async function setupTap(page, selector, text) {
    assert.equal(phases.get(page), 'setup', 'Pointer actions are prohibited after keyboard phase starts');
    const resolved = await exact(page, selector, text);
    // Same bounded native-wheel preparation used by the ordinary Todo task.
    // This remains before the explicitly recorded keyboard-only boundary.
    for (let attempt = 0; attempt < 12; attempt++) {
      const box = await page.evaluate(initialSessionGeometry, resolved); assert.equal(box.unique, true);
      if (box.visible) break;
      const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20)), deltaY = box.rect.y + box.rect.height / 2 - y;
      if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'keyboard-task-native-wheel-setup', surface: surfaceNames.get(page), selector, resolved, pointer: { x, y }, deltaY, clip: box.clip, scroller: box.scroller }); }
      await sleep(150);
    }
    assert.ok((await page.evaluate(initialSessionGeometry, resolved)).visible, 'Setup target must actually be fully readable before its single click');
    const probes = []; let point;
    try { point = await preparePreferencePointer(page, resolved, selector, text, probes); }
    finally { actions.push({ kind: 'keyboard-task-setup-preclick-observations', surface: surfaceNames.get(page), selector, text, resolved, probes }); }
    actions.push({ kind: 'keyboard-task-explicit-pointer-setup', surface: surfaceNames.get(page), selector, text, resolved }); await page.mouse.click(point.x, point.y);
  }
  async function ready(page) { await page.waitForFunction(() => { const dialog = document.querySelector('[role=dialog]'); return dialog?.querySelector('#todo-text') && !dialog.querySelector('fieldset').disabled && !/正在读取草稿|正在保留草稿/.test(dialog.innerText); }, { timeout: 7000 }); }
  async function editor(page) { return page.$eval('[role=dialog]', el => ({ text: el.querySelector('#todo-text').value, priority: el.querySelector('select').value, dueDate: el.querySelector('#todo-date').value, done: el.querySelector('fieldset input[type=checkbox]')?.checked ?? false })); }
  async function replaceText(page, text) { assert.equal(await page.$eval('#todo-text', el => el === document.activeElement && !el.matches(':disabled')), true, 'Type only into the observed enabled content field'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(text); if (phases.get(page) === 'keyboard') actions.push({ kind: 'chromium-native-text-insertion', surface: surfaceNames.get(page), method: 'Input.insertText via sendCharacter', text, limitation: 'Not per-character keydown or real IME evidence' }); }
  async function priorityKeys(page, value) {
    const index = await page.$eval('[role=dialog] select', (el, value) => { if (el !== document.activeElement || el.matches(':disabled')) throw new Error('Priority must remain the actual enabled keyboard focus'); const enabled = [...el.options].filter(option => !option.disabled && option.value === value); if (enabled.length !== 1) throw new Error('Unique enabled priority required'); return [...el.options].indexOf(enabled[0]); }, value);
    await page.keyboard.press('Home'); for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown'); if (phases.get(page) === 'keyboard') await controlKey(page, 'Tab', 'leave-selected-priority'); else await page.keyboard.press('Enter');
  }
  async function facts(page, api, label, { settle = true, extra = {} } = {}) {
    const localRead = async () => JSON.parse(await page.evaluate(readTodoSource, api.ownerId)); let local = await localRead();
    if (settle) for (let i = 0; i < 60 && local.outbox.length; i++) { await sleep(250); local = await localRead(); }
    const allEvents = []; let cursor = '0', complete = false;
    for (let i = 0; i < 20; i++) { const result = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`); assert.ok(Array.isArray(result.events)); allEvents.push(...result.events); if (!result.hasMore) { complete = true; break; } assert.notEqual(result.nextCursor, cursor); cursor = result.nextCursor; }
    assert.ok(complete, 'Full GET ledger must finish within bounded synthetic fixture');
    const server = (await api('/todos')).todos, result = { local, server, events: allEvents.filter(event => event.entity === 'todos'), allEvents };
    await saveJSON(`${label}-full-source`, { syntheticOnly: true, observedByDriverAt: new Date().toISOString(), browserClock: await page.evaluate(() => ({ instant: new Date().toISOString(), config: globalThis.__youtraceAuditClock })), ...result, ...extra });
    assert.ok(server.length <= 2 && isDeepStrictEqual([...server].sort((a, b) => a.id.localeCompare(b.id)), todo.rowsFromLedger(allEvents)), 'Exact GET rows must agree with full ledger'); return result;
  }
  function assertDraft(facts, key, typed, base) {
    const envelope = draft(facts, key), form = envelope?.value;
    assert.ok(typeof envelope?.revision === 'string' && envelope.revision.length > 0); assert.ok(typeof form?.id === 'string' && form.id.length > 0);
    assert.deepEqual(form, { id: form.id, ...typed, base }); if (base) assert.equal(form.id, base.id); return form;
  }
  async function preserved(page, before, after, label, options = {}) {
    const pass = todo.sourcesPreserved(before, after, options); await observe(page, label, pass, JSON.stringify({ options, claim: 'Complete three-table source/draft/base/version/outbox and full GET ledger; only explicitly declared draft write/ordinary pull time may differ' })); assert.ok(pass, 'Stop dependent actions if source retention fails');
  }
  async function create(page, api, declared, label) {
    const original = await facts(page, api, `${label}-before`); await setupTap(page, 'button[aria-label="新建待办"]'); await ready(page);
    await setupTap(page, '#todo-text'); await replaceText(page, declared.text); await setupTap(page, '[role=dialog] select'); await priorityKeys(page, declared.priority);
    if (declared.dueDate === '2026-10-08') await setupTap(page, '[role=dialog] button', '明天'); await ready(page); assert.deepEqual(await editor(page), declared);
    const before = await facts(page, api, `${label}-frozen`), form = assertDraft(before, 'record-draft:todo:new', declared, null);
    assert.ok(todo.sourcesPreserved(original, before, { writtenDraft: { key: 'record-draft:todo:new', value: form } }));
    await setupTap(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true, timeout: 7000 });
    const after = await facts(page, api, `${label}-created`); assert.ok(todo.createdOnlyDeclared(before, after, declared)); return { ...declared, id: form.id };
  }
  async function snapshot(page) {
    const result = await page.evaluate(readKeyboardSurface); result.geometry = await page.evaluate(initialSessionGeometry, result.active.selector); return result;
  }
  async function stable(page) {
    // Natural focus/paint/scroll stability only. Never repair clipping or focus.
    const start = Date.now(); let previous, count = 0, current;
    while (Date.now() - start < 2200) {
      current = await snapshot(page);
      const signature = JSON.stringify({ node: current.active.node, css: current.active.css, rect: Object.fromEntries(Object.entries(current.active.rect).map(([key, value]) => [key, Math.round(value * 10) / 10])), viewport: current.viewport, animations: current.modalAnimations });
      count = signature === previous ? count + 1 : 0; if (count >= 2 && current.modalAnimations === 0) return { ...current, stability: { observed: true, elapsedMs: Date.now() - start } };
      previous = signature; await sleep(55);
    }
    actions.push({ kind: 'keyboard-stability-not-established', surface: surfaceNames.get(page), current }); return { ...current, stability: { observed: false, elapsedMs: Date.now() - start } };
  }
  async function focusedEvidence(page, label, observed) {
    const current = observed ?? await stable(page); await saveJSON(`${label}-focus`, current); await capture(page, label); return current;
  }
  async function readEditor(page, label) {
    assert.deepEqual(await editor(page), TYPED);
    const readings = await Promise.all(['#todo-text', '[role=dialog] select', '#todo-date'].map(selector => page.evaluate(initialSessionGeometry, selector)));
    const values = await page.$eval('[role=dialog]', el => { const text = el.querySelector('#todo-text'); return { text: text.value, textWidth: text.clientWidth, textScrollWidth: text.scrollWidth, textScrollLeft: text.scrollLeft, priority: el.querySelector('select').selectedOptions[0]?.textContent, date: el.querySelector('#todo-date').value }; });
    const deadline = await page.evaluate(initialSessionGeometry, await exact(page, '[role=dialog] p', `实际截止日期：${TYPED.dueDate}`));
    await observe(page, `${label}-full-editor-readable`, readings.every(row => row.visible) && deadline.visible && values.textWidth >= values.textScrollWidth && values.textScrollLeft === 0 && values.priority === '高', JSON.stringify({ readings, values, deadline, note: 'Native current viewport only; no scroll/focus rescue, no claim that DOM value proves clipped text readable' }));
  }
  async function controlKey(page, key, label) {
    assert.equal(phases.get(page), 'keyboard');
    const before = await snapshot(page), startSeq = await page.evaluate(() => globalThis.__ykControlEvents.next);
    actions.push({ kind: 'keyboard-control-send-intent', surface: surfaceNames.get(page), key, label, preceding: before });
    let error;
    try {
      if (key === 'Shift+Tab') await page.keyboard.down('Shift');
      try { await page.keyboard.press(key === 'Shift+Tab' ? 'Tab' : key); }
      finally { if (key === 'Shift+Tab') await page.keyboard.up('Shift'); }
    } catch (caught) { error = caught; }
    const receipt = await page.evaluate(start => { const state = globalThis.__ykControlEvents; return { events: state.events.filter(row => row.seq >= start), dropped: state.dropped, failures: state.failures }; }, startSeq).catch(() => null);
    const result = receipt && keyDeliveryResult(before, key, receipt.events, receipt);
    actions.push({ kind: 'keyboard-control-send-result', surface: surfaceNames.get(page), key, label, sendReturned: !error, delivery: result });
    if (error) throw error;
    assert.ok(result?.pass, 'Actual trusted control keydown must reach the exact preceding focus, followed by its real keyup');
  }
  async function tab(page, reverse = false) {
    await controlKey(page, reverse ? 'Shift+Tab' : 'Tab', 'sequential-navigation'); return stable(page);
  }
  async function reach(page, predicate, label, { reverse = false, contained = false } = {}) {
    const seen = []; let current = await stable(page);
    for (let i = 0; i <= 40; i++) {
      seen.push({ node: current.active.node, key: current.active.key, tag: current.active.tag, name: current.active.ariaLabel || current.active.labels.join(' ') || current.active.text, inDialog: current.active.inDialog, geometry: current.geometry, viewport: current.viewport });
      if (predicate(current.active) && current.stability.observed && current.geometry.visible && !current.active.disabled) { await saveJSON(`${label}-tab-path`, seen); if (contained) await observe(page, `${label}-contained`, seen.every(row => row.inDialog), JSON.stringify(seen)); return current; }
      if (i < 40) current = await tab(page, reverse);
    }
    await saveJSON(`${label}-tab-path`, seen); await observe(page, `${label}-unreachable`, false, JSON.stringify(seen)); throw new Error(`Bounded real Tab navigation could not reach ${label}; no pointer/focus rescue`);
  }
  async function activate(page, current, key, label) {
    const now = await snapshot(page); assert.equal(now.active.node, current.active.node, 'Do not activate a changed/unknown active control'); assert.ok(now.geometry.visible && !now.active.disabled); assert.equal(now.active.tag, 'BUTTON');
    for (const field of ['key', 'ariaLabel', 'text', 'recordId']) assert.equal(now.active[field], current.active[field], 'Revalidate the same control semantics immediately before activation');
    await controlKey(page, key, label);
  }
  async function visibleIdentity(page, wanted, { requireVisible = true } = {}) {
    const matches = await page.evaluate(wanted => [...document.querySelectorAll('main button[aria-label^="编辑待办 "]')].filter(button => button.querySelector('p:first-child')?.textContent === wanted.text && button.querySelector('p:nth-child(2)')?.textContent.includes(` · ${wanted.dueDate} · 编辑`) && button.parentElement.querySelector('span')?.textContent === ({ low: '低优先级', medium: '中优先级', high: '高优先级' })[wanted.priority]).map(button => ({ name: button.getAttribute('aria-label'), id: button.parentElement.parentElement.id })), wanted);
    assert.equal(matches.length, 1, 'Find target by title/date/priority before ID corroboration');
    const current = await snapshot(page), control = current.controls.filter(row => row.ariaLabel === matches[0].name && row.recordId === matches[0].id); assert.equal(control.length, 1); const target = control[0];
    if (requireVisible) {
      const readings = await Promise.all([page.evaluate(initialSessionGeometry, target.selector), page.evaluate(initialSessionGeometry, `${target.selector} p:first-child`), page.evaluate(initialSessionGeometry, `${target.selector} p:nth-child(2)`), page.evaluate(initialSessionGeometry, `${target.selector} + span`)]); assert.ok(readings.every(row => row.visible), 'Actual focused row identity must be readable without manual scrolling');
    }
    assert.equal(matches[0].id, `todo-record-${wanted.id}`); return target;
  }
  async function cycles(page, label) {
    const samples = [], screenshots = new Set(); let reference = {};
    for (const direction of ['forward', 'reverse']) {
      const start = await reach(page, active => active.key === 'content', `${label}-${direction}-start`, { contained: true }); const keys = [{ key: start.active.key, node: start.active.node }]; samples.push(start); let current = start;
      for (let i = 0; i < 32; i++) {
        current = await tab(page, direction === 'reverse'); keys.push({ key: current.active.key, node: current.active.node }); samples.push(current);
        const imageKey = `${direction}-${current.active.key ?? 'outside'}-node-${current.active.node}`;
        if (!screenshots.has(imageKey)) { screenshots.add(imageKey); await focusedEvidence(page, `${label}-${imageKey}`, current); }
        if ((current.active.key === start.active.key && current.active.node === start.active.node) || !current.active.inDialog) break;
      }
      const result = cycleResult(keys, direction, reference); reference = result.nodes; await observe(page, `${label}-${direction}-meaningful-cycle`, result.pass && samples.every(row => row.stability.observed), JSON.stringify(result));
    }
    const checks = [];
    for (const sample of new Map(samples.map(row => [row.active.node, row])).values()) {
      const key = sample.active.key, focused = sample.active, unfocused = focused && samples.flatMap(row => row.controls).find(row => row.node === focused.node && !row.focused);
      checks.push({ key, focused, unfocused, geometry: sample?.geometry, result: indicatorResult(focused, unfocused, sample?.geometry) });
    }
    await saveJSON(`${label}-all-focus-observations`, samples); await saveJSON(`${label}-computed-indicators`, checks);
    await observe(page, `${label}-computed-focus-indicators-await-pixel-review`, ORDER.every(key => checks.some(row => row.key === key)) && checks.every(row => row.result.pass), JSON.stringify({ checks, note: 'All original focused pixels and full computed styles retained; this is a painted CSS/geometry candidate, pending independent pixel review. Pseudo-state alone is insufficient. Date repeats are internal browser segments.' }));
  }
  async function observeReturn(page, opener, label, perform, { afterSave = false } = {}) {
    const before = await snapshot(page), start = Date.now(), samples = [{ elapsedMs: 0, ...before }]; let closedAt; await perform();
    // At least 900 ms spans the real 250 ms Todo callback and natural close motion;
    // every sample is retained, including an initially correct but later stolen focus.
    do { const sample = await snapshot(page), elapsedMs = Date.now() - start; samples.push({ elapsedMs, ...sample }); if (sample.modalCount === 0 && sample.modalAnimations === 0) closedAt ??= elapsedMs; await sleep(35); } while (Date.now() - start < 4000 && (Date.now() - start < 900 || closedAt === undefined || Date.now() - start - closedAt < 350));
    await saveJSON(`${label}-return-trace`, { opener, samples });
    const result = returnResult(samples, opener, { afterSave }); await observe(page, `${label}-stable-usable-return`, result.pass, JSON.stringify(result));
    assert.equal(samples.at(-1).modalCount, 0, 'Editor must actually close before dependent keyboard continuation');
    await focusedEvidence(page, `${label}-actual-final-focus`); return result;
  }
  async function releaseQuota(page, label) {
    const fault = await page.evaluate(() => { globalThis.__restoreTodoFault?.(); return globalThis.__todoFault ?? null; }); await saveJSON(`${label}-fault`, fault);
    if (fault) assert.ok(fault.restored && !fault.expired && fault.restoredBy === 'explicit-harness-release', 'Safety expiry cannot count as explicit release'); return fault;
  }
  async function run(page) {
    const label = surfaceNames.get(page), clock = h.clock ?? createHabitAuditClock(); let api;
    phases.set(page, 'setup'); await page.evaluateOnNewDocument(installAuditDate, clock); actions.push({ kind: 'keyboard-task-browser-only-advancing-Date', surface: label, ...clock, serverDateUnchanged: true });
    try {
      const profile = PROFILES.find(row => row.width === page.viewport().width); await login(page, profile.phone, profile.nickname); api = await apiFor(page);
      if (profile.width === 360) { await setupTap(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more'); await setupTap(page, 'nav[aria-label="全部功能"] a[href="/todo"]'); }
      else await setupTap(page, 'aside nav button', '待办'); await waitPath(page, '/todo');
      const records = []; for (const [i, declared] of DECLARED.entries()) records.push(await create(page, api, declared, `${label}-setup-${i + 1}`));
      const original = await facts(page, api, `${label}-original-records`, { extra: { records } }); assert.ok(todo.declaredRecordsMatch(original, records));
      const target = records[0], source = original.local.todos.find(row => row.id === target.id), key = `record-draft:todo:${target.id}`;
      phases.set(page, 'keyboard'); await page.evaluate(installKeyboardControlObserver); const start = await focusedEvidence(page, `${label}-keyboard-boundary`); actions.push({ kind: 'keyboard-only-phase-start', surface: label, actualFocusFromSetup: start.active, viewport: start.viewport });
      const identity = await visibleIdentity(page, target, { requireVisible: false }), unfocusedOpener = start.controls.find(row => row.node === identity.node);
      const entered = await reach(page, active => active.tag === 'BUTTON' && active.ariaLabel === identity.ariaLabel, `${label}-enter-existing`); const opener = await visibleIdentity(page, target); assert.equal(entered.active.node, opener.node);
      await focusedEvidence(page, `${label}-actual-opener`, entered); await observe(page, `${label}-opener-visible-focus`, indicatorResult(entered.active, unfocusedOpener, entered.geometry).pass, JSON.stringify({ focused: entered.active, unfocused: unfocusedOpener, geometry: entered.geometry }));
      await activate(page, entered, 'Enter', 'open-existing-editor'); await ready(page); assert.deepEqual(await editor(page), DECLARED[0]); await focusedEvidence(page, `${label}-initial-editor-focus`);
      await cycles(page, `${label}-editor`);
      await reach(page, active => active.key === 'content', `${label}-type-content`, { contained: true }); await replaceText(page, TYPED.text);
      await reach(page, active => active.key === 'priority', `${label}-choose-priority`, { contained: true }); await priorityKeys(page, TYPED.priority);
      await reach(page, active => active.key === 'due-date', `${label}-type-date`, { contained: true }); assert.equal(await page.$eval('#todo-date', el => el === document.activeElement && !el.matches(':disabled')), true); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft'); const [year, month, day] = TYPED.dueDate.split('-'); await page.keyboard.type(month + day + year); await tab(page); await ready(page);
      assert.deepEqual(await editor(page), TYPED, 'Real segmented date/text/select keys must produce declared full input'); actions.push({ kind: 'native-keyboard-task-fields', surface: label, typed: TYPED, dateMethod: 'Observed date focus, ArrowLeft ×3, real month/day/year keys, Tab' });
      const prepared = await facts(page, api, `${label}-prepared-draft`), form = assertDraft(prepared, key, TYPED, source); await preserved(page, original, prepared, `${label}-typing-only-exact-draft`, { writtenDraft: { key, value: form } });
      await readEditor(page, `${label}-before-escape`);
      await observeReturn(page, opener, `${label}-escape`, async () => { await controlKey(page, 'Escape', 'cancel-retain-draft'); });
      await preserved(page, prepared, await facts(page, api, `${label}-escaped`), `${label}-escape-retains-full-draft-source`);
      // This is a next Tab AFTER the observed settled-return window. Esc→Tab
      // within 250 ms is untested. A row fallback remains RED after recovery.
      const beforeNext = await snapshot(page), next = await tab(page); const nextTrace = []; const nextStart = Date.now(); do { const row = await snapshot(page); nextTrace.push({ elapsedMs: Date.now() - nextStart, ...row }); await sleep(40); } while (Date.now() - nextStart < 350);
      const nextResult = nextTabResult(beforeNext, next, nextTrace);
      await saveJSON(`${label}-post-settled-return-next-tab`, nextResult); await observe(page, `${label}-settled-return-next-tab-stable`, nextResult.pass, JSON.stringify({ ...nextResult, limitation: 'Only after the full return observation window; no Esc→Tab within 250 ms claim' }));
      const reentry = await reach(page, active => active.tag === 'BUTTON' && active.ariaLabel === identity.ariaLabel, `${label}-reopen-retained`); await visibleIdentity(page, target); await activate(page, reentry, 'Space', 'reopen-retained-editor'); await ready(page); assert.deepEqual(await editor(page), TYPED);
      await preserved(page, prepared, await facts(page, api, `${label}-reopened`), `${label}-reopen-exact-envelope-source`); await readEditor(page, `${label}-reopened`); await focusedEvidence(page, `${label}-retained-editor`);
      const saveControl = await reach(page, active => active.key === 'save', `${label}-save-retained`, { contained: true }); await focusedEvidence(page, `${label}-pre-refusal-save`, saveControl);
      await page.evaluate(installTodoQuota, { owner: api.ownerId, id: target.id }); actions.push({ kind: 'keyboard-task-exact-precommit-quota', surface: label, id: target.id, method: 'put', table: 'todos', safetyDeadlineMs: 30000 });
      let first;
      try {
        await activate(page, saveControl, 'Enter', 'one-refused-save'); await page.waitForSelector('[role=dialog] [role=alert]', { timeout: 7000 }); await page.waitForFunction(() => globalThis.__todoFault.aborts || globalThis.__todoFault.commits, { timeout: 4000 }); await ready(page);
        const errorFocus = await stable(page), fault = await page.evaluate(() => globalThis.__todoFault), after = await facts(page, api, `${label}-refused`, { settle: false, extra: { fault, input: await editor(page) } });
        const precise = fault.hits.length === 1 && fault.aborts === 1 && fault.commits === 0 && !fault.expired && !fault.hits[0].originalCalled && isDeepStrictEqual(fault.hits[0].intendedValue, { ...source, ...TYPED });
        const retained = isDeepStrictEqual(await editor(page), TYPED), kept = todo.sourcesPreserved(prepared, after); await observe(page, `${label}-one-exact-refusal-no-source-change`, precise && retained && kept, JSON.stringify({ precise, retained, kept, fault })); assert.ok(precise && retained && kept); assertDraft(after, key, TYPED, source);
        const error = await page.evaluate(initialSessionGeometry, '[role=dialog] [role=alert]'), readable = error.visible && /存储.{0,12}(?:不足|已满)|空间不足|配额不足/.test(error.text) && /未保存|未能保存|保存失败/.test(error.text) && /输入.{0,10}保留/.test(error.text) && /重试|再试/.test(error.text) && !/QuotaExceededError|Synthetic/.test(error.text);
        await saveJSON(`${label}-error-focus-semantics`, { errorFocus, error, semanticOnly: 'role/aria metadata does not establish a real assistive-technology announcement' }); await observe(page, `${label}-perceivable-readable-refusal-without-rescue`, readable, JSON.stringify({ error, actualFocus: errorFocus.active, alerts: errorFocus.alerts })); await focusedEvidence(page, `${label}-original-keyboard-refusal`, errorFocus);
      } catch (error) { first = error; throw error; }
      finally { try { await releaseQuota(page, `${label}-put`); } catch (error) { if (!first) throw error; actions.push({ kind: 'keyboard-cleanup-additional-failure', first: first.message, cleanup: error.message }); } }
      assert.deepEqual(await editor(page), TYPED); const retry = await reach(page, active => active.key === 'save', `${label}-retry-save`, { contained: true }); await focusedEvidence(page, `${label}-actual-keyboard-retry`, retry);
      await observeReturn(page, reentry.active, `${label}-saved`, async () => { await activate(page, retry, 'Enter', 'one-released-current-save'); }, { afterSave: true });
      const saved = await facts(page, api, `${label}-saved`), changed = { ...target, ...TYPED }; const exactSave = todo.editedOnlyDeclared(prepared, saved, target.id, TYPED);
      await observe(page, `${label}-one-same-id-save-exact-fields-ack`, exactSave, JSON.stringify({ id: target.id, typed: TYPED, beforeVersion: todo.version(prepared, target.id), afterVersion: todo.version(saved, target.id) })); assert.ok(exactSave); assert.ok(todo.declaredRecordsMatch(saved, [changed, records[1]]));
      const finalIdentity = await visibleIdentity(page, changed, { requireVisible: false }); const finalFocus = await reach(page, active => active.tag === 'BUTTON' && active.ariaLabel === finalIdentity.ariaLabel, `${label}-final-keyboard-find`); await visibleIdentity(page, changed); await focusedEvidence(page, `${label}-final-usable-record`, finalFocus);
      await preserved(page, saved, await facts(page, api, `${label}-final-read`), `${label}-final-reading-keeps-source`);
    } catch (error) {
      await capture(page, `${label}-first-failure`).catch(() => undefined); await saveJSON(`${label}-first-failure-focus`, await snapshot(page).catch(() => null));
      if (api) await facts(page, api, `${label}-first-failure`, { settle: false, extra: { firstFailure: error.message } }).catch(async sourceError => saveJSON(`${label}-first-failure-source-unavailable`, { firstFailure: error.message, sourceFailure: sourceError.message })); throw error;
    } finally {
      await page.evaluate(() => { const state = globalThis.__ykControlEvents; if (!state) return null; state.stop(); return { events: state.events, dropped: state.dropped, failures: state.failures, stopped: state.stopped }; }).then(value => saveJSON(`${label}-control-key-events`, value)).catch(() => undefined);
      if (await page.evaluate(() => Boolean(globalThis.__todoFault && !globalThis.__todoFault.restored)).catch(() => false)) await releaseQuota(page, `${label}-final-cleanup`).catch(error => { actions.push({ kind: 'keyboard-final-cleanup-additional-failure', error: error.message }); });
    }
  }
  const media = []; for (const profile of PROFILES) { const name = `${prefix}-${profile.width}`; media.push(name); await isolated(name, { width: profile.width, height: profile.width === 360 ? 800 : 900 }, run); } return { media };
}
