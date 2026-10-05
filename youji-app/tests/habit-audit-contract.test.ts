import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Harness control-flow tests only: no app, browser, records or network is used.
const source = await readFile(new URL('../scripts/audit-habit-outcomes.mjs', import.meta.url), 'utf8');
const wrapper = source.slice(source.indexOf('  async function inspectFutureHistoryDiagnostic('), source.indexOf('  async function inspectFrequencyEdit('));
async function run(policy: string, count = 1) {
  const pointers: string[] = [], observations: { name: string; passed: boolean }[] = []; let originalCalls = 0;
  const context = { assert, page: {
    $$eval: async () => Array.from({ length: count }, () => ({ tag: 'button', label: '调整频率 Synthetic', text: '调整当前频率' })),
    $eval: async () => policy, $: async () => true, waitForSelector: async () => undefined,
  }, api: {}, target: { id: 'synthetic' }, closeDialogs: async () => undefined, card: async () => 'root',
  pointer: async (_page: unknown, _selector: unknown, text: string) => { pointers.push(text ?? 'open'); },
  facts: async () => ({ source: 'unchanged synthetic snapshot' }), preserved: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b), readControl: async () => undefined,
  observe: async (_page: unknown, name: string, passed: boolean) => { observations.push({ name, passed }); },
  inspectFrequencyEdit: async () => { originalCalls++; },
  };
  await runInNewContext(`${wrapper};inspectFutureHistoryDiagnostic(page,api,target,'fixture');`, context);
  return { pointers, observations, originalCalls };
}
test('unsupported negative scope cannot be mistaken for permission to submit a future-only request', async () => {
  const result = await run('保存后立即生效。历史日期保持原样。暂不支持指定未来生效日期，也不提供历次规则回溯。');
  assert.deepEqual(result.pointers, ['open', '取消']); assert.equal(result.originalCalls, 0);
  assert.deepEqual(result.observations.map(row => row.passed), [false]);
  assert.match(result.observations[0].name, /explicitly-unsupported/);
});
test('absent old edit entry still runs the unchanged red diagnostic, never inventing completion', async () => {
  const result = await run('', 0); assert.equal(result.originalCalls, 1); assert.deepEqual(result.pointers, []);
});
test('ambiguous future-rule entry fails without choosing or submitting either editor', async () => {
  const result = await run('irrelevant', 2); assert.equal(result.originalCalls, 0); assert.deepEqual(result.pointers, []);
  assert.deepEqual(result.observations.map(row => row.passed), [false]);
});
