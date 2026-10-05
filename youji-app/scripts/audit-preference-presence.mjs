import assert from 'node:assert/strict';
import { preferenceEvidenceErrorName } from './audit-preference-contract.mjs';

// Metadata only: browser-originated events are observed, never dispatched.
export function installPreferencePresence() {
  if (window.__youtracePreferencePresence) throw new Error('Presence observer already installed');
  const evidence = { timeOrigin: performance.timeOrigin, events: [], dropped: 0 };
  const record = event => {
    const type = event.type, trusted = event.isTrusted === true;
    if (!['focus', 'blur', 'visibilitychange'].includes(type)) return;
    if (evidence.events.length >= 100) { evidence.dropped++; return; }
    evidence.events.push({ sequence: evidence.events.length + 1, type, trusted, target: event.target === window ? 'window' : event.target === document ? 'document' : 'other', elapsedMs: performance.now(), visibility: document.visibilityState, focused: document.hasFocus() });
  };
  window.addEventListener('focus', record); window.addEventListener('blur', record); document.addEventListener('visibilitychange', record);
  window.__youtracePreferencePresence = { evidence, stop: () => { window.removeEventListener('focus', record); window.removeEventListener('blur', record); document.removeEventListener('visibilitychange', record); delete window.__youtracePreferencePresence; } };
}
export function readPreferencePresence() {
  const current = window.__youtracePreferencePresence;
  if (!current) throw new Error('The observed preference document was replaced');
  return { ...structuredClone(current.evidence), currentTimeOrigin: performance.timeOrigin, path: location.pathname, visibility: document.visibilityState, focused: document.hasFocus(), comparisonOpen: Boolean(document.querySelector('[role=dialog]')) };
}
export function stopPreferencePresence() { window.__youtracePreferencePresence?.stop(); }
export function preferenceWasLeft(state) {
  return state.dropped === 0 && state.timeOrigin === state.currentTimeOrigin && state.events.some(row => row.trusted && (row.type === 'blur' && row.target === 'window' || row.type === 'visibilitychange' && row.target === 'document' && row.visibility === 'hidden'));
}
export function preferenceReallyReturned(state) {
  if (!preferenceWasLeft(state) || state.path !== '/settings' || !state.comparisonOpen || state.visibility !== 'visible' || !state.focused) return false;
  return state.events.some((row, index) => row.type === 'focus' && row.target === 'window' && row.trusted && state.events.slice(0, index).some(earlier => earlier.trusted && (earlier.type === 'blur' && earlier.target === 'window' || earlier.type === 'visibilitychange' && earlier.target === 'document' && earlier.visibility === 'hidden')));
}

// Switching to another profile did not produce a new main-window focus event
// in the preserved run. Use one real blank tab in the same profile, then return.
export async function returnToPreferenceComparison(page, { active, timeoutMs = 5000, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const deadline = now() + timeoutMs, evidence = { timeoutMs, actions: [], probes: [], completed: false };
  let blank, firstError;
  const current = () => { active(); assert.ok(now() < deadline, 'Actual preference tab return exceeded its original observation bound'); };
  const observe = async predicate => {
    for (;;) {
      current(); const state = await page.evaluate(readPreferencePresence); current(); evidence.probes.push(state);
      if (predicate(state)) return state;
      await pause(Math.min(50, Math.max(0, deadline - now())));
    }
  };
  try {
    current(); await page.evaluate(installPreferencePresence); current();
    blank = await page.browserContext().newPage(); current();
    assert.equal(blank.url(), 'about:blank');
    const session = await blank.createCDPSession();
    try { const target = await session.send('Target.getTargetInfo'); evidence.actions.push({ kind: 'same-profile-blank-tab-created', at: now(), targetId: target.targetInfo.targetId }); }
    finally { await session.detach(); }
    current(); await blank.bringToFront(); evidence.actions.push({ kind: 'blank-tab-activated', at: now() }); await observe(preferenceWasLeft);
    current(); evidence.actions.push({ kind: 'original-comparison-tab-activation-start', at: now() }); await page.bringToFront(); evidence.actions.push({ kind: 'original-comparison-tab-activated', at: now() }); await observe(preferenceReallyReturned);
    evidence.returnObserved = true;
  } catch (error) { firstError = error; evidence.error = error.message; }
  finally {
    try { evidence.beforeCleanup = await page.evaluate(readPreferencePresence); } catch { evidence.beforeCleanupUnavailable = true; }
    try { if (blank) { await blank.close(); evidence.actions.push({ kind: 'blank-tab-closed', at: now() }); } }
    catch (error) { evidence.cleanupError = preferenceEvidenceErrorName(error); firstError ??= error; }
    try { await page.evaluate(stopPreferencePresence); } catch (error) { evidence.observerCleanupUnavailable = true; firstError ??= error; }
  }
  if (firstError) { firstError.preferenceReturnEvidence = evidence; throw firstError; }
  evidence.completed = true;
  return evidence;
}

// Attach only around the tab-return/read-only IDB interval. That interval issues
// no diagnostic HTTP GET, so these events are the app's own requests.
export function observePreferenceApplicationReads(page, origin, now = Date.now) {
  const rows = [], requests = new Map();
  const request = value => {
    if (value.url() !== `${origin}/api/user/settings` || value.method() !== 'GET') return;
    const row = { sequence: rows.length + 1, startedAt: now(), method: 'GET', path: '/api/user/settings' };
    rows.push(row); requests.set(value, row);
  };
  const response = value => { const row = requests.get(value.request()); if (row) { row.status = value.status(); row.respondedAt = now(); } };
  page.on('request', request); page.on('response', response);
  return { rows, stop: () => { page.off('request', request); page.off('response', response); } };
}
