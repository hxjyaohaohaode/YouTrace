import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
};
Object.assign(globalThis, {
  React,
  localStorage: memoryStorage(), sessionStorage: memoryStorage(),
  window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }),
  document: { documentElement: { setAttribute() {} } },
});
const storage = await import('../src/db/index.ts');
const { useCoachStore } = await import('../src/stores/coachStore.ts');
const api = await import('../src/services/apiClient.ts');
const { pauseSync } = await import('../src/services/syncEngine.ts');
const { BriefCard } = await import('../src/components/home/BriefCard.tsx');
const snapshot = { id: 'server-snapshot', type: 'suggestion', title: '记录简报', description: 'synthetic', dataSources: ['expense'], dismissed: false, createdAt: '2026-10-04T06:30:00.000Z' };
const brief = { greeting: '下午好', date: '10月4日 周日', reviewDate: '2026-10-03', generatedAt: '2026-10-04T06:31:00.000Z', yesterdayReview: { spent: 0, spentDiff: null, habits: { done: 0, total: 0 }, moodScore: null }, weeklyInsights: [snapshot], todayActions: [], todaySchedule: [] };
before(async () => { await storage.bindAccountDatabase('synthetic-brief'); });
beforeEach(() => { api.clearSession(); useCoachStore.setState({ dailyBrief: null, insights: [] }); });
after(() => { pauseSync(); api.clearSession(); storage.db.close(); });

test('server brief generates before loading and retains the exact snapshot timestamp', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T06:30:00Z') });
  api.setSessionActive('synthetic-brief');
  const calls: string[] = [];
  const preciseBrief = { ...brief, yesterdayReview: { ...brief.yesterdayReview, spent: 50.25, expenseCount: 1 } };
  globalThis.fetch = async (input) => { calls.push(String(input)); return Response.json(String(input).endsWith('generate-brief') ? { insight: snapshot } : { brief: preciseBrief }); };
  const result = await useCoachStore.getState().generateDailyBrief();
  assert.deepEqual(calls, ['/api/coach/generate-brief', '/api/coach/brief']);
  assert.equal(result?.source, 'server');
  assert.equal(result?.reviewDate, '2026-10-03');
  assert.equal(result?.yesterdayReview.spent, 50.25);
  assert.equal(result?.yesterdayReview.expenseCount, 1);
  assert.equal(result?.weeklyInsights[0].createdAt, Date.parse(snapshot.createdAt));
  assert.equal(useCoachStore.getState().insights[0]?.id, snapshot.id);
  await useCoachStore.getState().generateDailyBrief();
  assert.equal(calls.filter((path) => path.endsWith('generate-brief')).length, 1, 'no repeated snapshot generation on same-day navigation');
});

test('navigation cancellation during generation prevents later loads and store writes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T06:30:00Z') });
  api.setSessionActive('synthetic-brief');
  let current = true;
  const calls: string[] = [];
  globalThis.fetch = async (input) => { calls.push(String(input)); current = false; return Response.json({ insight: snapshot }); };
  const result = await useCoachStore.getState().generateDailyBrief({ isCurrent: () => current });
  assert.equal(result, null);
  assert.deepEqual(calls, ['/api/coach/generate-brief']);
  assert.equal(useCoachStore.getState().dailyBrief, null);
  assert.deepEqual(useCoachStore.getState().insights, []);
});

test('already-cancelled home work makes no request', async () => {
  api.setSessionActive('synthetic-brief');
  globalThis.fetch = async () => { assert.fail('cancelled work must not request'); };
  assert.equal(await useCoachStore.getState().generateDailyBrief({ isCurrent: () => false }), null);
});

test('guest brief labels local scope and carries persisted insight age', async () => {
  await storage.db.coachInsights.put({ ...snapshot, dataSources: ['expense'], significance: 0.5, type: 'suggestion', createdAt: Date.parse(snapshot.createdAt) });
  const result = await useCoachStore.getState().generateDailyBrief();
  assert.equal(result?.source, 'local');
  assert.ok(result?.generatedAt);
  assert.equal(result?.weeklyInsights[0].createdAt, Date.parse(snapshot.createdAt));
});

