// TEST baseline only: existing Coach historical fixture and native correction.
// No server, browser, fixture, clock, provider, interception or business-write API.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { expenseOutcomeChecks as expense } from './audit-expense-outcomes.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';

const QUESTIONS = [
  { kind: 'week', message: '帮我看看这周的花销' },
  { kind: 'seven', message: '帮我看看近7天的花销' },
];
const ASSISTANTS = 'main div.whitespace-pre-wrap'; // UserMessage is a p, not a div.
const yuan = amount => (amount / 100).toFixed(2);
const shift = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const shanghai = instant => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(instant));
function expectedSummary(rows, today, kind) {
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(shift(today, 0), today);
  assert.ok(['yesterday', 'week', 'seven'].includes(kind));
  const mondayOffset = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const from = shift(today, kind === 'yesterday' ? -1 : kind === 'week' ? -mondayOffset : -6), through = kind === 'yesterday' ? from : today;
  const eligible = rows.filter(row => !row.isIncome && row.category !== 'income' && row.date >= from && row.date <= through);
  const categories = {}; let total = 0;
  for (const row of eligible) {
    assert.ok(Number.isSafeInteger(row.amount) && row.amount > 0 && Number.isSafeInteger(total + row.amount));
    total += row.amount; const name = ({ food: '餐饮', transport: '交通', entertainment: '娱乐', study: '学习', daily: '日用' })[row.category] ?? '其他';
    categories[name] = (categories[name] ?? 0) + row.amount;
  }
  return { kind, from, through, count: eligible.length, total, categories, sourceIds: eligible.map(row => row.id), excludedIncomeIds: rows.filter(row => row.isIncome || row.category === 'income').map(row => row.id) };
}
function exactMoney(text, amount, label) {
  if (typeof text !== 'string' || !Number.isSafeInteger(amount) || amount < 0) return false;
  // Capture the entire value/unit token, including invalid multipliers, rather
  // than accepting a correct numeric prefix of e.g. 50.25万元 or 50.250.
  const matches = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${label})\\s*(?:合计|总额|总计|了)?\\s*[:：]?\\s*[¥￥]\\s*([^\\s，,。；;·、（）()]+)`, 'gu'))];
  return matches.length === 1 && [yuan(amount), `${yuan(amount)}元`].includes(matches[0][1]);
}
function summaryReading(text, expected, { categories = false, period = true } = {}) {
  const range = `${expected.from} 至 ${expected.through}`;
  const content = text.replace(/^【规则回复 · 在线模型当前不可用】\s*/, '').trim();
  const name = expected.kind === 'week' ? '(?:本周(?:[（(]自然周[）)])?|这周|自然周)' : '(?:近|最近)\\s*7\\s*天(?:回顾)?';
  const dates = `${expected.from}(?![\\d-])\\s*(?:至|到|—|～|~)\\s*${expected.through}(?![\\d-])`;
  // One named scope, then its adjacent aggregate. A differently named period
  // or last-month figure elsewhere in the same answer cannot supply this fact.
  const scope = period
    ? new RegExp(`^${name}\\s*[:：]?\\s*[（(]?${dates}[）)]?(?=$|\\s|[，,。；;·])`).exec(content)
    : new RegExp(`^${expected.from}(?![\\d-])\\s+记录回顾(?=$|\\s|[，,。；;·])`).exec(content);
  const scoped = scope ? content.slice(scope[0].length).replace(/^[\s，,。；;·]+/, '') : '';
  const adjacentTotal = /^(?:已记录支出|支出|消费)\s*(?:合计|总额|总计|了)?\s*[:：]?\s*[¥￥]/.test(scoped);
  const counts = [...scoped.matchAll(/(?<![\p{L}\p{N}_.+−-])(?:共\s*)?([+−-]?\d+(?:\.\d+)?)\s*笔(?:\s*支出)?(?![\p{L}\p{N}_])/gu)];
  const count = counts.length === 1 && /^(?:0|[1-9]\d*)$/.test(counts[0][1]) && counts[0][1] === String(expected.count);
  const categoryRows = [...scoped.matchAll(/(?<![\p{L}\p{N}_])(餐饮|交通|娱乐|学习|日用|其他|收入)\s*[:：]?\s*[¥￥]\s*([^\s，,。；;·、（）()]+)/gu)];
  const category = !categories || !/\b(?:food|transport|entertainment|study|daily|other|income)\b/.test(scoped) && categoryRows.length === Object.keys(expected.categories).length && categoryRows.every(row => Object.hasOwn(expected.categories, row[1]) && [yuan(expected.categories[row[1]]), `${yuan(expected.categories[row[1]])}元`].includes(row[2])) && Object.entries(expected.categories).every(([label, amount]) => exactMoney(scoped, amount, label));
  return { period: Boolean(scope), money: adjacentTotal && exactMoney(scoped, expected.total, '已记录支出|支出|消费'), count, categories: category, expected: { ...expected, range } };
}
function briefMatches(brief, expected, uiText) {
  // This actual API version declares yesterdayReview.spent in yuan. Do not
  // invent a spentFen field or infer freshness from a minute-resolution label.
  const spent = brief?.yesterdayReview?.spent;
  const exactYuan = typeof spent === 'number' && Number.isFinite(spent) && spent >= 0 && Number.isSafeInteger(Math.round(spent * 100)) && spent === Math.round(spent * 100) / 100;
  return { apiReviewDate: brief?.reviewDate === expected.from, apiAmount: exactYuan && spent === expected.total / 100, uiAmountMatchesActualApi: exactYuan && exactMoney(uiText, Math.round(spent * 100), '已记录支出'), actualSpentYuan: spent ?? null, expectedSpentYuan: expected.total / 100 };
}
function completeRuleSse(text) {
  assert.equal(typeof text, 'string'); assert.ok(text.length > 0 && text.length < 65536, 'Bounded synthetic SSE required');
  const frames = text.trim().split(/\r?\n\r?\n/).map(frame => {
    assert.ok(frame.startsWith('data: '), 'Unexpected SSE frame'); return frame.slice(6);
  });
  assert.equal(frames.pop(), '[DONE]', 'The actual request must complete before navigating away');
  assert.ok(frames.length && !frames.includes('[DONE]'));
  const events = frames.map(frame => JSON.parse(frame));
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  for (const event of events) {
    assert.ok(plain(event), 'SSE data must be a plain object');
    const keys = Object.keys(event);
    if (Object.hasOwn(event, 'content')) {
      assert.ok(keys.every(key => ['content', 'source'].includes(key)) && typeof event.content === 'string', 'Malformed content frame');
      assert.ok(!Object.hasOwn(event, 'source') || event.source === 'rule_fallback', 'Unexpected reply source');
    } else {
      assert.ok(keys.length === 1 && keys[0] === 'actions' && Array.isArray(event.actions), 'Malformed action/error frame');
      assert.ok(event.actions.every(action => plain(action) && Object.keys(action).length === 3 && Object.keys(action).every(key => ['type', 'path', 'label'].includes(key)) && action.type === 'navigate' && ['/expense', '/insights'].includes(action.path) && typeof action.label === 'string' && action.label.trim().length > 0), 'Only the existing financial navigation actions may be retained, never clicked');
    }
  }
  assert.ok(events.some(event => event.source === 'rule_fallback'));
  const content = events.map(event => event.content ?? '').join('');
  assert.ok(content.startsWith('【规则回复 · 在线模型当前不可用】'));
  return { done: true, source: 'rule_fallback', content, events };
}
function newAssistantMatches(before, after, completed) {
  return completed?.done === true && completed.source === 'rule_fallback' && after.length === before.length + 1 && isDeepStrictEqual(before, after.slice(0, before.length)) && after.at(-1) === completed.content;
}
function historicalRowsPreserved(before, after) {
  return ['local', 'remote'].every(side => before[side].every(original => isDeepStrictEqual(after[side].find(row => row.id === original.id), original)));
}
function sourcesPreserved(before, after) {
  return expense.businessSourcesPreserved(before, after) && historicalRowsPreserved(before.history, after.history);
}
function correctionMatches(before, after, id) {
  return before.local.expenses.find(row => row.id === id)?.amount === 5025 && before.server.find(row => row.id === id)?.amount === 5025 && before.local.expenses.length === 3 && after.local.expenses.length === 3 && before.server.length === 3 && after.server.length === 3 && expense.changedOnlyTarget(before, after, id, 4025) && historicalRowsPreserved(before.history, after.history);
}
function clocksMatch(today, clock, brief) {
  const wall = typeof clock?.driverInstant === 'string' && Number.isFinite(Date.parse(clock.driverInstant));
  const browser = typeof clock?.browser?.instant === 'string' && Number.isFinite(Date.parse(clock.browser.instant));
  if (!wall || !browser || shanghai(clock.driverInstant) !== today || clock.browser.day !== today || shanghai(clock.browser.instant) !== today || clock.browser.timeZone !== 'Asia/Shanghai') return false;
  if (!brief) return true;
  return typeof brief.generatedAt === 'string' && Number.isFinite(Date.parse(brief.generatedAt)) && typeof brief.reviewDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(brief.reviewDate) && brief.reviewDate === shift(today, -1) && shift(brief.reviewDate, 1) === today && shanghai(brief.generatedAt) === today;
}
export const expenseSummaryChecks = { questions: QUESTIONS, expectedSummary, exactMoney, summaryReading, briefMatches, completeRuleSse, newAssistantMatches, sourcesPreserved, correctionMatches, clocksMatch };

export function createExpenseSummary(h, { page, api, label, sources, openPage, home }) {
  const { pointer, fill, observe, segment, capture, sleep, actions, artifacts, writeFile, join, businessDate } = h;
  const today = businessDate(); let frozen, sessionId;
  async function save(name, value) { await writeFile(join(artifacts, `${label}-financial-${name}.json`), JSON.stringify({ syntheticOnly: true, observedAt: new Date().toISOString(), ...value }, null, 2)); }
  async function clock(name, brief) {
    const evidence = { driverInstant: new Date().toISOString(), driverDay: businessDate(), browser: await page.evaluate(() => ({ instant: new Date().toISOString(), day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })), brief: brief ? { generatedAt: brief.generatedAt, reviewDate: brief.reviewDate, inferredServerDay: typeof brief.reviewDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(brief.reviewDate) ? shift(brief.reviewDate, 1) : null } : null };
    await save(`${name}-clock`, { frozenBusinessDay: today, ...evidence });
    if (!clocksMatch(today, evidence, brief)) {
      await observe(page, `${label}-${name}-date-context-inconclusive`, null, JSON.stringify({ frozenBusinessDay: today, ...evidence, reason: 'Real business dates disagree or changed; date-dependent chain stopped without changing clocks or fixture' }));
      throw new Error('Financial date context blocked: browser/driver/server disagreement or midnight transition');
    }
    return evidence;
  }
  async function snapshot(name) {
    // Four bounded complete tables, not a whole-database claim. A reserved tag
    // keeps own undefined distinct from a missing key. Unsupported values stop.
    const serialized = await page.evaluate(owner => new Promise((resolve, reject) => {
      const request = indexedDB.open(`youtrace:user:${owner}:schedule-v1`);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected existing account DB')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['expenses', 'settings', 'outbox', 'coachInsights'], 'readonly'), result = {};
        for (const table of ['expenses', 'settings', 'outbox', 'coachInsights']) { const read = tx.objectStore(table).getAll(); read.onsuccess = () => { result[table] = read.result; }; }
        tx.oncomplete = () => {
          db.close();
          try {
            const encode = value => {
              if (value === undefined) return { __expenseSummaryUndefined: true };
              if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
              if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
              if (Array.isArray(value)) {
                const keys = Object.keys(value);
                if (keys.length !== value.length || !Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index)) || keys.some(key => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new Error('Unsupported sparse or extended source array');
                return value.map(encode);
              }
              if (value && Object.getPrototypeOf(value) === Object.prototype && !Object.hasOwn(value, '__expenseSummaryUndefined')) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
              throw new Error('Unsupported source value; cannot claim field preservation');
            };
            resolve(JSON.stringify(encode(result)));
          } catch (error) { reject(error); }
        };
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Readonly financial source aborted')); };
      };
    }), api.ownerId);
    const local = JSON.parse(serialized), allEvents = []; let cursor = '0', complete = false;
    for (let index = 0; index < 20; index++) {
      const body = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`);
      assert.ok(expense.completeLedgerPage(body, cursor), 'Strict complete all-entity ledger page required');
      allEvents.push(...body.events); cursor = body.nextCursor;
      if (body.hasMore === false) { complete = true; break; }
    }
    assert.ok(complete, 'Financial fixture exceeded bounded complete-ledger read');
    const rawExpenses = await api('/expenses'), rawInsights = await api('/coach/insights?limit=100');
    const result = { local, server: rawExpenses.expenses, events: allEvents.filter(row => row.entity === 'expenses'), allEvents, history: { local: local.coachInsights, remote: rawInsights.insights } };
    await save(`${name}-sources`, { ...result, rawExpenses, rawInsights, scope: 'Complete expenses/settings/outbox/coachInsights sample, raw GET rows and complete all-entity ledger. ChatSession/ChatMessage are separate expected native conversation data; Home may append derived snapshots. No whole-database unchanged claim.' });
    assert.ok(Array.isArray(result.server) && result.server.length === 3, 'Keep the original three source rows');
    assert.ok(Array.isArray(rawInsights.insights) && rawInsights.insights.length < 100, 'Bounded historical fixture must not reach the GET cap');
    assert.ok(expense.sameRows(result.server, expense.expenseRowsFromLedger(allEvents)), 'Raw Expense GET and complete ledger must agree in every field');
    assert.ok(sources.every(source => expense.acknowledged(result, source.id)), 'All three original sources require exact ACK and empty outbox');
    return result;
  }
  async function preserve(before, after, name) {
    const pass = sourcesPreserved(before, after);
    await observe(page, `${label}-${name}-source-preservation`, pass, JSON.stringify({ settingsDifferences: expense.settingsDifferences(before, after), originalIds: sources.map(row => row.id), beforeLedgerCount: before.allEvents.length, afterLedgerCount: after.allEvents.length, boundary: 'Every original expense field, version, outbox, old all-entity ledger and historical insight row; new chats and appended derived snapshots are separate' }));
    assert.ok(pass, 'Source-preservation prerequisite failed; stop dependent work');
  }
  async function read(selector) {
    for (let index = 0; index < 7; index++) {
      const box = await page.evaluate(initialSessionGeometry, selector); assert.ok(box.unique, `One actual structural target required: ${selector}`);
      if (box.visible) return box;
      const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20)), deltaY = box.rect.y + box.rect.height / 2 - y;
      if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-read-financial-field', selector, pointer: { x, y }, deltaY, clip: box.clip, scroller: box.scroller }); }
      await sleep(150);
    }
    return page.evaluate(initialSessionGeometry, selector);
  }
  async function locate(kind) {
    return page.evaluate(kind => {
      const path = el => { if (!el) return null; const parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(row => row.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); } return 'body > ' + parts.join(' > '); };
      if (kind === 'answer') return { answer: path([...document.querySelectorAll('main div.whitespace-pre-wrap')].at(-1)) };
      if (kind === 'weekly') {
        const root = document.querySelector('[aria-label="查看近7天回顾和时间线"]');
        if (!root) return null;
        const paragraphs = [...root.querySelectorAll('p')].filter(el => !el.closest('details'));
        const amount = paragraphs.find(el => /^(消费|支出)$/.test(el.innerText.trim()));
        return { title: path(root.querySelector('h3')), amount: path(amount?.parentElement), scope: path(paragraphs.find(el => /\d{4}-\d{2}-\d{2}/.test(el.innerText))), provenance: path(paragraphs.find(el => /本机记录|已记录数据|基于.*记录/.test(el.innerText))) };
      }
      const detail = [...document.querySelectorAll('main details')].find(el => el.querySelector(':scope > summary')?.textContent.trim() === '查看今日回顾与建议');
      if (!detail) return null;
      const paragraphs = [...detail.querySelectorAll('p')], title = [...detail.querySelectorAll('span')].find(el => el.textContent === '记录简报');
      return { title: path(title), provenance: path(paragraphs.find(el => /^(云端已同步记录|本机记录|正在读取记录)/.test(el.innerText))), date: path(paragraphs.find(el => /记录回顾|昨日复盘/.test(el.innerText))), amount: path(paragraphs.find(el => el.innerText.startsWith('已记录支出'))) };
    }, kind);
  }
  async function fields(kind, name) {
    const selectors = await locate(kind), readings = {};
    assert.ok(selectors, `Actual ${kind} card not found`);
    for (const [field, selector] of Object.entries(selectors)) {
      if (!selector) { readings[field] = { present: false, visible: false, text: '' }; continue; }
      readings[field] = { present: true, ...await read(selector) };
      await capture(page, `${label}-${name}-${field}`);
    }
    await save(`${name}-reading`, { selectors, readings }); return readings;
  }
  async function question(question, rows, phase) {
    const name = `${phase}-coach-${question.kind}`, before = await page.$$eval(ASSISTANTS, nodes => nodes.map(node => node.innerText));
    await clock(name);
    await fill(page, 'textarea[aria-label="输入消息"]', question.message);
    const requests = [], responses = []; let finish;
    const received = new Promise(resolve => { finish = resolve; });
    const isChat = request => request.method() === 'POST' && new URL(request.url()).pathname.replace(/\/$/, '') === '/api/chat';
    const onRequest = request => { if (isChat(request)) requests.push(request); };
    const onResponse = response => {
      if (!requests.includes(response.request())) return;
      // Start consuming immediately on response, before any later UI wait or navigation.
      const body = response.text().then(text => ({ text }), error => ({ error: error.message }));
      responses.push({ response, body }); finish();
    };
    page.on('request', onRequest); page.on('response', onResponse);
    let timer;
    try {
      await pointer(page, 'button[aria-label="发送消息"]');
      await Promise.race([received, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native Coach response not observed; do not repeat Send')), 12000); })]);
      clearTimeout(timer);
      assert.equal(requests.length, 1, 'Each prompt has exactly one native POST'); assert.equal(responses.length, 1);
      const { response, body } = responses[0], actual = JSON.parse(requests[0].postData());
      assert.equal(actual.message, question.message); assert.ok(Object.keys(actual).every(key => ['message', 'sessionId'].includes(key)));
      const responseSession = response.headers()['x-session-id']; assert.ok(typeof responseSession === 'string' && responseSession.length >= 8);
      if (sessionId) { assert.equal(actual.sessionId, sessionId); assert.equal(responseSession, sessionId); }
      else { assert.equal(actual.sessionId, undefined); sessionId = responseSession; }
      const payload = await Promise.race([body, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native Coach SSE incomplete; do not repeat Send')), 12000); })]);
      clearTimeout(timer);
      await save(`${name}-network`, { request: { message: actual.message, sessionId: actual.sessionId ?? null }, response: { status: response.status(), sessionId: responseSession, ...payload }, boundary: 'Synthetic body/session/SSE only; no request or authentication headers/cookies retained' });
      assert.equal(response.status(), 200); assert.ok(!payload.error); const completed = completeRuleSse(payload.text);
      await page.waitForFunction((selector, count) => document.querySelectorAll(selector).length === count + 1 && !document.querySelector('textarea[aria-label="输入消息"]')?.disabled, { timeout: 7000 }, ASSISTANTS, before.length);
      const after = await page.$$eval(ASSISTANTS, nodes => nodes.map(node => node.innerText));
      assert.ok(newAssistantMatches(before, after, completed), 'Only the exact new assistant bubble can credit this completed request');
      const fieldsRead = await fields('answer', name), reading = fieldsRead.answer;
      const expected = expectedSummary(rows, today, question.kind), checks = summaryReading(reading.text, expected, { categories: true });
      await observe(page, `${label}-${name}-readable-exact-summary`, reading.visible && Object.entries(checks).filter(([key]) => key !== 'expected').every(([, pass]) => pass), JSON.stringify({ request: question, sessionId, checks, reading, source: completed.source, sameTotalsDoNotProveDifferentNativeFilters: true }));
      await clock(`${name}-done`);
    } finally { clearTimeout(timer); page.off('request', onRequest); page.off('response', onResponse); }
  }
  async function readHome(rows, phase) {
    const captures = []; let finish;
    const received = new Promise(resolve => { finish = resolve; });
    const onResponse = response => {
      if (response.request().method() !== 'GET' || new URL(response.url()).pathname !== '/api/coach/brief') return;
      const body = response.text().then(text => ({ text }), error => ({ error: error.message })); captures.push({ response, body }); finish();
    };
    page.on('response', onResponse); let timer;
    try {
      if (page.viewport().width <= 768) { await pointer(page, 'button[aria-label="返回首页"]'); await h.waitPath(page, '/'); }
      else await home(page);
      await Promise.race([received, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Actual Home brief fetch not observed on ordinary remount')), 12000); })]); clearTimeout(timer);
      assert.equal(captures.length, 1, 'One current Home remount response expected');
      const { response, body } = captures[0];
      const payload = await Promise.race([body, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Actual Home brief body incomplete; no reload or repeated request')), 12000); })]); clearTimeout(timer);
      await save(`${phase}-home-network`, { status: response.status(), ...payload, request: { method: 'GET', path: '/api/coach/brief', origin: 'Actual Home remount; not the diagnostic GET client' } });
      assert.equal(response.status(), 200, 'A failed actual Home brief is not cloud success'); assert.ok(!payload.error);
      const brief = JSON.parse(payload.text).brief; assert.ok(brief);
      await clock(`${phase}-home-response`, brief);
      await page.waitForFunction(() => [...document.querySelectorAll('main details')].some(el => el.querySelector(':scope > summary')?.textContent.trim() === '查看今日回顾与建议'), { timeout: 7000 });
      const opened = await page.$$eval('main details', nodes => nodes.find(el => el.querySelector(':scope > summary')?.textContent.trim() === '查看今日回顾与建议')?.open);
      if (!opened) await pointer(page, 'summary', '查看今日回顾与建议');
      // Settle the source label, never wait for hoped-for amount, count or dates.
      await page.waitForFunction(() => [...document.querySelectorAll('main p')].some(el => /^(云端已同步记录|本机记录)/.test(el.innerText)), { timeout: 7000 });
      const briefFields = await fields('brief', `${phase}-home-yesterday`), briefText = ['date', 'amount'].map(key => briefFields[key].text).join('\n');
      const expected = expectedSummary(rows, today, 'yesterday'), checks = summaryReading(briefText, expected, { period: false }), actualBriefChecks = briefMatches(brief, expected, briefFields.amount.text);
      const source = briefFields.provenance.text.startsWith('云端已同步记录') ? 'server' : briefFields.provenance.text.startsWith('本机记录') ? 'local' : 'unknown';
      const generatedMinute = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(brief.generatedAt));
      await observe(page, `${label}-${phase}-home-yesterday-exact-summary`, Object.values(briefFields).every(field => field.visible) && Object.entries(checks).filter(([key]) => key !== 'expected').every(([, pass]) => pass) && actualBriefChecks.apiReviewDate && actualBriefChecks.apiAmount && actualBriefChecks.uiAmountMatchesActualApi && source === 'server' && briefFields.provenance.text.includes(generatedMinute), JSON.stringify({ checks, actualBriefChecks, fields: briefFields, actualUiSource: source, actualBrief: brief, bindingBoundary: 'Actual response facts and current UI must both match the frozen sources; the minute label does not identify a React commit', historicalInsightBoundary: 'Only the current dated review is judged; historical snapshot wording is separate and unchanged' }));
      const weeklyFields = await fields('weekly', `${phase}-home-seven`), weeklyText = [...new Set(['title', 'scope', 'amount', 'provenance'].map(key => weeklyFields[key]).filter(field => field.present).map(field => field.text))].join('\n'), weeklyExpected = expectedSummary(rows, today, 'seven'), weeklyChecks = summaryReading(weeklyText, weeklyExpected);
      await observe(page, `${label}-${phase}-home-seven-exact-summary`, Object.values(weeklyFields).every(field => field.visible) && Object.entries(weeklyChecks).filter(([key]) => key !== 'expected').every(([, pass]) => pass) && !/云端|实时/.test(weeklyFields.provenance.text), JSON.stringify({ checks: weeklyChecks, fields: weeklyFields, source: 'Actual local recorded-data card; the separate cloud brief cannot supply its amount or provenance', missingFieldsAreReaderGaps: true }));
      await clock(`${phase}-home-reading-done`, brief);
    } finally { clearTimeout(timer); page.off('response', onResponse); }
  }
  return {
    // The terminal current-page chat task reuses this exact bounded source
    // sampler and reading geometry; it does not create another DB framework.
    snapshot, preserve, read,
    async readExpenseCategory() {
      const selector = 'select[aria-label="记账分类"]', reading = await read(selector);
      const selected = await page.$eval(selector, el => ({ value: el.value, label: el.selectedOptions[0]?.textContent.trim() }));
      await observe(page, `${label}-financial-native-expense-category`, reading.visible && selected.value === 'food' && selected.label === '餐饮', JSON.stringify({ targetId: sources[0].id, reading, selected, expected: { value: 'food', label: '餐饮' }, note: 'Actual already-open source editor before its existing one-time amount correction' }));
    },
    async visit(phase) {
      assert.ok(['before', 'after'].includes(phase)); let completed = false;
      await segment(page, `${label}-financial-${phase}`, async () => {
        try {
          await clock(`${phase}-start`);
          if (!frozen) {
            assert.equal(phase, 'before');
            assert.deepEqual(sources.map(row => ({ amount: row.amount, date: row.date, category: row.category, isIncome: row.isIncome })), [
              { amount: 5025, date: shift(today, -1), category: 'food', isIncome: false },
              { amount: 2010, date: shift(today, -10), category: 'food', isIncome: false },
              { amount: 90000, date: shift(today, -2), category: 'income', isIncome: true },
            ], 'The original historical API declaration must use one real business day');
            frozen = await snapshot('original-freeze');
            assert.ok(expense.sameRows(frozen.server, sources), 'The complete original API-returned source rows must still match the external pre-editor freeze');
            await save('declaration', { today, fixtureOrigin: 'EXPLICIT historical API fixture; no native creation claim', sources, expected: ['yesterday', 'week', 'seven'].map(kind => expectedSummary(frozen.server, today, kind)), boundary: 'Wednesday periods can have equal totals; Monday week excludes yesterday; Sunday windows coincide. No fourth row or native unequal-filter claim.' });
          }
          const before = phase === 'before' ? frozen : await snapshot(`${phase}-before-questions`);
          if (phase === 'after') {
            const pass = correctionMatches(frozen, before, sources[0].id);
            await observe(page, `${label}-financial-original-to-correction`, pass, JSON.stringify({ targetId: sources[0].id, originalAmount: 5025, expectedAmount: 4025, settingsDifferences: expense.settingsDifferences(frozen, before), sourceArtifact: `${label}-financial-original-freeze-sources.json`, note: 'External original freeze remains the reference; exactly one native same-ID Expense upsert and every old all-entity ledger row/neighbor/history field retained' }));
            assert.ok(pass, 'Original correction prerequisite failed; do not repeat Save');
          }
          await openPage(page, '/coach'); await page.waitForSelector('textarea[aria-label="输入消息"]');
          for (const item of QUESTIONS) await question(item, before.server, phase);
          const afterQuestions = await snapshot(`${phase}-after-questions`); await preserve(before, afterQuestions, `${phase}-questions`);
          await readHome(before.server, phase);
          const afterHome = await snapshot(`${phase}-after-home`); await preserve(afterQuestions, afterHome, `${phase}-home`);
          await clock(`${phase}-finished`);
          await openPage(page, '/insights'); completed = true;
        } catch (error) {
          await snapshot(`${phase}-first-failure`).catch(sourceError => save(`${phase}-source-capture-blocked`, { error: sourceError.message }));
          throw error;
        }
      });
      return completed;
    },
  };
}
