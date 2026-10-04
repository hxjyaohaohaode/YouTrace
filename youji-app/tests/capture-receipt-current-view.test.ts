import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentCaptureRecord, type ReceiptViewState } from '../src/services/captureReceiptView.ts';
import type { CaptureEntityRef } from '../src/services/quickNoteIntegration.ts';
test('receipt renders current correction separately without rewriting creation evidence or substituting a missing record', () => {
  const old: CaptureEntityRef = { entity: 'todos', id: 'todo-id', label: 'Original task', date: '2026-10-06', effect: 'created' }, before = structuredClone(old);
  const view = currentCaptureRecord(old, { id: old.id, text: 'Corrected task', dueDate: '2026-10-07', done: false });
  assert.equal(view.label, 'Corrected task'); assert.equal(view.detail, '截止 2026-10-07 · 未完成'); assert.deepEqual(old, before);
  assert.equal(currentCaptureRecord(old, undefined).available, false); assert.match(currentCaptureRecord(old, undefined).detail, /不以同名条目代替/);
  assert.equal(currentCaptureRecord({ ...old, entity: 'expenses' }, { name: 'Corrected lunch', date: '2026-10-05', amount: 1625, isIncome: false }).detail, '2026-10-05 · 支出 CNY ¥16.25');
});

test('receipt status uses canonical historical checkin keys and only valid acknowledged sequences', async () => {
  const { currentReceiptSyncStatus } = await import('../src/services/captureReceiptView.ts');
  const ref: CaptureEntityRef = { entity: 'habitCheckins', id: 'habit-001|2026-10-05', parentId: 'habit-001', label: 'Reading', date: '2026-10-05', effect: 'created' };
  const pending = { entity: 'habitCheckins' as const, op: 'upsert' as const, payload: { habitId: 'habit-001', date: '2026-10-05', done: false }, queuedAt: 1, status: 'pending' as const };
  assert.match(currentReceiptSyncStatus(ref, true, [pending], false, '25'), /等待云端确认/);
  assert.match(currentReceiptSyncStatus(ref, true, [{ ...pending, status: 'blocked' }], false, '25'), /需要处理/);
  for (const value of [undefined, null, 25, {}, 'garbage', '0', '01', '9223372036854775808']) assert.match(currentReceiptSyncStatus(ref, true, [], false, value), /确认未知/);
  assert.match(currentReceiptSyncStatus(ref, true, [], false, '25'), /已收到云端版本确认/);
});
test('a failed current-view read clears all prior derived content/ACK but does not alter original receipt', async () => {
  const { failedReceiptRead } = await import('../src/services/captureReceiptView.ts');
  const original = { id: 'source', input: 'Synthetic original' }, before = structuredClone(original);
  let state: ReceiptViewState = { current: { a: { available: true, label: 'old live label', detail: 'old' } }, statuses: { a: '已收到云端版本确认' }, error: '', locked: false };
  assert.equal(state.statuses.a, '已收到云端版本确认');
  state = failedReceiptRead(true); assert.deepEqual(state.current, {}); assert.deepEqual(state.statuses, {}); assert.match(state.error, /重试读取/); assert.equal(state.locked, false);
  state = failedReceiptRead(false); assert.equal(state.locked, true); assert.deepEqual(original, before);
});
