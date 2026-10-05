import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import type { CoachInsightRecord } from '../src/stores/coachStore';
import type { DiaryRecord } from '../src/db';
import type { QuickNoteRecord } from '../src/stores/quickNoteStore';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() };
};
Object.assign(globalThis, {
  localStorage: memoryStorage(), sessionStorage: memoryStorage(),
  window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { replace() {} } }),
  document: { documentElement: { setAttribute() {} } },
});
process.env.JWT_SECRET = 'synthetic-humane-test-secret-at-least-32-characters';
process.env.NODE_ENV = 'test';
process.env.LLM_API_KEY = '';
process.env.DATABASE_URL = 'file::memory:';
const storage = await import('../src/db/index.ts');
const { useSettingsStore, stopPreferenceSync, PREFERENCE_STATE_KEY } = await import('../src/stores/settingsStore.ts');
const session = await import('../src/services/apiClient.ts');
const { useDiaryStore } = await import('../src/stores/diaryStore.ts');
const { useQuickNoteStore } = await import('../src/stores/quickNoteStore.ts');
const { useExpenseStore, checkBudgetThreshold } = await import('../src/stores/expenseStore.ts');
const { useHabitStore } = await import('../src/stores/habitStore.ts');
const { useCoachStore } = await import('../src/stores/coachStore.ts');
const control = await import('../src/services/pushControl.ts');
const life = await import('../src/services/lifeIntelligence.ts');
const emotion = await import('../src/services/emotionEngine.ts');
const engine = await import('../src/services/coachEngine.ts');
const safety = await import('../server/src/services/safetyResources.ts');
const chat = await import('../server/src/routes/chat.ts');
const { prisma } = await import('../server/src/utils/db.ts');
const { addDays, getToday, getBusinessDayStartTimestamp } = await import('../src/utils/date.ts');
const { pauseSync } = await import('../src/services/syncEngine.ts');

const diary = (id: string, date: string, score = 5): DiaryRecord => ({ id, date, mood: null, moodScore: score, content: 'synthetic diary', source: 'manual', quickNoteIds: [], createdAt: getBusinessDayStartTimestamp(date), updatedAt: getBusinessDayStartTimestamp(date) });
const note = (id: string, date: string): QuickNoteRecord => ({ id, createdAt: getBusinessDayStartTimestamp(date), rawInput: 'synthetic note', expenses: [], diary: null, mood: null, moodScore: 5, habits: [], todos: [] });
const insight = (id: string, type: CoachInsightRecord['type']): CoachInsightRecord => ({ id, type, title: id, description: 'synthetic', dataSources: [], significance: 0.7, dismissed: false, createdAt: Date.now() });
const emptyContext = { recentExpenses: { total: 0, count: 0, categories: {} }, habits: [], recentTodos: [], recentDiary: [], schedules: [] };

async function setPreferences(updates: Partial<import('../src/stores/settingsStore').AppSettings>) {
  useSettingsStore.setState(updates);
  const values = useSettingsStore.getState();
  const account = { coachStyle: values.coachStyle, coachPushEnabled: values.coachPushEnabled, coachPushFrequency: values.coachPushFrequency, quietHours: values.quietHours, eveningReviewEnabled: values.eveningReviewEnabled, eveningReviewTime: values.eveningReviewTime };
  const previous = (await storage.db.settings.get(PREFERENCE_STATE_KEY))?.value;
  await storage.db.settings.put({ key: PREFERENCE_STATE_KEY, value: { version: 1, epoch: 'initial', localRevision: (previous?.localRevision ?? 0) + 1, server: { protocol: 1, revision: '0', settings: account }, initial: account, active: null, queued: null } });
}

