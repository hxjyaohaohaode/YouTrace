import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getHabitPeriod } from '../src/utils/habitPeriod.ts';
import { getHabitOverview } from '../src/lib/homeOverview.ts';
import { projectHabitStats } from '../server/src/services/habitPeriod.ts';
import { addDays } from '../src/utils/date.ts';
import { habitErrorMessage } from '../src/components/habit/habitErrors.ts';

const today = '2026-10-07';
const habit = { name: 'Synthetic reader', frequency: 'weekly', createdAt: new Date(`${today}T12:00:00+08:00`).getTime(), recentCheckins: [{ date: '2026-10-06', done: true }] };

test('Wednesday entry accepts Tuesday fact and satisfies the natural week without marking Wednesday', () => {
  assert.deepEqual(getHabitPeriod(habit, today), { weekly: true, start: '2026-10-05', end: '2026-10-11', completedDates: ['2026-10-06'], applicable: true, attained: true, doneToday: false });
  assert.deepEqual(getHabitOverview([habit], new Date(`${today}T12:00:00+08:00`)), { label: '本周习惯', value: '1/1', sub: '本周已全部打卡' });
});
test('prior Sunday and a future day do not satisfy Wednesday, and false means undone', () => {
  const recentCheckins = [{ date: '2026-10-04', done: true }, { date: '2026-10-06', done: false }, { date: '2026-10-08', done: true }];
  assert.equal(getHabitPeriod({ ...habit, recentCheckins }, today).attained, false);
  assert.equal(getHabitPeriod({ ...habit, recentCheckins: habit.recentCheckins }, '2026-10-12').attained, false);
});
test('full canonical facts survive an old seven-day display and duplicate dates count once', () => {
  const checkinSources = [...habit.recentCheckins, ...habit.recentCheckins];
  const result = getHabitPeriod({ ...habit, recentCheckins: [], checkinSources }, today);
  assert.deepEqual(result.completedDates, ['2026-10-06']);
});
test('daily and weekly have identical frontend/server current-period meanings on boundaries', () => {
  const facts = Array.from({ length: 20 }, (_, i) => ({ date: addDays(today, i - 10), done: i % 3 === 0 }));
  for (const frequency of ['daily', 'weekly']) for (const date of ['2026-10-04', '2026-10-05', today, '2026-10-11', '2026-10-12']) {
    const client = getHabitPeriod({ ...habit, frequency, recentCheckins: facts }, date), server = projectHabitStats(frequency, facts, date);
    assert.equal(client.doneToday, server.done); assert.equal(client.attained, server.period.attained);
    assert.equal(client.start, server.period.start); assert.equal(client.end, server.period.end); assert.deepEqual(client.completedDates, server.period.completedDates);
  }
});
test('server daily streak is not truncated at sixty and weekly never implies a daily streak', () => {
  const facts = Array.from({ length: 75 }, (_, index) => ({ date: addDays(today, -index), done: true }));
  assert.equal(projectHabitStats('daily', facts, today).streak, 75);
  const weekly = projectHabitStats('weekly', facts, today); assert.equal(weekly.streak, 0); assert.equal(weekly.period.attained, true);
});
test('storage diagnostics become understandable recovery instructions and conflicts stay specific', () => {
  assert.match(habitErrorMessage(new DOMException('Synthetic', 'QuotaExceededError')), /空间不足.*没有保存.*保留.*重试/);
  assert.equal(habitErrorMessage(new Error('原习惯已不存在，请刷新核对')), '原习惯已不存在，请刷新核对');
  assert.doesNotMatch(habitErrorMessage(new Error('IndexedDB low-level crash')), /IndexedDB/);
});

test('future audit-createdAt cannot hide an existing current plan on any surface', () => {
  const row = { ...habit, createdAt: new Date('2026-10-20T12:00:00+08:00').getTime(), recentCheckins: [] };
  assert.equal(getHabitPeriod(row, today).applicable, true);
  assert.equal(getHabitOverview([row], new Date(`${today}T12:00:00+08:00`)).value, '0/1');
  assert.equal(projectHabitStats(row.frequency, [], today).period.attained, false);
});
