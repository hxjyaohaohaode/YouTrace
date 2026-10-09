// Y5 native RED baseline. No production changes, business fixtures via API,
// app-store access, auth injection, deep links or locally launched browsers.
// Every synthetic habit and dated check-in originates in a rendered control.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { runCurrentFrequencyJourney } from './audit-habit-frequency.mjs';
import { installAuditDate, HABIT_AUDIT_INSTANT } from './audit-clock.mjs';
import { expenseOutcomeChecks } from './audit-expense-outcomes.mjs';
import { readHabitRecap } from './audit-habit-recap.mjs';

const TODAY = '2026-10-07', TUESDAY = '2026-10-06', MONDAY = '2026-10-05', SUNDAY = '2026-10-11';
// The name deliberately contains no frequency/date/status words that could
// accidentally satisfy an oracle intended to inspect the product's own copy.
const NAME = 'Synthetic 同名自主散步';
const NAME_INPUT = '[role=dialog] input[placeholder="例如：跑步 5 公里"]';
const BACKFILL_INTENT = { actor: 'Synthetic adult user', performedDate: TUESDAY, firstAppEntryDate: TODAY, cadence: 'Once per Monday–Sunday week', explanation: 'The person already took the walk on Tuesday and first enters it in the app on Wednesday. Record creation time is not automatically the activity-start date; an accepted Tuesday backfill must not silently disappear from this week’s result.' };
const dayIsDone = (rows, id, date) => rows.some(row => row.habitId === id && row.date === date && row.done === true);
const checkinVersion = (local, id, date) => local.settings.find(row => row.key === `sync-version:habitCheckins:${id}|${date}`)?.value;
const validVersion = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