before(async () => { await storage.bindAccountDatabase('synthetic-humane-coaching'); });
beforeEach(async () => {
  for (const table of storage.db.tables) await table.clear();
  session.setSessionActive('synthetic-humane-coaching');
  globalThis.fetch = async () => Response.json({ protocol: 1, revision: '0', settings: { coachStyle: 'gentle', coachPushEnabled: false, pushLimit: 2, quietEnabled: true, quietStart: '23:00', quietEnd: '07:00', eveningReviewEnabled: false, eveningReviewTime: '21:00' } });
  await useSettingsStore.getState().loadSettings(); await useSettingsStore.getState().syncPreferences();
  await setPreferences({ coachPushEnabled: true, coachPushFrequency: 2, quietHours: { enabled: false, start: '23:00', end: '07:00' }, eveningReviewEnabled: true });
  useDiaryStore.setState({ items: [] });
  useQuickNoteStore.setState({ records: [] });
  useExpenseStore.setState({ items: [], monthBudget: 0 });
  useHabitStore.setState({ items: [] });
  useCoachStore.setState({ insights: [], pushes: [] });
});
after(async () => { stopPreferenceSync(); session.clearSession(); pauseSync(); storage.db.close(); await prisma.$disconnect(); });

test('every reminder type respects disabled reminders, quiet hours, snooze and the total daily cap', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T15:15:00Z') }); // 23:15 Shanghai
  const types = ['anomaly', 'follow_up', 'positive', 'evening_review'] as const;
  const state = await control.getPushControlState();
  for (const type of types) assert.equal(await control.canPush(state, type), true, type);
  await setPreferences({ coachPushEnabled: false });
  for (const type of types) assert.equal(await control.canPush(state, type), false, `${type} opt out`);
  await setPreferences({ coachPushEnabled: true, quietHours: { enabled: true, start: '23:00', end: '07:00' } });
  for (const type of types) assert.equal(await control.canPush(state, type), false, `${type} quiet`);
  await setPreferences({ quietHours: { enabled: false, start: '23:00', end: '07:00' } });
  for (const type of types) assert.equal(await control.canPush({ ...state, silenceUntil: Date.now() + 1000 }, type), false, `${type} snooze`);
  for (const type of types) assert.equal(await control.canPush({ ...state, todayPushCount: state.maxDailyPushes }, type), false, `${type} max`);
  await setPreferences({ coachPushFrequency: 0 });
  for (const type of types) assert.equal(await control.canPush(state, type), false, `${type} zero after settings change`);
});

test('positive reminders share the budget and have a one-per-day limit; evening review opt-out remains independent', async () => {
  const batch = [insight('p1', 'positive'), insight('p2', 'positive'), insight('a1', 'anomaly'), insight('a2', 'anomaly')];
  assert.deepEqual((await engine.generatePushesFromInsights(batch)).map((p) => p.title), ['p1', 'a1']);
  await control.recordPositiveSent();
  await control.recordPushSent();
  assert.deepEqual((await engine.generatePushesFromInsights(batch)).map((p) => p.title), ['a1']);
  await control.recordPushSent();
  assert.equal((await engine.generatePushesFromInsights(batch)).length, 0);
  await setPreferences({ eveningReviewEnabled: false });
  assert.equal(await control.canPush({ ...await control.getPushControlState(), todayPushCount: 0 }, 'evening_review'), false);
});

test('insight generation cannot bypass zero cap, quiet hours, snooze or disabled reminders', async () => {
  const batch = [insight('positive', 'positive'), insight('anomaly', 'anomaly')];
  await setPreferences({ coachPushFrequency: 0 });
  assert.deepEqual(await engine.generatePushesFromInsights(batch), []);
  await setPreferences({ coachPushFrequency: 2, coachPushEnabled: false });
  assert.deepEqual(await engine.generatePushesFromInsights(batch), []);
  await setPreferences({ coachPushEnabled: true });
  await storage.setSetting('silenceUntil', Date.now() + 60000);
  assert.deepEqual(await engine.generatePushesFromInsights(batch), []);
});

test('daily counters survive concurrent updates and reset together on business-day rollover', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T15:59:00Z') });
  await Promise.all(Array.from({ length: 5 }, () => control.recordPushSent()));
  await control.recordPositiveSent();
  assert.equal((await control.getPushControlState()).todayPushCount, 5);
  t.mock.timers.setTime(new Date('2026-10-04T16:01:00Z').getTime());
  const state = await control.getPushControlState();
  assert.equal(state.todayDate, '2026-10-05');
  assert.equal(state.todayPushCount, 0);
  assert.equal(state.todayPositiveCount, 0);
});

