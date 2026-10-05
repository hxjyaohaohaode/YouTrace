import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goalOutcomeChecks as checks } from '../scripts/audit-goal-outcomes.mjs';

// Pure evidence-oracle regressions, not browser/product completion tests.
test('Goal ledger keeps original payload fields and separates version/tombstone metadata', () => {
  const first = { id: 'one', title: 'Same synthetic', targetDate: null, extra: { original: true } };
  const second = { id: 'two', title: 'Same synthetic', progress: 50 };
  const events = [
    { seq: '1', entity: 'goals', entityId: 'one', operation: 'upsert', data: first },
    { seq: '3', entity: 'todos', entityId: 'other', operation: 'upsert', data: { id: 'other' } },
    { seq: '4', entity: 'goals', entityId: 'two', operation: 'upsert', data: second },
    { seq: '6', entity: 'goals', entityId: 'one', operation: 'delete', data: null },
  ];
  assert.deepEqual(checks.goalRowsFromLedger(events), [second]);
  assert.equal(checks.goalRowsFromLedger(events.slice(0, 1))[0], first, 'No identity, timestamp or metadata is manufactured');
});
test('Goal ledger rejects wrong payload identity, duplicate/order errors and unsupported operations', () => {
  const event = { seq: '2', entity: 'goals', entityId: 'one', operation: 'upsert', data: { id: 'one' } };
  for (const events of [[event, event], [{ ...event, data: { id: 'other' } }], [{ ...event, operation: 'unknown' }], [{ ...event, seq: '0' }]]) assert.throws(() => checks.goalRowsFromLedger(events));
});
test('Full field preservation rejects missing undefined keys and changed unknown values', () => {
  const source = { id: 'one', progress: 25, maybe: undefined, unknown: new Map([['original', 1]]) };
  assert.equal(checks.onlyChanges(source, { ...source, progress: 100 }, ['progress']), true);
  const { maybe: omitted, ...missing } = source; assert.equal(omitted, undefined);
  assert.equal(checks.onlyChanges(source, missing, ['progress']), false);
  assert.equal(checks.onlyChanges(source, { ...source, unknown: new Map([['original', 2]]) }, ['progress']), false);
});
test('Editor cancel/reopen oracle includes actual type/domain/priority choices, not just text', () => {
  const original = { title: 'Synthetic', description: 'Draft', targetDate: '', choices: [{ label: '类型', value: 'short' }, { label: '领域', value: '学习' }, { label: '优先级', value: 'high' }] };
  assert.equal(checks.sameInputs(original, structuredClone(original)), true);
  for (const index of [0, 1, 2]) { const changed = structuredClone(original); changed.choices[index].value = 'changed'; assert.equal(checks.sameInputs(original, changed), false); }
});
test('Goal canonical versions remain bounded positive decimal sequences', () => {
  for (const value of ['1', '9223372036854775807']) assert.equal(checks.validVersion(value), true);
  for (const value of ['0', '01', '-1', '1.5', '9223372036854775808', 1, null]) assert.equal(checks.validVersion(value), false);
});

test('ordinary Goal feedback cannot pass with the archived false refresh-needed instruction', () => {
  assert.equal(checks.normalFeedback([{ role: 'status', text: '本机写入已完成，但列表暂未刷新。请刷新核对，无需重复提交' }]), false);
  assert.equal(checks.normalFeedback([{ role: 'alert', text: '暂时无法读取目标' }]), false);
  assert.equal(checks.normalFeedback([{ role: 'status', text: '进度已保存，可随时调整' }]), true);
});
