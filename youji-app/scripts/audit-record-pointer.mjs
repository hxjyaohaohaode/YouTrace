import assert from 'node:assert/strict';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';

// A control may intersect the viewport but be covered by fixed navigation.
// Prepare only the declared record-journey targets with native wheel input;
// the caller still performs its original exact-text, foreground native click.
export async function revealRecordControl(page, selector, { actions, surface, sleep }) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const box = await page.evaluate(initialSessionGeometry, selector);
    assert.equal(box.unique, true, 'The declared record control must be unique');
    if (box.visible) return box;
    const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8));
    const y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20));
    const deltaY = box.rect.y + box.rect.height / 2 - y;
    if (Math.abs(deltaY) > 1) {
      await page.mouse.move(x, y); await page.mouse.wheel({ deltaY });
      actions.push({ kind: 'native-wheel-read-record-control', surface, selector, pointer: { x, y }, deltaY, clip: box.clip });
    }
    await sleep(150);
  }
  const final = await page.evaluate(initialSessionGeometry, selector);
  assert.ok(final.visible, 'The declared record control must be fully readable and foreground before clicking');
  return final;
}
