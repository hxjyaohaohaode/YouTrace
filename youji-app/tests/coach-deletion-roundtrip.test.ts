import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

test('real TCP: two independent clients reconcile deletion, lost ACK and backend process restart without deleting paged-out/local/new reminders', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('tests/fixtures/coach-deletion-clients.mjs'), resolve('..')], { timeout: 45_000, maxBuffer: 1024 * 1024 });
  const line = stdout.split('\n').find(line => line.startsWith('{"status":"PASS"'));
  assert.ok(line, 'isolated processes must return their actual success receipt');
  const receipt = JSON.parse(line) as { device_b_visible_deleted: boolean; latest_page: number; paged_out_live_retained: boolean; local_only_retained: boolean; new_reminder_retained: boolean };
  assert.equal(receipt.device_b_visible_deleted, false);
  assert.equal(receipt.latest_page, 50);
  assert.ok(receipt.paged_out_live_retained && receipt.local_only_retained && receipt.new_reminder_retained);
});
