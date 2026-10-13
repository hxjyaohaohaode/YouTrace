import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertStartupChronology } from '../scripts/audit-startup-chronology.mjs';

for (const width of [1280, 360]) {
  test(`actual f9 ${width}: request errors can precede the real abort terminal without losing either proof`, async () => {
    const original = JSON.parse(await readFile(new URL(`./fixtures/startup-native-f9/both-fail-${width}.json`, import.meta.url), 'utf8'));
    assert.equal(assertStartupChronology(original.fault, undefined, original.source), true);
    // A model variant covers the other legitimate delivery order; original
    // native sequence and provenance above are kept byte-for-byte separate.
    const earlierTerminal = structuredClone(original);
    for (const phase of ['initial', 'recovery']) {
      const rows = earlierTerminal.fault.events;
      const index = rows.findIndex(row => row.kind === 'readonly-terminal' && row.target === phase);
      const [terminal] = rows.splice(index, 1);
      const errorIndex = rows.findIndex(row => row.kind === 'application-initialization' && row.phase === phase && row.stage === 'expense' && row.outcome === 'error');
      rows.splice(errorIndex, 0, terminal);
    }
    earlierTerminal.fault.events.forEach((row, index) => { row.sequence = index + 1; });
    assert.equal(assertStartupChronology(earlierTerminal.fault, undefined, earlierTerminal.source), true);
    for (const phase of ['initial', 'recovery']) for (const mode of ['missing-terminal', 'wrong-terminal', 'wrong-attempt', 'early-error', 'missing-expense-error']) {
      const invalid = structuredClone(original), rows = invalid.fault.events;
      const terminal = rows.find(row => row.kind === 'readonly-terminal' && row.target === phase);
      const error = rows.find(row => row.kind === 'application-initialization' && row.phase === phase && row.stage === 'expense' && row.outcome === 'error');
      if (mode === 'missing-terminal') rows.splice(rows.indexOf(terminal), 1);
      if (mode === 'wrong-terminal') terminal.outcome = 'complete';
      if (mode === 'wrong-attempt') error.attempt = 999;
      if (mode === 'missing-expense-error') rows.splice(rows.indexOf(error), 1);
      if (mode === 'early-error') {
        rows.splice(rows.indexOf(error), 1);
        rows.splice(rows.findIndex(row => row.kind === 'readonly-abort-requested' && row.target === phase), 0, error);
      }
      rows.forEach((row, index) => { row.sequence = index + 1; });
      assert.throws(() => assertStartupChronology(invalid.fault, undefined, invalid.source), `${phase}/${mode}`);
    }
  });
}
