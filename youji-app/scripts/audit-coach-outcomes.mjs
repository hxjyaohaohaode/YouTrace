// Hosted-CI diagnostic only. The caller owns isolated synthetic services and
// native-input/media helpers. Never seed insights, feedback or outcome state.
import assert from 'node:assert/strict';
import { createExpenseSummary } from './audit-expense-summary.mjs';

export async function runCoachOutcomes(h) {
  const { isolated, login, pointer, fill, waitPath, state, observe, segment, apiFor, localRows, settledRows, saveRecordEvidence, businessDate, sleep, actions, artifacts, writeFile, join } = h;
  async function openPage(page, path) {
    if (page.viewport().width <= 768) {
      await pointer(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more');
      await pointer(page, `nav[aria-label="全部功能"] a[href="${path}"]`);
    } else {
      const label = { '/insights': '教练洞察', '/coach': 'AI 教练', '/expense': '花销', '/': '首页' }[path];
      assert.ok(label); await pointer(page, 'aside nav button', label);
    }
    await waitPath(page, path);
  }
  async function home(page) {
    await pointer(page, page.viewport().width <= 768 ? 'nav[aria-label="主导航"] button[aria-label="首页"]' : 'aside nav button', page.viewport().width <= 768 ? undefined : '首页');
    await waitPath(page, '/');
  }
  async function facts(page, api, name, extra = {}) {
    const local = await localRows(page, api.ownerId);
    const remote = { expenses: (await api('/expenses')).expenses, insights: (await api('/coach/insights?limit=100')).insights };
    await writeFile(join(artifacts, `${name}-facts.json`), JSON.stringify({ syntheticOnly: true, capturedAt: new Date().toISOString(), local, remote, ...extra }, null, 2));
    return { local, remote };
  }
  async function waitLocal(page, api, predicate, description) {
    const deadline = Date.now() + 12000;
    do { const rows = await localRows(page, api.ownerId); if (predicate(rows)) return rows; await sleep(150); } while (Date.now() < deadline);
    throw new Error(`State not observed: ${description}`);
  }
  async function prepareExpenses(page, api, expenses) {
    const saved = [];
    for (const row of expenses) saved.push((await api('/expenses', row)).expense);
    assert.ok(saved.every(row => row?.id));
    actions.push({ kind: 'synthetic-historical-source-API-setup', records: saved, note: 'Only raw source records; no insights, user feedback, model output or result are seeded' });
    await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'fixture-preparation-reload', purpose: 'Load historical source fixture before user task starts' });
    await waitPath(page, '/'); await waitLocal(page, api, rows => saved.every(row => rows.expenses.some(item => item.id === row.id)), 'all source expense IDs pulled');
    return saved;
  }
  async function card(page, title) {
    const located = await page.evaluate(title => {
      const matches = [...document.querySelectorAll('[data-component="historical-observations"] article')].filter(el => el.querySelector('h3')?.textContent === title);
      return { count: matches.length, selector: matches.length === 1 ? `[data-component="historical-observations"] article:nth-child(${[...matches[0].parentElement.children].indexOf(matches[0]) + 1})` : null };
    }, title);
    assert.equal(located.count, 1, `Historical observation title must be unique in this fixture: ${title}`); assert.ok(located.selector);
    assert.equal(await page.$$eval(located.selector, rows => rows.length), 1); assert.equal(await page.$eval(`${located.selector} h3`, el => el.textContent), title);
    return located.selector;
  }
  function comparisonExpectations(rows) {
    const currentStart = businessDate(-6), previousStart = businessDate(-13), previousEnd = businessDate(-7), today = businessDate();
    const spending = rows.filter(row => !row.isIncome && row.category !== 'income');
    const current = spending.filter(row => row.date >= currentStart && row.date <= today), previous = spending.filter(row => row.date >= previousStart && row.date <= previousEnd);
    const currentFen = current.reduce((sum, row) => sum + row.amount, 0), previousFen = previous.reduce((sum, row) => sum + row.amount, 0);
    const exactIncreasePercent = previousFen ? ((currentFen - previousFen) / previousFen) * 100 : null;
    return { currency: 'CNY', currentStart, currentEnd: today, previousStart, previousEnd, currentIds: current.map(row => row.id), previousIds: previous.map(row => row.id), excludedIncomeIds: rows.filter(row => row.isIncome || row.category === 'income').map(row => row.id), currentFen, previousFen, currentYuan: (currentFen / 100).toFixed(2), previousYuan: (previousFen / 100).toFixed(2), exactIncreasePercent, roundedWholePercent: exactIncreasePercent === null ? null : Math.round(exactIncreasePercent) };
  }
  async function readCard(page, selector) {
    // Ordinary wheel reading, never DOM/CSS repositioning. Re-read geometry so
    // a previous card's height or ongoing layout transition cannot choose a hit.
    for (let i = 0; i < 7; i++) {
      const box = await page.$eval(selector, el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, center: r.top + r.height / 2, height: innerHeight, width: innerWidth }; });
      if (box.top >= 60 && box.bottom <= box.height - 100) break;
      const deltaY = box.center - box.height / 2; await page.mouse.move(box.width * 0.75, box.height / 2); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-read-observation', deltaY }); await sleep(200);
    }
    await page.waitForFunction(selector => { const el = document.querySelector(selector); return el && Number(getComputedStyle(el).opacity) > 0.99 && !el.getAnimations({ subtree: true }).some(a => a.playState === 'running'); }, {}, selector);
  }
  const currentSurface = '[data-component="current-record-observations"]';
  const comparisonSurface = `${currentSurface} article[aria-label="已记录支出变化"]`;
  async function historyToggle(page) {
    const text = await page.$$eval('summary', rows => rows.find(el => el.textContent.startsWith('查看已保存的历史观察'))?.textContent);
    assert.ok(text); await pointer(page, 'summary', text);
  }
  async function returnToObservation(page) {
    const text = await page.$$eval('button', rows => rows.find(el => el.textContent.includes('返回这份观察'))?.textContent.trim());
    assert.ok(text, 'The source editor must expose its actual return context'); await pointer(page, 'button', text); await waitPath(page, '/insights');
  }
  await isolated('Y3-sparse-history-360', { width: 360, height: 800 }, async page => {
    await login(page, '13900008807', 'Synthetic Y3 Sparse'); const api = await apiFor(page);
    await openPage(page, '/insights'); await page.waitForFunction(selector => document.querySelector(selector)?.innerText.includes('还没有可核对的记录'), {}, currentSurface);
    await observe(page, 'Y3-zero-data-no-invented-advice', !(await state(page)).text.includes('异常预警') && !(await state(page)).text.includes('0/0'), 'Actual new-account current view offers one recording option; no fabricated advice or mandatory habit denominator');
    await facts(page, api, 'Y3-zero-data'); await home(page);
    const [old] = await prepareExpenses(page, api, [{ name: 'Synthetic 45天前旧账', amount: 1379, category: 'food', date: businessDate(-45), isIncome: false }]);
    await openPage(page, '/coach'); await page.waitForSelector('textarea[aria-label="输入消息"]');
    await page.waitForFunction(() => ![...document.querySelectorAll('main p')].some(el => el.getAnimations().some(a => a.playState === 'running')));
    const welcome = (await state(page)).text;
    await observe(page, 'Y3-historical-date-not-relationship-history', welcome.includes(old.date) && welcome.includes('不代表连续记录或相处时长') && !welcome.includes('已经相处一段时间') && !welcome.includes('越来越了解你'), 'One old source is coverage, not relationship history; actual recorded date is visible');
    await facts(page, api, 'Y3-sparse-first-coach', { oldSourceId: old.id, accountCreatedInThisRun: true, noPriorConversation: true });
    const geometry = await page.$eval('textarea[aria-label="输入消息"]', el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { box: r.toJSON(), centerHitsInput: el.contains(hit), hitTag: hit?.tagName, hitLabel: hit?.closest('button')?.getAttribute('aria-label') }; });
    await observe(page, 'Y3-first-input-natural-center-unobstructed', geometry.centerHitsInput, JSON.stringify(geometry));
    await segment(page, 'Y3-input-actual-pointer-and-keyboard', async () => {
      await fill(page, 'textarea[aria-label="输入消息"]', 'Synthetic 我想核对这条旧记录');
      const send = await page.$eval('button[aria-label="发送消息"]', el => { const r = el.getBoundingClientRect(); return { enabled: !el.disabled, hits: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), box: r.toJSON() }; });
      await observe(page, 'Y3-input-and-enabled-send-visible', send.enabled && send.hits, JSON.stringify({ send, boundary: 'Unsent typing and hit geometry only; no model response or actual conversation-completion claim' }));
    });
  });

  async function completeObservation(page) {
    const narrow = page.viewport().width < 769, label = narrow ? 'Y3N' : 'Y3';
    await login(page, narrow ? '13900008809' : '13900008808', `Synthetic ${label} Action`); const api = await apiFor(page);
    const sources = await prepareExpenses(page, api, [
      { name: 'Synthetic 本期核对午饭', amount: 5025, category: 'food', date: businessDate(-1), isIncome: false },
      { name: 'Synthetic 前期核对午饭', amount: 2010, category: 'food', date: businessDate(-10), isIncome: false },
      { name: 'Synthetic 非支出收入反例', amount: 90000, category: 'income', date: businessDate(-2), isIncome: true },
    ]);
    const before = await waitLocal(page, api, rows => rows.coachInsights.some(row => row.title.startsWith('近7天消费比前7天')), 'application-generated immutable history');
    const originalHistory = structuredClone(before.coachInsights), historyComparison = originalHistory.find(row => row.title.startsWith('近7天消费比前7天'));
    await facts(page, api, `${label}-initial`, { sources, independentExpectedComparison: comparisonExpectations(sources), originalHistory });
    const financial = createExpenseSummary(h, { page, api, label, sources, openPage, home });
    if (!await financial.visit('before')) return;
    await page.waitForSelector(comparisonSurface);
    await segment(page, `${label}-understand-current-evidence`, async () => {
      await readCard(page, comparisonSurface); const text = await page.$eval(comparisonSurface, el => el.innerText), expected = comparisonExpectations(sources);
      await observe(page, `${label}-exact-current-period-comparison`, text.includes('50.25') && text.includes('20.10') && text.includes('约150%') && [expected.currentStart, expected.currentEnd, expected.previousStart, expected.previousEnd].every(date => text.includes(date)) && (text.match(/1笔支出/g) ?? []).length === 2 && text.includes('1笔收入') && !text.includes('异常预警'), JSON.stringify({ expected, displayed: text, limitation: 'Same-period arithmetic from recorded sources, not behavior or causal inference' }));
      await pointer(page, `${comparisonSurface} button`, '查看依据并核对原记录');
      const evidence = await page.$eval('[data-observation-evidence]', el => el.innerText);
      await observe(page, `${label}-source-period-structure-context`, null, JSON.stringify({ expandedText: evidence, limitation: 'Structure only; each source row is actually brought into the viewport below' }));
      for (const [index, periodName] of ['current', 'previous'].entries()) {
        const selector = `button[data-observation-record="${sources[index].id}"]`; await readCard(page, selector);
        const row = await page.$eval(selector, el => { const r = el.getBoundingClientRect(); return { text: el.innerText, period: el.closest('section')?.getAttribute('aria-label'), rect: r.toJSON(), fullyVisible: r.top >= 0 && r.bottom <= innerHeight - 85, hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; });
        await observe(page, `${label}-${periodName}-source-reading-viewport`, row.fullyVisible && row.hit && row.period === (index === 0 ? `${expected.currentStart} 至 ${expected.currentEnd}` : `${expected.previousStart} 至 ${expected.previousEnd}`) && row.text.includes(sources[index].date) && row.text.includes((sources[index].amount / 100).toFixed(2)) && row.text.includes(sources[index].name) && row.text.includes('已收到云端版本确认'), JSON.stringify(row));
      }
      await pointer(page, 'summary', '查看已排除的收入（1笔）');
      const incomeSelector = `button[data-observation-record="${sources[2].id}"]`; const income = await page.$(incomeSelector); assert.ok(income); await income.dispose(); await readCard(page, incomeSelector);
      await observe(page, `${label}-excluded-income-actual-source`, await page.$eval(incomeSelector, el => el.innerText.includes('900.00') && el.innerText.includes('收入')), 'The actual excluded counterexample is readable without changing it');
    });
    await segment(page, `${label}-source-action-correct-return`, async () => {
      const source = `button[data-observation-record="${sources[0].id}"]`, handle = await page.$(source); assert.ok(handle); await handle.dispose(); await readCard(page, source);
      const position = await h.capture(page, `${label}-source-before-open`); await pointer(page, source); await waitPath(page, '/expense'); await page.waitForSelector('#expense-amount');
      await observe(page, `${label}-exact-source-editor`, await page.$eval('#expense-amount', el => Number(el.value)) === 50.25 && await page.$eval('#expense-name', el => el.value) === sources[0].name && await page.$eval('#expense-date', el => el.value) === sources[0].date, 'The source CTA opened the exact name/date/amount editor, not a module list');
      await financial.readExpenseCategory();
      await fill(page, '#expense-amount', '40.25'); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
      const local = await settledRows(page, api), remote = (await api('/expenses')).expenses;
      await saveRecordEvidence(`${label}-corrected-observation-source`, local, { expenses: remote }, { expenses: sources.map(row => row.id) });
      await observe(page, `${label}-same-source-correction-cloud-ack`, local.outbox.length === 0 && remote.length === 3 && remote.find(row => row.id === sources[0].id)?.amount === 4025 && remote.find(row => row.id === sources[1].id)?.amount === 2010 && remote.find(row => row.id === sources[2].id)?.amount === 90000, 'Exact original source corrected at real server; prior-period and income counterexamples unchanged');
      await returnToObservation(page);
      await page.waitForFunction(selector => document.querySelector(selector)?.innerText.includes('40.25') && document.querySelector(selector)?.innerText.includes('约100%'), {}, comparisonSurface);
      await page.waitForFunction(id => document.activeElement?.getAttribute('data-observation-record') === id, {}, sources[0].id);
      const returnState = await state(page), focused = await page.$eval(source, el => { const r = el.getBoundingClientRect(); return { focused: document.activeElement === el, visible: r.top >= 0 && r.bottom <= innerHeight - 85, rect: r.toJSON(), label: el.getAttribute('aria-label') }; });
      await observe(page, `${label}-return-current-result-and-source-focus`, focused.focused && focused.visible && Math.abs(returnState.scroll.y - position.state.scroll.y) < 50, JSON.stringify({ beforeScroll: position.state.scroll.y, afterScroll: returnState.scroll.y, focused, expected: comparisonExpectations(remote) }));
      await pointer(page, `${comparisonSurface} button`, '收起本次依据'); await readCard(page, comparisonSurface);
      await observe(page, `${label}-returned-current-comparison-reading`, await page.$eval(comparisonSurface, el => el.innerText.includes('40.25') && el.innerText.includes('20.10') && el.innerText.includes('约100%')), 'After inspecting the corrected source, the user closes its evidence and reads the updated current comparison');
      const final = await facts(page, api, `${label}-returned-current`, { originalHistory, independentExpectedComparison: comparisonExpectations(remote) });
      for (const original of originalHistory) assert.deepEqual(final.local.coachInsights.find(row => row.id === original.id), original, 'Existing historical snapshots must not be rewritten by live evidence');
      await historyToggle(page); const selector = await card(page, historyComparison.title); await readCard(page, selector);
      await observe(page, `${label}-immutable-history-readable`, await page.$eval(selector, el => el.innerText.includes('150%')), 'Original snapshot remains separately readable after actual source correction; it is not current arithmetic');
      await historyToggle(page);
    });
    if (!await financial.visit('after')) return;
    await page.waitForSelector(comparisonSurface);
    await segment(page, `${label}-choice-quota-and-recovery`, async () => {
      // The financial visit returns via ordinary navigation; read this control
      // into the usable viewport before installing the unchanged choice fault.
      await readCard(page, '[data-observation-choice="spending-comparison:true"]');
      await page.evaluate(owner => { const original = IDBObjectStore.prototype.put; window.__choicePutOriginal = original; window.__choiceQuotaHits = 0; IDBObjectStore.prototype.put = function(value, ...args) { if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'settings' && String(value?.key).startsWith('observation-choice:')) { window.__choiceQuotaHits++; throw new DOMException('Synthetic choice quota', 'QuotaExceededError'); } return original.call(this, value, ...args); }; }, api.ownerId);
      actions.push({ kind: 'synthetic-choice-quota-boundary', owner: api.ownerId, scope: 'settings observation-choice only' });
      try {
        await pointer(page, `${currentSurface} button`, '在此设备隐藏本期间支出观察'); await page.waitForFunction(() => window.__choiceQuotaHits > 0 && document.body.innerText.includes('显示选择未保存'));
        const local = await localRows(page, api.ownerId); assert.equal(local.settings.some(row => row.key.startsWith('observation-choice:v1:spending-comparison:')), false);
        await observe(page, `${label}-failed-choice-explains-no-save`, (await state(page)).text.includes('存储空间不足'), 'Native storage failure reached the real handler; no device choice row was committed and source records remain');
      } finally { await page.evaluate(() => { IDBObjectStore.prototype.put = window.__choicePutOriginal; delete window.__choicePutOriginal; }); }
      await pointer(page, 'button', '重新读取当前观察'); await page.waitForSelector(comparisonSurface);
    });
    await segment(page, `${label}-hide-survives-revisit-reload-source-change`, async () => {
      // A normal reading scroll is needed when DOM.scrollIntoView leaves a
      // fully-in-viewport control underneath the persistent mobile navigation.
      await readCard(page, '[data-observation-choice="spending-comparison:true"]');
      await pointer(page, `${currentSurface} button`, '在此设备隐藏本期间支出观察'); await page.waitForSelector(comparisonSurface, { hidden: true });
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-observation-choice') === 'spending-comparison:false');
      await observe(page, `${label}-device-hide-clear-scope-and-focus`, (await state(page)).text.includes('其他设备不受影响'), 'Hidden current observation replaced by an explicit same-device restore control, with keyboard focus retained');
      await home(page); await openPage(page, '/insights'); await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'user-reload-after-device-choice', label }); await waitPath(page, '/insights');
      await page.waitForFunction(selector => document.querySelector(selector)?.innerText.includes('此设备已隐藏'), {}, currentSurface);
      await observe(page, `${label}-hide-survives-home-reload`, !await page.$(comparisonSurface), 'The current same-period observation stays hidden after Home generation and reload');
      actions.push({ kind: 'independent-hidden-source-change', note: 'This separate preference test uses normal navigation; the earlier correction already used the observation evidence CTA' });
      await openPage(page, '/expense'); await pointer(page, `button[id="expense-record-${sources[0].id}"]`); await fill(page, '#expense-name', 'Synthetic 隐藏后核对午饭'); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
      const local = await settledRows(page, api), remote = (await api('/expenses')).expenses; await saveRecordEvidence(`${label}-hidden-source-change`, local, { expenses: remote }, { expenses: sources.map(row => row.id) });
      assert.equal(local.outbox.length, 0); assert.equal(remote.find(row => row.id === sources[0].id)?.name, 'Synthetic 隐藏后核对午饭');
      await openPage(page, '/insights'); await page.waitForFunction(selector => document.querySelector(selector)?.innerText.includes('此设备已隐藏'), {}, currentSurface);
      await observe(page, `${label}-source-change-does-not-revoke-choice`, !await page.$(comparisonSurface), 'Editing the source does not silently revoke this period’s device hide');
      await pointer(page, `${currentSurface} button`, '在此设备恢复本期间支出观察'); await page.waitForSelector(comparisonSurface);
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-observation-choice') === 'spending-comparison:true');
      const restoreFocus = await page.$eval('[data-observation-choice="spending-comparison:true"]', el => { const r = el.getBoundingClientRect(); return { focused: document.activeElement === el, fullyVisible: r.top >= 0 && r.bottom <= innerHeight - 85, hits: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), rect: r.toJSON() }; });
      await observe(page, `${label}-restore-natural-next-focus-visible`, restoreFocus.focused && restoreFocus.fullyVisible && restoreFocus.hits, JSON.stringify(restoreFocus));
      await readCard(page, comparisonSurface);
      await observe(page, `${label}-explicit-restore-current-cents`, await page.$eval(comparisonSurface, el => el.innerText.includes('40.25') && el.innerText.includes('约100%')), 'User explicitly restored the current view, which uses actual source content');
    });
    await segment(page, `${label}-read-failure-clears-current-and-recovers`, async () => {
      if (!await page.$('[data-observation-evidence]')) await pointer(page, `${comparisonSurface} button`, '查看依据并核对原记录');
      const sourceSelector = `button[data-observation-record="${sources[0].id}"]`, sourceHandle = await page.$(sourceSelector); assert.ok(sourceHandle); await sourceHandle.dispose(); await readCard(page, sourceSelector);
      await observe(page, `${label}-before-read-failure-current-source-ack`, await page.$eval(sourceSelector, el => el.innerText.includes('40.25') && el.innerText.includes('已收到云端版本确认')), 'Current source and its matching confirmed status are actually shown before the injected later read failure');
      await page.evaluate(owner => {
        // Dexie binds db.transaction during open; patching its prototype later
        // misses that bound reference. Its core.get dynamically calls store.get.
        // This exact epoch read must succeed before any current view is trusted.
        const original = IDBObjectStore.prototype.get, deadline = Date.now() + 15000;
        const diagnostic = window.__observationOutage = { owner, deadline, calls: [], hitCount: 0, hits: [], expired: false, restoredAt: null };
        let restored = false; const restore = () => { if (restored) return; restored = true; IDBObjectStore.prototype.get = original; clearTimeout(timer); diagnostic.restoredAt = Date.now(); };
        const timer = setTimeout(() => { diagnostic.expired = true; restore(); }, 15000); window.__restoreObservationRead = restore;
        IDBObjectStore.prototype.get = function(key) {
          if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'settings' && key === 'localDataEpoch') {
            const tables = [...this.transaction.objectStoreNames], mode = this.transaction.mode;
            const eligible = mode === 'readonly' && tables.length === 7 && ['expenses','habitCheckins','diary','quickNotes','settings','outbox','coachInsights'].every(name => tables.includes(name));
            const call = { at: Date.now(), db: this.transaction.db.name, table: this.name, key, mode, tables, eligible };
            if (diagnostic.calls.length < 50) diagnostic.calls.push(call);
            if (eligible && Date.now() < deadline) { diagnostic.hitCount++; if (diagnostic.hits.length < 50) diagnostic.hits.push(call); throw new DOMException('Synthetic bounded observation epoch-read outage', 'UnknownError'); }
          }
          return original.call(this, key);
        };
      }, api.ownerId);
      actions.push({ kind: 'synthetic-native-IDB-observation-epoch-read-outage', label, hardLimitMs: 15000 });
      try {
        await pointer(page, `${currentSurface} button`, '重新核对本机记录'); await page.waitForFunction(() => window.__observationOutage.hits.length > 0 && document.body.innerText.includes('当前金额和同步确认已撤下'));
        assert.equal(await page.evaluate(() => window.__observationOutage.expired), false, 'Expired fault window is harness-blocked, never product failure');
        await observe(page, `${label}-read-failure-withdraws-old-result`, !await page.$(comparisonSurface) && await page.$eval(currentSurface, el => !el.innerText.includes('40.25') && !el.innerText.includes('已收到云端版本确认')), 'The previously visible amount and current ACK are removed on a confirmed native read failure');
        await historyToggle(page); const history = await card(page, historyComparison.title); await readCard(page, history); await observe(page, `${label}-historical-snapshot-survives-read-failure`, await page.$eval(history, el => el.innerText.includes('150%')), 'Existing immutable history stays readable with its non-current meaning'); await historyToggle(page);
        assert.equal(await page.evaluate(() => window.__observationOutage.expired), false);
        await page.evaluate(() => window.__restoreObservationRead()); await pointer(page, 'button', '重新读取当前观察'); await page.waitForSelector(comparisonSurface);
        const recoveredSource = await page.$(sourceSelector); assert.ok(recoveredSource); await recoveredSource.dispose(); await readCard(page, sourceSelector);
        await observe(page, `${label}-actual-reread-source-ack`, await page.$eval(sourceSelector, el => el.innerText.includes('Synthetic 隐藏后核对午饭') && el.innerText.includes('40.25') && el.innerText.includes('已收到云端版本确认')), 'Recovered actual current source and ACK are readable after storage returns and user retry');
        await pointer(page, `${comparisonSurface} button`, '收起本次依据'); await readCard(page, comparisonSurface);
        await observe(page, `${label}-actual-reread-latest-result`, await page.$eval(comparisonSurface, el => el.innerText.includes('40.25') && el.innerText.includes('约100%')), 'Real retry recovers the current source calculation, not the old historical snapshot');
        await facts(page, api, `${label}-reread-current`);
      } finally { const diagnostic = await page.evaluate(() => { window.__restoreObservationRead?.(); return window.__observationOutage; }); await writeFile(join(artifacts, `${label}-read-outage.json`), JSON.stringify(diagnostic, null, 2)); }
    });
    await segment(page, `${label}-optional-capture-reaches-real-saved-record`, async () => {
      const beforeCapture = await localRows(page, api.ownerId), serverExpensesBefore = (await api('/expenses')).expenses;
      await pointer(page, `${currentSurface} button`, '写一句速记'); await waitPath(page, '/quick-note');
      const input = 'Synthetic 从记录观察回看后的一句话'; await fill(page, 'textarea[aria-label="速记内容"]', input); await pointer(page, 'button', '查看确认稿'); await waitPath(page, '/quick-note/result');
      for (const label of ['将这段文字记入日记', '我愿意记录这次心情']) { const selector = `input[aria-label="${label}"]`; if (await page.$(selector) && await page.$eval(selector, el => el.checked)) await pointer(page, selector); }
      await pointer(page, 'button', '确认保存所选记录'); await page.waitForFunction(() => location.search.includes('receipt='));
      const local = await settledRows(page, api), notes = (await api('/quicknote')).notes;
      const serverExpensesAfter = (await api('/expenses')).expenses;
      for (const table of ['todos', 'habits', 'habitCheckins', 'diary']) assert.deepEqual(local[table], beforeCapture[table], `Pure original note must not alter ${table}`);
      const stableExpenses = rows => rows.map(({ id, name, amount, date, category, isIncome, note, relatedMood, source }) => ({ id, name, amount, date, category, isIncome, note, relatedMood, source })).sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(stableExpenses(local.expenses), stableExpenses(beforeCapture.expenses)); assert.deepEqual(serverExpensesAfter.sort((a, b) => a.id.localeCompare(b.id)), serverExpensesBefore.sort((a, b) => a.id.localeCompare(b.id)));
      await writeFile(join(artifacts, `${label}-capture-side-effects.json`), JSON.stringify({ syntheticOnly: true, before: { todos: beforeCapture.todos, habits: beforeCapture.habits, checkins: beforeCapture.habitCheckins, diary: beforeCapture.diary, expenses: stableExpenses(beforeCapture.expenses), serverExpenses: serverExpensesBefore }, after: { todos: local.todos, habits: local.habits, checkins: local.habitCheckins, diary: local.diary, expenses: stableExpenses(local.expenses), serverExpenses: serverExpensesAfter } }, null, 2));
      await saveRecordEvidence(`${label}-actual-optional-capture`, local, { quickNotes: notes }, { quickNotes: local.quickNotes.map(row => row.id) });
      await observe(page, `${label}-optional-action-real-result`, local.outbox.length === 0 && local.quickNotes.length === 1 && local.quickNotes[0].rawInput === input && local.diary.length === 0 && local.expenses.length === 3 && notes.length === 1 && notes[0].id === local.quickNotes[0].id && notes[0].content === input, 'The optional action actually saved exactly one raw note at the isolated server, without extra diary or expense writes');
    });
  }
  await isolated('Y3-observation-action-1280', { width: 1280, height: 900 }, completeObservation);
  await isolated('Y3-observation-action-360', { width: 360, height: 800 }, completeObservation);
}
