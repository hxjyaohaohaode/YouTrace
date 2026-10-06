import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseDayNetLabel, expenseWriteFailure } from '../src/components/expense/expensePresentation';

test('daily difference has an explicit net direction and keeps cents', () => {
  assert.equal(expenseDayNetLabel(1234 - 10001), '净收入 ¥87.67');
  assert.equal(expenseDayNetLabel(1234 - 1002), '净支出 ¥2.32');
  assert.equal(expenseDayNetLabel(0), '净额 ¥0.00');
  assert.equal(expenseDayNetLabel(-1), '净收入 ¥0.01');
});

test('quota refusal explains the unsaved record or device budget and usable retry', () => {
  const error = new DOMException('Synthetic quota detail', 'QuotaExceededError');
  for (const operation of ['save', 'budget'] as const) {
    const message = expenseWriteFailure(error, operation);
    for (const part of ['存储空间不足', '未保存', '导出备份', '重试保存']) assert.ok(message.includes(part));
    assert.ok(message.includes(operation === 'budget' ? '输入仅在本页保留' : '输入仍保留'));
    if (operation === 'budget') assert.ok(message.includes('离开前请先复制本次金额'));
    assert.ok(!message.includes('Synthetic') && !message.includes('QuotaExceededError'));
  }
});

test('draft and deletion quota copy describe their own operation without claiming success', () => {
  const detail = 'QuotaExceededError: Synthetic native fault';
  assert.match(expenseWriteFailure(detail, 'draft'), /草稿尚未保存.*当前页面.*先复制输入.*重试保留草稿/);
  assert.match(expenseWriteFailure(detail, 'delete'), /删除未完成.*输入仍保留.*重试/);
});

test('specific non-quota recovery instructions remain unchanged and malformed errors do not throw', () => {
  const message = '记录刚刚更新，输入已保留。请核对最新记录后重试';
  assert.equal(expenseWriteFailure(new Error(message), 'save'), message);
  const malformed = new Error(); Object.defineProperty(malformed, 'name', { get() { throw new Error('bad getter'); } });
  assert.match(expenseWriteFailure(malformed, 'save'), /输入已保留/);
  const nonText = new Error(); Object.defineProperty(nonText, 'message', { value: { toString() { throw new Error('must not coerce'); } } });
  assert.match(expenseWriteFailure(nonText, 'save'), /输入已保留/);
});
