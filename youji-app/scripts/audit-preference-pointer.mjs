import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { waitForStableModalTarget } from './audit-legacy-goal-outcomes.mjs';

// Observe again only before a click. Rendering a new status may move the same
// control after its first stable frames; every visibility/hit gate still applies.
export async function preparePreferencePointer(page, resolved, selector, text, observations, { timeoutMs = 2500, now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  const sameRect = (left, right) => Object.keys(left).every(key => right[key] === left[key]);
  while (now() < deadline) {
    const stability = await page.evaluate(waitForStableModalTarget, resolved, Math.max(1, deadline - now()));
    const box = await page.evaluate(initialSessionGeometry, resolved);
    observations.push({ phase: 'after-stability', at: now(), stability, geometry: { unique: box.unique, rect: box.rect, clip: box.clip, centerHit: box.centerHit, visible: box.visible } });
    if (now() >= deadline) break;
    if (!box.visible || !sameRect(stability.box, box.rect)) continue;
    const x = box.rect.x + box.rect.width / 2, y = box.rect.y + box.rect.height / 2;
    await page.mouse.move(x, y);
    const final = await page.evaluate(initialSessionGeometry, resolved);
    const intended = await page.evaluate(({ resolved, selector, text }) => {
      const target = document.querySelector(resolved);
      const matches = [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (text === undefined || el.textContent.trim() === text); });
      return matches.length === 1 && matches[0] === target && !target.matches(':disabled');
    }, { resolved, selector, text });
    observations.push({ phase: 'after-mouse-move', at: now(), intended, geometry: { unique: final.unique, rect: final.rect, clip: final.clip, centerHit: final.centerHit, visible: final.visible } });
    if (now() >= deadline) break;
    if (intended && final.visible && sameRect(stability.box, final.rect)) return { x, y, stability };
  }
  throw new Error('Preference control did not remain readable and stable before a single pointer action');
}
