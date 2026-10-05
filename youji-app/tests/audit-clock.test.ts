import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createHabitAuditClock, installAuditDate } from '../scripts/audit-clock.mjs';

// A pure VM Date/preload contract check, never a local listener or browser.
const install = `(${installAuditDate.toString()})(config);`;
test('explicit Y5 clock changes only a separate realm and preserves Date parse/construction', () => {
  const originalDate = Date, real = Date.now(), config = createHabitAuditClock(real);
  const result = JSON.parse(runInNewContext(`${install} JSON.stringify({now:Date.now(),value:new Date().toISOString(),past:new Date('2000-01-01T00:00:00Z').toISOString(),call:Date(),parse:Date.parse('2000-01-01T00:00:00Z'),instance:new Date() instanceof Date,fixture:globalThis.__youtraceAuditClock})`, { config }));
  assert.ok(result.now >= Date.parse(config.instant) && result.now <= Date.parse(config.instant) + (Date.now() - real));
  assert.ok(Math.abs(Date.parse(result.value) - result.now) <= Date.now() - real);
  assert.equal(result.past, '2000-01-01T00:00:00.000Z'); assert.equal(result.parse, 946684800000); assert.equal(result.instance, true); assert.deepEqual(result.fixture, config);
  assert.equal(Date, originalDate, 'host Date constructor remains unchanged');
});
test('Date fixture must be explicit and cannot be silently replaced in one document', () => {
  for (const config of [null, {}, { ...createHabitAuditClock(), timeZone: 'UTC' }, { ...createHabitAuditClock(), instant: '2027-01-01T00:00:00.000Z' }]) assert.throws(() => runInNewContext(install, { config }), /explicitly labelled/);
  const config = createHabitAuditClock();
  assert.doesNotThrow(() => runInNewContext(`${install}${install}`, { config }));
  assert.throws(() => runInNewContext(`${install} config={...config,wallMs:config.wallMs+1}; ${install}`, { config }), /already installed/);
});
test('API Date preload refuses production, non-CI, wrong task or non-disposable database', async () => {
  const source = (await readFile(new URL('../scripts/audit-clock.mjs', import.meta.url), 'utf8')).replaceAll('export ', '');
  const base = { GITHUB_ACTIONS: 'true', NODE_ENV: 'test', AUDIT_TASK_SET: 'habits', YOUTRACE_AUDIT_CLOCK_PRELOAD: 'habit-outcomes-v1', YOUTRACE_AUDIT_CLOCK_ISO: '2026-10-07T04:00:00.000Z', YOUTRACE_AUDIT_CLOCK_WALL_MS: String(Date.now()), DATABASE_URL: 'file:/tmp/youtrace-outcomes-synthetic/synthetic.db' };
  for (const changed of [{ GITHUB_ACTIONS: 'false' }, { NODE_ENV: 'production' }, { AUDIT_TASK_SET: 'records' }, { DATABASE_URL: 'file:/tmp/ordinary.db' }]) assert.throws(() => runInNewContext(source, { process: { env: { ...base, ...changed } } }), /restricted/);
  assert.throws(() => runInNewContext(source, { process: { env: { ...base, YOUTRACE_AUDIT_CLOCK_ISO: '2027-01-01T00:00:00.000Z' } } }), /explicit Wednesday/);
  // The allowed fixture is simulated only in this VM, with no filesystem, DB or server.
  for (const task of ['habits', 'habits-frequency']) assert.doesNotThrow(() => runInNewContext(source, { process: { env: { ...base, AUDIT_TASK_SET: task } } }));
  assert.equal(runInNewContext(`${source};typeof globalThis.__youtraceAuditClock`, { process: { env: {} } }), 'undefined', 'importing from driver does not change its Date');
});
