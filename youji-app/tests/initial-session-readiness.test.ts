import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// Each document gets fresh real module singletons and a fresh synthetic IDB.
// No browser, listener, external network, or real account is used.
for (const scenario of [
  'signed-out', 'unauthorized', 'offline-verified', 'offline-unverified',
  'late-401-new-owner', 'late-401-same-owner', 'late-401-revision', 'late-401-clear', 'late-401-signed-out',
  'revocation-listener-login', 'guest-bind-login', 'revoked-guest-bind-login',
  'guest-bind-failure', 'store-failure', 'timeout',
]) test(`initial document: ${scenario}`, () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/helpers/initial-session-scenario.ts', scenario], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.status, 0, `${scenario}\n${result.stdout}\n${result.stderr}`);
});
