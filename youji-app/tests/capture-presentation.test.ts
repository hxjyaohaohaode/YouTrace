import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameCaptureInput, captureSaveFailure } from '../src/services/capturePresentation';

test('Only the identical original text and complete capture basis can continue existing corrections', () => {
  const context = { capturedAt: 1791345600000, date: '2026-10-07', timeZone: 'Asia/Shanghai' };
  const original = { input: '明天要交报告', context };
  assert.equal(sameCaptureInput(original, original.input, { ...context }), true);
  assert.equal(sameCaptureInput(original, '明天要交报告 ', context), false);
  for (const changed of [{ ...context, date: '2026-10-08' }, { ...context, capturedAt: context.capturedAt + 1 }, { ...context, timeZone: null }, { ...context, extra: 'unknown context' }]) {
    assert.equal(sameCaptureInput(original, original.input, changed), false);
  }
  assert.equal(sameCaptureInput({ input: original.input }, original.input, context), false);
  const unknownContext = { ...context, extra: 'unknown context' };
  assert.equal(sameCaptureInput({ ...original, context: unknownContext }, original.input, context), false);
});

test('Capture quota names the uncommitted business save and its real retry, preserving specific non-quota errors', () => {
  for (const reason of [new DOMException('Synthetic refusal', 'QuotaExceededError'), new Error('QuotaExceededError: synthetic wrapped quota')]) {
    const message = captureSaveFailure(reason);
    assert.match(message, /存储空间不足/);
    assert.match(message, /本次记录未保存/);
    assert.match(message, /修正仍保留在当前页面/);
    assert.match(message, /复制确认稿备份/);
    assert.match(message, /确认保存所选记录.*重试/);
    assert.doesNotMatch(message, /QuotaExceededError|Synthetic|synthetic|已同步|已上传/);
  }
  for (const message of ['原确认稿已在另一页保存或修改。你的输入已另存为草稿，请核对后再次确认', '请核对所选待办内容和绝对截止日期，也可明确选择无日期']) {
    assert.equal(captureSaveFailure(new Error(message)), message);
  }
  assert.equal(captureSaveFailure(null), '保存未完成，确认稿仍保留，请重试');
});
