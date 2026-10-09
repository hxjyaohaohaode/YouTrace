// Passive native-browser evidence only; never changes app state or closing semantics.
export const FIRST_OPEN_PROFILES = [
  { width: 1280, start: 'cold', phone: '13900008951', nickname: 'Synthetic D Cold1280' },
  { width: 360, start: 'cold', phone: '13900008952', nickname: 'Synthetic D Cold360' },
  { width: 1280, start: 'warm', phone: '13900008953', nickname: 'Synthetic D Warm1280' },
  { width: 360, start: 'warm', phone: '13900008954', nickname: 'Synthetic D Warm360' },
];
// useAppInit's real 12,000 ms deadline plus a 1,000 ms observation margin.
// This is a new observation interval, not a relaxed existing wait/assertion.
export const FIRST_OPEN_WINDOW_MS = 13000;
export function firstOpenContinuityPass(state, minimumMs = FIRST_OPEN_WINDOW_MS) {
  return Boolean(state && state.firstPaintAt !== null && state.lastSampleAt - state.firstPaintAt >= minimumMs
    && state.samples > 1 && state.violations.length === 0 && state.dropped === 0
    && state.initializations.some(row => row.stage === 'initialization' && row.outcome === 'success')
    && state.route === '/diary');
}
export function installFirstDiaryObserver() {
  const state = { route: location.pathname, firstPaintAt: null, lastSampleAt: null, samples: 0, violations: [], events: [], initializations: [], dropped: 0, armed: false };
  let panel = null, field = null;
  const append = (list, value) => { if (list.length < 256) list.push(value); else state.dropped++; };
  const target = el => el instanceof Element ? { tag: el.tagName, id: el.id, label: el.getAttribute('aria-label'), inDialog: Boolean(el.closest('[role=dialog]')) } : null;
  const event = (kind, details = {}) => append(state.events, { at: performance.now(), kind, route: location.pathname, ...details });
  window.addEventListener('youtrace:initialization-diagnostic', ({ detail }) => {
    if (detail && ['initial', 'recovery', 'data-updated'].includes(detail.phase)) {
      append(state.initializations, { at: performance.now(), attempt: detail.attempt, phase: detail.phase, stage: detail.stage, outcome: detail.outcome });
    }
  });
  // Record trusted dismissal provenance, not arbitrary key values or auth inputs.
  for (const type of ['pointerdown', 'click', 'focusin', 'keydown']) document.addEventListener(type, e => {
    if (!state.armed || !e.isTrusted || type === 'keydown' && !['Escape', 'Tab', 'Enter'].includes(e.key)) return;
    event(type, { target: target(e.target), active: target(document.activeElement), ...(type === 'keydown' ? { key: e.key } : {}) });
  }, true);
  for (const type of ['pagehide', 'popstate', 'hashchange', 'visibilitychange']) window.addEventListener(type, () => { if (state.armed) event(type); });
  const fail = kind => { if (!state.violations.some(row => row.kind === kind)) append(state.violations, { at: performance.now(), kind, route: location.pathname, active: target(document.activeElement) }); };
  function sample() {
    if (!state.armed) return;
    const next = document.querySelector('[role=dialog]'), input = next?.querySelector('#diary-content');
    if (panel && (next !== panel || input !== field || !panel.isConnected || !field.isConnected)) fail('dialog-or-editor-replaced-or-removed');
    if (location.pathname !== '/diary') fail('route-left-diary');
    if (!next || !input) return;
    const rect = next.getBoundingClientRect();
    let painted = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    const inputRect = input.getBoundingClientRect();
    let inputPainted = inputRect.width > 0 && inputRect.height > 0;
    for (let el = input; el; el = el.parentElement) { const style = getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) inputPainted = false; }
    for (let el = next; el; el = el.parentElement) { const style = getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) painted = false; }
    painted &&= inputPainted;
    if (state.firstPaintAt === null && painted) { panel = next; field = input; state.firstPaintAt = performance.now(); event('first-dialog-paint'); }
    if (panel) { if (!painted) fail('dialog-not-painted'); state.samples++; state.lastSampleAt = performance.now(); state.route = location.pathname; }
  }
  new MutationObserver(records => {
    if (state.armed && panel) for (const record of records) for (const removed of record.removedNodes) {
      if (removed === panel || removed === field || removed.contains(panel) || removed.contains(field)) fail('dialog-or-editor-detached');
    }
    sample();
  }).observe(document, { subtree: true, childList: true, attributes: true });
  function frame() { sample(); requestAnimationFrame(frame); } requestAnimationFrame(frame);
  globalThis.__firstDiaryAudit = {
    arm() { state.armed = true; event('armed-before-native-open'); },
    stop() { sample(); state.armed = false; event('intentional-cancel-boundary'); },
    snapshot() { sample(); return structuredClone(state); },
  };
}
