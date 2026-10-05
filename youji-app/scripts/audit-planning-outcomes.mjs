// Hosted-CI native UI red baseline. Sources are created through rendered forms,
// never preseeded through an API; API/IDB reads only corroborate actual results.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export async function runPlanningOutcomes(h) {
  const { isolated, login, pointer, fill, dateInput, waitPath, state, capture, observe, segment, apiFor, localRows, settledRows, saveRecordEvidence, businessDate, sleep, actions, artifacts, writeFile, join, surfaceNames, infrastructure, traffic, checkpoint } = h;
  const media = [];
  async function home(page) { await pointer(page, page.viewport().width <= 768 ? 'nav[aria-label="主导航"] button[aria-label="首页"]' : 'aside nav button', page.viewport().width <= 768 ? undefined : '首页'); await waitPath(page, '/'); }
  async function enter(page) { await pointer(page, page.viewport().width <= 768 ? 'nav[aria-label="主导航"] button[aria-label="日程"]' : 'aside nav button', page.viewport().width <= 768 ? undefined : '日程'); await waitPath(page, '/schedule'); }
  async function closeDialogs(page) {
    for (let i = 0; i < 3 && await page.$('[role=dialog]'); i++) { await page.bringToFront(); await page.keyboard.press('Escape'); actions.push({ kind: 'native-escape-reset-independent-segment', surface: surfaceNames.get(page) }); await sleep(250); }
    assert.equal(await page.$('[role=dialog]'), null);
  }
  async function dialogSelector(page, title) { const ids = await page.$$eval('[role=dialog]', (rows, title) => rows.filter(el => el.querySelector('h3')?.textContent === title).map(el => el.getAttribute('aria-labelledby')), title); assert.equal(ids.length, 1); assert.ok(ids[0]); return `[role=dialog][aria-labelledby="${ids[0]}"]`; }
  async function timeInput(page, selector, expected) {
    // Use the visible native segmented control. Arrow keys adjust actual time
    // fields; DOM reads validate each segment, never assign input.value.
    await pointer(page, selector); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
    const [hour, minute] = expected.split(':').map(Number), read = () => page.$eval(selector, el => el.value);
    for (let i = 0; i < 12 && Number((await read()).split(':')[0]) % 12 !== hour % 12; i++) await page.keyboard.press('ArrowUp');
    assert.equal(Number((await read()).split(':')[0]) % 12, hour % 12, 'Native hour segment must be reached');
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 60 && Number((await read()).split(':')[1]) !== minute; i++) await page.keyboard.press('ArrowUp');
    assert.equal(Number((await read()).split(':')[1]), minute, 'Native minute segment must be reached');
    if (Number((await read()).split(':')[0]) !== hour) { await page.keyboard.press('ArrowRight'); await page.keyboard.press(hour >= 12 ? 'p' : 'a'); }
    await page.keyboard.press('Tab'); const actual = await read(); actions.push({ kind: 'native-segmented-time', surface: surfaceNames.get(page), selector, expected, actual }); assert.equal(actual, expected, 'Native time entry failure is harness-blocked, not a product result');
  }
  async function selectDate(page, date) {
    await closeDialogs(page); await pointer(page, '[role=tab]', '月');
    const [year, month, day] = date.split('-').map(Number), target = year * 12 + month;
    for (let i = 0; i < 4; i++) {
      const current = await page.$eval('main', el => el.innerText.match(/(\d{4})年(\d{1,2})月/)?.slice(1).map(Number)); assert.ok(current);
      const value = current[0] * 12 + current[1]; if (value === target) break; await pointer(page, `button[aria-label="${value < target ? '下一页' : '上一页'}"]`);
    }
    await page.waitForFunction(text => document.querySelector('main')?.innerText.includes(text), {}, `${year}年${month}月`);
    const selector = `main button[aria-label^="${month}月${day}日，"]`; assert.equal(await page.$$eval(selector, rows => rows.length), 1); await pointer(page, selector);
    await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent === '日');
    assert.ok((await state(page)).text.includes(`${month}月${day}日`));
  }
  async function checkMonthCount(page, date, expected, label) {
    await pointer(page, '[role=tab]', '月');
    const [, month, day] = date.split('-').map(Number), selector = `main button[aria-label^="${month}月${day}日，"]`;
    await readControl(page, selector); const actual = await page.$eval(selector, el => el.getAttribute('aria-label'));
    await observe(page, label, actual === `${month}月${day}日，${expected}个日程`, JSON.stringify({ date, expected, actual }));
  }
  function expectedHomeScheduleCopy(time, title) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(time)).split(':').map(Number);
    const minute = parts[0] * 60 + parts[1], start = 12 * 60 + 15, end = 13 * 60 + 15;
    if (minute >= end) return '今天的日程已结束';
    if (minute >= start) return `进行中: ${title}`;
    const until = start - minute;
    if (until <= 30) return `即将开始: ${title}`;
    const hours = Math.floor(until / 60), minutes = until % 60;
    return `下个: 12:15 ${title} · ${hours > 0 ? `${hours}小时` : ''}${minutes > 0 ? `${minutes}分钟` : ''}后`;
  }
  async function readControl(page, selector, text) {
    for (let i = 0; i < 7; i++) {
      const box = await page.evaluate(({ selector, text }) => { const rows = [...document.querySelectorAll(selector)].filter(el => text === undefined || el.textContent.trim() === text); if (rows.length !== 1) return null; const r = rows[0].getBoundingClientRect(); return { top: r.top, bottom: r.bottom, center: r.top + r.height / 2, height: innerHeight, width: innerWidth }; }, { selector, text }); assert.ok(box);
      if (box.top >= 55 && box.bottom <= box.height - 100) break;
      await page.mouse.move(box.width * 0.7, box.height / 2); await page.mouse.wheel({ deltaY: box.center - box.height / 2 }); actions.push({ kind: 'native-wheel-read-schedule', surface: surfaceNames.get(page) }); await sleep(150);
    }
  }
  async function readableControl(page, selector, text) {
    return page.evaluate(({ selector, text }) => {
      const rows = [...document.querySelectorAll(selector)].filter(el => text === undefined || el.textContent.trim() === text); if (rows.length !== 1) return { unique: false, visible: false };
      const el = rows[0], r = el.getBoundingClientRect(); return { unique: true, text: el.innerText, rect: r.toJSON(), visible: r.top >= 0 && r.bottom <= innerHeight - 85 && r.width > 0 && r.height > 0 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    }, { selector, text });
  }
  async function dayTarget(page, row) { const selector = `[role=button][aria-label="${row.startTime}-${row.endTime} ${row.title}"]`; return { selector, count: await page.$$eval(selector, rows => rows.length) }; }
  async function openDay(page, row) { const target = await dayTarget(page, row); assert.equal(target.count, 1, 'Exact date/time/title schedule must be discoverable in the selected day'); await readControl(page, target.selector); await pointer(page, target.selector); await page.waitForSelector('#schedule-title'); }
  async function facts(page, api, name, ids, extra = {}) { const local = await settledRows(page, api), server = (await api('/schedules')).schedules; await saveRecordEvidence(name, local, { schedules: server }, { schedules: ids }, extra); return { local, server }; }
  async function create(page, api, name, title, date, startTime, endTime, weekly = false) {
    await closeDialogs(page); await pointer(page, 'button[aria-label="新建日程"]'); await fill(page, '#schedule-title', title); await dateInput(page, '#schedule-date', date); await timeInput(page, '#schedule-start', startTime); await timeInput(page, '#schedule-end', endTime); await fill(page, '#schedule-location', 'Synthetic 原地点');
    if (weekly) await pointer(page, '[role="group"][aria-label="重复规则"] button', '每周重复');
    await capture(page, `${name}-native-fields-before-save`); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const { local, server } = await facts(page, api, `${name}-created`, []), matches = server.filter(row => row.title === title && row.date === date && row.startTime === startTime && row.endTime === endTime && row.repeat === (weekly ? 'weekly' : 'none'));
    assert.equal(matches.length, 1); const record = matches[0]; await saveRecordEvidence(`${name}-created-exact-record`, local, { schedules: server }, { schedules: [record.id] });
    await observe(page, `${name}-real-form-same-id-cloud-confirmed`, local.outbox.length === 0 && local.schedules.filter(row => row.id === record.id && row.date === date && row.startTime === startTime && row.endTime === endTime).length === 1, 'The native form created one exact date/time record and its matching server row; view discoverability is tested independently'); return record;
  }
  async function openPeer(page, name) {
    await home(page); const firstUseClosed = await page.$$eval('summary', rows => rows.some(el => el.textContent === '也可以直接安排任务、记账或查看其他功能' && !el.parentElement.open)); if (firstUseClosed) await pointer(page, 'summary', '也可以直接安排任务、记账或查看其他功能');
    await pointer(page, 'main a', '查看全部功能'); await waitPath(page, '/more');
    const targetPromise = page.browserContext().waitForTarget(target => target.type() === 'page' && target !== page.target());
    await page.keyboard.down('Control'); try { await pointer(page, 'nav[aria-label="全部功能"] a[href="/schedule"]'); } finally { await page.keyboard.up('Control'); }
    const target = await targetPromise, peer = await target.page(); assert.ok(peer); surfaceNames.set(peer, name); let recorder;
    try {
      await peer.setViewport(page.viewport()); await peer.emulateTimezone('Asia/Shanghai'); await peer.bringToFront();
      peer.on('pageerror', error => infrastructure.push({ scenario: name, pageError: error.name })); peer.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) { traffic.push({ scenario: name, path, status: response.status(), method: response.request().method() }); if (response.status() >= 500) infrastructure.push({ scenario: name, httpFailure: response.status(), path }); } });
      const targets = [];
      for (const observedPage of [page, peer]) { const session = await observedPage.createCDPSession(); try { const { targetInfo } = await session.send('Target.getTargetInfo'); targets.push({ surface: surfaceNames.get(observedPage), targetId: targetInfo.targetId, url: observedPage.url() }); } finally { await session.detach(); } }
      const attribution = { trace: `${surfaceNames.get(page)}-trace.json`, targets, videos: [`${surfaceNames.get(page)}.webm`, `${name}.webm`], scope: 'One continuous browser-global trace; native actions and videos identify their page' };
      await writeFile(join(artifacts, `${name}-target-attribution.json`), JSON.stringify(attribution, null, 2));
      await checkpoint('starting planning peer video; shared browser trace remains continuous', attribution);
      recorder = await peer.screencast({ path: join(artifacts, `${name}.webm`), fps: 12, quality: 35 }); media.push(name); await checkpoint('planning peer video started', attribution);
      actions.push({ kind: 'native-control-click-same-account-peer', source: surfaceNames.get(page), peer: name, href: '/schedule', ...attribution });
      await waitPath(peer, '/schedule'); await page.bringToFront(); await pointer(page, 'nav[aria-label="全部功能"] a[href="/schedule"]'); await waitPath(page, '/schedule'); return { peer, recorder };
    } catch (error) { await cleanupPeer(page, peer, recorder, name); throw error; }
  }
  async function cleanupPeer(page, peer, recorder, name) {
    const attempt = async (stage, operation) => { try { await operation(); } catch (error) { infrastructure.push({ scenario: name, cleanupFailure: stage, message: error.message }); } };
    await attempt('restore-original-network', () => page.setOfflineMode(false));
    await attempt('foreground-peer', () => peer.bringToFront()); await attempt('preserve-peer-final-frame', () => capture(peer, `${name}-final`)); await sleep(500);
    if (recorder) await attempt('stop-peer-recording', () => recorder.stop());
    await attempt('close-peer', () => peer.close()); await attempt('return-original-foreground', () => page.bringToFront());
  }

  async function run(page) {
    const narrow = page.viewport().width === 360, label = narrow ? 'Y4N' : 'Y4'; await login(page, narrow ? '13900008832' : '13900008831', `Synthetic ${label}`); const api = await apiFor(page); await enter(page);
    const date = businessDate(1), title = 'Synthetic 同名工作安排', created = [];
    for (const [start, end] of [['06:15','06:45'], ['23:15','23:45'], ['09:00','10:00']]) await segment(page, `${label}-native-create-${start.replace(':','')}`, async () => { const record = await create(page, api, `${label}-${start.replace(':','')}`, title, date, start, end); created.push(record); });
    await segment(page, `${label}-actual-day-week-month-retrieval`, async () => {
      await selectDate(page, date); const firstFacts = await facts(page, api, `${label}-three-times`, created.map(row => row.id)); await observe(page, `${label}-three-distinct-intended-records`, created.length === 3 && firstFacts.local.schedules.length === 3 && firstFacts.server.length === 3, 'Three same-title records have different intended times; one normal record cannot stand in for both edge-of-day rows');
      for (const row of created) { const target = await dayTarget(page, row); if (target.count === 1) await readControl(page, target.selector); const reading = await readableControl(page, target.selector); await observe(page, `${label}-day-readable-${row.startTime.replace(':','')}`, target.count === 1 && reading.visible && reading.text.includes(row.title) && reading.text.includes(`${row.startTime}-${row.endTime}`), JSON.stringify({ selectedDate: date, intendedStart: row.startTime, intendedEnd: row.endTime, reading })); }
      await pointer(page, '[role=tab]', '周');
      for (const row of created) {
        const matches = await page.$$eval('main button', (rows, row) => rows.filter(el => el.innerText.includes(row.title) && el.innerText.includes(`${row.startTime}-${row.endTime}`)).map(el => el.textContent.trim()), row);
        if (matches.length === 1) await readControl(page, 'main button', matches[0]); const reading = matches.length === 1 ? await readableControl(page, 'main button', matches[0]) : null; await observe(page, `${label}-week-readable-${row.startTime.replace(':','')}`, matches.length === 1 && reading.visible, JSON.stringify({ selectedDate: date, intendedStart: row.startTime, intendedEnd: row.endTime, reading }));
        if (matches.length === 1) { await pointer(page, 'main button', matches[0]); await observe(page, `${label}-week-opens-exact-${row.startTime.replace(':','')}`, await page.$eval('#schedule-date', el => el.value) === date && await page.$eval('#schedule-start', el => el.value) === row.startTime && await page.$eval('#schedule-end', el => el.value) === row.endTime, 'Real row opens the intended date/time form'); await closeDialogs(page); }
      }
      await pointer(page, '[role=tab]', '月'); const [,month,day] = date.split('-').map(Number); const text = await page.$eval(`button[aria-label^="${month}月${day}日，"]`, el => el.getAttribute('aria-label')); await observe(page, `${label}-month-matches-stored-rows`, text.endsWith('3个日程'), JSON.stringify({ intendedDate: date, accessibleDay: text })); await selectDate(page, date);
    });
    await segment(page, `${label}-cancel-retains-edit-without-writing`, async () => {
      const record = created.find(row => row.startTime === '09:00'); assert.ok(record); await selectDate(page, date); const beforeCancel = await facts(page, api, `${label}-before-cancel`, [record.id]); await openDay(page, record); const draft = 'Synthetic 暂存的工作安排'; await fill(page, '#schedule-title', draft); const cancelCopy = await page.$eval('[role=dialog]', el => el.innerText); await capture(page, `${label}-actual-cancel-copy-before-action`); await pointer(page, '[role=dialog] button', '取消（保留草稿）'); await page.waitForSelector('[role=dialog]', { hidden: true });
      const { local, server } = await facts(page, api, `${label}-after-cancel`, [record.id]); await observe(page, `${label}-cancel-no-business-write`, isDeepStrictEqual(server.find(row => row.id === record.id), beforeCancel.server.find(row => row.id === record.id)) && isDeepStrictEqual(local.schedules.find(row => row.id === record.id), beforeCancel.local.schedules.find(row => row.id === record.id)), 'Cancel preserves all fields of the exact server and local source row, not merely its title'); await openDay(page, record); await observe(page, `${label}-reopen-edit-recovery-context`, null, JSON.stringify({ actualCancelCopy: cancelCopy, original: record.title, unsaved: draft, reopened: await page.$eval('#schedule-title', el => el.value), interpretation: 'Historical baseline wording is retained separately; this candidate now explicitly promises a retained local draft.' })); await observe(page, `${label}-cancel-promise-reopen-exact-draft`, await page.$eval('#schedule-title', el => el.value) === draft, 'The visible retain-draft promise is verified against the exact unsaved title after native cancel and reopen'); await closeDialogs(page);
    });
    await segment(page, `${label}-future-recurring-occurrence-scope`, async () => {
      const series = await create(page, api, `${label}-weekly`, 'Synthetic 每周安排', date, '11:00', '12:00', true), future = businessDate(8); await selectDate(page, future); await openDay(page, { ...series, date: future });
      const opened = await state(page), actualDate = await page.$eval('#schedule-date', el => el.value); await observe(page, `${label}-future-occurrence-date-and-scope`, null, JSON.stringify({ selectedOccurrence: future, seriesOrigin: date, openedDate: actualDate, dialogText: opened.text }));
      const choices = await page.$$eval('[role=dialog] button, [role=dialog] label', rows => rows.filter(el => /仅此一次|只改这一次|仅本次|仅这一次/.test(el.textContent)).map(el => ({ tag: el.tagName, text: el.textContent.trim() })));
      await observe(page, `${label}-single-occurrence-supported-exit`, choices.length ? null : false, 'The task is explicitly to change only this future occurrence. Absent scope control is a gap; presence is context only until that choice and its unchanged-series outcome are actually operated. The probe must not silently save a full-series change');
      await closeDialogs(page); const { server } = await facts(page, api, `${label}-series-inspected-not-mutated`, [series.id]); assert.deepEqual(server.find(row => row.id === series.id), series);
      if (choices.length) {
        const movedDate = businessDate(0); await openDay(page, { ...series, date: future }); await pointer(page, '[role=dialog] button', '仅这一次'); await dateInput(page, '#schedule-date', movedDate); await timeInput(page, '#schedule-start', '12:15'); await timeInput(page, '#schedule-end', '13:15'); await fill(page, '#schedule-location', 'Synthetic 仅这一次的地点');
        await capture(page, `${label}-single-occurrence-before-save`); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
        const edited = await facts(page, api, `${label}-single-occurrence-saved`, [series.id]), canonical = edited.server.find(row => row.id === series.id), exception = canonical.exceptions?.find(row => row.occurrenceDate === future);
        await observe(page, `${label}-single-occurrence-exact-cloud-result`, canonical.date === series.date && canonical.startTime === series.startTime && canonical.endTime === series.endTime && canonical.location === series.location && exception?.date === movedDate && exception.startTime === '12:15' && exception.endTime === '13:15' && exception.location === 'Synthetic 仅这一次的地点', 'One canonical series retains its original fields; one exact occurrence carries the acknowledged adjustment');
        await selectDate(page, future); await observe(page, `${label}-moved-original-date-absent`, (await dayTarget(page, series)).count === 0, 'The original weekly date no longer shows the moved occurrence'); await checkMonthCount(page, future, 0, `${label}-moved-origin-month-empty`); const changed = { ...series, date: movedDate, startTime: '12:15', endTime: '13:15' }; await selectDate(page, movedDate); await openDay(page, changed); await observe(page, `${label}-single-occurrence-reopened`, await page.$eval('#schedule-date', el => el.value) === movedDate && await page.$eval('#schedule-location', el => el.value) === exception.location, 'The adjusted occurrence opens its own date/time/location after real calendar navigation'); await closeDialogs(page); await checkMonthCount(page, movedDate, 1, `${label}-moved-target-month-one`);
        await selectDate(page, date); await openDay(page, series); await observe(page, `${label}-series-origin-unchanged`, await page.$eval('#schedule-start', el => el.value) === series.startTime && await page.$eval('#schedule-location', el => el.value) === series.location, 'Original occurrence retains original time/location'); await closeDialogs(page);
        await selectDate(page, businessDate(15)); await openDay(page, series); await observe(page, `${label}-next-week-unchanged`, await page.$eval('#schedule-start', el => el.value) === series.startTime && await page.$eval('#schedule-location', el => el.value) === series.location, 'The following weekly occurrence remains unchanged'); await closeDialogs(page);
        await home(page); const overview = await page.$$eval('main button', rows => rows.filter(el => el.innerText.includes('今日日程')).map(el => el.textContent.trim())); assert.equal(overview.length, 1); await readControl(page, 'main button', overview[0].trim());
        const homeTime = await page.evaluate(() => Date.now()), expectedHome = expectedHomeScheduleCopy(homeTime, series.title); await observe(page, `${label}-home-moved-time-status`, overview[0].includes(expectedHome), JSON.stringify({ observedAt: new Date(homeTime).toISOString(), timeZone: 'Asia/Shanghai', expected: expectedHome, actual: overview[0] })); const brief = await api('/coach/brief'); await observe(page, `${label}-home-and-online-brief-use-moved-occurrence`, /1 项/.test(overview[0]) && brief.brief?.todaySchedule?.some(row => row.id === series.id && row.time === '12:15-13:15' && row.location === exception.location), JSON.stringify({ overview: overview[0], briefSchedule: brief.brief?.todaySchedule }));
        await enter(page); await selectDate(page, movedDate); await pointer(page, '[role=tab]', '周'); const weekText = await page.$eval('main', el => el.innerText); await observe(page, `${label}-moved-week-time-and-place`, weekText.includes('12:15-13:15') && weekText.includes(exception.location), 'Week selection projects the moved occurrence at its new date');
        await selectDate(page, movedDate); await openDay(page, changed); await pointer(page, '[role=dialog] button', '仅这一次'); await pointer(page, '[role=dialog] button', '删除'); await capture(page, `${label}-cancel-one-occurrence-confirmation`); await pointer(page, `${await dialogSelector(page, '确认删除')} button`, '删除'); await page.waitForSelector('[role=dialog]', { hidden: true });
        const cancelled = await facts(page, api, `${label}-single-occurrence-cancelled`, [series.id]); await observe(page, `${label}-cancel-only-one-cloud-result`, cancelled.server.find(row => row.id === series.id)?.exceptions?.find(row => row.occurrenceDate === future)?.cancelled === true && (await dayTarget(page, changed)).count === 0, 'One cancelled exception is acknowledged; its canonical series survives'); await checkMonthCount(page, movedDate, 0, `${label}-cancelled-target-month-empty`);
        await home(page); const afterHome = await page.$$eval('main button', rows => rows.filter(el => el.innerText.includes('今日日程')).map(el => el.textContent.trim())); await readControl(page, 'main button', afterHome[0].trim()); const afterBrief = await api('/coach/brief'); await observe(page, `${label}-cancelled-home-and-online-brief`, afterHome[0].includes('0 项') && afterHome[0].includes('今天没有日程') && !afterBrief.brief?.todaySchedule?.some(row => row.id === series.id), JSON.stringify({ overview: afterHome[0], briefSchedule: afterBrief.brief?.todaySchedule }));
        await enter(page); await selectDate(page, businessDate(15)); await openDay(page, series); await observe(page, `${label}-cancel-preserves-following-week`, await page.$eval('#schedule-start', el => el.value) === series.startTime && await page.$eval('#schedule-location', el => el.value) === series.location, 'Following original weekly occurrence is still present after single cancellation'); await closeDialogs(page);

      }

    });
    await segment(page, `${label}-two-page-stale-edit-after-reconnect`, async () => {
      const record = created.find(row => row.startTime === '09:00'); assert.ok(record); const { peer, recorder } = await openPeer(page, `${label}-peer-edit`);
      try {
        await selectDate(page, date); await openDay(page, record); await fill(page, '#schedule-title', 'Synthetic 第一页旧稿修改'); await page.setOfflineMode(true); actions.push({ kind: 'target-network-offline', surface: surfaceNames.get(page), reason: 'Hold an unsaved form while another actual page corrects the same row' });
        await peer.bringToFront(); await selectDate(peer, date); await openDay(peer, record); await fill(peer, '#schedule-title', 'Synthetic 第二页已核对'); await fill(peer, '#schedule-location', 'Synthetic 第二页的新地点'); await pointer(peer, '[role=dialog] button', '保存'); await peer.waitForSelector('[role=dialog]', { hidden: true }); const peerState = await facts(peer, api, `${label}-peer-actual-save`, [record.id]); const updated = peerState.server.find(row => row.id === record.id); assert.equal(updated.location, 'Synthetic 第二页的新地点');
        await page.bringToFront(); const responseStart = traffic.length; await page.setOfflineMode(false); actions.push({ kind: 'target-network-online', surface: surfaceNames.get(page) });
        await page.waitForSelector('[role=button][aria-label="09:00-10:00 Synthetic 第二页已核对"]');
        const firstState = await facts(page, api, `${label}-first-page-new-record-old-form`, [record.id], { syncResponsesSinceOnline: traffic.slice(responseStart).filter(row => row.scenario === surfaceNames.get(page) && row.path === '/api/sync/pull'), oldForm: { title: await page.$eval('#schedule-title', el => el.value), location: await page.$eval('#schedule-location', el => el.value) }, sharedIndexedDB: true }); assert.equal(firstState.local.schedules.find(row => row.id === record.id)?.location, updated.location);
        await observe(page, `${label}-peer-refresh-while-old-form-open`, await page.$eval('#schedule-title', el => el.value) === 'Synthetic 第一页旧稿修改' && await page.$eval('#schedule-location', el => el.value) === record.location, 'Two pages share IndexedDB: the new underlying record and the old opened fields coexist. Network restoration and actual response receipts are recorded separately; offline does not prevent peer local writes');
        const disabledSave = await page.$$eval('[role=dialog] button', rows => rows.some(el => el.textContent.trim() === '保存' && el.disabled)); if (!disabledSave) await pointer(page, '[role=dialog] button', '保存'); else actions.push({ kind: 'observed-disabled-stale-save', surface: surfaceNames.get(page) }); const after = await facts(page, api, `${label}-old-form-save-result`, [record.id]); const actual = after.server.find(row => row.id === record.id);
        const retained = Boolean(await page.$('#schedule-title')) && await page.$eval('#schedule-title', el => el.value) === 'Synthetic 第一页旧稿修改' && await page.$eval('#schedule-location', el => el.value) === record.location;
        const explanation = await page.$$eval('[role=alert],[role=status],[data-component="schedule-conflict"]', rows => rows.map(el => el.innerText).join(' ')); const localRecord = after.local.schedules.find(row => row.id === record.id);
        await observe(page, `${label}-stale-form-does-not-overwrite-peer`, actual.title === updated.title && actual.location === updated.location && localRecord?.title === updated.title && localRecord?.location === updated.location && retained && /其他|新版本|更新|冲突|核对|变化/.test(explanation), JSON.stringify({ retainedDraft: retained, visibleExplanation: explanation, expectedPeerTitle: updated.title, expectedPeerLocation: updated.location, actualServer: actual, actualLocal: localRecord }));
      } finally { await cleanupPeer(page, peer, recorder, `${label}-peer-edit`); }
    });
    await segment(page, `${label}-failed-delete-keeps-unsaved-edit`, async () => {
      await closeDialogs(page); const record = (await api('/schedules')).schedules.find(row => row.startTime === '09:00' && row.date === date); assert.ok(record); await selectDate(page, date); await openDay(page, record); if (await page.$$eval('[role=dialog] button', rows => rows.some(el => el.textContent === '已核对，使用我的编辑稿覆盖'))) await pointer(page, '[role=dialog] button', '已核对，使用我的编辑稿覆盖'); await fill(page, '#schedule-location', 'Synthetic 删除失败后仍需保留的草稿'); await pointer(page, '[role=dialog] button', '删除'); const cancelDialog = await dialogSelector(page, '确认删除'); await pointer(page, `${cancelDialog} button`, '取消'); await page.waitForSelector(cancelDialog, { hidden: true }); await observe(page, `${label}-canceled-delete-keeps-editor-draft`, await page.$eval('#schedule-location', el => el.value) === 'Synthetic 删除失败后仍需保留的草稿', 'Canceling the delete confirmation leaves the existing unsaved editor intact'); const beforeFault = await facts(page, api, `${label}-before-delete-fault`, [record.id]);
      await page.evaluate(({ owner, id }) => { const original = IDBObjectStore.prototype.delete; window.__scheduleDeleteFault = { owner, id, hits: [], expired: false, restoredAt: null }; let timer; window.__restoreScheduleDelete = () => { clearTimeout(timer); IDBObjectStore.prototype.delete = original; window.__scheduleDeleteFault.restoredAt ??= Date.now(); }; timer = setTimeout(() => { window.__scheduleDeleteFault.expired = true; window.__restoreScheduleDelete(); }, 15000); IDBObjectStore.prototype.delete = function(key) { if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'schedules' && this.transaction.mode === 'readwrite' && key === id) { window.__scheduleDeleteFault.hits.push({ at: Date.now(), key, database: this.transaction.db.name }); throw new DOMException('Synthetic schedule deletion quota', 'QuotaExceededError'); } return original.call(this, key); }; }, { owner: api.ownerId, id: record.id });
      try {
        await pointer(page, '[role=dialog] button', '删除'); await pointer(page, `${await dialogSelector(page, '确认删除')} button`, '删除'); await page.waitForFunction(() => window.__scheduleDeleteFault.hits.length > 0); await page.waitForFunction(() => document.body.innerText.includes('删除失败')); assert.equal(await page.evaluate(() => window.__scheduleDeleteFault.expired), false);
        const after = await facts(page, api, `${label}-failed-delete-source`, [record.id]); assert.deepEqual(after.server.find(row => row.id === record.id), record); assert.deepEqual(after.local.schedules.find(row => row.id === record.id), beforeFault.local.schedules.find(row => row.id === record.id)); assert.deepEqual(after.local.outbox, beforeFault.local.outbox);
        await observe(page, `${label}-failed-delete-keeps-draft-and-record`, Boolean(await page.$('#schedule-location')) && await page.$eval('#schedule-location', el => el.value === 'Synthetic 删除失败后仍需保留的草稿'), 'An actual failed delete must keep its unsaved edit, explain the failure, and leave the exact source unchanged');
      } finally { const diagnostic = await page.evaluate(() => { window.__restoreScheduleDelete(); return window.__scheduleDeleteFault; }); await writeFile(join(artifacts, `${label}-delete-fault.json`), JSON.stringify(diagnostic, null, 2)); }
      await closeDialogs(page);
    });
  }
  for (const width of [1280,360]) { const name = `Y4-plan-and-adapt-${width}`; await isolated(name, { width, height: width === 360 ? 800 : 900 }, run); }
  return media;
}
