/** Device-memory-only operational counters. Never pass user content here. */
export const ROUTE_IDS: Record<string, string> = { '/': 'home', '/schedule': 'schedule', '/quick-note': 'capture', '/quick-note/result': 'capture-review', '/expense': 'expenses', '/habit': 'habits', '/todo': 'todos', '/diary': 'diary', '/coach': 'coach', '/insights': 'insights', '/settings': 'settings', '/goal': 'goals', '/timeline': 'timeline', '/login': 'login', '/onboarding': 'onboarding' };
export type DiagnosticKind = 'page-ready' | 'button' | 'checkbox' | 'input-focus' | 'runtime-error' | 'request-ok' | 'request-failed';
export interface DiagnosticEvent { kind: DiagnosticKind; area: string; elapsedMs?: number; status?: number; at: number }
const records: DiagnosticEvent[] = [];
const areas = new Set([...Object.values(ROUTE_IDS), 'auth', 'sync', 'api', 'unknown']);
export function recordDiagnostic(kind: DiagnosticKind, area: string, elapsedMs?: number, status?: number) {
  records.push({ kind, area: areas.has(area) ? area : 'unknown', ...(Number.isFinite(elapsedMs) ? { elapsedMs: Math.max(0, Math.round(elapsedMs!)) } : {}), ...(typeof status === 'number' && status >= 100 && status <= 599 ? { status } : {}), at: Date.now() });
  if (records.length > 120) records.splice(0, records.length - 120);
}
export function diagnosticSnapshot(): DiagnosticEvent[] { return records.map((row) => ({ ...row })); }
export function clearDiagnostics() { records.length = 0; }
export function requestArea(path: string) { return path.startsWith('/sync/') ? 'sync' : path.startsWith('/auth/') ? 'auth' : 'api'; }