test('current period progress and actual seven-day dated facts are separate; audit creation never discards explicit facts', async () => {
  const today = getToday();
  await storage.db.habits.bulkPut([
    { id: 'daily', name: 'daily', icon: 'a', frequency: 'daily', sortOrder: 0, createdAt: getBusinessDayStartTimestamp(addDays(today, -2)) },
    { id: 'weekly', name: 'weekly', icon: 'b', frequency: 'weekly', sortOrder: 1, createdAt: getBusinessDayStartTimestamp(addDays(today, -30)) },
    { id: 'future', name: 'future', icon: 'c', frequency: 'daily', sortOrder: 2, createdAt: getBusinessDayStartTimestamp(addDays(today, 1)) },
  ]);
  for (const [habitId, offsets] of [['daily', [0, -1, -2, -5]], ['weekly', [0, -1]], ['future', [0]]] as const) {
    for (const offset of offsets) {
      const date = addDays(today, offset);
      await storage.db.habitCheckins.put({ id: `${habitId}|${date}`, habitId, date, done: true, confirmed: true, source: 'manual', updatedAt: Date.now() });
    }
  }
  const stats = await life.computeWeeklyStats();
  assert.equal(stats.habitExpectedCount, 3);
  assert.equal(stats.habitRecordCount, 7);
  assert.equal(stats.habitRecordDays, 4);
  assert.equal(stats.habitCompletionRate, 100);
});

test('todo summary uses a dated seven-day cohort, never all-time completions or inferred completion time', async () => {
  const today = getToday();
  const base = { text: 'synthetic', priority: 'medium' as const, done: true };
  await storage.db.todos.bulkPut([
    { ...base, id: 'old', dueDate: addDays(today, -30) },
    { ...base, id: 'unknown-date' },
    { ...base, id: 'due-now', dueDate: today },
    { ...base, id: 'due-future', dueDate: addDays(today, 10) },
    { ...base, id: 'recent-created', createdAt: getBusinessDayStartTimestamp(addDays(today, -2)) },
    { ...base, id: 'iso-created', createdAt: new Date(getBusinessDayStartTimestamp(today)).toISOString(), done: false },
  ]);
  const stats = await life.computeWeeklyStats();
  assert.equal(stats.todoTotalCount, 3);
  assert.equal(stats.todoDoneCount, 2);
  assert.match(stats.todoCohortDescription, /当前完成状态/);
  assert.match(await life.generateWeeklyReview(), /近7天创建或到期/);
});

test('diary count includes unscored entries and active days include diary-only and note-only activity', async () => {
  const today = getToday();
  await storage.db.diary.bulkPut([diary('today', today, 0), diary('yesterday', addDays(today, -1), 0)]);
  await storage.db.quickNotes.bulkPut([note('note-only', addDays(today, -2)), note('duplicate-day', today), note('old', addDays(today, -8)), note('future', addDays(today, 1))]);
  const stats = await life.computeWeeklyStats();
  assert.equal(stats.diaryEntryCount, 2);
  assert.equal(stats.avgMoodScore, null);
  assert.equal(stats.daysActive, 3);
});

test('mood trends remain descriptive and never prescribe spending or social isolation from diary scores', async () => {
  const today = getToday();
  await storage.db.diary.bulkPut([9, 8, 4, 3].map((score, index) => diary(`mood-${index}`, addDays(today, index - 3), score)));
  const mood = (await life.generateRealInsights()).find((row) => row.dataSources.includes('mood'));
  assert.ok(mood);
  assert.equal(mood.type, 'pattern');
  assert.match(mood.description, /不能据此判断原因/);
  assert.doesNotMatch(mood.description, /减少.*消费|减少.*社交|冲动消费/);
});

