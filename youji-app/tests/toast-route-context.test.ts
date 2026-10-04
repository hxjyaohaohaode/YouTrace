import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toast, getToastSnapshot, dismissToast, dismissTransientToasts } from '../src/services/toastBus.ts';
test('route changes remove old-page success/info, without silently dismissing pending warnings/errors', () => {
  for (const item of getToastSnapshot()) dismissToast(item.id);
  toast.success('Synthetic saved expense'); toast.info('Synthetic old page hint'); toast.warning('Synthetic sync needs review'); toast.error('Synthetic durable failure');
  dismissTransientToasts(); assert.deepEqual(getToastSnapshot().map(row => row.type), ['warning', 'error']);
  toast.success('Synthetic new page result'); assert.equal(getToastSnapshot().at(-1)?.message, 'Synthetic new page result');
  for (const item of getToastSnapshot()) dismissToast(item.id);
});
