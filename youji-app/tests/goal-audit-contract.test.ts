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


test('acknowledged Goal feedback cannot retain an obsolete waiting-for-sync state', () => {
  assert.equal(checks.normalFeedback([{ role: 'status', text: '目标已保存在本机，等待账号同步确认' }]), false);
  assert.equal(checks.normalFeedback([{ role: 'status', text: '目标已保存在本机，可在卡片查看同步状态' }]), true);
});

// This is a bounded DOM-query contract; actual layout is still native-CI only.
const { goalProgressMatchesIdentity } = await import('../scripts/audit-goal-outcomes.mjs');
const { runInNewContext } = await import('node:vm');
const { readFile } = await import('node:fs/promises');
function progressDOM() {
  const identity = { title: '同名目标', description: '原目标完整说明', domain: '学习' };
  const target = { ...identity, progress: '25' }, neighbor = { ...identity, description: '邻居原说明', progress: '100' };
  let rows = [target, neighbor]; let queries = 0;
  const document = { querySelectorAll: (selector: string) => {
    assert.equal(selector, '[data-component="goal-workspace"] [data-component="goal-card"]'); queries++;
    return rows.map(row => ({ querySelector: (child: string) => child === 'h2' ? { innerText: row.title } : child === '[role=progressbar]' ? { getAttribute: (name: string) => { assert.equal(name, 'aria-valuenow'); return row.progress; } } : null, querySelectorAll: (child: string) => child === 'p' ? [{ innerText: row.description }] : child === 'span' ? [{ innerText: row.domain }] : [] }));
  } };
  return { identity, target, neighbor, replace: (next: typeof rows) => { rows = next; }, queries: () => queries, ready: runInNewContext(`(${goalProgressMatchesIdentity.toString()})`, { document }) };
}
test('progress wait resolves visible identity each poll, never a same-name neighbor or cached position', () => {
  const c = progressDOM(); assert.equal(c.ready({ identity: c.identity, value: 100 }), false);
  c.target.progress = '100'; c.replace([c.neighbor, c.target]);
  assert.equal(c.ready({ identity: c.identity, value: 100 }), true); assert.equal(c.queries(), 2);
  c.replace([c.neighbor]); assert.equal(c.ready({ identity: c.identity, value: 100 }), false);
});
test('progress identity witness rejects duplicates, changed visible fields, stale values and invalid requests', () => {
  const c = progressDOM(); c.target.progress = '100';
  c.replace([c.target, { ...c.target }]); assert.equal(c.ready({ identity: c.identity, value: 100 }), false);
  for (const key of ['title', 'description', 'domain']) { c.replace([{ ...c.target, [key]: '别的原文' }]); assert.equal(c.ready({ identity: c.identity, value: 100 }), false); }
  c.replace([c.target]);
  for (const value of ['100', -1, 101, NaN, Infinity, 25]) assert.equal(c.ready({ identity: c.identity, value }), false);
  for (const identity of [null, {}, { ...c.identity, description: undefined }]) assert.equal(c.ready({ identity, value: 100 }), false);
});
test('native progress uses the unchanged seven-second bound and retains exact-ID source/ACK assertions', async () => {
  const source = await readFile(new URL('../scripts/audit-goal-outcomes.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function progress('), source.indexOf('async function summary('));
  assert.match(body, /waitForFunction\(goalProgressMatchesIdentity, \{ timeout: 7000 \}/);
  assert.doesNotMatch(body, /selector: root/);
  for (const proof of ['row.id === identity.id', 'rawLocalUnchanged', 'rawServerUnchanged', 'neighborUnchanged(before, after, neighbor.id)', 'after.local.outbox.length === 0', 'version(after, identity.id) === after.serverVersions[identity.id]']) assert.ok(body.includes(proof), proof);
});
