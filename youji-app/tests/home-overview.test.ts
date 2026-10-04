import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getExpenseOverview,
  getHabitOverview,
  getOverviewRefreshDelay,
  getScheduleOverview,
} from '../src/lib/homeOverview.ts';
import type { HabitView } from '../src/stores/habitStore';
import type { ExpenseItem } from '../src/stores/expenseStore';
import type { ScheduleRecord } from '../src/db';

const at = (date: string, time = '12:00') => new Date(`${date}T${time}:00+08:00`);
const expense = (overrides: Partial<ExpenseItem> = {}): ExpenseItem => ({
  id: 'synthetic-expense', name: '合成消费', date: '2026-10-04', amount: 1000, category: 'food', ...overrides,
});
const habit = (overrides: Partial<HabitView> = {}): HabitView => ({
  id: 'synthetic-habit', name: '散步', icon: '🌱', frequency: 'daily', sortOrder: 0,
  createdAt: at('2026-09-01').getTime(), done: false, streak: 0, recentCheckins: [], ...overrides,
});
const schedule = (overrides: Partial<ScheduleRecord> = {}): ScheduleRecord => ({
  id: 'synthetic-schedule', title: '合成日程', date: '2026-10-04', startTime: '09:00', endTime: '10:00',
  type: 'other', location: '', repeat: 'none', remind: 0, createdAt: 0, updatedAt: 0, ...overrides,
});

test('monthly spending excludes explicit and legacy-category income', () => {
  const items = [
    expense({ amount: 125 }),
    expense({ amount: 200, isIncome: true }),
    expense({ amount: 300, category: 'income' }),
    expense({ amount: 400, category: 'income', isIncome: false }),
  ];
  assert.deepEqual(getExpenseOverview(items, 0, at('2026-10-04')), {
    value: '¥1.25', sub: '本月收入 ¥9',
  });
});

test('monthly spending and income exclude future dates and adjacent months', () => {
  const items = [
    expense({ date: '2026-10-01', amount: 10 }),
    expense({ date: '2026-10-04', amount: 15 }),
    expense({ date: '2026-10-04', amount: 50, isIncome: true }),
    expense({ date: '2026-10-05', amount: 10000 }),
    expense({ date: '2026-10-05', amount: 10000, isIncome: true }),
    expense({ date: '2026-09-30', amount: 10000 }),
    expense({ date: '2026-09-30', amount: 10000, category: 'income' }),
    expense({ date: '2026-11-01', amount: 10000 }),
  ];
  assert.deepEqual(getExpenseOverview(items, 0, at('2026-10-04')), {
    value: '¥0.25', sub: '本月收入 ¥0.5',
  });
});

test('expense, income and budget formatting preserve cents rather than rounding small amounts to zero', () => {
  assert.deepEqual(getExpenseOverview([expense({ amount: 1 })], 25, at('2026-10-04')), {
    value: '¥0.01', sub: '预算 ¥0.25',
  });
  assert.deepEqual(getExpenseOverview([expense({ amount: 1, category: 'income' })], 0, at('2026-10-04')), {
    value: '¥0', sub: '本月收入 ¥0.01',
  });
});

test('recorded spending without budget or income is never called empty', () => {
  assert.deepEqual(getExpenseOverview([expense({ amount: 25 })], 0, at('2026-10-04')), {
    value: '¥0.25', sub: '本月已记录 1 笔',
  });
  assert.deepEqual(getExpenseOverview([], 0, at('2026-10-04')), {
    value: '¥0', sub: '本月暂无记录',
  });
});

test('Shanghai month rollover changes the expense cohort using the same refreshed clock', () => {
  const items = [expense({ date: '2026-09-30', amount: 99 }), expense({ date: '2026-10-01', amount: 25 })];
  assert.equal(getExpenseOverview(items, 0, new Date('2026-09-30T15:59:59.999Z')).value, '¥0.99');
  assert.equal(getExpenseOverview(items, 0, new Date('2026-09-30T16:00:00.000Z')).value, '¥0.25');
});

test('empty habits invite a first habit without inventing completion', () => {
  assert.deepEqual(getHabitOverview([], at('2026-10-04')), {
    label: '今日习惯', value: '0 项', sub: '添加第一个习惯',
  });
});

test('future habits are not obligations or completed habits today', () => {
  const future = habit({ createdAt: at('2026-10-05', '00:00').getTime(), done: true });
  assert.deepEqual(getHabitOverview([future], at('2026-10-04')), {
    label: '今日习惯', value: '0 项', sub: '今天暂无需要打卡的习惯',
  });
  assert.equal(getHabitOverview([habit(), future], at('2026-10-04')).value, '0/1');
});