test('current self-harm cues get support, while generic words, negation, past events and third-party quotes do not', () => {
  for (const text of ['我现在不想活了', '我想死', '我想伤害自己', '我现在准备结束自己的生命', '以前想过自杀，但是我现在又想死了']) {
    assert.equal(emotion.detectCrisisKeywords(text), true, text);
  }
  for (const text of ['烦恼终于消失了', '把这件事了结', '以前我想死，现在安全了', '我不想自杀', '我不想死', '电影角色想死', '朋友说想死', '今天讨论自杀预防', '昨天我想死', '我不是想死', '不想活了是什么意思']) {
    assert.equal(emotion.detectCrisisKeywords(text), false, text);
  }
  assert.equal(emotion.assessEmotionState('我现在想死').state, 'crisis');
});

test('historical diary content does not lock normal conversation into crisis mode, even when recently edited', () => {
  const old = { ...diary('old', addDays(getToday(), -30), 2), content: '以前我想死', updatedAt: Date.now(), mood: 'sad' };
  useDiaryStore.setState({ items: [old] });
  useQuickNoteStore.setState({ records: [{ ...note('recent-historical', getToday()), rawInput: '旧日记里写过想死，现在安全了' }] });
  const assessed = emotion.assessEmotionState();
  assert.equal(assessed.state, 'normal');
  assert.equal(assessed.shouldOnlyCompanion, false);
  for (let i = 0; i < 20; i++) assert.doesNotMatch(emotion.getCompanionResponse(), /没有什么必须做|什么都不做|一直在/);
});

test('safety resource and supportive text have frontend/backend parity, provenance and no invented availability', async () => {
  assert.equal(emotion.getCrisisResponse(), safety.getSafetySupportResponse());
  assert.equal(chat.generateFallbackResponse('我现在想死', emptyContext).content, emotion.getCrisisResponse());
  assert.equal(safety.mainlandPsychologicalSupport.phone, '12356');
  assert.equal(safety.mainlandPsychologicalSupport.verifiedAt, '2026-10-04');
  assert.equal(safety.mainlandPsychologicalSupport.region, '中国大陆');
  assert.ok(safety.mainlandPsychologicalSupport.sources.every((source) => new URL(source.url).hostname === 'www.nhc.gov.cn'));
  assert.match(emotion.getCrisisResponse(), /当地急救|急诊/);
  assert.doesNotMatch(emotion.getCrisisResponse(), /24小时|400-|010-|一直在/);
  const page = await readFile(new URL('../src/pages/Coach.tsx', import.meta.url), 'utf8');
  assert.match(page, /href=\{mainlandPsychologicalSupport.tel\}/);
  assert.doesNotMatch(page, /tel:400|shouldOnlyCompanion/);
});

test('rule replies disclose their source, handle empty data honestly, and do not force actions when mood is low', () => {
  for (const message of ['查看待办', '日程', '习惯', '花销', '你好']) {
    const result = chat.generateFallbackResponse(message, emptyContext);
    assert.match(result.content, /规则回复/);
    assert.match(result.content, /在线模型当前不可用/);
  }
  assert.doesNotMatch(chat.generateFallbackResponse('习惯', emptyContext).content, /还有习惯没完成/);
  assert.match(chat.generateFallbackResponse('日程', emptyContext).content, /不代表你没有其他安排/);
  assert.deepEqual(chat.generateFallbackResponse('我很难过', emptyContext).actions, []);
  const prompt = chat.buildCoachSystemPrompt('strict', emptyContext);
  assert.match(prompt, /12356/);
  assert.match(prompt, /不得自编号码/);
  assert.doesNotMatch(prompt, /400-161|每次对话导向/);
});

test('engine does not invent personal correlations or fill empty data with random advice', () => {
  assert.deepEqual(engine.runCoachEngine(), []);
  useExpenseStore.setState({ items: [{ id: 'expense', name: 'synthetic', amount: 9000, category: 'food', date: getToday() }] });
  const observed = engine.runCoachEngine();
  assert.equal(observed.length, 1);
  assert.doesNotMatch(observed[0].description, /比平时|非必要|冲动消费/);
  useDiaryStore.setState({ items: [{ ...diary('low', getToday(), 2), mood: 'sad' }] });
  assert.deepEqual(engine.runCoachEngine(), []);
});


