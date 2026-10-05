import test from 'node:test';
import assert from 'node:assert/strict';
import { preferenceSaveError } from '../src/lib/preferenceErrors.ts';

test('quota refusals explain space and retained input without reclassifying a display failure as a failed write', () => {
  const quota = preferenceSaveError(new DOMException('Synthetic storage quota', 'QuotaExceededError'));
  assert.match(quota, /空间不足/); assert.match(quota, /输入仍保留/); assert.match(quota, /保存重试/);
  assert.doesNotMatch(quota, /QuotaExceededError|Synthetic/);
  assert.equal(preferenceSaveError(new Error('QuotaExceededError: Synthetic wrapped quota')), quota);
  const displayError = new DOMException('Synthetic display read interrupted', 'AbortError');
  assert.equal(preferenceSaveError(displayError), displayError.message);
  const conflict = new Error('这个时间刚刚在其他位置变化，输入已保留，请核对最新版本');
  assert.equal(preferenceSaveError(conflict), conflict.message);
});