test('daily completion uses dated check-ins, not cached done or streak values', () => {
  const items = [
    habit({ name: '散步', done: false, recentCheckins: [{ date: '2026-10-04', done: true }] }),
    habit({ id: 'stale', name: '阅读', done: true, streak: 99, recentCheckins: [{ date: '2026-10-03', done: true }] }),
    habit({ id: 'unchecked', name: '伸展', done: true, recentCheckins: [{ date: '2026-10-04', done: false }] }),
  ];
  assert.deepEqual(getHabitOverview(items, at('2026-10-04')), {
    label: '今日习惯', value: '1/3', sub: '阅读 · 伸展',
  });
});

test('only actual daily check-ins produce the all-checked-in state', () => {
  const checked = habit({ recentCheckins: [{ date: '2026-10-04', done: true }] });
  assert.deepEqual(getHabitOverview([checked], at('2026-10-04')), {
    label: '今日习惯', value: '1/1', sub: '今日已全部打卡',
  });
});

test('weekly habits count once in the current natural week, including a prior day', () => {
  const weekly = habit({ frequency: 'weekly', recentCheckins: [
    { date: '2026-09-28', done: true }, { date: '2026-10-02', done: true },
  ] });
  assert.deepEqual(getHabitOverview([weekly], at('2026-10-04')), {
    label: '本周习惯', value: '1/1', sub: '本周已全部打卡',
  });
});

test('mixed frequency totals disclose their daily and weekly windows', () => {
  const weekly = habit({ id: 'weekly', frequency: 'weekly', recentCheckins: [{ date: '2026-09-28', done: true }] });
  assert.deepEqual(getHabitOverview([habit(), weekly], at('2026-10-04')), {
    label: '习惯打卡', value: '1/2', sub: '今日 0/1 · 本周 1/1',
  });
});

test('future, prior-week and pre-creation check-ins cannot complete this week', () => {
  const weekly = habit({ frequency: 'weekly', createdAt: at('2026-10-02').getTime(), recentCheckins: [
    { date: '2026-09-27', done: true }, { date: '2026-10-01', done: true }, { date: '2026-10-05', done: true },
  ] });
  assert.equal(getHabitOverview([weekly], at('2026-10-04')).value, '0/1');
});

test('Shanghai midnight resets daily and Monday weekly results without mutating cached views', () => {
  const checked = habit({ done: true, recentCheckins: [{ date: '2026-10-04', done: true }] });
  const weekly = habit({ ...checked, id: 'weekly', frequency: 'weekly' });
  const before = new Date('2026-10-04T15:59:59.999Z');
  const after = new Date('2026-10-04T16:00:00.000Z');
  assert.equal(getHabitOverview([checked, weekly], before).value, '2/2');
  assert.equal(getHabitOverview([checked, weekly], after).value, '0/2');
  assert.equal(checked.done, true);
  assert.deepEqual(checked.recentCheckins, [{ date: '2026-10-04', done: true }]);
});

test('a long background suspension never carries old completion into the current date', () => {
  const checked = habit({ done: true, recentCheckins: [{ date: '2026-10-04', done: true }] });
  assert.equal(getHabitOverview([checked], at('2026-10-18')).value, '0/1');
});

test('no applicable schedule differs from schedules whose time has ended', () => {
  assert.deepEqual(getScheduleOverview([], at('2026-10-04')), { value: '0 项', sub: '今天没有日程' });
  assert.deepEqual(getScheduleOverview([schedule()], at('2026-10-04')), {
    value: '1 项', sub: '今天的日程已结束',
  });
});

test('finished first entries do not hide the next event, and input order is preserved', () => {
  const upcoming = schedule({ id: 'next', title: '下午安排', startTime: '14:00', endTime: '15:00' });
  const items = Object.freeze([upcoming, schedule({ title: '已结束的安排' })]);
  assert.deepEqual(getScheduleOverview(items, at('2026-10-04', '12:30')), {
    value: '2 项', sub: '下个: 14:00 下午安排 · 1小时30分钟后',
  });
  assert.equal(items[0], upcoming);
});

test('exact start is ongoing and exact end is ended, never perpetual ongoing', () => {
  const items = [schedule()];
  assert.equal(getScheduleOverview(items, at('2026-10-04', '08:29')).sub, '下个: 09:00 合成日程 · 31分钟后');
  assert.equal(getScheduleOverview(items, at('2026-10-04', '08:30')).sub, '即将开始: 合成日程');
  assert.equal(getScheduleOverview(items, at('2026-10-04', '09:00')).sub, '进行中: 合成日程');
  assert.equal(getScheduleOverview(items, at('2026-10-04', '09:59')).sub, '进行中: 合成日程');
  assert.equal(getScheduleOverview(items, at('2026-10-04', '10:00')).sub, '今天的日程已结束');
});

