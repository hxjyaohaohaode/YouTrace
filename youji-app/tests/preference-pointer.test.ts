import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePreferencePointer } from '../scripts/audit-preference-pointer.mjs';
const rect = (y: number) => ({ x: 10, y, width: 120, height: 36 });
const geometry = (y: number, visible = true) => ({ unique: true, rect: rect(y), clip: { left: 0, top: 0, right: 360, bottom: 800 }, centerHit: visible, visible });

test('a status reflow before clicking is reobserved with the original visibility and center-hit gates', async () => {
  let clock = 0, read = 0, stability = 0, clicks = 0;
  const boxes = [geometry(209), geometry(241), geometry(241), geometry(241)], observations: unknown[] = [], moves: unknown[] = [];
  const page = {
    evaluate: async (operation: { name: string }) => {
      clock += 20;
      if (operation.name === 'waitForStableModalTarget') return { box: rect(++stability === 1 ? 209 : 241), samples: [] };
      if (operation.name === 'initialSessionGeometry') return boxes[read++];
      return true;
    },
    mouse: { move: async (x: number, y: number) => { moves.push({ x, y }); }, click: async () => { clicks++; } },
  };
  const ready = await preparePreferencePointer(page, '#actual', 'button', '重新核对账号偏好', observations, { now: () => clock });
  assert.equal(ready.y, 259); assert.equal(stability, 2); assert.equal(observations.length, 4); assert.equal(moves.length, 2); assert.equal(clicks, 0);
  await page.mouse.click(); assert.equal(clicks, 1);
});

for (const blocked of ['clipped', 'replaced-intent', 'late-observation']) test(`pre-click ${blocked} cannot bypass the same original deadline or issue an action`, async () => {
  let clock = 0, clicks = 0;
  const observations: unknown[] = [];
  const page = {
    evaluate: async (operation: { name: string }) => {
      clock += blocked === 'late-observation' ? 900 : 400;
      if (operation.name === 'waitForStableModalTarget') return { box: rect(241), samples: [] };
      if (operation.name === 'initialSessionGeometry') return geometry(241, blocked !== 'clipped');
      return blocked !== 'replaced-intent';
    },
    mouse: { move: async () => {}, click: async () => { clicks++; } },
  };
  await assert.rejects(preparePreferencePointer(page, '#actual', 'button', '重新核对账号偏好', observations, { now: () => clock }), /did not remain/);
  assert.ok(observations.length > 0); assert.equal(clicks, 0); assert.ok(clock >= 2500);
});