export async function runHabitOutcomes(h, { frequencyOnly = false } = {}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Y5 is hosted-CI only; never retry a restricted local listener/browser');
  const { isolated, login, pointer, fill, dateInput, waitPath, capture, observe, segment, apiFor, localRows, settledRows, saveRecordEvidence, sleep, actions, artifacts, writeFile, join, surfaceNames, habitClock } = h;
  assert.equal(habitClock?.instant, HABIT_AUDIT_INSTANT, 'Wire the same explicit clock into the browser and disposable API process');
  assert.equal(habitClock?.kind, 'controlled-test-Date-v1');
  assert.ok(Number.isSafeInteger(habitClock.wallMs));
  await writeFile(join(artifacts, 'Y5-controlled-clock.json'), JSON.stringify({ ...habitClock, syntheticOnly: true, businessDate: TODAY, weekday: 'Wednesday', weekStart: MONDAY, weekEnd: SUNDAY, backfillIntent: BACKFILL_INTENT, scope: 'Advancing JavaScript Date in test browser and disposable Node API; real timers and database-engine createdAt/updatedAt are not rewritten', exclusions: ['No real-world date claim', 'No cross-midnight clock transition', 'No business/auth/state injection'] }, null, 2));

  async function closeDialogs(page) {
    for (let attempt = 0; attempt < 3 && await page.$('[role=dialog]'); attempt++) {
      await page.bringToFront(); await page.keyboard.press('Escape'); actions.push({ kind: 'native-escape-between-independent-habit-segments', surface: surfaceNames.get(page) }); await sleep(300);
    }
    assert.equal(await page.$('[role=dialog]'), null, 'A previous dialog must close through its real keyboard behavior');
  }
  async function home(page) {
    await closeDialogs(page);
    await pointer(page, page.viewport().width <= 768 ? 'nav[aria-label="主导航"] button[aria-label="首页"]' : 'aside nav button', page.viewport().width <= 768 ? undefined : '首页'); await waitPath(page, '/');
  }
  async function enter(page, firstUse = false) {
    if (new URL(page.url()).pathname !== '/') await home(page);
    const summary = '也可以直接安排任务、记账或查看其他功能';
    const collapsed = await page.$$eval('summary', (rows, text) => rows.some(el => el.textContent.trim() === text && !el.parentElement.open), summary);
    if (collapsed) await pointer(page, 'summary', summary);
    if (firstUse) await capture(page, `${surfaceNames.get(page)}-first-use-discovery`);
    await pointer(page, 'main a[aria-label="习惯"]'); await waitPath(page, '/habit');
  }
  function controlGeometry(selector, textOnly = false) {
    const rows = [...document.querySelectorAll(selector)];
    if (rows.length !== 1) return { unique: false, visible: false };
    const el = rows[0], rect = el.getBoundingClientRect(), dialog = el.closest('[role=dialog]');
    const navs = dialog ? [] : [...document.querySelectorAll('nav[aria-label="主导航"]')].map(node => node.getBoundingClientRect()).filter(box => box.width >= innerWidth / 2 && box.height > 0 && box.top > innerHeight / 2 && box.bottom >= innerHeight - 1);
    const clip = { left: 0, top: 0, right: innerWidth, bottom: Math.min(innerHeight, ...navs.map(box => box.top)) };
    let scroller = null, painted = getComputedStyle(el).visibility === 'visible' && Number(getComputedStyle(el).opacity) >= 0.99;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
      painted = painted && css.visibility === 'visible' && Number(css.opacity) >= 0.99;
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
      if (!scroller && /(auto|scroll)/.test(css.overflowY) && parent.scrollHeight > parent.clientHeight) scroller = { tag: parent.tagName, role: parent.getAttribute('role'), scrollTop: parent.scrollTop, scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight };
    }
    const hit = el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    // Toast bodies deliberately pass pointer events through. Their own visible,
    // hit-tested close button is a foreground witness, not a fabricated click.
    const dismiss = textOnly && getComputedStyle(el).pointerEvents === 'none' ? el.querySelector('button[aria-label="关闭提示"]') : null, dismissRect = dismiss?.getBoundingClientRect();
    const dismissHit = Boolean(dismissRect && dismissRect.left >= clip.left && dismissRect.right <= clip.right && dismissRect.top >= clip.top && dismissRect.bottom <= clip.bottom && dismiss.contains(document.elementFromPoint(dismissRect.x + dismissRect.width / 2, dismissRect.y + dismissRect.height / 2)));
    return { unique: true, text: el.innerText, rect: rect.toJSON(), clip, scroller, centerHit: hit, pointerTransparentToastDismissHit: dismissHit, painted,
      visible: painted && rect.top >= clip.top && rect.bottom <= clip.bottom && rect.left >= clip.left && rect.right <= clip.right && rect.width > 0 && rect.height > 0 && (hit || dismissHit) };
  }
  async function readControl(page, selector, textOnly = false) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const box = await page.evaluate(controlGeometry, selector, textOnly); assert.equal(box.unique, true);
      if (box.visible) break;
      const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8));
      const y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20));
      const delta = box.rect.y + box.rect.height / 2 - y;
      if (Math.abs(delta) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY: delta }); actions.push({ kind: 'native-wheel-read-habit', surface: surfaceNames.get(page), selector, pointer: { x, y }, clip: box.clip, scroller: box.scroller }); }
      await sleep(150);
    }
  }
  async function readable(page, selector, textOnly = false) { return page.evaluate(controlGeometry, selector, textOnly); }
  // A unique visible name remains locatable when its completion icon changes.
  // Same-name neighbors still require a surviving visible distinguishing icon.
  // Never use a record ID, remembered DOM position or app state to resolve them.
  let ambiguousCard = 0;
  async function card(page, row) {
    const candidates = await page.evaluate(({ name, icon }) => {
      const deletions = [...document.querySelectorAll('main button')].filter(el => el.getAttribute('aria-label') === `删除习惯 ${name}`);
      return deletions.map(el => el.parentElement?.parentElement).filter(el => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0).map(el => {
        const parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(sibling => sibling.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
        return { selector: 'body > ' + parts.join(' > '), text: el.innerText, hasChosenVisibleIcon: el.innerText.includes(icon), controls: [...el.querySelectorAll('button')].map(button => ({ text: button.innerText, label: button.getAttribute('aria-label') })) };
      });
    }, { name: row.name, icon: row.icon });
    const matches = candidates.length === 1 ? candidates : candidates.filter(candidate => candidate.hasChosenVisibleIcon);
    if (matches.length !== 1) {
      await observe(page, `${surfaceNames.get(page)}-same-name-visible-identity-gap-${++ambiguousCard}`, false, JSON.stringify({ expectedVisibleName: row.name, expectedVisibleIcon: row.icon, candidates, note: 'Completed controls may legitimately show a checkmark/cancel label. With same-name neighbors, lost visual identity is ambiguous; no hidden ID or remembered position is substituted.' }));
      throw new Error('Habit target is missing or visually ambiguous among same-name records; cannot safely choose a dated or delete control');
    }
    return matches[0].selector;
  }
  async function readLedger(api) {
    const events = []; let cursor = '0';
    for (let page = 0; page < 20; page++) {
      const result = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`);
      assert.ok(expenseOutcomeChecks.completeLedgerPage(result, cursor), 'Boolean completion and exact page-end cursor are required for a complete habit ledger'); events.push(...result.events);
      if (result.hasMore === false) return events;
      cursor = result.nextCursor;
    }
    throw new Error('Synthetic ledger exceeded bounded read; server evidence is incomplete');
  }
  async function facts(page, api, label, ids, extra = {}) {
    const local = await settledRows(page, api), server = (await api('/habits')).habits, events = await readLedger(api), current = new Map();
    for (const event of events.filter(event => event.entity === 'habitCheckins')) {
      if (event.operation === 'delete') current.delete(event.entityId);
      else current.set(event.entityId, { ...event.data, businessKey: event.entityId, eventSeq: event.seq });
    }
    const checkins = [...current.values()].sort((a, b) => a.businessKey.localeCompare(b.businessKey));
    const businessDateOf = value => { if (value == null) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date) : null; };
    const creationChronology = server.filter(row => !ids.length || ids.includes(row.id)).map(row => {
      const localRow = local.habits.find(item => item.id === row.id), localCreatedDate = businessDateOf(localRow?.createdAt), serverCreatedDate = businessDateOf(row.createdAt);
      return { id: row.id, localCreatedAt: localRow?.createdAt ?? null, serverCreatedAt: row.createdAt ?? null, localCreatedBusinessDate: localCreatedDate, serverCreatedBusinessDate: serverCreatedDate, performedDate: TUESDAY, controlledAppEntryDate: TODAY, tuesdayPredatesThisLocalRow: localCreatedDate === null ? null : TUESDAY < localCreatedDate, tuesdayPredatesThisServerRow: serverCreatedDate === null ? null : TUESDAY < serverCreatedDate, timestampCaveat: 'Prisma/SQLite audit timestamps use the real database-engine clock and may be Monday while controlled browser/API Date is Wednesday. Do not claim Tuesday predates either row unless these actual values establish it. Record createdAt does not establish activity-start.' };
    });
    await saveRecordEvidence(label, local, { habits: server }, { habits: ids }, { ...extra, controlledClock: habitClock, backfillIntent: BACKFILL_INTENT, creationChronology, localCheckins: local.habitCheckins, serverCheckinsFromReadOnlyChangeLedger: checkins, serverHabitAndCheckinEvents: events.filter(row => ['habits', 'habitCheckins'].includes(row.entity)) });
    return { local, server, checkins, events };
  }
  async function verifyClock(page, api, label) {
    const browser = await page.evaluate(() => ({ fixture: globalThis.__youtraceAuditClock, now: new Date().toISOString(), businessDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), weekday: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'long' }).format(new Date()) }));
    const brief = (await api('/coach/brief')).brief;
    await writeFile(join(artifacts, `${label}-clock-observed.json`), JSON.stringify({ browser, serverGeneratedAt: brief?.generatedAt, serverBusinessDate: brief?.date }, null, 2));
    assert.deepEqual(browser.fixture, habitClock); assert.equal(browser.businessDate, TODAY); assert.equal(browser.weekday, 'Wednesday');
    assert.equal(brief?.date, '10月7日 周三', 'Server business date must match the browser before any Y5 business action');
    assert.ok(Math.abs(Date.parse(browser.now) - Date.parse(brief.generatedAt)) < 15000, 'Browser/server advancing clocks must align');
    await observe(page, `${label}-controlled-wednesday-verified`, true, 'Explicit test-only Wednesday clock observed in browser Date and actual HTTP server-generated brief; this is not the current real-world date');
  }
  async function create(page, api, label, icon) {
    await closeDialogs(page); const before = (await api('/habits')).habits;
    await pointer(page, 'button[aria-label="新建习惯"]'); await fill(page, NAME_INPUT, NAME); await pointer(page, `[role=dialog] button[aria-label="图标 ${icon}"]`); await pointer(page, '[role=group][aria-label="选择频率"] button', '每周');
    const form = await page.$eval('[role=dialog]', el => ({ text: el.innerText, frequency: [...el.querySelectorAll('[aria-label="选择频率"] button')].map(b => ({ text: b.textContent.trim(), selected: b.getAttribute('aria-pressed') })) }));
    await observe(page, `${label}-explicit-weekly-once-choice`, /每周\s*(?:1|一)\s*次|一周\s*(?:1|一)\s*次/.test(form.text) && form.frequency.some(row => row.selected === 'true' && /每周/.test(row.text)), JSON.stringify({ userIntent: 'Once during this Monday–Sunday week, with no daily obligation', actualForm: form, interpretation: 'A bare weekly label is not an explicit once-per-week contract; do not silently upgrade its meaning' }));
    await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const result = await facts(page, api, `${label}-creation`, []), rows = result.server.filter(row => !before.some(old => old.id === row.id));
    assert.equal(rows.length, 1); const row = rows[0]; assert.equal(row.name, NAME); assert.equal(row.icon, icon); assert.equal(row.frequency, 'weekly');
    await saveRecordEvidence(`${label}-creation-exact-id`, result.local, { habits: result.server }, { habits: [row.id] });
    await observe(page, `${label}-native-created-weekly-cloud-ack`, result.local.outbox.length === 0 && result.local.habits.some(item => item.id === row.id && item.frequency === 'weekly'), 'The actual form saved one weekly habit with a same-ID server ACK; frequency understanding remains independently RED when absent'); return row;
  }
  async function setDay(page, row, date, done, keyboard = false) {
    const root = await card(page, row), selector = `${root} button[aria-label^="${date} "]`;
    assert.equal(await page.$$eval(selector, rows => rows.length), 1, 'Exact dated check-in must be discoverable through rendered controls');
    assert.equal(await page.$eval(selector, el => el.getAttribute('aria-pressed')), String(!done), 'Do not silently turn a retry into an unintended toggle');
    await readControl(page, selector);
    if (keyboard) {
      // Focus through a native click on the already-known card's inert name,
      // then Tab through actual controls. No evaluate().focus().
      await pointer(page, `${root} p`, row.name);
      let reached = false;
      for (let step = 0; step < 30; step++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate(selector => document.activeElement === document.querySelector(selector), selector)) { reached = true; break; }
      }
      assert.ok(reached, 'Selected date must be reachable in normal keyboard order'); await capture(page, `${surfaceNames.get(page)}-selected-date-keyboard-focus`); await page.keyboard.press('Enter'); actions.push({ kind: 'native-keyboard-enter-exact-habit-date', date, habitId: row.id, surface: surfaceNames.get(page) });
    } else await pointer(page, selector);
    await page.waitForFunction(({ selector, done }) => document.querySelector(selector)?.getAttribute('aria-pressed') === String(done), {}, { selector, done });
  }
  async function inspectWeekly(page, row, label) {
    const root = await card(page, row); await readControl(page, root); const reading = await readable(page, root);
    const controls = await page.$$eval(`${root} button`, rows => rows.map(el => ({ text: el.innerText, label: el.getAttribute('aria-label'), title: el.title, pressed: el.getAttribute('aria-pressed'), box: el.getBoundingClientRect().toJSON() })));
    const weekBoundaries = /(?:2026[-/]0?10[-/]0?5|10月5日|10\/5|10\.5)/.test(reading.text) && /(?:2026[-/]0?10[-/]11|10月11日|10\/11|10\.11)/.test(reading.text);
    const performedDate = /2026[-/]10[-/]0?6|10月6日|10\/0?6|10\.0?6/.test(reading.text);
    const weeklySatisfied = /本周[^\n]*(?:已完成|已打卡|完成\s*1\s*\/\s*1|1\s*\/\s*1)|(?:已完成|已打卡)[^\n]*本周/.test(reading.text);
    await observe(page, `${label}-readable-week-boundaries-and-performed-day`, reading.visible && weekBoundaries && performedDate, JSON.stringify({ intendedWeek: [MONDAY, SUNDAY], performed: TUESDAY, reading, controls, note: 'Accessible labels/title tooltips are retained as evidence but cannot stand in for a readable visual week and performed date' }));
    await observe(page, `${label}-weekly-satisfied-with-today-unmarked`, weeklySatisfied && controls.some(row => row.label?.startsWith(`${TODAY} `) && row.pressed === 'false'), JSON.stringify({ weeklySatisfied, reading, expected: 'This week satisfied; today has no check-in' }));
    return { reading, weeklySatisfied };
  }
  async function homeAgreement(page, row, label, habitResult) {
    await home(page);
    const candidates = await page.$$eval('main [data-component="home-overview"] button', rows => rows.filter(el => ['本周习惯', '习惯打卡', '今日习惯'].includes(el.querySelector('[data-overview-label]')?.textContent.trim())).map(el => el.textContent.trim())); assert.equal(candidates.length, 1, 'One real Home habit overview must be identifiable');
    const selector = await page.evaluate(text => {
      const el = [...document.querySelectorAll('main [data-component="home-overview"] button')].find(el => el.textContent.trim() === text), parts = [];
      for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(sibling => sibling.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
      return 'body > ' + parts.join(' > ');
    }, candidates[0]);
    await readControl(page, selector); const reading = await readable(page, selector); await capture(page, `${label}-home-weekly-overview`);
    const fields = {};
    for (const key of ['label', 'value', 'detail']) { const target = `${selector} [data-overview-${key}]`; await readControl(page, target); fields[key] = await readable(page, target); }
    const text = candidates[0], satisfied = fields.label.text.trim() === '本周习惯' && /^1\s*\/\s*1$/.test(fields.value.text.trim()) && fields.detail.text.includes('本周已全部打卡');
    await observe(page, `${label}-home-agrees-with-weekly-evidence`, reading.visible && Object.values(fields).every(field => field.visible) && satisfied && habitResult.weeklySatisfied, JSON.stringify({ exactHabitId: row.id, homeText: text, homeReading: reading, fields, habitText: habitResult.reading.text, expected: 'One accepted Tuesday completion satisfies this week on both surfaces while Wednesday remains unmarked' }));
    await pointer(page, selector); await waitPath(page, '/habit');
  }
  async function inspectFutureHistoryDiagnostic(page, api, target, label) {
    // Keep the original assertions below intact. A declared immediate-only
    // editor must never be submitted for an explicitly future-only intention.
    await closeDialogs(page); const root = await card(page, target);
    const choices = await page.$$eval(`${root} button, ${root} a`, rows => rows.filter(el => /编辑|修改|更改频率|调整频率/.test((el.getAttribute('aria-label') ?? '') + el.textContent)).map(el => ({ tag: el.tagName.toLowerCase(), label: el.getAttribute('aria-label'), text: el.textContent.trim() })));
    if (choices.length > 1) { await observe(page, `${label}-future-rule-entry-ambiguous`, false, 'Multiple visible edit entries require review; no future-only intent is submitted by guessing.'); return; }
    if (choices.length === 1) {
      const choice = choices[0]; await pointer(page, choice.label ? `${root} ${choice.tag}[aria-label=${JSON.stringify(choice.label)}]` : `${root} ${choice.tag}`, choice.label ? undefined : choice.text);
      await page.waitForSelector('[role=dialog]'); const policy = await page.$eval('[role=dialog]', el => el.innerText);
      if (/不支持[^。\n]*(?:未来|历次|规则回溯)/.test(policy)) {
        const before = await facts(page, api, `${label}-unsupported-future-rule-before-cancel`, [target.id]);
        if (await page.$('[role=dialog] [aria-label="频率调整范围说明"]')) await readControl(page, '[role=dialog] [aria-label="频率调整范围说明"]');
        await observe(page, `${label}-future-effective-history-explicitly-unsupported`, false, JSON.stringify({ policy, note: 'Future-only intent cannot be submitted into an explicitly immediate-only editor. This remains RED/unsupported; no Save is attempted.' }));
        await pointer(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true });
        const after = await facts(page, api, `${label}-unsupported-future-rule-after-cancel`, [target.id]);
        assert.ok(preserved(before, after), 'Stopping unsupported intent must leave the current rule and facts untouched');
        return;
      }
      await pointer(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true });
    }
    await inspectFrequencyEdit(page, api, target, label);
  }
  async function inspectFrequencyEdit(page, api, target, label) {
    await closeDialogs(page); const root = await card(page, target); await readControl(page, root);
    const choices = await page.$$eval(`${root} button, ${root} a`, rows => rows.filter(el => /编辑|修改|更改频率|调整频率/.test((el.getAttribute('aria-label') ?? '') + el.textContent)).map(el => ({ tag: el.tagName.toLowerCase(), label: el.getAttribute('aria-label'), text: el.textContent.trim() })));
    await observe(page, `${label}-frequency-edit-discoverability`, choices.length ? null : false, JSON.stringify({ actualChoices: choices, task: 'Change the future frequency while keeping already recorded dates; an absent editor is a genuine gap, never an API PATCH workaround' }));
    if (!choices.length) return;
    assert.equal(choices.length, 1, 'Ambiguous edit exits require investigation rather than guessing');
    const choice = choices[0]; await pointer(page, choice.label ? `${root} ${choice.tag}[aria-label=${JSON.stringify(choice.label)}]` : `${root} ${choice.tag}`, choice.label ? undefined : choice.text); await page.waitForSelector('[role=dialog]');
    const before = await facts(page, api, `${label}-frequency-before`, [target.id]), text = await page.$eval('[role=dialog]', el => el.innerText), hasChoice = await page.$$eval('[role=dialog] [aria-label="选择频率"] button', rows => rows.some(el => el.textContent.trim() === '每天'));
    const effectiveExplained = /生效|从.*(?:开始|起)|仅.*(?:以后|之后|未来)/.test(text) && /历史|过去|已有|已记录/.test(text);
    await observe(page, `${label}-frequency-effective-range-copy-present`, hasChoice && effectiveExplained ? null : false, JSON.stringify({ dialogText: text, scope: 'Copy inspection only; does not establish that the promised effective range or past weekly aggregates are honored', requirement: 'A visible effective range and historical-record policy precede saving; no silent retroactive reinterpretation' }));
    if (!hasChoice || !effectiveExplained) { await closeDialogs(page); return; }
    await pointer(page, '[role=dialog] [aria-label="选择频率"] button', '每天');
    const dates = await page.$$eval('[role=dialog] input[type=date]', rows => rows.map(el => ({ id: el.id, label: el.labels?.[0]?.innerText, value: el.value })));
    const effective = dates.filter(row => /生效|开始/.test(row.label ?? ''));
    if (effective.length === 1 && effective[0].id) await dateInput(page, `[id=${JSON.stringify(effective[0].id)}]`, TODAY);
    else if (dates.length) throw new Error('Cannot identify an honest frequency effective-date control without guessing');
    await capture(page, `${label}-frequency-before-save`); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const after = await facts(page, api, `${label}-frequency-after`, [target.id]);
    await observe(page, `${label}-frequency-same-id-raw-checkins-retained`, after.local.outbox.length === 0 && after.server.find(row => row.id === target.id)?.frequency === 'daily' && isDeepStrictEqual(before.checkins, after.checkins), 'Narrow storage result only: the same ID now has daily frequency and unchanged raw check-ins. This does not prove future-only scope or historical weekly totals');
    await segment(page, `${label}-frequency-effective-scope-and-past-aggregate-unverified`, async () => { throw new Error('Frequency-change coverage remains PARTIAL: the actual editor and raw records were inspected, but canonical effective-period semantics and the past weekly aggregate have not been demonstrated through the UI. Do not count the whole task as passed.'); });
  }
  async function visibleInputs(page) { return page.$$eval('input,textarea,select', rows => rows.filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height; }).map(el => ({ tag: el.tagName, label: el.getAttribute('aria-label') ?? el.labels?.[0]?.textContent, value: el.value }))); }
  async function deleteDialog(page, target) {
    const root = await card(page, target); await pointer(page, `${root} button[aria-label=${JSON.stringify(`删除习惯 ${target.name}`)}]`); await page.waitForSelector('[role=dialog]');
    assert.equal(await page.$eval('[role=dialog] h3', el => el.textContent), '确认删除');
  }
  function preserved(before, after) {
    return isDeepStrictEqual(before.local.habits, after.local.habits) && isDeepStrictEqual(before.local.habitCheckins, after.local.habitCheckins) && isDeepStrictEqual(before.local.outbox, after.local.outbox) && isDeepStrictEqual(before.server, after.server) && isDeepStrictEqual(before.checkins, after.checkins);
  }
  function failureRegionSnapshot() {
    return [...document.querySelectorAll('[role=alert], [role=status], [aria-label="通知"] [aria-live] > *')].map(node => ({ node, text: node.innerText.trim() }));
  }
  function newlyProducedFailure(before) {
    const candidates = [...document.querySelectorAll('[role=alert], [role=status], [aria-label="通知"] [aria-live] > *')].filter(node => {
      const text = node.innerText.trim(), rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && /删除|空间|存储|配额|QuotaExceeded|版本|其他位置更新/i.test(text) && /失败|不足|无法|不能|重试|再试|未|更新|QuotaExceeded/i.test(text) && !before.some(old => old.node === node && old.text === text);
    });
    if (!candidates.length) return false;
    return candidates.map(node => {
      const parts = []; for (let el = node; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(sibling => sibling.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
      return { selector: 'body > ' + parts.join(' > '), text: node.innerText.trim(), dialogTitle: node.closest('[role=dialog]')?.querySelector('h3')?.textContent ?? null };
    });
  }
  async function failureMessage(page, before, label) {
    const handle = await page.waitForFunction(newlyProducedFailure, { timeout: 7000 }, before);
    let regions; try { regions = await handle.jsonValue(); } finally { await handle.dispose(); }
    await capture(page, `${label}-new-failure-transition`);
    assert.equal(regions.length, 1, 'Multiple new deletion/storage failure regions require inspection, not broad-body text matching');
    const region = regions[0];
    if (region.dialogTitle !== '确认删除') await page.waitForFunction(() => ![...document.querySelectorAll('[role=dialog]')].some(dialog => dialog.querySelector('h3')?.textContent === '确认删除'), { timeout: 2500 });
    await readControl(page, region.selector, true); const reading = await readable(page, region.selector, true);
    assert.equal(reading.text.trim(), region.text, 'Read the actual new failure message while it still exists');
    const evidence = await capture(page, `${label}-new-failure-readable-state`);
    const retries = await page.$$eval(`${region.selector} button, ${region.selector} a`, rows => rows.filter(el => /^(重试|重新删除|再次删除|重试删除|再试一次)$/.test(el.textContent.trim()) && !el.disabled).map(el => ({ tag: el.tagName.toLowerCase(), text: el.textContent.trim(), label: el.getAttribute('aria-label') })));
    return { region, reading, retries, screenshot: evidence.screenshot, snapshot: evidence.snapshot };
  }
  async function reloadedSource(page, api, target, neighbor, label) {
    await closeDialogs(page); const before = await facts(page, api, `${label}-before-reload`, [target.id, neighbor.id]); assert.equal(before.local.outbox.length, 0);
    await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-fully-synced-habit', habitId: target.id, surface: surfaceNames.get(page) }); await waitPath(page, '/habit'); await page.waitForSelector('button[aria-label="新建习惯"]');
    const after = await facts(page, api, `${label}-normal-reloaded-source`, [target.id, neighbor.id]); const local = after.local.habits.find(row => row.id === target.id), server = after.server.find(row => row.id === target.id);
    assert.ok(local && server); assert.equal(after.local.outbox.length, 0); assert.ok(server.updatedAt != null, 'Server observation must retain its own canonical audit fields; no local field is manufactured');
    await observe(page, `${label}-normal-synced-source-shape-retained`, true, JSON.stringify({ exactId: target.id, localUpdatedAt: local.updatedAt, serverUpdatedAt: server.updatedAt, fields: Object.keys(local), note: 'This is the complete naturally observed local source after normal ACK/reload. A local timestamp is not asserted to be server-hydrated; same-ACK pull may retain local audit timestamps. The server-added-field CAS is separately covered by a module test. No fields were removed or manufactured.' })); return after;
  }
  async function deletion(page, api, target, neighbor, label) {
    let recoveryRetry = null;
    await segment(page, `${label}-cancel-delete`, async () => {
      const before = await reloadedSource(page, api, target, neighbor, `${label}-cancel`), inputs = await visibleInputs(page); await deleteDialog(page, target); await capture(page, `${label}-delete-confirmation-target-scope`); await pointer(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true });
      const after = await facts(page, api, `${label}-cancelled-delete`, [target.id, neighbor.id]);
      await observe(page, `${label}-cancel-keeps-source-checkins-inputs-neighbor`, preserved(before, after) && isDeepStrictEqual(inputs, await visibleInputs(page)), JSON.stringify({ target: target.id, neighbor: neighbor.id, visibleInputsBefore: inputs, note: inputs.length ? 'Actual visible inputs compared' : 'No editable habit inputs exist here; this does not claim an absent editor draft was preserved' }));
    });
    await segment(page, `${label}-actual-quota-delete-recovery`, async () => {
      const before = await reloadedSource(page, api, target, neighbor, `${label}-quota`), inputs = await visibleInputs(page);
      await page.evaluate(({ owner, id }) => {
        const original = IDBObjectStore.prototype.delete; let timer;
        window.__habitDeleteFault = { owner, id, hits: [], expired: false, restoredAt: null, restoredBy: null, restored: false };
        window.__restoreHabitDelete = (reason = 'explicit-harness-release') => { clearTimeout(timer); IDBObjectStore.prototype.delete = original; window.__habitDeleteFault.restoredAt ??= Date.now(); window.__habitDeleteFault.restoredBy ??= reason; window.__habitDeleteFault.restored = IDBObjectStore.prototype.delete === original; };
        timer = setTimeout(() => { window.__habitDeleteFault.expired = true; window.__restoreHabitDelete('safety-timeout'); }, 30000);
        IDBObjectStore.prototype.delete = function(key) { if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'habits' && this.transaction.mode === 'readwrite' && key === id) { window.__habitDeleteFault.hits.push({ at: Date.now(), key, database: this.transaction.db.name }); throw new DOMException('Synthetic exact-habit deletion quota', 'QuotaExceededError'); } return original.call(this, key); };
      }, { owner: api.ownerId, id: target.id });
      actions.push({ kind: 'test-only-IDB-delete-quota', habitId: target.id, scope: 'Exact account DB and exact habit key; transaction rollback must also preserve its check-ins' });
      let fault;
      try {
        await deleteDialog(page, target); const priorFailureRegions = await page.evaluateHandle(failureRegionSnapshot); let message;
        try { await pointer(page, '[role=dialog] button', '删除'); message = await failureMessage(page, priorFailureRegions, label); }
        finally { await priorFailureRegions.dispose(); }
        fault = await page.evaluate(() => window.__habitDeleteFault); const after = await facts(page, api, `${label}-quota-attempt-state`, [target.id, neighbor.id], { fault });
        await observe(page, `${label}-quota-was-actually-reached`, fault.hits.length > 0 && fault.expired === false, JSON.stringify({ fault, faultNotReached: fault.hits.length === 0, note: 'If CAS refuses before IndexedDB delete, quota was NOT exercised. Keep RED; never remove updatedAt, reseed an unsynced record or change app state to reach the injected fault' }));
        await observe(page, `${label}-failed-delete-source-checkins-inputs-neighbor-preserved`, preserved(before, after) && isDeepStrictEqual(inputs, await visibleInputs(page)), 'Whole source/check-in/outbox snapshots and same-name neighbor must be unchanged even after the attempted deletion');
        const text = message.region.text;
        await observe(page, `${label}-quota-visible-cause-and-retry-explained`, fault.hits.length > 0 && fault.expired === false && message.reading.visible && /(?:存储)?空间不足|存储[^。\n]*(?:不足|已满)|配额|quota/i.test(text) && /重试|再试/.test(text), JSON.stringify({ newFailureRegion: message, note: 'Only the newly produced deletion/storage message is evaluated, after actual confirmation exit when outside that dialog. Unrelated page copy cannot satisfy this assertion.' }));
        if (fault.hits.length > 0 && fault.expired === false && message.retries.length === 1) { const retry = message.retries[0]; recoveryRetry = { selector: retry.label ? `${message.region.selector} ${retry.tag}[aria-label=${JSON.stringify(retry.label)}]` : `${message.region.selector} ${retry.tag}`, text: retry.label ? undefined : retry.text, observedMessage: text }; }
      } finally {
        const diagnostic = await page.evaluate(() => { window.__restoreHabitDelete(); return window.__habitDeleteFault; }); await writeFile(join(artifacts, `${label}-delete-fault.json`), JSON.stringify(diagnostic, null, 2)); actions.push({ kind: 'restore-test-IDB-delete', habitId: target.id, restoredBy: diagnostic.restoredBy });
        await observe(page, `${label}-quota-injection-explicitly-released`, diagnostic.expired === false && diagnostic.restored && diagnostic.restoredBy === 'explicit-harness-release' && diagnostic.restoredAt != null, JSON.stringify(diagnostic));
      }
    });
    await segment(page, `${label}-actual-successful-delete-exact-id`, async () => {
      let before;
      const retryPresent = recoveryRetry && await page.$$eval(recoveryRetry.selector, (rows, text) => rows.filter(el => { const r = el.getBoundingClientRect(); return (!text || el.textContent.trim() === text) && r.width > 0 && r.height > 0 && !el.disabled; }).length, recoveryRetry.text) === 1;
      if (retryPresent) {
        before = await facts(page, api, `${label}-before-visible-retry`, [target.id, neighbor.id]); assert.equal(before.local.outbox.length, 0); assert.ok(before.local.habits.find(row => row.id === target.id));
        await pointer(page, recoveryRetry.selector, recoveryRetry.text); actions.push({ kind: 'native-failure-region-delete-retry', habitId: target.id, ...recoveryRetry });
        if (await page.$$eval('[role=dialog] h3', rows => rows.some(el => el.textContent === '确认删除'))) await pointer(page, '[role=dialog] button', '删除');
      } else {
        actions.push({ kind: 'native-delete-retry-through-normal-control', habitId: target.id, explicitFailureRetryAvailable: false, reason: recoveryRetry ? 'Previously observed retry is no longer rendered; do not pretend it was operated' : 'Failure region offers no identifiable retry action' });
        before = await reloadedSource(page, api, target, neighbor, `${label}-success`); await deleteDialog(page, target); await pointer(page, '[role=dialog] button', '删除');
      }
      await sleep(500);
      const after = await facts(page, api, `${label}-delete-without-fault`, [target.id, neighbor.id]), removed = !after.local.habits.some(row => row.id === target.id) && !after.server.some(row => row.id === target.id), targetCheckinsGone = !after.local.habitCheckins.some(row => row.habitId === target.id) && !after.checkins.some(row => row.habitId === target.id), neighborUnchanged = isDeepStrictEqual(before.local.habits.find(row => row.id === neighbor.id), after.local.habits.find(row => row.id === neighbor.id)) && isDeepStrictEqual(before.server.find(row => row.id === neighbor.id), after.server.find(row => row.id === neighbor.id)) && isDeepStrictEqual(before.local.habitCheckins.filter(row => row.habitId === neighbor.id), after.local.habitCheckins.filter(row => row.habitId === neighbor.id)) && isDeepStrictEqual(before.checkins.filter(row => row.habitId === neighbor.id), after.checkins.filter(row => row.habitId === neighbor.id));
      const tombstone = after.events.some(row => row.entity === 'habits' && row.entityId === target.id && row.operation === 'delete');
      await observe(page, `${label}-successful-delete-same-id-cloud-and-neighbor`, removed && targetCheckinsGone && neighborUnchanged && tombstone && after.local.outbox.length === 0, JSON.stringify({ removed, targetCheckinsGone, neighborUnchanged, tombstone, outbox: after.local.outbox.length, target: target.id, neighbor: neighbor.id, note: 'A visible error with the row retained is a RED deletion task, not a success or an artificial quota result' }));
      if (removed) {
        await closeDialogs(page); await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-after-successful-habit-delete', habitId: target.id });
        const reloaded = await facts(page, api, `${label}-deleted-after-reload`, [target.id, neighbor.id]);
        await observe(page, `${label}-successful-delete-survives-reload`, !reloaded.local.habits.some(row => row.id === target.id) && !reloaded.local.habitCheckins.some(row => row.habitId === target.id) && reloaded.server.some(row => row.id === neighbor.id), 'Deletion remains absent after real reload, while the intended same-name neighbor remains');
      }
    });
  }
  async function run(page) {
    const narrow = page.viewport().width === 360, label = frequencyOnly ? (narrow ? 'Y5BN' : 'Y5B') : (narrow ? 'Y5N' : 'Y5');
    await page.evaluateOnNewDocument(installAuditDate, habitClock); actions.push({ kind: 'explicit-controlled-browser-Date', surface: surfaceNames.get(page), ...habitClock });
    await login(page, narrow ? '13900008842' : '13900008841', `Synthetic ${label}`); const api = await apiFor(page); await verifyClock(page, api, label); await enter(page, true);
    let target, neighbor;
    if (frequencyOnly) {
      target = await create(page, api, `${label}-target`, '🏃'); await setDay(page, target, TUESDAY, true);
      neighbor = await create(page, api, `${label}-neighbor`, '📚'); await setDay(page, neighbor, MONDAY, true);
      await facts(page, api, `${label}-native-prerequisites`, [target.id, neighbor.id]);
      await runCurrentFrequencyJourney(page, api, target, neighbor, label, { card, facts, preserved, pointer, readControl, readable, capture, observe, segment, actions, writeFile, join, artifacts, home, enter, closeDialogs, sleep });
      return;
    }
    await segment(page, `${label}-first-use-create-weekly-once`, async () => { target = await create(page, api, `${label}-target`, '🏃'); });
    await segment(page, `${label}-backfill-tuesday-and-compare-home`, async () => {
      assert.ok(target, 'Native habit creation is a prerequisite'); await facts(page, api, `${label}-before-tuesday-backfill-actual-creation-chronology`, [target.id]); actions.push({ kind: 'explicit-user-backfill-intent', habitId: target.id, ...BACKFILL_INTENT }); await setDay(page, target, TUESDAY, true);
      const result = await facts(page, api, `${label}-tuesday-backfill`, [target.id]);
      await observe(page, `${label}-only-actual-tuesday-recorded`, result.local.outbox.length === 0 && dayIsDone(result.local.habitCheckins, target.id, TUESDAY) && dayIsDone(result.checkins, target.id, TUESDAY) && !dayIsDone(result.local.habitCheckins, target.id, TODAY) && !dayIsDone(result.checkins, target.id, TODAY), 'Native Tuesday backfill reaches the real server while Wednesday remains unmarked; no inferred daily check-in');
      const habit = await inspectWeekly(page, target, label); await homeAgreement(page, target, label, habit);
    });
    let neighborFacts, undoFacts, recorded, recapSafe = false;
    await segment(page, `${label}-same-name-neighbor-create`, async () => { if (new URL(page.url()).pathname !== '/habit') await enter(page); neighbor = await create(page, api, `${label}-neighbor`, '📚'); await setDay(page, neighbor, MONDAY, true); neighborFacts = await facts(page, api, `${label}-neighbor-monday`, [neighbor.id]); });
    await segment(page, `${label}-yesterday-habit-recorded`, async () => {
      assert.ok(target && neighbor && neighborFacts, 'Original parent/pair ACKs must precede the recap');
      recorded = await readHabitRecap(h, { page, api, target, neighbor, label, phase: 'recorded', originalFacts: neighborFacts, facts, home, enter, readControl, readable }); recapSafe = true;
    });
    if (!recapSafe) return; // Only missing/changed sources or failed return stop dependent operations; reader RED continues.
    await segment(page, `${label}-undo-only-selected-tuesday`, async () => {
      assert.ok(target && neighbor); await closeDialogs(page); if (new URL(page.url()).pathname !== '/habit') await enter(page); await setDay(page, target, MONDAY, true);
      const before = await facts(page, api, `${label}-before-exact-date-undo`, [target.id, neighbor.id]); assert.ok(dayIsDone(before.checkins, target.id, TUESDAY), 'The actual Tuesday operation must have completed before undo');
      await setDay(page, target, TUESDAY, false, true); const after = await facts(page, api, `${label}-after-exact-date-undo`, [target.id, neighbor.id]);
      const oldVersion = checkinVersion(before.local, target.id, TUESDAY), newVersion = checkinVersion(after.local, target.id, TUESDAY), unchangedOthers = isDeepStrictEqual(before.local.habitCheckins.filter(row => row.id !== `${target.id}|${TUESDAY}`), after.local.habitCheckins.filter(row => row.id !== `${target.id}|${TUESDAY}`)) && isDeepStrictEqual(before.checkins.filter(row => row.businessKey !== `${target.id}|${TUESDAY}`), after.checkins.filter(row => row.businessKey !== `${target.id}|${TUESDAY}`));
      await observe(page, `${label}-undo-exact-date-cloud-ack-and-neighbor`, after.local.outbox.length === 0 && unchangedOthers && isDeepStrictEqual(before.local.habits, after.local.habits) && dayIsDone(after.checkins, target.id, MONDAY) && !dayIsDone(after.checkins, target.id, TODAY) && !dayIsDone(after.local.habitCheckins, target.id, TODAY) && after.local.habitCheckins.some(row => row.id === `${target.id}|${TUESDAY}` && row.done === false) && after.checkins.some(row => row.businessKey === `${target.id}|${TUESDAY}` && row.done === false) && validVersion(oldVersion) && validVersion(newVersion) && BigInt(newVersion) > BigInt(oldVersion) && isDeepStrictEqual(before.server.find(row => row.id === neighbor.id), after.server.find(row => row.id === neighbor.id)), JSON.stringify({ targetId: target.id, neighborId: neighbor.id, selectedDate: TUESDAY, oldVersion, newVersion, unchangedOthers }));
      undoFacts = after;
    });
    recapSafe = false;
    await segment(page, `${label}-yesterday-habit-undone`, async () => {
      assert.ok(undoFacts, 'Original exact-date undo must finish before the second recap');
      await readHabitRecap(h, { page, api, target, neighbor, label, phase: 'undone', originalFacts: undoFacts, recorded, facts, home, enter, readControl, readable }); recapSafe = true;
    });
    if (!recapSafe) return;
    await segment(page, `${label}-weekly-without-daily-streak-pressure`, async () => {
      assert.ok(target); const dates = ['2026-10-02', '2026-10-03', '2026-10-04', MONDAY, TUESDAY];
      for (const date of dates) { const local = await localRows(page, api.ownerId); if (!dayIsDone(local.habitCheckins, target.id, date)) await setDay(page, target, date, true); }
      const result = await facts(page, api, `${label}-five-real-prior-checkins`, [target.id]); assert.ok(dates.every(date => dayIsDone(result.checkins, target.id, date))); assert.ok(!dayIsDone(result.checkins, target.id, TODAY));
      const root = await card(page, target); await readControl(page, root); const reading = await readable(page, root);
      await observe(page, `${label}-weekly-no-bogus-daily-pressure`, reading.visible && !/连续\s*\d+\s*天|今天别忘|每日|每天.*打卡/.test(reading.text), JSON.stringify({ actualReading: reading, weeklyFrequency: target.frequency, performedDates: dates, todayUnmarked: TODAY, note: 'Five prior dates were individually operated, not seeded; a weekly user has no additional daily requirement' }));
    });
    if (process.env.AUDIT_INCLUDE_UNSUPPORTED_HABIT_HISTORY === 'true') {
      // The archived future-effective/history assertions remain runnable and RED.
      await segment(page, `${label}-edit-frequency-and-effective-range`, async () => { assert.ok(target); await inspectFutureHistoryDiagnostic(page, api, target, label); });
    } else {
      await observe(page, `${label}-future-effective-rule-history-unsupported`, null, 'UNSUPPORTED / not covered by this supported-flow gate. Original red assertions remain in inspectFrequencyEdit and run with AUDIT_INCLUDE_UNSUPPORTED_HABIT_HISTORY=true; preserved da4/f7/11a failures are not relabelled as passes. Immediate current-plan adjustment has a separate Y5b task.');
    }
    if (target && neighbor) await deletion(page, api, target, neighbor, label);
    else await segment(page, `${label}-deletion-prerequisites-unmet`, async () => { throw new Error('No fully created same-name target/neighbor pair; deletion cannot be claimed or manufactured'); });
  }
  const prefix = frequencyOnly ? 'Y5B-current-frequency' : 'Y5-weekly-habit';
  const media = [`${prefix}-1280`, `${prefix}-360`];
  for (const width of [1280, 360]) await isolated(`${prefix}-${width}`, { width, height: width === 360 ? 800 : 900 }, run);
  return media;
}
