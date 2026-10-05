// Exact safe collector body from e2e-recovery.mjs; parity tested, observation only.
import { installStorageProgress, projectStorageProgress, storageProgressSchema } from './audit-storage-progress.mjs';
export function createInitializationObserver() {
const traceSchema = {
  phase: ['initial', 'recovery', 'data-updated'],
  stage: ['initialization', 'settings', 'sync', 'sync-offline', 'stores', 'expense', 'todo', 'habit', 'quick-note', 'schedule', 'diary', 'coach', 'goal'],
  outcome: ['start', 'success', 'error', 'timeout', 'cancel'],
  errorName: ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AuthError', 'AbortError', 'TimeoutError', 'DatabaseClosedError', 'TransactionInactiveError', 'PrematureCommitError', 'SubTransactionError', 'QuotaExceededError', 'UpgradeError', 'VersionError', 'InvalidStateError', 'NotFoundError', 'ConstraintError', 'DataError', 'ReadOnlyError', 'UnknownError', 'SecurityError', 'NetworkError', 'OpenFailedError', 'MissingAPIError', 'BulkError', 'ModifyError', 'unknown'],
  errorCategory: ['authority-changed', 'local-data-changed', 'auth', 'storage', 'abort', 'timeout', 'unknown'],
  transactionMode: ['readonly', 'readwrite'],
};
const traceFlags = ['authChecked', 'isAuthenticated', 'identityUnavailable', 'signedOut', 'boundOwner', 'verifiedOwner', 'ownersMatch', 'generationChanged', 'revisionChanged', 'dbOpen', 'dbBlocked', 'recoveryErrorPresent', 'ambientTransactionPresent', 'ambientTransactionActive'];
const traceRoutes = ['/', '/login', '/onboarding', '/data-info', '/schedule', '/quick-note', '/quick-note/result', '/expense', '/todo', '/habit', '/diary', '/coach', '/insights', '/settings', '/goal', '/timeline', '/more'];
const traceMarkers = ['navigation-committed', 'document-start', 'login-start', 'login-root-ready', 'route-start', 'route-ready', 'reload-start', 'reload-ready', 'account-b-login-start', 'account-b-login-root-ready', 'account-b-todo-ready'];
const traceLimit = 2048, pageErrorLimit = 160;
const chronology = [], storageChronology = [], errors = [], tracedPages = new WeakMap();
let storageDropped = 0;
const storageLimit = 4096;
const traceStarted = performance.now();
let traceSequence = 0, traceDropped = 0, nextPage = 0, nextRequest = 0;
const safeCounter = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const elapsed = start => Math.min(1_000_000_000, Math.max(0, Math.round(performance.now() - start)));
const safeErrorName = name => traceSchema.errorName.includes(name) ? name : 'unknown';
function safeExceptionName(error) {
  try { const name = error?.name; return safeErrorName(name); } catch { return 'unknown'; }
}
function safeRoute(url) {
  try { const path = new URL(url, 'http://synthetic.invalid').pathname; return traceRoutes.includes(path) ? path : 'unknown'; } catch { return 'unknown'; }
}
function safeEndpoint(url) {
  try {
    const path = new URL(url).pathname;
    const endpoints = { '/api/auth/me': 'auth-me', '/api/auth/send-code': 'auth-send-code', '/api/auth/verify': 'auth-verify', '/api/auth/register': 'auth-register', '/api/auth/logout': 'auth-logout', '/api/sync/push': 'sync-push', '/api/sync/pull': 'sync-pull', '/api/sync/bootstrap': 'sync-bootstrap', '/api/user/settings': 'settings' };
    if (Object.hasOwn(endpoints, path)) return endpoints[path];
    if (path.startsWith('/api/coach/')) return 'coach';
    if (path.startsWith('/api/auth/')) return 'auth';
    if (path.startsWith('/api/sync/')) return 'sync';
    if (path.startsWith('/api/')) return 'api';
    return traceRoutes.includes(path) ? 'document' : 'asset';
  } catch { return 'unknown'; }
}
function projectTrace(value) {
  try {
    if (!value || typeof value !== 'object') return null;
    const safe = {};
    for (const key of ['attempt', 'sequence', 'elapsedMs']) { const field = value[key]; if (!safeCounter(field)) return null; safe[key] = field; }
    for (const key of ['phase', 'stage', 'outcome']) { const field = value[key]; if (!traceSchema[key].includes(field)) return null; safe[key] = field; }
    for (const key of ['errorName', 'errorCategory', 'transactionMode']) { const field = value[key]; if (traceSchema[key].includes(field)) safe[key] = field; }
    for (const key of traceFlags) { const field = value[key]; if (typeof field === 'boolean') safe[key] = field; }
    return safe;
  } catch { return null; }
}
function appendTrace(page, event) {
  const state = tracedPages.get(page);
  if (!state) return;
  chronology.push({ sequence: ++traceSequence, elapsedMs: elapsed(traceStarted), page: state.id, document: state.document, ...event });
  if (chronology.length > traceLimit) { traceDropped += chronology.length - traceLimit; chronology.splice(0, chronology.length - traceLimit); }
}
function boundary(page, marker, route = page.url()) {
  // Call sites supply fixed labels, never account names or addresses.
  appendTrace(page, { kind: 'boundary', marker: traceMarkers.includes(marker) ? marker : 'unknown', route: safeRoute(route) });
}
async function observeInitialization(page) {
  if (tracedPages.has(page)) return;
  tracedPages.set(page, { id: ++nextPage, document: 0 });
  const requests = new WeakMap();
  page.on('pageerror', error => {
    const name = safeExceptionName(error);
    if (errors.length < pageErrorLimit) errors.push(name);
    appendTrace(page, { kind: 'pageerror', name });
  });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) boundary(page, 'navigation-committed', frame.url()); });
  page.on('request', request => {
    const method = request.method();
    const safe = { request: ++nextRequest, documentAtRequestStart: tracedPages.get(page).document, endpoint: safeEndpoint(request.url()), method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? method : 'unknown' };
    requests.set(request, { safe, started: performance.now() });
    appendTrace(page, { kind: 'request', outcome: 'start', ...safe });
  });
  page.on('response', response => {
    const request = requests.get(response.request());
    if (!request) return;
    const status = response.status();
    appendTrace(page, { kind: 'request', outcome: 'response', ...request.safe, durationMs: elapsed(request.started), ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}) });
  });
  page.on('requestfinished', request => {
    const saved = requests.get(request);
    if (saved && saved.safe.endpoint !== 'asset') appendTrace(page, { kind: 'request', outcome: 'finished', ...saved.safe, durationMs: elapsed(saved.started) });
  });
  page.on('requestfailed', request => {
    const saved = requests.get(request);
    if (saved) appendTrace(page, { kind: 'request', outcome: 'failed', ...saved.safe, durationMs: elapsed(saved.started), failure: 'network-failure' });
  });
  await page.exposeFunction('__youtraceInitializationDiagnostic', value => {
    if (value?.kind === 'storage-progress') {
      const safe = projectStorageProgress(value.event);
      if (safe) {
        const target = tracedPages.get(page);
        storageChronology.push({ elapsedMs: elapsed(traceStarted), page: target.id, document: target.document, event: safe });
        if (storageChronology.length > storageLimit) { storageDropped += storageChronology.length - storageLimit; storageChronology.splice(0, storageChronology.length - storageLimit); }
      }
      return;
    }
    if (value?.kind === 'document-start') {
      tracedPages.get(page).document += 1;
      const route = value.route;
      boundary(page, 'document-start', traceRoutes.includes(route) ? route : 'unknown');
      return;
    }
    const safe = projectTrace(value);
    if (safe) appendTrace(page, { kind: 'initialization', event: safe });
  });
  await page.evaluateOnNewDocument((schema, flags, routes) => {
    if (window !== window.top) return;
    const send = value => { try { void window.__youtraceInitializationDiagnostic(value).catch(() => undefined); } catch { /* Observation only. */ } };
    const path = location.pathname;
    send({ kind: 'document-start', route: routes.includes(path) ? path : 'unknown' });
    window.addEventListener('youtrace:initialization-diagnostic', event => {
      // Project before crossing the browser boundary as well as in Node. A
      // spoofed CustomEvent cannot send a message, ID, token or arbitrary field.
      try {
        const value = event.detail, safe = {};
        if (!value || typeof value !== 'object') return;
        for (const key of ['attempt', 'sequence', 'elapsedMs']) {
          const field = value[key];
          if (!Number.isSafeInteger(field) || field < 0 || field > 1_000_000_000) return;
          safe[key] = field;
        }
        for (const key of ['phase', 'stage', 'outcome']) { const field = value[key]; if (!schema[key].includes(field)) return; safe[key] = field; }
        for (const key of ['errorName', 'errorCategory', 'transactionMode']) { const field = value[key]; if (schema[key].includes(field)) safe[key] = field; }
        for (const key of flags) { const field = value[key]; if (typeof field === 'boolean') safe[key] = field; }
        send(safe);
      } catch { /* Observation only. */ }
    });
  }, traceSchema, traceFlags, traceRoutes);
  await page.evaluateOnNewDocument(installStorageProgress, storageProgressSchema);
}
function firstFailureTrace(error) {
  return { version: 1, syntheticOnly: true, failureName: safeExceptionName(error), limit: traceLimit, dropped: traceDropped, storageLimit, storageDropped, storageChronology: storageChronology.map(row => ({ ...row, event: { ...row.event, stores: [...row.event.stores] } })), pageErrorNames: [...errors], chronology: chronology.map(row => ({ ...row, ...(row.event ? { event: { ...row.event } } : {}) })) };
}

return { observeInitialization, boundary, firstFailureTrace };
}
