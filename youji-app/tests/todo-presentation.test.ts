import assert from 'node:assert/strict';
import { test } from 'node:test';
import { todoSaveFailure } from '../src/components/todo/todoPresentation';

test('Save quota gives a Chinese recovery action while preserving specific source and draft refusals', () => {
  for (const reason of [new DOMException('Synthetic quota refusal', 'QuotaExceededError'), 'QuotaExceededError: storage write rejected']) {
    const message = todoSaveFailure(reason);
    assert.match(message, /存储空间不足/);
    assert.match(message, /本次待办未保存/);
    assert.match(message, /输入仍保留在当前编辑器/);
    assert.match(message, /核对输入并重试保存/);
    assert.doesNotMatch(message, /Synthetic|QuotaExceededError|已同步|已上传/);
  }
  for (const message of ['待办刚刚更新，输入已保留。请核对最新记录后重试', '草稿尚未保留，暂未关闭以免丢失输入']) {
    assert.equal(todoSaveFailure(new Error(message)), message);
  }
  assert.equal(todoSaveFailure(null), '未保存，输入已保留，请重试');
});