test('ongoing events take priority over later events after an earlier event ends', () => {
  const items = [
    schedule({ title: '已结束' }),
    schedule({ title: '当前安排', startTime: '10:00', endTime: '13:00' }),
    schedule({ title: '稍后安排', startTime: '12:30', endTime: '14:00' }),
  ];
  assert.equal(getScheduleOverview(items, at('2026-10-04')).sub, '进行中: 当前安排');
});

test('a valid ongoing overlap is not hidden by an earlier finished overlap', () => {
  const items = [
    schedule({ title: '早先安排', startTime: '09:00', endTime: '10:30' }),
    schedule({ title: '仍在进行', startTime: '10:00', endTime: '11:30' }),
  ];
  assert.equal(getScheduleOverview(items, at('2026-10-04', '10:30')).sub, '进行中: 仍在进行');
});

test('weekly recurrence matches the weekday and never starts before its anchor date', () => {
  const items = [
    schedule({ title: '上周日的每周安排', date: '2026-09-27', repeat: 'weekly' }),
    schedule({ title: '周六安排', date: '2026-10-03', repeat: 'weekly' }),
    schedule({ title: '下周才开始', date: '2026-10-11', repeat: 'weekly' }),
    schedule({ title: '上周的单次安排', date: '2026-09-27' }),
    schedule({ title: '明天的单次安排', date: '2026-10-05' }),
  ];
  assert.deepEqual(getScheduleOverview(items, at('2026-10-04', '09:30')), {
    value: '1 项', sub: '进行中: 上周日的每周安排',
  });
});

test('schedule date and clock both use Shanghai when the runtime date is still yesterday', () => {
  const items = [schedule({ date: '2026-10-05', startTime: '00:00', endTime: '00:30' })];
  assert.deepEqual(getScheduleOverview(items, new Date('2026-10-04T16:00:00Z')), {
    value: '1 项', sub: '进行中: 合成日程',
  });
  assert.equal(getScheduleOverview(items, new Date('2026-10-04T16:30:00Z')).sub, '今天的日程已结束');
});

test('business midnight drops yesterday and selects the new day after suspension', () => {
  const items = [schedule(), schedule({ date: '2026-10-05', title: '周一安排' })];
  assert.deepEqual(getScheduleOverview(items, at('2026-10-04', '23:59')), {
    value: '1 项', sub: '今天的日程已结束',
  });
  assert.deepEqual(getScheduleOverview(items, at('2026-10-05', '09:30')), {
    value: '1 项', sub: '进行中: 周一安排',
  });
});

test('unsupported overnight, zero-length and malformed ranges request review instead of inventing ongoing status', () => {
  for (const times of [
    { startTime: '23:00', endTime: '01:00' },
    { startTime: '09:00', endTime: '09:00' },
    { startTime: '99:00', endTime: '99:30' },
    { startTime: '9:00', endTime: '10:00' },
    { startTime: '09:00', endTime: '' },
  ]) {
    assert.deepEqual(getScheduleOverview([schedule(times)], at('2026-10-04', '23:30')), {
      value: '1 项', sub: '1 项日程时间待检查',
    });
  }
});

test('invalid entries cannot hide a valid upcoming event or produce an all-ended claim', () => {
  const malformed = schedule({ startTime: '23:00', endTime: '01:00' });
  assert.equal(getScheduleOverview([malformed, schedule()], at('2026-10-04', '08:30')).sub, '即将开始: 合成日程');
  assert.equal(getScheduleOverview([malformed, schedule()], at('2026-10-04', '12:00')).sub, '1 项日程时间待检查');
  assert.deepEqual(getScheduleOverview([schedule({ date: 'invalid', repeat: 'weekly' })], at('2026-10-04')), {
    value: '0 项', sub: '今天没有日程',
  });
});

test('refresh delay aligns to the next minute and midnight and never busy-loops', () => {
  assert.equal(getOverviewRefreshDelay(new Date('2026-10-04T15:59:59.999Z').getTime()), 1);
  assert.equal(getOverviewRefreshDelay(new Date('2026-10-04T16:00:00.000Z').getTime()), 60_000);
  assert.equal(getOverviewRefreshDelay(new Date('2026-10-04T16:00:25.500Z').getTime()), 34_500);
});
