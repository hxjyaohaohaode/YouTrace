import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { waitForStableModalTarget } from '../scripts/audit-legacy-goal-outcomes.mjs';

type Box = { x: number; y: number; width: number; height: number };
type Result = { box: Box; samples: Array<Box & { elapsedMs: number }>; elapsedMs: number };
function frameDriver(positions: number[], replaceAt = -1) {
  let index = -1, now = 0, stopped = false;
  const target = { isConnected: true, getBoundingClientRect: () => ({ x: 308, y: positions[Math.min(index, positions.length - 1)], width: 32, height: 32 }) };
  const replacement = { ...target };
  const run = runInNewContext(`(${waitForStableModalTarget.toString()})`, {
    document: { querySelector: () => index >= replaceAt && replaceAt >= 0 ? replacement : target },
    performance: { now: () => now }, setTimeout, clearTimeout,
    requestAnimationFrame: (callback: () => void) => {
      setImmediate(() => { if (!stopped) { index++; now += 16; callback(); } }); return index + 1;
    },
    cancelAnimationFrame: () => { stopped = true; },
  }) as (selector: string, timeout: number) => Promise<Result>;
  return { run, frames: () => index + 1 };
}

// These drive the exact browser observation function with deterministic frames.
// They prove the pointer gate's contract, not native rendering or click outcomes.
test('modal pointer waits through measured spring positions before accepting the stable control', async () => {
  const driver = frameDriver([306.75, 290, 278, 278, 278]);
  const result = await driver.run('#close', 200);
  assert.equal(driver.frames(), 5);
  assert.equal(result.box.y, 278);
  assert.equal(result.samples.length, 3);
  assert.ok(result.samples.every(sample => sample.y === 278));
  assert.equal(result.elapsedMs, 80);
});

test('a perpetually moving modal target fails within the bounded observation without clicking', async () => {
  const driver = frameDriver([310, 300, 290, 280, 270, 260]);
  await assert.rejects(driver.run('#close', 80), /did not stop moving/);
  assert.equal(driver.frames(), 5);
});

test('an identical replacement control cannot inherit the original target observation', async () => {
  const driver = frameDriver([278, 278, 278], 1);
  await assert.rejects(driver.run('#close', 200), /control changed/);
  assert.equal(driver.frames(), 2);
});
