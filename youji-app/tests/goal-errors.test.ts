import test from 'node:test';
import assert from 'node:assert/strict';
import { goalFailureMessage, goalLoadingMessage, goalSummaryLabel, goalNeedsRefresh } from '../src/components/goal/goalErrors';

test('Goal quota write failure explains cause, unchanged source, retained input and retry', () => {
  const error = new Error('Injected storage fault'); error.name = 'QuotaExceededError';
  const message = goalFailureMessage(error);
  for (const required of ['空间不足', '没有保存', '原目标保持不变', '输入仍保留', '重试', '导出备份']) assert.ok(message.includes(required));
  assert.ok(!message.includes('QuotaExceededError'));
});
test('Goal source/authority refusals preserve their specific Chinese recovery explanation', () => {
  const source = '目标刚刚更新，已保留输入。请核对最新版本后重试';
  assert.equal(goalFailureMessage(new Error(source)), source);
});
test('Unknown Goal write failures never expose raw exception or claim successful commit', () => {
  const message = goalFailureMessage(new Error('TransactionInactiveError: synthetic detail'));
  assert.ok(message.includes('没有保存') && message.includes('输入仍保留') && message.includes('重试'));
  assert.ok(!message.includes('TransactionInactiveError'));
});


test('a stopped initial read failure never claims to still be loading or to be empty', () => {
  assert.equal(goalLoadingMessage(true, null), '正在读取目标…');
  const failed = goalLoadingMessage(false, '读取失败');
  assert.ok(failed.includes('暂未读取') && failed.includes('刷新核对'));
  assert.ok(!failed.includes('正在') && !failed.includes('没有目标'));
  assert.equal(goalLoadingMessage(false, null), '尚未读取目标');
});


test('unread Goal statistics do not turn a read failure into a known zero collection', () => {
  assert.equal(goalSummaryLabel(false, false, '读取失败', 0, 0, 0), '目标统计暂未读取');
  assert.equal(goalSummaryLabel(false, true, null, 0, 0, 0), '正在读取目标统计…');
  assert.equal(goalSummaryLabel(true, false, null, 0, 0, 0), '还没有目标');
  assert.equal(goalSummaryLabel(true, false, '读取失败', 0, 0, 0), '上次读取时还没有目标');
  assert.equal(goalSummaryLabel(true, false, null, 1, 2, 75), '1/2 完成 · 平均进度 75%');
  assert.equal(goalSummaryLabel(true, false, '读取失败', 1, 2, 75), '上次读取：1/2 完成 · 平均进度 75%');
});


test('Goal display-read notice retires only after a sufficiently recent published view', () => {
  assert.equal(goalNeedsRefresh(undefined, 0, true, null), false);
  assert.equal(goalNeedsRefresh(8, 7, true, null), true);
  assert.equal(goalNeedsRefresh(8, 8, true, null), false);
  assert.equal(goalNeedsRefresh(8, 9, true, null), false);
  assert.equal(goalNeedsRefresh(8, 0, true, null), true);
});


test('a replacement Goal read is not a failure, but its later error exposes recovery until covered', () => {
  assert.equal(goalNeedsRefresh(8, 7, false, null), false);
  assert.equal(goalNeedsRefresh(8, 7, false, '读取失败'), true);
  assert.equal(goalNeedsRefresh(8, 9, false, '旧错误'), false);
});
