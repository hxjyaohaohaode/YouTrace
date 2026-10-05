import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// Actual auth, DB, actor, sync and eight stores use synthetic IDB/transport.
// Settings are held before their real loader and one recovery Expense read
// rejects on demand; React scheduling and routing remain deterministic drivers.
for (const scenario of ['initial-race-success-first', 'initial-race-error-first', 'initialization-closed-db']) test(`actual initialization modules: ${scenario}`, () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/helpers/initial-session-scenario.ts', scenario], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.status, 0, `${scenario}\n${result.stdout}\n${result.stderr}`);
});
