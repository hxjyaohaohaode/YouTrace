// Test-only tail of the existing nine-record Expense task. No fixture, profile,
// business write API or fault is introduced. Native execution belongs to CI.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { installKeyboardControlObserver, readKeyboardSurface, keyboardOutcomeChecks as keyboard } from './audit-keyboard-outcomes.mjs';

const EXTRA = ['main button', 'main a', 'main summary'];
const title = row => `${row.isIncome ? '+' : '-'}¥${(row.amount / 100).toFixed(2)} ${row.name}`;
const identity = row => ({ date: row.date, heading: row.date, title: title(row), ariaLabel: `收支: ${title(row)}` });
const membership = rows => rows.map(({ date, heading, title, ariaLabel }) => ({ date, heading, title, ariaLabel })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const sameIdentity = (row, wanted) => Boolean(row) && ['date', 'heading', 'title', 'ariaLabel'].every(key => row[key] === identity(wanted)[key]);
const positiveLayout = rect => Number.isFinite(rect?.width) && rect.width > 0 && Number.isFinite(rect?.height) && rect.height > 0;
const renderedMember = row => positiveLayout(row.rect) && ['button', 'title', 'heading'].every(part => {
  const paint = row.paint?.[part];
  return positiveLayout(paint?.rect) && Array.isArray(paint.styles) && paint.styles.length > 0 && paint.styles.every(style => style.visibility === 'visible' &&
    Number.isFinite(Number(style.opacity)) && Number(style.opacity) >= 0.99 && style.display !== 'none' && style.contentVisibility !== 'hidden');
});
const readableAnchor = anchor => anchor?.matches === 1 && anchor.geometry?.visible === true && anchor.titleGeometry?.visible === true &&
  anchor.heading === anchor.date && anchor.dateGeometry?.visible === true && anchor.dateGeometry.text?.trim() === anchor.date;

function readinessResult(samples, path) {
  let settledAt, previous = -1, ordered = true, count = 0;
  for (const row of samples) {
    ordered &&= Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs > previous; previous = row.elapsedMs;
    const ready = row.modalCount === 0 && row.modalAnimations === 0 && row.timeline?.url?.split('?')[0] === path &&
      (path !== '/timeline' || row.timeline.present === true && row.timeline.loading === false);
    if (ready) { settledAt ??= row.elapsedMs; count++; } else { settledAt = undefined; count = 0; }
  }
  const elapsedMs = samples.at(-1)?.elapsedMs ?? 0, readyMs = settledAt === undefined ? 0 : elapsedMs - settledAt;
  return { pass: ordered && elapsedMs >= 900 && elapsedMs <= 4000 && count >= 4 && readyMs >= 350, elapsedMs, settledAt: settledAt ?? null, readyMs, readySamples: count, ordered,
    note: 'Derived from the contiguous ready suffix of original route/loader/modal-exit samples; neither focus nor membership controls the wait' };
}

function closeResult(samples, expectedURL) {
  const readiness = readinessResult(samples, '/expense'), tail = samples.filter(row => row.elapsedMs >= readiness.elapsedMs - 250);
  return { pass: readiness.pass && tail.length >= 4 && tail.every(row => row.modalCount === 0 && row.modalAnimations === 0 && row.timeline.url === expectedURL), readiness, final: samples.at(-1), tailSamples: tail.length };
}

const reentryReverse = (frozen, wanted) => frozen?.anchor?.matches === 1 && sameIdentity(frozen.anchor, wanted) &&
  frozen.active?.tag === 'BUTTON' && frozen.active.node === frozen.anchor.node;

function scopeResult(surface, values, origin) {
  const expected = membership(values.filter(row => row.date >= '2026-09-08' && row.date <= '2026-10-07').map(identity));
  const dayChanged = Boolean(origin && surface.businessDay !== origin.businessDay);
  let fixedURL = false;
  try {
    const url = new URL(surface.url, 'https://audit.invalid'), params = url.searchParams;
    fixedURL = url.origin === 'https://audit.invalid' && url.pathname === '/timeline' && url.hash === '' &&
      [...params.keys()].sort().join(',') === 'from,range,through' &&
      params.get('range') === '30' && params.get('from') === '2026-09-08' && params.get('through') === '2026-10-07';
  } catch { /* A malformed route is an observed failure, never normalized by the audit. */ }
  const valid = fixedURL && (!origin || surface.url === origin.url) && surface.range === '30' &&
    surface.businessDay === '2026-10-07' && surface.from === '2026-09-08' && surface.through === '2026-10-07' &&
    isDeepStrictEqual(surface.periodLabels, ['固定期间：2026-09-08 至 2026-10-07（含首尾）。跨日与返回时保持此期间。']) &&
    isDeepStrictEqual(surface.pressed, ['近30天']) && expected.length === 7 && surface.rows.every(renderedMember) && isDeepStrictEqual(membership(surface.rows), expected);
  return { pass: !dayChanged && valid, dayChanged, expected, actual: membership(surface.rows), interval: { businessDay: surface.businessDay, from: surface.from, through: surface.through }, note: dayChanged ? 'Business-day/interval transition: stable-scope comparison stopped; this is not a data-loss claim' : 'Actual browser business date and rendered membership, not query text alone' };
}

function draftWriteResult(before, after, id, typed, checks) {
  const key = `record-draft:expense:${id}`, source = before.local.expenses.find(row => row.id === id);
  const rows = after.local.settings.filter(row => row.key === key), envelope = rows[0]?.value;
  const form = { id, ...typed, base: source };
  const exact = Boolean(source) && !before.local.settings.some(row => row.key === key) && rows.length === 1 &&
    typeof envelope?.revision === 'string' && /^[a-f0-9]{32}$/.test(envelope.revision) &&
    isDeepStrictEqual(rows[0], { key, value: { revision: envelope.revision, value: form } });
  const stripped = { ...after, local: { ...after.local, settings: after.local.settings.filter(row => row.key !== key) } };
  return { pass: exact && checks.businessSourcesPreserved(before, stripped), exact, key, envelope, note: 'Only this exact expenseDraft.ts envelope may be added to the pre-open three-table/full-ledger freeze; all other source fields and settings remain governed by existing Expense checks' };
}

function activationResult(before, now) {
  const datedRow = !before.active?.logical && !now.active?.logical || before.active?.logical?.heading === before.active?.logical?.date &&
    now.active?.logical?.heading === now.active?.logical?.date && readableAnchor(now.anchor) && now.anchor.node === now.active.node && isDeepStrictEqual(membership([now.anchor])[0], now.active.logical);
  return { pass: before.active?.tag === 'BUTTON' && now.active?.tag === 'BUTTON' && now.active.node === before.active.node &&
    now.geometry?.visible === true && !now.active.disabled && now.active.tabIndex >= 0 &&
    ['id', 'text', 'ariaLabel'].every(key => before.active[key] === now.active[key]) && isDeepStrictEqual(before.active.logical, now.active.logical) && datedRow };
}

function returnResult(samples, origin, wanted, values) {
  const end = samples.at(-1)?.elapsedMs ?? 0, tail = samples.filter(row => row.elapsedMs >= end - 250);
  const scope = samples.map(row => scopeResult(row.timeline, values, origin.timeline));
  const usable = row => row.modalCount === 0 && row.modalAnimations === 0 && readableAnchor(row.anchor) &&
    sameIdentity(row.anchor, wanted) && row.active?.node === row.anchor.node && row.active.tag === 'BUTTON' && !row.active.disabled && row.active.tabIndex >= 0 && row.geometry?.visible === true;
  const final = samples.at(-1), readiness = readinessResult(samples, '/timeline');
  return { pass: readiness.pass && tail.length >= 4 && !scope.some(row => row.dayChanged) && tail.every((row) => usable(row) && row.active.node === final.active.node && scopeResult(row.timeline, values, origin.timeline).pass),
    dayChanged: scope.some(row => row.dayChanged), elapsedMs: end, tailSamples: tail.length, readiness, final,
    deltas: final?.anchor && origin.anchor ? { scrollY: final.viewport.scrollY - origin.viewport.scrollY, anchorTop: final.anchor.rect.top - origin.anchor.rect.top } : null,
    note: 'Natural samples frozen before recovery keys. Same logical visible row and usable focus required; a new DOM node is valid. Pixel/scroll deltas are descriptive, with no exact or 40px threshold.' };
}

export const timelineKeyboardChecks = { identity, scopeResult, draftWriteResult, activationResult, returnResult, readinessResult, closeResult, reentryReverse };

// Read-only descriptors bind visible date groups, signed money/name, and actual
// WeakMap nodes. No record IDs are read from hidden app state or used to target.
function readTimelineDescriptor(wanted) {
  const state = globalThis.__ykReadNodes, nodeId = el => { if (!state.nodes.has(el)) state.nodes.set(el, state.next++); return state.nodes.get(el); };
  const selector = el => { const parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) { const peers = [...node.parentElement.children].filter(other => other.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(node) + 1})`); } return 'body > ' + parts.join(' > '); };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const businessDay = `${parts.year}-${parts.month}-${parts.day}`, params = new URLSearchParams(location.search), range = params.get('range') ?? '7';
  const from = params.get('from'), through = params.get('through');
  const periodLabels = [...document.querySelectorAll('[data-component="timeline"] p')].map(el => el.textContent.trim()).filter(value => value.startsWith('固定期间：'));
  const paint = el => {
    if (!el) return null;
    const styles = []; for (let node = el; node; node = node.parentElement) { const css = getComputedStyle(node); styles.push({ tag: node.tagName, visibility: css.visibility, opacity: css.opacity, display: css.display, contentVisibility: css.contentVisibility }); }
    return { rect: el.getBoundingClientRect().toJSON(), styles };
  };
  const rows = [...document.querySelectorAll('[data-component="timeline"] section[aria-label] button')].map(button => {
    const group = button.closest('section[aria-label]'), heading = group.querySelector('h2'), name = button.querySelector('p');
    return { node: nodeId(button), selector: selector(button), date: group.getAttribute('aria-label'), heading: heading?.textContent.trim(), headingSelector: heading ? selector(heading) : null,
      title: name?.textContent.trim(), titleSelector: name ? selector(name) : null, ariaLabel: button.getAttribute('aria-label'), text: button.innerText, rect: button.getBoundingClientRect().toJSON(), paint: { button: paint(button), title: paint(name), heading: paint(heading) } };
  });
  const wantedTitle = `${wanted.isIncome ? '+' : '-'}¥${(wanted.amount / 100).toFixed(2)} ${wanted.name}`;
  const matches = rows.filter(row => row.date === wanted.date && row.title === wantedTitle && row.ariaLabel === `收支: ${wantedTitle}`), index = rows.indexOf(matches[0]);
  return { url: location.pathname + location.search, present: Boolean(document.querySelector('[data-component="timeline"]')), loading: Boolean(document.querySelector('[data-component="timeline"] [role="status"]')), range, businessDay, from, through, periodLabels, pressed: [...document.querySelectorAll('[data-component="timeline"] [aria-label="时间范围"] button[aria-pressed="true"]')].map(el => el.textContent.trim()), rows,
    anchor: matches.length === 1 ? { ...matches[0], matches: 1, neighbors: rows.slice(Math.max(0, index - 1), index + 2) } : { matches: matches.length } };
}

export async function runTimelineKeyboardDifference(h, { page, label, before, ids, values, facts, checks, setupTap }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Timeline native evidence runs only in authorized hosted CI');
  const { waitPath, sleep, capture, observe, actions, writeFile, join, artifacts } = h;
  const prefix = `${label}-timeline-keyboard`, saveJSON = (stage, value) => writeFile(join(artifacts, `${prefix}-${stage}.json`), JSON.stringify(value, null, 2));
  const report = (stage, pass, details) => observe(page, `${prefix}-${stage}`, pass, JSON.stringify(details));
  assert.equal(ids.length, 9); assert.ok(checks.declaredRecordsMatch(before, ids, values));
  const candidates = values.flatMap((row, index) => row.date === '2026-10-06' && row.name === 'Synthetic 同名记账' && row.amount === 1234 && row.category === 'transport' && row.isIncome === false ? [index] : []);
  assert.equal(candidates.length, 1); const index = candidates[0], wanted = values[index], id = ids[index], draftKey = `record-draft:expense:${id}`;
  const typed = { ...wanted, amount: '11.11' }, changed = { ...wanted, amount: 1111 }, changedValues = values.map((row, i) => i === index ? changed : row);
  const unfocused = new Map(); let phase = 'setup', observerInstalled = false, observedWanted = wanted;
  async function pointer(selector, text) { assert.equal(phase, 'setup', 'No pointer setup after keyboard boundary'); await setupTap(page, selector, text); }
  async function snapshot() {
    const current = await page.evaluate(readKeyboardSurface, EXTRA), timeline = await page.evaluate(readTimelineDescriptor, observedWanted);
    current.timeline = timeline; current.anchor = timeline.anchor;
    current.active.logical = timeline.rows.find(row => row.node === current.active.node) ? membership(timeline.rows.filter(row => row.node === current.active.node))[0] : null;
    current.geometry = await page.evaluate(initialSessionGeometry, current.active.selector);
    if (current.anchor.matches === 1) {
      current.anchor.geometry = await page.evaluate(initialSessionGeometry, current.anchor.selector);
      current.anchor.titleGeometry = await page.evaluate(initialSessionGeometry, current.anchor.titleSelector);
      current.anchor.dateGeometry = await page.evaluate(initialSessionGeometry, current.anchor.headingSelector);
    }
    for (const control of current.controls) if (!control.focused) unfocused.set(control.node, control);
    return current;
  }
  async function stable() {
    const start = Date.now(); let previous, count = 0, current;
    do {
      current = await snapshot(); const signature = JSON.stringify({ active: current.active.node, rect: current.active.rect, css: current.active.css, viewport: current.viewport, animations: current.modalAnimations });
      count = signature === previous ? count + 1 : 0;
      if (count >= 2 && current.modalAnimations === 0) return { ...current, stability: { observed: true } };
      previous = signature; await sleep(55);
    } while (Date.now() - start < 2200);
    return { ...current, stability: { observed: false } };
  }
  async function evidence(stage, current) { current ??= await stable(); await saveJSON(`${stage}-surface`, current); await capture(page, `${prefix}-${stage}`); return current; }
  async function controlKey(key, stage) {
    assert.equal(phase, 'keyboard'); assert.ok(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape'].includes(key));
    const preceding = await snapshot(), startSeq = await page.evaluate(() => globalThis.__ykControlEvents.next);
    actions.push({ kind: 'timeline-keyboard-control-intent', surface: label, stage, key, preceding });
    let error;
    try { if (key === 'Shift+Tab') await page.keyboard.down('Shift'); try { await page.keyboard.press(key === 'Shift+Tab' ? 'Tab' : key); } finally { if (key === 'Shift+Tab') await page.keyboard.up('Shift'); } } catch (caught) { error = caught; }
    const receipts = await page.evaluate(start => { const state = globalThis.__ykControlEvents; return { events: state.events.filter(row => row.seq >= start), dropped: state.dropped, failures: state.failures }; }, startSeq);
    const delivery = keyboard.keyDeliveryResult(preceding, key, receipts.events, receipts);
    actions.push({ kind: 'timeline-keyboard-control-result', surface: label, stage, key, sendReturned: !error, delivery });
    if (error) throw error; assert.ok(delivery.pass, 'Trusted keydown must reach preceding actual node and have an intact keyup receipt');
  }
  async function tab(reverse = false) { await controlKey(reverse ? 'Shift+Tab' : 'Tab', 'sequential-navigation'); return stable(); }
  async function reach(predicate, stage, { reverse = false, contained = false } = {}) {
    const path = []; let current = await stable();
    for (let i = 0; i <= 40; i++) {
      path.push({ active: current.active, geometry: current.geometry, viewport: current.viewport, stability: current.stability });
      if (contained && !current.active.inDialog) { await saveJSON(`${stage}-tab-path`, path); throw new Error('Natural keyboard focus escaped the Expense editor'); }
      if (predicate(current) && current.stability.observed && current.geometry.visible && !current.active.disabled) { await saveJSON(`${stage}-tab-path`, path); return current; }
      if (i < 40) current = await tab(reverse);
    }
    await saveJSON(`${stage}-tab-path`, path); await report(`${stage}-unreachable`, false, path); throw new Error('Bounded real Tab navigation could not reach the known control; no pointer/focus rescue');
  }
  async function activate(current, key, stage) { const now = await snapshot(); assert.ok(activationResult(current, now).pass, 'Revalidate actual node and visible control identity immediately before activation'); await controlKey(key, stage); }
  async function ready() { await page.waitForFunction(() => { const modal = document.querySelector('[role=dialog]'); return modal?.querySelector('#expense-amount') && !modal.querySelector('fieldset').disabled && !/正在读取草稿|正在保留草稿/.test(modal.innerText); }, { timeout: 7000 }); }
  async function editor() { return page.$eval('[role=dialog]', el => {
    const pressed = [...el.querySelectorAll('[aria-label="收支类型"] button[aria-pressed="true"]')].map(button => button.textContent.trim());
    if (pressed.length !== 1 || !['收入', '支出'].includes(pressed[0])) throw new Error('Expense form must show exactly one declared income/expense selection');
    return { name: el.querySelector('#expense-name').value, amount: el.querySelector('#expense-amount').value, date: el.querySelector('#expense-date').value, category: el.querySelector('select[aria-label="记账分类"]').value, isIncome: pressed[0] === '收入' };
  }); }
  async function preserved(original, after, stage) { const pass = checks.businessSourcesPreserved(original, after); await report(stage, pass, { settingsDifferences: checks.settingsDifferences(original, after), claim: 'Complete existing three tables, raw GET rows and full ledger retained' }); assert.ok(pass, 'Source retention failure stops dependent work'); }
  async function trace(stage, perform, expectedPath) {
    const start = Date.now(), samples = []; await perform();
    do {
      const current = await snapshot(), elapsedMs = Date.now() - start; samples.push({ elapsedMs, ...current });
      if (readinessResult(samples, expectedPath).pass) break;
      await sleep(35);
    } while (Date.now() - start < 4000);
    // Readiness is route/loading/exit-animation only, never the expected focus,
    // row membership or scroll. A wrong focus cannot extend its way to green.
    await saveJSON(`${stage}-trace`, { samples, count: samples.length, readiness: readinessResult(samples, expectedPath), maximumMs: 4000 });
    await evidence(`${stage}-natural-final`, samples.at(-1)); return samples;
  }
  async function closeEditor(current, stage) {
    const expectedURL = `/expense?record=${encodeURIComponent(id)}`;
    const samples = await trace(stage, () => activate(current, 'Enter', stage), '/expense');
    const result = closeResult(samples, expectedURL);
    await report(`${stage}-expense-close-before-explicit-return`, result.pass, { ...result, expectedURL, note: 'Natural Expense close including the 250ms callback; Cancel/Save are not assumed to navigate back' }); assert.ok(result.pass);
  }
  async function returnTimeline(stage, origin, expectedValues, expectedSource) {
    const back = await reach(row => row.active.tag === 'BUTTON' && row.active.text === '← 返回时间线', `${stage}-find-return`, { reverse: true });
    await evidence(`${stage}-return-control`, back);
    const samples = await trace(stage, () => activate(back, 'Enter', `${stage}-explicit-return`), '/timeline');
    const result = returnResult(samples, origin, observedWanted, expectedValues);
    if (result.dayChanged) { await report(`${stage}-business-interval-changed`, false, result); throw new Error('Business interval changed across midnight; stable-scope tail stopped without a data-loss claim'); }
    const finalScope = scopeResult(samples.at(-1).timeline, expectedValues, origin.timeline);
    await report(`${stage}-url-range-interval-membership`, finalScope.pass, finalScope); assert.ok(finalScope.pass, 'Wrong return scope stops dependent stable-scope assertions');
    await preserved(expectedSource, await facts(`${prefix}-${stage}-before-recovery`), `${stage}-full-source-before-recovery-keys`);
    const continuationScope = scopeResult((await snapshot()).timeline, expectedValues, origin.timeline);
    if (continuationScope.dayChanged) { await report(`${stage}-business-interval-changed-before-recovery`, false, continuationScope); throw new Error('Business day changed before recovery; stable-scope continuation stopped without a data-loss claim'); }
    assert.ok(continuationScope.pass, 'Known returned scope must remain intact before recovery keys');
    // These keys happen only after the immutable natural-return samples. The
    // next Tab supplies actual same-remounted-node unfocused CSS, never a repair
    // of the already observed return. On a RED return it starts bounded recovery.
    actions.push({ kind: 'timeline-post-natural-return-keyboard-continuation', surface: label, stage, naturalReturnCandidate: result.pass });
    const next = await tab(), nextSamples = [], nextStart = Date.now();
    do { nextSamples.push({ elapsedMs: Date.now() - nextStart, ...await snapshot() }); await sleep(40); } while (Date.now() - nextStart < 350);
    nextSamples.push({ elapsedMs: Date.now() - nextStart, ...await snapshot() });
    const indicator = keyboard.indicatorResult(result.final.active, unfocused.get(result.final.active.node), result.final.geometry);
    const naturalPass = result.pass && indicator.pass;
    await report(`${stage}-natural-logical-anchor-and-focus`, naturalPass, { ...result, indicator, note: result.note + ' Later real Tab provides only same-node unfocused CSS. Original pixels require review.' });
    const nextResult = keyboard.nextTabResult(result.final, next, nextSamples); await saveJSON(`${stage}-subsequent-tab`, nextResult);
    await report(`${stage}-subsequent-tab-stable`, nextResult.pass, nextResult);
    return { naturalPass, result, nextResult };
  }
  try {
    if (page.viewport().width === 360) { await pointer('nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more'); await pointer('nav[aria-label="全部功能"] a[href="/timeline"]'); }
    else await pointer('aside nav button', '时间线');
    await waitPath(page, '/timeline'); await page.waitForSelector('[data-component="timeline"] section button');
    await pointer('[data-component="timeline"] [aria-label="时间范围"] button', '近7天');
    phase = 'keyboard'; await page.evaluate(installKeyboardControlObserver); observerInstalled = true;
    const boundary = await evidence('boundary'); actions.push({ kind: 'timeline-keyboard-only-boundary', surface: label, actualFocus: boundary.active, viewport: boundary.viewport, keys: ['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape'], amountInput: 'Chromium Input.insertText, not physical-keyboard/IME coverage' });
    const rangeControl = await reach(row => row.active.tag === 'BUTTON' && row.active.text === '近30天', 'choose-thirty-days'); await evidence('range-control', rangeControl);
    await activate(rangeControl, 'Enter', 'choose-thirty-days'); await waitPath(page, '/timeline');
    const ranged = await stable(), rangeCheck = scopeResult(ranged.timeline, values); await report('initial-thirty-day-scope', rangeCheck.pass, rangeCheck); assert.ok(rangeCheck.pass);
    const entered = await reach(row => sameIdentity(row.active.logical, wanted), 'find-original-visible-row');
    const origin = entered;
    for (const neighbor of origin.anchor.neighbors ?? []) neighbor.geometry = await page.evaluate(initialSessionGeometry, neighbor.selector);
    await evidence('original-reading-anchor', origin);
    const originScope = scopeResult(origin.timeline, values, ranged.timeline); await report('origin-stable-business-interval', originScope.pass, originScope); assert.ok(originScope.pass, 'Stop if actual business interval changed before first open');
    assert.ok(sameIdentity(origin.anchor, wanted) && readableAnchor(origin.anchor), 'Original painted date/name/signed money must identify one readable row');
    const indicator = keyboard.indicatorResult(origin.active, unfocused.get(origin.active.node), origin.geometry);
    await report('original-row-focus-indicator', indicator.pass, { indicator, origin });
    await report('natural-scroll-coverage', origin.viewport.scrollY !== 0 ? true : null, { scrollY: origin.viewport.scrollY, note: origin.viewport.scrollY !== 0 ? 'Observed natural nonzero scroll from sequential keyboard navigation' : 'No natural nonzero scroll occurred; no scroll restoration claim is manufactured' });
    const frozen = structuredClone(await facts(`${prefix}-before-first-open`)); await preserved(before, frozen, 'setup-and-reading-preserve-source'); assert.ok(checks.declaredRecordsMatch(frozen, ids, values));
    assert.ok(!frozen.local.settings.some(row => row.key === draftKey), 'This untouched yesterday record must have no pre-existing draft');
    await activate(origin, 'Enter', 'open-original-with-enter'); await ready();
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, `/expense?record=${encodeURIComponent(id)}`, 'Only now corroborate actual route ID against declared source');
    assert.deepEqual(await editor(), { ...wanted, amount: '12.34' });
    await preserved(frozen, await facts(`${prefix}-opened-original`), 'opening-does-not-change-source');
    const amount = await reach(row => row.active.id === 'expense-amount', 'amount-field', { contained: true }); await evidence('original-amount', amount);
    assert.equal(await page.$eval('#expense-amount', el => el === document.activeElement && !el.matches(':disabled')), true);
    await page.keyboard.down('Control'); try { await page.keyboard.press('A'); } finally { await page.keyboard.up('Control'); }
    const selection = await page.$eval('#expense-amount', el => ({ focused: el === document.activeElement, value: el.value, start: el.selectionStart, end: el.selectionEnd }));
    assert.deepEqual(selection, { focused: true, value: '12.34', start: 0, end: 5 });
    await page.keyboard.sendCharacter('11.11'); actions.push({ kind: 'timeline-native-amount-insertion', surface: label, method: 'Native Control+A selection followed by Chromium Input.insertText via sendCharacter', selection, typed: '11.11', limitation: 'Not per-character keydown or real IME evidence' });
    await ready(); assert.deepEqual(await editor(), typed); await evidence('typed-amount');
    const prepared = await facts(`${prefix}-typed-draft`), draftCheck = draftWriteResult(frozen, prepared, id, typed, checks);
    await report('only-exact-full-draft-written', draftCheck.pass, draftCheck); assert.ok(draftCheck.pass, 'Typing must preserve every source except the exact declared draft envelope');
    const cancel = await reach(row => row.active.tag === 'BUTTON' && row.active.text === '取消（保留草稿）', 'cancel-retain-draft', { contained: true }); await evidence('cancel-control', cancel); await closeEditor(cancel, 'cancel');
    await preserved(prepared, await facts(`${prefix}-cancelled`), 'cancel-retains-full-envelope');
    const cancelledReturn = await returnTimeline('cancel-return', origin, values, prepared);
    await preserved(prepared, await facts(`${prefix}-returned-cancel`), 'cancel-return-retains-full-source');
    const reverse = reentryReverse(cancelledReturn.result.final, wanted);
    actions.push({ kind: 'timeline-bounded-keyboard-reentry', surface: label, originalReturnPassed: cancelledReturn.naturalPass, retainsOriginalRed: !cancelledReturn.naturalPass, direction: reverse ? 'reverse' : 'forward', reason: 'Frozen actual target-row focus means the subsequent Tab moved after that row; seek backward regardless of its painted-indicator verdict' });
    const reentry = await reach(row => sameIdentity(row.active.logical, wanted), 'recover-same-logical-row', { reverse }); await evidence('recovered-row', reentry);
    assert.ok(sameIdentity(reentry.anchor, wanted) && readableAnchor(reentry.anchor));
    await activate(reentry, 'Space', 'reopen-same-row-with-space'); await ready();
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, `/expense?record=${encodeURIComponent(id)}`); assert.deepEqual(await editor(), typed);
    await preserved(prepared, await facts(`${prefix}-reopened`), 'reopen-same-full-draft-without-retyping'); await evidence('reopened-retained-draft');
    const save = await reach(row => row.active.tag === 'BUTTON' && row.active.text === '保存', 'save-retained-once', { contained: true }); await evidence('save-control', save); await closeEditor(save, 'save');
    const saved = await facts(`${prefix}-saved`), exactSave = checks.changedOnlyTarget(frozen, saved, id, 1111) && checks.declaredRecordsMatch(saved, ids, changedValues) && !saved.local.settings.some(row => row.key === draftKey);
    await report('one-save-from-pre-open-freeze-nine-records-ack-empty-outbox', exactSave, { id, expectedAmount: 1111, expected: changedValues, settingsDifferences: checks.settingsDifferences(frozen, saved), draftConsumed: !saved.local.settings.some(row => row.key === draftKey) }); assert.ok(exactSave);
    observedWanted = changed; const savedReturn = await returnTimeline('save-return', origin, changedValues, saved);
    await preserved(saved, await facts(`${prefix}-final`), 'final-reading-preserves-saved-source');
    return { cancelledReturn: cancelledReturn.naturalPass, savedReturn: savedReturn.naturalPass, subsequentTab: savedReturn.nextResult.pass, sourcePreserved: true };
  } catch (error) {
    await evidence('first-failure').catch(() => undefined); await facts(`${prefix}-first-failure`, { settle: false, extra: { firstFailure: error.message } }).catch(sourceError => saveJSON('first-failure-source-unavailable', { firstFailure: error.message, sourceFailure: sourceError.message })); throw error;
  } finally {
    if (observerInstalled) await page.evaluate(() => { const state = globalThis.__ykControlEvents; state.stop(); return { events: state.events, dropped: state.dropped, failures: state.failures, stopped: state.stopped }; }).then(value => saveJSON('control-key-events', value));
  }
}
