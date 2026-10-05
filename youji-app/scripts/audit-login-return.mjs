import assert from 'node:assert/strict';

// The navigation shell can mount before FirstVisitGate redirects to onboarding.
// Read actual destination content, without reading or changing the onboarding flag.
export function readExistingLoginDocument() {
  const painted = element => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const path = location.pathname, shell = Boolean(document.querySelector('aside nav,nav[aria-label="主导航"]'));
  const homeHeadings = [...document.querySelectorAll('[data-page-route="/"] h1')].filter(painted);
  const homeContent = homeHeadings.length === 1;
  const onboardingHeadings = [...document.querySelectorAll('h1')].filter(painted);
  const next = [...document.querySelectorAll('button')].filter(element => element.textContent.trim() === '下一步' && !element.disabled && painted(element));
  const onboardingContent = onboardingHeadings.length === 1 && next.length === 1;
  return { origin: location.origin, path, timeOrigin: performance.timeOrigin, shell, homeContent, onboardingContent, ready: path === '/onboarding' ? onboardingContent : path === '/' && shell && homeContent };
}

// Hosted native-audit observation only. No retries of the user's login action,
// no application state writes, and no poller retained inside an old document.
export async function observeExistingLoginReturn(page, click, {
  timeoutMs = 15000,
  now = () => performance.now(),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const bounded = async (operation, milliseconds) => {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Current-document login observation exceeded its deadline')), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  };
  const readCurrentDocument = () => page.evaluate(readExistingLoginDocument);
  const original = await bounded(readCurrentDocument(), 5000);
  assert.equal(original.path, '/login', 'Existing-account verification starts on the actual Login document');
  const evidence = { timeoutMs, original, clickReturnedAt: null, responses: [], navigations: [], probes: [], completed: false };
  const installedAt = now();
  let observerError = null, sequence = 0;
  const response = value => {
    try {
      const request = value.request(), url = new URL(value.url());
      if (url.origin !== original.origin) return;
      const method = request.method(), navigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (url.pathname === '/api/auth/verify' && method === 'POST' || navigation && method === 'GET') {
        if (evidence.responses.length >= 32) { observerError = new Error('Login response observation budget exceeded'); return; }
        evidence.responses.push({ sequence: ++sequence, elapsedMs: now() - installedAt, path: url.pathname, method, status: value.status(), navigation });
      }
    } catch { observerError = new Error('Could not observe the actual login response'); }
  };
  const navigated = frame => {
    try {
      if (frame !== page.mainFrame()) return;
      const url = new URL(frame.url());
      if (evidence.navigations.length >= 32) { observerError = new Error('Login navigation observation budget exceeded'); return; }
      evidence.navigations.push({ sequence: ++sequence, elapsedMs: now() - installedAt, path: url.pathname, sameOrigin: url.origin === original.origin });
    } catch { observerError = new Error('Could not observe the actual main-document navigation'); }
  };
  page.on('response', response); page.on('framenavigated', navigated);
  try {
    await click(); // Exactly the existing native pointer action, once.
    const started = now(), deadline = started + timeoutMs;
    evidence.clickReturnedAt = started - installedAt;
    for (;;) {
      if (observerError) throw observerError;
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('Existing login did not reach the current-document outcome within 15000ms');
      const verifies = evidence.responses.filter(row => row.path === '/api/auth/verify' && row.method === 'POST');
      assert.ok(verifies.length <= 1, 'Only one actual verification request may occur');
      if (verifies.length) assert.equal(verifies[0].status, 200, 'Actual native verification must return HTTP200');
      let current;
      try { current = await bounded(readCurrentDocument(), remaining); }
      catch (error) {
        // Navigation can destroy an evaluation already sent to the previous
        // document. Observe again within the same deadline; do not click again.
        if (!/Execution context was destroyed|Cannot find context with specified id|Cannot find default execution context/.test(String(error.message))) throw error;
        evidence.probes.push({ elapsedMs: now() - started, transition: 'execution-context-replaced' });
      }
      if (now() > deadline) throw new Error('Existing login observation returned after the original deadline');
      if (current) {
        evidence.probes.push({ elapsedMs: now() - started, ...current });
        const documentResponse = evidence.responses.find(row => row.navigation && row.method === 'GET' && row.status === 200 && verifies.length === 1 && row.sequence > verifies[0].sequence);
        const observedNavigation = evidence.navigations.some(row => row.sameOrigin && verifies.length === 1 && row.sequence > verifies[0].sequence);
        if (verifies.length === 1 && documentResponse && observedNavigation && current.origin === original.origin && current.timeOrigin !== original.timeOrigin && current.ready) {
          evidence.completed = true; evidence.elapsedMs = now() - started; return evidence;
        }
      }
      assert.ok(evidence.probes.length <= 160, 'Current-document observation is bounded');
      await pause(Math.min(100, Math.max(0, deadline - now())));
    }
  } catch (error) {
    error.loginReturnEvidence = evidence; throw error;
  } finally {
    page.off('response', response); page.off('framenavigated', navigated);
  }
}
