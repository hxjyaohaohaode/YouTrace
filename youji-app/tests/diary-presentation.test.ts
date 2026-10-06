import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diaryWriteFailure } from '../src/components/diary/diaryPresentation';

test('Quota explains save and delete refusal, current-editor retention and the actual retry route', () => {
  const quota = new DOMException('Synthetic precommit quota', 'QuotaExceededError');
  for (const operation of ['save', 'delete'] as const) {
    const message = diaryWriteFailure(quota, operation);
    assert.match(message, /存储空间不足/);
    assert.match(message, operation === 'save' ? /本次日记未保存/ : /删除未完成/);
    assert.match(message, /输入仍保留在当前编辑器/);
    assert.match(message, /复制完整输入/);
    assert.match(message, operation === 'save' ? /重试保存/ : /重试删除/);
    assert.doesNotMatch(message, /Synthetic|QuotaExceededError|已同步|已上传/);
  }
  assert.match(diaryWriteFailure('QuotaExceededError: rejected storage write', 'save'), /存储空间不足/);
});

test('Specific existing source/date refusals remain visible and malformed errors cannot throw during display', () => {
  for (const message of ['这个日期已有日记，未覆盖原文。请先查看、核对已有记录', '日记刚刚更新，输入已保留。请核对最新记录后重试']) {
    assert.equal(diaryWriteFailure(new Error(message), 'save'), message);
  }
  let reads = 0;
  const changing = new Error('ordinary message');
  Object.defineProperty(changing, 'name', { get() { reads++; return reads === 1 ? 'QuotaExceededError' : 'unexpected second read'; } });
  assert.match(diaryWriteFailure(changing, 'save'), /存储空间不足/); assert.equal(reads, 1);
  const malformed = new Error(); Object.defineProperty(malformed, 'name', { get() { throw new Error('malformed getter'); } });
  assert.equal(diaryWriteFailure(malformed, 'delete'), '删除未完成，输入已保留，请重试');
});