test('overlapping home loads share one generation and only the newer request writes state', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-06T06:30:00Z') });
  api.setSessionActive('synthetic-brief');
  const calls: string[] = [];
  let completeGeneration: (response: Response) => void = () => assert.fail('generation not started');
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (String(input).endsWith('generate-brief')) return new Promise<Response>((resolve) => { completeGeneration = resolve; markStarted(); });
    return Response.json({ brief });
  };
  const older = useCoachStore.getState().generateDailyBrief();
  await started;
  const newer = useCoachStore.getState().generateDailyBrief();
  completeGeneration(Response.json({ insight: snapshot }));
  assert.equal(await older, null);
  assert.ok(await newer);
  assert.deepEqual(calls, ['/api/coach/generate-brief', '/api/coach/brief']);
  assert.equal(useCoachStore.getState().insights.length, 1);
});

test('network fallback exposes local scope rather than claiming synced cloud data', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T06:30:00Z') });
  api.setSessionActive('synthetic-brief');
  globalThis.fetch = async () => Response.json({ error: 'synthetic offline' }, { status: 503 });
  const result = await useCoachStore.getState().generateDailyBrief();
  assert.equal(result?.source, 'local');
  assert.ok(result?.generatedAt);
});

test('brief UI dates historical evidence, labels source, and never calls it this week', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(BriefCard, { data: {
    ...brief, source: 'server', generatedAt: Date.parse(brief.generatedAt),
    weeklyInsights: [{ ...snapshot, type: 'suggestion', title: '今日教练简报', createdAt: Date.parse('2026-09-01T06:00:00Z') }],
  } })));
  assert.match(html, /云端已同步记录/);
  assert.match(html, /2026-10-03 记录回顾/);
  assert.match(html, /洞察快照/);
  assert.match(html, /记录简报 · 2026-09-01/);
  assert.match(html, /2026\/09\/01 14:00/);
  assert.match(html, /后续记录变动可能尚未计入/);
  assert.match(html, /已记录支出 ¥0\.00/);
  assert.doesNotMatch(html, /共\d+笔/, 'an older response with no expenseCount must not invent zero records');
  assert.doesNotMatch(html, /本周发现|今日教练简报/);
});

test('local brief preserves cents and actual count through source correction without changing history or neighbours', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-07T04:00:00Z') });
  const providerFetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request for local brief'); });
  const expense = (id: string, date: string, amount: number, category = 'food', isIncome = false) => ({ id, date, amount, category, isIncome, name: `Synthetic ${id}` });
  await storage.db.expenses.bulkPut([
    expense('yesterday', '2026-10-06', 5025), expense('today', '2026-10-07', 207),
    expense('previous', '2026-09-30', 2010), expense('future', '2026-10-08', 8888),
    expense('income', '2026-10-06', 90000, 'food', true), expense('legacy-income', '2026-10-06', 90000, 'income'),
  ]);
  const sources = await storage.db.expenses.toArray(), history = await storage.db.coachInsights.toArray();
  for (const amount of [50.25, 40.25]) {
    if (amount === 40.25) await storage.db.expenses.update('yesterday', { amount: 4025 });
    const result = await useCoachStore.getState().generateDailyBrief();
    assert.ok(result);
    assert.equal(result.source, 'local');
    assert.equal(result.generatedAt, Date.parse('2026-10-07T04:00:00Z'));
    assert.equal(result.reviewDate, '2026-10-06');
    assert.equal(result.yesterdayReview.spent, amount);
    assert.equal(result.yesterdayReview.expenseCount, 1);
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(BriefCard, { data: result })));
    assert.ok(html.includes(`已记录支出 ¥${amount.toFixed(2)}，共1笔`));
    assert.match(html, /本机记录/);
  }
  assert.deepEqual(await storage.db.expenses.toArray(), sources.map(row => row.id === 'yesterday' ? { ...row, amount: 4025 } : row));
  assert.deepEqual(await storage.db.coachInsights.toArray(), history);
  assert.equal(providerFetch.mock.callCount(), 0);
});

test('an explicit zero count renders while older API responses keep missing counts missing', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-08T04:00:00Z') });
  api.setSessionActive('synthetic-brief');
  globalThis.fetch = async input => Response.json(String(input).endsWith('generate-brief') ? { insight: snapshot } : { brief });
  const result = await useCoachStore.getState().generateDailyBrief();
  assert.ok(result);
  assert.equal(result.source, 'server');
  assert.equal(result.yesterdayReview.expenseCount, undefined);
  const render = (data: typeof result) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(BriefCard, { data })));
  assert.doesNotMatch(render(result), /共\d+笔/);
  assert.match(render({ ...result, yesterdayReview: { ...result.yesterdayReview, expenseCount: 0 } }), /已记录支出 ¥0\.00，共0笔/);
});