test('atomic delivery shares one cap across competing flows, prevents duplicate positives, and refunds failed local delivery', async () => {
  const deliveries: string[] = [];
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => control.deliverControlledPush('anomaly', `parallel-${index}`, async () => { deliveries.push(String(index)); })));
  assert.equal(results.filter(Boolean).length, 2);
  assert.equal(deliveries.length, 2);
  assert.equal((await control.getPushControlState()).todayPushCount, 2);

  await storage.db.settings.clear();
  await setPreferences({ coachPushEnabled: true, coachPushFrequency: 2, quietHours: { enabled: false, start: '23:00', end: '07:00' } });
  assert.equal(await control.deliverControlledPush('positive', 'same', async () => {}), true);
  assert.equal(await control.deliverControlledPush('positive', 'other', async () => {}), false);
  assert.equal((await control.getPushControlState()).todayPositiveCount, 1);
  assert.equal(await control.deliverControlledPush('anomaly', 'duplicate', async () => false), false);
  assert.equal((await control.getPushControlState()).todayPushCount, 1);
  await assert.rejects(control.deliverControlledPush('anomaly', 'failing', async () => {
    await storage.db.coachPushes.put({ id: 'failed-push', type: 'anomaly', title: 'failing', body: 'synthetic', actions: [], read: false, acted: false, createdAt: Date.now() });
    throw new DOMException('synthetic quota', 'QuotaExceededError');
  }), /quota/);
  assert.equal(await storage.db.coachPushes.get('failed-push'), undefined);
  assert.equal((await control.getPushControlState()).todayPushCount, 1);
  assert.equal(await control.deliverControlledPush('anomaly', 'failing', async () => {}), true);
});

test('direct expense alerts respect disabled, quiet, snoozed and shared budget limits', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T15:15:00Z') });
  useExpenseStore.setState({ monthBudget: 10000, budgetStatus: 'configured' });
  await storage.db.expenses.put({ id: 'budget-expense', name: 'synthetic', amount: 9000, category: 'food', date: getToday() });
  await setPreferences({ coachPushEnabled: false });
  await checkBudgetThreshold();
  assert.equal(useCoachStore.getState().pushes.length, 0);
  await setPreferences({ coachPushEnabled: true, coachPushFrequency: 0 });
  await checkBudgetThreshold();
  assert.equal(useCoachStore.getState().pushes.length, 0);
  await setPreferences({ coachPushFrequency: 2, quietHours: { enabled: true, start: '23:00', end: '07:00' } });
  await checkBudgetThreshold();
  assert.equal(useCoachStore.getState().pushes.length, 0);
  await setPreferences({ quietHours: { enabled: false, start: '23:00', end: '07:00' } });
  await storage.setSetting('silenceUntil', Date.now() + 60000);
  await checkBudgetThreshold();
  assert.equal(useCoachStore.getState().pushes.length, 0);
  await storage.setSetting('silenceUntil', null);
  await control.deliverControlledPush('positive', 'encouragement', async () => {});
  await checkBudgetThreshold();
  assert.equal(useCoachStore.getState().pushes.length, 1);
  assert.equal((await control.getPushControlState()).todayPushCount, 2);
  // Simulate a read alert and a subsequent higher threshold in another flow.
  useCoachStore.setState({ pushes: [] });
  await storage.db.expenses.put({ id: 'budget-extra', name: 'synthetic', amount: 2000, category: 'food', date: getToday() });
  await checkBudgetThreshold();
  assert.equal(useCoachStore.getState().pushes.length, 0);
});

test('final evening review delivery rechecks the latest configured time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T12:00:00Z') }); // 20:00 Shanghai
  await setPreferences({ coachPushEnabled: true, eveningReviewEnabled: true, eveningReviewTime: '00:00', quietHours: { enabled: false, start: '23:00', end: '07:00' } });
  let delivered = false;
  assert.equal(await control.deliverControlledPush('evening_review', 'old-prepared-review', async () => { delivered = true; }), false);
  assert.equal(delivered, false); assert.equal((await control.getPushControlState()).todayPushCount, 0);
});

test('independent concurrent ignore feedback increments atomically', async () => {
  await Promise.all([control.recordPushIgnored(), control.recordPushIgnored()]);
  assert.equal(await storage.getSetting('consecutiveIgnores', 0), 2);
});
