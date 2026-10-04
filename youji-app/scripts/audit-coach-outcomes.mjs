// Hosted-CI diagnostic only. The caller owns isolated synthetic services and
// native-input/media helpers. Never seed insights, feedback or outcome state.
import assert from 'node:assert/strict';

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
    const selector = await page.evaluate(title => {
      const articles = [...document.querySelectorAll('main article')], target = articles.find(el => el.querySelector('h3')?.textContent === title);
      if (!target) return null;
      return `main article:nth-child(${[...target.parentElement.children].indexOf(target) + 1})`;
    }, title);
    assert.ok(selector, `Visible observation card missing: ${title}`);
    assert.equal(await page.$$eval(selector, rows => rows.length), 1, 'Observation card selector must be unique');
    assert.equal(await page.$eval(`${selector} h3`, el => el.textContent), title);
    return selector;
  }
  function comparisonExpectations(rows) {
    const currentStart = businessDate(-6), previousStart = businessDate(-13), previousEnd = businessDate(-7), today = businessDate();
    const spending = rows.filter(row => !row.isIncome && row.category !== 'income');
    const current = spending.filter(row => row.date >= currentStart && row.date <= today), previous = spending.filter(row => row.date >= previousStart && row.date <= previousEnd);
    const currentFen = current.reduce((sum, row) => sum + row.amount, 0), previousFen = previous.reduce((sum, row) => sum + row.amount, 0);
    const exactIncreasePercent = previousFen ? ((currentFen - previousFen) / previousFen) * 100 : null;
    return { currency: 'CNY', currentStart, currentEnd: today, previousStart, previousEnd, currentIds: current.map(row => row.id), previousIds: previous.map(row => row.id), excludedIncomeIds: rows.filter(row => row.isIncome || row.category === 'income').map(row => row.id), currentFen, previousFen, currentYuan: (currentFen / 100).toFixed(2), previousYuan: (previousFen / 100).toFixed(2), exactIncreasePercent, roundedWholePercent: exactIncreasePercent === null ? null : Math.round(exactIncreasePercent) };
  }
  async function operateOptionalControl(page, selector, index, purpose) {
    const elements = await page.$$(`${selector} a,${selector} button`);
    try {
      const target = elements[index]; assert.ok(target, 'Observed card control disappeared before native operation');
      await page.bringToFront(); await target.scrollIntoView();
      await page.waitForFunction(el => { const r = el.getBoundingClientRect(); return !el.disabled && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, {}, target);
      const before = await state(page); await target.asLocator().click();
      actions.push({ kind: 'native-pointer-observed-card-control', index, purpose, sourcePath: before.path });
      await page.waitForFunction(text => document.body.innerText !== text, {}, before.text);
      await observe(page, purpose, null, 'Actual native click and resulting UI retained. Independent inspection must judge the reached source or task; control presence alone does not pass the outcome.');
      if (new URL(page.url()).pathname !== '/insights') { await page.goBack({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-history-back', purpose: 'Return from diagnostic source/action operation' }); await waitPath(page, '/insights'); }
    } finally { await Promise.all(elements.map(element => element.dispose())); }
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
  await isolated('Y3-sparse-history-360', { width: 360, height: 800 }, async page => {
    await login(page, '13900008807', 'Synthetic Y3 Sparse'); const api = await apiFor(page);
    await openPage(page, '/insights');
    await observe(page, 'Y3-zero-data-observation-context', null, 'Actual new-account insights before any source record; inspect wording and actual local/cloud origins, not a fabricated empty-state assumption');
    await facts(page, api, 'Y3-zero-data'); await home(page);
    const [old] = await prepareExpenses(page, api, [{ name: 'Synthetic 45天前旧账', amount: 1379, category: 'food', date: businessDate(-45), isIncome: false }]);
    await openPage(page, '/coach'); await page.waitForSelector('textarea[aria-label="输入消息"]');
    await page.waitForFunction(() => ![...document.querySelectorAll('main p')].some(el => el.getAnimations().some(a => a.playState === 'running')));
    const welcome = (await state(page)).text;
    await observe(page, 'Y3-historical-date-not-relationship-history', !welcome.includes('已经相处一段时间') && !welcome.includes('越来越了解你'), 'This account was just created; one 45-day-old expense is historical coverage, not evidence of 45 days of interaction');
    await facts(page, api, 'Y3-sparse-first-coach', { oldSourceId: old.id, accountCreatedInThisRun: true, noPriorConversation: true });
    const geometry = await page.$eval('textarea[aria-label="输入消息"]', el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { box: r.toJSON(), centerHitsInput: el.contains(hit), hitTag: hit?.tagName, hitLabel: hit?.closest('button')?.getAttribute('aria-label') }; });
    await observe(page, 'Y3-first-input-natural-center-unobstructed', geometry.centerHitsInput, JSON.stringify(geometry));
    await segment(page, 'Y3-input-alternative-real-hit', async () => {
      // Preserve the central obstruction. If needed, use a genuinely visible
      // left-hand text area to inspect typing; this does not turn the center green.
      const point = await page.$eval('textarea[aria-label="输入消息"]', el => { const r = el.getBoundingClientRect(), x = r.x + 24, y = r.y + r.height / 2; return { x, y, hitsInput: el.contains(document.elementFromPoint(x, y)) }; });
      assert.ok(point.hitsInput, 'Even the alternative visible input area is obstructed');
      await page.mouse.click(point.x, point.y); actions.push({ kind: 'native-pointer-alternative-visible-input-area', point, centralObstructionPreserved: !geometry.centerHitsInput });
      await page.keyboard.sendCharacter('Synthetic 我想核对这条旧记录');
      await observe(page, 'Y3-unsent-input-visible-after-real-click', await page.$eval('textarea[aria-label="输入消息"]', el => el.value === 'Synthetic 我想核对这条旧记录'), 'Typing only; no send, model response or complete conversation is claimed');
    });
  });

  await isolated('Y3-observation-action-1280', { width: 1280, height: 900 }, async page => {
    await login(page, '13900008808', 'Synthetic Y3 Action'); const api = await apiFor(page);
    const sources = await prepareExpenses(page, api, [
      { name: 'Synthetic 本期核对午饭', amount: 5025, category: 'food', date: businessDate(-1), isIncome: false },
      { name: 'Synthetic 前期核对午饭', amount: 2010, category: 'food', date: businessDate(-10), isIncome: false },
      { name: 'Synthetic 非支出收入反例', amount: 90000, category: 'income', date: businessDate(-2), isIncome: true },
    ]);
    let local = await waitLocal(page, api, rows => rows.coachInsights.some(row => row.title.startsWith('近7天消费比前7天')) && rows.coachInsights.some(row => row.title === '按适合你的节奏记录'), 'application-generated comparison and optional capture advice');
    const comparison = local.coachInsights.find(row => row.title.startsWith('近7天消费比前7天')), suggestion = local.coachInsights.find(row => row.title === '按适合你的节奏记录');
    await facts(page, api, 'Y3-generated-observations', { sources, independentExpectedComparison: comparisonExpectations(sources), comparisonId: comparison.id, suggestionId: suggestion.id });
    await openPage(page, '/insights');
    await segment(page, 'Y3-source-reading', async () => {
      const selector = await card(page, comparison.title); await readCard(page, selector);
      const text = await page.$eval(selector, el => el.innerText);
      await observe(page, 'Y3-comparison-amount-precision-context', null, JSON.stringify({ rendered: text, independentExpectedComparison: comparisonExpectations(sources), limitation: 'Precision diagnostic only. Any approximate wording does not establish correct amounts, denominator, percentage or income exclusion.' }));
      const links = await page.$$eval(`${selector} a,${selector} button`, rows => rows.map(el => ({ text: el.textContent, label: el.getAttribute('aria-label'), href: el.getAttribute('href') })));
      const sourceIndex = links.findIndex(row => /依据|来源|明细|记录/.test(`${row.text} ${row.label}`) && !String(row.label).startsWith('去完成'));
      await observe(page, 'Y3-evidence-source-controls', sourceIndex < 0 ? false : null, JSON.stringify({ cardText: text, controls: links, limitation: 'Exact-card discoverability only; a present control is operated below and still needs independent source inspection.' }));
      if (sourceIndex >= 0) await operateOptionalControl(page, selector, sourceIndex, 'Y3-actual-source-control-destination');
    });
    await segment(page, 'Y3-accept-and-continue', async () => {
      const selector = await card(page, comparison.title); await pointer(page, `${selector} button`, '采纳建议');
      local = await waitLocal(page, api, rows => rows.coachInsights.some(row => row.id === comparison.id && row.actionTaken), 'acceptance persisted for the exact observation ID');
      await facts(page, api, 'Y3-accepted-intent', { comparisonId: comparison.id, noExecutionClaimed: true });
      await observe(page, 'Y3-acceptance-not-fake-completion', (await state(page)).text.includes('未代替你完成任务') && !local.coachInsights.find(row => row.id === comparison.id)?.actionResult, 'Exact persisted acceptance is intent, not execution or an invented result');
      const next = await page.$$eval(`${selector} a,${selector} button`, rows => rows.map(el => ({ text: el.textContent, label: el.getAttribute('aria-label') })));
      const nextIndex = next.findIndex(row => /去完成|继续行动|查看行动|执行建议/.test(`${row.text} ${row.label}`));
      await observe(page, 'Y3-accepted-action-still-executable', nextIndex < 0 ? false : null, JSON.stringify({ controlsAfterAccept: next, task: comparison.actionSuggested, alternateConversationIsNotDirectExecution: true, limitation: 'Presence alone never proves executable task completion' }));
      if (nextIndex >= 0) await operateOptionalControl(page, selector, nextIndex, 'Y3-actual-accepted-action-destination');
    });
    await segment(page, 'Y3-optional-record-advice-destination', async () => {
      if (new URL(page.url()).pathname !== '/insights') await openPage(page, '/insights');
      const selector = await card(page, suggestion.title); await readCard(page, selector);
      await pointer(page, `${selector} button[aria-label^="去完成："]`);
      await page.waitForFunction(() => location.pathname !== '/insights' && (document.querySelector('textarea[aria-label="速记内容"]') || document.querySelector('main h1')?.textContent !== '教练洞察'));
      await page.waitForFunction(() => { const heading = document.querySelector('main h1'), input = document.querySelector('textarea[aria-label="速记内容"]'); return input || heading && heading.getBoundingClientRect().height > 0 && heading.textContent !== '教练洞察'; });
      await observe(page, 'Y3-record-advice-opens-capture', Boolean(await page.$('textarea[aria-label="速记内容"]')), `The action says “${suggestion.actionSuggested}”; actual destination ${new URL(page.url()).pathname}. Actual form capability, not a hardcoded URL, is the task criterion`);
      await page.goBack({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-history-back', purpose: 'Return from actual suggested action destination' }); await waitPath(page, '/insights');
    });
    await segment(page, 'Y3-reject-remains-rejected', async () => {
      if (new URL(page.url()).pathname !== '/insights') await openPage(page, '/insights');
      const selector = await card(page, suggestion.title); await pointer(page, `${selector} button`, '忽略');
      await waitLocal(page, api, rows => rows.coachInsights.some(row => row.id === suggestion.id && row.dismissed), 'exact dismissed observation saved');
      await page.waitForFunction(title => ![...document.querySelectorAll('main article h3')].some(el => el.textContent === title), {}, suggestion.title);
      await observe(page, 'Y3-dismiss-immediate-feedback', true, 'The exact suggestion is hidden after the user rejects it');
      // Arm before navigation: old visible brief text can survive in the store
      // and must not stand in for completion of this new Home generation.
      const homeBrief = page.waitForResponse(response => response.url().endsWith('/api/coach/brief') && response.request().method() === 'GET' && response.status() === 200);
      await home(page); await homeBrief;
      await waitLocal(page, api, rows => rows.coachInsights.some(row => row.id === suggestion.id && row.dismissed), 'dismissed original retained');
      await openPage(page, '/insights'); await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'user-reload-after-feedback', purpose: 'Check persisted rejection and regenerated suggestions' }); await waitPath(page, '/insights');
      const reread = await facts(page, api, 'Y3-rejected-after-home-and-reload', { rejectedId: suggestion.id });
      await observe(page, 'Y3-rejection-not-recreated-as-new-advice', !reread.local.coachInsights.some(row => row.title === suggestion.title && !row.dismissed), 'Same source and same suggestion must not return under a new ID just because Home is revisited');
    });
    await segment(page, 'Y3-correct-source-and-return', async () => {
      actions.push({ kind: 'explicit-independent-source-correction-fallback', note: 'Uses normal navigation; does not claim the missing accepted-action continuation worked' });
      await openPage(page, '/expense'); await pointer(page, `button[id="expense-record-${sources[0].id}"]`);
      await fill(page, '#expense-amount', '40.25'); await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog]', { hidden: true });
      local = await settledRows(page, api); const remote = (await api('/expenses')).expenses;
      await saveRecordEvidence('Y3-corrected-observation-source', local, { expenses: remote }, { expenses: sources.map(row => row.id) });
      await observe(page, 'Y3-source-correction-real-ack', local.outbox.length === 0 && remote.length === 3 && remote.find(row => row.id === sources[0].id)?.amount === 4025 && remote.find(row => row.id === sources[1].id)?.amount === 2010 && remote.find(row => row.id === sources[2].id)?.amount === 90000, 'Exact source corrected at real server; previous-period and income counterexamples unchanged');
      await openPage(page, '/insights'); const selector = await card(page, comparison.title); await readCard(page, selector);
      const final = await facts(page, api, 'Y3-return-after-correction', { comparisonId: comparison.id, independentExpectedComparison: comparisonExpectations(remote) });
      await observe(page, 'Y3-source-changed-review-context', null, JSON.stringify({ original: comparison, currentObservation: final.local.coachInsights.find(row => row.id === comparison.id), rendered: await page.$eval(selector, el => el.innerText), note: 'Inspect whether the old snapshot is distinguishable and there is a usable current review/action outcome; do not rewrite old evidence to manufacture success.' }));
    });
  });
}
